package bifviewer.controller;

import bifviewer.model.TileRequest;
import bifviewer.service.TileService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/tiles")
public class TileController {

    private final TileService tileService;

    public TileController(TileService tileService) {
        this.tileService = tileService;
    }

    @GetMapping("/{slideId}/{z}/{x}/{y}")
    public ResponseEntity<byte[]> getTile(
            @PathVariable String slideId,
            @PathVariable int z,
            @PathVariable int x,
            @PathVariable int y
    ) {
        TileRequest request = new TileRequest(slideId, z, x, y);
        if (!request.isValid()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Tile coordinates are outside the dummy range");
        }

        byte[] jpeg = tileService.getTile(request);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(86400, TimeUnit.SECONDS).cachePublic().immutable())
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(jpeg.length))
                .body(jpeg);
    }
}
