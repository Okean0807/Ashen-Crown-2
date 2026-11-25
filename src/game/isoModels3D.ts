/**
 * ASHEN CROWN — Процедурная библиотека 3D-моделей стиля Stylized 3D Dark Fantasy.
 * Все здания, объекты мира и юниты собираются из многосоставных PBR-элементов с опорой на y = 0,
 * выразительными силуэтами для мобильных экранов и чётким контрастом союзников и врагов.
 */

import * as THREE from 'three';
import type { BuildingType, Faction, PropKind, UnitType } from './types';
import type { WorldTextureSet } from './isoTextures3D';

export interface PropRig3D {
  root: THREE.Group;
  kind: PropKind;
  swayPivot?: THREE.Object3D;
  crystalMesh?: THREE.Object3D;
  orbitPivot?: THREE.Object3D;
  runeRingMesh?: THREE.Object3D;
  flameOuter?: THREE.Object3D;
  flameInner?: THREE.Object3D;
  lidPivot?: THREE.Object3D;
  vortexMesh?: THREE.Object3D;
  phase: number;
}

export interface BuildingRig3D {
  root: THREE.Group;
  structureGroup: THREE.Group;
  scaffoldGroup: THREE.Group;
  bannerMesh?: THREE.Object3D;
  beaconMesh?: THREE.Object3D;
  selectionRing: THREE.Mesh;
  hitMeshes: THREE.Mesh[];
}

export interface UnitRig3D {
  root: THREE.Group;
  facingPivot: THREE.Group;
  bodyGroup: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  cloakMesh?: THREE.Object3D;
  selectionRing: THREE.Mesh;
  auraRing?: THREE.Mesh;
  carryCrate?: THREE.Mesh;
  hitMaterials: THREE.MeshStandardMaterial[];
}

export class ModelLibrary3D {
  public readonly textures: WorldTextureSet;
  private mats: Map<string, THREE.Material> = new Map();
  private geos: Map<string, THREE.BufferGeometry> = new Map();

  constructor(textures: WorldTextureSet) {
    this.textures = textures;
  }

  private mat(key: string, factory: () => THREE.Material): THREE.Material {
    let m = this.mats.get(key);
    if (!m) {
      m = factory();
      this.mats.set(key, m);
    }
    return m;
  }

