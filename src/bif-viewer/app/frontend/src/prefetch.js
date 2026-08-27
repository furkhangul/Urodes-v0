export function setupPrefetch(viewer, options) {
  if (!viewer || !options) {
    return;
  }

  const trail = [];
  let lastZoom = null;
  let lastDragPrefetchAt = 0;
  let dragPrefetchScheduled = false;
  const dragPrefetchIntervalMs = 90;

  function pushCenter() {
    const center = viewer.viewport.getCenter(true);
    trail.push({ x: center.x, y: center.y });
    if (trail.length > 3) {
      trail.shift();
    }
  }

  function prefetchTile(level, x, y) {
    if (!tileExists(level, x, y)) {
      return;
    }
    if (typeof options.prefetchTile === "function") {
      options.prefetchTile(level, x, y);
    }
  }

  function tileExists(level, x, y) {
    if (level < 0 || level > (options.maxLevel ?? 0) || x < 0 || y < 0) {
      return false;
    }

    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage?.source) {
      return false;
    }

    const numTiles = tiledImage.source.getNumTiles(level);
    return x < numTiles.x && y < numTiles.y;
  }

  function prefetchInMotionDirection() {
    if (options.isMotionMode?.()) {
      return;
    }

    if (trail.length < 3) {
      return;
    }

    const a = trail[0];
    const c = trail[trail.length - 1];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const stepX = Math.abs(dx) < 1e-4 ? 0 : dx > 0 ? 1 : -1;
    const stepY = Math.abs(dy) < 1e-4 ? 0 : dy > 0 ? 1 : -1;
    if (stepX === 0 && stepY === 0) {
      return;
    }

    const level = options.levelForViewport();
    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage) {
      return;
    }

    const center = viewer.viewport.getCenter(true);
    const imagePoint = tiledImage.viewportToImageCoordinates(center);
    const levelScale = tiledImage.source.getLevelScale(level);
    const tileSize = tiledImage.source.getTileWidth(level);
    const levelX = Math.max(0, Math.floor((imagePoint.x * levelScale) / tileSize));
    const levelY = Math.max(0, Math.floor((imagePoint.y * levelScale) / tileSize));

    for (let offset = 1; offset <= 2; offset += 1) {
      prefetchTile(level, levelX + stepX * offset, levelY + stepY * offset);
    }
  }

  function prefetchCenterGrid() {
    if (options.isMotionMode?.()) {
      return;
    }

    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage) {
      return;
    }

    const level = options.levelForViewport();
    const center = viewer.viewport.getCenter(true);
    const imagePoint = tiledImage.viewportToImageCoordinates(center);
    const levelScale = tiledImage.source.getLevelScale(level);
    const tileSize = tiledImage.source.getTileWidth(level);
    const centerX = Math.max(0, Math.floor((imagePoint.x * levelScale) / tileSize));
    const centerY = Math.max(0, Math.floor((imagePoint.y * levelScale) / tileSize));

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        prefetchTile(level, centerX + offsetX, centerY + offsetY);
      }
    }

    prefetchNeighborZoomCenter(tiledImage, level + 1, imagePoint);
    prefetchNeighborZoomCenter(tiledImage, level - 1, imagePoint);
  }

  function prefetchNeighborZoomCenter(tiledImage, neighborLevel, imagePoint) {
    const maxLevel = options.maxLevel ?? 0;
    if (neighborLevel < 0 || neighborLevel > maxLevel) {
      return;
    }

    const levelScale = tiledImage.source.getLevelScale(neighborLevel);
    const tileSize = tiledImage.source.getTileWidth(neighborLevel);
    const centerX = Math.max(0, Math.floor((imagePoint.x * levelScale) / tileSize));
    const centerY = Math.max(0, Math.floor((imagePoint.y * levelScale) / tileSize));

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        prefetchTile(neighborLevel, centerX + offsetX, centerY + offsetY);
      }
    }
  }

  viewer.addHandler("canvas-drag", () => {
    pushCenter();
    const now = performance.now();
    if (now - lastDragPrefetchAt >= dragPrefetchIntervalMs) {
      lastDragPrefetchAt = now;
      prefetchInMotionDirection();
      return;
    }

    if (!dragPrefetchScheduled) {
      dragPrefetchScheduled = true;
      window.setTimeout(() => {
        dragPrefetchScheduled = false;
        lastDragPrefetchAt = performance.now();
        prefetchInMotionDirection();
      }, dragPrefetchIntervalMs);
    }
  });

  viewer.addHandler("zoom", () => {
    const zoom = viewer.viewport.getZoom(true);
    if (lastZoom !== null && Math.abs(zoom - lastZoom) > 0.03) {
      prefetchCenterGrid();
    }
    lastZoom = zoom;
  });
}
