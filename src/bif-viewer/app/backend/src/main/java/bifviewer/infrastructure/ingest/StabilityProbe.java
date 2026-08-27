package bifviewer.infrastructure.ingest;

public record StabilityProbe(long lastSize, long lastMtime, int stableCount) {
}
