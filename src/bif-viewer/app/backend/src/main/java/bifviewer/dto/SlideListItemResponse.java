package bifviewer.dto;

public record SlideListItemResponse(
        String slideId,
        String fileName,
        long sizeBytes,
        String format,
        String status
) {
}
