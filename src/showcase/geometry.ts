import * as THREE from 'three';

export interface LoftRing {
  y: number;
  rx: number;
  rz: number;
  offsetX?: number;
  offsetZ?: number;
  modulate?: (theta: number) => number;
}

/**
 * Create a smooth indexed lofted BufferGeometry from vertical elliptical/sculpted rings.
 */
export function createLoftedGeometry(
  rings: LoftRing[],
  radialSegs = 28,
  capBottom = true,
  capTop = true
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const minY = rings[0].y;
  const maxY = rings[rings.length - 1].y;
  const spanY = Math.max(0.0001, maxY - minY);

  const stride = radialSegs + 1;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const v = 1 - (ring.y - minY) / spanY;
    const ox = ring.offsetX ?? 0;
    const oz = ring.offsetZ ?? 0;

    for (let s = 0; s <= radialSegs; s++) {
      const u = s / radialSegs;
      const theta = u * Math.PI * 2;
      const mod = ring.modulate ? ring.modulate(theta) : 1.0;
      const x = ox + Math.sin(theta) * ring.rx * mod;
      const z = oz - Math.cos(theta) * ring.rz * mod;
      positions.push(x, ring.y, z);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = r * stride + s;
      const b = a + stride;
      const c = a + stride + 1;
      const d = a + 1;
      indices.push(a, d, b);
      indices.push(d, c, b);
    }
  }

  if (capBottom) {
    const first = rings[0];
    const centerIdx = positions.length / 3;
    positions.push(first.offsetX ?? 0, first.y, first.offsetZ ?? 0);
    uvs.push(0.5, 1);
    for (let s = 0; s < radialSegs; s++) {
      indices.push(centerIdx, s, s + 1);
    }
  }

  if (capTop) {
    const last = rings[rings.length - 1];
    const baseRow = (rings.length - 1) * stride;
    const centerIdx = positions.length / 3;
    positions.push(last.offsetX ?? 0, last.y, last.offsetZ ?? 0);
    uvs.push(0.5, 0);
    for (let s = 0; s < radialSegs; s++) {
      indices.push(centerIdx, baseRow + s + 1, baseRow + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeTangents();
  return geo;
}

/**
 * Create a rivet stud dome at (x, y, z) oriented outward along (nx, ny, nz).
 */
export function createRivetStud(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  radius = 0.0055
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.65);
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(nx, ny, nz).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  g.applyQuaternion(quat);
  g.translate(x, y, z);
  return g;
}

/**
 * Merge multiple BufferGeometries (all having position, normal, uv) into one indexed geometry.
 */
export function mergeIndexedGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  const idx = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geos) {
    const pAttr = g.attributes.position;
    const nAttr = g.attributes.normal;
    const uAttr = g.attributes.uv;
    const count = pAttr.count;

    for (let i = 0; i < count; i++) {
      const vi = (vOffset + i) * 3;
      pos[vi] = pAttr.getX(i);
      pos[vi + 1] = pAttr.getY(i);
      pos[vi + 2] = pAttr.getZ(i);
      norm[vi] = nAttr ? nAttr.getX(i) : 0;
      norm[vi + 1] = nAttr ? nAttr.getY(i) : 1;
      norm[vi + 2] = nAttr ? nAttr.getZ(i) : 0;
      const ui = (vOffset + i) * 2;
      uv[ui] = uAttr ? uAttr.getX(i) : 0;
      uv[ui + 1] = uAttr ? uAttr.getY(i) : 0;
    }

    if (g.index) {
      const gi = g.index;
      for (let i = 0; i < gi.count; i++) {
        idx[iOffset + i] = gi.getX(i) + vOffset;
      }
      iOffset += gi.count;
    } else {
      for (let i = 0; i < count; i++) {
        idx[iOffset + i] = vOffset + i;
      }
      iOffset += count;
    }
    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  merged.computeTangents();
  return merged;
}

/**
 * High-detail sculpted male warrior head (~35yo) with deep orbital sockets, sculpted eyelids,
 * nasal alae & bridge, defined lips, strong square jaw, chin, and multi-ridge ears.
 */
