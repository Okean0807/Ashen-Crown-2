/**
 * ASHEN CROWN — Процедурные PBR-текстуры стиля Stylized 3D Dark Fantasy (Three.js).
 * Все карты (512×512 / 256×256) генерируются детерминированно в памяти без внешних ассетов
 * и разделяются по цветовому пространству (SRGBColorSpace для albedo, NoColorSpace для bump).
 */

import * as THREE from 'three';

export interface WorldTextureSet {
  terrainDetail: THREE.CanvasTexture;
  terrainBump: THREE.CanvasTexture;
  masonry: THREE.CanvasTexture;
  masonryBump: THREE.CanvasTexture;
  roofSlate: THREE.CanvasTexture;
  roofBump: THREE.CanvasTexture;
  timber: THREE.CanvasTexture;
  timberBump: THREE.CanvasTexture;
  bark: THREE.CanvasTexture;
  waterBump: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  runeRing: THREE.CanvasTexture;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function makeTiledTexture(
  canvas: HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  isColor: boolean,
  maxAniso: number
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(4, maxAniso);
  tex.needsUpdate = true;
  return tex;
}

export function createWorldTextures(maxAnisotropy = 4): WorldTextureSet {
  const maxAniso = Math.max(1, maxAnisotropy);
  const rand = seededRand(142099);

  // 1. Stylized painterly dark-fantasy terrain micro-detail + bump (512x512)
  // Neutral luminance (~212) so per-vertex biome colors remain accurate & rich.
  const [tCanvas, tCtx] = createCanvas(512);
  const [tbCanvas, tbCtx] = createCanvas(512);
  tCtx.fillStyle = '#dad8cf';
  tCtx.fillRect(0, 0, 512, 512);
  tbCtx.fillStyle = '#808080';
  tbCtx.fillRect(0, 0, 512, 512);

  // Broad organic soil/moss blotches (seamless wrap via modulo offsets)
  for (let i = 0; i < 240; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 10 + rand() * 26;
    const bright = rand() > 0.48;
    const shade = bright ? 232 + Math.floor(rand() * 20) : 168 + Math.floor(rand() * 24);
    const bv = bright ? 150 + Math.floor(rand() * 30) : 95 + Math.floor(rand() * 25);
    for (const ox of [-512, 0, 512]) {
      for (const oy of [-512, 0, 512]) {
        if (x + ox + r < 0 || x + ox - r > 512 || y + oy + r < 0 || y + oy - r > 512) continue;
        const grad = tCtx.createRadialGradient(x + ox, y + oy, 1, x + ox, y + oy, r);
        grad.addColorStop(0, `rgba(${shade},${shade},${shade - 6},0.22)`);
        grad.addColorStop(1, `rgba(${shade},${shade},${shade - 6},0)`);
        tCtx.fillStyle = grad;
        tCtx.beginPath();
        tCtx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        tCtx.fill();

        const bGrad = tbCtx.createRadialGradient(x + ox, y + oy, 1, x + ox, y + oy, r);
        bGrad.addColorStop(0, `rgba(${bv},${bv},${bv},0.35)`);
        bGrad.addColorStop(1, `rgba(128,128,128,0)`);
        tbCtx.fillStyle = bGrad;
        tbCtx.beginPath();
        tbCtx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        tbCtx.fill();
      }
    }
  }

  // Stylized grass tuft strokes & soil cracks
  for (let i = 0; i < 2400; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const len = 4 + rand() * 8;
    const tilt = (rand() - 0.5) * 4;
    const light = rand() > 0.45;
    tCtx.strokeStyle = light ? 'rgba(255,252,238,0.22)' : 'rgba(54,48,38,0.22)';
    tCtx.lineWidth = 1.1;
    tCtx.beginPath();
    tCtx.moveTo(x, y);
    tCtx.lineTo(x + tilt, y - len);
    tCtx.stroke();

    tbCtx.strokeStyle = light ? 'rgba(182,182,182,0.4)' : 'rgba(72,72,72,0.38)';
    tbCtx.lineWidth = 1.2;
    tbCtx.beginPath();
    tbCtx.moveTo(x, y);
    tbCtx.lineTo(x + tilt, y - len);
    tbCtx.stroke();
  }

  // Tiny embedded pebbles
  for (let i = 0; i < 340; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const rx = 1.6 + rand() * 3.2;
    const ry = 1.2 + rand() * 2.2;
    const tone = 148 + Math.floor(rand() * 58);
    tCtx.fillStyle = `rgba(${tone},${tone - 2},${tone - 6},0.48)`;
    tCtx.beginPath();
    tCtx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    tCtx.fill();

    tbCtx.fillStyle = 'rgba(215,215,215,0.65)';
    tbCtx.beginPath();
    tbCtx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    tbCtx.fill();
  }

  const terrainDetail = makeTiledTexture(tCanvas, 16, 16, true, maxAniso);
  const terrainBump = makeTiledTexture(tbCanvas, 16, 16, false, maxAniso);

  // 2. Stylized Dressed Dark-Fantasy Stone Masonry (512x512 color + bump)
  const [mCanvas, mCtx] = createCanvas(512);
  const [mbCanvas, mbCtx] = createCanvas(512);
  mCtx.fillStyle = '#3f3d38';
  mCtx.fillRect(0, 0, 512, 512);
  mbCtx.fillStyle = '#242424';
  mbCtx.fillRect(0, 0, 512, 512);

  const rows = 10;
  const rowH = 512 / rows;
  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * 44 + ((row * 17) % 19);
    let x = -64 + (offset % 64);
    while (x < 540) {
      const bw = 62 + Math.floor(rand() * 36);
      const bh = rowH - 4;
      const by = row * rowH + 2;
      const tone = 128 + Math.floor((rand() - 0.5) * 42);
      const warm = Math.floor((rand() - 0.5) * 18);
      const mossChance = rand();

      // Base ashlar stone block
      mCtx.fillStyle = `rgb(${tone + warm},${tone + Math.floor(warm * 0.55)},${tone - 4})`;
      mCtx.fillRect(x + 2, by, bw - 4, bh);

      // Stone surface weathering grain
      for (let g = 0; g < 16; g++) {
        const gx = x + 4 + rand() * (bw - 8);
        const gy = by + 2 + rand() * (bh - 4);
        const gt = tone + (rand() > 0.5 ? 18 : -22);
        mCtx.fillStyle = `rgba(${gt},${gt},${gt},0.22)`;
        mCtx.fillRect(gx, gy, 3 + rand() * 8, 2 + rand() * 5);
      }

      // Chiseled bevel highlight & deep shadow edge
      mCtx.fillStyle = 'rgba(255,248,232,0.18)';
      mCtx.fillRect(x + 2, by, bw - 4, 3.5);
      mCtx.fillRect(x + 2, by, 2.5, bh);
      mCtx.fillStyle = 'rgba(12,11,10,0.34)';
      mCtx.fillRect(x + 2, by + bh - 3.5, bw - 4, 3.5);
      mCtx.fillRect(x + bw - 5, by, 3, bh);

      // Subtle hairline crack or moss wisp on select blocks
      if (mossChance < 0.14) {
        mCtx.fillStyle = 'rgba(64,96,52,0.38)';
        mCtx.fillRect(x + 3, by + bh - 8, (bw - 8) * (0.4 + rand() * 0.5), 6);
      } else if (mossChance > 0.86) {
        mCtx.strokeStyle = 'rgba(24,22,20,0.45)';
        mCtx.lineWidth = 1.2;
        mCtx.beginPath();
        mCtx.moveTo(x + bw * 0.3, by + 2);
        mCtx.lineTo(x + bw * 0.45, by + bh * 0.55);
        mCtx.lineTo(x + bw * 0.38, by + bh - 2);
        mCtx.stroke();
      }

      // Bump block with beveled inner face
      const bv = 175 + Math.floor((rand() - 0.5) * 40);
      mbCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
      mbCtx.fillRect(x + 3, by + 1, bw - 6, bh - 2);
      mbCtx.strokeStyle = 'rgba(80,80,80,0.6)';
      mbCtx.lineWidth = 2;
      mbCtx.strokeRect(x + 3, by + 1, bw - 6, bh - 2);

      x += bw;
    }
  }
  const masonry = makeTiledTexture(mCanvas, 2, 2, true, maxAniso);
  const masonryBump = makeTiledTexture(mbCanvas, 2, 2, false, maxAniso);

