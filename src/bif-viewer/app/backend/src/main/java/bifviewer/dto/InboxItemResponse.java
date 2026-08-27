package bifviewer.dto;

public record InboxItemResponse(
        String id,
        String originalName,
        long sizeBytes,
        String status,
        String assignedUserId,
        String assignedByUserId,
        String slideId,
        String errorMessage,
        String createdAt,
        String assignedAt,
        String processedAt
) {
}
