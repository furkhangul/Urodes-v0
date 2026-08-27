package bifviewer.dto;

public record DropzoneFileResponse(
        String fileName,
        long sizeBytes,
        String lastModified
) {
}
