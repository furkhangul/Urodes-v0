package bifviewer.service;

import bifviewer.openslide.OpenSlideExperimentService;
import bifviewer.openslide.OpenSlideReaderService;
import org.springframework.stereotype.Service;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.List;
import java.util.function.ToIntFunction;

/**
 * Tüm slaytın düşük çözünürlüklü genel görünümünü (overview) üretir.
 * Viewer'da ısı haritası (hücre yoğunluğu) üretmek için kullanılır.
 */
@Service
public class SlideOverviewService {

    private final BifReaderService bifReaderService;
    private final OpenSlideExperimentService openSlideExperimentService;
    private final OpenSlideReaderService openSlideReaderService;

    public SlideOverviewService(
            BifReaderService bifReaderService,
            OpenSlideExperimentService openSlideExperimentService,
            OpenSlideReaderService openSlideReaderService
    ) {
        this.bifReaderService = bifReaderService;
        this.openSlideExperimentService = openSlideExperimentService;
        this.openSlideReaderService = openSlideReaderService;
    }

    public byte[] bifOverview(String slideId, int maxSize) throws IOException {
        BifReaderService.SlideMetadata metadata = bifReaderService.getSlideMetadata(slideId);
        BifReaderService.SlideLevel level = pickLevel(metadata.levels(), maxSize, l -> l.width());
        int tileSize = metadata.tileSize();
        BufferedImage stitched = stitch(
                level.width(),
                level.height(),
                level.tileColumns(),
                level.tileRows(),
                tileSize,
                (x, y) -> bifReaderService.readRegion(slideId, level.z(), x, y)
        );
        return encodeJpeg(scaleToFit(stitched, maxSize));
    }

    public byte[] openSlideOverview(String slideId, int maxSize) throws IOException {
        OpenSlideExperimentService.OpenSlideSessionView session = openSlideExperimentService.requireSession(slideId);
        OpenSlideReaderService.SlideMetadata metadata = session.metadata();
        OpenSlideReaderService.SlideLevel level = pickLevel(metadata.levels(), maxSize, l -> l.width());
        int tileSize = metadata.tileSize();
        BufferedImage stitched = stitch(
                level.width(),
                level.height(),
                level.tileColumns(),
                level.tileRows(),
                tileSize,
                (x, y) -> openSlideReaderService.readRegion(session, level.z(), x, y)
        );
        return encodeJpeg(scaleToFit(stitched, maxSize));
    }

    /**
     * Pyramit seviyeleri en küçükten en büyüğe sıralıdır. maxSize'a sığan en
     * yüksek çözünürlüklü seviye seçilir; hiçbiri sığmazsa en küçük seviye kullanılır.
     */
    private static <L> L pickLevel(List<L> levels, int maxSize, ToIntFunction<L> widthOf) {
        L best = levels.getFirst();
        for (L level : levels) {
            if (widthOf.applyAsInt(level) <= maxSize) {
                best = level;
            } else {
                break;
            }
        }
        return best;
    }

    private BufferedImage stitch(
            int width,
            int height,
            int tileColumns,
            int tileRows,
            int tileSize,
            TileReader reader
    ) {
        BufferedImage stitched = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = stitched.createGraphics();
        try {
            for (int y = 0; y < tileRows; y++) {
                for (int x = 0; x < tileColumns; x++) {
                    graphics.drawImage(reader.read(x, y), x * tileSize, y * tileSize, null);
                }
            }
        } finally {
            graphics.dispose();
        }
        return stitched;
    }

    private BufferedImage scaleToFit(BufferedImage image, int maxSize) {
        int width = image.getWidth();
        int height = image.getHeight();
        if (width <= maxSize && height <= maxSize) {
            return image;
        }
        double scale = Math.min((double) maxSize / width, (double) maxSize / height);
        int targetWidth = Math.max(1, (int) Math.round(width * scale));
        int targetHeight = Math.max(1, (int) Math.round(height * scale));
        BufferedImage scaled = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = scaled.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            graphics.drawImage(image, 0, 0, targetWidth, targetHeight, null);
        } finally {
            graphics.dispose();
        }
        return scaled;
    }

    private byte[] encodeJpeg(BufferedImage image) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(image.getWidth() * image.getHeight() / 4);
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
        if (!writers.hasNext()) {
            throw new IllegalStateException("No JPEG writer available");
        }
        ImageWriter writer = writers.next();
        try (MemoryCacheImageOutputStream stream = new MemoryCacheImageOutputStream(output)) {
            writer.setOutput(stream);
            ImageWriteParam params = writer.getDefaultWriteParam();
            if (params.canWriteCompressed()) {
                params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                params.setCompressionQuality(0.85f);
            }
            writer.write(null, new IIOImage(image, null, null), params);
        } finally {
            writer.dispose();
        }
        return output.toByteArray();
    }

    @FunctionalInterface
    private interface TileReader {
        BufferedImage read(int x, int y);
    }
}