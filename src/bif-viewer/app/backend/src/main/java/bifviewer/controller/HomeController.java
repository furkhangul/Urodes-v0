package bifviewer.controller;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HomeController {

    @GetMapping(value = "/", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> home() {
        return Map.of(
                "name", "bif-viewer-backend",
                "status", "ok",
                "tileEndpoint", "/api/tiles/{slideId}/{z}/{x}/{y}",
                "metadataEndpoint", "/api/slides/{slideId}/metadata",
                "rawMetadataEndpoint", "/api/slides/{slideId}/metadata/raw",
                "metricsEndpoint", "/api/system/metrics"
        );
    }
}
