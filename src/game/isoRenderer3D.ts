/**
 * ASHEN CROWN — 3D-изометрический PBR-рендерер игрового мира на базе Three.js.
 *
 * Архитектурные гарантии:
 * 1. Математическая проекция OrthographicCamera 1:1 совпадает с `src/game/iso.ts`
 *    (точность < 0.01 px во всех координатах и уровнях зума) — клики, рамка, миникарта и HUD
 *    работают без сдвига.
 * 2. Полный ландшафт 42×42 + естественная внешняя горная/долинная юбка в тумане горизонта
 *    (нет «плавающего в пустоте квадрата»).
 * 3. Адаптация под мобильные GPU и программный WebGL (SwiftShader/llvmpipe): ограничение DPR,
 *    динамическое управление тенями, GPU-fence pacing на software GL, обработка `webglcontextlost`.
 * 4. Не изменяет игровые механики и правила ASHEN CROWN v14.2.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Camera, MAP_SIZE, worldToGrid } from './iso';
import {
  BuildingRig3D,
  ModelLibrary3D,
  PropRig3D,
  UnitRig3D,
} from './isoModels3D';
import { createWorldTextures, WorldTextureSet } from './isoTextures3D';
import type { RenderState } from './renderer';
import type { Particle, Projectile, TerrainType, Tile } from './types';

/** Точный масштаб пикселей на 1 единицу 3D-мира, эквивалентный TILE_W=64, TILE_H=32 */
export const ISO_3D_SCALE = 32 * Math.SQRT2;
/** Точная высота 1 ступени рельефа в 3D-единицах, эквивалентная ELEV_STEP=10 */
export const ISO_3D_ELEV_UNIT = 10 / (16 * Math.sqrt(6));
/** Направление камеры (30° pitch, 45° azimuth) */
const CAM_DIR_XZ = Math.sqrt(6) / 4;
const CAM_DIR_Y = 0.5;
const CAM_DIST = 64;

/**
 * Чистая математическая функция проекции 3D-координаты `(gx, elev, gy)` в экранные пиксели
 * через ту же ортографическую матрицу, что использует `IsoWorldRenderer3D`.
 * Используется в автотестах для проверки точного совпадения 1:1 с `src/game/iso.ts`.
 */
export function projectGridPoint3D(
  gx: number,
  elev: number,
  gy: number,
  camera: Camera,
  viewportW: number,
  viewportH: number
): { sx: number; sy: number } {
  const { gx: tx, gy: tz } = worldToGrid(camera.x, camera.y, 1);
  const targetY = 1 * ISO_3D_ELEV_UNIT;

  const cam = new THREE.OrthographicCamera(
    -(viewportW * 0.5) / (camera.zoom * ISO_3D_SCALE),
    (viewportW * 0.5) / (camera.zoom * ISO_3D_SCALE),
    (viewportH * 0.5) / (camera.zoom * ISO_3D_SCALE),
    -(viewportH * 0.5) / (camera.zoom * ISO_3D_SCALE),
    1,
    220
  );
  cam.up.set(0, 1, 0);
  cam.position.set(
    tx + CAM_DIST * CAM_DIR_XZ,
    targetY + CAM_DIST * CAM_DIR_Y,
    tz + CAM_DIST * CAM_DIR_XZ
  );
  cam.lookAt(tx, targetY, tz);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();

  const p = new THREE.Vector3(gx, elev * ISO_3D_ELEV_UNIT, gy).project(cam);
  return {
    sx: (p.x * 0.5 + 0.5) * viewportW,
    sy: (-p.y * 0.5 + 0.5) * viewportH,
  };
}

