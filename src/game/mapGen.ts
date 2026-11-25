import { MAP_SIZE } from './iso';
import {
  Building,
  Tile,
  Unit,
  UNIT_BLUEPRINTS,
  BUILDING_BLUEPRINTS,
  UnitType,
  BuildingType,
} from './types';

function hash2d(x: number, y: number, seed = 1337): number {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

export interface GeneratedWorld {
  tiles: Tile[][];
  units: Unit[];
  buildings: Building[];
}

export function createUnit(
  id: string,
  faction: 'human' | 'orc',
  type: UnitType,
  x: number,
  y: number,
  extra?: Partial<Unit>
): Unit {
  const bp = UNIT_BLUEPRINTS[type];
  return {
    id,
    faction,
    type,
    name: bp.name,
    x,
    y,
    vx: 0,
    vy: 0,
    facing: faction === 'human' ? 1 : -1,
    hp: bp.maxHp,
    maxHp: bp.maxHp,
    baseAtk: bp.atk,
    baseArmor: bp.armor,
    range: bp.range,
    speed: bp.speed,
    atkCooldown: bp.atkCooldown,
    atkTimer: 0,
    isRanged: bp.isRanged,
    order: 'idle',
    animTime: Math.random() * 6,
    attackAnimTimer: 0,
    hitFlashTimer: 0,
    homeX: x,
    homeY: y,
    ...extra,
  };
}

export function createBuilding(
  id: string,
  faction: 'human' | 'orc',
  type: BuildingType,
  gx: number,
  gy: number,
  constructed = true
): Building {
  if (type === 'orc_stronghold') {
    return {
      id,
      faction: 'orc',
      type,
      name: 'Orc Warhold',
      gx,
      gy,
      size: 2,
      hp: 850,
      maxHp: 850,
      constructed: true,
      buildProgress: 1,
      buildTime: 10,
      queue: [],
      attackTimer: 0,
      hitFlashTimer: 0,
    };
  }
  if (type === 'orc_tower') {
    return {
      id,
      faction: 'orc',
      type,
      name: 'Bone Watchtower',
      gx,
      gy,
      size: 1,
      hp: 400,
      maxHp: 400,
      constructed: true,
      buildProgress: 1,
      buildTime: 6,
      queue: [],
      attackTimer: 0,
      hitFlashTimer: 0,
    };
  }

  const bp = BUILDING_BLUEPRINTS[type];
  return {
    id,
    faction,
    type,
    name: bp.name,
    gx,
    gy,
    size: bp.size,
    hp: constructed ? bp.maxHp : Math.round(bp.maxHp * 0.25),
    maxHp: bp.maxHp,
    constructed,
    buildProgress: constructed ? 1 : 0.05,
    buildTime: bp.buildTime,
    queue: [],
    attackTimer: 0,
    hitFlashTimer: 0,
  };
}

export function generateScenarioWorld(): GeneratedWorld {
  const tiles: Tile[][] = [];

  for (let y = 0; y < MAP_SIZE; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < MAP_SIZE; x++) {
      const n = hash2d(x, y, 42);
      row.push({
        gx: x,
        gy: y,
        terrain: n > 0.72 ? 'forest_floor' : 'grass',
        elevation: 1,
        walkable: true,
        fog: 0,
      });
    }
    tiles.push(row);
  }

  // 1. Winding river along diagonal x ~= y (with slight organic bend)
  for (let i = 0; i < MAP_SIZE; i++) {
    const bend = Math.round(Math.sin(i * 0.24) * 1.6);
    const rx = i + bend;
    const ry = i;
    for (let dx = -1; dx <= 1; dx++) {
      const tx = rx + dx;
      if (tx >= 0 && tx < MAP_SIZE && ry >= 0 && ry < MAP_SIZE) {
        const t = tiles[ry][tx];
        t.terrain = 'water';
        t.elevation = 0;
        t.walkable = false;
        t.regionTag = 'river';
      }
    }
  }

  // 2. Two wide stone bridges crossing the river
  const bridgeCenters = [14, 27];
  for (const bc of bridgeCenters) {
    for (let by = bc - 1; by <= bc + 1; by++) {
      for (let bx = bc - 3; bx <= bc + 3; bx++) {
        if (bx >= 0 && bx < MAP_SIZE && by >= 0 && by < MAP_SIZE) {
          const t = tiles[by][bx];
          if (t.terrain === 'water' || Math.abs(bx - by) <= 2) {
            t.terrain = 'bridge';
            t.elevation = 1;
            t.walkable = true;
            t.regionTag = 'river';
          }
        }
      }
    }
  }

  // 3. Human Settlement Clearing (SW: x 5..14, y 26..36)
  for (let y = 25; y <= 37; y++) {
    for (let x = 4; x <= 15; x++) {
      const t = tiles[y][x];
      if (t.terrain !== 'water') {
        t.terrain = 'grass';
        t.elevation = 1;
        t.walkable = true;
        t.regionTag = 'settlement';
      }
    }
  }

  // Stone road inside settlement & leading toward south bridge
  for (let x = 9; x <= 23; x++) {
    const y = Math.round(31 - (x - 9) * 0.35);
    if (tiles[y]?.[x] && tiles[y][x].terrain !== 'water' && tiles[y][x].terrain !== 'bridge') {
      tiles[y][x].terrain = 'stone_road';
      if (tiles[y + 1]?.[x] && tiles[y + 1][x].terrain !== 'water') {
        tiles[y + 1][x].terrain = 'stone_road';
      }
    }
  }

  // 4. Orc Encampment Clearing (NE: x 27..38, y 5..16)
  for (let y = 4; y <= 17; y++) {
    for (let x = 26; x <= 38; x++) {
      const t = tiles[y][x];
      if (t.terrain !== 'water') {
        t.terrain = 'orc_dirt';
        t.elevation = 1;
        t.walkable = true;
        t.regionTag = 'orc_camp';
      }
    }
  }

  // Road from North Bridge to Orc Camp
  for (let x = 16; x <= 32; x++) {
    const y = Math.round(14 - (x - 16) * 0.25);
    if (tiles[y]?.[x] && tiles[y][x].terrain !== 'water' && tiles[y][x].terrain !== 'bridge') {
      tiles[y][x].terrain = 'orc_dirt';
    }
  }

  // 5. Ancient Ruins Zones
  const ruinCenters = [
    { cx: 12, cy: 17 },
    { cx: 24, cy: 31 },
    { cx: 23, cy: 10 },
  ];
  for (const rc of ruinCenters) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = rc.cx + dx;
        const ty = rc.cy + dy;
        const t = tiles[ty]?.[tx];
        if (t && t.terrain !== 'water' && t.terrain !== 'bridge') {
          t.terrain = 'ruin_floor';
          t.elevation = 1;
          t.walkable = true;
          t.regionTag = 'ruins';
        }
      }
    }
  }

  // Place Ruin Props & Loot Chests
  const ruinProps: Array<{
    x: number;
    y: number;
    prop: Tile['prop'];
    walkable: boolean;
    chestObjectId?: string;
  }> = [
    { x: 10, y: 15, prop: 'ruin_pillar', walkable: false },
    { x: 14, y: 15, prop: 'ruin_arch', walkable: false },
    { x: 12, y: 17, prop: 'chest', walkable: true, chestObjectId: 'chest_ruin_nw' },

    { x: 22, y: 30, prop: 'ruin_pillar', walkable: false },
    { x: 26, y: 31, prop: 'ruin_arch', walkable: false },
    { x: 24, y: 31, prop: 'chest', walkable: true, chestObjectId: 'chest_ruin_se' },

    { x: 21, y: 9, prop: 'ruin_pillar', walkable: false },
    { x: 25, y: 11, prop: 'ruin_pillar', walkable: false },
    { x: 23, y: 10, prop: 'chest', walkable: true, chestObjectId: 'chest_ruin_ne' },
    { x: 13, y: 26, prop: 'portal', walkable: false },
  ];
  for (const rp of ruinProps) {
    const t = tiles[rp.y][rp.x];
    t.prop = rp.prop;
    t.walkable = rp.walkable;
    if (rp.chestObjectId) {
      t.chestObjectId = rp.chestObjectId;
    }
  }

  // 6. Dense Forests (Wood Nodes) around settlement & western ridge & NE flank
  const forestRects = [
    { x0: 2, y0: 21, x1: 11, y1: 25, density: 0.62 }, // North of settlement
    { x0: 14, y0: 24, x1: 20, y1: 35, density: 0.56 }, // East of settlement (explorable forest!)
    { x0: 2, y0: 33, x1: 7, y1: 39, density: 0.52 },   // South-West edge
    { x0: 5, y0: 5, x1: 15, y1: 12, density: 0.55 },   // NW woods
    { x0: 28, y0: 20, x1: 38, y1: 29, density: 0.52 }, // SE woods
  ];

  for (const fr of forestRects) {
    for (let y = fr.y0; y <= fr.y1; y++) {
      for (let x = fr.x0; x <= fr.x1; x++) {
        const t = tiles[y]?.[x];
        if (!t || t.terrain === 'water' || t.terrain === 'bridge' || t.terrain === 'stone_road' || t.prop) {
          continue;
        }
        const n = hash2d(x, y, 99);
        if (n < fr.density) {
          t.terrain = 'forest_floor';
          t.prop = n < fr.density * 0.6 ? 'tree_pine' : 'tree_oak';
          t.resourceKind = 'wood';
          t.resourceAmount = 140;
          t.maxResource = 140;
          t.walkable = false;
          t.regionTag = 'forest';
        }
      }
    }
  }

  // Clear direct forest path right around settlement entrance
  for (let y = 27; y <= 34; y++) {
    for (let x = 6; x <= 14; x++) {
      const t = tiles[y][x];
      if (t.prop === 'tree_pine' || t.prop === 'tree_oak') {
        t.prop = undefined;
        t.resourceKind = undefined;
        t.resourceAmount = undefined;
        t.walkable = true;
        t.terrain = 'grass';
      }
    }
  }

  // 7. Gold Veins & Stone Quarries (near settlement + mid-map expansion!)
  const goldNodes = [
    { x: 5, y: 29 },
    { x: 5, y: 31 },
    { x: 6, y: 35 },
    { x: 18, y: 22 },
    { x: 26, y: 21 },
  ];
  for (const g of goldNodes) {
    const t = tiles[g.y][g.x];
    t.terrain = 'grass';
    t.prop = 'gold_vein';
    t.resourceKind = 'gold';
    t.resourceAmount = 320;
    t.maxResource = 320;
    t.walkable = false;
  }

  const stoneNodes = [
    { x: 10, y: 36 },
    { x: 12, y: 36 },
    { x: 6, y: 26 },
    { x: 19, y: 34 },
    { x: 29, y: 32 },
  ];
  for (const s of stoneNodes) {
    const t = tiles[s.y][s.x];
    t.terrain = 'grass';
    t.prop = 'stone_quarry';
    t.resourceKind = 'stone';
    t.resourceAmount = 280;
    t.maxResource = 280;
    t.walkable = false;
  }

  // 8. Decorative Craggy Rocks around map borders & hills
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const t = tiles[y][x];
      const onEdge = x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1;
      if (onEdge && t.terrain !== 'water') {
        t.prop = 'rock';
        t.elevation = 2;
        t.walkable = false;
      } else if (
        !t.prop &&
        t.terrain !== 'water' &&
        t.terrain !== 'bridge' &&
        t.terrain !== 'stone_road' &&
        t.regionTag !== 'settlement' &&
        t.regionTag !== 'orc_camp' &&
        hash2d(x, y, 777) > 0.965
      ) {
        t.prop = 'rock';
        t.elevation = 2;
        t.walkable = false;
      }
    }
  }

  // Bindstone beside Town Hall + Campfires & Totems in Orc Camp
  tiles[32][11].prop = 'bindstone';
  tiles[32][11].walkable = false;

  const orcDecor: Array<{ x: number; y: number; prop: Tile['prop']; walkable: boolean }> = [
    { x: 30, y: 11, prop: 'campfire', walkable: false },
    { x: 34, y: 13, prop: 'campfire', walkable: false },
    { x: 28, y: 9, prop: 'orc_totem', walkable: false },
    { x: 35, y: 8, prop: 'orc_totem', walkable: false },
    { x: 32, y: 14, prop: 'orc_totem', walkable: false },
  ];
  for (const od of orcDecor) {
    tiles[od.y][od.x].prop = od.prop;
    tiles[od.y][od.x].walkable = od.walkable;
  }

  // Ensure a few nearby trees right outside settlement edge (x=14..15, y=28..33) so Wood is close!
  const nearbyTrees = [
    { x: 14, y: 28 },
    { x: 14, y: 30 },
    { x: 15, y: 29 },
    { x: 15, y: 32 },
  ];
  for (const nt of nearbyTrees) {
    const t = tiles[nt.y][nt.x];
    t.terrain = 'forest_floor';
    t.prop = 'tree_pine';
    t.resourceKind = 'wood';
    t.resourceAmount = 140;
    t.maxResource = 140;
    t.walkable = false;
  }

  // 9. Buildings
  const buildings: Building[] = [
    createBuilding('b_townhall', 'human', 'town_hall', 8, 30, true),
    createBuilding('b_orc_stronghold', 'orc', 'orc_stronghold', 32, 8, true),
    createBuilding('b_orc_tower_1', 'orc', 'orc_tower', 28, 12, true),
    createBuilding('b_orc_tower_2', 'orc', 'orc_tower', 31, 15, true),
  ];

  // Clear tiles under buildings
  for (const b of buildings) {
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const t = tiles[b.gy + dy]?.[b.gx + dx];
        if (t) {
          t.prop = undefined;
          t.walkable = false;
        }
      }
    }
  }

  // 10. Starting Units
  const units: Unit[] = [
    createUnit('u_hero', 'human', 'hero', 11.2, 29.8, {
      level: 1,
      xp: 0,
      xpToNext: 100,
      cleaveCooldown: 0,
      rallyCooldown: 0,
      deadTimer: 0,
    }),
    createUnit('u_lab_1', 'human', 'laborer', 7.3, 30.8),
    createUnit('u_lab_2', 'human', 'laborer', 10.5, 32.8),
    createUnit('u_sw_1', 'human', 'swordsman', 12.4, 29.2),
    // Forest & Ruin Orc Scouts
    createUnit('e_scout_1', 'orc', 'orc_warrior', 18.2, 27.5, { aiRole: 'patrol' }),
    createUnit('e_scout_2', 'orc', 'orc_archer', 19.0, 28.4, { aiRole: 'patrol' }),
    createUnit('e_ruin_1', 'orc', 'orc_warrior', 13.0, 17.5, { aiRole: 'guard' }),
    createUnit('e_ruin_2', 'orc', 'orc_archer', 11.5, 17.2, { aiRole: 'guard' }),
    createUnit('e_bridge_1', 'orc', 'orc_warrior', 25.0, 26.5, { aiRole: 'guard' }),
    createUnit('e_bridge_2', 'orc', 'orc_warrior', 26.2, 25.2, { aiRole: 'guard' }),
    createUnit('e_ruin_n1', 'orc', 'orc_warrior', 22.8, 11.0, { aiRole: 'guard' }),
    createUnit('e_ruin_n2', 'orc', 'orc_archer', 24.1, 10.5, { aiRole: 'guard' }),
    // Orc Encampment Garrison & Warchief Grimgor
    createUnit('e_camp_1', 'orc', 'orc_warrior', 29.5, 11.5, { aiRole: 'guard' }),
    createUnit('e_camp_2', 'orc', 'orc_warrior', 30.8, 13.0, { aiRole: 'guard' }),
    createUnit('e_camp_3', 'orc', 'orc_archer', 32.5, 12.2, { aiRole: 'guard' }),
    createUnit('e_camp_4', 'orc', 'orc_archer', 29.8, 9.2, { aiRole: 'guard' }),
    createUnit('e_camp_5', 'orc', 'orc_warrior', 33.8, 11.4, { aiRole: 'guard' }),
    createUnit('e_commander', 'orc', 'orc_commander', 31.2, 10.4, { aiRole: 'boss' }),
  ];

  return { tiles, units, buildings };
}
