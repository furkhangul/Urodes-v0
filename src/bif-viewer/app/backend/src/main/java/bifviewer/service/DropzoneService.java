package bifviewer.service;

import bifviewer.dto.DropzoneFileResponse;
import bifviewer.infrastructure.ingest.IngestProperties;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

@Service
public class DropzoneService {

    private final AppUserService appUserService;
    private final IngestProperties ingestProperties;
    private final Path dropzoneDir;
    private final Path inboxDir;

    public DropzoneService(AppUserService appUserService, IngestProperties ingestProperties) throws IOException {
        this.appUserService = appUserService;
        this.ingestProperties = ingestProperties;
        this.dropzoneDir = Path.of(ingestProperties.getDropzoneDir()).toAbsolutePath().normalize();
        this.inboxDir = Path.of(ingestProperties.getInboxDir()).toAbsolutePath().normalize();
        Files.createDirectories(this.dropzoneDir);
        Files.createDirectories(this.inboxDir);
    }

    public List<DropzoneFileResponse> listFiles() {
        requireMaster();
        try (Stream<Path> stream = Files.list(dropzoneDir)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(this::isVisibleAllowedFile)
                    .sorted(Comparator.comparing(this::lastModifiedQuiet).reversed())
                    .map(this::toResponse)
                    .toList();
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Dropzone listelenemedi", exception);
        }
    }

    public Map<String, Object> importFile(String fileName) {
        requireMaster();
        String safeName = sanitizeFileName(fileName);
        Path source = resolveDropzoneFile(safeName);
        if (!Files.isRegularFile(source)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Dropzone dosyası bulunamadı");
        }
        ensureAllowedExtension(safeName);

        Path target = uniqueTarget(inboxDir, safeName);
        try {
            try {
                Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(source, target);
            }
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Dosya inbox klasörüne taşınamadı", exception);
        }

        return Map.of(
                "fileName", target.getFileName().toString(),
                "target", target.toString(),
                "message", "Dosya inbox klasörüne aktarıldı"
        );
    }

    public Map<String, Object> deleteFile(String fileName) {
        requireMaster();
        String safeName = sanitizeFileName(fileName);
        Path source = resolveDropzoneFile(safeName);
        if (!Files.isRegularFile(source)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Dropzone dosyası bulunamadı");
        }
        try {
            Files.delete(source);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Dropzone dosyası silinemedi", exception);
        }
        return Map.of(
                "fileName", safeName,
                "message", "Dosya dropzone klasöründen silindi"
        );
    }

    private void requireMaster() {
        if (!appUserService.isMaster(appUserService.currentUser())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only master users can manage dropzone files");
        }
    }

    private DropzoneFileResponse toResponse(Path path) {
        return new DropzoneFileResponse(
                path.getFileName().toString(),
                sizeQuiet(path),
                Instant.ofEpochMilli(lastModifiedQuiet(path)).toString()
        );
    }

    private boolean isVisibleAllowedFile(Path path) {
        String name = path.getFileName().toString();
        if (name.startsWith(".")) {
            return false;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        for (String suffix : ingestProperties.getIgnoredSuffixes()) {
            if (lower.endsWith(suffix.toLowerCase(Locale.ROOT))) {
                return false;
            }
        }
        return lower.endsWith(".bif");
    }

    private void ensureAllowedExtension(String fileName) {
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".bif")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Sadece .bif dosyaları içe aktarılabilir");
        }
    }

    private String sanitizeFileName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Dosya adı boş olamaz");
        }
        String normalized = fileName.strip();
        if (normalized.contains("..") || normalized.contains("/") || normalized.contains("\\")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Geçersiz dosya adı");
        }
        return normalized;
    }

    private Path resolveDropzoneFile(String fileName) {
        Path resolved = dropzoneDir.resolve(fileName).toAbsolutePath().normalize();
        if (!resolved.startsWith(dropzoneDir)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Geçersiz dosya yolu");
        }
        return resolved;
    }

    private Path uniqueTarget(Path directory, String desiredName) {
        Path candidate = directory.resolve(desiredName).normalize();
        if (!candidate.startsWith(directory)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Geçersiz hedef yolu");
        }
        if (!Files.exists(candidate)) {
            return candidate;
        }

        String base = desiredName;
        String ext = "";
        int dotIndex = desiredName.lastIndexOf('.');
        if (dotIndex > 0) {
            base = desiredName.substring(0, dotIndex);
            ext = desiredName.substring(dotIndex);
        }

        for (int attempt = 0; attempt < 20; attempt++) {
            String suffix = "-" + Instant.now().toEpochMilli() + (attempt == 0 ? "" : "-" + attempt);
            Path next = directory.resolve(base + suffix + ext).normalize();
            if (next.startsWith(directory) && !Files.exists(next)) {
                return next;
            }
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Benzersiz hedef dosya adı üretilemedi");
    }

    private long sizeQuiet(Path path) {
        try {
            return Files.size(path);
        } catch (IOException ignored) {
            return -1L;
        }
    }

    private long lastModifiedQuiet(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException ignored) {
            return 0L;
        }
    }
}