export function createSculptedHeadGeometry(): THREE.BufferGeometry {
  const segsU = 56;
  const segsV = 44;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const headCenterY = 1.725;
  const rx = 0.086;
  const ry = 0.118;
  const rz = 0.101;

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV; // 0 = crown, 1 = neck-chin junction
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU; // 0.5 = front (+Z)
      const theta = u * Math.PI * 2;
      const nx = Math.sin(theta) * sinPhi;
      const ny = cosPhi;
      const nz = -Math.cos(theta) * sinPhi;

      let x = nx * rx;
      let y = headCenterY + ny * ry;
      let z = nz * rz;

      const frontMask = Math.max(0, nz);
      const centerFace = Math.exp(-Math.pow((u - 0.5) / 0.16, 2));

      // Narrower temple & wider cranium back
      const templePinch =
        Math.exp(-Math.pow((Math.abs(u - 0.5) - 0.14) / 0.055, 2)) *
        Math.exp(-Math.pow((v - 0.40) / 0.09, 2));
      x -= Math.sign(x) * templePinch * 0.005;

      // Strong masculine jaw taper & mandibular corner
      if (v > 0.55) {
        const jawT = (v - 0.55) / 0.45;
        x *= 1 - jawT * 0.28;
        const jawAngle =
          Math.exp(-Math.pow((Math.abs(u - 0.5) - 0.125) / 0.045, 2)) *
          Math.exp(-Math.pow((v - 0.72) / 0.08, 2));
        x += Math.sign(x) * jawAngle * 0.012;
        z += jawAngle * 0.006;
      }

      // Chin projection & cleft contour
      const chinMask =
        Math.exp(-Math.pow((v - 0.80) / 0.065, 2)) *
        Math.exp(-Math.pow((u - 0.5) / 0.06, 2));
      z += chinMask * 0.020;
      y -= chinMask * 0.004;

      // Supraorbital brow ridge
      const browMask =
        Math.exp(-Math.pow((v - 0.415) / 0.036, 2)) *
        Math.exp(-Math.pow((u - 0.5) / 0.105, 2));
      z += browMask * 0.016;

      // Deep orbital eye socket recesses to seat 3D eyeballs cleanly
      const eyeL = Math.exp(-Math.pow((u - 0.436) / 0.030, 2) - Math.pow((v - 0.456) / 0.024, 2));
      const eyeR = Math.exp(-Math.pow((u - 0.564) / 0.030, 2) - Math.pow((v - 0.456) / 0.024, 2));
      z -= (eyeL + eyeR) * 0.018;

      // Upper & lower eyelid folds framing the socket
      const upperLidL = Math.exp(-Math.pow((u - 0.436) / 0.028, 2) - Math.pow((v - 0.436) / 0.009, 2));
      const upperLidR = Math.exp(-Math.pow((u - 0.564) / 0.028, 2) - Math.pow((v - 0.436) / 0.009, 2));
      const lowerLidL = Math.exp(-Math.pow((u - 0.436) / 0.026, 2) - Math.pow((v - 0.476) / 0.009, 2));
      const lowerLidR = Math.exp(-Math.pow((u - 0.564) / 0.026, 2) - Math.pow((v - 0.476) / 0.009, 2));
      z += (upperLidL + upperLidR) * 0.013 + (lowerLidL + lowerLidR) * 0.009;

      // Prominent Zygomatic Cheekbones
      const cheekL = Math.exp(-Math.pow((u - 0.395) / 0.042, 2) - Math.pow((v - 0.528) / 0.042, 2));
      const cheekR = Math.exp(-Math.pow((u - 0.605) / 0.042, 2) - Math.pow((v - 0.528) / 0.042, 2));
      z += (cheekL + cheekR) * 0.012;
      x += (cheekR - cheekL) * 0.008;

      // Sculpted Nose bridge, tip & flared nasal alae (nostrils)
      const noseBridge =
        Math.exp(-Math.pow((u - 0.5) / 0.018, 2)) *
        Math.exp(-Math.pow((v - 0.505) / 0.062, 2));
      const noseTip =
        Math.exp(-Math.pow((u - 0.5) / 0.022, 2)) *
        Math.exp(-Math.pow((v - 0.556) / 0.022, 2));
      const nostrilL = Math.exp(-Math.pow((u - 0.474) / 0.012, 2) - Math.pow((v - 0.562) / 0.014, 2));
      const nostrilR = Math.exp(-Math.pow((u - 0.526) / 0.012, 2) - Math.pow((v - 0.562) / 0.014, 2));
      z += noseBridge * 0.020 + noseTip * 0.016 + (nostrilL + nostrilR) * 0.007;

      // Upper & lower lips + philtrum & mouth crease
      const upperLip =
        Math.exp(-Math.pow((u - 0.5) / 0.042, 2)) *
        Math.exp(-Math.pow((v - 0.623) / 0.012, 2));
      const lowerLip =
        Math.exp(-Math.pow((u - 0.5) / 0.038, 2)) *
        Math.exp(-Math.pow((v - 0.646) / 0.013, 2));
      const mouthCrease =
        Math.exp(-Math.pow((u - 0.5) / 0.044, 2)) *
        Math.exp(-Math.pow((v - 0.634) / 0.006, 2));
      z += (upperLip * 0.009 + lowerLip * 0.008 - mouthCrease * 0.005) * frontMask;

      // Sculpted outer ears (helix ridge & concha hollow) at u ~ 0.245 & 0.755
      const earL = Math.exp(-Math.pow((u - 0.242) / 0.024, 2) - Math.pow((v - 0.505) / 0.062, 2));
      const earR = Math.exp(-Math.pow((u - 0.758) / 0.024, 2) - Math.pow((v - 0.505) / 0.062, 2));
      const earHollowL = Math.exp(-Math.pow((u - 0.252) / 0.011, 2) - Math.pow((v - 0.505) / 0.034, 2));
      const earHollowR = Math.exp(-Math.pow((u - 0.748) / 0.011, 2) - Math.pow((v - 0.505) / 0.034, 2));
      x -= (earL * 0.018 - earHollowL * 0.007);
      x += (earR * 0.018 - earHollowR * 0.007);
      z -= (earL + earR) * 0.006 * (1 - centerFace);

      positions.push(x, y, z);
      uvs.push(u, 1 - v);
    }
  }

  const stride = segsU + 1;
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const a = iv * stride + iu;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d);
      indices.push(d, b, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeTangents();
  return geo;
}

