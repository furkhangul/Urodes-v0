package bifviewer.infrastructure.persistence;

import bifviewer.domain.user.AppRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AppUserRepository extends JpaRepository<AppUserEntity, UUID> {

    Optional<AppUserEntity> findByKeycloakId(String keycloakId);

    List<AppUserEntity> findByRoleOrderByUsernameAsc(AppRole role);

    List<AppUserEntity> findAllByOrderByUsernameAsc();
}
