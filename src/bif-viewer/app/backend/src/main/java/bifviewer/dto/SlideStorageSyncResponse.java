package bifviewer.dto;

import java.util.List;

public record SlideStorageSyncResponse(
        int checked,
        int kept,
        int removed,
        int removedInboxItems,
        List<String> removedSlideIds
) {
}
