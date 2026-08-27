package bifviewer.openslide;

import bifviewer.domain.slide.SlideStatus;
import bifviewer.dto.SlideUploadResponse;
import bifviewer.infrastructure.persistence.AppUserEntity;
import bifviewer.infrastructure.persistence.SlideEntity;
import bifviewer.infrastructure.persistence.SlideRepository;
import bifviewer.infrastructure.storage.SlideStorage;
import bifviewer.service.SlideApplicationService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

@Service
public class OpenSlideExperimentService {

    private final OpenSlideReaderService openSlideReaderService;
    private final SlideRepository slideRepository;
    private final SlideStorage slideStorage;
    private final ObjectMapper objectMapper;
    private final SlideApplicationService slideApplicationService;
    private final bifviewer.service.AppUserService appUserService;

    public OpenSlideExperimentService(
            OpenSlideReaderService openSlideReaderService,
            SlideRepository slideRepository,
            SlideStorage slideStorage,
            ObjectMapper objectMapper,
            SlideApplicationService slideApplicationService,
            bifviewer.service.AppUserService appUserService
    ) {
        this.openSlideReaderService = openSlideReaderService;
        this.slideRepository = slideRepository;
        this.slideStorage = slideStorage;
        this.objectMapper = objectMapper;
        this.slideApplicationService = slideApplicationService;
        this.appUserService = appUserService;
    }

    @Transactional
    public List<OpenSlideListItemResponse> listSlides() {
        AppUserEntity currentUser = appUserService.currentUser();
        List<SlideEntity> slides = appUserService.isMaster(currentUser)
                ? slideRepository.findByStatusAndOpenslideStatusOrderByCreatedAtDesc(SlideStatus.READY, SlideStatus.READY)
                : slideRepository.findByStatusAndOpenslideStatusAndAssignedUserIdOrderByCreatedAtDesc(
                        SlideStatus.READY,
                        SlideStatus.READY,
                        currentUser.getId()
                );
        return slides.stream()
                .map(slide -> new OpenSlideListItemResponse(
                        slide.getId().toString(),
                        slide.getOriginalName(),
                        slide.getSizeBytes(),
                        slide.getOpenslideVendor()
                ))
                .toList();
    }

    public OpenSlideUploadResponse upload(MultipartFile file) {
        SlideUploadResponse response = slideApplicationService.upload(file);
        SlideEntity slide = getSlide(response.slideId());
        if (slide.getOpenslideStatus() != SlideStatus.READY) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    slide.getOpenslideError() == null ? "OpenSlide could not open uploaded slide" : slide.getOpenslideError()
            );
        }

        return new OpenSlideUploadResponse(
                "OpenSlide slide uploaded",
                response.slideId(),
                response.fileName(),
                response.sizeBytes(),
                slide.getOpenslideVendor()
        );
    }

    public OpenSlideReaderService.SlideMetadata getMetadata(String slideId) {
        return readMetadata(requireOpenSlideReady(slideId));
    }

    public OpenSlideSessionView requireSession(String slideId) {
        SlideEntity slide = requireOpenSlideReady(slideId);
        return new OpenSlideSessionView(
                slide.getId().toString(),
                slide.getOriginalName(),
                slideStorage.resolve(slide.getStoragePath()),
                slide.getSizeBytes(),
                readMetadata(slide)
        );
    }

    public boolean evict(String slideId) {
        return openSlideReaderService.closeSlide(slideId);
    }

    private SlideEntity requireOpenSlideReady(String slideId) {
        SlideEntity slide = getSlide(slideId);
        AppUserEntity currentUser = appUserService.currentUser();
        if (!appUserService.isMaster(currentUser)
                && (slide.getAssignedUserId() == null || !slide.getAssignedUserId().equals(currentUser.getId()))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId);
        }
        if (slide.getStatus() != SlideStatus.READY || slide.getOpenslideStatus() != SlideStatus.READY) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "OpenSlide reader is not available for slide: " + slideId
            );
        }
        return slide;
    }

    private SlideEntity getSlide(String slideId) {
        try {
            UUID id = UUID.fromString(slideId);
            return slideRepository.findById(id)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId));
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found: " + slideId, exception);
        }
    }

    private OpenSlideReaderService.SlideMetadata readMetadata(SlideEntity slide) {
        try {
            return objectMapper.readValue(slide.getOpenslideMetadata(), OpenSlideReaderService.SlideMetadata.class);
        } catch (JsonProcessingException exception) {
            throw new ResponseStatusException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Stored OpenSlide metadata could not be read",
                    exception
            );
        }
    }

    public record OpenSlideSessionView(
            String slideId,
            String fileName,
            Path path,
            long sizeBytes,
            OpenSlideReaderService.SlideMetadata metadata
    ) {
    }
}
