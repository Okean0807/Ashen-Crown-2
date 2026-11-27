export type GameScreen = 'TITLE' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'DEFEAT';

import type { DamageType, EquipSlotId, FormationType, ItemCategory } from '../core/types';

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
  | 'bindstone'
  | 'portal';

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
  chestObjectId?: string;
  regionTag?: 'settlement' | 'forest' | 'river' | 'ruins' | 'orc_camp';
}

export type UnitType =
  | 'hero'
  | 'laborer'
  | 'swordsman'
  | 'archer'
  | 'skeleton_minion'
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
  | 'follow_hero'
  | 'patrol'
  | 'interact';

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
  waypoints?: Array<{ x: number; y: number }>;
  patrolLoop?: boolean;
  gatherGx?: number;
  gatherGy?: number;
  gatherTimer?: number;
  interactGx?: number;
  interactGy?: number;
  interactKind?: 'chest' | 'bindstone' | 'portal';
  carryingKind?: ResourceKind;
  carryingAmount?: number;
  animTime: number;
  attackAnimTimer: number;
  castAnimTimer?: number;
  hitFlashTimer: number;
  // Hero RPG & v14.2 fields
  level?: number;
  xp?: number;
  xpToNext?: number;
  mana?: number;
  maxMana?: number;
  cleaveCooldown?: number;
  rallyCooldown?: number;
  deadTimer?: number; // for Hero Stone of Souls respawn (§288: 120s)
  minionId?: string; // linked to MapInstanceState.necromancyMinions (§105/§107)
  dormant?: boolean;
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
  attackerId?: string;
  attackerName?: string;
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
  damageType?: DamageType;
  progress: number;
  duration: number;
  kind: 'arrow' | 'bolt' | 'orc_arrow' | 'fireball' | 'necrotic_orb';
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
  kind: 'spark' | 'blood' | 'wood' | 'gold' | 'smoke' | 'magic' | 'ring' | 'rune_pillar';
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

export interface ActiveLootWindowState {
  objectId: string;
  tileGx: number;
  tileGy: number;
  titleRu: string;
  entries: Array<{
    entryId: string;
    kind: 'copper' | 'item';
    labelRu: string;
    amount: number;
    taken: boolean;
  }>;
}

export interface CoreEquippedSlotView {
  slot: EquipSlotId;
  labelRu: string;
  group: 'weapon' | 'armor' | 'relic';
  instanceId: string | null;
  definitionId: string | null;
  nameRu: string | null;
  bonusesRu: string;
  category: ItemCategory | null;
  rarity: 'common' | 'rare' | 'epic';
}

export interface CoreInventoryItemView {
  instanceId: string;
  definitionId: string;
  nameRu: string;
  category: ItemCategory;
  group: 'weapon' | 'armor' | 'relic' | 'scroll' | 'special';
  quantity: number;
  targetSlot: EquipSlotId | null;
  canEquip: boolean;
  unmetReasonsRu: string[];
  isScroll: boolean;
  isQuestProtected: boolean;
  bonusesRu: string;
  rarity: 'common' | 'rare' | 'epic';
}

export interface CombatLogEntry {
  id: number;
  text: string;
  kind: 'hit' | 'miss' | 'block' | 'spell' | 'heal' | 'kill' | 'system';
}

export interface HudV14CoreSummary {
  buildVersion: string;
  heroMana: number;
  heroMaxMana: number;
  manaRegenPerSec: number;
  magicStrainIndex: number;
  magicStrainStatus: 'normal' | 'elevated' | 'critical';
  specializationRu: string;
  unspentTotal: number;
  currencyTextRu: string;
  settlementIron: number;
  settlementFood: number;
  settlementRunePower: number;
  activeMinionsCount: number;
  dormantMinionsCount: number;
  residualAutonomyPool: number;
  canUseFormation: boolean;
  formationReasonRu?: string;
  activeFormation: FormationType;
  controlGroupCounts: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  spells: Array<{
    spellId: string;
    nameRu: string;
    hotkey: string;
    manaCost: number;
    learned: boolean;
    canCast: boolean;
    school: string;
  }>;
  activeLootWindow: ActiveLootWindowState | null;
  avatarRespawnSec: number;
  rendererMode: 'webgl3d' | 'canvas2d';
  coreEquipment: CoreEquippedSlotView[];
  corePartyInventory: CoreInventoryItemView[];
  combatLog: CombatLogEntry[];
  inCombat: boolean;
  bindstoneActive: boolean;
  hasManualSave: boolean;
  hasAutoSave: boolean;
}

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
  v14Core?: HudV14CoreSummary;
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
    name: 'Ратуша',
    size: 2,
    cost: { gold: 0, wood: 0, stone: 0 },
    maxHp: 900,
    buildTime: 10,
    description: 'Центр поселения. Обучает рабочих и хранит Камень Душ.',
    trains: ['laborer'],
    popBonus: 10,
  },
  barracks: {
    type: 'barracks',
    name: 'Казармы',
    size: 2,
    cost: { gold: 40, wood: 90, stone: 40 },
    maxHp: 560,
    buildTime: 8,
    description: 'Готовит бронированных мечников для ближнего боя.',
    trains: ['swordsman'],
  },
  archer_range: {
    type: 'archer_range',
    name: 'Стрельбище',
    size: 2,
    cost: { gold: 40, wood: 85, stone: 20 },
    maxHp: 440,
    buildTime: 7,
    description: 'Обучает метких лучников для поддержки с дистанции.',
    trains: ['archer'],
  },
  farm: {
    type: 'farm',
    name: 'Ферма',
    size: 2,
    cost: { gold: 20, wood: 55, stone: 0 },
    maxHp: 320,
    buildTime: 5,
    description: 'Увеличивает максимальный предел отряда на +6.',
    popBonus: 6,
  },
  tower: {
    type: 'tower',
    name: 'Дозорная башня',
    size: 1,
    cost: { gold: 30, wood: 50, stone: 70 },
    maxHp: 480,
    buildTime: 6,
    description: 'Укреплённая каменная башня, обстреливающая ближайших врагов.',
  },
};