/**
 * Create 3D sculpted eyeball pair positioned precisely inside the orbital sockets.
 * UV is projected onto the front +Z hemisphere so iris texture centers cleanly on the pupil.
 */
export function createSculptedEyeballsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const sphere = new THREE.SphereGeometry(0.0142, 20, 16);
    const pos = sphere.attributes.position;
    const uv = sphere.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      // Planar-spherical front UV centered at +Z
      if (pz >= -0.002) {
        uv.setXY(i, 0.5 + (px / 0.0142) * 0.44, 0.5 + (py / 0.0142) * 0.44);
      } else {
        uv.setXY(i, 0.08, 0.08);
      }
    }
    // Slight inward gaze alignment
    sphere.translate(side * 0.032, 1.741, 0.079);
    parts.push(sphere);
  }
  return mergeIndexedGeometries(parts);
}

/**
 * Swept-back layered warrior hair + sculpted 3D eyebrow ridges.
 */
export function createSculptedHairGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Main sculpted cranium hair volume hugging skull closely at forehead & temples
  const cap = createLoftedGeometry(
    [
      {
        y: 1.66,
        rx: 0.089,
        rz: 0.105,
        offsetZ: -0.014,
        modulate: (th) => (-Math.cos(th) > 0.1 ? 0.80 : 1.05 + Math.sin(th * 9) * 0.02),
      },
      {
        y: 1.735,
        rx: 0.092,
        rz: 0.107,
        offsetZ: -0.012,
        modulate: (th) => (-Math.cos(th) > 0.25 ? 0.82 : 1.06 + Math.sin(th * 12) * 0.025),
      },
      {
        y: 1.798,
        rx: 0.087,
        rz: 0.102,
        offsetZ: -0.008,
        modulate: (th) => (-Math.cos(th) > 0.55 ? 0.90 : 1.04 + Math.sin(th * 10) * 0.024),
      },
      {
        y: 1.838,
        rx: 0.056,
        rz: 0.068,
        offsetZ: -0.005,
      },
      {
        y: 1.852,
        rx: 0.016,
        rz: 0.020,
      },
    ],
    32,
    false,
    true
  );
  parts.push(cap);

  // Layered back & temple locks
  const strandConfigs = [
    { ox: -0.068, oz: 0.015, rotZ: 0.14, rotX: 0.06, h: 0.12, y: 1.73, rx: 0.022, rz: 0.016 },
    { ox: 0.068, oz: 0.015, rotZ: -0.14, rotX: 0.06, h: 0.12, y: 1.73, rx: 0.022, rz: 0.016 },
    { ox: -0.066, oz: -0.055, rotZ: 0.10, rotX: 0.22, h: 0.15, y: 1.69, rx: 0.028, rz: 0.020 },
    { ox: 0.066, oz: -0.055, rotZ: -0.10, rotX: 0.22, h: 0.15, y: 1.69, rx: 0.028, rz: 0.020 },
    { ox: -0.032, oz: -0.092, rotZ: 0.05, rotX: 0.24, h: 0.16, y: 1.67, rx: 0.028, rz: 0.020 },
    { ox: 0.032, oz: -0.092, rotZ: -0.05, rotX: 0.24, h: 0.16, y: 1.67, rx: 0.028, rz: 0.020 },
    { ox: 0.0, oz: -0.098, rotZ: 0.0, rotX: 0.25, h: 0.17, y: 1.66, rx: 0.030, rz: 0.020 },
    { ox: -0.022, oz: 0.076, rotZ: -0.32, rotX: 0.44, h: 0.075, y: 1.805, rx: 0.022, rz: 0.014 },
  ];

  for (const sc of strandConfigs) {
    const lock = createLoftedGeometry(
      [
        { y: -sc.h * 0.5, rx: sc.rx * 0.4, rz: sc.rz * 0.4 },
        { y: 0, rx: sc.rx, rz: sc.rz },
        { y: sc.h * 0.5, rx: sc.rx * 0.72, rz: sc.rz * 0.72 },
      ],
      10
    );
    lock.rotateZ(sc.rotZ);
    lock.rotateX(sc.rotX);
    lock.translate(sc.ox, sc.y, sc.oz);
    parts.push(lock);
  }

  // Sculpted 3D Eyebrow ridges
  for (const side of [-1, 1]) {
    const brow = createLoftedGeometry(
      [
        { y: -0.022, rx: 0.004, rz: 0.004 },
        { y: 0.0, rx: 0.006, rz: 0.005, offsetZ: 0.003 },
        { y: 0.022, rx: 0.004, rz: 0.004 },
      ],
      8
    );
    brow.rotateZ(Math.PI * 0.5 + side * 0.16);
    brow.rotateY(-side * 0.25);
    brow.translate(side * 0.033, 1.757, 0.091);
    parts.push(brow);
  }

  return mergeIndexedGeometries(parts);
}

/**
 * Exact cuirass front/back surface radius helper so belts/straps/clasps conform cleanly without clipping.
 */