  // 3. Layered Dark-Fantasy Slate Roof Shingles (512x512 color + bump)
  const [rCanvas, rCtx] = createCanvas(512);
  const [rbCanvas, rbCtx] = createCanvas(512);
  rCtx.fillStyle = '#1b2638';
  rCtx.fillRect(0, 0, 512, 512);
  rbCtx.fillStyle = '#303030';
  rbCtx.fillRect(0, 0, 512, 512);

  const sRows = 14;
  const sH = 512 / sRows;
  for (let row = 0; row < sRows; row++) {
    const off = (row % 2) * 22;
    for (let col = -1; col < 13; col++) {
      const sx = col * 44 + off;
      const sy = row * sH;
      const base = 58 + Math.floor(rand() * 34);
      rCtx.fillStyle = `rgb(${base},${base + 16},${base + 34})`;
      rCtx.fillRect(sx + 1, sy + 1, 42, sH - 2);

      // Subtle weathered highlight on upper edge + deep lip shadow
      rCtx.fillStyle = 'rgba(215,232,255,0.13)';
      rCtx.fillRect(sx + 2, sy + 1, 40, 2.5);
      rCtx.fillStyle = 'rgba(6,8,14,0.48)';
      rCtx.fillRect(sx + 1, sy + sH - 4, 42, 4);
      rCtx.fillStyle = 'rgba(6,8,14,0.28)';
      rCtx.fillRect(sx + 41, sy + 1, 2, sH - 2);

      const bv = 160 + Math.floor(rand() * 55);
      rbCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
      rbCtx.fillRect(sx + 2, sy + 2, 40, sH - 5);
    }
  }
  const roofSlate = makeTiledTexture(rCanvas, 2, 2, true, maxAniso);
  const roofBump = makeTiledTexture(rbCanvas, 2, 2, false, maxAniso);

