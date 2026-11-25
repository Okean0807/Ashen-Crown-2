/**
 * ASHEN CROWN — Конфигурация и явное разделение статусов числовых параметров (v14.2).
 *
 * Правило §352.2 и 37_Задание §6:
 * - APPROVED: подтверждено пользователем/спецификацией v14.2; менять запрещено.
 * - DESIGN_TARGET: стартовые гипотезы баланса из v14.2 (§§33, 38–43); настраиваемые, не финальный баланс.
 * - WORKING_ASSUMPTION: обратимые временные заглушки для OPEN/PROPOSED параметров (OD-001..006 и др.).
 */

import type {
  AttributeId,
  CombatMasteryId,
  DarkBranchId,
  MagicSchoolId,
  PlayableRaceId,
  RaceResourceProfile,
} from './types';

export type ParamStatus = 'APPROVED' | 'DESIGN_TARGET' | 'WORKING_ASSUMPTION';

export const SAVE_FORMAT_VERSION = 3;
export const GAME_BUILD_VERSION = '1.0.0-v14.2-core';
export const CONTENT_SCHEMA_VERSION = 'v14.2-core-05';

/**
 * Утверждённые константы (APPROVED / USER APPROVED в v14.2).
 */
export const APPROVED_CONSTANTS = {
  /** §134.8, §331.3: 100 Copper = 1 Silver, 100 Silver = 1 Gold (10 000 Copper = 1 Gold). */
  COPPER_PER_SILVER: 100,
  SILVER_PER_GOLD: 100,
  COPPER_PER_GOLD: 10_000,
  /** §288, §101.5, §329.2: Задержка возрождения Аватара у Stone of Souls — 2 игровые минуты. */
  AVATAR_RESPAWN_DELAY_SECONDS: 120,
  /** §1.2, §41.4: Абсолютная магическая невосприимчивость запрещена. */
  FORBID_ABSOLUTE_MAGIC_IMMUNITY: true,
} as const;

/**
 * Стартовые формульные параметры из v14.2 §§33, 38–41 (DESIGN DECISION / стартовые гипотезы).
 */
export const DESIGN_TARGET_FORMULAS = {
  // §33.1: Базовые шкалы
  BASE_ATTRIBUTE: 10,
  BASE_MASTERY: 0,
  ATTRIBUTE_MIN: 1,
  ATTRIBUTE_MAX: 100,
  MASTERY_MAX: 100,
  SCHOOL_MASTERY_MAX: 100,
  SPELL_RANK_MIN: 1,
  SPELL_RANK_MAX: 5,

  // §33.3: HP_max = 100 + 12*(STA - 10) + 8*(L - 1)
  HP_BASE: 100,
  HP_PER_STA: 12,
  HP_PER_LEVEL: 8,

  // §33.4: Mana_max = 50 + 10*(WIS - 10) + 3*(L - 1); ManaRegen = 0.5 + 0.08*(INT - 10)
  MANA_BASE: 50,
  MANA_PER_WIS: 10,
  MANA_PER_LEVEL: 3,
  MANA_REGEN_BASE: 0.5,
  MANA_REGEN_PER_INT: 0.08,

  // §33.5: Damage_raw = (W + 1.2*(STR - 10)) * (1 + 0.015 * M)
  PHYS_DMG_PER_STR: 1.2,
  MASTERY_DMG_PER_POINT: 0.015,

  // §33.6: HitChance = clamp(5..95, 75 + 0.35 * (DEX - AGI))
  HIT_BASE: 75,
  HIT_COEFF: 0.35,
  HIT_MIN: 5,
  HIT_MAX: 95,

  // §33.7: Armor reduction = 100 / (100 + A)
  ARMOR_SCALE: 100,

  // §33.8: BlockChance = clamp(5..40, 5 + 0.35 * M_shield)
  BLOCK_BASE: 5,
  BLOCK_COEFF: 0.35,
  BLOCK_MIN: 5,
  BLOCK_MAX: 40,

  // §38.3–38.5: Magic SchoolFactor, SpellFactor, AttributeFactor
  SCHOOL_FACTOR_PER_POINT: 0.006, // 0 -> 1.0, 100 -> 1.6
  SPELL_RANK_FACTOR_STEP: 0.1, // 1 -> 1.0, 5 -> 1.4
  ATTR_SCALE_PER_POINT: 0.01,
  ATTR_SCALE_CAP: 0.3,

  // §39.2: SchoolCostFactor = 1 - 0.0025 * SchoolMastery, floor 50%
  SCHOOL_COST_REDUCTION_PER_POINT: 0.0025,
  MANA_COST_MIN_FACTOR: 0.5,

  // §40.1: CastTime = BaseCastTime * (1 - 0.002 * SchoolMastery)
  CAST_TIME_REDUCTION_PER_POINT: 0.002,

  // §41.2: Resistance R in [-1.0, +0.75] (исключает 100% иммунитет)
  RESISTANCE_MIN: -1.0,
  RESISTANCE_MAX: 0.75,

  // §132.3: TradeAdjustment = clamp(0, (NaturalCharisma - 30) / 5, 10)%
  TRADE_CHA_THRESHOLD: 30,
  TRADE_CHA_DIVISOR: 5,
  TRADE_CHA_MAX_PCT: 10,
} as const;

