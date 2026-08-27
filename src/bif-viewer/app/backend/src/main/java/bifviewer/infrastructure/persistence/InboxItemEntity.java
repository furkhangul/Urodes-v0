package bifviewer.infrastructure.persistence;

import bifviewer.domain.inbox.InboxItemStatus;
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
@Table(name = "inbox_items")
public class InboxItemEntity implements Persistable<UUID> {

    @Id
    private UUID id;

    @Transient
    private boolean isNew = true;

    @Column(name = "original_name", nullable = false)
    private String originalName;

    @Column(name = "inbox_path", nullable = false, unique = true)
    private String inboxPath;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private InboxItemStatus status;

    @Column(name = "assigned_user_id")
    private UUID assignedUserId;

    @Column(name = "assigned_by_user_id")
    private UUID assignedByUserId;

    @Column(name = "slide_id")
    private UUID slideId;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "assigned_at")
    private OffsetDateTime assignedAt;

    @Column(name = "processed_at")
    private OffsetDateTime processedAt;

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

    public String getInboxPath() {
        return inboxPath;
    }

    public void setInboxPath(String inboxPath) {
        this.inboxPath = inboxPath;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public void setSizeBytes(long sizeBytes) {
        this.sizeBytes = sizeBytes;
    }

    public InboxItemStatus getStatus() {
        return status;
    }

    public void setStatus(InboxItemStatus status) {
        this.status = status;
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

    public UUID getSlideId() {
        return slideId;
    }

    public void setSlideId(UUID slideId) {
        this.slideId = slideId;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }

    public OffsetDateTime getAssignedAt() {
        return assignedAt;
    }

    public void setAssignedAt(OffsetDateTime assignedAt) {
        this.assignedAt = assignedAt;
    }

    public OffsetDateTime getProcessedAt() {
        return processedAt;
    }

    public void setProcessedAt(OffsetDateTime processedAt) {
        this.processedAt = processedAt;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }
}
