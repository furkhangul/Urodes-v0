package bifviewer.infrastructure.persistence;

import bifviewer.domain.inbox.InboxItemStatus;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InboxItemRepository extends JpaRepository<InboxItemEntity, UUID> {

    Optional<InboxItemEntity> findByInboxPath(String inboxPath);

    List<InboxItemEntity> findAllByOrderByCreatedAtDesc();

    List<InboxItemEntity> findByStatusOrderByCreatedAtDesc(InboxItemStatus status);

    @Modifying
    @Query("delete from InboxItemEntity item where item.slideId = :slideId")
    int deleteBySlideId(@Param("slideId") UUID slideId);
}