/**
 * Настраиваемая конфигурация для OPEN-параметров (WORKING_ASSUMPTION).
 * Позволяет запускать вертикальный срез без выдавания допущений за канон.
 */
export interface ProvisionalBalanceConfig {
  /** OD-001 (OPEN): доля потери XP текущего уровня при смерти Аватара [0..1]. По умолчанию 0.05 (5%). */
  avatarDeathCurrentLevelXpLossRate: number;
  /** OD-002 (OPEN): временная ёмкость CampaignStorage (в штуках экземпляров). */
  campaignStorageCapacity: number;
  /** OD-003 (OPEN): временный лимит стака массовых предметов (null = не ограничено до решения). */
  maxStackSize: number | null;
  /** OD-004 (PROPOSED): разрешён ли перенос денег через единый кошелёк кампании (по умолчанию false). */
  enableProposedCampaignWallet: boolean;
  /** OD-006 (OPEN): очки за уровень — атрибуты, боевое мастерство и магия по профилю. */
  pointsPerLevel: {
    attributes: number;
    combatMastery: number;
    magicByProfile: {
      warrior: number;
      hybrid: number;
      mage: number;
    };
  };
  /** §27 (OPEN): пороги нормализации специализации [0..1+]. */
  specializationThresholdDelta: number;
  specializationHybridMinFloor: number;
  /** §1.7 (OPEN): шаг снижения XP за повторные убийства одного и того же варианта врага. */
  diminishingXpFloorFactor: number;
  diminishingXpStepPerKill: number;
  /** §43 (OPEN): скорость спада MagicStrain в секунду и пороги нагрузки. */
  magicStrainDecayPerSecond: number;
  magicStrainWarningThreshold: number;
  magicStrainCriticalThreshold: number;
  /** §42.4 (OPEN): окно и множители повторного контроля (diminishing returns). */
  controlDiminishingWindowSec: number;
  controlDiminishingFactors: number[];
  /** §338.10 / §339.1 (OPEN): временные стоимости операций Food (без upkeep). */
  foodPerMilitaryCapStep: number;
  militaryCapStepAmount: number;
  foodPerUnitHeal: number;
  /** §337.3 (OPEN): минимальный резерв маны (%) для автоприменения заклинаний. */
  autoCastMinManaReservePct: number;
  /** §341.7 / §341.15 (OPEN): число ручных слотов и глубина кольцевого буфера автосохранений. */
  manualSaveSlotCount: number;
  autoSaveRingCapacity: number;
  /** §2.1.6 (OPEN): дополнительный вклад изучения/апгрейда заклинания в прогресс уровня школы. */
  spellLearnSchoolProgressStep: number;
  /** §3.1 (OPEN): базовая и минимальная стоимость создания Костяного воина в костях. */
  boneWarriorBaseBonesCost: number;
  boneWarriorMinBonesCost: number;
  /** §317 / §15.8 (OPEN): временный лимит призванных активных героев партии и шаг ремонта зданий. */
  maxActivePartyHeroes: number;
  buildingRepairCostWood: number;
  buildingRepairHpStep: number;
  /** §14.6 (OPEN): стоимость пополнения 1 бойца отряда в поселении (не в бою). */
  squadReplenishUnitWood: number;
  squadReplenishUnitIron: number;
  /** §144.3 / §144.9 (OPEN): временный размер Rune Tablet и скорость открытия ячеек по уровню Аватара. */
  runeTabletBaseSlots: number;
  runeTabletMaxSlots: number;
  runeTabletLevelsPerNewSlot: number;
  /** §144.6 / §144.9 (OPEN): скорость восстановления Rune Power и замедление призыва при её нехватке. */
  runePowerRegenPerSec: number;
  lowRunePowerTimeMultiplier: number;
  /** §144.4 (OPEN): максимальная глубина очереди монумента (базовый + до 7 доп. заказов). */
  maxMonumentQueueLength: number;
  /** §292.6 (OPEN): предел одновременного выделения юнитов (100 в эталоне оригинала). */
  maxUnitSelectionCount: number;
}