  // 4. Heavy Seasoned Timber Planks with Woodgrain & Iron Nail Heads (512x512 color + bump)
  const [wCanvas, wCtx] = createCanvas(512);
  const [wb2Canvas, wb2Ctx] = createCanvas(512);
  wCtx.fillStyle = '#4e331f';
  wCtx.fillRect(0, 0, 512, 512);
  wb2Ctx.fillStyle = '#383838';
  wb2Ctx.fillRect(0, 0, 512, 512);

  for (let p = 0; p < 10; p++) {
    const py = p * (512 / 10);
    const ph = 512 / 10;
    const tone = 82 + Math.floor((rand() - 0.5) * 26);
    wCtx.fillStyle = `rgb(${tone + 26},${tone + 4},${Math.floor(tone * 0.62)})`;
    wCtx.fillRect(0, py + 1.5, 512, ph - 3);
    wb2Ctx.fillStyle = `rgb(${155 + Math.floor(rand() * 35)},${155 + Math.floor(rand() * 35)},${155 + Math.floor(rand() * 35)})`;
    wb2Ctx.fillRect(0, py + 2, 512, ph - 4);

    // Rich directional wood grain fibers
    for (let g = 0; g < 26; g++) {
      const gy = py + 3 + rand() * (ph - 6);
      const bright = rand() > 0.45;
      wCtx.strokeStyle = bright ? 'rgba(255,220,175,0.1)' : 'rgba(26,12,4,0.22)';
      wCtx.lineWidth = 1.2;
      wCtx.beginPath();
      wCtx.moveTo(0, gy);
      wCtx.bezierCurveTo(170, gy + (rand() - 0.5) * 7, 340, gy + (rand() - 0.5) * 7, 512, gy);
      wCtx.stroke();

      wb2Ctx.strokeStyle = bright ? 'rgba(200,200,200,0.3)' : 'rgba(70,70,70,0.32)';
      wb2Ctx.beginPath();
      wb2Ctx.moveTo(0, gy);
      wb2Ctx.bezierCurveTo(170, gy + (rand() - 0.5) * 6, 340, gy + (rand() - 0.5) * 6, 512, gy);
      wb2Ctx.stroke();
    }

    // Plank seam + occasional forged iron rivets
    wCtx.fillStyle = 'rgba(18,8,3,0.6)';
    wCtx.fillRect(0, py + ph - 2.5, 512, 2.5);
    for (const nx of [26, 256, 486]) {
      wCtx.fillStyle = 'rgba(30,32,38,0.75)';
      wCtx.beginPath();
      wCtx.arc(nx, py + ph * 0.5, 3, 0, Math.PI * 2);
      wCtx.fill();
    }
  }
  const timber = makeTiledTexture(wCanvas, 2, 2, true, maxAniso);
  const timberBump = makeTiledTexture(wb2Canvas, 2, 2, false, maxAniso);

