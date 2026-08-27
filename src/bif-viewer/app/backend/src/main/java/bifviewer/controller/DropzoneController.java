package bifviewer.controller;

import bifviewer.dto.DropzoneFileResponse;
import bifviewer.service.DropzoneService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dropzone/files")
public class DropzoneController {

    private final DropzoneService dropzoneService;

    public DropzoneController(DropzoneService dropzoneService) {
        this.dropzoneService = dropzoneService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<DropzoneFileResponse> listFiles() {
        return dropzoneService.listFiles();
    }

    @PostMapping(value = "/{fileName}/import", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> importFile(@PathVariable String fileName) {
        return dropzoneService.importFile(fileName);
    }

    @DeleteMapping(value = "/{fileName}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> deleteFile(@PathVariable String fileName) {
        return dropzoneService.deleteFile(fileName);
    }
}