export function getCuirassSurfacePoint(
  y: number,
  theta: number,
  extraOffset = 0.008
): { x: number; y: number; z: number } {
  // Piece-wise interpolation matching chest loft rings (y = 1.03 .. 1.50)
  const rings = [
    { y: 1.03, rx: 0.152, rz: 0.114 },
    { y: 1.12, rx: 0.148, rz: 0.116 },
    { y: 1.24, rx: 0.174, rz: 0.134 },
    { y: 1.38, rx: 0.186, rz: 0.138 },
    { y: 1.47, rx: 0.166, rz: 0.118 },
    { y: 1.50, rx: 0.106, rz: 0.096 },
  ];
  let r0 = rings[0];
  let r1 = rings[rings.length - 1];
  for (let i = 0; i < rings.length - 1; i++) {
    if (y >= rings[i].y && y <= rings[i + 1].y) {
      r0 = rings[i];
      r1 = rings[i + 1];
      break;
    }
  }
  const t = r1.y > r0.y ? Math.max(0, Math.min(1, (y - r0.y) / (r1.y - r0.y))) : 0;
  const rx = r0.rx + (r1.rx - r0.rx) * t;
  const rz = r0.rz + (r1.rz - r0.rz) * t;
  const front = Math.max(0, -Math.cos(theta));
  const keel = Math.pow(front, 6) * 0.065 * (1 - Math.abs(y - 1.31) / 0.30);
  const pecs = Math.abs(Math.sin(theta)) * 0.042 * front * Math.max(0, 1 - Math.abs(y - 1.32) / 0.22);
  const mod = 1 + Math.max(0, keel) + pecs;
  return {
    x: Math.sin(theta) * (rx * mod + extraOffset),
    y,
    z: -Math.cos(theta) * (rz * mod + extraOffset),
  };
}

/**
 * Layered medieval steel cuirass (fluted breastplate, gorget, rolled shoulder/neck rims,
 * 3-lame waist faulds, and angled thigh tassets).
 */
export function createCuirassGeometry(): {
  steelGeo: THREE.BufferGeometry;
  trimGeo: THREE.BufferGeometry;
} {
  const steelParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];

  // Main contoured breastplate + backplate
  const chest = createLoftedGeometry(
    [
      {
        y: 1.03,
        rx: 0.152,
        rz: 0.114,
        modulate: (th) => 1 + 0.03 * Math.cos(th * 2),
      },
      {
        y: 1.12,
        rx: 0.148,
        rz: 0.116,
        modulate: (th) => 1 + 0.055 * Math.max(0, -Math.cos(th)),
      },
      {
        y: 1.24,
        rx: 0.174,
        rz: 0.134,
        modulate: (th) => {
          const front = Math.max(0, -Math.cos(th));
          const pecs = Math.abs(Math.sin(th)) * 0.042 * front;
          const keel = Math.pow(front, 6) * 0.065;
          return 1 + pecs + keel;
        },
      },
      {
        y: 1.38,
        rx: 0.186,
        rz: 0.138,
        modulate: (th) => {
          const front = Math.max(0, -Math.cos(th));
          return 1 + Math.pow(front, 5) * 0.068;
        },
      },
      {
        y: 1.47,
        rx: 0.166,
        rz: 0.118,
      },
      {
        y: 1.50,
        rx: 0.106,
        rz: 0.096,
      },
    ],
    36
  );
  steelParts.push(chest);

  // Rolled armhole bevel rings on left & right sides (bridges torso to pauldrons cleanly)
  for (const side of [-1, 1]) {
    const armRing = new THREE.TorusGeometry(0.088, 0.013, 10, 22);
    armRing.rotateY(Math.PI * 0.5);
    armRing.scale(0.88, 1.18, 0.92);
    armRing.translate(side * 0.165, 1.39, 0.0);
    trimParts.push(armRing);
  }

  // Gorget neck guard with rolled top lip
  const gorget = createLoftedGeometry(
    [
      { y: 1.46, rx: 0.138, rz: 0.115, offsetZ: 0.008 },
      { y: 1.515, rx: 0.102, rz: 0.095, offsetZ: 0.004 },
      { y: 1.552, rx: 0.084, rz: 0.080, offsetZ: 0.001 },
    ],
    28
  );
  steelParts.push(gorget);

  const gorgetRim = new THREE.TorusGeometry(0.082, 0.008, 10, 28);
  gorgetRim.rotateX(Math.PI * 0.5);
  gorgetRim.scale(1.03, 0.96, 1.0);
  gorgetRim.translate(0, 1.552, 0.001);
  trimParts.push(gorgetRim);

  // 3 Articulated waist fauld lames + bronze rivets
  for (let i = 0; i < 3; i++) {
    const fy = 1.02 - i * 0.044;
    const radScale = 1 + i * 0.062;
    const fauld = createLoftedGeometry(
      [
        {
          y: fy - 0.048,
          rx: 0.158 * radScale,
          rz: 0.118 * radScale,
          modulate: (th) => 1 + 0.04 * Math.max(0, -Math.cos(th)),
        },
        {
          y: fy,
          rx: 0.152 * radScale,
          rz: 0.114 * radScale,
        },
      ],
      30
    );
    steelParts.push(fauld);

    // Rivets around front & sides of each fauld lame
    for (let r = -3; r <= 3; r++) {
      const th = Math.PI + r * 0.42;
      const rx = 0.158 * radScale * (1 + 0.04 * Math.max(0, -Math.cos(th)));
      const rz = 0.118 * radScale * (1 + 0.04 * Math.max(0, -Math.cos(th)));
      const px = Math.sin(th) * rx;
      const pz = -Math.cos(th) * rz;
      trimParts.push(createRivetStud(px, fy - 0.036, pz, Math.sin(th), 0, -Math.cos(th), 0.005));
    }
  }

  // Hanging Thigh Tassets with rolled bronze trim & rivets
  for (const side of [-1, 1]) {
    const tasset = createLoftedGeometry(
      [
        { y: 0.75, rx: 0.066, rz: 0.018 },
        { y: 0.82, rx: 0.076, rz: 0.020 },
        { y: 0.90, rx: 0.084, rz: 0.022 },
      ],
      18
    );
    tasset.rotateY(side * 0.34);
    tasset.rotateX(-0.06);
    tasset.translate(side * 0.128, 0, 0.098);
    steelParts.push(tasset);

    // Tasset corner rivets
    for (const [dx, dy] of [
      [-0.04, 0.78],
      [0.04, 0.78],
      [-0.048, 0.87],
      [0.048, 0.87],
    ]) {
      const p = new THREE.Vector3(dx, dy, 0.021)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.06)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.34)
        .add(new THREE.Vector3(side * 0.128, 0, 0.098));
      trimParts.push(createRivetStud(p.x, p.y, p.z, side * 0.3, 0, 0.95, 0.005));
    }
  }

  // Cuirass breastplate border rivets along lower waist & collar
  for (let r = -4; r <= 4; r++) {
    const th = Math.PI + r * 0.34;
    const p = getCuirassSurfacePoint(1.055, th, 0.001);
    trimParts.push(createRivetStud(p.x, p.y, p.z, Math.sin(th), 0, -Math.cos(th), 0.0052));
  }

  return {
    steelGeo: mergeIndexedGeometries(steelParts),
    trimGeo: mergeIndexedGeometries(trimParts),
  };
}

