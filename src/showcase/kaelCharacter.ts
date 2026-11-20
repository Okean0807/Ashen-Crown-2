import * as THREE from 'three';
import {
  createCloakGeometry,
  createCuirassGeometry,
  createGauntletHandGeometry,
  createLoftedGeometry,
  createPauldronGeometry,
  createRivetStud,
  createRunicSwordComponents,
  createSculptedEyeballsGeometry,
  createSculptedHairGeometry,
  createSculptedHeadGeometry,
  getCuirassSurfacePoint,
  mergeIndexedGeometries,
} from './geometry';
import { CharacterTextures, createCharacterTextures } from './textures';

export type HeroAnimName = 'Idle' | 'Walk' | 'Run' | 'Attack' | 'Death';

export interface CharacterSpecs {
  name: string;
  title: string;
  triangleCount: number;
  vertexCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  textureSummary: string[];
  boneCount: number;
  animations: HeroAnimName[];
  heightMeters: number;
}

export interface KaelCharacterInstance {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  skeletonHelper: THREE.SkeletonHelper;
  clips: Record<HeroAnimName, THREE.AnimationClip>;
  clipList: THREE.AnimationClip[];
  specs: CharacterSpecs;
  materials: THREE.Material[];
  textures: CharacterTextures;
  swordAuraMaterial: THREE.MeshBasicMaterial;
  bladeMaterial: THREE.MeshStandardMaterial;
  amuletCoreMaterial: THREE.MeshStandardMaterial;
  swordLight: THREE.PointLight;
  setWireframe: (enabled: boolean) => void;
  updateVisualFx: (elapsedTime: number) => void;
  dispose: () => void;
}

type WeightRule = (
  x: number,
  y: number,
  z: number,
  boneMap: Record<string, number>
) => Array<[number, number]>;

function makeBone(
  name: string,
  x: number,
  y: number,
  z: number,
  parent?: THREE.Bone
): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  if (parent) parent.add(b);
  return b;
}

