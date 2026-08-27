package bifviewer.controller;

import bifviewer.dto.SlideListItemResponse;
import bifviewer.dto.SlideStorageSyncResponse;
import bifviewer.dto.SlideUploadResponse;
import bifviewer.service.BifReaderService;
import bifviewer.service.SlideApplicationService;
import bifviewer.service.SlideOverviewService;
import bifviewer.service.TileService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.springframework.http.HttpStatus.CREATED;

@RestController
@RequestMapping("/api/slides")
public class SlideController {

    private final SlideApplicationService slideApplicationService;
    private final BifReaderService bifReaderService;
    private final TileService tileService;
    private final SlideOverviewService slideOverviewService;

    public SlideController(
            SlideApplicationService slideApplicationService,
            BifReaderService bifReaderService,
            TileService tileService,
            SlideOverviewService slideOverviewService
    ) {
        this.slideApplicationService = slideApplicationService;
        this.bifReaderService = bifReaderService;
        this.tileService = tileService;
        this.slideOverviewService = slideOverviewService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<SlideListItemResponse> listSlides() {
        return slideApplicationService.listSlides();
    }

    @PostMapping(value = "/sync-storage", produces = MediaType.APPLICATION_JSON_VALUE)
    public SlideStorageSyncResponse syncStorage() {
        return slideApplicationService.syncStorage();
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(CREATED)
    public SlideUploadResponse uploadSlide(@RequestParam("file") MultipartFile file) {
        return slideApplicationService.upload(file);
    }

    @GetMapping(value = "/{slideId}/metadata", produces = MediaType.APPLICATION_JSON_VALUE)
    public BifReaderService.SlideMetadata getSlideMetadata(@PathVariable String slideId) {
        return bifReaderService.getSlideMetadata(slideId);
    }

    @GetMapping(value = "/{slideId}/overview", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<byte[]> getSlideOverview(
            @PathVariable String slideId,
            @RequestParam(value = "maxSize", defaultValue = "1600") int maxSize
    ) throws IOException {
        byte[] jpeg = slideOverviewService.bifOverview(slideId, maxSize);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(3600, TimeUnit.SECONDS).cachePublic())
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(jpeg.length))
                .body(jpeg);
    }

    @GetMapping(value = "/{slideId}/metadata/raw", produces = MediaType.APPLICATION_JSON_VALUE)
    public BifReaderService.RawMetadata getSlideRawMetadata(@PathVariable String slideId) {
        return bifReaderService.getRawMetadata(slideId);
    }

    @PostMapping(value = "/{slideId}/warmup", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> warmupSlide(
            @PathVariable String slideId,
            @RequestParam(value = "levels", defaultValue = "2") int levels
    ) {
        int submitted = tileService.warmupBaseline(slideId, levels);
        return Map.of(
                "slideId", slideId,
                "levels", levels,
                "tilesSubmitted", submitted
        );
    }

    @DeleteMapping(value = "/{slideId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> deleteSlide(@PathVariable String slideId) {
        slideApplicationService.deleteSlide(slideId);
        return Map.of(
                "slideId", slideId,
                "message", "Slide deleted"
        );
    }

    @DeleteMapping(value = "/{slideId}/cache", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> evictSlide(@PathVariable String slideId) {
        int cleared = tileService.invalidateSlide(slideId);
        return Map.of(
                "slideId", slideId,
                "cleared", cleared
        );
    }
}
