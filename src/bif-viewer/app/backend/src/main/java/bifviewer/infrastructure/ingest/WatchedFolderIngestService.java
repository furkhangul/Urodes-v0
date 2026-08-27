package bifviewer.infrastructure.ingest;

import bifviewer.domain.inbox.InboxItemStatus;
import bifviewer.infrastructure.persistence.InboxItemEntity;
import bifviewer.infrastructure.persistence.InboxItemRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

@Service
public class WatchedFolderIngestService {

    private static final Logger log = LoggerFactory.getLogger(WatchedFolderIngestService.class);

    private static final String PROCESSING_DIR = ".processing";
    private static final String PROCESSED_DIR = ".processed";
    private static final String FAILED_DIR = ".failed";
    private static final String MARKER_SUFFIX = ".ingest.json";

    private final InboxItemRepository inboxItemRepository;
    private final IngestProperties properties;
    private final ObjectMapper objectMapper;

    private final Path inbox;
    private final Path processingDir;
    private final Path processedDir;
    private final Path failedDir;

    private final Map<Path, StabilityProbe> probes = new ConcurrentHashMap<>();

    public WatchedFolderIngestService(
            InboxItemRepository inboxItemRepository,
            IngestProperties properties,
            ObjectMapper objectMapper
    ) throws IOException {
        this.inboxItemRepository = inboxItemRepository;
        this.properties = properties;
        this.objectMapper = objectMapper;

        this.inbox = Path.of(properties.getInboxDir()).toAbsolutePath().normalize();
        this.processingDir = inbox.resolve(PROCESSING_DIR);
        this.processedDir = inbox.resolve(PROCESSED_DIR);
        this.failedDir = inbox.resolve(FAILED_DIR);

        Files.createDirectories(this.inbox);
        Files.createDirectories(this.processingDir);
        Files.createDirectories(this.processedDir);
        Files.createDirectories(this.failedDir);
    }

    @PostConstruct
    void reconcileLeftovers() {
        if (!properties.isWatchEnabled()) {
            log.info("ingest watcher disabled (bif.ingest.watch-enabled=false)");
            return;
        }

        log.info("ingest watcher initialised inbox={} cleanupPolicy={} pollIntervalMs={}",
                inbox, properties.getCleanupPolicy(), properties.getPollIntervalMs());

        try (Stream<Path> stream = Files.list(processingDir)) {
            stream.filter(Files::isRegularFile)
                    .filter(path -> !isMarkerFile(path))
                    .forEach(this::reconcileProcessingFile);
        } catch (IOException exception) {
            log.warn("ingest watcher could not reconcile {}: {}", processingDir, exception.getMessage());
        }
    }

    @Scheduled(fixedDelayString = "${bif.ingest.poll-interval-ms:2000}")
    public void pollOnce() {
        if (!properties.isWatchEnabled()) {
            return;
        }

        Set<Path> currentInbox = new java.util.HashSet<>();
        try (Stream<Path> stream = Files.list(inbox)) {
            stream.filter(Files::isRegularFile)
                    .filter(this::isVisibleCandidate)
                    .forEach(path -> {
                        currentInbox.add(path);
                        evaluateCandidate(path);
                    });
        } catch (IOException exception) {
            log.warn("ingest watcher could not list inbox: {}", exception.getMessage());
            return;
        }

        probes.keySet().removeIf(key -> !currentInbox.contains(key));
    }

