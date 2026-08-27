package bifviewer.infrastructure.persistence;

import bifviewer.domain.slide.IngestSource;
import bifviewer.domain.slide.SlideFormat;
import bifviewer.domain.slide.SlideStatus;
import bifviewer.infrastructure.storage.SlideStorage;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.UUID;

@Component
public class SlideRecordWriter {

    private final JdbcTemplate jdbcTemplate;

    public SlideRecordWriter(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void insertSlide(
            UUID slideId,
            SlideStorage.StoredSlideFile storedFile,
            SlideFormat format,
            SlideStatus status,
            String metadataJson,
            IngestSource ingestSource,
            String sourceFilename,
            SlideStatus bioformatsStatus,
            String bioformatsMetadataJson,
            String bioformatsError,
            SlideStatus openslideStatus,
            String openslideMetadataJson,
            String openslideError,
            String openslideVendor,
            UUID assignedUserId,
            UUID assignedByUserId,
            OffsetDateTime assignedAt,
            OffsetDateTime now
    ) {
        jdbcTemplate.update("""
                INSERT INTO slides (
                    id,
                    original_name,
                    stored_filename,
                    storage_path,
                    extension,
                    format,
                    status,
                    size_bytes,
                    checksum,
                    metadata,
                    ingest_source,
                    source_filename,
                    bioformats_status,
                    bioformats_metadata,
                    bioformats_error,
                    openslide_status,
                    openslide_metadata,
                    openslide_error,
                    openslide_vendor,
                    assigned_user_id,
                    assigned_by_user_id,
                    assigned_at,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, CAST(? AS jsonb), ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, ?)
                """,
                slideId,
                storedFile.originalName(),
                storedFile.storedFilename(),
                storedFile.storagePath().toString(),
                storedFile.extension(),
                format.name(),
                status.name(),
                storedFile.sizeBytes(),
                null,
                metadataJson,
                ingestSource.name(),
                sourceFilename,
                bioformatsStatus.name(),
                bioformatsMetadataJson,
                bioformatsError,
                openslideStatus.name(),
                openslideMetadataJson,
                openslideError,
                openslideVendor,
                assignedUserId,
                assignedByUserId,
                assignedAt,
                now,
                now
        );
    }
}
