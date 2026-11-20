export type GameScreen = 'TITLE' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'DEFEAT';

export type Faction = 'human' | 'orc';

export type TerrainType =
  | 'grass'
  | 'forest_floor'
  | 'water'
  | 'bridge'
  | 'stone_road'
  | 'ruin_floor'
  | 'orc_dirt';

export type ResourceKind = 'wood' | 'gold' | 'stone';

export type PropKind =
  | 'tree_pine'
  | 'tree_oak'
  | 'rock'
  | 'gold_vein'
  | 'stone_quarry'
  | 'ruin_pillar'
  | 'ruin_arch'
  | 'chest'
  | 'campfire'
  | 'orc_totem'
  | 'bindstone';

export interface Tile {
  gx: number;
  gy: number;
  terrain: TerrainType;
  elevation: number; // 0 = water, 1 = normal, 2 = hill/ruin
  walkable: boolean;
  fog: 0 | 1 | 2; // 0 = unexplored, 1 = explored (shrouded), 2 = visible
  prop?: PropKind;
  resourceKind?: ResourceKind;
  resourceAmount?: number;
  maxResource?: number;
  chestLooted?: boolean;
  regionTag?: 'settlement' | 'forest' | 'river' | 'ruins' | 'orc_camp';
}

export type UnitType =
  | 'hero'
  | 'laborer'
  | 'swordsman'
  | 'archer'
  | 'orc_warrior'
  | 'orc_archer'
  | 'orc_commander';

export type UnitOrderType =
  | 'idle'
  | 'move'
  | 'attack_move'
  | 'attack_unit'
  | 'attack_building'
  | 'gather'
  | 'follow_hero';

export type EquipSlot = 'weapon' | 'armor' | 'relic';

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot | 'consumable';
  rarity: 'common' | 'rare' | 'epic';
  bonusAtk?: number;
  bonusHp?: number;
  bonusArmor?: number;
  healAmount?: number;
  description: string;
}

export type BuildingType =
  | 'town_hall'
  | 'barracks'
  | 'archer_range'
  | 'farm'
  | 'tower'
  | 'orc_stronghold'
  | 'orc_tower';

export interface Unit {
  id: string;
  faction: Faction;
  type: UnitType;
  name: string;
  x: number; // grid float coordinate
  y: number;
  vx: number;
  vy: number;
  facing: number; // -1 left, 1 right
  hp: number;
  maxHp: number;
  baseAtk: number;
  baseArmor: number;
  range: number; // in tiles
  speed: number; // tiles/sec
  atkCooldown: number;
  atkTimer: number;
  isRanged: boolean;
  order: UnitOrderType;
  targetX?: number;
  targetY?: number;
  targetUnitId?: string;
  targetBuildingId?: string;
  gatherGx?: number;
  gatherGy?: number;
  gatherTimer?: number;
  carryingKind?: ResourceKind;
  carryingAmount?: number;
  animTime: number;
  attackAnimTimer: number;
  hitFlashTimer: number;
  // Hero RPG fields
  level?: number;
  xp?: number;
  xpToNext?: number;
  cleaveCooldown?: number;
  rallyCooldown?: number;
  deadTimer?: number; // for Hero bindstone respawn
  aiRole?: 'guard' | 'patrol' | 'raider' | 'boss';
  homeX?: number;
  homeY?: number;
}

export interface TrainingItem {
  unitType: UnitType;
  remaining: number;
  total: number;
}

export interface Building {
  id: string;
  faction: Faction;
  type: BuildingType;
  name: string;
  gx: number; // top-left grid coord
  gy: number;
  size: number; // 2x2 or 1x1
  hp: number;
  maxHp: number;
  constructed: boolean;
  buildProgress: number; // 0..1
  buildTime: number; // seconds
  queue: TrainingItem[];
  attackTimer: number;
  hitFlashTimer: number;
}