  // 5. Furrowed Forest Tree Bark (256x256)
  const [bkCanvas, bkCtx] = createCanvas(256);
  bkCtx.fillStyle = '#473222';
  bkCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const x = rand() * 256;
    const w = 2 + rand() * 6;
    const dark = rand() > 0.42;
    bkCtx.fillStyle = dark ? 'rgba(26,16,9,0.45)' : 'rgba(116,86,60,0.28)';
    bkCtx.fillRect(x, 0, w, 256);
  }
  const bark = makeTiledTexture(bkCanvas, 2, 2, true, maxAniso);

  // 6. Seamless Water Ripple Bump Map (256x256)
  const [wRippleCanvas, wRippleCtx] = createCanvas(256);
  wRippleCtx.fillStyle = '#808080';
  wRippleCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    for (let x = 0; x < 256; x += 2) {
      const u = (x / 256) * Math.PI * 2;
      const v = (y / 256) * Math.PI * 2;
      const wave =
        Math.sin(u * 4 + Math.cos(v * 3) * 1.5) * 0.45 +
        Math.cos(v * 5 + Math.sin(u * 2) * 1.1) * 0.35 +
        Math.sin((u + v) * 6) * 0.2;
      const val = Math.floor(128 + wave * 64);
      wRippleCtx.fillStyle = `rgb(${val},${val},${val})`;
      wRippleCtx.fillRect(x, y, 2, 2);
    }
  }
  const waterBump = makeTiledTexture(wRippleCanvas, 12, 12, false, maxAniso);

  // 7. Grounding Soft Contact Shadow Decal (128x128)
  const [csCanvas, csCtx] = createCanvas(128);
  const grad = csCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6,8,14,0.68)');
  grad.addColorStop(0.45, 'rgba(6,8,14,0.36)');
  grad.addColorStop(0.8, 'rgba(6,8,14,0.1)');
  grad.addColorStop(1, 'rgba(6,8,14,0)');
  csCtx.fillStyle = grad;
  csCtx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(csCanvas);
  contactShadow.colorSpace = THREE.SRGBColorSpace;

  // 8. Ornate Runic Arcane Circle Texture (256x256)
  const [rrCanvas, rrCtx] = createCanvas(256);
  rrCtx.clearRect(0, 0, 256, 256);
  const ringGrad = rrCtx.createRadialGradient(128, 128, 40, 128, 128, 120);
  ringGrad.addColorStop(0, 'rgba(125,211,252,0.16)');
  ringGrad.addColorStop(0.75, 'rgba(125,211,252,0.06)');
  ringGrad.addColorStop(1, 'rgba(125,211,252,0)');
  rrCtx.fillStyle = ringGrad;
  rrCtx.beginPath();
  rrCtx.arc(128, 128, 120, 0, Math.PI * 2);
  rrCtx.fill();

  rrCtx.strokeStyle = 'rgba(186,230,253,0.95)';
  rrCtx.lineWidth = 4;
  rrCtx.beginPath();
  rrCtx.arc(128, 128, 110, 0, Math.PI * 2);
  rrCtx.stroke();

  rrCtx.lineWidth = 2;
  rrCtx.strokeStyle = 'rgba(125,211,252,0.8)';
  rrCtx.beginPath();
  rrCtx.arc(128, 128, 86, 0, Math.PI * 2);
  rrCtx.stroke();

  rrCtx.beginPath();
  rrCtx.arc(128, 128, 62, 0, Math.PI * 2);
  rrCtx.stroke();

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    rrCtx.beginPath();
    rrCtx.moveTo(128 + Math.cos(a) * 87, 128 + Math.sin(a) * 87);
    rrCtx.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
    rrCtx.stroke();
    if (i % 2 === 0) {
      const a2 = a + Math.PI / 8;
      rrCtx.beginPath();
      rrCtx.moveTo(128 + Math.cos(a) * 64, 128 + Math.sin(a) * 64);
      rrCtx.lineTo(128 + Math.cos(a2) * 84, 128 + Math.sin(a2) * 84);
      rrCtx.stroke();
    }
  }
  const runeRing = new THREE.CanvasTexture(rrCanvas);
  runeRing.colorSpace = THREE.SRGBColorSpace;

  const all = [
    terrainDetail,
    terrainBump,
    masonry,
    masonryBump,
    roofSlate,
    roofBump,
    timber,
    timberBump,
    bark,
    waterBump,
    contactShadow,
    runeRing,
  ];

  return {
    terrainDetail,
    terrainBump,
    masonry,
    masonryBump,
    roofSlate,
    roofBump,
    timber,
    timberBump,
    bark,
    waterBump,
    contactShadow,
    runeRing,
    dispose: () => {
      for (const tex of all) tex.dispose();
    },
  };
}
