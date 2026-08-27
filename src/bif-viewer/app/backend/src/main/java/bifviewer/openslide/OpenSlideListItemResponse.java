package bifviewer.openslide;

public record OpenSlideListItemResponse(
        String slideId,
        String fileName,
        long sizeBytes,
        String vendor
) {
}