export interface Projectile {
  id: string;
  faction: Faction;
  x: number;
  y: number;
  z: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetUnitId?: string;
  targetBuildingId?: string;
  damage: number;
  progress: number;
  duration: number;
  kind: 'arrow' | 'bolt' | 'orc_arrow';
}

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'spark' | 'blood' | 'wood' | 'gold' | 'smoke' | 'magic' | 'ring';
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface Resources {
  gold: number;
  wood: number;
  stone: number;
}

export interface ObjectiveState {
  id: string;
  title: string;
  completed: boolean;
  progressText: string;
}

export interface ScenarioStats {
  elapsedSec: number;
  exploredCount: number;
  gatheredWood: number;
  gatheredGold: number;
  gatheredStone: number;
  barracksBuilt: boolean;
  swordsmenRecruited: number;
  orcCampDiscovered: boolean;
  commanderDefeated: boolean;
  orcsSlain: number;
  buildingsConstructed: number;
  nextRaidTimer: number;
  raidCount: number;
}

export type MobileActionMode = 'smart' | 'move' | 'attack' | 'select_box';

export interface HudSnapshot {
  screen: GameScreen;
  resources: Resources;
  popUsed: number;
  popCap: number;
  selectedUnitIds: string[];
  selectedUnits: Unit[];
  selectedBuilding: Building | null;
  hero: Unit | null;
  equipment: Record<EquipSlot, ItemDef | null>;
  inventory: ItemDef[];
  objectives: ObjectiveState[];
  stats: ScenarioStats;
  buildMode: BuildingType | null;
  mobileMode: MobileActionMode;
  muted: boolean;
  cameraZoom: number;
  bannerMessage: string | null;
  hasSavedGame: boolean;
}

export interface BuildingBlueprint {
  type: BuildingType;
  name: string;
  size: number;
  cost: Resources;
  maxHp: number;
  buildTime: number;
  description: string;
  trains?: UnitType[];
  popBonus?: number;
}

export interface UnitBlueprint {
  type: UnitType;
  name: string;
  cost: Resources;
  trainTime: number;
  maxHp: number;
  atk: number;
  armor: number;
  range: number;
  speed: number;
  atkCooldown: number;
  isRanged: boolean;
  description: string;
}

export const BUILDING_BLUEPRINTS: Record<string, BuildingBlueprint> = {
  town_hall: {
    type: 'town_hall',
    name: 'Town Hall',
    size: 2,
    cost: { gold: 0, wood: 0, stone: 0 },
    maxHp: 900,
    buildTime: 10,
    description: 'Central keep. Trains Laborers & houses the Bindstone.',
    trains: ['laborer'],
    popBonus: 10,
  },
  barracks: {
    type: 'barracks',
    name: 'Barracks',
    size: 2,
    cost: { gold: 40, wood: 90, stone: 40 },
    maxHp: 560,
    buildTime: 8,
    description: 'Recruits armored Swordsmen for frontline combat.',
    trains: ['swordsman'],
  },
  archer_range: {
    type: 'archer_range',
    name: 'Archer Range',
    size: 2,
    cost: { gold: 40, wood: 85, stone: 20 },
    maxHp: 440,
    buildTime: 7,
    description: 'Trains hooded Archers with long-range bows.',
    trains: ['archer'],
  },
  farm: {
    type: 'farm',
    name: 'Farmstead',
    size: 2,
    cost: { gold: 20, wood: 55, stone: 0 },
    maxHp: 320,
    buildTime: 5,
    description: 'Increases maximum army population by +6.',
    popBonus: 6,
  },
  tower: {
    type: 'tower',
    name: 'Watchtower',
    size: 1,
    cost: { gold: 30, wood: 50, stone: 70 },
    maxHp: 480,
    buildTime: 6,
    description: 'Automated stone tower firing bolts at nearby Orcs.',
  },
};

