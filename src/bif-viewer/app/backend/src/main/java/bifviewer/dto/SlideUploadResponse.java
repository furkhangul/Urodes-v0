package bifviewer.dto;

public record SlideUploadResponse(
        String message,
        String slideId,
        String fileName,
        long sizeBytes
) {
}