/**
 * Multi-lame steel shoulder pauldron with haute-piece neck flange, rolled trim, rivets & armpit besagew.
 */
export function createPauldronGeometry(side: -1 | 1): {
  steelGeo: THREE.BufferGeometry;
  trimGeo: THREE.BufferGeometry;
} {
  const steelParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const sx = side * 0.215;
  const sy = 1.445;

  // Main shoulder dome with slight haute-piece upward medial lip
  const dome = createLoftedGeometry(
    [
      {
        y: -0.075,
        rx: 0.098,
        rz: 0.106,
        modulate: (th) => (Math.sin(th) * side > -0.25 ? 1.07 : 0.78),
      },
      {
        y: -0.015,
        rx: 0.104,
        rz: 0.110,
        modulate: (th) => (Math.sin(th) * side > -0.35 ? 1.06 : 0.80),
      },
      { y: 0.042, rx: 0.090, rz: 0.096 },
      { y: 0.078, rx: 0.052, rz: 0.060 },
    ],
    26
  );
  dome.rotateZ(-side * 0.36);
  dome.translate(sx + side * 0.015, sy + 0.015, 0);
  steelParts.push(dome);

  // Bronze border trim rim along bottom of upper dome
  const domeTrim = new THREE.TorusGeometry(0.10, 0.007, 8, 24);
  domeTrim.rotateX(Math.PI * 0.5);
  domeTrim.rotateZ(-side * 0.36);
  domeTrim.translate(sx + side * 0.015, sy - 0.032, 0);
  trimParts.push(domeTrim);

  // 3 articulated lower shoulder lames with rivets
  for (let i = 0; i < 3; i++) {
    const lame = createLoftedGeometry(
      [
        { y: -0.025, rx: 0.076 - i * 0.005, rz: 0.080 - i * 0.005 },
        { y: 0.014, rx: 0.080 - i * 0.005, rz: 0.084 - i * 0.005 },
      ],
      22
    );
    lame.rotateZ(-side * (0.38 + i * 0.04));
    const lx = sx + side * (0.038 + i * 0.015);
    const ly = sy - 0.048 - i * 0.034;
    lame.translate(lx, ly, 0);
    steelParts.push(lame);

    // Front & back rivets on each lame
    for (const rzSign of [-1, 1]) {
      trimParts.push(
        createRivetStud(lx + side * 0.035, ly, rzSign * 0.068, side * 0.4, 0, rzSign * 0.85, 0.0048)
      );
    }
  }

  // Front arming besagew rondel covering armpit joint cleanly
  const rondel = new THREE.CylinderGeometry(0.042, 0.044, 0.012, 16);
  rondel.rotateX(Math.PI * 0.5);
  rondel.rotateY(side * 0.24);
  rondel.translate(sx - side * 0.025, sy - 0.025, 0.088);
  steelParts.push(rondel);
  trimParts.push(
    createRivetStud(sx - side * 0.025, sy - 0.025, 0.095, side * 0.2, 0, 1, 0.007)
  );

  return {
    steelGeo: mergeIndexedGeometries(steelParts),
    trimGeo: mergeIndexedGeometries(trimParts),
  };
}