export const UNIT_BLUEPRINTS: Record<UnitType, UnitBlueprint> = {
  hero: {
    type: 'hero',
    name: 'Aldric, Ashen Knight',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 0,
    maxHp: 340,
    atk: 26,
    armor: 5,
    range: 1.45,
    speed: 3.7,
    atkCooldown: 0.95,
    isRanged: false,
    description: 'Heroic commander. Gains XP, equips gear, and cleaves foes.',
  },
  laborer: {
    type: 'laborer',
    name: 'Laborer',
    cost: { gold: 40, wood: 0, stone: 0 },
    trainTime: 4,
    maxHp: 90,
    atk: 6,
    armor: 0,
    range: 1.2,
    speed: 3.1,
    atkCooldown: 1.3,
    isRanged: false,
    description: 'Gathers Wood, Gold & Stone and assists construction.',
  },
  swordsman: {
    type: 'swordsman',
    name: 'Swordsman',
    cost: { gold: 55, wood: 20, stone: 0 },
    trainTime: 5,
    maxHp: 175,
    atk: 17,
    armor: 3,
    range: 1.3,
    speed: 3.25,
    atkCooldown: 1.05,
    isRanged: false,
    description: 'Stalwart steel-clad infantry with broadsword and shield.',
  },
  archer: {
    type: 'archer',
    name: 'Archer',
    cost: { gold: 50, wood: 35, stone: 0 },
    trainTime: 5,
    maxHp: 105,
    atk: 15,
    armor: 1,
    range: 5.8,
    speed: 3.4,
    atkCooldown: 1.25,
    isRanged: true,
    description: 'Longbow marksman supporting the line from afar.',
  },
  orc_warrior: {
    type: 'orc_warrior',
    name: 'Orc Warrior',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 6,
    maxHp: 150,
    atk: 15,
    armor: 2,
    range: 1.3,
    speed: 2.95,
    atkCooldown: 1.15,
    isRanged: false,
    description: 'Ferocious iron-jawed brute wielding a heavy cleaver.',
  },
  orc_archer: {
    type: 'orc_archer',
    name: 'Orc Skirmisher',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 6,
    maxHp: 95,
    atk: 12,
    armor: 0,
    range: 5.2,
    speed: 3.1,
    atkCooldown: 1.35,
    isRanged: true,
    description: 'Cunning bone-bow archer of the Orc warband.',
  },
  orc_commander: {
    type: 'orc_commander',
    name: 'Warchief Grimgor',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 0,
    maxHp: 620,
    atk: 32,
    armor: 6,
    range: 1.6,
    speed: 2.8,
    atkCooldown: 1.1,
    isRanged: false,
    description: 'Ruthless commander of the Orc encampment.',
  },
};

export const ITEM_CATALOG: Record<string, ItemDef> = {
  iron_blade: {
    id: 'iron_blade',
    name: 'Knight’s Broadsword',
    slot: 'weapon',
    rarity: 'common',
    bonusAtk: 5,
    description: '+5 Attack Damage',
  },
  leather_hauberk: {
    id: 'leather_hauberk',
    name: 'Ashen Brigandine',
    slot: 'armor',
    rarity: 'common',
    bonusHp: 40,
    bonusArmor: 2,
    description: '+40 Max HP, +2 Armor',
  },
  runed_claymore: {
    id: 'runed_claymore',
    name: 'Runed Claymore',
    slot: 'weapon',
    rarity: 'rare',
    bonusAtk: 14,
    description: '+14 Attack Damage',
  },
  crown_plate: {
    id: 'crown_plate',
    name: 'Royal Bastion Plate',
    slot: 'armor',
    rarity: 'epic',
    bonusHp: 110,
    bonusArmor: 5,
    description: '+110 Max HP, +5 Armor',
  },
  ember_signet: {
    id: 'ember_signet',
    name: 'Ember Crown Signet',
    slot: 'relic',
    rarity: 'rare',
    bonusAtk: 7,
    bonusHp: 45,
    description: '+7 Attack, +45 Max HP',
  },
  ward_talisman: {
    id: 'ward_talisman',
    name: 'Oakhaven Ward',
    slot: 'relic',
    rarity: 'common',
    bonusArmor: 3,
    bonusHp: 35,
    description: '+3 Armor, +35 Max HP',
  },
  healing_draught: {
    id: 'healing_draught',
    name: 'Crimson Draught',
    slot: 'consumable',
    rarity: 'common',
    healAmount: 140,
    description: 'Restores 140 HP to Aldric immediately.',
  },
};