    private boolean isVisibleCandidate(Path file) {
        String name = file.getFileName().toString();
        if (name.startsWith(".")) {
            return false;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        for (String suffix : properties.getIgnoredSuffixes()) {
            if (lower.endsWith(suffix.toLowerCase(Locale.ROOT))) {
                return false;
            }
        }
        return true;
    }

    private void evaluateCandidate(Path file) {
        BasicFileAttributes attrs;
        try {
            attrs = Files.readAttributes(file, BasicFileAttributes.class);
        } catch (NoSuchFileException ignored) {
            probes.remove(file);
            return;
        } catch (IOException exception) {
            log.warn("ingest watcher attr read failed for {}: {}", file, exception.getMessage());
            return;
        }

        long size = attrs.size();
        long mtime = attrs.lastModifiedTime().toMillis();
        long ageMs = Instant.now().toEpochMilli() - mtime;

        if (size < properties.getMinSizeBytes()) {
            return;
        }
        if (ageMs < properties.getStabilityMinAgeMs()) {
            return;
        }

        StabilityProbe probe = probes.compute(file, (path, existing) -> {
            if (existing == null || existing.lastSize() != size || existing.lastMtime() != mtime) {
                return new StabilityProbe(size, mtime, 1);
            }
            return new StabilityProbe(size, mtime, existing.stableCount() + 1);
        });

        if (probe.stableCount() < properties.getStabilityChecks()) {
            return;
        }

        probes.remove(file);
        claimAndIngest(file);
    }

    private void claimAndIngest(Path source) {
        String originalName = source.getFileName().toString();
        Path claimed = uniqueTarget(processingDir, originalName);

        try {
            try {
                Files.move(source, claimed, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException notAtomic) {
                Files.move(source, claimed, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (NoSuchFileException ignored) {
            return;
        } catch (IOException exception) {
            log.warn("ingest watcher could not claim {}: {}", source, exception.getMessage());
            return;
        }

        try {
            log.info("ingest watcher claimed file={} size={}", originalName, sizeQuiet(claimed));
            registerPendingItem(claimed, originalName);
        } catch (RuntimeException exception) {
            log.warn("ingest watcher failed file={} reason={}", originalName, exception.getMessage());
            moveToFailed(claimed, originalName, exception);
        }
    }

    private void archiveOrDelete(Path claimed, String originalName) {
        if (properties.getCleanupPolicy() == IngestProperties.CleanupPolicy.DELETE) {
            try {
                Files.deleteIfExists(claimed);
                deleteMarker(claimed);
            } catch (IOException exception) {
                log.warn("ingest watcher could not delete {}: {}", claimed, exception.getMessage());
            }
            return;
        }

        Path archived = uniqueTarget(processedDir, originalName);
        try {
            Files.move(claimed, archived, StandardCopyOption.REPLACE_EXISTING);
            deleteMarker(claimed);
        } catch (IOException exception) {
            log.warn("ingest watcher could not archive {}: {}", claimed, exception.getMessage());
        }
    }

    private void moveToFailed(Path claimed, String originalName, Throwable cause) {
        Path failedTarget = uniqueTarget(failedDir, originalName);
        try {
            Files.move(claimed, failedTarget, StandardCopyOption.REPLACE_EXISTING);
            deleteMarker(claimed);
        } catch (IOException exception) {
            log.warn("ingest watcher could not move failed file {}: {}", claimed, exception.getMessage());
            return;
        }

        Path errorReport = failedTarget.resolveSibling(failedTarget.getFileName() + ".error.json");
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("timestamp", Instant.now().toString());
            payload.put("originalName", originalName);
            payload.put("reason", cause.getClass().getSimpleName());
            payload.put("message", cause.getMessage());
            payload.put("stackTrace", stackTrace(cause));
            Files.writeString(errorReport, objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(payload));
        } catch (IOException exception) {
            log.warn("ingest watcher could not write error report for {}: {}", failedTarget, exception.getMessage());
        }
    }

    private void reconcileProcessingFile(Path leftover) {
        String normalizedPath = leftover.toAbsolutePath().normalize().toString();
        if (inboxItemRepository.findByInboxPath(normalizedPath).isPresent()) {
            return;
        }
        moveBackToInbox(leftover);
    }

    private void registerPendingItem(Path claimed, String originalName) {
        String normalizedPath = claimed.toAbsolutePath().normalize().toString();
        if (inboxItemRepository.findByInboxPath(normalizedPath).isPresent()) {
            return;
        }

        InboxItemEntity item = new InboxItemEntity();
        item.setId(java.util.UUID.randomUUID());
        item.setOriginalName(originalName);
        item.setInboxPath(normalizedPath);
        item.setSizeBytes(sizeQuiet(claimed));
        item.setStatus(InboxItemStatus.PENDING);
        inboxItemRepository.save(item);
    }

    private void moveBackToInbox(Path leftover) {
        Path target = uniqueTarget(inbox, leftover.getFileName().toString());
        try {
            Files.move(leftover, target, StandardCopyOption.REPLACE_EXISTING);
            deleteMarker(leftover);
            log.info("ingest watcher reconciled leftover {} -> {}", leftover.getFileName(), target.getFileName());
        } catch (IOException exception) {
            log.warn("ingest watcher could not reconcile leftover {}: {}", leftover, exception.getMessage());
        }
    }

    private Path uniqueTarget(Path directory, String desiredName) {
        Path candidate = directory.resolve(desiredName);
        if (!Files.exists(candidate)) {
            return candidate;
        }

        String base = desiredName;
        String ext = "";
        int dotIndex = desiredName.lastIndexOf('.');
        if (dotIndex > 0) {
            base = desiredName.substring(0, dotIndex);
            ext = desiredName.substring(dotIndex);
        }

        long suffix = Instant.now().toEpochMilli();
        for (int attempt = 0; attempt < 10; attempt++) {
            Path next = directory.resolve(base + "-" + suffix + (attempt == 0 ? "" : "-" + attempt) + ext);
            if (!Files.exists(next)) {
                return next;
            }
        }
        return directory.resolve(base + "-" + Instant.now().toEpochMilli() + "-" + System.nanoTime() + ext);
    }

    private long sizeQuiet(Path path) {
        try {
            return Files.size(path);
        } catch (IOException exception) {
            return -1L;
        }
    }

    private static String stackTrace(Throwable cause) {
        if (cause == null) {
            return "";
        }
        StringWriter writer = new StringWriter();
        cause.printStackTrace(new PrintWriter(writer));
        return writer.toString();
    }

    private boolean isMarkerFile(Path path) {
        return path.getFileName().toString().endsWith(MARKER_SUFFIX);
    }

    private Path markerPath(Path claimed) {
        return claimed.resolveSibling(claimed.getFileName() + MARKER_SUFFIX);
    }

    private ProcessingMarker readMarker(Path claimed) {
        Path markerPath = markerPath(claimed);
        if (!Files.isRegularFile(markerPath)) {
            return null;
        }

        try {
            return objectMapper.readValue(markerPath.toFile(), ProcessingMarker.class);
        } catch (IOException exception) {
            log.warn("ingest watcher could not read marker {}: {}", markerPath, exception.getMessage());
            return null;
        }
    }

    private void writeMarker(Path claimed, ProcessingMarker marker) {
        Path markerPath = markerPath(claimed);
        try {
            Files.writeString(
                    markerPath,
                    objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(marker)
            );
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to write ingest marker for " + claimed, exception);
        }
    }

    private void deleteMarker(Path claimed) {
        Path markerPath = markerPath(claimed);
        try {
            Files.deleteIfExists(markerPath);
        } catch (IOException exception) {
            log.warn("ingest watcher could not delete marker {}: {}", markerPath, exception.getMessage());
        }
    }

    Path inbox() {
        return inbox;
    }

    Path processingDir() {
        return processingDir;
    }

    Path processedDir() {
        return processedDir;
    }

    Path failedDir() {
        return failedDir;
    }

    Map<Path, StabilityProbe> probesView() {
        return Map.copyOf(probes);
    }

    List<String> ignoredSuffixes() {
        return List.copyOf(properties.getIgnoredSuffixes());
    }
}
