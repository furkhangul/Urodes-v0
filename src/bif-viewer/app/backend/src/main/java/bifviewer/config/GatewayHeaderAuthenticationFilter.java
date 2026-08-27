package bifviewer.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class GatewayHeaderAuthenticationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            String user = firstNonBlank(
                    request.getHeader("X-Auth-Request-Preferred-Username"),
                    request.getHeader("X-Auth-Request-User"),
                    request.getHeader("X-Auth-Request-Email")
            );
            if (user != null) {
                String email = request.getHeader("X-Auth-Request-Email");
                List<String> groups = parseGroups(request.getHeader("X-Auth-Request-Groups"));
                GatewayUserPrincipal principal = new GatewayUserPrincipal(user, user, email, groups);
                List<SimpleGrantedAuthority> authorities = authorities(groups);
                UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(principal, "N/A", authorities);
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        }
        filterChain.doFilter(request, response);
    }

    private static List<String> parseGroups(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .map(group -> group.replaceFirst("^/", ""))
                .filter(group -> !group.isBlank())
                .collect(Collectors.toList());
    }

    private static List<SimpleGrantedAuthority> authorities(List<String> groups) {
        boolean master = groups.stream().anyMatch(group -> matches(group, "bif-master") || matches(group, "gateway-admin"));
        boolean viewer = master || groups.stream().anyMatch(group -> matches(group, "bif-viewer"));
        return Stream.concat(
                        master ? Stream.of(new SimpleGrantedAuthority("ROLE_master")) : Stream.empty(),
                        viewer ? Stream.of(new SimpleGrantedAuthority("ROLE_viewer")) : Stream.empty()
                )
                .collect(Collectors.toList());
    }

    private static boolean matches(String group, String expected) {
        return group != null && group.replaceFirst("^/", "").toLowerCase(Locale.ROOT).equals(expected);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }
}
