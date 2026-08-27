package bifviewer.infrastructure.persistence;

import bifviewer.domain.slide.SlideStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SlideRepository extends JpaRepository<SlideEntity, UUID> {

    List<SlideEntity> findByStatusOrderByCreatedAtDesc(SlideStatus status);

    List<SlideEntity> findByStatusAndBioformatsStatusOrderByCreatedAtDesc(SlideStatus status, SlideStatus bioformatsStatus);

    List<SlideEntity> findByStatusAndBioformatsStatusAndAssignedUserIdOrderByCreatedAtDesc(
            SlideStatus status,
            SlideStatus bioformatsStatus,
            UUID assignedUserId
    );

    List<SlideEntity> findByStatusAndOpenslideStatusOrderByCreatedAtDesc(SlideStatus status, SlideStatus openslideStatus);

    List<SlideEntity> findByStatusAndOpenslideStatusAndAssignedUserIdOrderByCreatedAtDesc(
            SlideStatus status,
            SlideStatus openslideStatus,
            UUID assignedUserId
    );
}
