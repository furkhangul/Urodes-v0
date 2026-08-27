package bifviewer.openslide;

import bifviewer.service.SlideOverviewService;
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
@RequestMapping("/api/openslide")
public class OpenSlideExperimentController {

    private final OpenSlideExperimentService openSlideExperimentService;
    private final OpenSlideTileService openSlideTileService;
    private final SlideOverviewService slideOverviewService;

    public OpenSlideExperimentController(
            OpenSlideExperimentService openSlideExperimentService,
            OpenSlideTileService openSlideTileService,
            SlideOverviewService slideOverviewService
    ) {
        this.openSlideExperimentService = openSlideExperimentService;
        this.openSlideTileService = openSlideTileService;
        this.slideOverviewService = slideOverviewService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<OpenSlideListItemResponse> listSlides() {
        return openSlideExperimentService.listSlides();
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(CREATED)
    public OpenSlideUploadResponse uploadSlide(@RequestParam("file") MultipartFile file) {
        return openSlideExperimentService.upload(file);
    }

    @GetMapping(value = "/{slideId}/metadata", produces = MediaType.APPLICATION_JSON_VALUE)
    public OpenSlideReaderService.SlideMetadata getSlideMetadata(@PathVariable String slideId) {
        return openSlideExperimentService.getMetadata(slideId);
    }

    @GetMapping(value = "/{slideId}/metadata/raw", produces = MediaType.APPLICATION_JSON_VALUE)
    public OpenSlideReaderService.SlideMetadata getSlideRawMetadata(@PathVariable String slideId) {
        return openSlideExperimentService.getMetadata(slideId);
    }

    @GetMapping(value = "/{slideId}/overview", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<byte[]> getSlideOverview(
            @PathVariable String slideId,
            @RequestParam(value = "maxSize", defaultValue = "1600") int maxSize
    ) throws IOException {
        byte[] jpeg = slideOverviewService.openSlideOverview(slideId, maxSize);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(3600, TimeUnit.SECONDS).cachePublic())
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(jpeg.length))
                .body(jpeg);
    }

    @GetMapping(value = "/tiles/{slideId}/{z}/{x}/{y}")
    public ResponseEntity<byte[]> getTile(
            @PathVariable String slideId,
            @PathVariable int z,
            @PathVariable int x,
            @PathVariable int y
    ) {
        byte[] jpeg = openSlideTileService.getTile(slideId, z, x, y);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(3600, TimeUnit.SECONDS).cachePublic())
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(jpeg.length))
                .body(jpeg);
    }

    @DeleteMapping(value = "/{slideId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> evictSlide(@PathVariable String slideId) {
        int cleared = openSlideTileService.invalidateSlide(slideId);
        return Map.of(
                "slideId", slideId,
                "cleared", cleared
        );
    }
}
