package bifviewer.infrastructure.storage;

import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Path;
import java.util.UUID;

public interface SlideStorage {

    StoredSlideFile store(UUID slideId, UUID assignedUserId, MultipartFile file) throws IOException;

    StoredSlideFile store(UUID slideId, UUID assignedUserId, Path source, String originalName) throws IOException;

    void delete(Path storagePath) throws IOException;

    Path resolve(String storagePath);

    record StoredSlideFile(
            String originalName,
            String storedFilename,
            String extension,
            Path storagePath,
            long sizeBytes
    ) {
    }
}