/**
 * Thickened 3D burgundy wool cloak (outer shell + inner lining + stitched borders)
 * plus a draped shoulder mantle that wraps over the collarbones to twin chest clasps.
 */
export function createCloakGeometry(): {
  cloakGeo: THREE.BufferGeometry;
  claspsGeo: THREE.BufferGeometry;
} {
  const segX = 30;
  const segY = 28;
  const thickness = 0.009;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const gridCount = (segX + 1) * (segY + 1);

  // Sample outer & inner shells
  const evalCloakPoint = (u: number, v: number): [number, number, number] => {
    const nx = (u - 0.5) * 2; // -1 to 1
    // Collar wraps up onto shoulders (y=1.515) then hangs to calf hem (y=0.25)
    const y = 1.515 - v * 1.265;
    const halfWidth = 0.20 + v * 0.27;
    // Clear backplate (-0.155 at top, sweeping to -0.30 at hem)
    const baseZ = -0.155 - v * 0.145;

    // Collar mantle wraps gently forward around shoulders at very top (v < 0.16)
    const shoulderWrap = Math.max(0, 1 - v * 5.8) * Math.pow(Math.abs(nx), 1.65) * 0.22;
    const shoulderLift = Math.max(0, 1 - v * 5.8) * Math.pow(Math.abs(nx), 2.0) * 0.015;

    // Gentle outward sweep near left hip (nx > 0.35, v ~ 0.45..0.80) to clear hip scabbard
    const scabbardClear =
      nx > 0.25 ? Math.sin(Math.min(1, Math.max(0, (v - 0.3) / 0.55)) * Math.PI) * (nx - 0.25) * 0.045 : 0;

    // Deep natural gravity drapery folds
    const foldAmp = (0.006 + v * 0.036) * (0.55 + 0.45 * Math.sin(u * Math.PI));
    const folds =
      Math.sin(nx * Math.PI * 3.5) * foldAmp +
      Math.sin(nx * Math.PI * 7.0 + 0.7) * foldAmp * 0.32;

    const x = nx * halfWidth;
    const z = baseZ + shoulderWrap - scabbardClear + folds;
    const hemWave = v > 0.92 ? Math.sin(u * 22) * 0.009 : 0;
    return [x, y + shoulderLift + hemWave, z];
  };

  // Layer 0: Outer face (-Z facing)
  for (let iy = 0; iy <= segY; iy++) {
    const v = iy / segY;
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const [x, y, z] = evalCloakPoint(u, v);
      positions.push(x, y, z - thickness * 0.5);
      uvs.push(u, 1 - v);
    }
  }
  // Layer 1: Inner lining (+Z facing)
  for (let iy = 0; iy <= segY; iy++) {
    const v = iy / segY;
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const [x, y, z] = evalCloakPoint(u, v);
      positions.push(x, y, z + thickness * 0.5);
      uvs.push(u, 1 - v);
    }
  }

  const stride = segX + 1;
  // Outer shell triangles (normal pointing -Z)
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * stride + ix;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, d, b);
      indices.push(d, c, b);
    }
  }
  // Inner shell triangles (normal pointing +Z)
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = gridCount + iy * stride + ix;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d);
      indices.push(d, b, c);
    }
  }
  // Stitch perimeter edges (top collar, bottom hem, left edge, right edge) so zero thin borders exist
  for (let ix = 0; ix < segX; ix++) {
    // Top
    const o0 = ix;
    const o1 = ix + 1;
    const i0 = gridCount + ix;
    const i1 = gridCount + ix + 1;
    indices.push(o0, i0, o1, o1, i0, i1);
    // Bottom
    const bo0 = segY * stride + ix;
    const bo1 = bo0 + 1;
    const bi0 = gridCount + bo0;
    const bi1 = bi0 + 1;
    indices.push(bo0, bo1, bi0, bo1, bi1, bi0);
  }
  for (let iy = 0; iy < segY; iy++) {
    // Left edge (ix=0)
    const lo0 = iy * stride;
    const lo1 = lo0 + stride;
    const li0 = gridCount + lo0;
    const li1 = gridCount + lo1;
    indices.push(lo0, lo1, li0, lo1, li1, li0);
    // Right edge (ix=segX)
    const ro0 = iy * stride + segX;
    const ro1 = ro0 + stride;
    const ri0 = gridCount + ro0;
    const ri1 = gridCount + ro1;
    indices.push(ro0, ri0, ro1, ro1, ri0, ri1);
  }

  const cloakGeo = new THREE.BufferGeometry();
  cloakGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cloakGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  cloakGeo.setIndex(indices);
  cloakGeo.computeVertexNormals();
  cloakGeo.computeTangents();

  // Twin forged bronze cloak clasps pinned on upper chest collarbones + connecting chain
  const claspParts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const disc = new THREE.CylinderGeometry(0.021, 0.023, 0.010, 12);
    disc.rotateX(Math.PI * 0.5);
    disc.rotateY(side * 0.28);
    disc.translate(side * 0.108, 1.462, 0.095);
    claspParts.push(disc);
  }
  // Curved cloak chain draping across front gorget
  const chainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.102, 1.462, 0.102),
    new THREE.Vector3(-0.052, 1.438, 0.114),
    new THREE.Vector3(0.0, 1.428, 0.118),
    new THREE.Vector3(0.052, 1.438, 0.114),
    new THREE.Vector3(0.102, 1.462, 0.102),
  ]);
  claspParts.push(new THREE.TubeGeometry(chainCurve, 16, 0.0045, 6, false));

  return {
    cloakGeo,
    claspsGeo: mergeIndexedGeometries(claspParts),
  };
}

