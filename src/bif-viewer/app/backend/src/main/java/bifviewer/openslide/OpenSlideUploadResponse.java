package bifviewer.openslide;

public record OpenSlideUploadResponse(
        String message,
        String slideId,
        String fileName,
        long sizeBytes,
        String vendor
) {
}
