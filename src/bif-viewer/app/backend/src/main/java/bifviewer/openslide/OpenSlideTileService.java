package bifviewer.openslide;

import jakarta.annotation.PreDestroy;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class OpenSlideTileService {

    private final OpenSlideExperimentService openSlideExperimentService;
    private final OpenSlideReaderService openSlideReaderService;
    private final OpenSlideCacheManager openSlideCacheManager;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final ConcurrentHashMap<String, CompletableFuture<byte[]>> inFlightTiles = new ConcurrentHashMap<>();

    public OpenSlideTileService(
            OpenSlideExperimentService openSlideExperimentService,
            OpenSlideReaderService openSlideReaderService,
            OpenSlideCacheManager openSlideCacheManager
    ) {
        this.openSlideExperimentService = openSlideExperimentService;
        this.openSlideReaderService = openSlideReaderService;
        this.openSlideCacheManager = openSlideCacheManager;
    }

    public byte[] getTile(String slideId, int z, int x, int y) {
        String cacheKey = openSlideCacheManager.cacheKey(slideId, z, x, y);
        byte[] cachedTile = openSlideCacheManager.get(cacheKey);
        if (cachedTile != null) {
            return cachedTile;
        }

        CompletableFuture<byte[]> inFlight = new CompletableFuture<>();
        CompletableFuture<byte[]> existing = inFlightTiles.putIfAbsent(cacheKey, inFlight);
        if (existing != null) {
            return await(existing);
        }

        try {
            OpenSlideExperimentService.OpenSlideSessionView session = openSlideExperimentService.requireSession(slideId);
            byte[] encodedTile = executor.submit(() -> encodeJpeg(openSlideReaderService.readRegion(session, z, x, y))).get();
            openSlideCacheManager.put(cacheKey, encodedTile);
            inFlight.complete(encodedTile);
            return encodedTile;
        } catch (Throwable exception) {
            inFlight.completeExceptionally(exception);
            throw unwrap(exception);
        } finally {
            inFlightTiles.remove(cacheKey, inFlight);
        }
    }

    public int getInFlightTileCount() {
        return inFlightTiles.size();
    }

    public OpenSlideCacheManager.CacheMetrics cacheSnapshot() {
        return openSlideCacheManager.snapshot();
    }

    public long estimatedCacheBytes() {
        return openSlideCacheManager.estimatedBytes();
    }

    public int invalidateSlide(String slideId) {
        int cacheCleared = openSlideCacheManager.invalidateSlide(slideId);
        String prefix = slideId + ":";
        int inflightCleared = 0;
        var iterator = inFlightTiles.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            if (entry.getKey().startsWith(prefix)) {
                entry.getValue().cancel(true);
                iterator.remove();
                inflightCleared++;
            }
        }
        boolean runtimeClosed = openSlideReaderService.closeSlide(slideId);
        forceFullGc();
        return cacheCleared + inflightCleared + (runtimeClosed ? 1 : 0);
    }

    private void forceFullGc() {
        System.gc();
        try {
            Thread.sleep(150);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return;
        }
        System.gc();
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
    }

    private byte[] encodeJpeg(BufferedImage image) throws IOException {
        BufferedImage bgrImage;
        if (image.getType() == BufferedImage.TYPE_3BYTE_BGR) {
            bgrImage = image;
        } else {
            bgrImage = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_3BYTE_BGR);
            Graphics2D graphics = bgrImage.createGraphics();
            try {
                graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                graphics.drawImage(image, 0, 0, null);
            } finally {
                graphics.dispose();
            }
        }

        ByteArrayOutputStream output = new ByteArrayOutputStream(bgrImage.getWidth() * bgrImage.getHeight() / 4);
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
            writer.write(null, new IIOImage(bgrImage, null, null), params);
        } finally {
            writer.dispose();
        }
        return output.toByteArray();
    }

    private byte[] await(CompletableFuture<byte[]> future) {
        try {
            return future.get();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Tile generation interrupted", exception);
        } catch (ExecutionException exception) {
            throw unwrap(exception);
        }
    }

    private RuntimeException unwrap(ExecutionException exception) {
        Throwable cause = exception.getCause();
        if (cause instanceof RuntimeException runtimeException) {
            return runtimeException;
        }
        return new IllegalStateException("Failed to generate tile", cause);
    }

    private RuntimeException unwrap(Throwable exception) {
        if (exception instanceof RuntimeException runtimeException) {
            return runtimeException;
        }
        if (exception instanceof InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
            return new IllegalStateException("Tile generation interrupted", interruptedException);
        }
        if (exception instanceof ExecutionException executionException) {
            return unwrap(executionException);
        }
        return new IllegalStateException("Failed to generate tile", exception);
    }
}
