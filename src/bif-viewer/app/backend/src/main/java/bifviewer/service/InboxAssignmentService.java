package bifviewer.service;

import bifviewer.domain.inbox.InboxItemStatus;
import bifviewer.domain.slide.IngestSource;
import bifviewer.domain.user.AppRole;
import bifviewer.dto.InboxItemResponse;
import bifviewer.dto.SlideUploadResponse;
import bifviewer.infrastructure.ingest.IngestProperties;
import bifviewer.infrastructure.persistence.AppUserEntity;
import bifviewer.infrastructure.persistence.InboxItemEntity;
import bifviewer.infrastructure.persistence.InboxItemRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class InboxAssignmentService {

    private final InboxItemRepository inboxItemRepository;
    private final AppUserService appUserService;
    private final SlideApplicationService slideApplicationService;
    private final IngestProperties ingestProperties;

    public InboxAssignmentService(
            InboxItemRepository inboxItemRepository,
            AppUserService appUserService,
            SlideApplicationService slideApplicationService,
            IngestProperties ingestProperties
    ) {
        this.inboxItemRepository = inboxItemRepository;
        this.appUserService = appUserService;
        this.slideApplicationService = slideApplicationService;
        this.ingestProperties = ingestProperties;
    }

    @Transactional(readOnly = true)
    public List<InboxItemResponse> listItems() {
        return inboxItemRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(this::toResponse)
                .toList();
    }


    @Transactional
    public void deleteItem(UUID inboxItemId) {
        AppUserEntity currentUser = appUserService.currentUser();
        if (!appUserService.isMaster(currentUser)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only master users can delete inbox items");
        }

        InboxItemEntity item = inboxItemRepository.findById(inboxItemId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Inbox item not found"));
        if (item.getStatus() == InboxItemStatus.PROCESSING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Processing inbox item cannot be deleted");
        }
        if (item.getStatus() == InboxItemStatus.INGESTED && item.getSlideId() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ingested inbox item has a slide; delete the slide instead");
        }

        deleteSourceQuietly(item.getInboxPath());
        inboxItemRepository.delete(item);
    }

    public InboxItemResponse assignAndIngest(UUID inboxItemId, UUID assignedUserId) {
        AppUserEntity master = appUserService.currentUser();
        AppUserEntity assignedUser = appUserService.requireUser(assignedUserId);
        return assignAndIngest(inboxItemId, master, assignedUser);
    }

    public InboxItemResponse assignAndIngestByKeycloakId(UUID inboxItemId, String keycloakId) {
        AppUserEntity master = appUserService.currentUser();
        AppUserEntity assignedUser = appUserService.requireOrCreateViewerByKeycloakId(keycloakId);
        return assignAndIngest(inboxItemId, master, assignedUser);
    }

    private InboxItemResponse assignAndIngest(UUID inboxItemId, AppUserEntity master, AppUserEntity assignedUser) {
        if (assignedUser.getRole() != AppRole.VIEWER) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Inbox item can only be assigned to a viewer");
        }

        InboxItemEntity item = inboxItemRepository.findById(inboxItemId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Inbox item not found"));
        if (item.getStatus() == InboxItemStatus.INGESTED) {
            return toResponse(item);
        }
        if (item.getStatus() == InboxItemStatus.PROCESSING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Inbox item is already processing");
        }

        OffsetDateTime assignedAt = OffsetDateTime.now();
        item.setStatus(InboxItemStatus.PROCESSING);
        item.setAssignedUserId(assignedUser.getId());
        item.setAssignedByUserId(master.getId());
        item.setAssignedAt(assignedAt);
        item.setErrorMessage(null);
        inboxItemRepository.saveAndFlush(item);

        Path source = Path.of(item.getInboxPath()).toAbsolutePath().normalize();
        try {
            SlideUploadResponse response = slideApplicationService.ingestFromPath(
                    source,
                    item.getOriginalName(),
                    IngestSource.WATCH_FOLDER,
                    assignedUser.getId(),
                    master.getId()
            );
            item.setSlideId(UUID.fromString(response.slideId()));
            item.setStatus(InboxItemStatus.INGESTED);
            item.setProcessedAt(OffsetDateTime.now());
            cleanupProcessedSource(source, item.getOriginalName());
        } catch (RuntimeException exception) {
            item.setStatus(InboxItemStatus.FAILED);
            item.setErrorMessage(exception.getMessage());
            item.setProcessedAt(OffsetDateTime.now());
            moveFailedSource(source);
        }

        return toResponse(inboxItemRepository.save(item));
    }

    private void cleanupProcessedSource(Path source, String originalName) {
        try {
            if (ingestProperties.getCleanupPolicy() == IngestProperties.CleanupPolicy.DELETE) {
                Files.deleteIfExists(source);
                return;
            }
            Path processedDir = Path.of(ingestProperties.getInboxDir()).toAbsolutePath().normalize().resolve(".processed");
            Files.createDirectories(processedDir);
            Files.move(source, uniqueTarget(processedDir, originalName), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException exception) {
            // The DB already records the successful ingest; cleanup can be retried manually if needed.
        }
    }

    private void deleteSourceQuietly(String sourcePath) {
        if (sourcePath == null || sourcePath.isBlank()) {
            return;
        }
        try {
            Files.deleteIfExists(Path.of(sourcePath).toAbsolutePath().normalize());
        } catch (IOException ignored) {
            // DB cleanup is more important than a best-effort file delete here.
        }
    }

    private void moveFailedSource(Path source) {
        try {
            if (!Files.exists(source)) {
                return;
            }
            Path failedDir = Path.of(ingestProperties.getInboxDir()).toAbsolutePath().normalize().resolve(".failed");
            Files.createDirectories(failedDir);
            Files.move(source, uniqueTarget(failedDir, source.getFileName().toString()), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException exception) {
            // Keep the failed state in DB even if the source file cannot be moved.
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

        return directory.resolve(base + "-" + System.currentTimeMillis() + ext);
    }

    private InboxItemResponse toResponse(InboxItemEntity item) {
        return new InboxItemResponse(
                item.getId().toString(),
                item.getOriginalName(),
                item.getSizeBytes(),
                item.getStatus().name(),
                item.getAssignedUserId() == null ? null : item.getAssignedUserId().toString(),
                item.getAssignedByUserId() == null ? null : item.getAssignedByUserId().toString(),
                item.getSlideId() == null ? null : item.getSlideId().toString(),
                item.getErrorMessage(),
                item.getCreatedAt() == null ? null : item.getCreatedAt().toString(),
                item.getAssignedAt() == null ? null : item.getAssignedAt().toString(),
                item.getProcessedAt() == null ? null : item.getProcessedAt().toString()
        );
    }
}
