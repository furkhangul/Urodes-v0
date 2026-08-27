package bifviewer.controller;

import bifviewer.service.ArchiveService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/archive")
public class ArchiveController {

    private final ArchiveService archiveService;

    public ArchiveController(ArchiveService archiveService) {
        this.archiveService = archiveService;
    }

    /**
     * Bölgenin annotation listesini JsonLog/annotations.json içine yazar/günceller.
     * Her düzenlemede çağrılır, böylece dosya canlı kalır.
     */
    @PostMapping(
            value = "/{slideId}/region",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ObjectNode upsertRegion(
            @PathVariable String slideId,
            @RequestBody Map<String, Object> body
    ) {
        return archiveService.upsertRegion(slideId, body);
    }

    /** Kesit iptal edilince bölgeyi annotations.json'dan kaldırır. */
    @DeleteMapping(value = "/{slideId}/region/{regionId}")
    public void removeRegion(@PathVariable String slideId, @PathVariable String regionId) {
        archiveService.removeRegion(slideId, regionId);
    }

    /**
     * Model test tuşuna basıldığı anda kesilen bölgenin PNG görüntüsünü ImageLog'a yazar.
     * Gövde ham PNG baytlarıdır.
     */
    @PostMapping(
            value = "/{slideId}/region/{regionId}/image",
            consumes = { MediaType.IMAGE_PNG_VALUE, MediaType.APPLICATION_OCTET_STREAM_VALUE },
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public Map<String, String> saveRegionImage(
            @PathVariable String slideId,
            @PathVariable String regionId,
            @RequestBody byte[] image
    ) {
        return Map.of("path", archiveService.saveRegionImage(slideId, regionId, image));
    }

    /** Yapılan her değişikliğin okunabilir dökümünü TerminalLog'a yazar. */
    @PostMapping(value = "/{slideId}/terminal", consumes = MediaType.APPLICATION_JSON_VALUE)
    public void logTerminal(
            @PathVariable String slideId,
            @RequestParam(defaultValue = "update") String event,
            @RequestBody Map<String, Object> body
    ) {
        archiveService.logTerminal(
                slideId,
                event,
                String.valueOf(body.getOrDefault("message", "")),
                String.valueOf(body.getOrDefault("level", "INFO"))
        );
    }

    /** annotations.json'un tamamı — gün sonunda indirip kullanmak için. */
    @GetMapping(value = "/annotations", produces = MediaType.APPLICATION_JSON_VALUE)
    public JsonNode annotations() {
        return archiveService.readAll();
    }
}