export const DEFAULT_WORKING_ASSUMPTIONS: ProvisionalBalanceConfig = {
  avatarDeathCurrentLevelXpLossRate: 0.05, // WORKING_ASSUMPTION (OD-001 OPEN)
  campaignStorageCapacity: 24, // WORKING_ASSUMPTION (OD-002 OPEN)
  maxStackSize: 99, // WORKING_ASSUMPTION (OD-003 OPEN)
  enableProposedCampaignWallet: false, // §331.4: CampaignWallet остаётся PROPOSED
  pointsPerLevel: {
    attributes: 5,
    combatMastery: 2,
    magicByProfile: {
      warrior: 1,
      hybrid: 2,
      mage: 4,
    },
  },
  specializationThresholdDelta: 0.15,
  specializationHybridMinFloor: 0.12,
  diminishingXpFloorFactor: 0.25,
  diminishingXpStepPerKill: 0.08,
  magicStrainDecayPerSecond: 1.5,
  magicStrainWarningThreshold: 50,
  magicStrainCriticalThreshold: 85,
  controlDiminishingWindowSec: 18, // WORKING_ASSUMPTION (§42.4 OPEN)
  controlDiminishingFactors: [1.0, 0.5, 0.25, 0], // WORKING_ASSUMPTION (§42.4 OPEN)
  foodPerMilitaryCapStep: 15, // WORKING_ASSUMPTION (§338.10 OPEN)
  militaryCapStepAmount: 5, // WORKING_ASSUMPTION (§338.10 OPEN)
  foodPerUnitHeal: 2, // WORKING_ASSUMPTION (§338.10 OPEN)
  autoCastMinManaReservePct: 0.2, // WORKING_ASSUMPTION (§337.3 OPEN)
  manualSaveSlotCount: 3, // WORKING_ASSUMPTION (§341.15 OPEN)
  autoSaveRingCapacity: 3, // WORKING_ASSUMPTION (§341.15 OPEN)
  spellLearnSchoolProgressStep: 0.5, // WORKING_ASSUMPTION (§2.1.6 OPEN)
  boneWarriorBaseBonesCost: 5, // WORKING_ASSUMPTION (§3.1 OPEN)
  boneWarriorMinBonesCost: 2, // WORKING_ASSUMPTION (§3.1 OPEN)
  maxActivePartyHeroes: 4, // WORKING_ASSUMPTION (§317 OPEN)
  buildingRepairCostWood: 15, // WORKING_ASSUMPTION (§15.8 OPEN)
  buildingRepairHpStep: 50, // WORKING_ASSUMPTION (§15.8 OPEN)
  squadReplenishUnitWood: 10, // WORKING_ASSUMPTION (§14.6 OPEN)
  squadReplenishUnitIron: 8, // WORKING_ASSUMPTION (§14.6 OPEN)
  runeTabletBaseSlots: 4, // WORKING_ASSUMPTION (§144.9 OPEN)
  runeTabletMaxSlots: 8, // WORKING_ASSUMPTION (§144.9 OPEN)
  runeTabletLevelsPerNewSlot: 2, // WORKING_ASSUMPTION (§144.9 OPEN)
  runePowerRegenPerSec: 2.5, // WORKING_ASSUMPTION (§144.9 OPEN)
  lowRunePowerTimeMultiplier: 2.0, // WORKING_ASSUMPTION (§144.6 OPEN)
  maxMonumentQueueLength: 8, // WORKING_ASSUMPTION (§144.4: 1 + до 7 доп. заказов)
  maxUnitSelectionCount: 100, // WORKING_ASSUMPTION (§292.6: эталон The Order of Dawn)
};

/** 7 утверждённых атрибутов (§1.4, §33.2). */
export const ATTRIBUTE_LABELS: Record<AttributeId, string> = {
  STR: 'Сила (STR)',
  STA: 'Выносливость (STA)',
  DEX: 'Ловкость (DEX)',
  AGI: 'Проворство (AGI)',
  INT: 'Интеллект (INT)',
  WIS: 'Мудрость (WIS)',
  CHA: 'Харизма (CHA)',
};

