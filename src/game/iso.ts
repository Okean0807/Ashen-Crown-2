export const MAP_SIZE = 42;
export const TILE_W = 64;
export const TILE_H = 32;
export const ELEV_STEP = 10;

export const MIN_ZOOM = 1.0;
export const MAX_ZOOM = 3.0;
export const DEFAULT_ZOOM = 1.25;

export interface Camera {
  x: number; // current world pixel x
  y: number; // current world pixel y
  zoom: number; // current zoom (1.0 - 3.0)
  targetX: number; // smoothed target world x
  targetY: number; // smoothed target world y
  targetZoom: number; // smoothed target zoom
  focalX: number | null; // screen-space focal point x during smooth zoom
  focalY: number | null; // screen-space focal point y during smooth zoom
  shake: number;
}

export function createCamera(x = 0, y = 0, zoom = DEFAULT_ZOOM): Camera {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return {
    x,
    y,
    zoom: z,
    targetX: x,
    targetY: y,
    targetZoom: z,
    focalX: null,
    focalY: null,
    shake: 0,
  };
}

/**
 * Convert continuous grid coordinates (gx, gy) and elevation to world-space pixel coordinates.
 */
export function gridToWorld(gx: number, gy: number, elevation = 1): { wx: number; wy: number } {
  const wx = (gx - gy) * (TILE_W * 0.5);
  const wy = (gx + gy) * (TILE_H * 0.5) - elevation * ELEV_STEP;
  return { wx, wy };
}

/**
 * Convert world-space pixel coordinates (assuming base elevation = 1) back to continuous grid coords.
 */
export function worldToGrid(wx: number, wy: number, elevation = 1): { gx: number; gy: number } {
  const adjY = wy + elevation * ELEV_STEP;
  const halfW = TILE_W * 0.5;
  const halfH = TILE_H * 0.5;
  const gx = (wx / halfW + adjY / halfH) * 0.5;
  const gy = (adjY / halfH - wx / halfW) * 0.5;
  return { gx, gy };
}

export function worldToScreen(
  wx: number,
  wy: number,
  cam: Camera,
  viewportW: number,
  viewportH: number
): { sx: number; sy: number } {
  const sx = (wx - cam.x) * cam.zoom + viewportW * 0.5;
  const sy = (wy - cam.y) * cam.zoom + viewportH * 0.5;
  return { sx, sy };
}

export function screenToWorld(
  sx: number,
  sy: number,
  cam: Camera,
  viewportW: number,
  viewportH: number
): { wx: number; wy: number } {
  const wx = (sx - viewportW * 0.5) / cam.zoom + cam.x;
  const wy = (sy - viewportH * 0.5) / cam.zoom + cam.y;
  return { wx, wy };
}

/**
 * Adjust camera zoom around a fixed screen-space focal point (sx, sy)
 * so the world coordinate beneath (sx, sy) stays anchored in place.
 */
export function zoomCameraAtScreenPoint(
  cam: Camera,
  nextZoom: number,
  sx: number,
  sy: number,
  viewportW: number,
  viewportH: number
): void {
  const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const worldBeforeX = (sx - viewportW * 0.5) / cam.zoom + cam.x;
  const worldBeforeY = (sy - viewportH * 0.5) / cam.zoom + cam.y;

  cam.zoom = clamped;
  cam.x = worldBeforeX - (sx - viewportW * 0.5) / clamped;
  cam.y = worldBeforeY - (sy - viewportH * 0.5) / clamped;
  cam.targetX = cam.x;
  cam.targetY = cam.y;
}

/**
 * Simultaneous pinch-to-zoom toward the midpoint between two fingers + two-finger pan.
 * Locks the world point beneath prevMid onto currMid at the new zoom level.
 */
export function pinchZoomCamera(
  cam: Camera,
  prevMidX: number,
  prevMidY: number,
  currMidX: number,
  currMidY: number,
  prevDist: number,
  currDist: number,
  viewportW: number,
  viewportH: number
): void {
  const safePrevDist = Math.max(8, prevDist);
  const scale = currDist / safePrevDist;
  const nextZoom = clamp(cam.zoom * scale, MIN_ZOOM, MAX_ZOOM);

  const worldAnchorX = (prevMidX - viewportW * 0.5) / cam.zoom + cam.x;
  const worldAnchorY = (prevMidY - viewportH * 0.5) / cam.zoom + cam.y;

  cam.zoom = nextZoom;
  cam.targetZoom = nextZoom;
  cam.x = worldAnchorX - (currMidX - viewportW * 0.5) / nextZoom;
  cam.y = worldAnchorY - (currMidY - viewportH * 0.5) / nextZoom;
  cam.targetX = cam.x;
  cam.targetY = cam.y;
  cam.focalX = null;
  cam.focalY = null;
}

export function distGrid(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

/**
 * Compute formation grid offsets around a target point for N units.
 */
export function computeFormationOffsets(count: number): Array<{ dx: number; dy: number }> {
  if (count <= 1) return [{ dx: 0, dy: 0 }];
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 0.88;
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const totalRows = Math.ceil(count / cols);
    offsets.push({
      dx: (col - (cols - 1) * 0.5) * spacing,
      dy: (row - (totalRows - 1) * 0.5) * spacing,
    });
  }
  return offsets;
}
