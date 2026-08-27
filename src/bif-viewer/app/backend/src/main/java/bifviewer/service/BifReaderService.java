package bifviewer.service;

import bifviewer.domain.slide.SlideStatus;
import bifviewer.infrastructure.persistence.AppUserEntity;
import bifviewer.infrastructure.persistence.SlideEntity;
import bifviewer.infrastructure.persistence.SlideRepository;
import bifviewer.infrastructure.storage.SlideStorage;
import loci.common.services.DependencyException;
import loci.common.services.ServiceException;
import loci.common.services.ServiceFactory;
import loci.formats.CoreMetadata;
import loci.formats.FormatException;
import loci.formats.ImageReader;
import loci.formats.MetadataTools;
import loci.formats.gui.BufferedImageReader;
import loci.formats.meta.IMetadata;
import loci.formats.services.OMEXMLService;
import ome.units.UNITS;
import ome.units.quantity.Length;
import org.apache.commons.pool2.BasePooledObjectFactory;
import org.apache.commons.pool2.PooledObject;
import org.apache.commons.pool2.impl.DefaultPooledObject;
import org.apache.commons.pool2.impl.GenericObjectPool;
import org.apache.commons.pool2.impl.GenericObjectPoolConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Hashtable;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class BifReaderService {

    private static final Logger log = LoggerFactory.getLogger(BifReaderService.class);

    private final SlideRepository slideRepository;
    private final SlideStorage slideStorage;
    private final int tileSize;
    private final int readerPoolSize;
    private final AppUserService appUserService;
    private final Map<String, SlideRuntime> runtimes = new ConcurrentHashMap<>();

    public BifReaderService(
            SlideRepository slideRepository,
            SlideStorage slideStorage,
            @Value("${bif.tile-size}") int tileSize,
            @Value("${bif.reader-pool-size}") int readerPoolSize,
            AppUserService appUserService
    ) {
        this.slideRepository = slideRepository;
        this.slideStorage = slideStorage;
        this.tileSize = tileSize;
        this.readerPoolSize = readerPoolSize;
        this.appUserService = appUserService;
    }

    public SlideMetadata getSlideMetadata(String slideId) {
        return getRuntime(slideId).metadata();
    }

    public SlideMetadata inspect(String slideId, Path storedPath) {
        SlideRuntime runtime = openRuntime(slideId, storedPath, storedPath.getFileName().toString());
        try {
            return runtime.metadata();
        } finally {
            try {
                runtime.pool().close();
            } catch (Exception exception) {
                log.warn("failed to close inspection pool for slide={}: {}", slideId, exception.getMessage());
            }
        }
    }

    public RawMetadata getRawMetadata(String slideId) {
        SlideEntity slide = requireReadableSlide(slideId);
        if (slide.getStatus() != SlideStatus.READY || slide.getBioformatsStatus() != SlideStatus.READY) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Bio-Formats reader is not available for slide: " + slideId);
        }
        return readRawMetadata(slideId, slideStorage.resolve(slide.getStoragePath()), slide.getOriginalName());
    }

    public BufferedImage readRegion(String slideId, int z, int x, int y) {
        SlideRuntime runtime = getRuntime(slideId);
        SlideLevel level = runtime.metadata().level(z);
        int regionX = x * tileSize;
        int regionY = y * tileSize;

        if (regionX >= level.width() || regionY >= level.height()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Tile coordinates are outside slide bounds");
        }

        int width = Math.min(tileSize, level.width() - regionX);
        int height = Math.min(tileSize, level.height() - regionY);
        if (width <= 0 || height <= 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Tile coordinates are outside slide bounds");
        }

        BufferedImageReader reader = borrow(runtime.pool());
        try {
            reader.setSeries(0);
            reader.setResolution(level.readerResolution());
            int planeIndex = reader.getIndex(0, 0, 0);
            return reader.openImage(planeIndex, regionX, regionY, width, height);
        } catch (FormatException | IOException exception) {
            throw new IllegalStateException("Failed to read BIF tile for slide " + slideId, exception);
        } finally {
            runtime.pool().returnObject(reader);
        }
    }

    public boolean closeSlide(String slideId) {
        SlideRuntime runtime = runtimes.remove(slideId);
        if (runtime == null) {
            return false;
        }
        try {
            runtime.pool().close();
            log.info("closed bio-formats reader pool for slide={}", slideId);
        } catch (Exception exception) {
            log.warn("failed to close reader pool for slide={}: {}", slideId, exception.getMessage());
        }
        return true;
    }

    private SlideRuntime getRuntime(String slideId) {
        requireReadableSlide(slideId);
        return runtimes.computeIfAbsent(slideId, this::loadRuntimeFromRepository);
    }

    private SlideRuntime loadRuntimeFromRepository(String slideId) {
        SlideEntity slide = slideRepository.findById(parseSlideId(slideId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId));
        Path slidePath = slideStorage.resolve(slide.getStoragePath());
        return openRuntime(slideId, slidePath, slide.getOriginalName());
    }

    private SlideRuntime openRuntime(String slideId, Path slidePath, String fileName) {
        IMetadata omeMetadata = MetadataTools.createOMEXMLMetadata();
        ImageReader imageReader = new ImageReader();
        imageReader.setFlattenedResolutions(false);
        imageReader.setOriginalMetadataPopulated(true);
        imageReader.setMetadataStore(omeMetadata);
        BufferedImageReader reader = new BufferedImageReader(imageReader);
        reader.setFlattenedResolutions(false);
        boolean readerAdopted = false;
        try {
            reader.setId(slidePath.toString());
            reader.setSeries(0);
            int resolutionCount = Math.max(1, reader.getResolutionCount());
            List<SlideLevel> levels = new ArrayList<>(resolutionCount);
            for (int z = 0; z < resolutionCount; z++) {
                int readerResolution = resolutionCount - 1 - z;
                reader.setResolution(readerResolution);
                int width = reader.getSizeX();
                int height = reader.getSizeY();
                int columns = (int) Math.ceil(width / (double) tileSize);
                int rows = (int) Math.ceil(height / (double) tileSize);
                levels.add(new SlideLevel(z, readerResolution, width, height, columns, rows));
            }

            SlideLevel maxLevel = levels.get(levels.size() - 1);
            SlideMetadata metadata = new SlideMetadata(
                    slideId,
                    fileName,
                    tileSize,
                    maxLevel.width(),
                    maxLevel.height(),
                    levels,
                    physicalScale(omeMetadata, maxLevel.width(), maxLevel.height())
            );
            GenericObjectPool<BufferedImageReader> pool = createPool(slidePath, reader);
            readerAdopted = true;
            try {
                // Havuzu, zaten açık olan bu reader ile doldur — ilk tile isteği dosyayı
                // ikinci kez baştan açmasın (bu, kaydırıcının ilk açılışında gecikmenin
                // başlıca sebebiydi).
                pool.addObject();
            } catch (Exception exception) {
                log.warn("failed to seed reader pool for slide={}: {}", slideId, exception.getMessage());
            }
            return new SlideRuntime(metadata, pool);
        } catch (FormatException | IOException exception) {
            throw new IllegalStateException("Failed to inspect Bio-Formats slide " + slideId, exception);
        } finally {
            if (!readerAdopted) {
                try {
                    reader.close();
                } catch (IOException exception) {
                    log.warn("failed to close metadata reader for slide={}: {}", slideId, exception.getMessage());
                }
            }
        }
    }

    private RawMetadata readRawMetadata(String slideId, Path slidePath, String fileName) {
        IMetadata omeMetadata = MetadataTools.createOMEXMLMetadata();
        ImageReader reader = new ImageReader();
        reader.setFlattenedResolutions(false);
        reader.setOriginalMetadataPopulated(true);
        reader.setMetadataStore(omeMetadata);
        try {
            reader.setId(slidePath.toString());
            int seriesCount = reader.getSeriesCount();
            List<RawSeriesMetadata> series = new ArrayList<>(seriesCount);
            for (int seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
                reader.setSeries(seriesIndex);
                series.add(new RawSeriesMetadata(
                        seriesIndex,
                        reader.getResolutionCount(),
                        reader.getImageCount(),
                        reader.getSizeX(),
                        reader.getSizeY(),
                        reader.getSizeZ(),
                        reader.getSizeC(),
                        reader.getSizeT(),
                        reader.getPixelType(),
                        reader.getBitsPerPixel(),
                        reader.getDimensionOrder(),
                        reader.isRGB(),
                        reader.isLittleEndian(),
                        reader.isInterleaved(),
                        reader.isIndexed(),
                        reader.isMetadataComplete(),
                        reader.getOptimalTileWidth(),
                        reader.getOptimalTileHeight(),
                        stringMap(reader.getSeriesMetadata())
                ));
            }

            return new RawMetadata(
                    slideId,
                    fileName,
                    reader.getFormat(),
                    reader.getCurrentFile(),
                    List.of(reader.getUsedFiles()),
                    List.of(reader.getDomains()),
                    reader.isOriginalMetadataPopulated(),
                    reader.isMetadataFiltered(),
                    stringMap(reader.getGlobalMetadata()),
                    series,
                    coreMetadata(reader.getCoreMetadataList()),
                    omeXml(omeMetadata)
            );
        } catch (FormatException | IOException exception) {
            throw new IllegalStateException("Failed to read Bio-Formats raw metadata for slide " + slideId, exception);
        } finally {
            try {
                reader.close();
            } catch (IOException exception) {
                log.warn("failed to close raw metadata reader for slide={}: {}", slideId, exception.getMessage());
            }
        }
    }

    private List<RawCoreMetadata> coreMetadata(List<CoreMetadata> source) {
        List<RawCoreMetadata> coreMetadata = new ArrayList<>(source.size());
        for (int index = 0; index < source.size(); index++) {
            CoreMetadata core = source.get(index);
            coreMetadata.add(new RawCoreMetadata(
                    index,
                    core.sizeX,
                    core.sizeY,
                    core.sizeZ,
                    core.sizeC,
                    core.sizeT,
                    core.thumbSizeX,
                    core.thumbSizeY,
                    core.pixelType,
                    core.bitsPerPixel,
                    core.imageCount,
                    core.dimensionOrder,
                    core.orderCertain,
                    core.rgb,
                    core.littleEndian,
                    core.interleaved,
                    core.indexed,
                    core.falseColor,
                    core.metadataComplete,
                    core.thumbnail,
                    core.resolutionCount,
                    stringMap(core.seriesMetadata)
            ));
        }
        return coreMetadata;
    }

    private String omeXml(IMetadata metadata) {
        try {
            OMEXMLService service = new ServiceFactory().getInstance(OMEXMLService.class);
            return service.getOMEXML(metadata);
        } catch (DependencyException | ServiceException exception) {
            log.warn("failed to serialise OME-XML metadata: {}", exception.getMessage());
            return null;
        }
    }

    private Map<String, String> stringMap(Hashtable<String, Object> metadata) {
        Map<String, String> result = new LinkedHashMap<>();
        if (metadata == null) {
            return result;
        }
        for (Map.Entry<String, Object> entry : metadata.entrySet()) {
            result.put(entry.getKey(), String.valueOf(entry.getValue()));
        }
        return result;
    }

    private PhysicalScale physicalScale(IMetadata metadata, int width, int height) {
        if (metadata == null) {
            return PhysicalScale.unavailable("BIO_FORMATS");
        }

        Double micronsPerPixelX = microns(metadata.getPixelsPhysicalSizeX(0));
        Double micronsPerPixelY = microns(metadata.getPixelsPhysicalSizeY(0));
        boolean available = micronsPerPixelX != null || micronsPerPixelY != null;
        return new PhysicalScale(
                available,
                micronsPerPixelX,
                micronsPerPixelY,
                micronsPerPixelX == null ? null : micronsPerPixelX * width,
                micronsPerPixelY == null ? null : micronsPerPixelY * height,
                "BIO_FORMATS"
        );
    }

    private Double microns(Length length) {
        if (length == null) {
            return null;
        }
        Number value = length.value(UNITS.MICROMETER);
        return value == null ? null : value.doubleValue();
    }

    private GenericObjectPool<BufferedImageReader> createPool(Path slidePath, BufferedImageReader seedReader) {
        GenericObjectPoolConfig<BufferedImageReader> config = new GenericObjectPoolConfig<>();
        config.setMaxTotal(readerPoolSize);
        config.setMaxIdle(readerPoolSize);
        config.setMinIdle(1);
        config.setBlockWhenExhausted(true);
        return new GenericObjectPool<>(new BufferedImageReaderFactory(slidePath, seedReader), config);
    }

    private BufferedImageReader borrow(GenericObjectPool<BufferedImageReader> pool) {
        try {
            return pool.borrowObject();
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to borrow Bio-Formats reader from pool", exception);
        }
    }

    private UUID parseSlideId(String slideId) {
        try {
            return UUID.fromString(slideId);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId, exception);
        }
    }

    private SlideEntity requireReadableSlide(String slideId) {
        SlideEntity slide = slideRepository.findById(parseSlideId(slideId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId));
        AppUserEntity currentUser = appUserService.currentUser();
        if (!appUserService.isMaster(currentUser)
                && (slide.getAssignedUserId() == null || !slide.getAssignedUserId().equals(currentUser.getId()))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId);
        }
        return slide;
    }

    private static final class BufferedImageReaderFactory extends BasePooledObjectFactory<BufferedImageReader> {

        private final Path slidePath;
        private final java.util.concurrent.atomic.AtomicReference<BufferedImageReader> seed;

        private BufferedImageReaderFactory(Path slidePath, BufferedImageReader seedReader) {
            this.slidePath = slidePath;
            this.seed = new java.util.concurrent.atomic.AtomicReference<>(seedReader);
        }

        @Override
        public BufferedImageReader create() throws Exception {
            // Metadata çıkarımı için zaten açılmış (setId() çağrılmış) reader varsa onu
            // yeniden kullan — ilk tile isteği dosyayı ikinci kez baştan açıp gecikmesin.
            BufferedImageReader existing = seed.getAndSet(null);
            if (existing != null) {
                return existing;
            }
            ImageReader imageReader = new ImageReader();
            imageReader.setFlattenedResolutions(false);
            BufferedImageReader bufferedReader = new BufferedImageReader(imageReader);
            bufferedReader.setFlattenedResolutions(false);
            bufferedReader.setId(slidePath.toString());
            bufferedReader.setSeries(0);
            return bufferedReader;
        }

        @Override
        public PooledObject<BufferedImageReader> wrap(BufferedImageReader reader) {
            return new DefaultPooledObject<>(reader);
        }

        @Override
        public void destroyObject(PooledObject<BufferedImageReader> pooledObject) throws Exception {
            pooledObject.getObject().close();
        }
    }

    private record SlideRuntime(SlideMetadata metadata, GenericObjectPool<BufferedImageReader> pool) {
    }

    public record SlideMetadata(
            String slideId,
            String fileName,
            int tileSize,
            int width,
            int height,
            List<SlideLevel> levels,
            PhysicalScale physicalScale
    ) {
        public SlideLevel level(int z) {
            if (z < 0 || z >= levels.size()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Zoom level is outside pyramid bounds");
            }
            return levels.get(z);
        }

        public int maxLevel() {
            return levels.size() - 1;
        }
    }

    public record SlideLevel(
            int z,
            int readerResolution,
            int width,
            int height,
            int tileColumns,
            int tileRows
    ) {
    }

    public record PhysicalScale(
            boolean available,
            Double micronsPerPixelX,
            Double micronsPerPixelY,
            Double physicalWidthMicrons,
            Double physicalHeightMicrons,
            String source
    ) {
        static PhysicalScale unavailable(String source) {
            return new PhysicalScale(false, null, null, null, null, source);
        }
    }

    public record RawMetadata(
            String slideId,
            String fileName,
            String format,
            String currentFile,
            List<String> usedFiles,
            List<String> domains,
            boolean originalMetadataPopulated,
            boolean metadataFiltered,
            Map<String, String> globalMetadata,
            List<RawSeriesMetadata> seriesMetadata,
            List<RawCoreMetadata> coreMetadata,
            String omeXml
    ) {
    }

    public record RawSeriesMetadata(
            int series,
            int resolutionCount,
            int imageCount,
            int sizeX,
            int sizeY,
            int sizeZ,
            int sizeC,
            int sizeT,
            int pixelType,
            int bitsPerPixel,
            String dimensionOrder,
            boolean rgb,
            boolean littleEndian,
            boolean interleaved,
            boolean indexed,
            boolean metadataComplete,
            int optimalTileWidth,
            int optimalTileHeight,
            Map<String, String> metadata
    ) {
    }

    public record RawCoreMetadata(
            int index,
            int sizeX,
            int sizeY,
            int sizeZ,
            int sizeC,
            int sizeT,
            int thumbSizeX,
            int thumbSizeY,
            int pixelType,
            int bitsPerPixel,
            int imageCount,
            String dimensionOrder,
            boolean orderCertain,
            boolean rgb,
            boolean littleEndian,
            boolean interleaved,
            boolean indexed,
            boolean falseColor,
            boolean metadataComplete,
            boolean thumbnail,
            int resolutionCount,
            Map<String, String> seriesMetadata
    ) {
    }
}
