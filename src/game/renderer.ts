import {
  Camera,
  ELEV_STEP,
  MAP_SIZE,
  TILE_H,
  TILE_W,
  clamp,
  gridToWorld,
  screenToWorld,
  worldToGrid,
} from './iso';
import {
  BUILDING_BLUEPRINTS,
  Building,
  BuildingType,
  FloatingText,
  Particle,
  Projectile,
  Tile,
  Unit,
} from './types';

let cachedVignetteW = 0;
let cachedVignetteH = 0;
let cachedVignetteGrad: CanvasGradient | null = null;

export interface RenderState {
  tiles: Tile[][];
  units: Unit[];
  buildings: Building[];
  projectiles: Projectile[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  selectedUnitIds: Set<string>;
  selectedBuildingId: string | null;
  camera: Camera;
  time: number;
  buildMode: BuildingType | null;
  hoverGrid: { gx: number; gy: number } | null;
  canPlaceBuild: boolean;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
}

interface DrawItem {
  depth: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

function tileColor(t: Tile): { top: string; left: string; right: string } {
  const checker = (t.gx + t.gy) % 2 === 0;
  switch (t.terrain) {
    case 'water':
      return {
        top: checker ? '#1a4258' : '#173b4f',
        left: '#102938',
        right: '#133142',
      };
    case 'bridge':
      return {
        top: checker ? '#6f6556' : '#655b4d',
        left: '#4a4136',
        right: '#594f42',
      };
    case 'stone_road':
      return {
        top: checker ? '#56585c' : '#4e5054',
        left: '#3a3c40',
        right: '#44464b',
      };
    case 'ruin_floor':
      return {
        top: checker ? '#49524c' : '#414a44',
        left: '#2f3632',
        right: '#38403b',
      };
    case 'orc_dirt':
      return {
        top: checker ? '#4a3629' : '#423024',
        left: '#2f2119',
        right: '#38281e',
      };
    case 'forest_floor':
      return {
        top: checker ? '#253d29' : '#213725',
        left: '#19291b',
        right: '#1d3020',
      };
    case 'grass':
    default:
      return {
        top: checker ? '#345531' : '#2f4e2d',
        left: '#223820',
        right: '#284226',
      };
  }
}

function drawIsoDiamond(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  w: number,
  h: number
) {
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + w * 0.5, sy + h * 0.5);
  ctx.lineTo(sx, sy + h);
  ctx.lineTo(sx - w * 0.5, sy + h * 0.5);
  ctx.closePath();
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RenderState
) {
  const { tiles, units, buildings, projectiles, particles, floatingTexts, camera, time } = state;

  // Background void
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, width, height);

  // Camera shake offset
  const shakeX = camera.shake > 0.1 ? (Math.random() - 0.5) * camera.shake : 0;
  const shakeY = camera.shake > 0.1 ? (Math.random() - 0.5) * camera.shake : 0;

  ctx.save();
  ctx.translate(width * 0.5 + shakeX, height * 0.5 + shakeY);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  const halfW = TILE_W * 0.5;
  const halfH = TILE_H * 0.5;

  // Compute visible world bounds and exact isometric grid bounds to cull off-screen tiles
  const viewLeft = camera.x - (width * 0.5) / camera.zoom - TILE_W * 2;
  const viewRight = camera.x + (width * 0.5) / camera.zoom + TILE_W * 2;
  const viewTop = camera.y - (height * 0.5) / camera.zoom - TILE_H * 5;
  const viewBottom = camera.y + (height * 0.5) / camera.zoom + TILE_H * 5;

  const cTL = worldToGrid(viewLeft, viewTop, 1);
  const cTR = worldToGrid(viewRight, viewTop, 1);
  const cBL = worldToGrid(viewLeft, viewBottom, 1);
  const cBR = worldToGrid(viewRight, viewBottom, 1);
  const minGx = clamp(Math.floor(Math.min(cTL.gx, cTR.gx, cBL.gx, cBR.gx)) - 2, 0, MAP_SIZE - 1);
  const maxGx = clamp(Math.ceil(Math.max(cTL.gx, cTR.gx, cBL.gx, cBR.gx)) + 2, 0, MAP_SIZE - 1);
  const minGy = clamp(Math.floor(Math.min(cTL.gy, cTR.gy, cBL.gy, cBR.gy)) - 2, 0, MAP_SIZE - 1);
  const maxGy = clamp(Math.ceil(Math.max(cTL.gy, cTR.gy, cBL.gy, cBR.gy)) + 2, 0, MAP_SIZE - 1);

