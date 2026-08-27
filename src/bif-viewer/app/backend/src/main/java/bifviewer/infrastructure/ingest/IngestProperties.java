package bifviewer.infrastructure.ingest;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@ConfigurationProperties(prefix = "bif.ingest")
public class IngestProperties {

    private boolean watchEnabled = true;
    private String inboxDir = "/app/inbox";
    private String dropzoneDir = "/app/dropzone";
    private long pollIntervalMs = 2000L;
    private int stabilityChecks = 2;
    private long stabilityMinAgeMs = 1500L;
    private long minSizeBytes = 1024L;
    private List<String> ignoredSuffixes = List.of(".tmp", ".part", ".crdownload", ".filepart");
    private CleanupPolicy cleanupPolicy = CleanupPolicy.DELETE;

    public boolean isWatchEnabled() {
        return watchEnabled;
    }

    public void setWatchEnabled(boolean watchEnabled) {
        this.watchEnabled = watchEnabled;
    }

    public String getInboxDir() {
        return inboxDir;
    }

    public void setInboxDir(String inboxDir) {
        this.inboxDir = inboxDir;
    }

    public String getDropzoneDir() {
        return dropzoneDir;
    }

    public void setDropzoneDir(String dropzoneDir) {
        this.dropzoneDir = dropzoneDir;
    }

    public long getPollIntervalMs() {
        return pollIntervalMs;
    }

    public void setPollIntervalMs(long pollIntervalMs) {
        this.pollIntervalMs = pollIntervalMs;
    }

    public int getStabilityChecks() {
        return stabilityChecks;
    }

    public void setStabilityChecks(int stabilityChecks) {
        this.stabilityChecks = stabilityChecks;
    }

    public long getStabilityMinAgeMs() {
        return stabilityMinAgeMs;
    }

    public void setStabilityMinAgeMs(long stabilityMinAgeMs) {
        this.stabilityMinAgeMs = stabilityMinAgeMs;
    }

    public long getMinSizeBytes() {
        return minSizeBytes;
    }

    public void setMinSizeBytes(long minSizeBytes) {
        this.minSizeBytes = minSizeBytes;
    }

    public List<String> getIgnoredSuffixes() {
        return ignoredSuffixes;
    }

    public void setIgnoredSuffixes(List<String> ignoredSuffixes) {
        this.ignoredSuffixes = ignoredSuffixes;
    }

    public CleanupPolicy getCleanupPolicy() {
        return cleanupPolicy;
    }

    public void setCleanupPolicy(CleanupPolicy cleanupPolicy) {
        this.cleanupPolicy = cleanupPolicy;
    }

    public enum CleanupPolicy {
        ARCHIVE,
        DELETE
    }
}