  private geo(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) {
      g = factory();
      this.geos.set(key, g);
    }
    return g;
  }

  private shadow(mesh: THREE.Mesh, cast = true, receive = true): THREE.Mesh {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  private makeContactShadow(radius: number, opacity = 0.78): THREE.Mesh {
    const m = new THREE.Mesh(
      this.geo('plane_1x1', () => {
        const g = new THREE.PlaneGeometry(1, 1);
        g.rotateX(-Math.PI / 2);
        return g;
      }),
      this.mat(`contact_shadow_${Math.round(opacity * 100)}`, () =>
        new THREE.MeshBasicMaterial({
          map: this.textures.contactShadow,
          transparent: true,
          depthWrite: false,
          opacity,
        })
      )
    );
    m.scale.set(radius * 2, 1, radius * 2);
    m.position.y = 0.016;
    m.renderOrder = 1;
    return m;
  }

  public createProp(kind: PropKind, variantSeed: number): PropRig3D {
    const root = new THREE.Group();
    const phase = (variantSeed % 97) * 0.13;
    const rig: PropRig3D = { root, kind, phase };

    const barkMat = this.mat('bark_tex', () =>
      new THREE.MeshStandardMaterial({
        color: 0x5c402c,
        map: this.textures.bark,
        bumpMap: this.textures.timberBump,
        bumpScale: 0.04,
        roughness: 0.92,
        metalness: 0.02,
      })
    );
    const pineMatA = this.mat('pine_dark', () =>
      new THREE.MeshStandardMaterial({ color: 0x1f4931, roughness: 0.85, metalness: 0.02 })
    );
    const pineMatB = this.mat('pine_mid', () =>
      new THREE.MeshStandardMaterial({ color: 0x2b5d3b, roughness: 0.82, metalness: 0.02 })
    );
    const pineMatC = this.mat('pine_tip', () =>
      new THREE.MeshStandardMaterial({ color: 0x366d42, roughness: 0.8, metalness: 0.02 })
    );
    const oakMatA = this.mat('oak_deep', () =>
      new THREE.MeshStandardMaterial({ color: 0x345e29, roughness: 0.84, metalness: 0.02 })
    );
    const oakMatB = this.mat('oak_warm', () =>
      new THREE.MeshStandardMaterial({ color: 0x4b7430, roughness: 0.8, metalness: 0.02 })
    );
    const oakMatAutumn = this.mat('oak_amber', () =>
      new THREE.MeshStandardMaterial({ color: 0x6f682b, roughness: 0.82, metalness: 0.02 })
    );
    const rockMat = this.mat('rock_granite', () =>
      new THREE.MeshStandardMaterial({
        color: 0x7c828b,
        map: this.textures.masonry,
        bumpMap: this.textures.masonryBump,
        bumpScale: 0.045,
        roughness: 0.86,
        metalness: 0.06,
      })
    );
    const ruinStoneMat = this.mat('ruin_stone', () =>
      new THREE.MeshStandardMaterial({
        color: 0xa19b8c,
        map: this.textures.masonry,
        bumpMap: this.textures.masonryBump,
        bumpScale: 0.055,
        roughness: 0.82,
        metalness: 0.05,
      })
    );
    const mossMat = this.mat('moss_cap', () =>
      new THREE.MeshStandardMaterial({ color: 0x466835, roughness: 0.9, metalness: 0.0 })
    );
    const ironMat = this.mat('dark_iron', () =>
      new THREE.MeshStandardMaterial({ color: 0x292d36, roughness: 0.42, metalness: 0.82 })
    );

    if (kind === 'tree_pine') {
      const scale = 0.88 + (variantSeed % 7) * 0.055;
      root.add(this.makeContactShadow(0.62 * scale, 0.82));

      // Root flare gripping terrain
      const rootGeo = this.geo('tree_root', () => new THREE.CylinderGeometry(0.03, 0.075, 0.34, 5));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + phase;
        const rt = this.shadow(new THREE.Mesh(rootGeo, barkMat), false, true);
        rt.position.set(Math.cos(a) * 0.12 * scale, 0.08 * scale, Math.sin(a) * 0.12 * scale);
        rt.rotation.z = -Math.cos(a) * 0.85;
        rt.rotation.x = Math.sin(a) * 0.85;
        root.add(rt);
      }

      const sway = new THREE.Group();
      const trunk = this.shadow(
        new THREE.Mesh(
          this.geo('pine_trunk', () => new THREE.CylinderGeometry(0.055, 0.13, 0.8, 7)),
          barkMat
        )
      );
      trunk.position.y = 0.4;
      sway.add(trunk);

      const tiers: Array<[number, number, number, number, THREE.Material]> = [
        [0.54, 0.68, 0.66, 0.0, pineMatA],
        [0.44, 0.62, 1.0, 0.45, pineMatB],
        [0.33, 0.56, 1.32, 0.95, pineMatA],
        [0.21, 0.48, 1.62, 1.4, pineMatC],
      ];
      for (let idx = 0; idx < tiers.length; idx++) {
        const [r, h, y, ry, m] = tiers[idx];
        const cone = this.shadow(
          new THREE.Mesh(this.geo(`pine_t${idx}`, () => new THREE.ConeGeometry(r, h, 8)), m)
        );
        cone.position.y = y;
        cone.rotation.y = ry + phase;
        sway.add(cone);
      }

      sway.scale.setScalar(scale);
      root.add(sway);
      rig.swayPivot = sway;
    } else if (kind === 'tree_oak') {
      const scale = 0.9 + (variantSeed % 5) * 0.055;
      const isWarmVariant = variantSeed % 5 === 0;
      const leafPrimary = isWarmVariant ? oakMatAutumn : oakMatA;
      const leafHighlight = isWarmVariant ? oakMatB : oakMatB;
      root.add(this.makeContactShadow(0.72 * scale, 0.82));

      // Flared gnarly roots
      const rootGeo = this.geo('tree_root', () => new THREE.CylinderGeometry(0.03, 0.075, 0.34, 5));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + phase * 0.7;
        const rt = this.shadow(new THREE.Mesh(rootGeo, barkMat), false, true);
        rt.position.set(Math.cos(a) * 0.16 * scale, 0.09 * scale, Math.sin(a) * 0.16 * scale);
        rt.rotation.z = -Math.cos(a) * 0.95;
        rt.rotation.x = Math.sin(a) * 0.95;
        root.add(rt);
      }

      const sway = new THREE.Group();
      const trunk = this.shadow(
        new THREE.Mesh(
          this.geo('oak_trunk', () => new THREE.CylinderGeometry(0.09, 0.18, 0.78, 7)),
          barkMat
        )
      );
      trunk.position.y = 0.39;
      sway.add(trunk);

      // Sturdy bifurcating branches visible beneath canopy
      const branchGeo = this.geo('oak_branch', () => new THREE.CylinderGeometry(0.035, 0.06, 0.42, 5));
      const br1 = this.shadow(new THREE.Mesh(branchGeo, barkMat));
      br1.position.set(0.14, 0.74, 0.05);
      br1.rotation.z = -0.58;
      const br2 = this.shadow(new THREE.Mesh(branchGeo, barkMat));
      br2.position.set(-0.14, 0.7, -0.06);
      br2.rotation.z = 0.62;
      sway.add(br1, br2);

      // Multi-cluster stylized dark-fantasy crown
      const puffs: Array<[number, number, number, number, number, number, THREE.Material]> = [
        [0, 1.05, 0, 0.44, 0.82, 1.05, leafPrimary],
        [0.26, 1.15, -0.1, 0.32, 0.88, 0.96, leafHighlight],
        [-0.25, 0.96, 0.16, 0.33, 0.85, 0.95, leafPrimary],
        [0.08, 1.28, 0.14, 0.28, 0.85, 0.9, leafHighlight],
        [-0.14, 1.18, -0.22, 0.27, 0.82, 0.9, leafPrimary],
      ];
      for (const [px, py, pz, r, sy, sx, mat] of puffs) {
        const puff = this.shadow(
          new THREE.Mesh(this.geo(`oak_p_${Math.round(r * 100)}`, () => new THREE.DodecahedronGeometry(r, 1)), mat)
        );
        puff.position.set(px, py, pz);
        puff.scale.set(sx, sy, sx);
        sway.add(puff);
      }

      sway.scale.setScalar(scale);
      sway.rotation.y = phase * 3.1;
      root.add(sway);
      rig.swayPivot = sway;
    } else if (kind === 'rock') {
      root.add(this.makeContactShadow(0.56, 0.78));
      const b1 = this.shadow(
        new THREE.Mesh(this.geo('rock_main', () => new THREE.DodecahedronGeometry(0.36, 0)), rockMat)
      );
      b1.position.set(-0.04, 0.22, 0);
      b1.scale.set(1.25, 0.78, 1.0);
      b1.rotation.set(0.2, phase, 0.15);
      root.add(b1);

      const b2 = this.shadow(
        new THREE.Mesh(this.geo('rock_sub', () => new THREE.DodecahedronGeometry(0.22, 0)), rockMat)
      );
      b2.position.set(0.26, 0.13, 0.16);
      b2.scale.set(1.1, 0.75, 0.95);
      b2.rotation.set(0.5, phase * 2, 0);
      root.add(b2);

      const moss = this.shadow(
        new THREE.Mesh(this.geo('rock_moss', () => new THREE.DodecahedronGeometry(0.18, 0)), mossMat),
        false,
        true
      );
      moss.position.set(-0.08, 0.39, -0.04);
      moss.scale.set(1.2, 0.35, 1.0);
      root.add(moss);
    } else if (kind === 'gold_vein') {
      root.add(this.makeContactShadow(0.64, 0.85));
      const basaltMat = this.mat('basalt_ore', () =>
        new THREE.MeshStandardMaterial({
          color: 0x3b4048,
          map: this.textures.masonry,
          bumpMap: this.textures.masonryBump,
          bumpScale: 0.05,
          roughness: 0.84,
          metalness: 0.18,
        })
      );
      const goldMat = this.mat('gold_ore', () =>
        new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0x92400e,
          emissiveIntensity: 0.42,
          roughness: 0.2,
          metalness: 0.92,
        })
      );
      const base1 = this.shadow(
        new THREE.Mesh(this.geo('rock_main', () => new THREE.DodecahedronGeometry(0.36, 0)), basaltMat)
      );
      base1.position.set(-0.04, 0.22, 0);
      base1.scale.set(1.32, 0.78, 1.14);
      const base2 = this.shadow(
        new THREE.Mesh(this.geo('rock_sub', () => new THREE.DodecahedronGeometry(0.22, 0)), basaltMat)
      );
      base2.position.set(0.26, 0.14, 0.2);
      base2.scale.set(1.1, 0.7, 1.0);
      root.add(base1, base2);

      const shardGeo = this.geo('gold_shard', () => new THREE.OctahedronGeometry(0.14, 0));
      const coords = [
        [-0.16, 0.36, 0.1, 0.32, 0.24, 1.6],
        [0.16, 0.42, -0.08, -0.25, -0.32, 1.85],
        [0.02, 0.5, 0.04, 0.1, -0.1, 2.0],
        [0.24, 0.26, 0.18, 0.4, 0.5, 1.3],
        [-0.24, 0.2, -0.16, -0.3, 0.4, 1.2],
      ];
      for (const [x, y, z, rx, rz, sy] of coords) {
        const s = this.shadow(new THREE.Mesh(shardGeo, goldMat));
        s.position.set(x, y, z);
        s.scale.set(0.82, sy, 0.82);
        s.rotation.set(rx, phase, rz);
        root.add(s);
      }
    } else if (kind === 'stone_quarry') {
      root.add(this.makeContactShadow(0.68, 0.82));
      const slabGeo = this.geo('quarry_slab', () => new THREE.BoxGeometry(0.48, 0.26, 0.38));
      const s1 = this.shadow(new THREE.Mesh(slabGeo, ruinStoneMat));
      s1.position.set(-0.12, 0.13, 0.08);
      const s2 = this.shadow(new THREE.Mesh(slabGeo, rockMat));
      s2.position.set(0.2, 0.13, -0.1);
      s2.rotation.y = 0.42;
      const s3 = this.shadow(new THREE.Mesh(slabGeo, ruinStoneMat));
      s3.position.set(0.02, 0.37, 0.0);
      s3.scale.set(0.76, 0.88, 0.8);
      s3.rotation.y = -0.24;
      // Timber quarry hoist A-frame
      const hoistMat = this.mat('quarry_timber', () =>
        new THREE.MeshStandardMaterial({
          color: 0x6b472d,
          map: this.textures.timber,
          roughness: 0.84,
        })
      );
      const beamGeo = this.geo('quarry_beam', () => new THREE.BoxGeometry(0.06, 0.78, 0.06));
      const bL = this.shadow(new THREE.Mesh(beamGeo, hoistMat));
      bL.position.set(-0.34, 0.36, -0.16);
      bL.rotation.z = -0.22;
      const bR = this.shadow(new THREE.Mesh(beamGeo, hoistMat));
      bR.position.set(0.02, 0.36, -0.24);
      bR.rotation.z = 0.22;
      const cross = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.06), hoistMat));
      cross.position.set(-0.16, 0.68, -0.2);
      root.add(s1, s2, s3, bL, bR, cross);
    } else if (kind === 'ruin_pillar') {
      root.add(this.makeContactShadow(0.5, 0.8));
      const plinth = this.shadow(
        new THREE.Mesh(this.geo('pillar_base', () => new THREE.BoxGeometry(0.48, 0.14, 0.48)), ruinStoneMat)
      );
      plinth.position.y = 0.07;
      const step = this.shadow(
        new THREE.Mesh(this.geo('pillar_step', () => new THREE.BoxGeometry(0.36, 0.1, 0.36)), ruinStoneMat)
      );
      step.position.y = 0.19;
      const col = this.shadow(
        new THREE.Mesh(
          this.geo('pillar_col', () => new THREE.CylinderGeometry(0.13, 0.155, 0.94, 8)),
          ruinStoneMat
        )
      );
      col.position.y = 0.71;
      const cap = this.shadow(
        new THREE.Mesh(this.geo('pillar_cap', () => new THREE.BoxGeometry(0.34, 0.1, 0.34)), ruinStoneMat)
      );
      cap.position.set(0, 1.18, 0);
      cap.rotation.z = 0.12;
      const fallen = this.shadow(
        new THREE.Mesh(
          this.geo('pillar_drum', () => new THREE.CylinderGeometry(0.12, 0.12, 0.32, 8)),
          mossMat
        )
      );
      fallen.rotation.z = Math.PI / 2;
      fallen.position.set(0.3, 0.12, 0.18);
      root.add(plinth, step, col, cap, fallen);
    } else if (kind === 'ruin_arch') {
      root.add(this.makeContactShadow(0.82, 0.82));
      const baseGeo = this.geo('arch_base', () => new THREE.BoxGeometry(0.32, 0.16, 0.32));
      const colGeo = this.geo('arch_col', () => new THREE.BoxGeometry(0.22, 1.08, 0.22));
      const leftB = this.shadow(new THREE.Mesh(baseGeo, ruinStoneMat));
      leftB.position.set(-0.36, 0.08, 0);
      const rightB = this.shadow(new THREE.Mesh(baseGeo, ruinStoneMat));
      rightB.position.set(0.36, 0.08, 0);
      const left = this.shadow(new THREE.Mesh(colGeo, ruinStoneMat));
      left.position.set(-0.36, 0.68, 0);
      const right = this.shadow(new THREE.Mesh(colGeo, ruinStoneMat));
      right.position.set(0.36, 0.68, 0);
      const lintel = this.shadow(
        new THREE.Mesh(this.geo('arch_top', () => new THREE.BoxGeometry(1.06, 0.22, 0.3)), ruinStoneMat)
      );
      lintel.position.set(0, 1.26, 0);
      const keystone = this.shadow(
        new THREE.Mesh(this.geo('arch_key', () => new THREE.BoxGeometry(0.22, 0.3, 0.34)), ruinStoneMat)
      );
      keystone.position.set(0, 1.28, 0);
      const mossCap = this.shadow(
        new THREE.Mesh(this.geo('arch_moss', () => new THREE.BoxGeometry(0.58, 0.08, 0.24)), mossMat),
        false,
        true
      );
      mossCap.position.set(-0.14, 1.4, 0);
      root.add(leftB, rightB, left, right, lintel, keystone, mossCap);
    } else if (kind === 'chest') {
      root.add(this.makeContactShadow(0.44, 0.8));
      const woodMat = this.mat('chest_wood', () =>
        new THREE.MeshStandardMaterial({
          color: 0x6f3e19,
          map: this.textures.timber,
          bumpMap: this.textures.timberBump,
          bumpScale: 0.03,
          roughness: 0.72,
          metalness: 0.08,
        })
      );
      const goldTrim = this.mat('gold_trim', () =>
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0x78350f,
          emissiveIntensity: 0.32,
          roughness: 0.28,
          metalness: 0.88,
        })
      );
      const body = this.shadow(
        new THREE.Mesh(this.geo('chest_body', () => new THREE.BoxGeometry(0.46, 0.24, 0.34)), woodMat)
      );
      body.position.y = 0.12;
      root.add(body);

      for (const bx of [-0.16, 0.16]) {
        const band = this.shadow(
          new THREE.Mesh(this.geo('chest_band', () => new THREE.BoxGeometry(0.055, 0.26, 0.36)), goldTrim)
        );
        band.position.set(bx, 0.13, 0);
        root.add(band);
      }

      const lock = this.shadow(
        new THREE.Mesh(this.geo('chest_lock', () => new THREE.BoxGeometry(0.09, 0.11, 0.38)), goldTrim)
      );
      lock.position.set(0, 0.18, 0);
      root.add(lock);

      const lidPivot = new THREE.Group();
      lidPivot.position.set(0, 0.24, -0.17);
      const lid = this.shadow(
        new THREE.Mesh(
          this.geo('chest_lid_arch', () => new THREE.CylinderGeometry(0.17, 0.17, 0.46, 8, 1, false, 0, Math.PI)),
          woodMat
        )
      );
      lid.rotation.z = Math.PI / 2;
      lid.position.set(0, 0, 0.17);
      const lidTrim = this.shadow(
        new THREE.Mesh(this.geo('chest_lid_trim', () => new THREE.BoxGeometry(0.48, 0.05, 0.36)), goldTrim)
      );
      lidTrim.position.set(0, 0.02, 0.17);
      lidPivot.add(lid, lidTrim);
      root.add(lidPivot);
      rig.lidPivot = lidPivot;
    } else if (kind === 'bindstone') {
      // Stone of Souls (§288)
      root.add(this.makeContactShadow(0.86, 0.85));
      const daisLower = this.shadow(
        new THREE.Mesh(
          this.geo('bind_dais_l', () => new THREE.CylinderGeometry(0.68, 0.82, 0.16, 8)),
          ruinStoneMat
        )
      );
      daisLower.position.y = 0.08;
      const daisUpper = this.shadow(
        new THREE.Mesh(
          this.geo('bind_dais_u', () => new THREE.CylinderGeometry(0.48, 0.58, 0.16, 8)),
          ruinStoneMat
        )
      );
      daisUpper.position.y = 0.24;
      root.add(daisLower, daisUpper);

      const runeMat = this.mat('rune_cyan', () =>
        new THREE.MeshBasicMaterial({
          map: this.textures.runeRing,
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      const ring = new THREE.Mesh(
        this.geo('bind_ring', () => {
          const g = new THREE.PlaneGeometry(1.75, 1.75);
          g.rotateX(-Math.PI / 2);
          return g;
        }),
        runeMat
      );
      ring.position.y = 0.33;
      root.add(ring);
      rig.runeRingMesh = ring;

      const crystalMat = this.mat('soul_crystal', () =>
        new THREE.MeshStandardMaterial({
          color: 0xbae6fd,
          emissive: 0x0284c7,
          emissiveIntensity: 1.15,
          roughness: 0.14,
          metalness: 0.35,
        })
      );
      const crystal = this.shadow(
        new THREE.Mesh(this.geo('soul_obelisk', () => new THREE.OctahedronGeometry(0.3, 0)), crystalMat)
      );
      crystal.scale.set(0.84, 2.35, 0.84);
      crystal.position.y = 1.15;
      root.add(crystal);
      rig.crystalMesh = crystal;

      // Orbiting runic stone shards
      const orbitPivot = new THREE.Group();
      orbitPivot.position.y = 1.05;
      const shardGeo = this.geo('soul_shard', () => new THREE.OctahedronGeometry(0.08, 0));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sh = new THREE.Mesh(shardGeo, crystalMat);
        sh.position.set(Math.cos(a) * 0.56, Math.sin(i * 1.4) * 0.18, Math.sin(a) * 0.56);
        sh.scale.set(0.7, 1.5, 0.7);
        orbitPivot.add(sh);
      }
      root.add(orbitPivot);
      rig.orbitPivot = orbitPivot;
    } else if (kind === 'campfire') {
      root.add(this.makeContactShadow(0.48, 0.8));
      const stoneGeo = this.geo('fire_stone', () => new THREE.DodecahedronGeometry(0.085, 0));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const st = this.shadow(new THREE.Mesh(stoneGeo, rockMat), false, true);
        st.position.set(Math.cos(a) * 0.26, 0.055, Math.sin(a) * 0.26);
        root.add(st);
      }
      const logGeo = this.geo('fire_log', () => new THREE.CylinderGeometry(0.048, 0.048, 0.42, 6));
      for (let i = 0; i < 3; i++) {
        const log = this.shadow(new THREE.Mesh(logGeo, barkMat));
        log.position.y = 0.07;
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i * Math.PI) / 3;
        root.add(log);
      }
      const flameOuterMat = this.mat('flame_outer', () =>
        new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9 })
      );
      const flameInnerMat = this.mat('flame_inner', () =>
        new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.96 })
      );
      const fOut = new THREE.Mesh(
        this.geo('flame_c1', () => new THREE.ConeGeometry(0.17, 0.48, 6)),
        flameOuterMat
      );
      fOut.position.y = 0.28;
      const fIn = new THREE.Mesh(
        this.geo('flame_c2', () => new THREE.ConeGeometry(0.095, 0.3, 6)),
        flameInnerMat
      );
      fIn.position.y = 0.23;
      root.add(fOut, fIn);
      rig.flameOuter = fOut;
      rig.flameInner = fIn;
    } else if (kind === 'orc_totem') {
      root.add(this.makeContactShadow(0.42, 0.8));
      const pole = this.shadow(
        new THREE.Mesh(this.geo('totem_pole', () => new THREE.CylinderGeometry(0.065, 0.09, 1.25, 6)), barkMat)
      );
      pole.position.y = 0.62;
      const cross = this.shadow(
        new THREE.Mesh(this.geo('totem_cross', () => new THREE.BoxGeometry(0.64, 0.08, 0.08)), barkMat)
      );
      cross.position.y = 0.94;
      const crimsonMat = this.mat('orc_cloth', () =>
        new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.78, metalness: 0.05 })
      );
      const cloth = this.shadow(
        new THREE.Mesh(this.geo('totem_cloth', () => new THREE.BoxGeometry(0.28, 0.42, 0.04)), crimsonMat)
      );
      cloth.position.set(0, 0.68, 0.06);
      const boneMat = this.mat('bone', () =>
        new THREE.MeshStandardMaterial({ color: 0xe7e5e4, roughness: 0.68 })
      );
      const skull = this.shadow(
        new THREE.Mesh(this.geo('totem_skull', () => new THREE.DodecahedronGeometry(0.14, 0)), boneMat)
      );
      skull.position.y = 1.24;
      const spL = this.shadow(new THREE.Mesh(this.geo('totem_sp', () => new THREE.ConeGeometry(0.035, 0.22, 5)), ironMat));
      spL.position.set(-0.32, 0.98, 0);
      spL.rotation.z = 0.4;
      const spR = this.shadow(new THREE.Mesh(this.geo('totem_sp', () => new THREE.ConeGeometry(0.035, 0.22, 5)), ironMat));
      spR.position.set(0.32, 0.98, 0);
      spR.rotation.z = -0.4;
      root.add(pole, cross, cloth, skull, spL, spR);
    } else if (kind === 'portal') {
      // Monumental Ancient Portal (§276)
      root.add(this.makeContactShadow(1.05, 0.85));
      const base = this.shadow(
        new THREE.Mesh(
          this.geo('portal_dais', () => new THREE.CylinderGeometry(0.84, 1.0, 0.24, 8)),
          ruinStoneMat
        )
      );
      base.position.y = 0.12;
      root.add(base);

      const archMat = this.mat('portal_stone', () =>
        new THREE.MeshStandardMaterial({
          color: 0x5d6b7c,
          map: this.textures.masonry,
          bumpMap: this.textures.masonryBump,
          bumpScale: 0.05,
          roughness: 0.72,
          metalness: 0.2,
        })
      );
      // Twin flanking carved pylons + arched crown
      const pylonGeo = this.geo('portal_pylon', () => new THREE.BoxGeometry(0.24, 1.2, 0.28));
      const pL = this.shadow(new THREE.Mesh(pylonGeo, archMat));
      pL.position.set(-0.64, 0.76, 0);
      const pR = this.shadow(new THREE.Mesh(pylonGeo, archMat));
      pR.position.set(0.64, 0.76, 0);
      const torus = this.shadow(
        new THREE.Mesh(
          this.geo('portal_ring', () => new THREE.TorusGeometry(0.66, 0.14, 8, 22, Math.PI * 1.16)),
          archMat
        )
      );
      torus.position.y = 0.92;
      torus.rotation.z = -0.25;
      root.add(pL, pR, torus);

      const vortexMat = this.mat('portal_vortex', () =>
        new THREE.MeshBasicMaterial({
          map: this.textures.runeRing,
          color: 0x818cf8,
          transparent: true,
          opacity: 0.88,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const vortex = new THREE.Mesh(
        this.geo('portal_disc', () => new THREE.CircleGeometry(0.58, 20)),
        vortexMat
      );
      vortex.position.y = 0.9;
      root.add(vortex);
      rig.vortexMesh = vortex;

      const floorRune = new THREE.Mesh(
        this.geo('bind_ring', () => {
          const g = new THREE.PlaneGeometry(1.75, 1.75);
          g.rotateX(-Math.PI / 2);
          return g;
        }),
        vortexMat
      );
      floorRune.position.y = 0.25;
      root.add(floorRune);
      rig.runeRingMesh = floorRune;
    }

    return rig;
  }

  public createBuilding(type: BuildingType, faction: Faction, sizeTiles: number): BuildingRig3D {
    const root = new THREE.Group();
    const structureGroup = new THREE.Group();
    const scaffoldGroup = new THREE.Group();
    const hitMeshes: THREE.Mesh[] = [];

    const footprint = sizeTiles * 0.92;
    root.add(this.makeContactShadow(footprint * 0.72, 0.85));

    const selectionRing = new THREE.Mesh(
      this.geo('sel_ring', () => new THREE.RingGeometry(0.46, 0.56, 28)),
      this.mat('sel_ring_gold', () =>
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        })
      )
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.scale.setScalar(sizeTiles * 1.15);
    selectionRing.position.y = 0.04;
    selectionRing.visible = false;
    root.add(selectionRing);

    // Rich PBR building materials
    const stoneMat = new THREE.MeshStandardMaterial({
      color: faction === 'orc' ? 0x4b4642 : 0xb2aba2,
      map: this.textures.masonry,
      bumpMap: this.textures.masonryBump,
      bumpScale: 0.065,
      roughness: 0.82,
      metalness: 0.06,
    });
    const trimStoneMat = new THREE.MeshStandardMaterial({
      color: faction === 'orc' ? 0x35312f : 0x8e877e,
      map: this.textures.masonry,
      bumpMap: this.textures.masonryBump,
      bumpScale: 0.05,
      roughness: 0.78,
      metalness: 0.08,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: faction === 'orc' ? 0x7f1d1d : type === 'farm' ? 0xc89a4d : 0x264b74,
      map: type === 'farm' ? this.textures.timber : this.textures.roofSlate,
      bumpMap: type === 'farm' ? this.textures.timberBump : this.textures.roofBump,
      bumpScale: 0.055,
      roughness: 0.68,
      metalness: type === 'farm' ? 0.04 : 0.18,
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: faction === 'orc' ? 0x482819 : 0x6f492d,
      map: this.textures.timber,
      bumpMap: this.textures.timberBump,
      bumpScale: 0.045,
      roughness: 0.84,
      metalness: 0.05,
    });
    const ironMat = this.mat('dark_iron', () =>
      new THREE.MeshStandardMaterial({ color: 0x292d36, roughness: 0.42, metalness: 0.82 })
    );
    const goldMetalMat = this.mat('building_gold', () =>
      new THREE.MeshStandardMaterial({ color: 0xd9a841, roughness: 0.32, metalness: 0.86 })
    );
    const bannerMat = new THREE.MeshStandardMaterial({
      color: faction === 'orc' ? 0xdc2626 : 0x2563eb,
      emissive: faction === 'orc' ? 0x450a0a : 0x172554,
      emissiveIntensity: 0.35,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    const glowWinMat = this.mat('warm_window', () =>
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.25,
        roughness: 0.28,
      })
    );
    const emberMat = this.mat('orc_ember', () =>
      new THREE.MeshBasicMaterial({ color: 0xf97316 })
    );

    const addHitMesh = (mesh: THREE.Mesh) => {
      this.shadow(mesh);
      structureGroup.add(mesh);
      hitMeshes.push(mesh);
      return mesh;
    };

    let bannerMesh: THREE.Object3D | undefined;
    let beaconMesh: THREE.Object3D | undefined;

    if (type === 'town_hall') {
      // Stepped stone foundation + buttressed grand hall + timber beams + crenellated keep + spire + lit windows + torches
      const plinth = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.26, 2.6), trimStoneMat));
      plinth.position.y = 0.13;
      const hall = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(2.08, 1.08, 1.78), stoneMat));
      hall.position.y = 0.78;
      // Corner stone buttresses
      for (const [bx, bz] of [
        [-1.02, -0.86],
        [1.02, -0.86],
        [-1.02, 0.86],
        [1.02, 0.86],
      ]) {
        const buttress = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.12, 0.24), trimStoneMat));
        buttress.position.set(bx, 0.78, bz);
      }
      // Overhanging dark slate roof + ridge beam
      const roof = addHitMesh(new THREE.Mesh(new THREE.ConeGeometry(1.74, 0.94, 4), roofMat));
      roof.position.y = 1.76;
      roof.rotation.y = Math.PI / 4;
      const cornice = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.1, 1.94), woodMat));
      cornice.position.y = 1.32;

      // Crenellated Keep Tower
      const keep = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.08, 0.92), stoneMat));
      keep.position.set(-0.52, 1.24, -0.34);
      const keepCrown = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.18, 1.06), trimStoneMat));
      keepCrown.position.set(-0.52, 2.26, -0.34);
      for (const [cx, cz] of [
        [-0.45, -0.45],
        [0.45, -0.45],
        [-0.45, 0.45],
        [0.45, 0.45],
      ]) {
        const merlon = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.2), trimStoneMat));
        merlon.position.set(-0.52 + cx, 2.41, -0.34 + cz);
      }
      const spire = addHitMesh(new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.92, 4), roofMat));
      spire.position.set(-0.52, 2.78, -0.34);
      spire.rotation.y = Math.PI / 4;
      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), goldMetalMat);
      finial.position.set(-0.52, 3.3, -0.34);
      structureGroup.add(finial);

      // Arched Oak Entrance + flanking lanterns
      const gateFrame = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.78, 0.2), trimStoneMat));
      gateFrame.position.set(0.16, 0.62, 0.88);
      const gate = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.22), woodMat));
      gate.position.set(0.16, 0.58, 0.9);
      for (const lx of [-0.26, 0.58]) {
        const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), glowWinMat);
        sconce.position.set(lx, 0.76, 0.96);
        structureGroup.add(sconce);
      }

      // Mullioned glowing windows
      for (const wx of [-0.56, 0.68]) {
        const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.08), woodMat);
        winFrame.position.set(wx, 0.96, 0.88);
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.1), glowWinMat);
        win.position.set(wx, 0.96, 0.89);
        structureGroup.add(winFrame, win);
      }

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.88, 6), ironMat);
      pole.position.set(-0.52, 3.64, -0.34);
      structureGroup.add(pole);
      bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.32), bannerMat);
      bannerMesh.position.set(-0.2, 3.84, -0.34);
      structureGroup.add(bannerMesh);
    } else if (type === 'barracks') {
      const base = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.22, 1.86), trimStoneMat));
      base.position.y = 0.11;
      const body = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.92, 1.42), stoneMat));
      body.position.y = 0.66;
      // Timber cross-beams on facade
      for (const tx of [-0.74, 0.74]) {
        const beam = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.94, 1.48), woodMat));
        beam.position.set(tx, 0.66, 0);
      }
      const roof = addHitMesh(new THREE.Mesh(new THREE.ConeGeometry(1.32, 0.72, 4), roofMat));
      roof.position.y = 1.46;
      roof.rotation.y = Math.PI / 4;
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), ironMat);
      ridge.position.y = 1.84;
      structureGroup.add(ridge);

      const door = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.14), woodMat));
      door.position.set(-0.08, 0.5, 0.7);
      const lintel = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.18), trimStoneMat));
      lintel.position.set(-0.08, 0.82, 0.7);

      // Outdoor training rack with shield & spears
      const rack = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.14), woodMat));
      rack.position.set(0.56, 0.38, 0.74);
      const shieldDecor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 8), bannerMat);
      shieldDecor.rotation.x = Math.PI / 2;
      shieldDecor.position.set(0.56, 0.44, 0.83);
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), glowWinMat);
      lantern.position.set(-0.52, 0.76, 0.75);
      structureGroup.add(shieldDecor, lantern);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.05, 6), ironMat);
      pole.position.set(-0.68, 1.32, 0.6);
      structureGroup.add(pole);
      bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), bannerMat);
      bannerMesh.position.set(-0.44, 1.66, 0.6);
      structureGroup.add(bannerMesh);
    } else if (type === 'archer_range') {
      const floor = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.14, 1.72), trimStoneMat));
      floor.position.y = 0.07;
      const shelter = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 0.84), woodMat));
      shelter.position.set(0, 0.48, -0.32);
      // Timber support posts
      for (const px of [-0.68, 0.68]) {
        const post = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.86, 0.1), woodMat));
        post.position.set(px, 0.5, 0.14);
      }
      const canopy = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.15, 1.24), roofMat));
      canopy.position.set(0, 0.94, -0.2);
      canopy.rotation.x = 0.2;

      const targetMat = this.mat('archery_target', () =>
        new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.85 })
      );
      const ringMat = this.mat('archery_ring', () =>
        new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.78 })
      );
      const bullMat = this.mat('archery_bull', () =>
        new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.72 })
      );
      for (const tx of [-0.42, 0.38]) {
        const stand = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.08), woodMat));
        stand.position.set(tx, 0.26, 0.64);
        stand.rotation.x = -0.25;
        const tgt = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 14), targetMat));
        tgt.rotation.x = Math.PI / 2;
        tgt.position.set(tx, 0.4, 0.58);
        const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), ringMat);
        mid.rotation.x = Math.PI / 2;
        mid.position.set(tx, 0.4, 0.58);
        const bull = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 10), bullMat);
        bull.rotation.x = Math.PI / 2;
        bull.position.set(tx, 0.4, 0.58);
        structureGroup.add(stand, tgt, mid, bull);
      }
    } else if (type === 'farm') {
      const base = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.14, 1.02), trimStoneMat));
      base.position.set(-0.28, 0.07, -0.26);
      const cottage = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.68, 0.92), stoneMat));
      cottage.position.set(-0.28, 0.44, -0.26);
      const thatch = addHitMesh(new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.62, 4), roofMat));
      thatch.position.set(-0.28, 1.06, -0.26);
      thatch.rotation.y = Math.PI / 4;
      const chimney = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.18), trimStoneMat));
      chimney.position.set(-0.62, 1.05, -0.45);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.08), glowWinMat);
      win.position.set(-0.28, 0.48, 0.21);
      structureGroup.add(win);

      // Furrowed golden wheat rows + wooden fence + hay bale
      const soilMat = this.mat('farm_soil', () =>
        new THREE.MeshStandardMaterial({ color: 0x4b3622, roughness: 0.94 })
      );
      const wheatMat = this.mat('wheat_gold', () =>
        new THREE.MeshStandardMaterial({ color: 0xd9a841, roughness: 0.88 })
      );
      const soil = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.08, 0.84), soilMat), false, true);
      soil.position.set(0.16, 0.04, 0.46);
      structureGroup.add(soil);
      for (let r = 0; r < 3; r++) {
        const row = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 0.18), wheatMat), false, true);
        row.position.set(0.16, 0.14, 0.24 + r * 0.22);
        structureGroup.add(row);
      }
      const hay = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8), wheatMat));
      hay.rotation.z = Math.PI / 2;
      hay.position.set(0.58, 0.18, -0.38);
      structureGroup.add(hay);
    } else if (type === 'tower' || type === 'orc_tower') {
      const base = addHitMesh(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.58, 0.26, faction === 'orc' ? 6 : 8),
          trimStoneMat
        )
      );
      base.position.y = 0.13;
      const shaft = addHitMesh(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.38, 0.48, 1.66, faction === 'orc' ? 6 : 8),
          faction === 'orc' ? woodMat : stoneMat
        )
      );
      shaft.position.y = 1.04;
      const crown = addHitMesh(
        new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.36, 0.98), faction === 'orc' ? woodMat : trimStoneMat)
      );
      crown.position.y = 1.94;
      // Battlement merlons or orc spikes
      for (const [cx, cz] of [
        [-0.42, -0.42],
        [0.42, -0.42],
        [-0.42, 0.42],
        [0.42, 0.42],
      ]) {
        const cap =
          faction === 'orc'
            ? this.shadow(new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 5), ironMat))
            : addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.2), stoneMat));
        cap.position.set(cx, 2.2, cz);
        structureGroup.add(cap);
      }
      const spire = addHitMesh(new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.78, 6), roofMat));
      spire.position.y = 2.48;
      beaconMesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.15, 0),
        faction === 'orc' ? emberMat : glowWinMat
      );
      beaconMesh.position.set(0, 2.1, 0.46);
      structureGroup.add(beaconMesh);
    } else if (type === 'orc_stronghold') {
      const plinth = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.3, 2.72), trimStoneMat));
      plinth.position.y = 0.15;
      const fortress = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(2.12, 1.24, 1.96), stoneMat));
      fortress.position.y = 0.9;
      // Iron wall reinforcement bands
      const band = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 2.04), ironMat));
      band.position.y = 0.92;
      structureGroup.add(band);

      const roof = addHitMesh(new THREE.Mesh(new THREE.ConeGeometry(1.74, 0.94, 5), roofMat));
      roof.position.y = 1.96;

      // Brutal iron war gate + skull trophy
      const gate = addHitMesh(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.78, 0.18), ironMat));
      gate.position.set(0, 0.64, 0.98);
      const boneMat = this.mat('bone', () =>
        new THREE.MeshStandardMaterial({ color: 0xe7e5e4, roughness: 0.68 })
      );
      const skull = this.shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), boneMat));
      skull.position.set(0, 1.18, 1.04);
      structureGroup.add(skull);

      // Corner spiked iron buttresses
      const spikeGeo = this.geo('orc_spike', () => new THREE.ConeGeometry(0.14, 0.98, 5));
      for (const [sx, sz] of [
        [-1.12, -1.04],
        [1.12, -1.04],
        [-1.12, 1.04],
        [1.12, 1.04],
      ]) {
        const sp = this.shadow(new THREE.Mesh(spikeGeo, ironMat));
        sp.position.set(sx, 1.02, sz);
        sp.rotation.z = sx < 0 ? 0.24 : -0.24;
        structureGroup.add(sp);
      }

      // Twin flaming war braziers
      for (const bx of [-0.62, 0.62]) {
        const bowl = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.22, 6), ironMat));
        bowl.position.set(bx, 0.42, 1.14);
        const fire = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), emberMat);
        fire.position.set(bx, 0.64, 1.14);
        structureGroup.add(bowl, fire);
      }

      beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), emberMat);
      beaconMesh.position.set(0, 2.46, 0);
      structureGroup.add(beaconMesh);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), ironMat);
      pole.position.set(0.82, 2.02, 0.6);
      structureGroup.add(pole);
      bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.34), bannerMat);
      bannerMesh.position.set(1.1, 2.26, 0.6);
      structureGroup.add(bannerMesh);
    }

    // Construction scaffold frame
    const postGeo = this.geo('scaf_post', () => new THREE.BoxGeometry(0.1, 1.15, 0.1));
    const half = sizeTiles * 0.42;
    for (const [px, pz] of [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ]) {
      const post = this.shadow(new THREE.Mesh(postGeo, woodMat));
      post.position.set(px, 0.58, pz);
      scaffoldGroup.add(post);
    }
    const plank = this.shadow(
      new THREE.Mesh(new THREE.BoxGeometry(sizeTiles * 0.88, 0.1, sizeTiles * 0.88), woodMat)
    );
    plank.position.y = 0.06;
    scaffoldGroup.add(plank);
    scaffoldGroup.visible = false;

    root.add(structureGroup, scaffoldGroup);
    return {
      root,
      structureGroup,
      scaffoldGroup,
      bannerMesh,
      beaconMesh,
      selectionRing,
      hitMeshes,
    };
  }

  public createUnit(type: UnitType, faction: Faction): UnitRig3D {
    const root = new THREE.Group();
    const facingPivot = new THREE.Group();
    const bodyGroup = new THREE.Group();
    facingPivot.add(bodyGroup);
    root.add(facingPivot);

    const isBig = type === 'hero' || type === 'orc_commander';
    const isOrc = faction === 'orc';
    const isSkeleton = type === 'skeleton_minion';
    const scale =
      type === 'orc_commander'
        ? 1.32
        : type === 'hero'
        ? 1.18
        : isSkeleton
        ? 0.98
        : isOrc
        ? 1.06
        : 1.02;

    root.add(this.makeContactShadow(isBig ? 0.5 : 0.38, 0.82));

    const selectionRing = new THREE.Mesh(
      this.geo('unit_sel_ring', () => new THREE.RingGeometry(0.34, 0.45, 24)),
      this.mat(faction === 'human' ? 'sel_ring_human' : 'sel_ring_orc', () =>
        new THREE.MeshBasicMaterial({
          color: faction === 'human' ? 0x4ade80 : 0xef4444,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.94,
          depthWrite: false,
        })
      )
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.032;
    selectionRing.visible = false;
    root.add(selectionRing);

    let auraRing: THREE.Mesh | undefined;
    if (type === 'hero' || type === 'orc_commander' || isSkeleton) {
      const auraColor =
        type === 'hero' ? 0xfacc15 : isSkeleton ? 0x38bdf8 : 0xdc2626;
      auraRing = new THREE.Mesh(
        this.geo('unit_aura_ring', () => new THREE.RingGeometry(0.44, 0.52, 24)),
        new THREE.MeshBasicMaterial({
          color: auraColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isSkeleton ? 0.62 : 0.78,
          depthWrite: false,
        })
      );
      auraRing.rotation.x = -Math.PI / 2;
      auraRing.position.y = 0.026;
      root.add(auraRing);
    }

    const hitMaterials: THREE.MeshStandardMaterial[] = [];
    const makeMat = (params: THREE.MeshStandardMaterialParameters) => {
      const m = new THREE.MeshStandardMaterial(params);
      hitMaterials.push(m);
      return m;
    };

    // High-readability Dark Fantasy faction palette:
    // Allies: burnished steel, royal cobalt, antique gold, warm leather
    // Enemies: volcanic crimson, forged dark iron, ash-green skin, bone
    const skinColor = isSkeleton ? 0xe7e5e4 : isOrc ? 0x4a7038 : 0xe4ba95;
    const armorColor =
      type === 'hero'
        ? 0x2f3c4f
        : type === 'orc_commander'
        ? 0x1c1917
        : isSkeleton
        ? 0x383a42
        : type === 'archer'
        ? 0x265436
        : type === 'laborer'
        ? 0x7c532e
        : isOrc
        ? 0x3f2c24
        : 0x2f5da8;
    const accentColor =
      type === 'hero'
        ? 0xeab308
        : type === 'orc_commander'
        ? 0xdc2626
        : isSkeleton
        ? 0x38bdf8
        : isOrc
        ? 0xb91c1c
        : 0x2563eb;
    const leatherColor = isOrc ? 0x2b1d17 : 0x4f3522;

    const armorMat = makeMat({
      color: armorColor,
      roughness: type === 'hero' || type === 'swordsman' || type === 'orc_commander' ? 0.3 : 0.72,
      metalness: type === 'hero' || type === 'swordsman' || type === 'orc_commander' ? 0.78 : 0.16,
    });
    const leatherMat = makeMat({ color: leatherColor, roughness: 0.84, metalness: 0.06 });
    const skinMat = makeMat({ color: skinColor, roughness: 0.76, metalness: 0.04 });
    const accentMat = makeMat({
      color: accentColor,
      emissive: isSkeleton ? 0x0284c7 : type === 'hero' ? 0x713f12 : 0x000000,
      emissiveIntensity: isSkeleton ? 0.7 : type === 'hero' ? 0.2 : 0,
      roughness: 0.44,
      metalness: type === 'hero' ? 0.75 : 0.2,
    });
    const steelMat = makeMat({
      color: type === 'hero' ? 0xf1f5f9 : isOrc ? 0x64748b : 0xb4c0ce,
      emissive: type === 'hero' ? 0x2563eb : 0x000000,
      emissiveIntensity: type === 'hero' ? 0.28 : 0,
      roughness: 0.22,
      metalness: 0.92,
    });
    const boneMat = makeMat({ color: 0xe7e5e4, roughness: 0.68, metalness: 0.04 });

    // Sculpted legs with boots/greaves
    const legUpperGeo = this.geo('u_leg_cyl', () => new THREE.CylinderGeometry(0.052, 0.06, 0.26, 6));
    const bootGeo = this.geo('u_boot', () => new THREE.BoxGeometry(0.11, 0.09, 0.16));
    const legMat = isSkeleton ? boneMat : armorMat;

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.095, 0.34, 0);
    const lLegM = this.shadow(new THREE.Mesh(legUpperGeo, legMat));
    lLegM.position.y = -0.13;
    const lBoot = this.shadow(new THREE.Mesh(bootGeo, leatherMat));
    lBoot.position.set(0, -0.29, 0.025);
    leftLeg.add(lLegM, lBoot);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.095, 0.34, 0);
    const rLegM = this.shadow(new THREE.Mesh(legUpperGeo, legMat));
    rLegM.position.y = -0.13;
    const rBoot = this.shadow(new THREE.Mesh(bootGeo, leatherMat));
    rBoot.position.set(0, -0.29, 0.025);
    rightLeg.add(rLegM, rBoot);

    // Tapered heroic torso + belt + tasset skirt
    const torsoW = isSkeleton ? 0.22 : isOrc ? 0.42 : 0.32;
    const torsoTopR = torsoW * 0.56;
    const torsoBotR = torsoW * 0.4;
    const torso = this.shadow(
      new THREE.Mesh(
        new THREE.CylinderGeometry(torsoTopR, torsoBotR, 0.42, 7),
        isSkeleton ? boneMat : armorMat
      )
    );
    torso.scale.set(1.0, 1.0, 0.72);
    torso.position.y = 0.56;

    // Waist belt + heraldic tabard/tasset
    const belt = this.shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(torsoBotR * 1.12, torsoBotR * 1.15, 0.08, 7), leatherMat)
    );
    belt.scale.set(1.0, 1.0, 0.76);
    belt.position.y = 0.38;

    const tabard = this.shadow(
      new THREE.Mesh(new THREE.BoxGeometry(torsoW * 0.55, 0.24, 0.04), accentMat)
    );
    tabard.position.set(0, 0.31, torsoBotR * 0.65);

    bodyGroup.add(leftLeg, rightLeg, torso, belt, tabard);

    // Expressive broad shoulder pauldrons
    if (type !== 'laborer') {
      const pRadius = type === 'orc_commander' ? 0.145 : type === 'hero' ? 0.135 : isOrc ? 0.125 : 0.11;
      const pauldronGeo = this.geo(`u_pauld_${Math.round(pRadius * 100)}`, () =>
        new THREE.SphereGeometry(pRadius, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.7)
      );
      const pMat = type === 'hero' || type === 'swordsman' ? steelMat : accentMat;
      const pL = this.shadow(new THREE.Mesh(pauldronGeo, pMat));
      pL.position.set(-torsoW * 0.66, 0.72, 0);
      pL.rotation.z = 0.35;
      const pR = this.shadow(new THREE.Mesh(pauldronGeo, pMat));
      pR.position.set(torsoW * 0.66, 0.72, 0);
      pR.rotation.z = -0.35;
      bodyGroup.add(pL, pR);

      // Spiked shoulder trim for Orcs, gilded trim for Hero
      if (isOrc) {
        const spGeo = this.geo('orc_p_spike', () => new THREE.ConeGeometry(0.032, 0.15, 5));
        const spL = this.shadow(new THREE.Mesh(spGeo, boneMat));
        spL.position.set(-torsoW * 0.74, 0.84, 0);
        spL.rotation.z = 0.45;
        const spR = this.shadow(new THREE.Mesh(spGeo, boneMat));
        spR.position.set(torsoW * 0.74, 0.84, 0);
        spR.rotation.z = -0.45;
        bodyGroup.add(spL, spR);
      } else if (type === 'hero') {
        const trimGeo = this.geo('hero_p_trim', () => new THREE.TorusGeometry(0.11, 0.02, 5, 10));
        const tL = new THREE.Mesh(trimGeo, accentMat);
        tL.position.set(-torsoW * 0.66, 0.68, 0);
        tL.rotation.x = Math.PI / 2;
        const tR = new THREE.Mesh(trimGeo, accentMat);
        tR.position.set(torsoW * 0.66, 0.68, 0);
        tR.rotation.x = Math.PI / 2;
        bodyGroup.add(tL, tR);
      }
    }

    // Head + Distinctive Helm / Hood / Crown / Tusks
    const headY = isOrc ? 0.86 : 0.91;
    const head = this.shadow(
      new THREE.Mesh(this.geo('u_head', () => new THREE.SphereGeometry(0.135, 10, 8)), skinMat)
    );
    head.position.set(0, headY, isOrc ? 0.04 : 0);
    bodyGroup.add(head);

    if (type === 'hero') {
      const helm = this.shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.15, 0.18, 8), steelMat)
      );
      helm.position.y = headY + 0.05;
      const visor = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.06), leatherMat));
      visor.position.set(0, headY + 0.02, 0.13);
      const crown = this.shadow(
        new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.026, 6, 12), accentMat)
      );
      crown.rotation.x = Math.PI / 2;
      crown.position.y = headY + 0.12;
      const crest = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.15, 0.24), accentMat));
      crest.position.set(0, headY + 0.18, -0.02);
      bodyGroup.add(helm, visor, crown, crest);
    } else if (type === 'swordsman') {
      const helm = this.shadow(new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.16, 8), steelMat));
      helm.position.y = headY + 0.1;
      const rim = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.035, 8), steelMat));
      rim.position.y = headY + 0.03;
      bodyGroup.add(helm, rim);
    } else if (type === 'archer') {
      const hood = this.shadow(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.25, 7), armorMat));
      hood.position.set(0, headY + 0.09, -0.03);
      hood.rotation.x = -0.2;
      // Quiver with fletched arrows on back
      const quiver = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.34, 6), leatherMat));
      quiver.position.set(-0.08, 0.62, -0.14);
      quiver.rotation.z = 0.28;
      bodyGroup.add(hood, quiver);
    } else if (type === 'orc_commander' || type === 'orc_warrior') {
      const helm = this.shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.16, 7), armorMat)
      );
      helm.position.set(0, headY + 0.06, 0.04);
      bodyGroup.add(helm);
      if (type === 'orc_commander') {
        const hornGeo = this.geo('orc_horn', () => new THREE.ConeGeometry(0.042, 0.3, 6));
        const hL = this.shadow(new THREE.Mesh(hornGeo, boneMat));
        hL.position.set(-0.18, headY + 0.16, 0.04);
        hL.rotation.z = 0.62;
        const hR = this.shadow(new THREE.Mesh(hornGeo, boneMat));
        hR.position.set(0.18, headY + 0.16, 0.04);
        hR.rotation.z = -0.62;
        bodyGroup.add(hL, hR);
      }
      // Subtle jaw tusks for instant enemy readability
      const tuskGeo = this.geo('orc_tusk', () => new THREE.ConeGeometry(0.018, 0.08, 4));
      const tkL = new THREE.Mesh(tuskGeo, boneMat);
      tkL.position.set(-0.05, headY - 0.05, 0.16);
      const tkR = new THREE.Mesh(tuskGeo, boneMat);
      tkR.position.set(0.05, headY - 0.05, 0.16);
      bodyGroup.add(tkL, tkR);
    } else if (isSkeleton) {
      const eyeMat = this.mat('skel_eye', () => new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.04), eyeMat);
      eyeL.position.set(-0.048, headY + 0.01, 0.115);
      const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.04), eyeMat);
      eyeR.position.set(0.048, headY + 0.01, 0.115);
      bodyGroup.add(eyeL, eyeR);
    }

    // Flowing Cloak for Hero, Archer & Orc Commander
    let cloakMesh: THREE.Object3D | undefined;
    if (type === 'hero' || type === 'orc_commander' || type === 'archer') {
      const cloakColor =
        type === 'hero' ? 0x1d4ed8 : type === 'archer' ? 0x1f4d30 : 0x991b1b;
      cloakMesh = this.shadow(
        new THREE.Mesh(
          new THREE.BoxGeometry(type === 'archer' ? 0.28 : 0.36, 0.62, 0.04),
          makeMat({ color: cloakColor, roughness: 0.78, metalness: 0.04 })
        )
      );
      cloakMesh.position.set(0, 0.48, -0.16);
      cloakMesh.rotation.x = 0.2;
      bodyGroup.add(cloakMesh);
    }

    // Articulated Arms + Gauntlets + Sculpted Weapons & Shields
    const armGeo = this.geo('u_arm_cyl', () => new THREE.CylinderGeometry(0.046, 0.052, 0.28, 6));
    const leftArm = new THREE.Group();
    leftArm.position.set(-torsoW * 0.66, 0.68, 0);
    const lArmM = this.shadow(new THREE.Mesh(armGeo, isSkeleton ? boneMat : armorMat));
    lArmM.position.y = -0.14;
    leftArm.add(lArmM);

    const rightArm = new THREE.Group();
    rightArm.position.set(torsoW * 0.66, 0.68, 0);
    const rArmM = this.shadow(new THREE.Mesh(armGeo, isSkeleton ? boneMat : armorMat));
    rArmM.position.y = -0.14;
    rightArm.add(rArmM);

    if (type === 'hero' || type === 'swordsman' || isSkeleton) {
      const bladeLen = type === 'hero' ? 0.78 : 0.54;
      const weaponGroup = new THREE.Group();
      weaponGroup.position.set(0, -0.24, 0.08);
      weaponGroup.rotation.x = Math.PI * 0.36;

      const hilt = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 5), leatherMat));
      const guard = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.036, 0.05), accentMat));
      guard.position.y = 0.08;
      const blade = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.055, bladeLen, 0.095), steelMat));
      blade.position.y = 0.08 + bladeLen * 0.5;
      const tip = this.shadow(new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 4), steelMat));
      tip.position.y = 0.08 + bladeLen + 0.07;
      weaponGroup.add(hilt, guard, blade, tip);
      rightArm.add(weaponGroup);

      if (type === 'swordsman' || isSkeleton) {
        const shieldGroup = new THREE.Group();
        shieldGroup.position.set(-0.08, -0.16, 0.12);
        const shieldBody = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), accentMat));
        const shieldTrim = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.1), steelMat));
        shieldTrim.position.set(-0.01, 0.02, 0);
        shieldGroup.add(shieldBody, shieldTrim);
        leftArm.add(shieldGroup);
      }
    } else if (type === 'archer' || type === 'orc_archer') {
      const bow = this.shadow(
        new THREE.Mesh(
          new THREE.TorusGeometry(0.28, 0.028, 6, 12, Math.PI),
          makeMat({ color: isOrc ? 0x573b26 : 0x854d0e, roughness: 0.78 })
        )
      );
      bow.position.set(0, -0.14, 0.18);
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = -Math.PI / 2;
      const stringLine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.54, 4),
        boneMat
      );
      stringLine.position.set(0, -0.14, 0.16);
      leftArm.add(bow, stringLine);
    } else if (type === 'orc_warrior' || type === 'orc_commander') {
      const axeGroup = new THREE.Group();
      axeGroup.position.set(0, -0.22, 0.08);
      axeGroup.rotation.x = Math.PI * 0.38;
      const haftLen = type === 'orc_commander' ? 0.86 : 0.68;
      const haft = this.shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, haftLen, 6), leatherMat)
      );
      haft.position.y = haftLen * 0.4;
      const axeHead = this.shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.26), steelMat)
      );
      axeHead.position.set(0, haftLen * 0.72, 0.1);
      const backSpike = this.shadow(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 4), steelMat));
      backSpike.rotation.x = -Math.PI / 2;
      backSpike.position.set(0, haftLen * 0.72, -0.09);
      axeGroup.add(haft, axeHead, backSpike);
      rightArm.add(axeGroup);
    } else if (type === 'laborer') {
      const pickGroup = new THREE.Group();
      pickGroup.position.set(0, -0.2, 0.08);
      pickGroup.rotation.x = Math.PI * 0.36;
      const handle = this.shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.52, 5), leatherMat));
      handle.position.y = 0.2;
      const headMetal = this.shadow(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.32), steelMat));
      headMetal.position.set(0, 0.44, 0);
      pickGroup.add(handle, headMetal);
      rightArm.add(pickGroup);
    }

    let carryCrate: THREE.Mesh | undefined;
    if (type === 'laborer') {
      carryCrate = this.shadow(
        new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.22, 0.25),
          new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.56, metalness: 0.42 })
        )
      );
      carryCrate.position.set(0, 0.74, 0.22);
      carryCrate.visible = false;
      bodyGroup.add(carryCrate);
    }

    bodyGroup.add(leftArm, rightArm);
    facingPivot.scale.setScalar(scale);

    return {
      root,
      facingPivot,
      bodyGroup,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      cloakMesh,
      selectionRing,
      auraRing,
      carryCrate,
      hitMaterials,
    };
  }

  public dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    for (const g of this.geos.values()) g.dispose();
    this.mats.clear();
    this.geos.clear();
  }
}
