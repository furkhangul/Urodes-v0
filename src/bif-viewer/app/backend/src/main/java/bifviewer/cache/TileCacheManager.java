package bifviewer.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.RemovalCause;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
public class TileCacheManager {

    private static final Logger log = LoggerFactory.getLogger(TileCacheManager.class);

    private final Cache<String, byte[]> tileCache;
    private final ConcurrentHashMap<String, Set<String>> slideKeys = new ConcurrentHashMap<>();
    private final long maxSizeBytes;

    public TileCacheManager(@Value("${bif.cache.max-size-bytes}") long maxSizeBytes) {
        this.maxSizeBytes = maxSizeBytes;
        this.tileCache = Caffeine.newBuilder()
                .maximumWeight(maxSizeBytes)
                .weigher((String key, byte[] value) -> value.length)
                .expireAfterAccess(5, TimeUnit.MINUTES) // if not use 5 min remove
                .recordStats()
                .removalListener((String key, byte[] value, RemovalCause cause) -> { // we can store the cause but right now we not use
                    if (key != null) {
                        untrackKey(key);
                    }
                })
                .build();
    }

    public long estimatedWeightBytes() {
        return tileCache.policy().eviction()
                .map(policy -> policy.weightedSize().orElse(0L))
                .orElse(0L);
    }

    public long maxWeightBytes() {
        return maxSizeBytes;
    }

    public String cacheKey(String slideId, int z, int x, int y) {
        return "%s:%d:%d:%d".formatted(slideId, z, x, y);
    }

    public byte[] get(String key) {
        return tileCache.getIfPresent(key);
    }

    public void put(String key, byte[] value) {
        tileCache.put(key, value);
        trackKey(key);
    }

    public int invalidateSlide(String slideId) {
        Set<String> keys = slideKeys.remove(slideId);
        int invalidated = 0;
        if (keys != null && !keys.isEmpty()) {
            tileCache.invalidateAll(keys);
            invalidated = keys.size();
        }

        String prefix = slideId + ":";
        int scanned = 0;
        for (String key : tileCache.asMap().keySet()) {
            if (key.startsWith(prefix)) {
                tileCache.invalidate(key);
                scanned++;
            }
        }
        tileCache.cleanUp();

        int total = invalidated + scanned;
        log.info("tile-cache invalidated slide={} indexed={} scanned={} remainingSize={}",
                slideId, invalidated, scanned, tileCache.estimatedSize());
        return total;
    }

    public long estimatedBytes() { //this function use for ui to show cache size. In the future we can remove.
        long total = 0L;
        for (byte[] value : tileCache.asMap().values()) {
            if (value != null) {
                total += value.length;
            }
        }
        return total;
    }

    public CacheMetrics snapshot() {
        var stats = tileCache.stats();
        long requestCount = stats.requestCount();
        double hitRate = requestCount == 0 ? 0.0 : stats.hitRate() * 100.0;
        return new CacheMetrics(
                requestCount,
                stats.hitCount(),
                stats.missCount(),
                hitRate,
                tileCache.estimatedSize()
        );
    }

    @Scheduled(fixedRate = 60000L)
    public void logStats() {
        CacheMetrics metrics = snapshot();
        log.info("tile-cache stats: requests={}, hitRate={}%, hits={}, misses={}, tiles={}, weight={}MB / {}MB",
                metrics.requests(),
                "%.2f".formatted(metrics.hitRatePercent()),
                metrics.hits(),
                metrics.misses(),
                metrics.estimatedEntries(),
                estimatedWeightBytes() / (1024 * 1024),
                maxSizeBytes / (1024 * 1024));
    }

    private void trackKey(String key) {
        String slideId = extractSlideId(key);
        if (slideId == null) {
            return;
        }
        slideKeys.computeIfAbsent(slideId, id -> ConcurrentHashMap.newKeySet()).add(key);
    }

    private void untrackKey(String key) {
        String slideId = extractSlideId(key);
        if (slideId == null) {
            return;
        }
        slideKeys.computeIfPresent(slideId, (id, set) -> {
            set.remove(key);
            return set.isEmpty() ? null : set;
        });
    }

    private String extractSlideId(String key) {
        int idx = key.indexOf(':');
        return idx <= 0 ? null : key.substring(0, idx);
    }

    public record CacheMetrics(
            long requests,
            long hits,
            long misses,
            double hitRatePercent,
            long estimatedEntries
    ) {
    }
}
