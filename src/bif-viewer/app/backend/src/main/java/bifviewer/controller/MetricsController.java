package bifviewer.controller;

import bifviewer.cache.TileCacheManager;
import bifviewer.openslide.OpenSlideTileService;
import bifviewer.service.TileService;
import com.sun.management.OperatingSystemMXBean;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/system")
public class MetricsController {

    private final MemoryMXBean memoryMxBean = ManagementFactory.getMemoryMXBean();
    private final OperatingSystemMXBean operatingSystemMxBean =
            (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
    private final TileCacheManager tileCacheManager;
    private final TileService tileService;
    private final OpenSlideTileService openSlideTileService;

    public MetricsController(
            TileCacheManager tileCacheManager,
            TileService tileService,
            OpenSlideTileService openSlideTileService
    ) {
        this.tileCacheManager = tileCacheManager;
        this.tileService = tileService;
        this.openSlideTileService = openSlideTileService;
    }

    @GetMapping(value = "/metrics", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> metrics() {
        MemoryUsage heap = memoryMxBean.getHeapMemoryUsage();
        MemoryUsage nonHeap = memoryMxBean.getNonHeapMemoryUsage();
        TileCacheManager.CacheMetrics cache = tileCacheManager.snapshot();
        var openSlideCache = openSlideTileService.cacheSnapshot();

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("processCpuLoadPercent", toPercent(operatingSystemMxBean.getProcessCpuLoad()));
        payload.put("systemCpuLoadPercent", toPercent(operatingSystemMxBean.getCpuLoad()));
        payload.put("processCpuTimeNanos", operatingSystemMxBean.getProcessCpuTime());
        payload.put("committedVirtualMemoryBytes", operatingSystemMxBean.getCommittedVirtualMemorySize());
        payload.put("freePhysicalMemoryBytes", operatingSystemMxBean.getFreeMemorySize());
        payload.put("totalPhysicalMemoryBytes", operatingSystemMxBean.getTotalMemorySize());
        payload.put("heapUsedBytes", heap.getUsed());
        payload.put("heapCommittedBytes", heap.getCommitted());
        payload.put("heapMaxBytes", heap.getMax());
        payload.put("nonHeapUsedBytes", nonHeap.getUsed());
        payload.put("nonHeapCommittedBytes", nonHeap.getCommitted());
        payload.put("availableProcessors", operatingSystemMxBean.getAvailableProcessors());
        payload.put("inFlightTileRequests", tileService.getInFlightTileCount());
        payload.put("tileCache", cache);
        payload.put("tileCacheBytes", tileCacheManager.estimatedBytes());
        payload.put("openSlideInFlightTileRequests", openSlideTileService.getInFlightTileCount());
        payload.put("openSlideTileCache", openSlideCache);
        payload.put("openSlideTileCacheBytes", openSlideTileService.estimatedCacheBytes());
        return payload;
    }

    private double toPercent(double value) {
        if (value < 0) {
            return 0.0;
        }
        return value * 100.0;
    }
}