export const UNIT_BLUEPRINTS: Record<UnitType, UnitBlueprint> = {
  hero: {
    type: 'hero',
    name: 'Аватар',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 0,
    maxHp: 340,
    atk: 26,
    armor: 5,
    range: 1.45,
    speed: 3.7,
    atkCooldown: 0.95,
    isRanged: false,
    description: 'Предводитель отряда. Получает опыт, носит снаряжение и владеет магией.',
  },
  laborer: {
    type: 'laborer',
    name: 'Рабочий',
    cost: { gold: 40, wood: 0, stone: 0 },
    trainTime: 4,
    maxHp: 90,
    atk: 6,
    armor: 0,
    range: 1.2,
    speed: 3.1,
    atkCooldown: 1.3,
    isRanged: false,
    description: 'Добывает древесину, руду и камень, возводит постройки поселения.',
  },
  swordsman: {
    type: 'swordsman',
    name: 'Мечник',
    cost: { gold: 55, wood: 20, stone: 0 },
    trainTime: 5,
    maxHp: 175,
    atk: 17,
    armor: 3,
    range: 1.3,
    speed: 3.25,
    atkCooldown: 1.05,
    isRanged: false,
    description: 'Стойкий пехотинец в стальных латах с мечом и щитом.',
  },
  archer: {
    type: 'archer',
    name: 'Лучник',
    cost: { gold: 50, wood: 35, stone: 0 },
    trainTime: 5,
    maxHp: 105,
    atk: 15,
    armor: 1,
    range: 5.8,
    speed: 3.4,
    atkCooldown: 1.25,
    isRanged: true,
    description: 'Дальнобойный стрелок, прикрывающий строй с расстояния.',
  },
  skeleton_minion: {
    type: 'skeleton_minion',
    name: 'Скелет-воин',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 0,
    maxHp: 120,
    atk: 14,
    armor: 2,
    range: 1.35,
    speed: 3.15,
    atkCooldown: 1.15,
    isRanged: false,
    description: 'Призванный некромантией воин. Поддерживается маной Аватара.',
  },
  orc_warrior: {
    type: 'orc_warrior',
    name: 'Воин врага',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 6,
    maxHp: 150,
    atk: 15,
    armor: 2,
    range: 1.3,
    speed: 2.95,
    atkCooldown: 1.15,
    isRanged: false,
    description: 'Свирепый боец передовой с тяжёлой секирой.',
  },
  orc_archer: {
    type: 'orc_archer',
    name: 'Стрелок врага',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 6,
    maxHp: 95,
    atk: 12,
    armor: 0,
    range: 5.2,
    speed: 3.1,
    atkCooldown: 1.35,
    isRanged: true,
    description: 'Меткий застрельщик вражеского гарнизона с костяным луком.',
  },
  orc_commander: {
    type: 'orc_commander',
    name: 'Командир врага',
    cost: { gold: 0, wood: 0, stone: 0 },
    trainTime: 0,
    maxHp: 620,
    atk: 32,
    armor: 6,
    range: 1.6,
    speed: 2.8,
    atkCooldown: 1.1,
    isRanged: false,
    description: 'Закалённый предводитель вражеской крепости.',
  },
};

export const ITEM_CATALOG: Record<string, ItemDef> = {
  iron_blade: {
    id: 'iron_blade',
    name: 'Рыцарский меч',
    slot: 'weapon',
    rarity: 'common',
    bonusAtk: 5,
    description: '+5 к атаке',
  },
  leather_hauberk: {
    id: 'leather_hauberk',
    name: 'Пепельная бригантина',
    slot: 'armor',
    rarity: 'common',
    bonusHp: 40,
    bonusArmor: 2,
    description: '+40 макс. здоровья, +2 к броне',
  },
  runed_claymore: {
    id: 'runed_claymore',
    name: 'Рунный клеймор',
    slot: 'weapon',
    rarity: 'rare',
    bonusAtk: 14,
    description: '+14 к атаке',
  },
  crown_plate: {
    id: 'crown_plate',
    name: 'Королевские латы бастиона',
    slot: 'armor',
    rarity: 'epic',
    bonusHp: 110,
    bonusArmor: 5,
    description: '+110 макс. здоровья, +5 к броне',
  },
  ember_signet: {
    id: 'ember_signet',
    name: 'Печатка тлеющей короны',
    slot: 'relic',
    rarity: 'rare',
    bonusAtk: 7,
    bonusHp: 45,
    description: '+7 к атаке, +45 макс. здоровья',
  },
  ward_talisman: {
    id: 'ward_talisman',
    name: 'Талисман стража',
    slot: 'relic',
    rarity: 'common',
    bonusArmor: 3,
    bonusHp: 35,
    description: '+3 к броне, +35 макс. здоровья',
  },
  healing_draught: {
    id: 'healing_draught',
    name: 'Багровый эликсир',
    slot: 'consumable',
    rarity: 'common',
    healAmount: 140,
    description: 'Боевые зелья не применяются в бою',
  },
};
