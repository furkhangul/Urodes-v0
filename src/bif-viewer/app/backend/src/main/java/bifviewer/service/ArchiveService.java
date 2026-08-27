package bifviewer.service;

import bifviewer.infrastructure.persistence.AppUserEntity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Annotation denetim izini üç ayrı hedefe kaydeder:
 *
 * <ul>
 *   <li><b>ImageLog/</b> — model çalıştırıldığı anda kesilen bölgenin ham görüntüsü
 *       (PNG). Hangi görüntü üzerinde etiketleme yapıldığı sonradan görülebilsin diye.</li>
 *   <li><b>JsonLog/annotations.json</b> — TEK bir dosya. Tüm slaytların tüm kutuları
 *       SLAYT piksel koordinatlarında burada tutulur ve her düzenlemede (taşıma,
 *       boyutlandırma, etiket değiştirme, silme, yeni kutu) canlı olarak güncellenir.
 *       Amaç: gün sonunda bu dosya + ana görsel ile tüm hücrelerin yeniden
 *       kutulanabilmesi.</li>
 *   <li><b>TerminalLog/</b> — insan tarafından okunabilir, yapılan HER değişikliğin
 *       (ve hataların) satır satır dökümü.</li>
 * </ul>
 */
@Service
public class ArchiveService {

    private static final Logger log = LoggerFactory.getLogger(ArchiveService.class);
    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss").withZone(ZoneOffset.UTC);

    private final Path archiveDir;
    private final ObjectMapper objectMapper;
    private final AppUserService appUserService;

    /** annotations.json tek dosya olduğu için tüm yazımlar tek kilit üzerinden sıralanır. */
    private final ReentrantLock jsonLock = new ReentrantLock();
    private final ReentrantLock terminalLock = new ReentrantLock();

    public ArchiveService(
            @Value("${bif.archive-dir}") String archiveDir,
            ObjectMapper objectMapper,
            AppUserService appUserService
    ) {
        this.archiveDir = Path.of(archiveDir);
        this.objectMapper = objectMapper;
        this.appUserService = appUserService;
    }

    private Path imageLogDir() {
        return archiveDir.resolve("ImageLog");
    }

    private Path jsonLogDir() {
        return archiveDir.resolve("JsonLog");
    }

    private Path terminalLogDir() {
        return archiveDir.resolve("TerminalLog");
    }

    private Path annotationsFile() {
        return jsonLogDir().resolve("annotations.json");
    }

    private static String safe(String value) {
        if (value == null || value.isBlank()) {
            return "unknown";
        }
        return value.replaceAll("[^A-Za-z0-9_.-]", "_");
    }

    // ==================================================================
    // TerminalLog — yapılan her değişikliğin okunabilir dökümü
    // ==================================================================