/** 6 утверждённых направлений боевого мастерства (§1.6, §33.9). */
export const COMBAT_MASTERY_LABELS: Record<CombatMasteryId, string> = {
  one_handed: 'Одноручное оружие',
  two_handed: 'Двуручное оружие',
  polearms: 'Древковое оружие',
  bows: 'Луки',
  crossbows: 'Арбалеты',
  shields: 'Щиты',
};

/**
 * 6 фундаментальных школ магии (§2.1, AC-OWNER-007: строго "Элементальная магия").
 */
export const MAGIC_SCHOOL_LABELS: Record<MagicSchoolId, string> = {
  elemental: 'Элементальная магия',
  dark: 'Тёмная магия',
  life: 'Магия жизни',
  mind: 'Магия разума',
  light: 'Магия света',
  spatial: 'Пространственная магия',
};

/** 6 независимых ветвей Тёмной магии (§3: объединять запрещено). */
export const DARK_BRANCH_LABELS: Record<DarkBranchId, string> = {
  necromancy: 'Некромантия',
  demonology: 'Демонология',
  blood_magic: 'Кровавая магия',
  shadow_magic: 'Магия теней',
  curse_magic: 'Магия проклятий',
  void_magic: 'Магия пустоты',
};

function makeCap(
  resource: 'wood' | 'stone' | 'iron' | 'aria' | 'lenya' | 'moonsilver' | 'food',
  used: boolean,
  gatheredLocally: boolean,
  hasEfficientOwnExtraction: boolean,
  imported: boolean,
  processed: boolean,
  noteRu: string
) {
  return {
    resource,
    used,
    gatheredLocally,
    hasEfficientOwnExtraction,
    imported,
    processed,
    noteRu,
  };
}

/**
 * Матрица 6 игровых народов (строго 6, §§321, 328, 339.2–339.5, 351.2, 352.4).
 * Не добавлять седьмую расу и не выдумывать лорные причины.
 */