/**
 * Create an anatomically articulated gauntlet hand with medial palm orientation
 * so the sword hand naturally grips a forward-pointing longsword handle!
 * Built in local hand space ((0,0,0) = wrist):
 * - Back of hand faces +side*X, Palm faces -side*X (inward toward hips).
 * - Thumb sits on the +Z (forward) edge.
 */
export function createGauntletHandGeometry(side: -1 | 1, gripping = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Flared steel wrist cuff + armored metacarpal palm block
  const cuff = createLoftedGeometry(
    [
      { y: -0.072, rx: 0.018, rz: 0.036, offsetX: side * 0.004 },
      { y: -0.015, rx: 0.022, rz: 0.038 },
      { y: 0.042, rx: 0.036, rz: 0.044 },
    ],
    14
  );
  parts.push(cuff);

  // Raised dorsal knuckle guard ridge
  const knuckleRidge = createLoftedGeometry(
    [
      { y: -0.032, rx: 0.006, rz: 0.008 },
      { y: 0.0, rx: 0.008, rz: 0.011 },
      { y: 0.032, rx: 0.006, rz: 0.008 },
    ],
    8
  );
  knuckleRidge.rotateX(Math.PI * 0.5);
  knuckleRidge.translate(side * 0.020, -0.066, 0.0);
  parts.push(knuckleRidge);

  // Articulated Thumb (2 phalanges curving medially over grip)
  const thumbCurl = gripping ? 1.0 : 0.35;
  const thumb = createLoftedGeometry(
    [
      { y: -0.052, rx: 0.009, rz: 0.009, offsetX: -side * thumbCurl * 0.026, offsetZ: 0.008 },
      { y: -0.026, rx: 0.011, rz: 0.011, offsetX: -side * thumbCurl * 0.010, offsetZ: 0.010 },
      { y: 0.0, rx: 0.012, rz: 0.012 },
    ],
    8
  );
  thumb.rotateX(-0.38);
  thumb.translate(side * 0.002, -0.028, 0.034);
  parts.push(thumb);

  // 4 Articulated Fingers (index, middle, ring, pinky distributed along Z from +0.026 to -0.026)
  const fingerZ = [0.026, 0.009, -0.009, -0.026];
  const fingerLens = [0.068, 0.074, 0.068, 0.056];

  fingerZ.forEach((fz, idx) => {
    const fl = fingerLens[idx];
    if (gripping) {
      // Curl finger cleanly around a r=0.017m handle centered at (-side*0.016, -0.056, fz)
      const finger = createLoftedGeometry(
        [
          // Fingertip wraps back up on medial side
          { y: -fl * 0.42, rx: 0.0068, rz: 0.0072, offsetX: -side * 0.036 },
          // Distal joint underneath handle
          { y: -fl * 0.72, rx: 0.0078, rz: 0.0082, offsetX: -side * 0.024 },
          // Proximal knuckle bending inward
          { y: -fl * 0.38, rx: 0.0085, rz: 0.0088, offsetX: -side * 0.004 },
          // Metacarpal base
          { y: 0.0, rx: 0.009, rz: 0.0092, offsetX: side * 0.012 },
        ],
        8
      );
      finger.translate(0, -0.068, fz);
      parts.push(finger);
    } else {
      const finger = createLoftedGeometry(
        [
          { y: -fl, rx: 0.0068, rz: 0.0072, offsetX: -side * 0.018 },
          { y: -fl * 0.62, rx: 0.008, rz: 0.0084, offsetX: -side * 0.012 },
          { y: -fl * 0.3, rx: 0.0086, rz: 0.009, offsetX: -side * 0.005 },
          { y: 0.0, rx: 0.0092, rz: 0.0094, offsetX: side * 0.006 },
        ],
        8
      );
      finger.translate(0, -0.070, fz);
      parts.push(finger);
    }
  });

  return mergeIndexedGeometries(parts);
}

/**
 * Properly faceted diamond/fullered Runic Longsword blade, sculpted cruciform crossguard,
 * ribbed oval leather grip (sized for gauntlet channel), and faceted wheel pommel.
 * Local hilt origin (0,0,0) = center of leather grip.
 */
