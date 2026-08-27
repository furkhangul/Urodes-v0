package bifviewer.service;

import bifviewer.domain.slide.IngestSource;
import bifviewer.domain.slide.SlideStatus;
import bifviewer.dto.SlideListItemResponse;
import bifviewer.dto.SlideStorageSyncResponse;
import bifviewer.dto.SlideUploadResponse;
import bifviewer.infrastructure.persistence.AppUserEntity;
import bifviewer.infrastructure.format.SlideFormatHandler;
import bifviewer.domain.inbox.InboxItemStatus;
import bifviewer.infrastructure.persistence.InboxItemEntity;
import bifviewer.infrastructure.persistence.InboxItemRepository;
import bifviewer.infrastructure.persistence.SlideEntity;
import bifviewer.infrastructure.persistence.SlideRecordWriter;
import bifviewer.infrastructure.persistence.SlideRepository;
import bifviewer.infrastructure.storage.SlideStorage;
import bifviewer.openslide.OpenSlideReaderService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class SlideApplicationService {

    private static final Logger log = LoggerFactory.getLogger(SlideApplicationService.class);

    private final SlideRepository slideRepository;
    private final SlideStorage slideStorage;
    private final List<SlideFormatHandler> formatHandlers;
    private final ObjectMapper objectMapper;
    private final SlideRecordWriter slideRecordWriter;
    private final OpenSlideReaderService openSlideReaderService;
    private final BifReaderService bifReaderService;
    private final AppUserService appUserService;
    private final InboxItemRepository inboxItemRepository;

    public SlideApplicationService(
            SlideRepository slideRepository,
            SlideStorage slideStorage,
            List<SlideFormatHandler> formatHandlers,
            ObjectMapper objectMapper,
            SlideRecordWriter slideRecordWriter,
            OpenSlideReaderService openSlideReaderService,
            BifReaderService bifReaderService,
            AppUserService appUserService,
            InboxItemRepository inboxItemRepository
    ) {
        this.slideRepository = slideRepository;
        this.slideStorage = slideStorage;
        this.formatHandlers = formatHandlers;
        this.objectMapper = objectMapper;
        this.slideRecordWriter = slideRecordWriter;
        this.openSlideReaderService = openSlideReaderService;
        this.bifReaderService = bifReaderService;
        this.appUserService = appUserService;
        this.inboxItemRepository = inboxItemRepository;
    }

    @Transactional
    public List<SlideListItemResponse> listSlides() {
        AppUserEntity currentUser = appUserService.currentUser();
        List<SlideEntity> slides = appUserService.isMaster(currentUser)
                ? slideRepository.findByStatusAndBioformatsStatusOrderByCreatedAtDesc(SlideStatus.READY, SlideStatus.READY)
                : slideRepository.findByStatusAndBioformatsStatusAndAssignedUserIdOrderByCreatedAtDesc(
                        SlideStatus.READY,
                        SlideStatus.READY,
                        currentUser.getId()
                );
        return slides.stream()
                .map(slide -> new SlideListItemResponse(
                        slide.getId().toString(),
                        slide.getOriginalName(),
                        slide.getSizeBytes(),
                        slide.getFormat().name(),
                        slide.getStatus().name()
                ))
                .toList();
    }


    @Transactional
    public void deleteSlide(String slideIdText) {
        AppUserEntity currentUser = appUserService.currentUser();
        if (!appUserService.isMaster(currentUser)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only master users can delete slides");
        }

        UUID slideId;
        try {
            slideId = UUID.fromString(slideIdText);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid slide id", exception);
        }

        SlideEntity slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found"));

        Path storagePath = slideStorage.resolve(slide.getStoragePath());
        openSlideReaderService.closeSlide(slideId.toString());
        bifReaderService.closeSlide(slideId.toString());
        inboxItemRepository.deleteBySlideId(slideId);
        slideRepository.delete(slide);

        try {
            slideStorage.delete(storagePath);
            cleanupEmptyParents(storagePath);
        } catch (IOException exception) {
            log.warn("Slide file could not be deleted slideId={} path={} reason={}", slideId, storagePath, exception.getMessage());
        }
    }

    private void cleanupEmptyParents(Path storagePath) {
        Path root = Path.of("/app/slides").toAbsolutePath().normalize();
        Path parent = storagePath.toAbsolutePath().normalize().getParent();
        while (parent != null && parent.startsWith(root) && !parent.equals(root)) {
            try {
                Files.delete(parent);
                parent = parent.getParent();
            } catch (IOException ignored) {
                return;
            }
        }
    }

    @Transactional
    public SlideStorageSyncResponse syncStorage() {
        AppUserEntity currentUser = appUserService.currentUser();
        if (!appUserService.isMaster(currentUser)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only master users can sync slide storage");
        }

        List<SlideEntity> slides = slideRepository.findAll();
        List<String> removedSlideIds = new ArrayList<>();

        for (SlideEntity slide : slides) {
            UUID slideId = slide.getId();
            Path storagePath;
            try {
                storagePath = slideStorage.resolve(slide.getStoragePath());
            } catch (RuntimeException exception) {
                removeMissingSlide(slide, removedSlideIds);
                continue;
            }

            if (!Files.isRegularFile(storagePath)) {
                removeMissingSlide(slide, removedSlideIds);
                continue;
            }
        }

        int removed = removedSlideIds.size();
        int removedInboxItems = removeOrphanedIngestedInboxItems();
        return new SlideStorageSyncResponse(
                slides.size(),
                slides.size() - removed,
                removed,
                removedInboxItems,
                removedSlideIds
        );
    }

    private void removeMissingSlide(SlideEntity slide, List<String> removedSlideIds) {
        UUID slideId = slide.getId();
        int removedInboxItems = inboxItemRepository.deleteBySlideId(slideId);
        openSlideReaderService.closeSlide(slideId.toString());
        slideRepository.delete(slide);
        removedSlideIds.add(slideId.toString());
        log.info("removed stale slide record slideId={} source={} storagePath={} removedInboxItems={}",
                slideId, slide.getOriginalName(), slide.getStoragePath(), removedInboxItems);
    }

    private int removeOrphanedIngestedInboxItems() {
        int removed = 0;
        List<InboxItemEntity> ingestedItems = inboxItemRepository.findByStatusOrderByCreatedAtDesc(InboxItemStatus.INGESTED);
        for (InboxItemEntity item : ingestedItems) {
            UUID slideId = item.getSlideId();
            if (slideId != null && slideRepository.existsById(slideId)) {
                continue;
            }

            inboxItemRepository.delete(item);
            removed++;
            log.info("removed orphaned ingested inbox item inboxItemId={} source={} slideId={}",
                    item.getId(), item.getOriginalName(), slideId);
        }
        return removed;
    }

    @Transactional
    public SlideUploadResponse upload(MultipartFile file) {
        AppUserEntity currentUser = appUserService.currentUser();
        String originalName = file.getOriginalFilename();
        resolveFormatHandler(extensionOf(originalName));

        UUID slideId = UUID.randomUUID();
        SlideStorage.StoredSlideFile storedFile;
        try {
            storedFile = slideStorage.store(slideId, currentUser.getId(), file);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to store uploaded slide", exception);
        }

        return persistStoredSlide(slideId, storedFile, IngestSource.UPLOAD, originalName, currentUser.getId(), currentUser.getId());
    }

    @Transactional
    public SlideUploadResponse ingestFromPath(Path source, String originalName, IngestSource ingestSource) {
        return ingestFromPath(source, originalName, ingestSource, null, null);
    }

    @Transactional
    public SlideUploadResponse ingestFromPath(
            Path source,
            String originalName,
            IngestSource ingestSource,
            UUID assignedUserId,
            UUID assignedByUserId
    ) {
        resolveFormatHandler(extensionOf(originalName));

        UUID slideId = UUID.randomUUID();
        SlideStorage.StoredSlideFile storedFile;
        try {
            storedFile = slideStorage.store(slideId, assignedUserId, source, originalName);
        } catch (IllegalArgumentException exception) {
            throw new IngestRejectedException(exception.getMessage(), exception);
        } catch (IOException exception) {
            throw new IngestFailedException("Failed to store ingested slide", exception);
        }

        return persistStoredSlide(slideId, storedFile, ingestSource, originalName, assignedUserId, assignedByUserId);
    }

    private SlideUploadResponse persistStoredSlide(
            UUID slideId,
            SlideStorage.StoredSlideFile storedFile,
            IngestSource ingestSource,
            String sourceFilename,
            UUID assignedUserId,
            UUID assignedByUserId
    ) {
        try {
            return persistSlide(slideId, storedFile, ingestSource, sourceFilename, assignedUserId, assignedByUserId);
        } catch (RuntimeException exception) {
            cleanupStoredFileQuietly(storedFile.storagePath(), slideId, sourceFilename, exception);
            throw exception;
        }
    }

    private SlideUploadResponse persistSlide(
            UUID slideId,
            SlideStorage.StoredSlideFile storedFile,
            IngestSource ingestSource,
            String sourceFilename,
            UUID assignedUserId,
            UUID assignedByUserId
    ) {
        SlideFormatHandler handler = resolveFormatHandler(storedFile.extension());
        OffsetDateTime now = OffsetDateTime.now();
        ReaderProbe bioformats = probeBioformats(slideId, storedFile, handler);
        ReaderProbe openslide = probeOpenSlide(slideId, storedFile);
        boolean ready = bioformats.ready() || openslide.ready();
        if (!ready) {
            throw new IngestRejectedException(
                    "Slide could not be opened by Bio-Formats or OpenSlide",
                    bioformats.failure() == null ? openslide.failure() : bioformats.failure()
            );
        }

        String metadataJson = bioformats.ready() ? bioformats.metadataJson() : openslide.metadataJson();

        slideRecordWriter.insertSlide(
                slideId,
                storedFile,
                handler.format(),
                SlideStatus.READY,
                metadataJson,
                ingestSource,
                sourceFilename,
                bioformats.status(),
                bioformats.metadataJson(),
                bioformats.errorMessage(),
                openslide.status(),
                openslide.metadataJson(),
                openslide.errorMessage(),
                openslide.vendor(),
                assignedUserId,
                assignedByUserId,
                assignedUserId == null ? null : now,
                now
        );

        return new SlideUploadResponse(
                "Slide uploaded",
                slideId.toString(),
                storedFile.originalName(),
                storedFile.sizeBytes()
        );
    }

    private ReaderProbe probeBioformats(
            UUID slideId,
            SlideStorage.StoredSlideFile storedFile,
            SlideFormatHandler handler
    ) {
        try {
            String metadataJson = toJson(handler.extractMetadata(slideId.toString(), storedFile.storagePath()));
            return ReaderProbe.ready(metadataJson, null);
        } catch (RuntimeException exception) {
            return ReaderProbe.failed(exception);
        }
    }

    private ReaderProbe probeOpenSlide(UUID slideId, SlideStorage.StoredSlideFile storedFile) {
        try {
            OpenSlideReaderService.SlideMetadata metadata = openSlideReaderService.inspect(
                    storedFile.storagePath(),
                    slideId.toString(),
                    storedFile.originalName()
            );
            return ReaderProbe.ready(toJson(metadata), metadata.vendor());
        } catch (RuntimeException exception) {
            return ReaderProbe.failed(exception);
        }
    }

    private SlideFormatHandler resolveFormatHandler(String extension) {
        return formatHandlers.stream()
                .filter(handler -> handler.supports(extension))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported slide extension: " + extension));
    }

    private String toJson(Object metadata) {
        try {
            return objectMapper.writeValueAsString(metadata);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize slide metadata", exception);
        }
    }

    private void cleanupStoredFileQuietly(Path storagePath, UUID slideId, String sourceFilename, RuntimeException originalException) {
        try {
            slideStorage.delete(storagePath);
        } catch (IOException cleanupException) {
            originalException.addSuppressed(cleanupException);
            log.warn("Failed to clean stored slide file slideId={} source={} path={} after ingest failure",
                    slideId, sourceFilename, storagePath, cleanupException);
        }
    }

    private String extensionOf(String originalName) {
        if (originalName == null) {
            return "";
        }
        int dotIndex = originalName.lastIndexOf('.');
        return dotIndex > -1 && dotIndex < originalName.length() - 1
                ? originalName.substring(dotIndex + 1)
                : "";
    }

    public static class IngestRejectedException extends RuntimeException {
        public IngestRejectedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class IngestFailedException extends RuntimeException {
        public IngestFailedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private record ReaderProbe(
            SlideStatus status,
            String metadataJson,
            String errorMessage,
            String vendor,
            RuntimeException failure
    ) {
        static ReaderProbe ready(String metadataJson, String vendor) {
            return new ReaderProbe(SlideStatus.READY, metadataJson, null, vendor, null);
        }

        static ReaderProbe failed(RuntimeException exception) {
            return new ReaderProbe(SlideStatus.FAILED, "{}", exception.getMessage(), null, exception);
        }

        boolean ready() {
            return status == SlideStatus.READY;
        }
    }
}