function tileHash(gx: number, gy: number, salt = 0): number {
  const n = Math.sin(gx * 127.1 + gy * 311.7 + salt * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function terrainAlbedoHex(terrain: TerrainType, gx: number, gy: number): [number, number, number] {
  const macro =
    (Math.sin(gx * 0.34 + gy * 0.27) * 0.5 + Math.cos(gx * 0.19 - gy * 0.41) * 0.5) * 0.014;
  const micro = (tileHash(gx, gy, 11) - 0.5) * 0.02;
  const n = macro + micro;
  // Calibrated linear-RGB albedos for Three.js r160+ PBR pipeline (prevents washed-out pastel grass)
  let r = 0.075;
  let g = 0.168;
  let b = 0.048;
  switch (terrain) {
    case 'water':
      r = 0.022;
      g = 0.088;
      b = 0.135;
      break;
    case 'bridge':
      r = 0.21;
      g = 0.145;
      b = 0.088;
      break;
    case 'stone_road':
      r = 0.215;
      g = 0.205;
      b = 0.18;
      break;
    case 'ruin_floor':
      r = 0.14;
      g = 0.165;
      b = 0.13;
      break;
    case 'orc_dirt':
      r = 0.15;
      g = 0.085;
      b = 0.05;
      break;
    case 'forest_floor':
      r = 0.042;
      g = 0.105;
      b = 0.036;
      break;
    case 'grass':
    default:
      r = 0.075;
      g = 0.168;
      b = 0.048;
      break;
  }
  return [
    Math.min(1, Math.max(0.015, r + n)),
    Math.min(1, Math.max(0.015, g + n * 1.1)),
    Math.min(1, Math.max(0.015, b + n * 0.65)),
  ];
}

interface FxPoolItem {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
}

export interface IsoRenderer3DOptions {
  onContextLost?: () => void;
}

export class IsoWorldRenderer3D {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.OrthographicCamera;
  public readonly isSoftwareGl: boolean;
  public readonly isMobileProfile: boolean;

  private readonly mountEl: HTMLElement;
  private readonly textures: WorldTextureSet;
  private readonly models: ModelLibrary3D;
  private readonly envRT: THREE.WebGLRenderTarget;

  private readonly sunLight: THREE.DirectionalLight;
  private readonly sunTarget: THREE.Object3D;
  private readonly spellLight: THREE.PointLight;
  private readonly bindstoneLight: THREE.PointLight;
  private readonly portalLight: THREE.PointLight;
  private readonly campfireLights: THREE.PointLight[] = [];

  private terrainMesh: THREE.Mesh | null = null;
  private skirtMesh: THREE.Mesh | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private bridgeGroup: THREE.Group = new THREE.Group();
  private fogOverlayMesh: THREE.Mesh | null = null;
  private fogDataTex: THREE.DataTexture;
  private fogBuffer: Uint8Array;
  private fogFrameCounter = 0;

  private propGroup: THREE.Group = new THREE.Group();
  private floraGroup: THREE.Group = new THREE.Group();
  private buildingGroup: THREE.Group = new THREE.Group();
  private unitGroup: THREE.Group = new THREE.Group();
  private projectileGroup: THREE.Group = new THREE.Group();
  private fxGroup: THREE.Group = new THREE.Group();
  private ambientMotes: THREE.Points | null = null;

  private propRigs: Map<string, PropRig3D> = new Map();
  private buildingRigs: Map<string, BuildingRig3D> = new Map();
  private unitRigs: Map<string, UnitRig3D> = new Map();
  private projectileMeshes: Map<string, THREE.Object3D> = new Map();

  private ringPool: FxPoolItem[] = [];
  private pillarPool: FxPoolItem[] = [];
  private sparkPool: FxPoolItem[] = [];

  private builtWorldKey = '';
  private disposed = false;
  private lastViewportW = 0;
  private lastViewportH = 0;

  private readonly _tmpColor = new THREE.Color();
  private readonly onContextLostHandler: (e: Event) => void;

  constructor(mountEl: HTMLElement, options?: IsoRenderer3DOptions) {
    this.mountEl = mountEl;
    this.isMobileProfile =
      typeof window !== 'undefined' &&
      (window.innerWidth < 820 || window.matchMedia?.('(pointer: coarse)').matches);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobileProfile,
      powerPreference: 'high-performance',
      alpha: false,
      preserveDrawingBuffer: false,
    });

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuStr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    this.isSoftwareGl = /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(gpuStr);

    const maxDpr = this.isSoftwareGl ? 1.0 : this.isMobileProfile ? 1.5 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(canvas);

    this.onContextLostHandler = (ev: Event) => {
      ev.preventDefault();
      options?.onContextLost?.();
    };
    canvas.addEventListener('webglcontextlost', this.onContextLostHandler);

    // Scene & Separated Horizon Atmosphere Fog
    // Линейный туман начинается за пределами игрового поля (74..148 при CAM_DIST=64),
    // чтобы не затемнять и не «замыливать» рабочую карту, но мягко растворять горный горизонт.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141d29);
    this.scene.fog = new THREE.Fog(0x162130, 74, 148);

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 240);
    this.camera.up.set(0, 1, 0);

    // Procedural RoomEnvironment IBL
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRT = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRT.texture;
    roomEnv.dispose();
    pmrem.dispose();

    // Procedural PBR textures & model library
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createWorldTextures(this.isMobileProfile ? 2 : maxAniso);
    this.models = new ModelLibrary3D(this.textures);

    // Cohesive Dark-Fantasy 3-Point Outdoor Lighting Rig
    const hemi = new THREE.HemisphereLight(0xa8c6eb, 0x2d2b22, 0.74);
    this.scene.add(hemi);

    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sunLight = new THREE.DirectionalLight(0xffe4b5, 2.08);
    this.sunLight.target = this.sunTarget;
    this.sunLight.castShadow = !this.isSoftwareGl;
    const shadowSize = this.isMobileProfile ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 92;
    const shadowSpan = this.isMobileProfile ? 19 : 26;
    this.sunLight.shadow.camera.left = -shadowSpan;
    this.sunLight.shadow.camera.right = shadowSpan;
    this.sunLight.shadow.camera.top = shadowSpan;
    this.sunLight.shadow.camera.bottom = -shadowSpan;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);

    const rimLight = new THREE.DirectionalLight(0x7db3f5, 0.46);
    rimLight.position.set(-28, 18, -24);
    this.scene.add(rimLight);

    // Practical accent PointLights
    this.bindstoneLight = new THREE.PointLight(0x38bdf8, 2.6, 8.2, 1.5);
    this.bindstoneLight.visible = false;
    this.scene.add(this.bindstoneLight);

    this.portalLight = new THREE.PointLight(0x818cf8, 3.0, 9.0, 1.45);
    this.portalLight.visible = false;
    this.scene.add(this.portalLight);

    this.spellLight = new THREE.PointLight(0xf97316, 0, 8.5, 1.45);
    this.spellLight.visible = false;
    this.scene.add(this.spellLight);

    // Fog of War smooth RGBA DataTexture (отделена от декоративного атмосферного тумана)
    this.fogBuffer = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
    this.fogDataTex = new THREE.DataTexture(
      this.fogBuffer,
      MAP_SIZE,
      MAP_SIZE,
      THREE.RGBAFormat
    );
    this.fogDataTex.magFilter = THREE.LinearFilter;
    this.fogDataTex.minFilter = THREE.LinearFilter;
    this.fogDataTex.generateMipmaps = false;
    this.fogDataTex.needsUpdate = true;

    this.scene.add(
      this.bridgeGroup,
      this.floraGroup,
      this.propGroup,
      this.buildingGroup,
      this.unitGroup,
      this.projectileGroup,
      this.fxGroup
    );

    this.initFxPools();
    this.initAmbientMotes();
  }

  private initFxPools(): void {
    const ringGeo = new THREE.RingGeometry(0.32, 0.5, 24);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.fxGroup.add(mesh);
      this.ringPool.push({ mesh, mat, active: false });
    }

    const pillarGeo = new THREE.CylinderGeometry(0.38, 0.52, 3.2, 16, 1, true);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(pillarGeo, mat);
      mesh.visible = false;
      this.fxGroup.add(mesh);
      this.pillarPool.push({ mesh, mat, active: false });
    }

    const sparkGeo = new THREE.OctahedronGeometry(0.09, 0);
    const sparkCount = this.isSoftwareGl ? 36 : this.isMobileProfile ? 60 : 110;
    for (let i = 0; i < sparkCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.visible = false;
      this.fxGroup.add(mesh);
      this.sparkPool.push({ mesh, mat, active: false });
    }
  }

  private initAmbientMotes(): void {
    const count = this.isSoftwareGl ? 45 : this.isMobileProfile ? 90 : 160;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * MAP_SIZE;
      positions[i * 3 + 1] = 0.6 + Math.random() * 3.4;
      positions[i * 3 + 2] = Math.random() * MAP_SIZE;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfde68a,
      size: 0.14,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.ambientMotes = new THREE.Points(geo, mat);
    this.scene.add(this.ambientMotes);
  }

  private buildWorldStaticGeometry(tiles: Tile[][]): void {
    // Cleanup previous terrain if world reset
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
      this.terrainMesh = null;
    }
    if (this.skirtMesh) {
      this.scene.remove(this.skirtMesh);
      this.skirtMesh.geometry.dispose();
      (this.skirtMesh.material as THREE.Material).dispose();
      this.skirtMesh = null;
    }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
      this.waterMesh = null;
    }
    if (this.fogOverlayMesh) {
      this.scene.remove(this.fogOverlayMesh);
      this.fogOverlayMesh.geometry.dispose();
      (this.fogOverlayMesh.material as THREE.Material).dispose();
      this.fogOverlayMesh = null;
    }
    this.bridgeGroup.clear();
    this.disposeFloraGroup();
    this.propGroup.clear();
    this.propRigs.clear();
    for (const l of this.campfireLights) this.scene.remove(l);
    this.campfireLights.length = 0;
    this.bindstoneLight.visible = false;
    this.portalLight.visible = false;

    // 1. Sculpted 42x42 Terrain Mesh with Organic Biome-Blended Corners & Shoreline Transitions
    // Roads, bridges, and ruin floors preserve crisp edges for tactical grid readability.
    const vertsPerTile = 4;
    const totalTiles = MAP_SIZE * MAP_SIZE;
    const positions = new Float32Array(totalTiles * vertsPerTile * 3);
    const colors = new Float32Array(totalTiles * vertsPerTile * 3);
    const uvs = new Float32Array(totalTiles * vertsPerTile * 2);
    const indices = new Uint32Array(totalTiles * 6);

    const isArchitecturalTile = (t: TerrainType): boolean =>
      t === 'stone_road' || t === 'bridge' || t === 'ruin_floor';

    const getCornerElev = (vx: number, vz: number): number => {
      let sum = 0;
      let cnt = 0;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = Math.min(MAP_SIZE - 1, Math.max(0, vx + dx));
          const ty = Math.min(MAP_SIZE - 1, Math.max(0, vz + dz));
          const t = tiles[ty]?.[tx];
          if (t) {
            const e = t.terrain === 'water' ? -0.35 : t.elevation;
            sum += e;
            cnt += 1;
          }
        }
      }
      return (cnt > 0 ? sum / cnt : 1) * ISO_3D_ELEV_UNIT;
    };

    const getCornerColor = (
      tile: Tile,
      vx: number,
      vz: number,
      ownColor: [number, number, number]
    ): [number, number, number] => {
      if (isArchitecturalTile(tile.terrain) || tile.terrain === 'water') {
        return ownColor;
      }
      let r = ownColor[0] * 1.4;
      let g = ownColor[1] * 1.4;
      let b = ownColor[2] * 1.4;
      let weight = 1.4;
      let touchesWater = false;

      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = Math.min(MAP_SIZE - 1, Math.max(0, vx + dx));
          const ty = Math.min(MAP_SIZE - 1, Math.max(0, vz + dz));
          const nb = tiles[ty]?.[tx];
          if (!nb) continue;
          if (nb.terrain === 'water') {
            touchesWater = true;
            // Damp earthy riverbank sand/pebble transition (linear RGB)
            r += 0.13 * 0.85;
            g += 0.115 * 0.85;
            b += 0.08 * 0.85;
            weight += 0.85;
          } else if (!isArchitecturalTile(nb.terrain)) {
            const [nr, ng, nbCol] = terrainAlbedoHex(nb.terrain, tx, ty);
            r += nr * 0.75;
            g += ng * 0.75;
            b += nbCol * 0.75;
            weight += 0.75;
          }
        }
      }

      const outR = r / weight;
      const outG = g / weight;
      const outB = b / weight;
      return touchesWater ? [outR * 0.94, outG * 0.93, outB * 0.9] : [outR, outG, outB];
    };

    let vPtr = 0;
    let iPtr = 0;
    const bridgePlankMat = new THREE.MeshStandardMaterial({
      color: 0x7c5a3c,
      map: this.textures.timber,
      bumpMap: this.textures.timberBump,
      bumpScale: 0.04,
      roughness: 0.84,
      metalness: 0.05,
    });
    const bridgePostGeo = new THREE.BoxGeometry(0.12, 0.42, 0.12);
    const bridgeDeckGeo = new THREE.BoxGeometry(1.04, 0.14, 1.04);

    // Instanced flora & micro-detail collectors
    const grassMatrices: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const shrubMatrices: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const pebbleMatrices: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const reedMatrices: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const rootMatrices: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];

    const tmpMat4 = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const tmpEuler = new THREE.Euler();
    const detailDensity = this.isSoftwareGl ? 0.45 : this.isMobileProfile ? 0.65 : 1.0;

    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const tile = tiles[gy][gx];
        const ownColor = terrainAlbedoHex(tile.terrain, gx, gy);

        const y00 = tile.terrain === 'water' ? -0.44 * ISO_3D_ELEV_UNIT : getCornerElev(gx, gy);
        const y10 = tile.terrain === 'water' ? -0.44 * ISO_3D_ELEV_UNIT : getCornerElev(gx + 1, gy);
        const y11 = tile.terrain === 'water' ? -0.44 * ISO_3D_ELEV_UNIT : getCornerElev(gx + 1, gy + 1);
        const y01 = tile.terrain === 'water' ? -0.44 * ISO_3D_ELEV_UNIT : getCornerElev(gx, gy + 1);

        const c00 = getCornerColor(tile, gx, gy, ownColor);
        const c10 = getCornerColor(tile, gx + 1, gy, ownColor);
        const c11 = getCornerColor(tile, gx + 1, gy + 1, ownColor);
        const c01 = getCornerColor(tile, gx, gy + 1, ownColor);

        const baseV = vPtr;
        const corners: Array<[number, number, number, number, number, [number, number, number]]> = [
          [gx, y00, gy, gx / MAP_SIZE, gy / MAP_SIZE, c00],
          [gx + 1, y10, gy, (gx + 1) / MAP_SIZE, gy / MAP_SIZE, c10],
          [gx + 1, y11, gy + 1, (gx + 1) / MAP_SIZE, (gy + 1) / MAP_SIZE, c11],
          [gx, y01, gy + 1, gx / MAP_SIZE, (gy + 1) / MAP_SIZE, c01],
        ];
        for (const [px, py, pz, u, v, col] of corners) {
          positions[vPtr * 3] = px;
          positions[vPtr * 3 + 1] = py;
          positions[vPtr * 3 + 2] = pz;
          colors[vPtr * 3] = col[0];
          colors[vPtr * 3 + 1] = col[1];
          colors[vPtr * 3 + 2] = col[2];
          uvs[vPtr * 2] = u;
          uvs[vPtr * 2 + 1] = v;
          vPtr += 1;
        }
        indices[iPtr++] = baseV;
        indices[iPtr++] = baseV + 3;
        indices[iPtr++] = baseV + 1;
        indices[iPtr++] = baseV + 1;
        indices[iPtr++] = baseV + 3;
        indices[iPtr++] = baseV + 2;

        // 3D Bridge deck & guard posts
        if (tile.terrain === 'bridge') {
          const deck = new THREE.Mesh(bridgeDeckGeo, bridgePlankMat);
          deck.position.set(gx + 0.5, tile.elevation * ISO_3D_ELEV_UNIT + 0.04, gy + 0.5);
          deck.receiveShadow = true;
          deck.castShadow = true;
          this.bridgeGroup.add(deck);

          if ((gx + gy) % 2 === 0) {
            const p1 = new THREE.Mesh(bridgePostGeo, bridgePlankMat);
            p1.position.set(gx + 0.1, tile.elevation * ISO_3D_ELEV_UNIT + 0.24, gy + 0.1);
            const p2 = new THREE.Mesh(bridgePostGeo, bridgePlankMat);
            p2.position.set(gx + 0.9, tile.elevation * ISO_3D_ELEV_UNIT + 0.24, gy + 0.9);
            this.bridgeGroup.add(p1, p2);
          }
        }

        // Static / Animated World Props
        if (tile.prop) {
          const key = `${gx}_${gy}`;
          const rig = this.models.createProp(tile.prop, gx * 31 + gy * 17);
          rig.root.position.set(gx + 0.5, tile.elevation * ISO_3D_ELEV_UNIT, gy + 0.5);
          this.propGroup.add(rig.root);
          this.propRigs.set(key, rig);

          if (tile.prop === 'bindstone') {
            this.bindstoneLight.position.set(gx + 0.5, tile.elevation * ISO_3D_ELEV_UNIT + 1.5, gy + 0.5);
            this.bindstoneLight.visible = true;
          } else if (tile.prop === 'portal') {
            this.portalLight.position.set(gx + 0.5, tile.elevation * ISO_3D_ELEV_UNIT + 1.5, gy + 0.5);
            this.portalLight.visible = true;
          } else if (tile.prop === 'campfire' && !this.isSoftwareGl && this.campfireLights.length < 3) {
            const cl = new THREE.PointLight(0xf97316, 2.0, 6.8, 1.5);
            cl.position.set(gx + 0.5, tile.elevation * ISO_3D_ELEV_UNIT + 0.95, gy + 0.5);
            this.scene.add(cl);
            this.campfireLights.push(cl);
          }
        } else if (tile.terrain !== 'water' && tile.terrain !== 'bridge') {
          // Procedural stylized micro-environment scatter on open tiles (non-blocking visual polish)
          const tileElevY = (y00 + y10 + y11 + y01) * 0.25;
          const h1 = tileHash(gx, gy, 101);
          const h2 = tileHash(gx, gy, 202);
          const h3 = tileHash(gx, gy, 303);

          // Check water adjacency for shoreline reeds & river rocks
          let nearWater = false;
          let nearForest = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nb = tiles[gy + dy]?.[gx + dx];
              if (!nb) continue;
              if (nb.terrain === 'water') nearWater = true;
              if (nb.prop === 'tree_pine' || nb.prop === 'tree_oak') nearForest = true;
            }
          }

          if (nearWater && tile.terrain !== 'stone_road' && h1 < 0.72 * detailDensity) {
            const count = h2 > 0.5 ? 2 : 1;
            for (let k = 0; k < count; k++) {
              const ox = 0.18 + tileHash(gx, gy, 400 + k) * 0.64;
              const oz = 0.18 + tileHash(gx, gy, 420 + k) * 0.64;
              tmpPos.set(gx + ox, tileElevY + 0.14, gy + oz);
              tmpEuler.set((h2 - 0.5) * 0.2, h3 * Math.PI * 2 + k, (h1 - 0.5) * 0.2);
              tmpQuat.setFromEuler(tmpEuler);
              const s = 0.8 + tileHash(gx, gy, 440 + k) * 0.55;
              tmpScale.set(s, s * 1.15, s);
              tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
              reedMatrices.push({
                m: tmpMat4.clone(),
                c: new THREE.Color().setRGB(
                  0.3 + h2 * 0.08,
                  0.44 + h3 * 0.1,
                  0.18,
                  THREE.SRGBColorSpace
                ),
              });
            }
          }

          if ((tile.terrain === 'grass' || tile.terrain === 'forest_floor') && h1 < 0.58 * detailDensity) {
            const tuftCount = h2 > 0.55 ? 2 : 1;
            for (let k = 0; k < tuftCount; k++) {
              const ox = 0.14 + tileHash(gx, gy, 500 + k) * 0.72;
              const oz = 0.14 + tileHash(gx, gy, 520 + k) * 0.72;
              tmpPos.set(gx + ox, tileElevY + 0.05, gy + oz);
              tmpEuler.set(0, tileHash(gx, gy, 540 + k) * Math.PI * 2, 0);
              tmpQuat.setFromEuler(tmpEuler);
              const s = 0.7 + tileHash(gx, gy, 560 + k) * 0.65;
              tmpScale.set(s, s, s);
              tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
              const isForest = tile.terrain === 'forest_floor';
              grassMatrices.push({
                m: tmpMat4.clone(),
                c: new THREE.Color().setRGB(
                  isForest ? 0.19 + h3 * 0.07 : 0.25 + h3 * 0.1,
                  isForest ? 0.34 + h2 * 0.09 : 0.44 + h2 * 0.1,
                  0.15 + h1 * 0.05,
                  THREE.SRGBColorSpace
                ),
              });
            }
          }

          if (
            (tile.terrain === 'forest_floor' || nearForest) &&
            tile.terrain !== 'stone_road' &&
            h2 < 0.26 * detailDensity
          ) {
            const ox = 0.2 + h1 * 0.6;
            const oz = 0.2 + h3 * 0.6;
            tmpPos.set(gx + ox, tileElevY + 0.1, gy + oz);
            tmpEuler.set(0, h1 * Math.PI * 2, 0);
            tmpQuat.setFromEuler(tmpEuler);
            const s = 0.68 + h3 * 0.55;
            tmpScale.set(s * 1.15, s * 0.78, s);
            tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
            shrubMatrices.push({
              m: tmpMat4.clone(),
              c: new THREE.Color().setRGB(
                0.18 + h1 * 0.1,
                0.36 + h3 * 0.12,
                0.15 + h2 * 0.05,
                THREE.SRGBColorSpace
              ),
            });
          }

          if (
            (tile.terrain === 'orc_dirt' ||
              tile.terrain === 'ruin_floor' ||
              nearWater ||
              (tile.terrain === 'grass' && h3 < 0.12)) &&
            h3 < 0.34 * detailDensity
          ) {
            const ox = 0.16 + h2 * 0.68;
            const oz = 0.16 + h1 * 0.68;
            tmpPos.set(gx + ox, tileElevY + 0.035, gy + oz);
            tmpEuler.set(h1 * 1.5, h2 * Math.PI * 2, h3 * 1.5);
            tmpQuat.setFromEuler(tmpEuler);
            const s = 0.55 + h1 * 0.65;
            tmpScale.set(s * 1.25, s * 0.65, s);
            tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
            const tone = tile.terrain === 'orc_dirt' ? 0.34 : 0.48;
            pebbleMatrices.push({
              m: tmpMat4.clone(),
              c: new THREE.Color().setRGB(
                tone + h1 * 0.08,
                tone + h1 * 0.07,
                tone + h1 * 0.05,
                THREE.SRGBColorSpace
              ),
            });
          }

          if (tile.terrain === 'forest_floor' && h1 > 0.82 && h2 < 0.55 * detailDensity) {
            const ox = 0.25 + h3 * 0.5;
            const oz = 0.25 + h2 * 0.5;
            tmpPos.set(gx + ox, tileElevY + 0.03, gy + oz);
            tmpEuler.set(0.12, h1 * Math.PI * 2, Math.PI / 2 - 0.12);
            tmpQuat.setFromEuler(tmpEuler);
            const s = 0.75 + h3 * 0.55;
            tmpScale.set(s, s, s);
            tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
            rootMatrices.push({
              m: tmpMat4.clone(),
              c: new THREE.Color().setRGB(
                0.34 + h2 * 0.08,
                0.24 + h3 * 0.06,
                0.15,
                THREE.SRGBColorSpace
              ),
            });
          }
        }
      }
    }

    const terrainGeo = new THREE.BufferGeometry();
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    terrainGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.textures.terrainDetail,
      bumpMap: this.textures.terrainBump,
      bumpScale: 0.075,
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: 0.42,
    });
    this.terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    // Build high-performance InstancedMesh ground flora & micro-detail batches (5 draw calls total)
    this.addInstancedFlora(
      this.createGrassTuftGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, side: THREE.DoubleSide }),
      grassMatrices,
      false
    );
    this.addInstancedFlora(
      new THREE.DodecahedronGeometry(0.18, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
      shrubMatrices,
      true
    );
    this.addInstancedFlora(
      new THREE.DodecahedronGeometry(0.085, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.06 }),
      pebbleMatrices,
      false
    );
    this.addInstancedFlora(
      new THREE.ConeGeometry(0.055, 0.34, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }),
      reedMatrices,
      false
    );
    this.addInstancedFlora(
      new THREE.CylinderGeometry(0.028, 0.042, 0.42, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
      rootMatrices,
      false
    );

    // 2. Natural Outer Perimeter Mountain Ring (textured + vertex-colored valley-to-ridge gradient)
    const skirtGeo = new THREE.PlaneGeometry(MAP_SIZE + 60, MAP_SIZE + 60, 40, 40);
    skirtGeo.rotateX(-Math.PI / 2);
    const sp = skirtGeo.attributes.position as THREE.BufferAttribute;
    const skirtColors = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      const wx = sp.getX(i) + MAP_SIZE * 0.5;
      const wz = sp.getZ(i) + MAP_SIZE * 0.5;
      const dx = Math.max(0, -wx, wx - MAP_SIZE);
      const dz = Math.max(0, -wz, wz - MAP_SIZE);
      const outside = Math.hypot(dx, dz);
      const ridge =
        0.55 +
        0.3 * Math.sin(wx * 0.24 + wz * 0.11) +
        0.2 * Math.cos(wz * 0.29 - wx * 0.16);
      const y = outside < 0.5 ? -0.95 : -0.1 + Math.min(3.2, outside * 0.11) * ridge;
      sp.setY(i, y);

      const hNorm = Math.min(1, Math.max(0, (y + 0.2) / 2.8));
      // Forested dark valley near map edge transitioning to slate mountain rock (linear RGB)
      skirtColors[i * 3] = 0.045 + hNorm * 0.085;
      skirtColors[i * 3 + 1] = 0.085 + hNorm * 0.06;
      skirtColors[i * 3 + 2] = 0.055 + hNorm * 0.095;
    }
    skirtGeo.setAttribute('color', new THREE.BufferAttribute(skirtColors, 3));
    skirtGeo.computeVertexNormals();
    const skirtMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.textures.terrainDetail,
      bumpMap: this.textures.terrainBump,
      bumpScale: 0.08,
      roughness: 0.94,
      metalness: 0.03,
      envMapIntensity: 0.4,
    });
    this.skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    this.skirtMesh.position.set(MAP_SIZE * 0.5, 0, MAP_SIZE * 0.5);
    this.skirtMesh.receiveShadow = true;
    this.scene.add(this.skirtMesh);

    // 3. Animated Translucent River Water Plane
    const waterGeo = new THREE.PlaneGeometry(MAP_SIZE + 4, MAP_SIZE + 4);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x206887,
      emissive: 0x0a293a,
      emissiveIntensity: 0.28,
      bumpMap: this.textures.waterBump,
      bumpScale: 0.065,
      roughness: 0.14,
      metalness: 0.28,
      transparent: true,
      opacity: 0.82,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.set(MAP_SIZE * 0.5, 0.03, MAP_SIZE * 0.5);
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);

    // 4. Smooth Fog of War Overlay Plane (строго отделён от декоративного атмосферного тумана: fog: false)
    const fogGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
    fogGeo.rotateX(-Math.PI / 2);
    const fogMat = new THREE.MeshBasicMaterial({
      map: this.fogDataTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.fogOverlayMesh = new THREE.Mesh(fogGeo, fogMat);
    this.fogOverlayMesh.position.set(MAP_SIZE * 0.5, 3.6, MAP_SIZE * 0.5);
    this.fogOverlayMesh.renderOrder = 25;
    this.scene.add(this.fogOverlayMesh);
  }

  private createGrassTuftGeometry(): THREE.BufferGeometry {
    // Three crossed angled blades in a single compact BufferGeometry
    const positions = new Float32Array([
      -0.08, 0, 0, 0.08, 0, 0, 0, 0.19, 0.03,
      -0.05, 0, -0.07, 0.05, 0, 0.07, -0.03, 0.17, 0.01,
      -0.06, 0, 0.06, 0.06, 0, -0.06, 0.03, 0.16, -0.02,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  private addInstancedFlora(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    items: Array<{ m: THREE.Matrix4; c: THREE.Color }>,
    castShadow: boolean
  ): void {
    if (items.length === 0) {
      geo.dispose();
      mat.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.castShadow = castShadow && !this.isSoftwareGl && !this.isMobileProfile;
    mesh.receiveShadow = true;
    for (let i = 0; i < items.length; i++) {
      mesh.setMatrixAt(i, items[i].m);
      mesh.setColorAt(i, items[i].c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.floraGroup.add(mesh);
  }

  private disposeFloraGroup(): void {
    for (const child of this.floraGroup.children) {
      const im = child as THREE.InstancedMesh;
      im.geometry?.dispose();
      if (Array.isArray(im.material)) {
        for (const m of im.material) m.dispose();
      } else {
        im.material?.dispose();
      }
    }
    this.floraGroup.clear();
  }

  private updateFogOverlay(tiles: Tile[][]): void {
    this.fogFrameCounter += 1;
    if (this.fogFrameCounter % 2 !== 1 && this.fogFrameCounter > 3) return;
    const buf = this.fogBuffer;
    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        // PlaneGeometry rotated -PI/2 maps UV.y=0 to +Z (gy = MAP_SIZE-1), so flip Y row
        const row = MAP_SIZE - 1 - gy;
        const idx = (row * MAP_SIZE + gx) * 4;
        const fog = tiles[gy][gx].fog;
        buf[idx] = 10;
        buf[idx + 1] = 14;
        buf[idx + 2] = 24;
        // Мягкое затемнение разведанных зон (92) сохраняет читаемость зданий и рельефа
        buf[idx + 3] = fog === 0 ? 232 : fog === 1 ? 92 : 0;
      }
    }
    this.fogDataTex.needsUpdate = true;
  }

  private getTileElevationAt(tiles: Tile[][], x: number, y: number): number {
    const gx = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(x)));
    const gy = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(y)));
    return (tiles[gy]?.[gx]?.elevation ?? 1) * ISO_3D_ELEV_UNIT;
  }

  private syncProps(tiles: Tile[][], time: number): void {
    for (const [key, rig] of this.propRigs.entries()) {
      const [gxStr, gyStr] = key.split('_');
      const gx = Number(gxStr);
      const gy = Number(gyStr);
      const tile = tiles[gy]?.[gx];
      if (!tile || !tile.prop) {
        this.propGroup.remove(rig.root);
        this.propRigs.delete(key);
        continue;
      }
      rig.root.visible = tile.fog >= 1;
      if (!rig.root.visible) continue;

      if (rig.swayPivot) {
        rig.swayPivot.rotation.z = Math.sin(time * 1.35 + rig.phase) * 0.032;
        rig.swayPivot.rotation.x = Math.cos(time * 1.05 + rig.phase) * 0.02;
      }
      if (rig.crystalMesh) {
        rig.crystalMesh.position.y = 1.15 + Math.sin(time * 2.1) * 0.14;
        rig.crystalMesh.rotation.y = time * 0.8;
      }
      if (rig.orbitPivot) {
        rig.orbitPivot.rotation.y = -time * 1.15;
        rig.orbitPivot.position.y = 1.05 + Math.cos(time * 1.8) * 0.08;
      }
      if (rig.runeRingMesh) {
        rig.runeRingMesh.rotation.y = -time * 0.55;
      }
      if (rig.vortexMesh) {
        rig.vortexMesh.rotation.z = time * 1.4;
      }
      if (rig.flameOuter && rig.flameInner) {
        const flick = 0.88 + Math.sin(time * 14 + rig.phase) * 0.16;
        rig.flameOuter.scale.set(1, flick, 1);
        rig.flameInner.scale.set(1, 0.85 + Math.cos(time * 19 + rig.phase) * 0.2, 1);
      }
      if (rig.lidPivot && rig.kind === 'chest') {
        rig.lidPivot.rotation.x = tile.chestLooted ? -1.15 : 0;
      }
    }
  }

  private syncBuildings(state: RenderState): void {
    const aliveIds = new Set<string>();
    for (const b of state.buildings) {
      aliveIds.add(b.id);
      let rig = this.buildingRigs.get(b.id);
      if (!rig) {
        rig = this.models.createBuilding(b.type, b.faction, b.size);
        this.buildingGroup.add(rig.root);
        this.buildingRigs.set(b.id, rig);
      }

      const cx = b.gx + b.size * 0.5;
      const cy = b.gy + b.size * 0.5;
      const t = state.tiles[Math.floor(cy)]?.[Math.floor(cx)];
      const visible = b.faction === 'human' || (t ? t.fog >= 1 : false);
      rig.root.visible = visible;
      if (!visible) continue;

      const elevY = (t?.elevation ?? 1) * ISO_3D_ELEV_UNIT;
      rig.root.position.set(cx, elevY, cy);
      rig.selectionRing.visible = state.selectedBuildingId === b.id;

      if (!b.constructed) {
        rig.scaffoldGroup.visible = true;
        const p = Math.max(0.18, b.buildProgress);
        rig.structureGroup.scale.set(1, p, 1);
      } else {
        rig.scaffoldGroup.visible = false;
        rig.structureGroup.scale.set(1, 1, 1);
      }

      if (rig.bannerMesh) {
        rig.bannerMesh.rotation.y = Math.sin(state.time * 3.4 + b.gx) * 0.25;
      }
      if (rig.beaconMesh) {
        rig.beaconMesh.rotation.y = state.time * 1.8;
      }

      const flash = b.hitFlashTimer > 0 ? 0.55 : 0;
      for (const m of rig.hitMeshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && mat.emissive) {
          mat.emissive.setRGB(flash, flash * 0.35, flash * 0.2);
        }
      }
    }

    for (const [id, rig] of this.buildingRigs.entries()) {
      if (!aliveIds.has(id)) {
        this.buildingGroup.remove(rig.root);
        this.buildingRigs.delete(id);
      }
    }
  }

  private syncUnits(state: RenderState): void {
    const aliveIds = new Set<string>();
    for (const u of state.units) {
      if (u.deadTimer && u.deadTimer > 0) continue;
      aliveIds.add(u.id);
      let rig = this.unitRigs.get(u.id);
      if (!rig) {
        rig = this.models.createUnit(u.type, u.faction);
        this.unitGroup.add(rig.root);
        this.unitRigs.set(u.id, rig);
      }

      const tile = state.tiles[Math.floor(u.y)]?.[Math.floor(u.x)];
      const visible = u.faction === 'human' || (tile ? tile.fog >= 2 : false);
      rig.root.visible = visible;
      if (!visible) continue;

      const elevY = this.getTileElevationAt(state.tiles, u.x, u.y);
      rig.root.position.set(u.x, elevY, u.y);
      rig.selectionRing.visible = state.selectedUnitIds.has(u.id);

      // Facing yaw based on movement vector or legacy facing sign
      const speedSq = u.vx * u.vx + u.vy * u.vy;
      if (speedSq > 0.04) {
        const desiredYaw = Math.atan2(u.vx, u.vy);
        rig.facingPivot.rotation.y = desiredYaw;
      } else {
        rig.facingPivot.rotation.y = u.facing >= 0 ? Math.PI * 0.25 : -Math.PI * 0.75;
      }

      // Articulated walk / attack / spellcast / dormant animations
      if (u.dormant) {
        rig.bodyGroup.position.y = -0.14;
        rig.bodyGroup.rotation.x = 0.35;
        rig.leftLeg.rotation.x = 0;
        rig.rightLeg.rotation.x = 0;
        rig.leftArm.rotation.x = 0.2;
        rig.rightArm.rotation.x = 0.2;
        if (rig.auraRing) {
          (rig.auraRing.material as THREE.MeshBasicMaterial).opacity = 0.16;
        }
      } else {
        const isMoving = speedSq > 0.04;
        const walkPhase = u.animTime * 11;
        const stride = isMoving ? Math.sin(walkPhase) * 0.58 : 0;
        rig.bodyGroup.position.y = isMoving
          ? Math.abs(Math.sin(walkPhase)) * 0.06
          : Math.sin(u.animTime * 2.5) * 0.015;
        rig.bodyGroup.rotation.x = isMoving ? 0.08 : 0;
        rig.leftLeg.rotation.x = stride;
        rig.rightLeg.rotation.x = -stride;

        if (u.castAnimTimer && u.castAnimTimer > 0) {
          const castLift = -1.65 - Math.sin(state.time * 18) * 0.15;
          rig.leftArm.rotation.x = castLift;
          rig.rightArm.rotation.x = castLift;
        } else if (u.attackAnimTimer > 0) {
          const swing = Math.sin((u.attackAnimTimer / 0.25) * Math.PI);
          rig.rightArm.rotation.x = -1.45 * swing;
          rig.leftArm.rotation.x = -0.35 * swing;
        } else {
          rig.leftArm.rotation.x = -stride * 0.7;
          rig.rightArm.rotation.x = stride * 0.7;
        }

        if (rig.cloakMesh) {
          rig.cloakMesh.rotation.x = 0.18 + (isMoving ? 0.28 : 0.06) + Math.sin(u.animTime * 5) * 0.07;
        }
        if (rig.auraRing) {
          rig.auraRing.rotation.z = state.time * 0.9;
          (rig.auraRing.material as THREE.MeshBasicMaterial).opacity =
            u.type === 'skeleton_minion' ? 0.55 : 0.75;
        }
      }

      if (rig.carryCrate) {
        if (u.carryingKind && (u.carryingAmount ?? 0) > 0) {
          rig.carryCrate.visible = true;
          const cMat = rig.carryCrate.material as THREE.MeshStandardMaterial;
          cMat.color.setHex(
            u.carryingKind === 'gold'
              ? 0xfacc15
              : u.carryingKind === 'wood'
              ? 0x92400e
              : 0xcbd5e1
          );
        } else {
          rig.carryCrate.visible = false;
        }
      }

      const flash = u.hitFlashTimer > 0 ? 0.7 : 0;
      for (const m of rig.hitMaterials) {
        if (flash > 0) {
          m.emissive.setRGB(flash, flash * 0.28, flash * 0.2);
          m.emissiveIntensity = 1.0;
        } else if (u.type !== 'skeleton_minion' && u.type !== 'hero') {
          m.emissive.setRGB(0, 0, 0);
        }
      }
    }

    for (const [id, rig] of this.unitRigs.entries()) {
      if (!aliveIds.has(id)) {
        this.unitGroup.remove(rig.root);
        this.unitRigs.delete(id);
      }
    }
  }

  private syncProjectiles(projectiles: Projectile[], tiles: Tile[][]): void {
    const aliveIds = new Set<string>();
    let activeFireball: Projectile | null = null;

    for (const p of projectiles) {
      aliveIds.add(p.id);
      let obj = this.projectileMeshes.get(p.id);
      if (!obj) {
        if (p.kind === 'fireball' || p.kind === 'necrotic_orb') {
          const grp = new THREE.Group();
          const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 10, 10),
            new THREE.MeshBasicMaterial({
              color: p.kind === 'fireball' ? 0xfef08a : 0x7dd3fc,
            })
          );
          const halo = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 10, 10),
            new THREE.MeshBasicMaterial({
              color: p.kind === 'fireball' ? 0xf97316 : 0x6366f1,
              transparent: true,
              opacity: 0.5,
            })
          );
          grp.add(core, halo);
          obj = grp;
        } else {
          const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.55, 5),
            new THREE.MeshBasicMaterial({
              color: p.kind === 'bolt' ? 0xfacc15 : p.faction === 'orc' ? 0xef4444 : 0xe2e8f0,
            })
          );
          shaft.rotation.x = Math.PI / 2;
          obj = shaft;
        }
        this.projectileGroup.add(obj);
        this.projectileMeshes.set(p.id, obj);
      }

      const elevY = this.getTileElevationAt(tiles, p.x, p.y);
      const heightY = elevY + (p.z / 10) * ISO_3D_ELEV_UNIT;
      obj.position.set(p.x, heightY, p.y);
      obj.rotation.y = Math.atan2(p.targetX - p.startX, p.targetY - p.startY);

      if (p.kind === 'fireball') activeFireball = p;
    }

    if (activeFireball) {
      const elevY = this.getTileElevationAt(tiles, activeFireball.x, activeFireball.y);
      this.spellLight.position.set(
        activeFireball.x,
        elevY + (activeFireball.z / 10) * ISO_3D_ELEV_UNIT + 0.5,
        activeFireball.y
      );
      this.spellLight.color.setHex(0xf97316);
      this.spellLight.intensity = 3.2;
      this.spellLight.visible = true;
    } else {
      this.spellLight.visible = false;
    }

    for (const [id, obj] of this.projectileMeshes.entries()) {
      if (!aliveIds.has(id)) {
        this.projectileGroup.remove(obj);
        this.projectileMeshes.delete(id);
      }
    }
  }

  private syncParticles(particles: Particle[], tiles: Tile[][]): void {
    let ringIdx = 0;
    let pillarIdx = 0;
    let sparkIdx = 0;

    for (const pt of particles) {
      const alpha = Math.max(0, Math.min(1, pt.life / Math.max(0.001, pt.maxLife)));
      const elevY = this.getTileElevationAt(tiles, pt.x, pt.y);
      const py = elevY + (pt.z / 10) * ISO_3D_ELEV_UNIT;

      if (pt.kind === 'ring' && ringIdx < this.ringPool.length) {
        const item = this.ringPool[ringIdx++];
        const expand = 0.6 + (1 - alpha) * (pt.size * 0.14);
        item.mesh.position.set(pt.x, elevY + 0.08, pt.y);
        item.mesh.scale.set(expand, 1, expand);
        this._tmpColor.set(pt.color);
        item.mat.color.copy(this._tmpColor);
        item.mat.opacity = alpha * 0.85;
        item.mesh.visible = true;
      } else if (pt.kind === 'rune_pillar' && pillarIdx < this.pillarPool.length) {
        const item = this.pillarPool[pillarIdx++];
        const s = 0.75 + (1 - alpha) * 0.9;
        item.mesh.position.set(pt.x, elevY + 1.5, pt.y);
        item.mesh.scale.set(s, 0.7 + (1 - alpha) * 0.7, s);
        this._tmpColor.set(pt.color);
        item.mat.color.copy(this._tmpColor);
        item.mat.opacity = alpha * 0.62;
        item.mesh.visible = true;
      } else if (sparkIdx < this.sparkPool.length) {
        const item = this.sparkPool[sparkIdx++];
        const s = Math.max(0.4, pt.size * 0.45) * (0.45 + alpha * 0.65);
        item.mesh.position.set(pt.x, py + 0.2, pt.y);
        item.mesh.scale.setScalar(s);
        this._tmpColor.set(pt.color);
        item.mat.color.copy(this._tmpColor);
        item.mat.opacity = alpha * 0.9;
        item.mesh.visible = true;
      }
    }

    for (let i = ringIdx; i < this.ringPool.length; i++) this.ringPool[i].mesh.visible = false;
    for (let i = pillarIdx; i < this.pillarPool.length; i++) this.pillarPool[i].mesh.visible = false;
    for (let i = sparkIdx; i < this.sparkPool.length; i++) this.sparkPool[i].mesh.visible = false;
  }

  public render(state: RenderState, viewportW: number, viewportH: number): void {
    if (this.disposed || viewportW <= 0 || viewportH <= 0) return;

    if (viewportW !== this.lastViewportW || viewportH !== this.lastViewportH) {
      this.lastViewportW = viewportW;
      this.lastViewportH = viewportH;
      this.renderer.setSize(viewportW, viewportH, false);
    }

    // Build / rebuild static terrain if map dimensions or world identity changed
    const firstTile = state.tiles[0]?.[0];
    const worldKey = `${state.tiles.length}_${firstTile?.terrain ?? 'none'}_${state.buildings[0]?.id ?? '0'}`;
    if (worldKey !== this.builtWorldKey && state.tiles.length === MAP_SIZE) {
      this.builtWorldKey = worldKey;
      this.buildWorldStaticGeometry(state.tiles);
    }

    // Exact 1:1 OrthographicCamera alignment with src/game/iso.ts
    const cam = state.camera;
    const shakeX = cam.shake > 0.1 ? (Math.random() - 0.5) * cam.shake * 0.8 : 0;
    const shakeY = cam.shake > 0.1 ? (Math.random() - 0.5) * cam.shake * 0.8 : 0;
    const { gx: tx, gy: tz } = worldToGrid(cam.x + shakeX, cam.y + shakeY, 1);
    const targetY = 1 * ISO_3D_ELEV_UNIT;

    const halfW = (viewportW * 0.5) / (cam.zoom * ISO_3D_SCALE);
    const halfH = (viewportH * 0.5) / (cam.zoom * ISO_3D_SCALE);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.position.set(
      tx + CAM_DIST * CAM_DIR_XZ,
      targetY + CAM_DIST * CAM_DIR_Y,
      tz + CAM_DIST * CAM_DIR_XZ
    );
    this.camera.lookAt(tx, targetY, tz);
    this.camera.updateProjectionMatrix();

    // Track sun shadow frustum smoothly around camera focus
    this.sunTarget.position.set(tx, targetY, tz);
    this.sunLight.position.set(tx + 22, targetY + 34, tz + 14);

    // Animate water ripples, practical lights, and atmospheric motes
    this.textures.waterBump.offset.x = state.time * 0.032;
    this.textures.waterBump.offset.y = state.time * 0.021;
    if (this.bindstoneLight.visible) {
      this.bindstoneLight.intensity = 2.2 + Math.sin(state.time * 3.1) * 0.45;
    }
    if (this.portalLight.visible) {
      this.portalLight.intensity = 2.6 + Math.cos(state.time * 2.6) * 0.5;
    }
    for (let i = 0; i < this.campfireLights.length; i++) {
      this.campfireLights[i].intensity = 1.6 + Math.sin(state.time * 13 + i * 2.1) * 0.35;
    }
    if (this.ambientMotes) {
      this.ambientMotes.position.y = Math.sin(state.time * 0.7) * 0.25;
      this.ambientMotes.position.x = Math.cos(state.time * 0.35) * 0.4;
    }

    this.updateFogOverlay(state.tiles);
    this.syncProps(state.tiles, state.time);
    this.syncBuildings(state);
    this.syncUnits(state);
    this.syncProjectiles(state.projectiles, state.tiles);
    this.syncParticles(state.particles, state.tiles);

    this.renderer.render(this.scene, this.camera);
  }

  public getDiagnosticInfo(): {
    webglState: 'OK (WebGL2)' | 'OK (WebGL1)' | 'CONTEXT LOST';
    gpuRenderer: string;
    isSoftwareGl: boolean;
    effectiveDpr: number;
    drawCalls: number;
    triangles: number;
    sceneMeshes3D: number;
  } {
    const gl = this.renderer.getContext();
    const isLost = this.disposed || gl.isContextLost();
    const isWebGL2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuRenderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';

    return {
      webglState: isLost ? 'CONTEXT LOST' : isWebGL2 ? 'OK (WebGL2)' : 'OK (WebGL1)',
      gpuRenderer,
      isSoftwareGl: this.isSoftwareGl,
      effectiveDpr: this.renderer.getPixelRatio(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      sceneMeshes3D:
        this.propRigs.size +
        this.buildingRigs.size +
        this.unitRigs.size +
        this.projectileMeshes.size,
    };
  }

  /**
   * На программном WebGL (SwiftShader/llvmpipe) ждём завершения GPU-кадра через fence/readPixels,
   * чтобы не перегружать очередь кадров и не блокировать UI-ввод.
   */
  public afterDrawSync(): void {
    if (!this.isSoftwareGl || this.disposed) return;
    const gl = this.renderer.getContext();
    gl.flush();
  }

  public dispose(): void {
    this.disposed = true;
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLostHandler);
    this.disposeFloraGroup();
    this.terrainMesh?.geometry.dispose();
    (this.terrainMesh?.material as THREE.Material | undefined)?.dispose();
    this.skirtMesh?.geometry.dispose();
    (this.skirtMesh?.material as THREE.Material | undefined)?.dispose();
    this.waterMesh?.geometry.dispose();
    (this.waterMesh?.material as THREE.Material | undefined)?.dispose();
    this.fogOverlayMesh?.geometry.dispose();
    (this.fogOverlayMesh?.material as THREE.Material | undefined)?.dispose();
    this.ambientMotes?.geometry.dispose();
    (this.ambientMotes?.material as THREE.Material | undefined)?.dispose();
    this.fogDataTex.dispose();
    this.envRT.dispose();
    this.models.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    this.mountEl.innerHTML = '';
  }
}
