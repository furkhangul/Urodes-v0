package bifviewer.openslide;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.RemovalCause;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
public class OpenSlideCacheManager {

    private final Cache<String, byte[]> tileCache;
    private final ConcurrentHashMap<String, Set<String>> slideKeys = new ConcurrentHashMap<>();
    private final long maxSizeBytes;

    public OpenSlideCacheManager(@Value("${openslide.cache.max-size-bytes}") long maxSizeBytes) {
        this.maxSizeBytes = maxSizeBytes;
        this.tileCache = Caffeine.newBuilder()
                .maximumWeight(maxSizeBytes)
                .weigher((String key, byte[] value) -> value.length)
                .expireAfterAccess(5, TimeUnit.MINUTES)
                .recordStats()
                .removalListener((String key, byte[] value, RemovalCause cause) -> {
                    if (key != null) {
                        untrackKey(key);
                    }
                })
                .build();
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
        return invalidated + scanned;
    }

    public long estimatedBytes() {
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
                tileCache.estimatedSize(),
                maxSizeBytes
        );
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
            long estimatedEntries,
            long maxWeightBytes
    ) {
    }
}