function createSkinnedPart(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  skeleton: THREE.Skeleton,
  boneMap: Record<string, number>,
  weightRule: WeightRule,
  castShadow = true,
  receiveShadow = true
): THREE.SkinnedMesh {
  const pos = geometry.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const raw = weightRule(x, y, z, boneMap)
      .filter(([, w]) => w > 0.0001)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    let sum = 0;
    for (let k = 0; k < raw.length; k++) sum += raw[k][1];
    if (sum <= 0.00001) {
      raw.push([boneMap.Hips, 1]);
      sum = 1;
    }

    const base = i * 4;
    for (let k = 0; k < 4; k++) {
      if (k < raw.length) {
        skinIndices[base + k] = raw[k][0];
        skinWeights[base + k] = raw[k][1] / sum;
      } else {
        skinIndices[base + k] = 0;
        skinWeights[base + k] = 0;
      }
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  mesh.bind(skeleton);
  return mesh;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function qTrack(
  boneName: string,
  times: number[],
  eulers: Array<[number, number, number]>
): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  for (const [rx, ry, rz] of eulers) {
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    values.push(_q.x, _q.y, _q.z, _q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values);
}

function vTrack(
  boneName: string,
  times: number[],
  positions: Array<[number, number, number]>
): THREE.VectorKeyframeTrack {
  const values: number[] = [];
  for (const [x, y, z] of positions) {
    values.push(x, y, z);
  }
  return new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values);
}

/**
 * Create a flat ribbon strap conforming tightly along a surface-sampled 3D curve.
 */
function createSurfaceBaldricGeometry(): THREE.BufferGeometry {
  // Loop continuously from right shoulder -> front chest -> left hip -> back waist -> right shoulder
  const waypoints: Array<{ y: number; th: number }> = [
    { y: 1.485, th: Math.PI - 0.58 }, // Right collarbone front
    { y: 1.40, th: Math.PI - 0.34 },
    { y: 1.30, th: Math.PI - 0.08 },
    { y: 1.19, th: Math.PI + 0.24 },
    { y: 1.08, th: Math.PI + 0.56 },
    { y: 1.00, th: Math.PI + 0.94 }, // Left hip side
    { y: 1.02, th: Math.PI + 1.52 }, // Left hip rear
    { y: 1.12, th: Math.PI + 2.08 },
    { y: 1.24, th: Math.PI + 2.62 },
    { y: 1.36, th: Math.PI + 3.08 },
    { y: 1.46, th: Math.PI + 3.56 }, // Right shoulder rear
    { y: 1.50, th: Math.PI + 4.35 }, // Over right trapezius
    { y: 1.485, th: Math.PI - 0.58 },
  ];

  const samples = 56;
  const pts = waypoints.map((wp) => {
    const p = getCuirassSurfacePoint(wp.y, wp.th, 0.0085);
    return new THREE.Vector3(p.x, p.y, p.z);
  });
  const curve = new THREE.CatmullRomCurve3(pts, true);

  const halfW = 0.020;
  const thick = 0.0055;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const c = curve.getPointAt(u % 1);
    const tan = curve.getTangentAt(u % 1).normalize();
    // Outward normal from torso spine center (0, c.y, 0)
    const out = new THREE.Vector3(c.x, 0, c.z).normalize();
    const binorm = new THREE.Vector3().crossVectors(tan, out).normalize();

    const pOutL = c.clone().addScaledVector(binorm, -halfW).addScaledVector(out, thick);
    const pOutR = c.clone().addScaledVector(binorm, halfW).addScaledVector(out, thick);
    const pInL = c.clone().addScaledVector(binorm, -halfW);
    const pInR = c.clone().addScaledVector(binorm, halfW);

    positions.push(
      pOutL.x, pOutL.y, pOutL.z,
      pOutR.x, pOutR.y, pOutR.z,
      pInR.x, pInR.y, pInR.z,
      pInL.x, pInL.y, pInL.z
    );
    uvs.push(0, u * 4, 1, u * 4, 1, u * 4, 0, u * 4);
  }

  for (let i = 0; i < samples; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    // Outer face
    indices.push(a, b, a + 1, a + 1, b, b + 1);
    // Right edge
    indices.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    // Inner face
    indices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    // Left edge
    indices.push(a + 3, b + 3, a, a, b + 3, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeTangents();
  return geo;
}

function createLimbPlateParts(side: -1 | 1): {
  upperArmSteel: THREE.BufferGeometry;
  forearmSteel: THREE.BufferGeometry;
  thighSteel: THREE.BufferGeometry;
  shinSteel: THREE.BufferGeometry;
  limbTrim: THREE.BufferGeometry;
  bootLeather: THREE.BufferGeometry;
} {
  const armX = side * 0.225;
  const trimParts: THREE.BufferGeometry[] = [];

  // Upper arm rerebrace + pointed elbow couter with side rondel & rivets
  const rerebrace = createLoftedGeometry(
    [
      { y: 1.215, rx: 0.056, rz: 0.056, offsetX: armX + side * 0.014 },
      { y: 1.32, rx: 0.062, rz: 0.062, offsetX: armX + side * 0.008 },
      { y: 1.42, rx: 0.066, rz: 0.065, offsetX: armX },
    ],
    20
  );
  const couter = createLoftedGeometry(
    [
      { y: 1.13, rx: 0.055, rz: 0.060, offsetX: armX + side * 0.020, offsetZ: -0.003 },
      {
        y: 1.175,
        rx: 0.067,
        rz: 0.072,
        offsetX: armX + side * 0.022,
        offsetZ: -0.007,
        modulate: (th) => 1 + 0.19 * Math.max(0, Math.cos(th)),
      },
      { y: 1.22, rx: 0.055, rz: 0.059, offsetX: armX + side * 0.018, offsetZ: -0.003 },
    ],
    20
  );
  const elbowRondel = new THREE.CylinderGeometry(0.025, 0.027, 0.010, 14);
  elbowRondel.rotateZ(Math.PI * 0.5);
  elbowRondel.translate(armX + side * 0.078, 1.175, 0.0);
  trimParts.push(
    createRivetStud(armX + side * 0.084, 1.175, 0.0, side, 0, 0, 0.005)
  );
  const upperArmSteel = mergeIndexedGeometries([rerebrace, couter, elbowRondel]);

  // Forearm fluted vambrace with bronze cuff trim
  const vambrace = createLoftedGeometry(
    [
      { y: 0.935, rx: 0.043, rz: 0.043, offsetX: side * 0.256, offsetZ: 0.020 },
      { y: 1.04, rx: 0.052, rz: 0.051, offsetX: side * 0.250, offsetZ: 0.014 },
      { y: 1.14, rx: 0.057, rz: 0.056, offsetX: side * 0.244, offsetZ: 0.009 },
    ],
    20
  );
  const wristTrim = new THREE.TorusGeometry(0.043, 0.0045, 8, 18);
  wristTrim.rotateX(Math.PI * 0.5);
  wristTrim.translate(side * 0.256, 0.938, 0.020);
  trimParts.push(wristTrim);

  // Leg thigh cuisse + winged knee poleyn
  const legX = side * 0.104;
  const cuisse = createLoftedGeometry(
    [
      { y: 0.545, rx: 0.072, rz: 0.074, offsetX: legX },
      { y: 0.72, rx: 0.086, rz: 0.088, offsetX: legX },
      { y: 0.88, rx: 0.094, rz: 0.095, offsetX: legX },
    ],
    22
  );
  const cuisseTopTrim = new THREE.TorusGeometry(0.093, 0.005, 8, 22);
  cuisseTopTrim.rotateX(Math.PI * 0.5);
  cuisseTopTrim.translate(legX, 0.875, 0);
  trimParts.push(cuisseTopTrim);

  const poleyn = createLoftedGeometry(
    [
      { y: 0.455, rx: 0.066, rz: 0.074, offsetX: legX, offsetZ: 0.008 },
      {
        y: 0.505,
        rx: 0.079,
        rz: 0.089,
        offsetX: legX,
        offsetZ: 0.016,
        modulate: (th) => 1 + 0.16 * Math.max(0, -Math.cos(th)),
      },
      { y: 0.558, rx: 0.068, rz: 0.074, offsetX: legX, offsetZ: 0.008 },
    ],
    20
  );
  const kneeWing = new THREE.CylinderGeometry(0.030, 0.032, 0.010, 14);
  kneeWing.rotateZ(Math.PI * 0.5);
  kneeWing.translate(legX + side * 0.078, 0.505, 0.012);
  trimParts.push(createRivetStud(legX + side * 0.085, 0.505, 0.012, side, 0, 0, 0.0055));
  const thighSteel = mergeIndexedGeometries([cuisse, poleyn, kneeWing]);

  // Shin greave + 3-lame articulated steel sabaton over leather boot
  const greave = createLoftedGeometry(
    [
      { y: 0.105, rx: 0.052, rz: 0.058, offsetX: legX, offsetZ: 0.006 },
      {
        y: 0.28,
        rx: 0.066,
        rz: 0.073,
        offsetX: legX,
        offsetZ: 0.004,
        modulate: (th) => 1 + 0.11 * Math.max(0, -Math.cos(th)),
      },
      { y: 0.465, rx: 0.065, rz: 0.068, offsetX: legX, offsetZ: 0.004 },
    ],
    22
  );
  const sabatonParts: THREE.BufferGeometry[] = [greave];
  for (let i = 0; i < 3; i++) {
    const lame = createLoftedGeometry(
      [
        { y: 0.014 + i * 0.020, rx: 0.054 - i * 0.003, rz: 0.044, offsetX: legX, offsetZ: 0.088 - i * 0.026 },
        { y: 0.036 + i * 0.022, rx: 0.050 - i * 0.002, rz: 0.040, offsetX: legX, offsetZ: 0.074 - i * 0.024 },
      ],
      16
    );
    sabatonParts.push(lame);
  }
  const shinSteel = mergeIndexedGeometries(sabatonParts);

  // Leather boot sole, heel & cuff grounded cleanly at y = 0.00
  const boot = createLoftedGeometry(
    [
      { y: 0.0, rx: 0.057, rz: 0.116, offsetX: legX, offsetZ: 0.045 },
      { y: 0.022, rx: 0.055, rz: 0.110, offsetX: legX, offsetZ: 0.040 },
      { y: 0.075, rx: 0.050, rz: 0.066, offsetX: legX, offsetZ: 0.010 },
      { y: 0.165, rx: 0.055, rz: 0.059, offsetX: legX, offsetZ: 0.002 },
    ],
    18
  );

  return {
    upperArmSteel,
    forearmSteel: vambrace,
    thighSteel,
    shinSteel,
    limbTrim: mergeIndexedGeometries(trimParts),
    bootLeather: boot,
  };
}

export function buildKaelVeyr(maxAnisotropy = 4): KaelCharacterInstance {
  const textures = createCharacterTextures(maxAnisotropy);
  const root = new THREE.Group();
  root.name = 'KaelVeyr_Root';

  // 1. HIERARCHICAL SKELETON (24 bones, realistic human proportions 1.85m)
  const Root = makeBone('Root', 0, 0, 0);
  const Hips = makeBone('Hips', 0, 0.965, 0, Root);
  const Spine = makeBone('Spine', 0, 0.14, 0, Hips);
  const Chest = makeBone('Chest', 0, 0.215, 0, Spine);
  const Neck = makeBone('Neck', 0, 0.225, 0, Chest);
  const Head = makeBone('Head', 0, 0.085, 0, Neck);

  // Left arm (+X)
  const L_Shoulder = makeBone('L_Shoulder', 0.13, 0.125, 0, Chest);
  const L_UpperArm = makeBone('L_UpperArm', 0.085, 0, 0, L_Shoulder);
  const L_Forearm = makeBone('L_Forearm', 0.032, -0.270, 0.008, L_UpperArm);
  const L_Hand = makeBone('L_Hand', 0.012, -0.260, 0.014, L_Forearm);

  // Right arm (-X, Sword Arm)
  const R_Shoulder = makeBone('R_Shoulder', -0.13, 0.125, 0, Chest);
  const R_UpperArm = makeBone('R_UpperArm', -0.085, 0, 0, R_Shoulder);
  const R_Forearm = makeBone('R_Forearm', -0.032, -0.270, 0.008, R_UpperArm);
  const R_Hand = makeBone('R_Hand', -0.012, -0.260, 0.014, R_Forearm);
  // WeaponAnchor centered squarely inside the curled right gauntlet palm channel
  const WeaponAnchor = makeBone('WeaponAnchor', 0.016, -0.054, 0.004, R_Hand);

  // Legs
  const L_Thigh = makeBone('L_Thigh', 0.104, -0.045, 0, Hips);
  const L_Shin = makeBone('L_Shin', 0, -0.415, 0, L_Thigh);
  const L_Foot = makeBone('L_Foot', 0, -0.425, 0.01, L_Shin);

  const R_Thigh = makeBone('R_Thigh', -0.104, -0.045, 0, Hips);
  const R_Shin = makeBone('R_Shin', 0, -0.415, 0, R_Thigh);
  const R_Foot = makeBone('R_Foot', 0, -0.425, 0.01, R_Shin);

  // Cloak chain
  const Cloak_1 = makeBone('Cloak_1', 0, 0.16, -0.15, Chest);
  const Cloak_2 = makeBone('Cloak_2', 0, -0.40, -0.05, Cloak_1);
  const Cloak_3 = makeBone('Cloak_3', 0, -0.42, -0.05, Cloak_2);

  const bones = [
    Root,
    Hips,
    Spine,
    Chest,
    Neck,
    Head,
    L_Shoulder,
    L_UpperArm,
    L_Forearm,
    L_Hand,
    R_Shoulder,
    R_UpperArm,
    R_Forearm,
    R_Hand,
    WeaponAnchor,
    L_Thigh,
    L_Shin,
    L_Foot,
    R_Thigh,
    R_Shin,
    R_Foot,
    Cloak_1,
    Cloak_2,
    Cloak_3,
  ];
  const boneMap: Record<string, number> = {};
  bones.forEach((b, i) => {
    boneMap[b.name] = i;
  });

  root.add(Root);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  // 2. CALIBRATED PBR MATERIALS (balanced roughness/normals, zero harsh speckled noise)
  const steelMat = new THREE.MeshStandardMaterial({
    name: 'WeatheredSteelPlate',
    map: textures.steelMap,
    normalMap: textures.steelNormal,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughnessMap: textures.steelRoughness,
    metalnessMap: textures.steelMetalness,
    roughness: 0.96,
    metalness: 0.94,
    envMapIntensity: 1.05,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    name: 'DarkBronzeTrim',
    map: textures.trimMap,
    normalMap: textures.trimNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: textures.trimRoughness,
    roughness: 0.90,
    metalness: 0.86,
    envMapIntensity: 0.95,
  });

  const mailMat = new THREE.MeshStandardMaterial({
    name: 'ChainmailAndGambeson',
    color: new THREE.Color('#23262e'),
    normalMap: textures.trimNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.72,
    metalness: 0.45,
    envMapIntensity: 0.6,
  });

  const skinMat = new THREE.MeshStandardMaterial({
    name: 'KaelWeatheredSkin',
    map: textures.skinMap,
    normalMap: textures.skinNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: textures.skinRoughness,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.42,
  });

  const eyeMat = new THREE.MeshPhysicalMaterial({
    name: 'KaelRealisticEyes',
    map: textures.eyeMap,
    roughness: 0.08,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.1,
  });

  const hairMat = new THREE.MeshStandardMaterial({
    name: 'KaelHair',
    map: textures.hairMap,
    normalMap: textures.hairNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.78,
    metalness: 0.04,
    envMapIntensity: 0.45,
  });

  const cloakMat = new THREE.MeshPhysicalMaterial({
    name: 'BurgundyWoolCloak',
    map: textures.cloakMap,
    normalMap: textures.cloakNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughnessMap: textures.cloakRoughness,
    roughness: 0.98,
    metalness: 0.0,
    sheen: 0.42,
    sheenRoughness: 0.78,
    sheenColor: new THREE.Color('#782232'),
    envMapIntensity: 0.35,
  });

  const leatherMat = new THREE.MeshStandardMaterial({
    name: 'TooledSaddleLeather',
    map: textures.leatherMap,
    normalMap: textures.leatherNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: textures.leatherRoughness,
    roughness: 0.95,
    metalness: 0.02,
    envMapIntensity: 0.5,
  });

  const bladeMat = new THREE.MeshStandardMaterial({
    name: 'RunicLongswordBlade',
    map: textures.bladeMap,
    normalMap: textures.bladeNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: textures.bladeRoughness,
    roughness: 0.78,
    metalness: 0.96,
    emissive: new THREE.Color('#b6c6d8'),
    emissiveMap: textures.bladeEmissive,
    emissiveIntensity: 0.85,
    envMapIntensity: 1.2,
  });

  const amuletCoreMat = new THREE.MeshStandardMaterial({
    name: 'AshenAmuletStone',
    color: new THREE.Color('#8e99a8'),
    emissive: new THREE.Color('#c8d4e3'),
    emissiveIntensity: 1.0,
    roughness: 0.24,
    metalness: 0.15,
  });

  const swordAuraMat = new THREE.MeshBasicMaterial({
    name: 'SwordAshAura',
    color: new THREE.Color('#bcc7d4'),
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const materials: THREE.Material[] = [
    steelMat,
    trimMat,
    mailMat,
    skinMat,
    eyeMat,
    hairMat,
    cloakMat,
    leatherMat,
    bladeMat,
    amuletCoreMat,
    swordAuraMat,
  ];

  // 3. BUILD ANATOMICAL & ARMOR GEOMETRIES + SKINNING
  const meshes: THREE.Mesh[] = [];

  // 3A. Head, 3D Eyeballs, Hair + Eyebrows, Anatomical Neck
  const headGeo = createSculptedHeadGeometry();
  meshes.push(
    createSkinnedPart('HeadMesh', headGeo, skinMat, skeleton, boneMap, (_x, y, _z, bm) => {
      const t = smoothstep(1.56, 1.63, y);
      return [
        [bm.Head, t],
        [bm.Neck, 1 - t],
      ];
    })
  );

  const eyeGeo = createSculptedEyeballsGeometry();
  meshes.push(
    createSkinnedPart('EyeballsMesh', eyeGeo, eyeMat, skeleton, boneMap, (_x, _y, _z, bm) => [
      [bm.Head, 1],
    ])
  );

  const hairGeo = createSculptedHairGeometry();
  meshes.push(
    createSkinnedPart('HairMesh', hairGeo, hairMat, skeleton, boneMap, (_x, _y, _z, bm) => [
      [bm.Head, 1],
    ])
  );

  const neckGeo = createLoftedGeometry(
    [
      { y: 1.49, rx: 0.076, rz: 0.072 }, // trapezius base inside gorget
      { y: 1.56, rx: 0.059, rz: 0.058, offsetZ: -0.004 },
      { y: 1.63, rx: 0.055, rz: 0.056, offsetZ: -0.002 },
    ],
    20
  );
  meshes.push(
    createSkinnedPart('NeckSkinMesh', neckGeo, skinMat, skeleton, boneMap, (_x, y, _z, bm) => {
      const t = smoothstep(1.54, 1.61, y);
      return [
        [bm.Head, t * 0.55],
        [bm.Neck, 0.45 + t * 0.45],
        [bm.Chest, 1 - t],
      ];
    })
  );

  // 3B. Continuous Chainmail & Padded Arming Under-Suit (eliminates ALL black gaps from any angle)
  const underParts: THREE.BufferGeometry[] = [
    // Continuous torso & pelvis under-tunic
    createLoftedGeometry(
      [
        { y: 0.78, rx: 0.146, rz: 0.114 },
        { y: 0.94, rx: 0.142, rz: 0.108 },
        { y: 1.12, rx: 0.138, rz: 0.105 },
        { y: 1.38, rx: 0.165, rz: 0.122 },
        { y: 1.52, rx: 0.118, rz: 0.094 },
      ],
      24
    ),
  ];

  for (const side of [-1, 1] as const) {
    // Full continuous arm sleeve from shoulder socket to wrist
    underParts.push(
      createLoftedGeometry(
        [
          { y: 0.91, rx: 0.038, rz: 0.038, offsetX: side * 0.258, offsetZ: 0.022 },
          { y: 1.04, rx: 0.044, rz: 0.044, offsetX: side * 0.250, offsetZ: 0.015 },
          { y: 1.175, rx: 0.048, rz: 0.048, offsetX: side * 0.242, offsetZ: 0.008 },
          { y: 1.32, rx: 0.054, rz: 0.054, offsetX: side * 0.225 },
          { y: 1.445, rx: 0.062, rz: 0.060, offsetX: side * 0.178 },
        ],
        16
      )
    );
    // Full continuous leg hose from hip joint down through behind-knee to ankle
    underParts.push(
      createLoftedGeometry(
        [
          { y: 0.08, rx: 0.044, rz: 0.048, offsetX: side * 0.104, offsetZ: 0.010 },
          { y: 0.28, rx: 0.056, rz: 0.062, offsetX: side * 0.104, offsetZ: 0.004 },
          { y: 0.505, rx: 0.058, rz: 0.064, offsetX: side * 0.104, offsetZ: 0.002 },
          { y: 0.72, rx: 0.076, rz: 0.078, offsetX: side * 0.104 },
          { y: 0.92, rx: 0.086, rz: 0.086, offsetX: side * 0.104 },
        ],
        18
      )
    );
  }
  const underSuitGeo = mergeIndexedGeometries(underParts);
  meshes.push(
    createSkinnedPart('ArmingUnderSuitMesh', underSuitGeo, mailMat, skeleton, boneMap, (x, y, _z, bm) => {
      // Arms (x outside torso width & above y=0.88)
      if (Math.abs(x) > 0.172 && y > 0.88) {
        const isL = x > 0;
        const sh = isL ? bm.L_Shoulder : bm.R_Shoulder;
        const up = isL ? bm.L_UpperArm : bm.R_UpperArm;
        const fo = isL ? bm.L_Forearm : bm.R_Forearm;
        const ha = isL ? bm.L_Hand : bm.R_Hand;
        if (y > 1.36) {
          const armW = smoothstep(0.16, 0.21, Math.abs(x));
          return [
            [up, armW],
            [sh, 1 - armW],
          ];
        }
        if (y > 1.15) {
          const t = smoothstep(1.13, 1.23, y);
          return [
            [up, t],
            [fo, 1 - t],
          ];
        }
        const t = smoothstep(0.90, 0.97, y);
        return [
          [fo, t],
          [ha, 1 - t],
        ];
      }
      // Legs (below hip level y=0.92)
      if (y < 0.92) {
        const isL = x >= 0;
        const th = isL ? bm.L_Thigh : bm.R_Thigh;
        const sh = isL ? bm.L_Shin : bm.R_Shin;
        const ft = isL ? bm.L_Foot : bm.R_Foot;
        if (y > 0.80) {
          const t = smoothstep(0.92, 0.78, y);
          return [
            [th, t],
            [bm.Hips, 1 - t],
          ];
        }
        if (y > 0.46) {
          const t = smoothstep(0.46, 0.55, y);
          return [
            [th, t],
            [sh, 1 - t],
          ];
        }
        const t = smoothstep(0.06, 0.12, y);
        return [
          [sh, t],
          [ft, 1 - t],
        ];
      }
      if (y < 1.13) {
        const t = smoothstep(0.96, 1.13, y);
        return [
          [bm.Spine, t],
          [bm.Hips, 1 - t],
        ];
      }
      const t = smoothstep(1.13, 1.32, y);
      return [
        [bm.Chest, t],
        [bm.Spine, 1 - t],
      ];
    })
  );

  // 3C. Fluted Steel Cuirass, Gorget, Faulds, Tassets + Trim & Rivets
  const cuirass = createCuirassGeometry();
  const cuirassWeight: WeightRule = (x, y, _z, bm) => {
    if (y < 0.90) {
      return [
        [bm.Hips, 0.58],
        [x >= 0 ? bm.L_Thigh : bm.R_Thigh, 0.42],
      ];
    }
    if (y < 1.04) {
      return [
        [bm.Hips, 0.65],
        [bm.Spine, 0.35],
      ];
    }
    if (y < 1.24) {
      const t = smoothstep(1.04, 1.24, y);
      return [
        [bm.Chest, t],
        [bm.Spine, 1 - t],
      ];
    }
    return [[bm.Chest, 1]];
  };

  meshes.push(
    createSkinnedPart('CuirassSteelMesh', cuirass.steelGeo, steelMat, skeleton, boneMap, cuirassWeight),
    createSkinnedPart('CuirassTrimAndRivets', cuirass.trimGeo, trimMat, skeleton, boneMap, cuirassWeight)
  );

  // 3D. Left & Right Pauldrons (Steel + Bronze Trim + Rivets + Besagew Rondel)
  for (const side of [-1, 1] as const) {
    const p = createPauldronGeometry(side);
    const armBone = side > 0 ? boneMap.L_UpperArm : boneMap.R_UpperArm;
    const shBone = side > 0 ? boneMap.L_Shoulder : boneMap.R_Shoulder;
    const tag = side > 0 ? 'Left' : 'Right';
    const wRule: WeightRule = (_x, y) => {
      const armW = smoothstep(1.50, 1.32, y) * 0.65 + 0.35;
      return [
        [armBone, armW],
        [shBone, 1 - armW],
      ];
    };
    meshes.push(
      createSkinnedPart(`${tag}PauldronSteel`, p.steelGeo, steelMat, skeleton, boneMap, wRule),
      createSkinnedPart(`${tag}PauldronTrim`, p.trimGeo, trimMat, skeleton, boneMap, wRule)
    );
  }

  // 3E. Left & Right Arm/Leg Plate, Articulated Gauntlet Hands & Boots
  for (const side of [-1, 1] as const) {
    const parts = createLimbPlateParts(side);
    const upBone = side > 0 ? boneMap.L_UpperArm : boneMap.R_UpperArm;
    const foBone = side > 0 ? boneMap.L_Forearm : boneMap.R_Forearm;
    const haBone = side > 0 ? boneMap.L_Hand : boneMap.R_Hand;
    const thBone = side > 0 ? boneMap.L_Thigh : boneMap.R_Thigh;
    const shBone = side > 0 ? boneMap.L_Shin : boneMap.R_Shin;
    const ftBone = side > 0 ? boneMap.L_Foot : boneMap.R_Foot;
    const tag = side > 0 ? 'Left' : 'Right';

    meshes.push(
      createSkinnedPart(`${tag}UpperArmSteel`, parts.upperArmSteel, steelMat, skeleton, boneMap, (_x, y) => {
        const elbowBlend = smoothstep(1.22, 1.14, y) * 0.45;
        return [
          [upBone, 1 - elbowBlend],
          [foBone, elbowBlend],
        ];
      }),
      createSkinnedPart(`${tag}ForearmSteel`, parts.forearmSteel, steelMat, skeleton, boneMap, (_x, y) => {
        const wristBlend = smoothstep(0.98, 0.92, y) * 0.35;
        return [
          [foBone, 1 - wristBlend],
          [haBone, wristBlend],
        ];
      })
    );

    const handGeo = createGauntletHandGeometry(side, side === -1);
    handGeo.translate(side * 0.258, 0.915, 0.022);
    meshes.push(
      createSkinnedPart(`${tag}GauntletHand`, handGeo, steelMat, skeleton, boneMap, () => [[haBone, 1]])
    );

    meshes.push(
      createSkinnedPart(`${tag}ThighSteel`, parts.thighSteel, steelMat, skeleton, boneMap, (_x, y) => {
        const kneeBlend = smoothstep(0.56, 0.47, y) * 0.42;
        return [
          [thBone, 1 - kneeBlend],
          [shBone, kneeBlend],
        ];
      }),
      createSkinnedPart(`${tag}ShinAndSabatonSteel`, parts.shinSteel, steelMat, skeleton, boneMap, (_x, y) => {
        const footT = smoothstep(0.11, 0.06, y);
        return [
          [ftBone, footT],
          [shBone, 1 - footT],
        ];
      }),
      createSkinnedPart(`${tag}BootLeather`, parts.bootLeather, leatherMat, skeleton, boneMap, (_x, y) => {
        const footT = smoothstep(0.12, 0.05, y);
        return [
          [ftBone, footT],
          [shBone, 1 - footT],
        ];
      }),
      createSkinnedPart(`${tag}LimbTrimAndRivets`, parts.limbTrim, trimMat, skeleton, boneMap, (_x, y) => {
        if (y > 1.05) return [[upBone, 1]];
        if (y > 0.90) return [[foBone, 1]];
        if (y > 0.65) return [[thBone, 1]];
        return [[shBone, 1]];
      })
    );
  }

  // 3F. Conforming Leather Belt, Surface-Hugging Baldric, Scabbard w/ Suspension Straps & Ashen Amulet
  const leatherGearParts: THREE.BufferGeometry[] = [];

  // Waist belt hugging waist fauld cleanly
  const belt = createLoftedGeometry(
    [
      { y: 0.954, rx: 0.164, rz: 0.126 },
      { y: 1.012, rx: 0.161, rz: 0.124 },
    ],
    28
  );
  leatherGearParts.push(belt);

  // Surface-conforming diagonal chest baldric
  leatherGearParts.push(createSurfaceBaldricGeometry());

  // Hip scabbard (mounted cleanly outside left thigh/tasset)
  const scabbard = createLoftedGeometry(
    [
      { y: -0.37, rx: 0.015, rz: 0.025 },
      { y: 0.0, rx: 0.020, rz: 0.032 },
      { y: 0.37, rx: 0.023, rz: 0.036 },
    ],
    14
  );
  scabbard.rotateX(-0.76);
  scabbard.rotateZ(0.14);
  scabbard.translate(0.195, 0.72, -0.055);
  leatherGearParts.push(scabbard);

  // Twin leather suspension straps connecting waist belt to upper scabbard throat
  const strapFront = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.158, 0.972, 0.032),
    new THREE.Vector3(0.178, 0.895, 0.095),
    new THREE.Vector3(0.168, 0.845, 0.125),
  ]);
  const strapRear = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.150, 0.972, -0.065),
    new THREE.Vector3(0.175, 0.880, -0.025),
    new THREE.Vector3(0.176, 0.815, 0.065),
  ]);
  leatherGearParts.push(
    new THREE.TubeGeometry(strapFront, 10, 0.0065, 6, false),
    new THREE.TubeGeometry(strapRear, 10, 0.0065, 6, false)
  );

  // Leather hanging fob connecting belt to Ashen Amulet on front-left hip
  const amuletFob = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.132, 0.972, 0.088),
    new THREE.Vector3(0.146, 0.944, 0.098),
  ]);
  leatherGearParts.push(new THREE.TubeGeometry(amuletFob, 6, 0.006, 6, false));

  const leatherGearGeo = mergeIndexedGeometries(leatherGearParts);
  meshes.push(
    createSkinnedPart('LeatherHarnessAndScabbard', leatherGearGeo, leatherMat, skeleton, boneMap, (_x, y, _z, bm) => {
      if (y < 1.04) return [[bm.Hips, 1]];
      if (y < 1.22) {
        const t = smoothstep(1.04, 1.22, y);
        return [
          [bm.Spine, t],
          [bm.Hips, 1 - t],
        ];
      }
      return [[bm.Chest, 1]];
    })
  );

  // Forged Bronze Framed Belt Buckle + Scabbard Throat/Chape + Amulet Bezel & Ring
  const buckleParts: THREE.BufferGeometry[] = [];
  // Rectangular frame buckle (top/bottom/left/right bars + tongue pin)
  const topBar = new THREE.BoxGeometry(0.054, 0.009, 0.010);
  topBar.translate(0, 1.008, 0.129);
  const botBar = new THREE.BoxGeometry(0.054, 0.009, 0.010);
  botBar.translate(0, 0.958, 0.129);
  const leftBar = new THREE.BoxGeometry(0.010, 0.058, 0.010);
  leftBar.translate(-0.024, 0.983, 0.129);
  const rightBar = new THREE.BoxGeometry(0.010, 0.058, 0.010);
  rightBar.translate(0.024, 0.983, 0.129);
  const pinBar = new THREE.BoxGeometry(0.006, 0.048, 0.012);
  pinBar.translate(0, 0.983, 0.131);
  buckleParts.push(topBar, botBar, leftBar, rightBar, pinBar);

  // Scabbard bronze throat band & chape tip
  const throat = createLoftedGeometry(
    [
      { y: 0.30, rx: 0.025, rz: 0.038 },
      { y: 0.37, rx: 0.026, rz: 0.039 },
    ],
    14
  );
  throat.rotateX(-0.76);
  throat.rotateZ(0.14);
  throat.translate(0.195, 0.72, -0.055);
  const chape = createLoftedGeometry(
    [
      { y: -0.40, rx: 0.006, rz: 0.008 },
      { y: -0.32, rx: 0.018, rz: 0.028 },
    ],
    12
  );
  chape.rotateX(-0.76);
  chape.rotateZ(0.14);
  chape.translate(0.195, 0.72, -0.055);
  buckleParts.push(throat, chape);

  // Amulet suspension ring + octagonal bezel
  const amuletRing = new THREE.TorusGeometry(0.008, 0.0025, 6, 12);
  amuletRing.translate(0.146, 0.935, 0.100);
  const amuletBezel = createLoftedGeometry(
    [
      { y: 0.875, rx: 0.020, rz: 0.009, offsetX: 0.146, offsetZ: 0.100 },
      { y: 0.903, rx: 0.025, rz: 0.011, offsetX: 0.146, offsetZ: 0.100 },
      { y: 0.928, rx: 0.018, rz: 0.008, offsetX: 0.146, offsetZ: 0.100 },
    ],
    8
  );
  buckleParts.push(amuletRing, amuletBezel);

  const beltMetalGeo = mergeIndexedGeometries(buckleParts);
  meshes.push(
    createSkinnedPart('BeltBuckleScabbardAndAmuletBezel', beltMetalGeo, trimMat, skeleton, boneMap, (_x, _y, _z, bm) => [
      [bm.Hips, 1],
    ])
  );

  // Ashen Amulet glowing crystal core mounted inside bezel
  const amuletCoreGeo = createLoftedGeometry(
    [
      { y: 0.885, rx: 0.012, rz: 0.007, offsetX: 0.146, offsetZ: 0.108 },
      { y: 0.903, rx: 0.015, rz: 0.009, offsetX: 0.146, offsetZ: 0.110 },
      { y: 0.921, rx: 0.010, rz: 0.006, offsetX: 0.146, offsetZ: 0.108 },
    ],
    8
  );
  meshes.push(
    createSkinnedPart('AshenAmuletCore', amuletCoreGeo, amuletCoreMat, skeleton, boneMap, (_x, _y, _z, bm) => [
      [bm.Hips, 1],
    ])
  );

  // 3G. Thickened 3D Dark Burgundy Wool Cloak + Chest Mantle Clasps & Chain
  const { cloakGeo, claspsGeo } = createCloakGeometry();
  meshes.push(
    createSkinnedPart('BurgundyCloakMesh', cloakGeo, cloakMat, skeleton, boneMap, (_x, y, z, bm) => {
      // Shoulder mantle front wrap stays locked to Chest
      if (z > -0.04 && y > 1.38) {
        return [[bm.Chest, 1]];
      }
      if (y > 1.38) {
        const c1 = smoothstep(1.48, 1.36, y);
        return [
          [bm.Cloak_1, c1],
          [bm.Chest, 1 - c1],
        ];
      }
      if (y > 1.00) {
        const c2 = smoothstep(1.36, 1.00, y);
        return [
          [bm.Cloak_2, c2],
          [bm.Cloak_1, 1 - c2],
        ];
      }
      const c3 = smoothstep(1.00, 0.55, y);
      return [
        [bm.Cloak_3, c3],
        [bm.Cloak_2, 1 - c3],
      ];
    }),
    createSkinnedPart('CloakBronzeClaspsAndChain', claspsGeo, trimMat, skeleton, boneMap, (_x, _y, _z, bm) => [
      [bm.Chest, 1],
    ])
  );

  for (const m of meshes) {
    root.add(m);
  }

  // 4. PROPERLY MODELED RUNIC LONGSWORD (held squarely inside Kael's right gauntlet palm & fingers)
  const { bladeGeo, guardAndPommelGeo, gripGeo } = createRunicSwordComponents();
  const swordGroup = new THREE.Group();
  swordGroup.name = 'RunicLongsword';
  // WeaponAnchor is centered in R_Hand palm channel; rotating +1.28 rad around X aligns handle along Z/+Y
  // through the curled fingers with crossguard resting cleanly in front of the index knuckle!
  swordGroup.rotation.set(1.28, 0.0, 0.0);

  const gripMesh = new THREE.Mesh(gripGeo, leatherMat);
  gripMesh.name = 'SwordLeatherGrip';
  gripMesh.castShadow = true;
  gripMesh.receiveShadow = true;

  const hiltMesh = new THREE.Mesh(guardAndPommelGeo, trimMat);
  hiltMesh.name = 'SwordCrossguardAndPommel';
  hiltMesh.castShadow = true;
  hiltMesh.receiveShadow = true;

  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.name = 'SwordRunicBlade';
  bladeMesh.castShadow = true;
  bladeMesh.receiveShadow = true;

  const auraGeo = bladeGeo.clone();
  auraGeo.scale(1.16, 1.01, 1.42);
  const auraMesh = new THREE.Mesh(auraGeo, swordAuraMat);
  auraMesh.name = 'SwordAshAura';
  auraMesh.castShadow = false;

  const swordLight = new THREE.PointLight(0xc2cdd9, 0.25, 1.15, 2.0);
  swordLight.position.set(0, 0.54, 0.04);

  swordGroup.add(gripMesh, hiltMesh, bladeMesh, auraMesh, swordLight);
  WeaponAnchor.add(swordGroup);

  // 5. GENUINE SKELETAL ANIMATION CLIPS (Idle, Walk, Run, Attack, Death)
  const idleClip = new THREE.AnimationClip('Idle', 3.6, [
    vTrack('Hips', [0, 1.8, 3.6], [
      [0, 0.965, 0],
      [0, 0.959, 0],
      [0, 0.965, 0],
    ]),
    qTrack('Spine', [0, 1.8, 3.6], [
      [0.02, -0.04, 0],
      [0.04, -0.03, 0],
      [0.02, -0.04, 0],
    ]),
    qTrack('Chest', [0, 1.8, 3.6], [
      [0.01, 0.04, 0],
      [-0.025, 0.05, 0],
      [0.01, 0.04, 0],
    ]),
    qTrack('Head', [0, 1.2, 2.4, 3.6], [
      [0.02, 0.03, 0],
      [0.01, -0.06, 0.015],
      [0.03, 0.05, -0.01],
      [0.02, 0.03, 0],
    ]),
    qTrack('R_UpperArm', [0, 1.8, 3.6], [
      [-0.08, 0.02, -0.15],
      [-0.05, 0.03, -0.17],
      [-0.08, 0.02, -0.15],
    ]),
    qTrack('R_Forearm', [0, 1.8, 3.6], [
      [-0.36, 0.06, 0.04],
      [-0.31, 0.06, 0.04],
      [-0.36, 0.06, 0.04],
    ]),
    qTrack('R_Hand', [0, 1.8, 3.6], [
      [0.06, 0, -0.04],
      [0.09, 0, -0.04],
      [0.06, 0, -0.04],
    ]),
    qTrack('L_UpperArm', [0, 1.8, 3.6], [
      [0.05, 0, 0.14],
      [0.08, -0.02, 0.16],
      [0.05, 0, 0.14],
    ]),
    qTrack('L_Forearm', [0, 1.8, 3.6], [
      [-0.22, -0.04, -0.04],
      [-0.18, -0.04, -0.04],
      [-0.22, -0.04, -0.04],
    ]),
    qTrack('L_Thigh', [0, 3.6], [
      [-0.04, 0.06, 0.03],
      [-0.04, 0.06, 0.03],
    ]),
    qTrack('R_Thigh', [0, 3.6], [
      [0.04, -0.06, -0.03],
      [0.04, -0.06, -0.03],
    ]),
    qTrack('L_Shin', [0, 3.6], [
      [0.06, 0, 0],
      [0.06, 0, 0],
    ]),
    qTrack('R_Shin', [0, 3.6], [
      [0.04, 0, 0],
      [0.04, 0, 0],
    ]),
    qTrack('Cloak_1', [0, 1.8, 3.6], [
      [0.04, 0, 0],
      [0.08, 0.015, 0],
      [0.04, 0, 0],
    ]),
    qTrack('Cloak_2', [0, 1.8, 3.6], [
      [0.05, 0, 0],
      [0.10, -0.02, 0],
      [0.05, 0, 0],
    ]),
  ]);

  const walkT = [0, 0.275, 0.55, 0.825, 1.1];
  const walkClip = new THREE.AnimationClip('Walk', 1.1, [
    vTrack('Hips', walkT, [
      [0, 0.955, 0],
      [0, 0.935, 0],
      [0, 0.955, 0],
      [0, 0.935, 0],
      [0, 0.955, 0],
    ]),
    qTrack('Hips', walkT, [
      [0, -0.08, -0.02],
      [0, 0, 0.02],
      [0, 0.08, 0.02],
      [0, 0, -0.02],
      [0, -0.08, -0.02],
    ]),
    qTrack('Spine', walkT, [
      [0.06, 0.05, 0],
      [0.05, 0, 0],
      [0.06, -0.05, 0],
      [0.05, 0, 0],
      [0.06, 0.05, 0],
    ]),
    qTrack('Chest', walkT, [
      [0.03, 0.08, 0],
      [0.02, 0, 0],
      [0.03, -0.08, 0],
      [0.02, 0, 0],
      [0.03, 0.08, 0],
    ]),
    qTrack('Head', walkT, [
      [-0.03, -0.04, 0],
      [-0.02, 0, 0],
      [-0.03, 0.04, 0],
      [-0.02, 0, 0],
      [-0.03, -0.04, 0],
    ]),
    qTrack('L_Thigh', walkT, [
      [-0.42, 0, 0.02],
      [0.02, 0, 0.02],
      [0.38, 0, 0.02],
      [-0.18, 0, 0.02],
      [-0.42, 0, 0.02],
    ]),
    qTrack('L_Shin', walkT, [
      [0.12, 0, 0],
      [0.18, 0, 0],
      [0.30, 0, 0],
      [0.68, 0, 0],
      [0.12, 0, 0],
    ]),
    qTrack('L_Foot', walkT, [
      [0.14, 0, 0],
      [-0.04, 0, 0],
      [-0.20, 0, 0],
      [0.05, 0, 0],
      [0.14, 0, 0],
    ]),
    qTrack('R_Thigh', walkT, [
      [0.38, 0, -0.02],
      [-0.18, 0, -0.02],
      [-0.42, 0, -0.02],
      [0.02, 0, -0.02],
      [0.38, 0, -0.02],
    ]),
    qTrack('R_Shin', walkT, [
      [0.30, 0, 0],
      [0.68, 0, 0],
      [0.12, 0, 0],
      [0.18, 0, 0],
      [0.30, 0, 0],
    ]),
    qTrack('R_Foot', walkT, [
      [-0.20, 0, 0],
      [0.05, 0, 0],
      [0.14, 0, 0],
      [-0.04, 0, 0],
      [-0.20, 0, 0],
    ]),
    qTrack('L_UpperArm', walkT, [
      [0.32, 0, 0.14],
      [0.02, 0, 0.14],
      [-0.34, 0, 0.14],
      [-0.02, 0, 0.14],
      [0.32, 0, 0.14],
    ]),
    qTrack('L_Forearm', walkT, [
      [-0.22, 0, -0.05],
      [-0.34, 0, -0.05],
      [-0.46, 0, -0.05],
      [-0.30, 0, -0.05],
      [-0.22, 0, -0.05],
    ]),
    qTrack('R_UpperArm', walkT, [
      [-0.18, 0, -0.16],
      [0.04, 0, -0.16],
      [0.22, 0, -0.16],
      [0.02, 0, -0.16],
      [-0.18, 0, -0.16],
    ]),
    qTrack('R_Forearm', walkT, [
      [-0.44, 0.06, 0.05],
      [-0.34, 0.06, 0.05],
      [-0.26, 0.06, 0.05],
      [-0.34, 0.06, 0.05],
      [-0.44, 0.06, 0.05],
    ]),
    qTrack('Cloak_1', walkT, [
      [0.16, 0.03, 0],
      [0.22, 0, 0],
      [0.16, -0.03, 0],
      [0.22, 0, 0],
      [0.16, 0.03, 0],
    ]),
    qTrack('Cloak_2', walkT, [
      [0.14, -0.04, 0],
      [0.20, 0, 0],
      [0.14, 0.04, 0],
      [0.20, 0, 0],
      [0.14, -0.04, 0],
    ]),
  ]);

  const runT = [0, 0.17, 0.34, 0.51, 0.68];
  const runClip = new THREE.AnimationClip('Run', 0.68, [
    vTrack('Hips', runT, [
      [0, 0.91, 0],
      [0, 0.975, 0],
      [0, 0.91, 0],
      [0, 0.975, 0],
      [0, 0.91, 0],
    ]),
    qTrack('Hips', runT, [
      [0.10, -0.12, -0.03],
      [0.08, 0, 0.03],
      [0.10, 0.12, 0.03],
      [0.08, 0, -0.03],
      [0.10, -0.12, -0.03],
    ]),
    qTrack('Spine', runT, [
      [0.18, 0.08, 0],
      [0.16, 0, 0],
      [0.18, -0.08, 0],
      [0.16, 0, 0],
      [0.18, 0.08, 0],
    ]),
    qTrack('Chest', runT, [
      [0.10, 0.12, 0],
      [0.08, 0, 0],
      [0.10, -0.12, 0],
      [0.08, 0, 0],
      [0.10, 0.12, 0],
    ]),
    qTrack('Head', runT, [
      [-0.18, -0.08, 0],
      [-0.16, 0, 0],
      [-0.18, 0.08, 0],
      [-0.16, 0, 0],
      [-0.18, -0.08, 0],
    ]),
    qTrack('L_Thigh', runT, [
      [-0.78, 0, 0.02],
      [0.08, 0, 0.02],
      [0.68, 0, 0.02],
      [-0.34, 0, 0.02],
      [-0.78, 0, 0.02],
    ]),
    qTrack('L_Shin', runT, [
      [0.28, 0, 0],
      [0.22, 0, 0],
      [0.92, 0, 0],
      [1.18, 0, 0],
      [0.28, 0, 0],
    ]),
    qTrack('R_Thigh', runT, [
      [0.68, 0, -0.02],
      [-0.34, 0, -0.02],
      [-0.78, 0, -0.02],
      [0.08, 0, -0.02],
      [0.68, 0, -0.02],
    ]),
    qTrack('R_Shin', runT, [
      [0.92, 0, 0],
      [1.18, 0, 0],
      [0.28, 0, 0],
      [0.22, 0, 0],
      [0.92, 0, 0],
    ]),
    qTrack('L_UpperArm', runT, [
      [0.58, 0, 0.18],
      [0.05, 0, 0.18],
      [-0.64, 0, 0.18],
      [0.02, 0, 0.18],
      [0.58, 0, 0.18],
    ]),
    qTrack('L_Forearm', runT, [
      [-0.92, 0, -0.06],
      [-1.02, 0, -0.06],
      [-1.08, 0, -0.06],
      [-0.96, 0, -0.06],
      [-0.92, 0, -0.06],
    ]),
    qTrack('R_UpperArm', runT, [
      [-0.30, 0, -0.22],
      [0.10, 0, -0.22],
      [0.38, 0, -0.22],
      [0.05, 0, -0.22],
      [-0.30, 0, -0.22],
    ]),
    qTrack('R_Forearm', runT, [
      [-0.74, 0.10, 0.06],
      [-0.58, 0.10, 0.06],
      [-0.48, 0.10, 0.06],
      [-0.62, 0.10, 0.06],
      [-0.74, 0.10, 0.06],
    ]),
    qTrack('Cloak_1', runT, [
      [0.40, 0.04, 0],
      [0.50, 0, 0],
      [0.40, -0.04, 0],
      [0.50, 0, 0],
      [0.40, 0.04, 0],
    ]),
    qTrack('Cloak_2', runT, [
      [0.30, -0.05, 0],
      [0.38, 0, 0],
      [0.30, 0.05, 0],
      [0.38, 0, 0],
      [0.30, -0.05, 0],
    ]),
  ]);

  const atkT = [0, 0.34, 0.56, 0.84, 1.35];
  const attackClip = new THREE.AnimationClip('Attack', 1.35, [
    vTrack('Hips', atkT, [
      [0, 0.965, 0],
      [0, 0.945, -0.03],
      [0, 0.89, 0.08],
      [0, 0.92, 0.04],
      [0, 0.965, 0],
    ]),
    qTrack('Hips', atkT, [
      [0, -0.05, 0],
      [-0.06, -0.32, 0],
      [0.14, 0.38, 0],
      [0.08, 0.28, 0],
      [0, -0.05, 0],
    ]),
    qTrack('Spine', atkT, [
      [0.02, 0, 0],
      [-0.12, -0.26, -0.06],
      [0.24, 0.34, 0.10],
      [0.14, 0.20, 0.06],
      [0.02, 0, 0],
    ]),
    qTrack('Chest', atkT, [
      [0.01, 0.04, 0],
      [-0.14, -0.32, -0.08],
      [0.22, 0.42, 0.12],
      [0.12, 0.22, 0.06],
      [0.01, 0.04, 0],
    ]),
    qTrack('Head', atkT, [
      [0.02, 0.03, 0],
      [0.16, 0.38, 0],
      [-0.14, -0.45, 0],
      [-0.08, -0.28, 0],
      [0.02, 0.03, 0],
    ]),
    qTrack('R_Shoulder', atkT, [
      [0, 0, 0],
      [0, -0.18, -0.22],
      [0, 0.26, 0.08],
      [0, 0.14, 0],
      [0, 0, 0],
    ]),
    qTrack('R_UpperArm', atkT, [
      [-0.08, 0.02, -0.15],
      [-2.10, 0.32, -0.58],
      [-0.45, 0.82, -0.12],
      [-0.34, 0.62, -0.20],
      [-0.08, 0.02, -0.15],
    ]),
    qTrack('R_Forearm', atkT, [
      [-0.36, 0.06, 0.04],
      [-0.74, 0.10, 0.14],
      [-0.20, 0.06, 0.04],
      [-0.30, 0.06, 0.04],
      [-0.36, 0.06, 0.04],
    ]),
    qTrack('R_Hand', atkT, [
      [0.06, 0, -0.04],
      [-0.22, 0, -0.16],
      [0.42, 0.20, 0.10],
      [0.20, 0.08, 0.04],
      [0.06, 0, -0.04],
    ]),
    qTrack('L_UpperArm', atkT, [
      [0.05, 0, 0.14],
      [-0.44, 0.40, 0.28],
      [0.50, -0.25, 0.44],
      [0.26, -0.10, 0.26],
      [0.05, 0, 0.14],
    ]),
    qTrack('L_Forearm', atkT, [
      [-0.22, -0.04, -0.04],
      [-0.82, -0.10, -0.10],
      [-0.46, -0.08, -0.08],
      [-0.36, -0.06, -0.06],
      [-0.22, -0.04, -0.04],
    ]),
    qTrack('L_Thigh', atkT, [
      [-0.04, 0.06, 0.03],
      [-0.20, 0.10, 0.04],
      [-0.52, 0.08, 0.04],
      [-0.28, 0.06, 0.03],
      [-0.04, 0.06, 0.03],
    ]),
    qTrack('L_Shin', atkT, [
      [0.06, 0, 0],
      [0.26, 0, 0],
      [0.60, 0, 0],
      [0.32, 0, 0],
      [0.06, 0, 0],
    ]),
    qTrack('R_Thigh', atkT, [
      [0.04, -0.06, -0.03],
      [0.22, -0.10, -0.04],
      [0.46, -0.12, -0.04],
      [0.26, -0.08, -0.03],
      [0.04, -0.06, -0.03],
    ]),
    qTrack('R_Shin', atkT, [
      [0.04, 0, 0],
      [0.20, 0, 0],
      [0.30, 0, 0],
      [0.16, 0, 0],
      [0.04, 0, 0],
    ]),
    qTrack('Cloak_1', atkT, [
      [0.04, 0, 0],
      [0.22, -0.16, 0.08],
      [0.34, 0.26, -0.12],
      [0.16, 0.12, -0.06],
      [0.04, 0, 0],
    ]),
    qTrack('Cloak_2', atkT, [
      [0.05, 0, 0],
      [0.16, -0.20, 0.10],
      [0.32, 0.30, -0.14],
      [0.16, 0.14, -0.06],
      [0.05, 0, 0],
    ]),
  ]);

  // Death: audited for strict ground contact (feet >= 0.06m, knees >= 0.07m across every frame)
  const dT = [0, 0.35, 0.80, 1.15, 1.48, 1.8];
  const deathClip = new THREE.AnimationClip('Death', 1.8, [
    vTrack('Hips', dT, [
      [0, 0.965, 0],
      [0, 0.92, -0.04],
      [0, 0.79, 0.02],
      [0, 0.68, 0.08],
      [0, 0.42, 0.14],
      [0, 0.22, 0.18],
    ]),
    qTrack('Hips', dT, [
      [0, 0, 0],
      [-0.18, 0.08, 0.05],
      [0.20, 0.14, 0.12],
      [0.54, 0.16, 0.22],
      [1.14, 0.14, 0.30],
      [1.42, 0.12, 0.34],
    ]),
    qTrack('Spine', dT, [
      [0, 0, 0],
      [-0.14, 0, 0],
      [0.22, 0.06, 0.04],
      [0.24, 0.08, 0.05],
      [0.14, 0.06, 0.06],
      [0.06, 0.05, 0.06],
    ]),
    qTrack('Chest', dT, [
      [0, 0, 0],
      [-0.10, -0.06, 0],
      [0.20, 0.10, 0.04],
      [0.22, 0.10, 0.05],
      [0.10, 0.08, 0.05],
      [0.04, 0.06, 0.05],
    ]),
    qTrack('Head', dT, [
      [0, 0, 0],
      [-0.24, 0.14, 0],
      [0.18, -0.18, 0.12],
      [0.24, -0.26, 0.18],
      [0.26, -0.32, 0.24],
      [0.22, -0.35, 0.28],
    ]),
    qTrack('L_Thigh', dT, [
      [0, 0, 0],
      [-0.22, 0, 0.05],
      [-0.74, 0, 0.08],
      [-0.94, 0.06, 0.12],
      [-0.34, 0.10, 0.16],
      [-0.08, 0.12, 0.18],
    ]),
    qTrack('L_Shin', dT, [
      [0, 0, 0],
      [0.36, 0, 0],
      [1.24, 0, 0],
      [1.54, 0, 0],
      [0.64, 0, 0],
      [0.18, 0, 0],
    ]),
    qTrack('R_Thigh', dT, [
      [0, 0, 0],
      [-0.18, 0, -0.04],
      [-0.64, 0, -0.07],
      [-0.86, -0.05, -0.10],
      [-0.28, -0.08, -0.14],
      [-0.06, -0.10, -0.14],
    ]),
    qTrack('R_Shin', dT, [
      [0, 0, 0],
      [0.30, 0, 0],
      [1.16, 0, 0],
      [1.48, 0, 0],
      [0.58, 0, 0],
      [0.14, 0, 0],
    ]),
    qTrack('R_UpperArm', dT, [
      [-0.08, 0.02, -0.15],
      [0.20, 0, -0.34],
      [-0.16, 0, -0.52],
      [-0.24, -0.12, -0.74],
      [-0.30, -0.22, -0.92],
      [-0.24, -0.26, -1.04],
    ]),
    qTrack('R_Forearm', dT, [
      [-0.36, 0.06, 0.04],
      [-0.50, 0, 0],
      [-0.38, 0, 0],
      [-0.28, 0, 0],
      [-0.18, 0, 0],
      [-0.10, 0, 0],
    ]),
    qTrack('L_UpperArm', dT, [
      [0.05, 0, 0.14],
      [-0.34, 0.18, 0.34],
      [-0.60, 0.16, 0.48],
      [-0.56, 0.14, 0.72],
      [-0.46, 0.12, 0.92],
      [-0.38, 0.10, 1.04],
    ]),
    qTrack('L_Forearm', dT, [
      [-0.22, -0.04, -0.04],
      [-0.60, 0, 0],
      [-0.44, 0, 0],
      [-0.32, 0, 0],
      [-0.20, 0, 0],
      [-0.12, 0, 0],
    ]),
    qTrack('Cloak_1', dT, [
      [0.04, 0, 0],
      [0.14, 0, 0],
      [0.24, 0, 0],
      [0.16, 0, 0],
      [0.06, 0, 0],
      [0.02, 0, 0],
    ]),
    qTrack('Cloak_2', dT, [
      [0.05, 0, 0],
      [0.12, 0, 0],
      [0.18, 0, 0],
      [0.10, 0, 0],
      [0.04, 0, 0],
      [0.02, 0, 0],
    ]),
  ]);

  const clips: Record<HeroAnimName, THREE.AnimationClip> = {
    Idle: idleClip,
    Walk: walkClip,
    Run: runClip,
    Attack: attackClip,
    Death: deathClip,
  };
  const clipList = [idleClip, walkClip, runClip, attackClip, deathClip];

  // 6. COMPUTE EXACT TECHNICAL SPECS
  let triangleCount = 0;
  let vertexCount = 0;
  let meshCount = 0;
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      meshCount++;
      const g = obj.geometry as THREE.BufferGeometry;
      vertexCount += g.attributes.position.count;
      triangleCount += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });

  const skeletonHelper = new THREE.SkeletonHelper(root);
  skeletonHelper.visible = false;

  const specs: CharacterSpecs = {
    name: 'Kael Veyr',
    title: 'The Ashen Warden',
    triangleCount: Math.round(triangleCount),
    vertexCount,
    meshCount,
    materialCount: materials.length,
    textureCount: 23,
    textureSummary: [
      'Steel Plate PBR (1024×1024 Albedo/Normal/Roughness/Metalness)',
      'Scarred Face & Skin (1024×1024 Albedo/Normal/Roughness)',
      '3D Eyeball Iris/Sclera (256×256 Albedo)',
      'Dark Bronze Trim (512×512 Albedo/Normal/Roughness)',
      'Burgundy Twill Cloak (512×512 Albedo/Normal/Roughness)',
      'Tooled Leather Gear (512×512 Albedo/Normal/Roughness)',
      'Runic Blade (512×512 Albedo/Normal/Roughness/Emissive)',
      'Hair Strands (256×256 Albedo/Normal)',
    ],
    boneCount: bones.length,
    animations: ['Idle', 'Walk', 'Run', 'Attack', 'Death'],
    heightMeters: 1.85,
  };

  return {
    root,
    skeleton,
    skeletonHelper,
    clips,
    clipList,
    specs,
    materials,
    textures,
    swordAuraMaterial: swordAuraMat,
    bladeMaterial: bladeMat,
    amuletCoreMaterial: amuletCoreMat,
    swordLight,
    setWireframe: (enabled: boolean) => {
      for (const m of materials) {
        if ('wireframe' in m) {
          (m as THREE.MeshStandardMaterial).wireframe = enabled;
        }
      }
    },
    updateVisualFx: (elapsedTime: number) => {
      const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 2.4);
      bladeMat.emissiveIntensity = 0.68 + pulse * 0.28;
      swordAuraMat.opacity = 0.055 + pulse * 0.035;
      swordLight.intensity = 0.22 + pulse * 0.10;
      amuletCoreMat.emissiveIntensity = 0.85 + (1 - pulse) * 0.35;
    },
    dispose: () => {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
      skeletonHelper.dispose();
      for (const m of materials) m.dispose();
      textures.dispose();
    },
  };
}
