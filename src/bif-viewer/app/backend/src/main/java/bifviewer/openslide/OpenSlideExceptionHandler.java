package bifviewer.openslide;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.Map;

@RestControllerAdvice(assignableTypes = OpenSlideExperimentController.class)
public class OpenSlideExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(OpenSlideExceptionHandler.class);

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatusException(
            ResponseStatusException exception,
            HttpServletRequest request
    ) {
        HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
        String message = exception.getReason() == null || exception.getReason().isBlank()
                ? status.getReasonPhrase()
                : exception.getReason();

        if (status.is5xxServerError()) {
            log.error("openslide api error status={} path={} message={}", status.value(), request.getRequestURI(), message, exception);
        } else {
            log.warn("openslide api error status={} path={} message={}", status.value(), request.getRequestURI(), message);
        }

        return ResponseEntity.status(status).body(Map.of(
                "timestamp", OffsetDateTime.now().toString(),
                "status", status.value(),
                "error", status.getReasonPhrase(),
                "message", message,
                "path", request.getRequestURI()
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpectedException(
            Exception exception,
            HttpServletRequest request
    ) {
        log.error("unexpected openslide api error path={}", request.getRequestURI(), exception);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "timestamp", OffsetDateTime.now().toString(),
                "status", HttpStatus.INTERNAL_SERVER_ERROR.value(),
                "error", HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
                "message", "OpenSlide deneme hattinda beklenmeyen sunucu hatasi",
                "path", request.getRequestURI()
        ));
    }
}