  // 1. Draw Terrain Tiles (back to front)
  for (let gy = minGy; gy <= maxGy; gy++) {
    for (let gx = minGx; gx <= maxGx; gx++) {
      const t = tiles[gy][gx];
      const { wx, wy } = gridToWorld(gx, gy, t.elevation);
      if (wx < viewLeft || wx > viewRight || wy < viewTop || wy > viewBottom) {
        continue;
      }

      if (t.fog === 0) {
        // Unexplored pitch-mist tile
        drawIsoDiamond(ctx, wx, wy, TILE_W + 1, TILE_H + 1);
        ctx.fillStyle = '#0d1017';
        ctx.fill();
        continue;
      }

      const pal = tileColor(t);
      const thickness = t.terrain === 'water' ? 4 : 10 + (t.elevation - 1) * ELEV_STEP;

      // Top face
      drawIsoDiamond(ctx, wx, wy, TILE_W + 0.8, TILE_H + 0.8);
      ctx.fillStyle = pal.top;
      ctx.fill();

      // Subtle tile grid outline for tactical clarity
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      // Water animated shimmer
      if (t.terrain === 'water') {
        const wave = Math.sin(time * 2.4 + gx * 0.7 + gy * 0.9);
        if (wave > 0.25) {
          ctx.strokeStyle = `rgba(125, 200, 235, ${(wave - 0.25) * 0.35})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(wx - 10, wy + halfH - 2);
          ctx.lineTo(wx + 10, wy + halfH + 2);
          ctx.stroke();
        }
      }

      // Bridge railings
      if (t.terrain === 'bridge') {
        ctx.strokeStyle = '#8b7e6a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wx - halfW + 4, wy + halfH);
        ctx.lineTo(wx, wy + 2);
        ctx.stroke();
      }

      // Exposed south/east edges for elevated tiles or map edges
      const southTile = tiles[gy + 1]?.[gx];
      const eastTile = tiles[gy]?.[gx + 1];
      if (!southTile || southTile.elevation < t.elevation || t.gy === MAP_SIZE - 1) {
        ctx.beginPath();
        ctx.moveTo(wx - halfW, wy + halfH);
        ctx.lineTo(wx, wy + TILE_H);
        ctx.lineTo(wx, wy + TILE_H + thickness);
        ctx.lineTo(wx - halfW, wy + halfH + thickness);
        ctx.closePath();
        ctx.fillStyle = pal.left;
        ctx.fill();
      }
      if (!eastTile || eastTile.elevation < t.elevation || t.gx === MAP_SIZE - 1) {
        ctx.beginPath();
        ctx.moveTo(wx, wy + TILE_H);
        ctx.lineTo(wx + halfW, wy + halfH);
        ctx.lineTo(wx + halfW, wy + halfH + thickness);
        ctx.lineTo(wx, wy + TILE_H + thickness);
        ctx.closePath();
        ctx.fillStyle = pal.right;
        ctx.fill();
      }

      // Grass / stone subtle detail
      if (t.terrain === 'grass' && (gx * 7 + gy * 13) % 5 === 0) {
        ctx.fillStyle = 'rgba(130, 175, 95, 0.22)';
        ctx.fillRect(wx - 4, wy + halfH - 2, 2, 4);
        ctx.fillRect(wx + 2, wy + halfH + 1, 2, 3);
      }

      // Shroud for explored-but-not-currently-visible tiles
      if (t.fog === 1) {
        drawIsoDiamond(ctx, wx, wy, TILE_W + 0.8, TILE_H + 0.8);
        ctx.fillStyle = 'rgba(8, 10, 16, 0.54)';
        ctx.fill();
      }
    }
  }

  // 2. Build Placement Ghost Preview
  if (state.buildMode && state.hoverGrid) {
    const bp = BUILDING_BLUEPRINTS[state.buildMode];
    if (bp) {
      const { gx, gy } = state.hoverGrid;
      for (let dy = 0; dy < bp.size; dy++) {
        for (let dx = 0; dx < bp.size; dx++) {
          const tx = gx + dx;
          const ty = gy + dy;
          if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
            const { wx, wy } = gridToWorld(tx, ty, tiles[ty][tx].elevation);
            drawIsoDiamond(ctx, wx, wy, TILE_W - 2, TILE_H - 1);
            ctx.fillStyle = state.canPlaceBuild
              ? 'rgba(46, 185, 110, 0.42)'
              : 'rgba(215, 58, 58, 0.45)';
            ctx.fill();
            ctx.strokeStyle = state.canPlaceBuild ? '#4ade80' : '#f87171';
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
        }
      }
    }
  }

  // 3. Collect Depth-Sorted Props, Buildings, Units, Projectiles
  const drawList: DrawItem[] = [];

  // Props
  for (let gy = minGy; gy <= maxGy; gy++) {
    for (let gx = minGx; gx <= maxGx; gx++) {
      const t = tiles[gy][gx];
      if (!t.prop || t.fog === 0) continue;
      const { wx, wy } = gridToWorld(gx, gy, t.elevation);
      if (wx < viewLeft || wx > viewRight || wy < viewTop || wy > viewBottom) continue;
      const cx = wx;
      const cy = wy + halfH;
      const isDimmed = t.fog === 1;
      drawList.push({
        depth: gx + gy + 0.15,
        draw: (c) => {
          c.save();
          if (isDimmed) c.globalAlpha = 0.55;
          drawProp(c, t, cx, cy, time);
          c.restore();
        },
      });
    }
  }

  // Buildings
  for (const b of buildings) {
    const centerGx = b.gx + b.size * 0.5 - 0.5;
    const centerGy = b.gy + b.size * 0.5 - 0.5;
    // Check fog of any covered tile
    let anyVisible = false;
    let anyExplored = false;
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const tile = tiles[b.gy + dy]?.[b.gx + dx];
        if (tile) {
          if (tile.fog === 2) anyVisible = true;
          if (tile.fog >= 1) anyExplored = true;
        }
      }
    }
    if (!anyExplored) continue;

    const { wx, wy } = gridToWorld(centerGx, centerGy, 1);
    if (wx < viewLeft - 90 || wx > viewRight + 90 || wy < viewTop - 120 || wy > viewBottom + 90) {
      continue;
    }

    const selected = state.selectedBuildingId === b.id;
    drawList.push({
      depth: b.gx + b.size - 0.35 + (b.gy + b.size - 0.35),
      draw: (c) => {
        c.save();
        if (!anyVisible) c.globalAlpha = 0.6;
        drawBuilding(c, b, wx, wy + halfH, selected, time);
        c.restore();
      },
    });
  }

  // Units
  for (const u of units) {
    if (u.deadTimer && u.deadTimer > 0) continue;
    const tgX = Math.floor(u.x);
    const tgY = Math.floor(u.y);
    const tile = tiles[tgY]?.[tgX];
    if (u.faction === 'orc' && (!tile || tile.fog < 2)) continue;

    const elev = tile ? tile.elevation : 1;
    const { wx, wy } = gridToWorld(u.x, u.y, elev);
    if (wx < viewLeft - 40 || wx > viewRight + 40 || wy < viewTop - 60 || wy > viewBottom + 40) {
      continue;
    }

    const selected = state.selectedUnitIds.has(u.id);
    drawList.push({
      depth: u.x + u.y + 0.25,
      draw: (c) => drawUnit(c, u, wx, wy + halfH * 0.5, selected, time),
    });
  }

  // Projectiles
  for (const p of projectiles) {
    const { wx, wy } = gridToWorld(p.x, p.y, 1);
    drawList.push({
      depth: p.x + p.y + 1.1,
      draw: (c) => drawProjectile(c, p, wx, wy + halfH * 0.5 - p.z),
    });
  }

  drawList.sort((a, b) => a.depth - b.depth);
  for (const item of drawList) {
    item.draw(ctx);
  }

  // 4. Particles (rendered on top of units for crisp impact feedback)
  for (const pt of particles) {
    const { wx, wy } = gridToWorld(pt.x, pt.y, 1);
    const alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pt.kind === 'ring') {
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 2.2;
      const r = pt.size * (1 + (1 - alpha) * 2.2);
      ctx.beginPath();
      ctx.ellipse(wx, wy + halfH * 0.5 - pt.z, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(wx, wy + halfH * 0.5 - pt.z, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Floating Damage / Resource Texts
  ctx.textAlign = 'center';
  for (const ft of floatingTexts) {
    const { wx, wy } = gridToWorld(ft.x, ft.y, 1);
    const alpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#090b0f';
    ctx.fillText(ft.text, wx + 1, wy - ft.z + 1);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, wx, wy - ft.z);
    ctx.restore();
  }

  ctx.restore();

  // 6. Subtle Cached Vignette for Dark Fantasy Atmosphere
  if (!cachedVignetteGrad || cachedVignetteW !== width || cachedVignetteH !== height) {
    cachedVignetteW = width;
    cachedVignetteH = height;
    const grad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.32,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.78
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(6,8,12,0.42)');
    cachedVignetteGrad = grad;
  }
  ctx.fillStyle = cachedVignetteGrad;
  ctx.fillRect(0, 0, width, height);

  // 7. Selection Marquee Box (screen space)
  if (state.marquee) {
    const { x0, y0, x1, y1 } = state.marquee;
    const rx = Math.min(x0, x1);
    const ry = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0);
    const rh = Math.abs(y1 - y0);
    if (rw > 4 || rh > 4) {
      ctx.save();
      ctx.fillStyle = 'rgba(196, 154, 69, 0.16)';
      ctx.strokeStyle = '#d4af5a';
      ctx.lineWidth = 1.5;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }
}

function drawProp(
  ctx: CanvasRenderingContext2D,
  t: Tile,
  cx: number,
  cy: number,
  time: number
) {
  const sway = Math.sin(time * 1.7 + t.gx * 0.9 + t.gy * 0.6) * 1.6;
  switch (t.prop) {
    case 'tree_pine': {
      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(cx + 3, cy + 2, 13, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Trunk
      ctx.fillStyle = '#473020';
      ctx.fillRect(cx - 2.5, cy - 14, 5, 15);
      // 3 Pine tiers
      const tiers = [
        { y: -11, w: 15, h: 17, col: '#183a24' },
        { y: -21, w: 12, h: 16, col: '#1f492d' },
        { y: -30, w: 9, h: 14, col: '#285a38' },
      ];
      for (const tier of tiers) {
        ctx.fillStyle = tier.col;
        ctx.beginPath();
        ctx.moveTo(cx + sway * 0.7, cy + tier.y - tier.h);
        ctx.lineTo(cx + tier.w + sway * 0.3, cy + tier.y);
        ctx.lineTo(cx - tier.w + sway * 0.3, cy + tier.y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'tree_oak': {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + 2, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4d3522';
      ctx.fillRect(cx - 3, cy - 16, 6, 17);
      // Canopy clusters
      ctx.fillStyle = '#1f4225';
      ctx.beginPath();
      ctx.arc(cx - 7 + sway * 0.5, cy - 20, 10, 0, Math.PI * 2);
      ctx.arc(cx + 7 + sway * 0.5, cy - 19, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2d5c33';
      ctx.beginPath();
      ctx.arc(cx + sway * 0.6, cy - 26, 11.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b7341';
      ctx.beginPath();
      ctx.arc(cx - 2 + sway * 0.6, cy - 29, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'rock': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + 2, 15, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#535861';
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy + 1);
      ctx.lineTo(cx - 8, cy - 14);
      ctx.lineTo(cx + 4, cy - 17);
      ctx.lineTo(cx + 14, cy - 2);
      ctx.lineTo(cx + 6, cy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6c727d';
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - 14);
      ctx.lineTo(cx + 4, cy - 17);
      ctx.lineTo(cx + 2, cy - 4);
      ctx.lineTo(cx - 10, cy - 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'gold_vein': {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 16, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f3d42';
      ctx.beginPath();
      ctx.moveTo(cx - 15, cy + 1);
      ctx.lineTo(cx - 9, cy - 13);
      ctx.lineTo(cx + 3, cy - 16);
      ctx.lineTo(cx + 15, cy - 1);
      ctx.lineTo(cx + 4, cy + 5);
      ctx.closePath();
      ctx.fill();
      // Gleaming Gold Crystals
      const glint = 0.75 + Math.sin(time * 3.5 + t.gx) * 0.25;
      ctx.fillStyle = `rgba(245, 190, 55, ${glint})`;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 4);
      ctx.lineTo(cx - 2, cy - 14);
      ctx.lineTo(cx + 3, cy - 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 3, cy - 2);
      ctx.lineTo(cx + 8, cy - 11);
      ctx.lineTo(cx + 11, cy - 1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'stone_quarry': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#68717a';
      ctx.fillRect(cx - 12, cy - 10, 12, 11);
      ctx.fillStyle = '#848e99';
      ctx.fillRect(cx - 12, cy - 10, 12, 4);
      ctx.fillStyle = '#5a636c';
      ctx.fillRect(cx + 1, cy - 14, 11, 15);
      ctx.fillStyle = '#7b8591';
      ctx.fillRect(cx + 1, cy - 14, 11, 4);
      break;
    }
    case 'ruin_pillar': {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 11, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#696e67';
      ctx.fillRect(cx - 6, cy - 26, 12, 27);
      ctx.fillStyle = '#82887f';
      ctx.fillRect(cx - 8, cy - 28, 16, 4);
      ctx.fillStyle = '#3b5e3f'; // moss
      ctx.fillRect(cx - 6, cy - 10, 5, 8);
      break;
    }
    case 'ruin_arch': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#636861';
      ctx.fillRect(cx - 12, cy - 26, 6, 27);
      ctx.fillRect(cx + 6, cy - 26, 6, 27);
      ctx.fillStyle = '#777d75';
      ctx.fillRect(cx - 14, cy - 30, 28, 6);
      break;
    }
    case 'chest': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!t.chestLooted) {
        const pulse = 0.25 + Math.sin(time * 4) * 0.15;
        ctx.fillStyle = `rgba(245, 195, 70, ${pulse})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 4, 14, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = t.chestLooted ? '#4a3a2a' : '#7c4e24';
      ctx.fillRect(cx - 8, cy - 9, 16, 10);
      ctx.fillStyle = t.chestLooted ? '#5b5e63' : '#e0b341';
      ctx.fillRect(cx - 8, cy - 5, 16, 2.5);
      ctx.fillRect(cx - 2, cy - 9, 4, 10);
      break;
    }
    case 'bindstone': {
      const glow = 0.45 + Math.sin(time * 2.8) * 0.2;
      ctx.fillStyle = `rgba(70, 175, 255, ${glow * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4c5563';
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy + 1);
      ctx.lineTo(cx - 5, cy - 28);
      ctx.lineTo(cx, cy - 35);
      ctx.lineTo(cx + 5, cy - 28);
      ctx.lineTo(cx + 7, cy + 1);
      ctx.closePath();
      ctx.fill();
      // Glowing rune
      ctx.strokeStyle = `rgba(110, 210, 255, ${glow + 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 24);
      ctx.lineTo(cx - 3, cy - 16);
      ctx.lineTo(cx + 3, cy - 12);
      ctx.lineTo(cx, cy - 6);
      ctx.stroke();
      break;
    }
    case 'campfire': {
      ctx.fillStyle = '#3d2a1d';
      ctx.fillRect(cx - 8, cy - 2, 16, 4);
      const flicker = Math.sin(time * 12 + t.gx) * 2;
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx + flicker * 0.5, cy - 16 - flicker);
      ctx.lineTo(cx + 6, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy);
      ctx.lineTo(cx, cy - 10 - flicker * 0.5);
      ctx.lineTo(cx + 3, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'orc_totem': {
      ctx.fillStyle = '#3b2418';
      ctx.fillRect(cx - 3, cy - 26, 6, 27);
      ctx.fillStyle = '#a8322d';
      ctx.fillRect(cx - 8, cy - 22, 16, 4);
      ctx.fillStyle = '#e5dcc8'; // skull
      ctx.beginPath();
      ctx.arc(cx, cy - 27, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  b: Building,
  cx: number,
  cy: number,
  selected: boolean,
  time: number
) {
  const is2x2 = b.size === 2;
  const rx = is2x2 ? 42 : 22;
  const ry = is2x2 ? 21 : 11;

  // Selection ring
  if (selected) {
    ctx.strokeStyle = b.faction === 'human' ? '#f5c542' : '#ef4444';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, rx + 6, ry + 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 4, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();

  const prog = b.constructed ? 1 : Math.max(0.22, b.buildProgress);
  const scaleY = prog;

  ctx.translate(cx, cy + 4);
  ctx.scale(1, scaleY);
  ctx.translate(-cx, -(cy + 4));

  if (b.type === 'town_hall') {
    // Stone Keep Base
    ctx.fillStyle = '#6c7078';
    ctx.fillRect(cx - 30, cy - 32, 60, 34);
    ctx.fillStyle = '#52565e';
    ctx.fillRect(cx, cy - 32, 30, 34);
    // Roof
    ctx.fillStyle = '#2c4268';
    ctx.beginPath();
    ctx.moveTo(cx - 35, cy - 32);
    ctx.lineTo(cx, cy - 60);
    ctx.lineTo(cx + 35, cy - 32);
    ctx.closePath();
    ctx.fill();
    // Central spire
    ctx.fillStyle = '#3a5482';
    ctx.fillRect(cx - 10, cy - 58, 20, 26);
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 58);
    ctx.lineTo(cx, cy - 72);
    ctx.lineTo(cx + 12, cy - 58);
    ctx.closePath();
    ctx.fill();
    // Door + warm windows
    ctx.fillStyle = '#3d2817';
    ctx.fillRect(cx - 8, cy - 16, 16, 18);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(cx - 22, cy - 24, 6, 8);
    ctx.fillRect(cx + 16, cy - 24, 6, 8);
  } else if (b.type === 'barracks') {
    ctx.fillStyle = '#665b4f';
    ctx.fillRect(cx - 28, cy - 26, 56, 28);
    ctx.fillStyle = '#8b3a32';
    ctx.beginPath();
    ctx.moveTo(cx - 32, cy - 26);
    ctx.lineTo(cx, cy - 48);
    ctx.lineTo(cx + 32, cy - 26);
    ctx.closePath();
    ctx.fill();
    // Shield emblem
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(cx, cy - 35, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#362315';
    ctx.fillRect(cx - 7, cy - 15, 14, 17);
  } else if (b.type === 'archer_range') {
    ctx.fillStyle = '#5c4b37';
    ctx.fillRect(cx - 26, cy - 22, 52, 24);
    ctx.fillStyle = '#2d5c3b';
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 22);
    ctx.lineTo(cx, cy - 42);
    ctx.lineTo(cx + 30, cy - 22);
    ctx.closePath();
    ctx.fill();
    // Archery target beside range
    ctx.fillStyle = '#e5dcc8';
    ctx.beginPath();
    ctx.arc(cx + 22, cy - 10, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(cx + 22, cy - 10, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.type === 'farm') {
    // Wheat patch
    ctx.fillStyle = '#a38232';
    ctx.fillRect(cx - 28, cy - 8, 26, 12);
    // Cottage
    ctx.fillStyle = '#75634d';
    ctx.fillRect(cx - 2, cy - 20, 26, 22);
    ctx.fillStyle = '#c49a45';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 20);
    ctx.lineTo(cx + 11, cy - 36);
    ctx.lineTo(cx + 28, cy - 20);
    ctx.closePath();
    ctx.fill();
  } else if (b.type === 'tower') {
    ctx.fillStyle = '#656b75';
    ctx.fillRect(cx - 12, cy - 40, 24, 42);
    ctx.fillStyle = '#7c838f';
    ctx.fillRect(cx - 15, cy - 46, 30, 8);
    // Torch brazier
    const fl = Math.sin(time * 10 + b.gx) * 1.5;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(cx, cy - 49 + fl * 0.4, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.type === 'orc_stronghold') {
    ctx.fillStyle = '#3b2e26';
    ctx.fillRect(cx - 32, cy - 30, 64, 32);
    // Palisade spikes
    ctx.fillStyle = '#5c4938';
    for (let sx = -30; sx <= 26; sx += 11) {
      ctx.beginPath();
      ctx.moveTo(cx + sx, cy - 30);
      ctx.lineTo(cx + sx + 4, cy - 44);
      ctx.lineTo(cx + sx + 8, cy - 30);
      ctx.closePath();
      ctx.fill();
    }
    // Red War Tent Roof
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy - 30);
    ctx.lineTo(cx, cy - 58);
    ctx.lineTo(cx + 24, cy - 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.fillRect(cx - 8, cy - 16, 16, 18);
  } else if (b.type === 'orc_tower') {
    ctx.fillStyle = '#47362b';
    ctx.fillRect(cx - 11, cy - 38, 22, 40);
    ctx.fillStyle = '#991b1b';
    ctx.fillRect(cx - 14, cy - 44, 28, 7);
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(cx, cy - 47, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Construction scaffolding overlay
  if (!b.constructed) {
    ctx.strokeStyle = '#d4a359';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 22, cy - 26, 44, 26);
    // Progress bar
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - 24, cy - 52, 48, 6);
    ctx.fillStyle = '#eab308';
    ctx.fillRect(cx - 23, cy - 51, 46 * b.buildProgress, 4);
  } else if (b.hp < b.maxHp || selected) {
    const bw = is2x2 ? 52 : 32;
    const bx = cx - bw * 0.5;
    const by = cy - (is2x2 ? 78 : 58);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = b.faction === 'human' ? '#22c55e' : '#ef4444';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * Math.max(0, b.hp / b.maxHp), 3);
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  cx: number,
  cy: number,
  selected: boolean,
  time: number
) {
  const isBoss = u.type === 'orc_commander';
  const isHero = u.type === 'hero';
  const scale = isBoss ? 1.38 : isHero ? 1.15 : 1.0;

  // Selection Halo
  if (selected) {
    ctx.strokeStyle = isHero ? '#facc15' : u.faction === 'human' ? '#34d399' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, 13 * scale, 6.5 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isHero) {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, 12 * scale, 6 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.36)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 2, 9 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const moving = Math.hypot(u.vx, u.vy) > 0.1;
  const bob = moving ? Math.abs(Math.sin(u.animTime * 11)) * 3 : Math.sin(time * 2.5 + u.animTime) * 0.6;
  const swing = u.attackAnimTimer > 0 ? Math.sin((u.attackAnimTimer / 0.25) * Math.PI) : 0;

  ctx.save();
  ctx.translate(cx, cy - bob);
  ctx.scale(u.facing * scale, scale);

  if (u.type === 'hero') {
    // Flowing crimson cape
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.lineTo(-12, -2);
    ctx.lineTo(-2, -3);
    ctx.closePath();
    ctx.fill();
    // Legs
    ctx.fillStyle = '#334155';
    ctx.fillRect(-4, -6, 3, 7);
    ctx.fillRect(1, -6, 3, 7);
    // Steel Breastplate + Gold trim
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-6, -19, 12, 14);
    ctx.fillStyle = '#eab308';
    ctx.fillRect(-6, -19, 12, 3);
    // Head + Crowned Helm
    ctx.fillStyle = '#e5c1a1';
    ctx.beginPath();
    ctx.arc(0, -23, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eab308';
    ctx.fillRect(-4.5, -28, 9, 3.5);
    // Broadsword
    ctx.save();
    ctx.translate(6, -13);
    ctx.rotate(-0.4 + swing * 1.6);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, -14, 2.8, 15);
    ctx.fillStyle = '#eab308';
    ctx.fillRect(-2, -1, 7, 2.5);
    ctx.restore();
  } else if (u.type === 'laborer') {
    ctx.fillStyle = '#473626';
    ctx.fillRect(-3.5, -6, 2.8, 7);
    ctx.fillRect(0.8, -6, 2.8, 7);
    ctx.fillStyle = '#927453';
    ctx.fillRect(-5, -16, 10, 11);
    ctx.fillStyle = '#e5c1a1';
    ctx.beginPath();
    ctx.arc(0, -20, 4, 0, Math.PI * 2);
    ctx.fill();
    // Carried resource indicator
    if (u.carryingKind) {
      ctx.fillStyle =
        u.carryingKind === 'gold' ? '#facc15' : u.carryingKind === 'wood' ? '#784c27' : '#94a3b8';
      ctx.fillRect(3, -15, 5, 5);
    } else {
      ctx.fillStyle = '#78716c';
      ctx.fillRect(4, -17, 2, 10);
    }
  } else if (u.type === 'swordsman') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(-4, -6, 3, 7);
    ctx.fillRect(1, -6, 3, 7);
    ctx.fillStyle = '#3b5998';
    ctx.fillRect(-5.5, -17, 11, 12);
    // Helm
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(0, -21, 4.2, 0, Math.PI * 2);
    ctx.fill();
    // Kite Shield
    ctx.fillStyle = '#1e3a8a';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-8, -16, 5, 9);
    ctx.strokeRect(-8, -16, 5, 9);
    // Sword
    ctx.save();
    ctx.translate(5, -12);
    ctx.rotate(-0.3 + swing * 1.4);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, -11, 2.2, 12);
    ctx.restore();
  } else if (u.type === 'archer') {
    ctx.fillStyle = '#3f3224';
    ctx.fillRect(-3.5, -6, 2.5, 7);
    ctx.fillRect(1, -6, 2.5, 7);
    ctx.fillStyle = '#2d6a3e';
    ctx.fillRect(-5, -17, 10, 12);
    // Hood
    ctx.fillStyle = '#1f4e2d';
    ctx.beginPath();
    ctx.arc(0, -21, 4.4, 0, Math.PI * 2);
    ctx.fill();
    // Longbow
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(4, -12, 8, -Math.PI * 0.45, Math.PI * 0.45);
    ctx.stroke();
  } else if (u.type === 'orc_warrior' || u.type === 'orc_commander') {
    ctx.fillStyle = '#2e241b';
    ctx.fillRect(-4.5, -7, 3.5, 8);
    ctx.fillRect(1, -7, 3.5, 8);
    // Broad green torso + iron armor
    ctx.fillStyle = isBoss ? '#3b5228' : '#4a6b31';
    ctx.fillRect(-6.5, -19, 13, 13);
    ctx.fillStyle = isBoss ? '#7f1d1d' : '#4b5563';
    ctx.fillRect(-7, -19, 14, 5);
    // Head
    ctx.fillStyle = '#537a36';
    ctx.beginPath();
    ctx.arc(0, -23, 4.8, 0, Math.PI * 2);
    ctx.fill();
    if (isBoss) {
      // Horned helm
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.moveTo(-4, -26);
      ctx.lineTo(-9, -33);
      ctx.lineTo(-2, -28);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, -26);
      ctx.lineTo(9, -33);
      ctx.lineTo(2, -28);
      ctx.fill();
    }
    // Cleaver / Waraxe
    ctx.save();
    ctx.translate(6, -13);
    ctx.rotate(-0.35 + swing * 1.5);
    ctx.fillStyle = '#574232';
    ctx.fillRect(0, -13, 2.5, 14);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(2, -13, isBoss ? 8 : 5, 6);
    ctx.restore();
  } else if (u.type === 'orc_archer') {
    ctx.fillStyle = '#2d231a';
    ctx.fillRect(-3.5, -6, 2.5, 7);
    ctx.fillRect(1, -6, 2.5, 7);
    ctx.fillStyle = '#4e6e35';
    ctx.fillRect(-5, -17, 10, 12);
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(-5, -13, 10, 3);
    ctx.fillStyle = '#537a36';
    ctx.beginPath();
    ctx.arc(0, -21, 4.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(4, -12, 7.5, -Math.PI * 0.45, Math.PI * 0.45);
    ctx.stroke();
  }

  ctx.restore();

  if (u.hitFlashTimer > 0) {
    ctx.fillStyle = 'rgba(255, 245, 220, 0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy - 14 * scale, 10 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Health Bar (shown when damaged, selected, hero, or boss)
  if (u.hp < u.maxHp || selected || isHero || isBoss) {
    const bw = isBoss ? 38 : isHero ? 30 : 22;
    const by = cy - (isBoss ? 48 : isHero ? 39 : 32);
    ctx.fillStyle = 'rgba(8, 10, 14, 0.82)';
    ctx.fillRect(cx - bw * 0.5, by, bw, 4);
    ctx.fillStyle =
      u.faction === 'human' ? (isHero ? '#facc15' : '#22c55e') : isBoss ? '#f97316' : '#ef4444';
    ctx.fillRect(cx - bw * 0.5 + 1, by + 1, (bw - 2) * Math.max(0, u.hp / u.maxHp), 2);
  }
}

function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, sx: number, sy: number) {
  const dx = p.targetX - p.startX;
  const dy = p.targetY - p.startY;
  const angle = Math.atan2(dx + dy, dx - dy);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.strokeStyle = p.kind === 'orc_arrow' ? '#fca5a5' : p.kind === 'bolt' ? '#fde047' : '#f8fafc';
  ctx.lineWidth = p.kind === 'bolt' ? 2.4 : 1.6;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(5, 0);
  ctx.stroke();
  ctx.restore();
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tiles: Tile[][],
  units: Unit[],
  buildings: Building[],
  camera: Camera,
  viewportW: number,
  viewportH: number
) {
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, w, h);

  const cellW = w / MAP_SIZE;
  const cellH = h / MAP_SIZE;

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const t = tiles[y][x];
      if (t.fog === 0) continue;
      let col = '#2a4628';
      if (t.terrain === 'water') col = '#1b4760';
      else if (t.terrain === 'bridge') col = '#8c7e6a';
      else if (t.terrain === 'orc_dirt') col = '#4a3327';
      else if (t.terrain === 'ruin_floor') col = '#4e5751';
      else if (t.prop === 'tree_pine' || t.prop === 'tree_oak') col = '#1a361f';
      else if (t.prop === 'gold_vein') col = '#d4a024';

      ctx.fillStyle = col;
      ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
      if (t.fog === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
  }

  for (const b of buildings) {
    const t = tiles[b.gy]?.[b.gx];
    if (!t || t.fog === 0) continue;
    ctx.fillStyle = b.faction === 'human' ? '#3b82f6' : '#dc2626';
    ctx.fillRect(b.gx * cellW, b.gy * cellH, b.size * cellW + 1, b.size * cellH + 1);
  }

  for (const u of units) {
    if (u.deadTimer && u.deadTimer > 0) continue;
    const t = tiles[Math.floor(u.y)]?.[Math.floor(u.x)];
    if (u.faction === 'orc' && (!t || t.fog < 2)) continue;
    ctx.fillStyle =
      u.type === 'hero'
        ? '#facc15'
        : u.type === 'orc_commander'
        ? '#f97316'
        : u.faction === 'human'
        ? '#4ade80'
        : '#ef4444';
    const r = u.type === 'hero' || u.type === 'orc_commander' ? 3 : 2;
    ctx.fillRect(u.x * cellW - r * 0.5, u.y * cellH - r * 0.5, r, r);
  }

  // Camera isometric viewport polygon on minimap
  const corners = [
    screenToWorld(0, 0, camera, viewportW, viewportH),
    screenToWorld(viewportW, 0, camera, viewportW, viewportH),
    screenToWorld(viewportW, viewportH, camera, viewportW, viewportH),
    screenToWorld(0, viewportH, camera, viewportW, viewportH),
  ].map((p) => worldToGrid(p.wx, p.wy, 1));

  ctx.strokeStyle = 'rgba(234, 227, 210, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  corners.forEach((pt, idx) => {
    const mx = pt.gx * cellW;
    const my = pt.gy * cellH;
    if (idx === 0) ctx.moveTo(mx, my);
    else ctx.lineTo(mx, my);
  });
  ctx.closePath();
  ctx.stroke();
}
