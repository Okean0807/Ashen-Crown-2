import * as THREE from 'three';

export interface CharacterTextures {
  steelMap: THREE.CanvasTexture;
  steelNormal: THREE.CanvasTexture;
  steelRoughness: THREE.CanvasTexture;
  steelMetalness: THREE.CanvasTexture;

  trimMap: THREE.CanvasTexture;
  trimNormal: THREE.CanvasTexture;
  trimRoughness: THREE.CanvasTexture;

  skinMap: THREE.CanvasTexture;
  skinNormal: THREE.CanvasTexture;
  skinRoughness: THREE.CanvasTexture;

  eyeMap: THREE.CanvasTexture;

  cloakMap: THREE.CanvasTexture;
  cloakNormal: THREE.CanvasTexture;
  cloakRoughness: THREE.CanvasTexture;

  leatherMap: THREE.CanvasTexture;
  leatherNormal: THREE.CanvasTexture;
  leatherRoughness: THREE.CanvasTexture;

  bladeMap: THREE.CanvasTexture;
  bladeNormal: THREE.CanvasTexture;
  bladeRoughness: THREE.CanvasTexture;
  bladeEmissive: THREE.CanvasTexture;

  hairMap: THREE.CanvasTexture;
  hairNormal: THREE.CanvasTexture;

  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finalizeColorTex(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function finalizeLinearTex(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function heightCanvasToNormal(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const ctx = heightCanvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, w, h).data;
  const [normCanvas, normCtx] = makeCanvas(w);
  const imgData = normCtx.createImageData(w, h);
  const out = imgData.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dHdu = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dHdv = (tl + 2 * t + tr - (bl + 2 * b + br)) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.sqrt(dHdu * dHdu + dHdv * dHdv + dz * dz);

      const idx = (y * w + x) * 4;
      out[idx] = Math.round((-dHdu * invLen * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((-dHdv * invLen * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  normCtx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(normCanvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createCharacterTextures(maxAnisotropy = 4): CharacterTextures {
  const rand = seededRand(84721);

  // 1. WEATHERED FORGED STEEL PLATE (1024x1024) — clean satin finish with subtle patina & controlled battle marks
  const S = 1024;
  const [steelC, steelCtx] = makeCanvas(S);
  const [steelHC, steelHCtx] = makeCanvas(S);
  const [steelRC, steelRCtx] = makeCanvas(S);
  const [steelMC, steelMCtx] = makeCanvas(S);

  steelCtx.fillStyle = '#7c828c';
  steelCtx.fillRect(0, 0, S, S);
  steelHCtx.fillStyle = '#808080';
  steelHCtx.fillRect(0, 0, S, S);
  steelRCtx.fillStyle = '#6c6c6c'; // ~0.42 base forged satin roughness
  steelRCtx.fillRect(0, 0, S, S);
  steelMCtx.fillStyle = '#dcdcdc'; // ~0.86 metalness
  steelMCtx.fillRect(0, 0, S, S);

  // Subtle broad armorer's hammer planishing (low-contrast tonal modulation, zero harsh spotting)
  for (let i = 0; i < 420; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rad = 22 + rand() * 48;
    const v = rand();
    steelCtx.fillStyle = v > 0.5 ? 'rgba(155,163,174,0.035)' : 'rgba(54,58,66,0.04)';
    steelCtx.beginPath();
    steelCtx.arc(x, y, rad, 0, Math.PI * 2);
    steelCtx.fill();

    steelHCtx.fillStyle = v > 0.5 ? 'rgba(152,152,152,0.05)' : 'rgba(104,104,104,0.05)';
    steelHCtx.beginPath();
    steelHCtx.arc(x, y, rad, 0, Math.PI * 2);
    steelHCtx.fill();

    steelRCtx.fillStyle = v > 0.5 ? 'rgba(130,130,130,0.06)' : 'rgba(85,85,85,0.05)';
    steelRCtx.beginPath();
    steelRCtx.arc(x, y, rad, 0, Math.PI * 2);
    steelRCtx.fill();
  }

  // Fine directional satin burnishing
  for (let i = 0; i < 900; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = 36 + rand() * 110;
    steelCtx.strokeStyle = rand() > 0.5 ? 'rgba(195,202,212,0.035)' : 'rgba(48,52,60,0.035)';
    steelCtx.lineWidth = 1;
    steelCtx.beginPath();
    steelCtx.moveTo(x, y);
    steelCtx.lineTo(x + len, y + (rand() - 0.5) * 4);
    steelCtx.stroke();
  }

  // Purposeful weathered battle nicks & fine scratches (restrained count & crisp bevels)
  for (let i = 0; i < 65; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const ang = (rand() - 0.5) * 1.1;
    const len = 18 + rand() * 54;
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;

    steelCtx.strokeStyle = 'rgba(38,42,48,0.42)';
    steelCtx.lineWidth = 1.1;
    steelCtx.beginPath();
    steelCtx.moveTo(x, y);
    steelCtx.lineTo(ex, ey);
    steelCtx.stroke();

    steelCtx.strokeStyle = 'rgba(198,205,214,0.34)';
    steelCtx.lineWidth = 0.8;
    steelCtx.beginPath();
    steelCtx.moveTo(x, y + 1.1);
    steelCtx.lineTo(ex, ey + 1.1);
    steelCtx.stroke();

    steelHCtx.strokeStyle = 'rgba(54,54,54,0.48)';
    steelHCtx.lineWidth = 1.3;
    steelHCtx.beginPath();
    steelHCtx.moveTo(x, y);
    steelHCtx.lineTo(ex, ey);
    steelHCtx.stroke();

    steelRCtx.strokeStyle = 'rgba(52,52,52,0.55)';
    steelRCtx.lineWidth = 1.2;
    steelRCtx.beginPath();
    steelRCtx.moveTo(x, y);
    steelRCtx.lineTo(ex, ey);
    steelRCtx.stroke();
  }

  // Subtle oil/soot darkening in lower recessed bands
  const patinaGrad = steelCtx.createLinearGradient(0, 0, 0, S);
  patinaGrad.addColorStop(0, 'rgba(30,32,38,0.04)');
  patinaGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  patinaGrad.addColorStop(1, 'rgba(22,24,28,0.12)');
  steelCtx.fillStyle = patinaGrad;
  steelCtx.fillRect(0, 0, S, S);

  // 2. DARKENED BRONZE / BRASS TRIM & RIVETS (512x512)
  const T = 512;
  const [trimC, trimCtx] = makeCanvas(T);
  const [trimHC, trimHCtx] = makeCanvas(T);
  const [trimRC, trimRCtx] = makeCanvas(T);
  trimCtx.fillStyle = '#6f5c41';
  trimCtx.fillRect(0, 0, T, T);
  trimHCtx.fillStyle = '#808080';
  trimHCtx.fillRect(0, 0, T, T);
  trimRCtx.fillStyle = '#686868'; // ~0.41 satin bronze
  trimRCtx.fillRect(0, 0, T, T);

  for (let i = 0; i < 240; i++) {
    const x = rand() * T;
    const y = rand() * T;
    trimCtx.fillStyle = rand() > 0.5 ? 'rgba(150,126,90,0.08)' : 'rgba(32,26,19,0.10)';
    trimCtx.beginPath();
    trimCtx.arc(x, y, 8 + rand() * 18, 0, Math.PI * 2);
    trimCtx.fill();
  }
  // Subtle engraved filigree border lines
  trimHCtx.strokeStyle = 'rgba(195,195,195,0.32)';
  trimHCtx.lineWidth = 2;
  for (let y = 32; y < T; y += 64) {
    trimHCtx.beginPath();
    trimHCtx.moveTo(0, y);
    trimHCtx.lineTo(T, y);
    trimHCtx.stroke();
  }

  // 3. REALISTIC WEATHERED HUMAN FACE & SKIN (1024x1024)
  // Eyes are now 3D sculpted eyeballs + eyelids; skinMap provides natural skin tone, stubble, brows, lips, and diagonal scar.
  const F = 1024;
  const [skinC, skinCtx] = makeCanvas(F);
  const [skinHC, skinHCtx] = makeCanvas(F);
  const [skinRC, skinRCtx] = makeCanvas(F);

  const skinGrad = skinCtx.createLinearGradient(0, 0, 0, F);
  skinGrad.addColorStop(0, '#c08c71');
  skinGrad.addColorStop(0.55, '#c89479');
  skinGrad.addColorStop(1, '#ae7b62');
  skinCtx.fillStyle = skinGrad;
  skinCtx.fillRect(0, 0, F, F);
  skinHCtx.fillStyle = '#808080';
  skinHCtx.fillRect(0, 0, F, F);
  skinRCtx.fillStyle = '#a4a4a4'; // ~0.64 natural matte skin roughness
  skinRCtx.fillRect(0, 0, F, F);

  // Subtle dermal pores & warm tonal mottling
  for (let i = 0; i < 3600; i++) {
    const x = rand() * F;
    const y = rand() * F;
    skinCtx.fillStyle = rand() > 0.5 ? 'rgba(148,88,68,0.06)' : 'rgba(235,195,170,0.05)';
    skinCtx.fillRect(x, y, 2, 2);
    skinHCtx.fillStyle = rand() > 0.5 ? 'rgba(118,118,118,0.14)' : 'rgba(138,138,138,0.12)';
    skinHCtx.fillRect(x, y, 2, 2);
  }

  // Natural facial warmth across cheeks, nose bridge & ears
  for (const [cx, cy, r, col] of [
    [F * 0.405, F * 0.535, 76, 'rgba(178,94,82,0.22)'],
    [F * 0.595, F * 0.535, 76, 'rgba(178,94,82,0.22)'],
    [F * 0.50, F * 0.52, 58, 'rgba(182,102,88,0.16)'],
  ] as const) {
    const g = skinCtx.createRadialGradient(cx, cy, 6, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(180,95,82,0)');
    skinCtx.fillStyle = g;
    skinCtx.fillRect(0, 0, F, F);
  }

  // Deep orbital shadow & subtle lower-lid crease
  skinCtx.fillStyle = 'rgba(72,46,40,0.34)';
  skinCtx.beginPath();
  skinCtx.ellipse(F * 0.436, F * 0.458, 28, 15, 0.05, 0, Math.PI * 2);
  skinCtx.ellipse(F * 0.564, F * 0.458, 28, 15, -0.05, 0, Math.PI * 2);
  skinCtx.fill();

  // Groomed warrior stubble / short trimmed beard across jawline & chin (v > 0.57)
  for (let i = 0; i < 9500; i++) {
    const x = F * (0.29 + rand() * 0.42);
    const y = F * (0.56 + rand() * 0.30);
    const distFromCenter = Math.abs(x - F * 0.5) / (F * 0.21);
    const maxY = F * (0.85 - distFromCenter * 0.10);
    if (y > maxY) continue;
    const isMouthZone = Math.abs(x - F * 0.5) < 34 && y > F * 0.618 && y < F * 0.66;
    if (isMouthZone) continue;
    // Slight gap below cheekbones
    if (y < F * 0.60 && Math.abs(x - F * 0.5) < F * 0.045) continue;
    skinCtx.fillStyle = rand() > 0.3 ? 'rgba(34,25,21,0.36)' : 'rgba(92,80,72,0.20)';
    skinCtx.fillRect(x, y, 2, 3);
    skinHCtx.fillStyle = 'rgba(150,150,150,0.22)';
    skinHCtx.fillRect(x, y, 2, 2);
  }

  // Subtle eyebrow shading under 3D sculpted brows
  skinCtx.strokeStyle = 'rgba(42,30,24,0.68)';
  skinCtx.lineWidth = 10;
  skinCtx.lineCap = 'round';
  skinCtx.beginPath();
  skinCtx.moveTo(F * 0.398, F * 0.420);
  skinCtx.quadraticCurveTo(F * 0.438, F * 0.409, F * 0.476, F * 0.426);
  skinCtx.moveTo(F * 0.602, F * 0.420);
  skinCtx.quadraticCurveTo(F * 0.562, F * 0.409, F * 0.524, F * 0.426);
  skinCtx.stroke();

  // Natural lips & mouth crease
  skinCtx.fillStyle = '#975d54';
  skinCtx.beginPath();
  skinCtx.ellipse(F * 0.5, F * 0.634, 28, 7.5, 0, 0, Math.PI * 2);
  skinCtx.fill();
  skinCtx.strokeStyle = 'rgba(58,28,24,0.72)';
  skinCtx.lineWidth = 2.4;
  skinCtx.beginPath();
  skinCtx.moveTo(F * 0.470, F * 0.634);
  skinCtx.quadraticCurveTo(F * 0.5, F * 0.638, F * 0.530, F * 0.634);
  skinCtx.stroke();

  // Subtle forehead expression lines
  skinCtx.strokeStyle = 'rgba(105,64,50,0.24)';
  skinCtx.lineWidth = 2;
  skinCtx.beginPath();
  skinCtx.moveTo(F * 0.44, F * 0.365);
  skinCtx.quadraticCurveTo(F * 0.5, F * 0.360, F * 0.56, F * 0.365);
  skinCtx.moveTo(F * 0.45, F * 0.386);
  skinCtx.quadraticCurveTo(F * 0.5, F * 0.382, F * 0.55, F * 0.386);
  skinCtx.stroke();

  // Diagonal warrior scar across right brow & cheek (u ~ 0.545 -> 0.592)
  skinCtx.strokeStyle = 'rgba(148,78,72,0.86)';
  skinCtx.lineWidth = 5;
  skinCtx.beginPath();
  skinCtx.moveTo(F * 0.542, F * 0.382);
  skinCtx.quadraticCurveTo(F * 0.568, F * 0.464, F * 0.594, F * 0.562);
  skinCtx.stroke();

  skinCtx.strokeStyle = 'rgba(222,182,170,0.62)';
  skinCtx.lineWidth = 2;
  skinCtx.beginPath();
  skinCtx.moveTo(F * 0.545, F * 0.384);
  skinCtx.quadraticCurveTo(F * 0.571, F * 0.466, F * 0.597, F * 0.564);
  skinCtx.stroke();

  skinHCtx.strokeStyle = '#383838';
  skinHCtx.lineWidth = 5.5;
  skinHCtx.beginPath();
  skinHCtx.moveTo(F * 0.542, F * 0.382);
  skinHCtx.quadraticCurveTo(F * 0.568, F * 0.464, F * 0.594, F * 0.562);
  skinHCtx.stroke();

  skinRCtx.strokeStyle = '#787878';
  skinRCtx.lineWidth = 4.5;
  skinRCtx.beginPath();
  skinRCtx.moveTo(F * 0.542, F * 0.382);
  skinRCtx.quadraticCurveTo(F * 0.568, F * 0.464, F * 0.594, F * 0.562);
  skinRCtx.stroke();

  // 3B. REALISTIC 3D EYEBALL TEXTURE (256x256, centered iris at u=0.5, v=0.5 for front pole)
  const E = 256;
  const [eyeC, eyeCtx] = makeCanvas(E);
  eyeCtx.fillStyle = '#ddd6cc';
  eyeCtx.fillRect(0, 0, E, E);
  // Subtle scleral warmth / veins at periphery
  const scleraGrad = eyeCtx.createRadialGradient(E * 0.5, E * 0.5, 22, E * 0.5, E * 0.5, 118);
  scleraGrad.addColorStop(0, '#e6e0d6');
  scleraGrad.addColorStop(0.55, '#dcd3c7');
  scleraGrad.addColorStop(1, '#b89b92');
  eyeCtx.fillStyle = scleraGrad;
  eyeCtx.fillRect(0, 0, E, E);
  // Steel-grey limbal ring + striated iris
  eyeCtx.fillStyle = '#25313b';
  eyeCtx.beginPath();
  eyeCtx.arc(E * 0.5, E * 0.5, 42, 0, Math.PI * 2);
  eyeCtx.fill();

  const irisGrad = eyeCtx.createRadialGradient(E * 0.5, E * 0.5, 14, E * 0.5, E * 0.5, 39);
  irisGrad.addColorStop(0, '#6a7f91');
  irisGrad.addColorStop(0.55, '#475b6b');
  irisGrad.addColorStop(1, '#26323c');
  eyeCtx.fillStyle = irisGrad;
  eyeCtx.beginPath();
  eyeCtx.arc(E * 0.5, E * 0.5, 38, 0, Math.PI * 2);
  eyeCtx.fill();

  // Radial iris fibers
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 2;
    eyeCtx.strokeStyle = a % 2 === 0 ? 'rgba(165,186,204,0.28)' : 'rgba(20,28,34,0.28)';
    eyeCtx.lineWidth = 1.4;
    eyeCtx.beginPath();
    eyeCtx.moveTo(E * 0.5 + Math.cos(ang) * 16, E * 0.5 + Math.sin(ang) * 16);
    eyeCtx.lineTo(E * 0.5 + Math.cos(ang) * 37, E * 0.5 + Math.sin(ang) * 37);
    eyeCtx.stroke();
  }

  // Deep pupil
  eyeCtx.fillStyle = '#0c0e12';
  eyeCtx.beginPath();
  eyeCtx.arc(E * 0.5, E * 0.5, 15, 0, Math.PI * 2);
  eyeCtx.fill();

  // 4. DARK BURGUNDY WOOL CLOTH CLOAK (512x512)
  const C = 512;
  const [cloakC, cloakCtx] = makeCanvas(C);
  const [cloakHC, cloakHCtx] = makeCanvas(C);
  const [cloakRC, cloakRCtx] = makeCanvas(C);

  const cloakGrad = cloakCtx.createLinearGradient(0, 0, 0, C);
  cloakGrad.addColorStop(0, '#541722');
  cloakGrad.addColorStop(0.74, '#41111a');
  cloakGrad.addColorStop(1, '#290d12');
  cloakCtx.fillStyle = cloakGrad;
  cloakCtx.fillRect(0, 0, C, C);
  cloakHCtx.fillStyle = '#808080';
  cloakHCtx.fillRect(0, 0, C, C);
  cloakRCtx.fillStyle = '#e0e0e0'; // ~0.88 wool cloth roughness
  cloakRCtx.fillRect(0, 0, C, C);

  for (let y = 0; y < C; y += 3) {
    cloakCtx.fillStyle = y % 6 === 0 ? 'rgba(98,28,40,0.16)' : 'rgba(20,5,8,0.16)';
    cloakCtx.fillRect(0, y, C, 1);
    cloakHCtx.fillStyle = y % 6 === 0 ? '#8c8c8c' : '#747474';
    cloakHCtx.fillRect(0, y, C, 1);
  }
  for (let x = 0; x < C; x += 3) {
    cloakCtx.fillStyle = x % 6 === 0 ? 'rgba(110,32,45,0.12)' : 'rgba(18,4,7,0.12)';
    cloakCtx.fillRect(x, 0, 1, C);
    cloakHCtx.fillStyle = x % 6 === 0 ? 'rgba(148,148,148,0.28)' : 'rgba(108,108,108,0.28)';
    cloakHCtx.fillRect(x, 0, 1, C);
  }
  // Subtle ash weathering near hem
  for (let i = 0; i < 240; i++) {
    const x = rand() * C;
    const y = C * (0.76 + rand() * 0.24);
    cloakCtx.fillStyle = 'rgba(54,48,50,0.16)';
    cloakCtx.beginPath();
    cloakCtx.arc(x, y, 3 + rand() * 9, 0, Math.PI * 2);
    cloakCtx.fill();
  }

  // 5. TOOLED SADDLE LEATHER (512x512)
  const L = 512;
  const [leathC, leathCtx] = makeCanvas(L);
  const [leathHC, leathHCtx] = makeCanvas(L);
  const [leathRC, leathRCtx] = makeCanvas(L);
  leathCtx.fillStyle = '#3f2819';
  leathCtx.fillRect(0, 0, L, L);
  leathHCtx.fillStyle = '#808080';
  leathHCtx.fillRect(0, 0, L, L);
  leathRCtx.fillStyle = '#a2a2a2'; // ~0.64 leather roughness
  leathRCtx.fillRect(0, 0, L, L);

  for (let i = 0; i < 1800; i++) {
    const x = rand() * L;
    const y = rand() * L;
    const r = 1 + rand() * 3.5;
    leathCtx.fillStyle = rand() > 0.5 ? 'rgba(82,54,34,0.18)' : 'rgba(26,15,9,0.20)';
    leathCtx.beginPath();
    leathCtx.arc(x, y, r, 0, Math.PI * 2);
    leathCtx.fill();
    leathHCtx.fillStyle = rand() > 0.5 ? 'rgba(148,148,148,0.2)' : 'rgba(108,108,108,0.2)';
    leathHCtx.beginPath();
    leathHCtx.arc(x, y, r, 0, Math.PI * 2);
    leathHCtx.fill();
  }
  for (let i = 0; i < 45; i++) {
    const x = rand() * L;
    const y = rand() * L;
    leathCtx.strokeStyle = 'rgba(24,14,8,0.34)';
    leathCtx.lineWidth = 1.2;
    leathCtx.beginPath();
    leathCtx.moveTo(x, y);
    leathCtx.lineTo(x + (rand() - 0.5) * 34, y + (rand() - 0.5) * 34);
    leathCtx.stroke();
  }

  // 6. RUNIC LONGSWORD BLADE (512x512)
  const B = 512;
  const [bladeC, bladeCtx] = makeCanvas(B);
  const [bladeHC, bladeHCtx] = makeCanvas(B);
  const [bladeRC, bladeRCtx] = makeCanvas(B);
  const [bladeEC, bladeECtx] = makeCanvas(B);

  bladeCtx.fillStyle = '#b4bcc8';
  bladeCtx.fillRect(0, 0, B, B);
  bladeHCtx.fillStyle = '#808080';
  bladeHCtx.fillRect(0, 0, B, B);
  bladeRCtx.fillStyle = '#484848'; // ~0.28 satin-honed sword steel
  bladeRCtx.fillRect(0, 0, B, B);
  bladeECtx.fillStyle = '#000000';
  bladeECtx.fillRect(0, 0, B, B);

  // Subtle folded Damascus ripple bands
  for (let y = 0; y < B; y += 7) {
    bladeCtx.strokeStyle = y % 14 === 0 ? 'rgba(128,136,148,0.16)' : 'rgba(222,230,242,0.14)';
    bladeCtx.lineWidth = 2;
    bladeCtx.beginPath();
    bladeCtx.moveTo(0, y);
    for (let x = 0; x <= B; x += 32) {
      bladeCtx.lineTo(x, y + Math.sin(x * 0.05 + y * 0.04) * 2.5);
    }
    bladeCtx.stroke();
  }

  // Etched fuller darkening + runic glyphs on both blade faces (u=0.25 and u=0.75)
  const drawRune = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, kind: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx, cy + size);
    if (kind % 4 === 0) {
      ctx.moveTo(cx, cy - size * 0.4);
      ctx.lineTo(cx + size * 0.65, cy - size * 0.85);
      ctx.moveTo(cx, cy + size * 0.15);
      ctx.lineTo(cx - size * 0.6, cy + size * 0.6);
    } else if (kind % 4 === 1) {
      ctx.moveTo(cx - size * 0.55, cy - size * 0.45);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + size * 0.55, cy - size * 0.45);
      ctx.moveTo(cx - size * 0.45, cy + size * 0.55);
      ctx.lineTo(cx + size * 0.45, cy + size * 0.15);
    } else if (kind % 4 === 2) {
      ctx.moveTo(cx - size * 0.5, cy - size * 0.7);
      ctx.lineTo(cx + size * 0.5, cy);
      ctx.lineTo(cx - size * 0.5, cy + size * 0.7);
    } else {
      ctx.moveTo(cx, cy - size * 0.75);
      ctx.lineTo(cx + size * 0.55, cy - size * 0.25);
      ctx.lineTo(cx, cy + size * 0.25);
      ctx.lineTo(cx - size * 0.55, cy + size * 0.75);
    }
    ctx.stroke();
  };

  for (const rx of [B * 0.25, B * 0.75]) {
    bladeCtx.fillStyle = 'rgba(48,54,64,0.22)';
    bladeCtx.fillRect(rx - 14, 52, 28, B - 140);
    for (let i = 0; i < 9; i++) {
      const ry = 84 + i * 38;
      bladeCtx.strokeStyle = '#4e5764';
      bladeCtx.lineWidth = 2.8;
      drawRune(bladeCtx, rx, ry, 10, i);

      bladeHCtx.strokeStyle = '#323232';
      bladeHCtx.lineWidth = 3.2;
      drawRune(bladeHCtx, rx, ry, 10, i);

      bladeECtx.strokeStyle = '#96a6b8';
      bladeECtx.lineWidth = 2.4;
      drawRune(bladeECtx, rx, ry, 10, i);
    }
  }

  // 7. HAIR TEXTURE (256x256)
  const H = 256;
  const [hairC, hairCtx] = makeCanvas(H);
  const [hairHC, hairHCtx] = makeCanvas(H);
  hairCtx.fillStyle = '#271e19';
  hairCtx.fillRect(0, 0, H, H);
  hairHCtx.fillStyle = '#808080';
  hairHCtx.fillRect(0, 0, H, H);
  for (let i = 0; i < 650; i++) {
    const x = rand() * H;
    hairCtx.strokeStyle = rand() > 0.78 ? '#554b45' : rand() > 0.4 ? '#191310' : '#362a23';
    hairCtx.lineWidth = 1.2;
    hairCtx.beginPath();
    hairCtx.moveTo(x, 0);
    hairCtx.lineTo(x + (rand() - 0.5) * 10, H);
    hairCtx.stroke();

    hairHCtx.strokeStyle = rand() > 0.5 ? '#9c9c9c' : '#646464';
    hairHCtx.lineWidth = 1.1;
    hairHCtx.beginPath();
    hairHCtx.moveTo(x, 0);
    hairHCtx.lineTo(x, H);
    hairHCtx.stroke();
  }

  const textures: CharacterTextures = {
    steelMap: finalizeColorTex(steelC, maxAnisotropy),
    steelNormal: heightCanvasToNormal(steelHC, 1.45, maxAnisotropy),
    steelRoughness: finalizeLinearTex(steelRC, maxAnisotropy),
    steelMetalness: finalizeLinearTex(steelMC, maxAnisotropy),

    trimMap: finalizeColorTex(trimC, maxAnisotropy),
    trimNormal: heightCanvasToNormal(trimHC, 1.4, maxAnisotropy),
    trimRoughness: finalizeLinearTex(trimRC, maxAnisotropy),

    skinMap: finalizeColorTex(skinC, maxAnisotropy),
    skinNormal: heightCanvasToNormal(skinHC, 1.1, maxAnisotropy),
    skinRoughness: finalizeLinearTex(skinRC, maxAnisotropy),

    eyeMap: finalizeColorTex(eyeC, maxAnisotropy),

    cloakMap: finalizeColorTex(cloakC, maxAnisotropy, 2, 2),
    cloakNormal: heightCanvasToNormal(cloakHC, 1.25, maxAnisotropy, 2, 2),
    cloakRoughness: finalizeLinearTex(cloakRC, maxAnisotropy, 2, 2),

    leatherMap: finalizeColorTex(leathC, maxAnisotropy, 2, 2),
    leatherNormal: heightCanvasToNormal(leathHC, 1.6, maxAnisotropy, 2, 2),
    leatherRoughness: finalizeLinearTex(leathRC, maxAnisotropy, 2, 2),

    bladeMap: finalizeColorTex(bladeC, maxAnisotropy),
    bladeNormal: heightCanvasToNormal(bladeHC, 1.8, maxAnisotropy),
    bladeRoughness: finalizeLinearTex(bladeRC, maxAnisotropy),
    bladeEmissive: finalizeColorTex(bladeEC, maxAnisotropy),

    hairMap: finalizeColorTex(hairC, maxAnisotropy),
    hairNormal: heightCanvasToNormal(hairHC, 1.4, maxAnisotropy),

    dispose: () => {
      textures.steelMap.dispose();
      textures.steelNormal.dispose();
      textures.steelRoughness.dispose();
      textures.steelMetalness.dispose();
      textures.trimMap.dispose();
      textures.trimNormal.dispose();
      textures.trimRoughness.dispose();
      textures.skinMap.dispose();
      textures.skinNormal.dispose();
      textures.skinRoughness.dispose();
      textures.eyeMap.dispose();
      textures.cloakMap.dispose();
      textures.cloakNormal.dispose();
      textures.cloakRoughness.dispose();
      textures.leatherMap.dispose();
      textures.leatherNormal.dispose();
      textures.leatherRoughness.dispose();
      textures.bladeMap.dispose();
      textures.bladeNormal.dispose();
      textures.bladeRoughness.dispose();
      textures.bladeEmissive.dispose();
      textures.hairMap.dispose();
      textures.hairNormal.dispose();
    },
  };

  return textures;
}
