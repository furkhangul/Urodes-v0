package bifviewer.infrastructure.ingest;

import java.time.Instant;

public record ProcessingMarker(
        String originalName,
        State state,
        String slideId,
        Instant updatedAt
) {

    public enum State {
        CLAIMED,
        INGESTED
    }
}
