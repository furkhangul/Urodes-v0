package bifviewer.infrastructure.persistence;

import bifviewer.domain.slide.IngestSource;
import bifviewer.domain.slide.SlideFormat;
import bifviewer.domain.slide.SlideStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "slides")
public class SlideEntity implements Persistable<UUID> {

    @Id
    private UUID id;

    @Transient
    private boolean isNew = true;

    @Column(name = "original_name", nullable = false)
    private String originalName;

    @Column(name = "stored_filename", nullable = false)
    private String storedFilename;

    @Column(name = "storage_path", nullable = false, unique = true)
    private String storagePath;

    @Column(name = "extension", nullable = false, length = 32)
    private String extension;

    @Enumerated(EnumType.STRING)
    @Column(name = "format", nullable = false, length = 32)
    private SlideFormat format;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private SlideStatus status;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "checksum")
    private String checksum;

    @Column(name = "metadata", columnDefinition = "jsonb")
    private String metadata;

    @Enumerated(EnumType.STRING)
    @Column(name = "ingest_source", nullable = false, length = 32)
    private IngestSource ingestSource;

    @Column(name = "source_filename")
    private String sourceFilename;

    @Enumerated(EnumType.STRING)
    @Column(name = "bioformats_status", nullable = false, length = 32)
    private SlideStatus bioformatsStatus;

    @Column(name = "bioformats_metadata", columnDefinition = "jsonb")
    private String bioformatsMetadata;

    @Column(name = "bioformats_error")
    private String bioformatsError;

    @Enumerated(EnumType.STRING)
    @Column(name = "openslide_status", nullable = false, length = 32)
    private SlideStatus openslideStatus;

    @Column(name = "openslide_metadata", columnDefinition = "jsonb")
    private String openslideMetadata;

    @Column(name = "openslide_error")
    private String openslideError;

    @Column(name = "openslide_vendor")
    private String openslideVendor;

    @Column(name = "assigned_user_id")
    private UUID assignedUserId;

    @Column(name = "assigned_by_user_id")
    private UUID assignedByUserId;

    @Column(name = "assigned_at")
    private OffsetDateTime assignedAt;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @PrePersist
    void onCreate() {
        OffsetDateTime now = OffsetDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = OffsetDateTime.now();
    }

    @PostPersist
    @PostLoad
    void markNotNew() {
        isNew = false;
    }

    @Override
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getOriginalName() {
        return originalName;
    }

    public void setOriginalName(String originalName) {
        this.originalName = originalName;
    }

    public String getStoredFilename() {
        return storedFilename;
    }

    public void setStoredFilename(String storedFilename) {
        this.storedFilename = storedFilename;
    }

    public String getStoragePath() {
        return storagePath;
    }

    public void setStoragePath(String storagePath) {
        this.storagePath = storagePath;
    }

    public String getExtension() {
        return extension;
    }

    public void setExtension(String extension) {
        this.extension = extension;
    }

    public SlideFormat getFormat() {
        return format;
    }

    public void setFormat(SlideFormat format) {
        this.format = format;
    }

    public SlideStatus getStatus() {
        return status;
    }

    public void setStatus(SlideStatus status) {
        this.status = status;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public void setSizeBytes(long sizeBytes) {
        this.sizeBytes = sizeBytes;
    }

    public String getChecksum() {
        return checksum;
    }

    public void setChecksum(String checksum) {
        this.checksum = checksum;
    }

    public String getMetadata() {
        return metadata;
    }

    public void setMetadata(String metadata) {
        this.metadata = metadata;
    }

    public IngestSource getIngestSource() {
        return ingestSource;
    }

    public void setIngestSource(IngestSource ingestSource) {
        this.ingestSource = ingestSource;
    }

    public String getSourceFilename() {
        return sourceFilename;
    }

    public void setSourceFilename(String sourceFilename) {
        this.sourceFilename = sourceFilename;
    }

    public SlideStatus getBioformatsStatus() {
        return bioformatsStatus;
    }

    public void setBioformatsStatus(SlideStatus bioformatsStatus) {
        this.bioformatsStatus = bioformatsStatus;
    }

    public String getBioformatsMetadata() {
        return bioformatsMetadata;
    }

    public void setBioformatsMetadata(String bioformatsMetadata) {
        this.bioformatsMetadata = bioformatsMetadata;
    }

    public String getBioformatsError() {
        return bioformatsError;
    }

    public void setBioformatsError(String bioformatsError) {
        this.bioformatsError = bioformatsError;
    }

    public SlideStatus getOpenslideStatus() {
        return openslideStatus;
    }

    public void setOpenslideStatus(SlideStatus openslideStatus) {
        this.openslideStatus = openslideStatus;
    }

    public String getOpenslideMetadata() {
        return openslideMetadata;
    }

    public void setOpenslideMetadata(String openslideMetadata) {
        this.openslideMetadata = openslideMetadata;
    }

    public String getOpenslideError() {
        return openslideError;
    }

    public void setOpenslideError(String openslideError) {
        this.openslideError = openslideError;
    }

    public String getOpenslideVendor() {
        return openslideVendor;
    }

    public void setOpenslideVendor(String openslideVendor) {
        this.openslideVendor = openslideVendor;
    }

    public UUID getAssignedUserId() {
        return assignedUserId;
    }

    public void setAssignedUserId(UUID assignedUserId) {
        this.assignedUserId = assignedUserId;
    }

    public UUID getAssignedByUserId() {
        return assignedByUserId;
    }

    public void setAssignedByUserId(UUID assignedByUserId) {
        this.assignedByUserId = assignedByUserId;
    }

    public OffsetDateTime getAssignedAt() {
        return assignedAt;
    }

    public void setAssignedAt(OffsetDateTime assignedAt) {
        this.assignedAt = assignedAt;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(OffsetDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(OffsetDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }
}
