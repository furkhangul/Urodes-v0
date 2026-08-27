package bifviewer.dto;

public record AppUserResponse(
        String id,
        String keycloakId,
        String username,
        String email,
        String role
) {
}
