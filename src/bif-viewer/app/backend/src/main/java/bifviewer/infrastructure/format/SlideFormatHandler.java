package bifviewer.infrastructure.format;

import bifviewer.domain.slide.SlideFormat;

import java.nio.file.Path;
import java.util.Map;

public interface SlideFormatHandler {

    boolean supports(String extension);

    SlideFormat format();

    Map<String, Object> extractMetadata(String slideId, Path storedPath);
}
