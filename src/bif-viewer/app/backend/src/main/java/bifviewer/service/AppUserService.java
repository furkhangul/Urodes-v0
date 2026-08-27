package bifviewer.service;

import bifviewer.config.GatewayUserPrincipal;
import bifviewer.domain.user.AppRole;
import bifviewer.dto.AppUserResponse;
import bifviewer.infrastructure.persistence.AppUserEntity;
import bifviewer.infrastructure.persistence.AppUserRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@Service
public class AppUserService {

    private final AppUserRepository appUserRepository;
    private final JdbcTemplate jdbcTemplate;

    public AppUserService(AppUserRepository appUserRepository, JdbcTemplate jdbcTemplate) {
        this.appUserRepository = appUserRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public AppUserEntity currentUser() {
        Authentication authentication = currentAuthentication();
        CurrentUser currentUser = resolveCurrentUser(authentication);
        if (currentUser.keycloakId() == null || currentUser.keycloakId().isBlank()) {
            throw new ResponseStatusException(UNAUTHORIZED, "Authenticated user has no subject");
        }

        AppRole role = currentRole();
        upsertUser(
                currentUser.keycloakId(),
                firstNonBlank(currentUser.username(), currentUser.keycloakId()),
                currentUser.email(),
                role
        );
        return appUserRepository.findByKeycloakId(currentUser.keycloakId())
                .orElseThrow(() -> new IllegalStateException("App user upsert did not create a row"));
    }

    @Transactional(readOnly = true)
    public AppUserEntity requireUser(UUID userId) {
        return appUserRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "User not found"));
    }

    @Transactional
    public AppUserEntity requireOrCreateViewerByKeycloakId(String keycloakId) {
        if (keycloakId == null || keycloakId.isBlank()) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "Keycloak user id is required");
        }
        upsertUser(keycloakId, keycloakId, null, AppRole.VIEWER);
        return appUserRepository.findByKeycloakId(keycloakId)
                .orElseThrow(() -> new IllegalStateException("App user upsert did not create a row"));
    }

    @Transactional(readOnly = true)
    public List<AppUserResponse> listUsers() {
        return appUserRepository.findAllByOrderByUsernameAsc().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AppUserResponse> listViewers() {
        return appUserRepository.findByRoleOrderByUsernameAsc(AppRole.VIEWER).stream()
                .map(this::toResponse)
                .toList();
    }

    public boolean isMaster(AppUserEntity user) {
        return user.getRole() == AppRole.MASTER;
    }

    public AppUserResponse toResponse(AppUserEntity user) {
        return new AppUserResponse(
                user.getId().toString(),
                user.getKeycloakId(),
                user.getUsername(),
                user.getEmail(),
                user.getRole().name()
        );
    }

    private Authentication currentAuthentication() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(UNAUTHORIZED, "Authentication is required");
        }
        return authentication;
    }

    private CurrentUser resolveCurrentUser(Authentication authentication) {
        Object principal = authentication.getPrincipal();
        if (principal instanceof GatewayUserPrincipal gatewayUser) {
            return new CurrentUser(gatewayUser.subject(), gatewayUser.username(), gatewayUser.email());
        }
        if (principal instanceof Jwt jwt) {
            return new CurrentUser(
                    jwt.getSubject(),
                    firstNonBlank(jwt.getClaimAsString("preferred_username"), jwt.getClaimAsString("name")),
                    jwt.getClaimAsString("email")
            );
        }
        return new CurrentUser(authentication.getName(), authentication.getName(), null);
    }


    private AppRole currentRole() {
        Authentication authentication = currentAuthentication();
        boolean master = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch("ROLE_master"::equals);
        return master ? AppRole.MASTER : AppRole.VIEWER;
    }

    private String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return second;
    }

    private void upsertUser(String keycloakId, String username, String email, AppRole role) {
        OffsetDateTime now = OffsetDateTime.now();
        jdbcTemplate.update("""
                INSERT INTO app_users (
                    id,
                    keycloak_id,
                    username,
                    email,
                    role,
                    created_at,
                    updated_at,
                    last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (keycloak_id) DO UPDATE SET
                    username = EXCLUDED.username,
                    email = EXCLUDED.email,
                    role = EXCLUDED.role,
                    updated_at = EXCLUDED.updated_at,
                    last_seen_at = EXCLUDED.last_seen_at
                """,
                UUID.randomUUID(),
                keycloakId,
                username,
                email,
                role.name(),
                now,
                now,
                now
        );
    }


    private record CurrentUser(String keycloakId, String username, String email) {}
}
