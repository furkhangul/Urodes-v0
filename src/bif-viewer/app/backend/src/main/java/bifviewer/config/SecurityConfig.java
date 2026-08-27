package bifviewer.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                // Admin-only write operations
                .requestMatchers(HttpMethod.POST, "/api/slides/sync-storage").hasRole("master")
                .requestMatchers(HttpMethod.DELETE, "/api/slides/*/cache").hasRole("master")
                .requestMatchers(HttpMethod.DELETE, "/api/slides/*").hasRole("master")
                .requestMatchers(HttpMethod.DELETE, "/api/openslide/**").hasRole("master")
                .requestMatchers("/api/dropzone/**").hasRole("master")
                .requestMatchers("/api/inbox/**").hasRole("master")
                .requestMatchers("/api/users", "/api/users/**").hasRole("master")
                // All other /api/** requires authentication (viewer or master)
                .requestMatchers("/api/**").hasAnyRole("master", "viewer")
                // Static frontend assets are public
                .anyRequest().permitAll()
            )
            .addFilterBefore(new GatewayHeaderAuthenticationFilter(), BearerTokenAuthenticationFilter.class)
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(keycloakJwtConverter()))
            );

        return http.build();
    }

    @Bean
    public JwtAuthenticationConverter keycloakJwtConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Map<String, Object> realmAccess = jwt.getClaim("realm_access");
            if (realmAccess == null) {
                return List.of();
            }
            @SuppressWarnings("unchecked")
            List<String> roles = (List<String>) realmAccess.get("roles");
            if (roles == null) {
                return List.of();
            }
            return roles.stream()
                .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                .collect(Collectors.toList());
        });
        return converter;
    }
}