export function createRunicSwordComponents(): {
  bladeGeo: THREE.BufferGeometry;
  guardAndPommelGeo: THREE.BufferGeometry;
  gripGeo: THREE.BufferGeometry;
} {
  // 1. Crisp 6-facet diamond-sectioned blade with central fuller & sharp bevels
  const segsY = 22;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Profile has 8 vertices around cross-section (duplicated with crisp facet normals via non-shared groups or smooth-split)
  const sampleProfile = (t: number) => {
    const y = 0.095 + t * 0.90; // 0.095m guard shoulder to 0.995m point
    const widthScale = t < 0.78 ? 1 - t * 0.24 : Math.max(0.01, ((1 - t) / 0.22) * 0.8128);
    const halfW = 0.027 * widthScale;
    const spineT = 0.0072 * (1 - t * 0.45);
    const fullerW = halfW * 0.26;
    const fullerT = spineT * 0.62;
    return { y, halfW, spineT, fullerW, fullerT };
  };

  // Build 4 crisp beveled blade quadrants (FrontLeft, FrontRight, BackRight, BackLeft) + 2 fuller strips
  // Actually let's build an exact 8-point cross-section with crisp face normals (flat triangles per strip)
  const buildFacetStrip = (
    getPair: (t: number) => [[number, number, number], [number, number, number]],
    u0: number,
    u1: number
  ) => {
    const baseV = positions.length / 3;
    for (let i = 0; i <= segsY; i++) {
      const t = i / segsY;
      const [pA, pB] = getPair(t);
      positions.push(pA[0], pA[1], pA[2], pB[0], pB[1], pB[2]);
      uvs.push(u0, 1 - t, u1, 1 - t);
    }
    for (let i = 0; i < segsY; i++) {
      const a = baseV + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  };

  // Front face (+Z): Left bevel, Left-Fuller, Right-Fuller, Right bevel
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [-s.halfW, s.y, 0],
        [-s.fullerW, s.y, s.spineT],
      ];
    },
    0.04,
    0.19
  );
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [-s.fullerW, s.y, s.spineT],
        [0, s.y, s.fullerT],
      ];
    },
    0.19,
    0.25
  );
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [0, s.y, s.fullerT],
        [s.fullerW, s.y, s.spineT],
      ];
    },
    0.25,
    0.31
  );
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [s.fullerW, s.y, s.spineT],
        [s.halfW, s.y, 0],
      ];
    },
    0.31,
    0.46
  );

  // Back face (-Z): Right bevel, Right-Fuller, Left-Fuller, Left bevel
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [s.halfW, s.y, 0],
        [s.fullerW, s.y, -s.spineT],
      ];
    },
    0.54,
    0.69
  );
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [s.fullerW, s.y, -s.spineT],
        [0, s.y, -s.fullerT],
      ];
    },
    0.69,
    0.75
  );
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [0, s.y, -s.fullerT],
        [-s.fullerW, s.y, -s.spineT],
      ];
    },
    0.75,
    0.81
  );
  buildFacetStrip(
    (t) => {
      const s = sampleProfile(t);
      return [
        [-s.fullerW, s.y, -s.spineT],
        [-s.halfW, s.y, 0],
      ];
    },
    0.81,
    0.96
  );

  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bladeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bladeGeo.setIndex(indices);
  bladeGeo.computeVertexNormals();
  bladeGeo.computeTangents();

  // 2. Leather-wrapped ribbed oval grip (fits cleanly inside gauntlet grip channel)
  const gripGeo = createLoftedGeometry(
    [
      { y: -0.105, rx: 0.014, rz: 0.011 },
      { y: -0.065, rx: 0.016, rz: 0.0125 },
      { y: -0.030, rx: 0.015, rz: 0.012 },
      { y: 0.005, rx: 0.0175, rz: 0.014 }, // waist cord riser
      { y: 0.040, rx: 0.016, rz: 0.0125 },
      { y: 0.075, rx: 0.0185, rz: 0.0145 },
    ],
    14
  );

  // 3. Sculpted Crossguard (central ecusson + gracefully curved quillons + flared tips) & Pommel
  const metalParts: THREE.BufferGeometry[] = [];

  // Central ecusson block
  const ecusson = createLoftedGeometry(
    [
      { y: 0.065, rx: 0.030, rz: 0.017 },
      { y: 0.088, rx: 0.034, rz: 0.020 },
      { y: 0.112, rx: 0.022, rz: 0.015 },
    ],
    12
  );
  metalParts.push(ecusson);

  // Swept crossguard quillons via TubeGeometry along curved arm path
  const guardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.128, 0.108, 0),
    new THREE.Vector3(-0.072, 0.088, 0),
    new THREE.Vector3(0, 0.085, 0),
    new THREE.Vector3(0.072, 0.088, 0),
    new THREE.Vector3(0.128, 0.108, 0),
  ]);
  const quillons = new THREE.TubeGeometry(guardCurve, 20, 0.0095, 8, false);
  metalParts.push(quillons);

  // Flared quillon finials
  for (const sx of [-1, 1]) {
    const finial = new THREE.SphereGeometry(0.0135, 10, 8);
    finial.scale(1.1, 0.95, 0.95);
    finial.translate(sx * 0.130, 0.110, 0);
    metalParts.push(finial);
  }

  // Heavy faceted scent-stopper pommel + peen block
  const pommel = createLoftedGeometry(
    [
      { y: -0.172, rx: 0.008, rz: 0.008 },
      { y: -0.156, rx: 0.026, rz: 0.020 },
      { y: -0.134, rx: 0.028, rz: 0.022 },
      { y: -0.106, rx: 0.015, rz: 0.012 },
    ],
    10
  );
  metalParts.push(pommel);

  return {
    bladeGeo,
    guardAndPommelGeo: mergeIndexedGeometries(metalParts),
    gripGeo,
  };
}