export const PLAYABLE_RACES: Record<PlayableRaceId, RaceResourceProfile> = {
  humans: {
    raceId: 'humans',
    nameRu: 'Люди',
    group: 'Light',
    resourcesUsed: ['wood', 'stone', 'iron', 'aria', 'food'],
    ironExtractionNote: 'Собственная стандартная добыча Iron.',
    defaultWorkerRole: 'GeneralWorker',
    resourceCapabilities: {
      wood: makeCap('wood', true, true, true, true, true, 'Лесозаготовка и переработка.'),
      stone: makeCap('stone', true, true, true, true, false, 'Каменоломни.'),
      iron: makeCap('iron', true, true, true, true, true, 'Собственная Iron Mine и плавка.'),
      aria: makeCap('aria', true, true, true, true, false, 'Магический ресурс Людей.'),
      lenya: makeCap('lenya', false, false, false, false, false, 'Не используется Людьми (§339.3).'),
      moonsilver: makeCap('moonsilver', false, false, false, false, false, 'Не используется Людьми (§339.3).'),
      food: makeCap('food', true, true, true, true, true, 'Несколько источников Food: охота, рыболовство, скот, зерно (§339.4).'),
    },
  },
  elves: {
    raceId: 'elves',
    nameRu: 'Эльфы',
    group: 'Light',
    resourcesUsed: ['wood', 'iron', 'lenya', 'food'],
    ironExtractionNote:
      '§352.4: отсутствует собственная эффективная стандартная Iron Mine (добыча/поставка неэффективна, но не абсолютный запрет).',
    defaultWorkerRole: 'GeneralWorker',
    resourceCapabilities: {
      wood: makeCap('wood', true, true, true, true, false, 'Лесоводство и высадка деревьев (§339.4).'),
      stone: makeCap('stone', false, false, false, false, false, 'Не используется Эльфами (§339.3).'),
      iron: makeCap('iron', true, true, false, true, false, '§339.2/§352.4: используется, но нет обычной собственной Iron Mine.'),
      aria: makeCap('aria', false, false, false, false, false, 'Не используется Эльфами (§339.3).'),
      lenya: makeCap('lenya', true, true, true, true, false, 'Собственный сбор Lenya.'),
      moonsilver: makeCap('moonsilver', false, false, false, false, false, 'Не используется Эльфами (§339.3).'),
      food: makeCap('food', true, true, true, true, false, 'Собственная добыча Food (охота/собирательство).'),
    },
  },
  dwarves: {
    raceId: 'dwarves',
    nameRu: 'Гномы',
    group: 'Light',
    resourcesUsed: ['stone', 'iron', 'moonsilver', 'food'],
    ironExtractionNote: 'Собственная добыча Iron и Moonsilver.',
    defaultWorkerRole: 'GeneralWorker',
    resourceCapabilities: {
      wood: makeCap('wood', false, false, false, false, false, 'Не используется Гномами (§339.3).'),
      stone: makeCap('stone', true, true, true, true, false, 'Специализация на добыче камня (§339.4).'),
      iron: makeCap('iron', true, true, true, true, true, 'Эффективная собственная добыча Iron.'),
      aria: makeCap('aria', false, false, false, false, false, 'Не используется Гномами (§339.3).'),
      lenya: makeCap('lenya', false, false, false, false, false, 'Не используется Гномами (§339.3).'),
      moonsilver: makeCap('moonsilver', true, true, true, true, true, 'Собственная добыча Moonsilver.'),
      food: makeCap('food', true, true, true, true, true, 'Производство Food (свинофермы/хозяйство).'),
    },
  },
  orcs: {
    raceId: 'orcs',
    nameRu: 'Орки',
    group: 'Dark',
    resourcesUsed: ['wood', 'iron', 'lenya', 'food'],
    ironExtractionNote: 'Собственная добыча Iron; используют Lenya (не Aria).',
    defaultWorkerRole: 'GeneralWorker',
    resourceCapabilities: {
      wood: makeCap('wood', true, true, true, true, false, 'Собственная добыча Wood.'),
      stone: makeCap('stone', false, false, false, false, false, 'Не используется Орками (§339.3).'),
      iron: makeCap('iron', true, true, true, true, true, 'Собственная добыча Iron.'),
      aria: makeCap('aria', false, false, false, false, false, 'Не используется Орками — не путать с Lenya (§352.4).'),
      lenya: makeCap('lenya', true, true, true, true, false, 'Собственный сбор Lenya (§339.3).'),
      moonsilver: makeCap('moonsilver', false, false, false, false, false, 'Не используется Орками (§339.3).'),
      food: makeCap('food', true, true, true, true, false, 'Собственная добыча Food.'),
    },
  },
  trolls: {
    raceId: 'trolls',
    nameRu: 'Тролли',
    group: 'Dark',
    resourcesUsed: ['wood', 'stone', 'iron', 'food'],
    ironExtractionNote:
      '§352.4: Iron используется в цепочках, при отсутствии собственной стандартной эффективной Iron Mine.',
    defaultWorkerRole: 'GeneralWorker',
    resourceCapabilities: {
      wood: makeCap('wood', true, true, true, true, false, 'Собственная добыча Wood.'),
      stone: makeCap('stone', true, true, true, true, false, 'Собственная добыча Stone.'),
      iron: makeCap('iron', true, true, false, true, false, '§339.2/§352.4: Iron используется, но без стандартной собственной Iron Mine.'),
      aria: makeCap('aria', false, false, false, false, false, 'Не используется Троллями (§339.2).'),
      lenya: makeCap('lenya', false, false, false, false, false, 'Не используется Троллями (§339.3).'),
      moonsilver: makeCap('moonsilver', false, false, false, false, false, 'Не используется Троллями (§339.2).'),
      food: makeCap('food', true, true, true, true, true, 'Включая переработку тел через Corpse Collector (§339.4).'),
    },
  },
  dark_elves: {
    raceId: 'dark_elves',
    nameRu: 'Тёмные эльфы',
    group: 'Dark',
    resourcesUsed: ['stone', 'iron', 'moonsilver', 'aria', 'food'],
    ironExtractionNote: 'Используют Iron, Moonsilver и Aria (не Lenya).',
    defaultWorkerRole: 'SlaveWorker',
    resourceCapabilities: {
      wood: makeCap('wood', false, false, false, false, false, 'Не используется Тёмными эльфами (§339.3).'),
      stone: makeCap('stone', true, true, true, true, false, 'Собственная добыча Stone (SlaveWorker).'),
      iron: makeCap('iron', true, true, true, true, true, 'Собственная добыча Iron.'),
      aria: makeCap('aria', true, true, true, true, false, 'Используют Aria (не Lenya, §352.4).'),
      lenya: makeCap('lenya', false, false, false, false, false, 'Не используется Тёмными эльфами (§352.4).'),
      moonsilver: makeCap('moonsilver', true, true, true, true, true, 'Используют и добывают Moonsilver.'),
      food: makeCap('food', true, true, true, true, true, 'Собственная экономика Food (SlaveWorker, §339.4).'),
    },
  },
};

