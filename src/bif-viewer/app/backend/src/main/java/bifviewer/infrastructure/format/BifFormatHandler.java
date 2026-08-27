package bifviewer.infrastructure.format;

import bifviewer.domain.slide.SlideFormat;
import bifviewer.service.BifReaderService;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.Map;

@Component
public class BifFormatHandler implements SlideFormatHandler {

    private final BifReaderService bifReaderService;

    public BifFormatHandler(BifReaderService bifReaderService) {
        this.bifReaderService = bifReaderService;
    }

    @Override
    public boolean supports(String extension) {
        return "bif".equalsIgnoreCase(extension);
    }

    @Override
    public SlideFormat format() {
        return SlideFormat.BIF;
    }

    @Override
    public Map<String, Object> extractMetadata(String slideId, Path storedPath) {
        BifReaderService.SlideMetadata metadata = bifReaderService.inspect(slideId, storedPath);
        return Map.of(
                "tileSize", metadata.tileSize(),
                "width", metadata.width(),
                "height", metadata.height(),
                "levelCount", metadata.levels().size(),
                "physicalScale", metadata.physicalScale()
        );
    }
}