    /**
     * TerminalLog'a tek satır yazar. {@code level} INFO / WARN / ERROR olabilir.
     * Hatalar da buraya düşer ("hata mı yapıldı log olarak tutulsun").
     */
    public void logTerminal(String slideId, String event, String message, String level) {
        AppUserEntity user = appUserService.currentUser();
        String lvl = (level == null || level.isBlank()) ? "INFO" : level.toUpperCase();
        String line = String.format(
                "%s  %-5s  user=%s  event=%-16s  %s",
                OffsetDateTime.now(ZoneOffset.UTC),
                lvl,
                user.getUsername(),
                event == null ? "-" : event,
                message == null ? "" : message
        );

        Path file = terminalLogDir().resolve(safe(slideId) + ".log");
        terminalLock.lock();
        try {
            Files.createDirectories(terminalLogDir());
            Files.writeString(
                    file,
                    line + System.lineSeparator(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.APPEND
            );
        } catch (IOException exception) {
            log.error("TerminalLog yazılamadı slide={} event={}: {}", slideId, event, exception.getMessage());
        } finally {
            terminalLock.unlock();
        }
    }

    // ==================================================================
    // ImageLog — model çalıştırıldığı andaki kesit görüntüsü
    // ==================================================================

    /**
     * Model test tuşuna basıldığı anda kesilen bölgenin görüntüsünü saklar.
     *
     * @return arşiv köküne göre göreli yol (annotations.json içine yazılır)
     */
    public String saveRegionImage(String slideId, String regionId, byte[] bytes) {
        String name = safe(slideId) + "__" + safe(regionId) + "__" + STAMP.format(OffsetDateTime.now()) + ".png";
        Path file = imageLogDir().resolve(name);
        try {
            Files.createDirectories(imageLogDir());
            Files.write(file, bytes, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (IOException exception) {
            log.error("ImageLog yazılamadı slide={} region={}: {}", slideId, regionId, exception.getMessage());
            logTerminal(slideId, "image_log", "Kesit görüntüsü kaydedilemedi: " + exception.getMessage(), "ERROR");
            throw new IllegalStateException("ImageLog yazılamadı: " + exception.getMessage(), exception);
        }
        String relative = "ImageLog/" + name;
        logTerminal(slideId, "image_log", "Kesit görüntüsü kaydedildi: " + relative + " (" + bytes.length + " bayt)", "INFO");
        return relative;
    }

    // ==================================================================
    // JsonLog/annotations.json — canlı güncellenen tek annotation dosyası
    // ==================================================================

    /**
     * Bir bölgenin (kesit) annotation listesini annotations.json içine yazar.
     * Aynı {@code regionId} zaten varsa İÇERİĞİ DEĞİŞTİRİLİR — böylece kullanıcı
     * bir kutuyu taşıdığında/etiketini değiştirdiğinde dosya canlı olarak güncellenir.
     */
    @SuppressWarnings("unchecked")
    public ObjectNode upsertRegion(String slideId, Map<String, Object> body) {
        jsonLock.lock();
        try {
            ObjectNode root = readAnnotations();
            ObjectNode slides = (ObjectNode) root.get("slides");

            ObjectNode slide = slides.has(slideId) ? (ObjectNode) slides.get(slideId) : slides.putObject(slideId);
            slide.put("slideId", slideId);
            copyIfPresent(body, slide, "fileName");
            copyIfPresent(body, slide, "kind");
            copyNumberIfPresent(body, slide, "width");
            copyNumberIfPresent(body, slide, "height");
            copyNumberIfPresent(body, slide, "micronsPerPixel");

            ArrayNode regions = slide.has("regions") ? (ArrayNode) slide.get("regions") : slide.putArray("regions");

            String regionId = String.valueOf(body.getOrDefault("regionId", ""));
            if (regionId.isBlank()) {
                throw new IllegalArgumentException("regionId zorunlu");
            }

            ObjectNode region = null;
            for (JsonNode candidate : regions) {
                if (candidate.isObject() && regionId.equals(candidate.path("regionId").asText())) {
                    region = (ObjectNode) candidate;
                    break;
                }
            }
            boolean created = false;
            if (region == null) {
                region = regions.addObject();
                region.put("regionId", regionId);
                region.put("createdAt", OffsetDateTime.now(ZoneOffset.UTC).toString());
                created = true;
            }
            region.put("updatedAt", OffsetDateTime.now(ZoneOffset.UTC).toString());
            copyIfPresent(body, region, "image");
            if (body.get("regionBbox") != null) {
                region.set("bbox", objectMapper.valueToTree(body.get("regionBbox")));
            }
            if (body.get("annotations") != null) {
                region.set("annotations", objectMapper.valueToTree(body.get("annotations")));
            }
            region.put("count", region.path("annotations").size());

            root.put("updatedAt", OffsetDateTime.now(ZoneOffset.UTC).toString());
            writeAnnotations(root);

            ObjectNode result = objectMapper.createObjectNode();
            result.put("regionId", regionId);
            result.put("created", created);
            result.put("count", region.path("annotations").size());
            result.put("file", annotationsFile().toString());
            return result;
        } catch (IOException exception) {
            log.error("annotations.json yazılamadı slide={}: {}", slideId, exception.getMessage());
            logTerminal(slideId, "json_log", "annotations.json yazılamadı: " + exception.getMessage(), "ERROR");
            throw new IllegalStateException("annotations.json yazılamadı: " + exception.getMessage(), exception);
        } finally {
            jsonLock.unlock();
        }
    }

    /** Bir bölgeyi tamamen kaldırır (kesit iptal edildiğinde). */
    public void removeRegion(String slideId, String regionId) {
        jsonLock.lock();
        try {
            ObjectNode root = readAnnotations();
            ObjectNode slides = (ObjectNode) root.get("slides");
            if (!slides.has(slideId)) {
                return;
            }
            ObjectNode slide = (ObjectNode) slides.get(slideId);
            ArrayNode regions = (ArrayNode) slide.get("regions");
            if (regions == null) {
                return;
            }
            for (int i = regions.size() - 1; i >= 0; i--) {
                if (regionId.equals(regions.get(i).path("regionId").asText())) {
                    regions.remove(i);
                }
            }
            root.put("updatedAt", OffsetDateTime.now(ZoneOffset.UTC).toString());
            writeAnnotations(root);
        } catch (IOException exception) {
            log.error("annotations.json güncellenemedi slide={}: {}", slideId, exception.getMessage());
        } finally {
            jsonLock.unlock();
        }
    }

    /** annotations.json içeriğini olduğu gibi döndürür (indirme / inceleme için). */
    public JsonNode readAll() {
        jsonLock.lock();
        try {
            return readAnnotations();
        } catch (IOException exception) {
            throw new IllegalStateException("annotations.json okunamadı: " + exception.getMessage(), exception);
        } finally {
            jsonLock.unlock();
        }
    }

    private ObjectNode readAnnotations() throws IOException {
        Path file = annotationsFile();
        if (Files.exists(file)) {
            try {
                JsonNode parsed = objectMapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
                if (parsed instanceof ObjectNode objectNode && objectNode.has("slides")) {
                    return objectNode;
                }
            } catch (IOException parseError) {
                // Bozuk dosya tüm kaydı kaybettirmesin: yedeğe alıp sıfırdan başla.
                Path backup = file.resolveSibling("annotations.corrupt-" + STAMP.format(OffsetDateTime.now()) + ".json");
                Files.move(file, backup);
                log.warn("annotations.json bozuktu, yedeklendi: {}", backup);
            }
        }
        ObjectNode root = objectMapper.createObjectNode();
        root.put("version", 1);
        root.put("coordinateSpace", "slide-pixels");
        root.put("updatedAt", OffsetDateTime.now(ZoneOffset.UTC).toString());
        root.putObject("slides");
        return root;
    }

    private void writeAnnotations(ObjectNode root) throws IOException {
        Files.createDirectories(jsonLogDir());
        Path file = annotationsFile();
        Path tmp = file.resolveSibling("annotations.json.tmp");
        // Önce geçici dosyaya yaz, sonra taşı: yazım sırasında kesinti olursa
        // mevcut annotations.json bozulmadan kalır.
        Files.writeString(
                tmp,
                objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
        );
        Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    private void copyIfPresent(Map<String, Object> body, ObjectNode target, String key) {
        Object value = body.get(key);
        if (value != null) {
            target.put(key, String.valueOf(value));
        }
    }

    private void copyNumberIfPresent(Map<String, Object> body, ObjectNode target, String key) {
        Object value = body.get(key);
        if (!(value instanceof Number number)) {
            return;
        }
        // Piksel boyutları tam sayı kalsın (70656.0 değil 70656).
        double d = number.doubleValue();
        if (d == Math.rint(d) && !Double.isInfinite(d)) {
            target.put(key, (long) d);
        } else {
            target.put(key, d);
        }
    }
}
