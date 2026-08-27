package bifviewer.config;

import java.util.List;

public record GatewayUserPrincipal(
    String subject,
    String username,
    String email,
    List<String> groups
) {}
