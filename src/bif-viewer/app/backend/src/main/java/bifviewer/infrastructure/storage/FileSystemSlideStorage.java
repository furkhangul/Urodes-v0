package bifviewer.infrastructure.storage;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.util.UUID;

@Component
public class FileSystemSlideStorage implements SlideStorage {

    private final Path slidesDirectory;

    public FileSystemSlideStorage(@Value("${bif.slides-dir}") String slidesDirectory) throws IOException {
        this.slidesDirectory = Path.of(slidesDirectory).toAbsolutePath().normalize();
        Files.createDirectories(this.slidesDirectory);
    }

    @Override
    public StoredSlideFile store(UUID slideId, UUID assignedUserId, MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("Uploaded file is empty");
        }

        String originalName = sanitizeOriginalName(file.getOriginalFilename());
        StorageTarget target = prepareTarget(slideId, assignedUserId, originalName);

        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, target.path(), StandardCopyOption.REPLACE_EXISTING);
        }

        return new StoredSlideFile(
                originalName,
                target.storedFilename(),
                target.extension(),
                target.path(),
                Files.size(target.path())
        );
    }

    @Override
    public StoredSlideFile store(UUID slideId, UUID assignedUserId, Path source, String originalName) throws IOException {
        if (!Files.isRegularFile(source)) {
            throw new IllegalArgumentException("Source file does not exist: " + source);
        }
        if (Files.size(source) == 0L) {
            throw new IllegalArgumentException("Source file is empty: " + source);
        }

        String cleanName = sanitizeOriginalName(originalName);
        StorageTarget target = prepareTarget(slideId, assignedUserId, cleanName);

        Files.copy(source, target.path(), StandardCopyOption.REPLACE_EXISTING);

        return new StoredSlideFile(
                cleanName,
                target.storedFilename(),
                target.extension(),
                target.path(),
                Files.size(target.path())
        );
    }

    @Override
    public void delete(Path storagePath) throws IOException {
        Path resolved = storagePath.toAbsolutePath().normalize();
        if (!resolved.startsWith(slidesDirectory)) {
            throw new IllegalArgumentException("Invalid storage path");
        }
        Files.deleteIfExists(resolved);
    }

    @Override
    public Path resolve(String storagePath) {
        Path path = Path.of(storagePath).toAbsolutePath().normalize();
        if (!path.startsWith(slidesDirectory)) {
            throw new IllegalArgumentException("Invalid storage path");
        }
        return path;
    }

    private StorageTarget prepareTarget(UUID slideId, UUID assignedUserId, String originalName) throws IOException {
        String extension = extractExtension(originalName);
        LocalDate date = LocalDate.now();
        Path targetDirectory = slidesDirectory
                .resolve(storageOwnerDirectory(assignedUserId))
                .resolve(String.valueOf(date.getYear()))
                .resolve("%02d".formatted(date.getMonthValue()))
                .normalize();
        Files.createDirectories(targetDirectory);

        String storedFilename = slideId + (extension.isBlank() ? "" : "." + extension);
        Path target = targetDirectory.resolve(storedFilename).normalize();
        if (!target.startsWith(slidesDirectory)) {
            throw new IllegalArgumentException("Invalid target path");
        }

        return new StorageTarget(target, storedFilename, extension);
    }

    private String sanitizeOriginalName(String originalName) {
        String cleaned = StringUtils.cleanPath(originalName == null ? "slide.bif" : originalName);
        if (cleaned.contains("..")) {
            throw new IllegalArgumentException("Invalid file name");
        }
        return cleaned;
    }

    private String extractExtension(String originalName) {
        int dotIndex = originalName.lastIndexOf('.');
        return dotIndex > 0 && dotIndex < originalName.length() - 1
                ? originalName.substring(dotIndex + 1).toLowerCase()
                : "";
    }

    private String storageOwnerDirectory(UUID assignedUserId) {
        return assignedUserId == null ? "unassigned" : assignedUserId.toString();
    }

    private record StorageTarget(Path path, String storedFilename, String extension) {
    }
}
