package bifviewer.openslide;

import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OpenSlideReaderService {

    private static final Logger log = LoggerFactory.getLogger(OpenSlideReaderService.class);
    private static final OpenSlideNative OPEN_SLIDE = OpenSlideNative.INSTANCE;

    private final ConcurrentHashMap<String, SlideRuntime> runtimes = new ConcurrentHashMap<>();

    public SlideMetadata inspect(Path slidePath, String slideId, String fileName) {
        Pointer handle = openHandle(slidePath);
        try {
            return extractMetadata(handle, slideId, fileName);
        } finally {
            closeHandle(handle);
        }
    }

    public BufferedImage readRegion(OpenSlideExperimentService.OpenSlideSessionView session, int z, int x, int y) {
        SlideRuntime runtime = getRuntime(session);
        SlideLevel level = runtime.metadata().level(z);
        int tileSize = runtime.metadata().tileSize();
        int regionX = x * tileSize;
        int regionY = y * tileSize;
        if (regionX >= level.width() || regionY >= level.height()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Tile coordinates are outside slide bounds");
        }

        int width = Math.min(tileSize, level.width() - regionX);
        int height = Math.min(tileSize, level.height() - regionY);
        long level0X = Math.round(regionX * level.downsample());
        long level0Y = Math.round(regionY * level.downsample());

        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        int[] pixels = ((DataBufferInt) image.getRaster().getDataBuffer()).getData();
        OPEN_SLIDE.openslide_read_region(runtime.handle(), pixels, level0X, level0Y, level.openslideLevel(), width, height);
        verifyHandle(runtime.handle(), "Failed to read OpenSlide region");
        return image;
    }

    public boolean closeSlide(String slideId) {
        SlideRuntime runtime = runtimes.remove(slideId);
        if (runtime == null) {
            return false;
        }
        closeHandle(runtime.handle());
        return true;
    }

    @PreDestroy
    void shutdown() {
        for (Map.Entry<String, SlideRuntime> entry : runtimes.entrySet()) {
            closeHandle(entry.getValue().handle());
        }
        runtimes.clear();
    }

    private SlideRuntime getRuntime(OpenSlideExperimentService.OpenSlideSessionView session) {
        return runtimes.computeIfAbsent(session.slideId(), ignored -> new SlideRuntime(
                session.slideId(),
                session.path(),
                session.metadata(),
                openHandle(session.path())
        ));
    }

    private Pointer openHandle(Path slidePath) {
        Pointer handle = OPEN_SLIDE.openslide_open(slidePath.toString());
        if (handle == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "OpenSlide slide'i acamadi");
        }
        verifyHandle(handle, "OpenSlide slide'i acamadi");
        return handle;
    }

    private SlideMetadata extractMetadata(Pointer handle, String slideId, String fileName) {
        int levelCount = OPEN_SLIDE.openslide_get_level_count(handle);
        if (levelCount <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "OpenSlide level-count bilgisi bulunamadi");
        }

        List<SlideLevel> levels = new ArrayList<>(levelCount);
        for (int openslideLevel = levelCount - 1, viewerLevel = 0; openslideLevel >= 0; openslideLevel--, viewerLevel++) {
            long[] width = new long[1];
            long[] height = new long[1];
            OPEN_SLIDE.openslide_get_level_dimensions(handle, openslideLevel, width, height);
            double downsample = OPEN_SLIDE.openslide_get_level_downsample(handle, openslideLevel);
            int tileSize = 512;
            int columns = (int) Math.ceil(width[0] / (double) tileSize);
            int rows = (int) Math.ceil(height[0] / (double) tileSize);
            levels.add(new SlideLevel(viewerLevel, openslideLevel, (int) width[0], (int) height[0], downsample, tileSize, tileSize, columns, rows));
        }
        verifyHandle(handle, "OpenSlide metadata okunamadi");

        Map<String, String> slideProperties = properties(handle);
        SlideLevel fullResolution = levels.get(levels.size() - 1);
        SlideLevel smallestLevel = levels.getFirst();
        return new SlideMetadata(
                slideId,
                fileName,
                fullResolution.tileWidth(),
                fullResolution.width(),
                fullResolution.height(),
                slideProperties.getOrDefault("openslide.vendor", "unknown"),
                slideProperties,
                levels,
                smallestLevel.z(),
                fullResolution.z(),
                physicalScale(slideProperties, fullResolution.width(), fullResolution.height())
        );
    }

    private Map<String, String> properties(Pointer handle) {
        Map<String, String> properties = new LinkedHashMap<>();
        Pointer namesPointer = OPEN_SLIDE.openslide_get_property_names(handle);
        if (namesPointer == null) {
            return properties;
        }

        for (int index = 0; ; index++) {
            Pointer namePointer = namesPointer.getPointer((long) index * Native.POINTER_SIZE);
            if (namePointer == null) {
                break;
            }
            String key = namePointer.getString(0);
            String value = OPEN_SLIDE.openslide_get_property_value(handle, key);
            if (key != null && value != null) {
                properties.put(key, value);
            }
        }
        return properties;
    }

    private String property(Pointer handle, String key, String fallback) {
        String value = OPEN_SLIDE.openslide_get_property_value(handle, key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private PhysicalScale physicalScale(Map<String, String> properties, int width, int height) {
        Double micronsPerPixelX = parseDouble(properties.get("openslide.mpp-x"));
        Double micronsPerPixelY = parseDouble(properties.get("openslide.mpp-y"));
        boolean available = micronsPerPixelX != null || micronsPerPixelY != null;
        return new PhysicalScale(
                available,
                micronsPerPixelX,
                micronsPerPixelY,
                micronsPerPixelX == null ? null : micronsPerPixelX * width,
                micronsPerPixelY == null ? null : micronsPerPixelY * height,
                "OPENSLIDE_MPP"
        );
    }

    private Double parseDouble(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Double.parseDouble(value);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private void verifyHandle(Pointer handle, String message) {
        String error = OPEN_SLIDE.openslide_get_error(handle);
        if (error != null && !error.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message + ": " + error);
        }
    }

    private void closeHandle(Pointer handle) {
        try {
            OPEN_SLIDE.openslide_close(handle);
        } catch (Throwable exception) {
            log.warn("failed to close openslide handle: {}", exception.getMessage());
        }
    }

    private record SlideRuntime(
            String slideId,
            Path path,
            SlideMetadata metadata,
            Pointer handle
    ) {
    }

    public record SlideMetadata(
            String slideId,
            String fileName,
            int tileSize,
            int width,
            int height,
            String vendor,
            Map<String, String> properties,
            List<SlideLevel> levels,
            int minLevel,
            int maxLevel,
            PhysicalScale physicalScale
    ) {
        public SlideLevel level(int z) {
            if (z < 0 || z >= levels.size()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Zoom level is outside pyramid bounds");
            }
            return levels.get(z);
        }
    }

    public record SlideLevel(
            int z,
            int openslideLevel,
            int width,
            int height,
            double downsample,
            int tileWidth,
            int tileHeight,
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
    }

    interface OpenSlideNative extends Library {
        OpenSlideNative INSTANCE = Native.load("openslide", OpenSlideNative.class);

        Pointer openslide_open(String filename);

        void openslide_close(Pointer osr);

        String openslide_get_error(Pointer osr);

        int openslide_get_level_count(Pointer osr);

        void openslide_get_level_dimensions(Pointer osr, int level, long[] width, long[] height);

        double openslide_get_level_downsample(Pointer osr, int level);

        Pointer openslide_get_property_names(Pointer osr);

        String openslide_get_property_value(Pointer osr, String name);

        void openslide_read_region(Pointer osr, int[] dest, long x, long y, int level, long width, long height);
    }
}
