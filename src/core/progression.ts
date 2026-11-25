/**
 * ASHEN CROWN — Подсистема прогрессии Аватара, специализации и Гримуара (v14.2 §§1.3–1.16, 2.1, 26–30, 33, 140.4, 337.1).
 */

import { PROTOTYPE_ITEMS, PROTOTYPE_SPELLS } from './catalog';
import {
  DEFAULT_WORKING_ASSUMPTIONS,
  DESIGN_TARGET_FORMULAS,
  type ProvisionalBalanceConfig,
} from './config';
import type {
  AttributeId,
  CampaignState,
  CombatMasteryId,
  DarkBranchId,
  HeroState,
  ItemInstance,
  MagicSchoolId,
  SpecializationProfile,
} from './types';

export interface DerivedHeroStats {
  effectiveAttributes: Record<AttributeId, number>;
  maxHp: number;
  maxMana: number;
  manaRegenPerSec: number;
  armorFromEquipment: number;
  weaponBaseDamage: number;
  hasShield: boolean;
  shieldMastery: number;
}

/**
 * §33.3: HP_max = 100 + 12 * (STA - 10) + 8 * (L - 1)
 */
export function computeMaxHp(effectiveSta: number, level: number): number {
  const { HP_BASE, HP_PER_STA, HP_PER_LEVEL, BASE_ATTRIBUTE } = DESIGN_TARGET_FORMULAS;
  return Math.max(1, Math.round(HP_BASE + HP_PER_STA * (effectiveSta - BASE_ATTRIBUTE) + HP_PER_LEVEL * (level - 1)));
}

/**
 * §33.4: Mana_max = 50 + 10 * (WIS - 10) + 3 * (L - 1)
 */
export function computeMaxMana(effectiveWis: number, level: number): number {
  const { MANA_BASE, MANA_PER_WIS, MANA_PER_LEVEL, BASE_ATTRIBUTE } = DESIGN_TARGET_FORMULAS;
  return Math.max(0, Math.round(MANA_BASE + MANA_PER_WIS * (effectiveWis - BASE_ATTRIBUTE) + MANA_PER_LEVEL * (level - 1)));
}

/**
 * §33.4: ManaRegen = 0.5 + 0.08 * (INT - 10)
 */
export function computeManaRegen(effectiveInt: number): number {
  const { MANA_REGEN_BASE, MANA_REGEN_PER_INT, BASE_ATTRIBUTE } = DESIGN_TARGET_FORMULAS;
  return Math.max(0.1, Number((MANA_REGEN_BASE + MANA_REGEN_PER_INT * (effectiveInt - BASE_ATTRIBUTE)).toFixed(3)));
}

/**
 * Вычисляет производные характеристики с учётом экипировки.
 * ВНИМАНИЕ (§27.5): временные бонусы экипировки НЕ используются при расчёте специализации
 * и НЕ могут удовлетворять требования самой экипировки (§1.5).
 */
export function computeDerivedHeroStats(
  hero: HeroState,
  itemsByInstanceId: Record<string, ItemInstance>
): DerivedHeroStats {
  const effectiveAttributes: Record<AttributeId, number> = { ...hero.baseAttributes };
  let armorFromEquipment = 0;
  let weaponBaseDamage = 10; // кулаки/базовый удар без оружия
  let hasShield = false;

  const slotEntries = Object.entries(hero.equipment) as Array<[string, string | null]>;
  for (const [slot, instanceId] of slotEntries) {
    if (!instanceId) continue;
    const inst = itemsByInstanceId[instanceId];
    if (!inst) continue;
    const def = PROTOTYPE_ITEMS[inst.definitionId];
    if (!def) continue;

    if (def.attributeBonuses) {
      for (const [attr, val] of Object.entries(def.attributeBonuses) as Array<[AttributeId, number]>) {
        effectiveAttributes[attr] += val;
      }
    }
    if (def.armorBonus) armorFromEquipment += def.armorBonus;
    if (slot === 'main_hand' && def.baseWeaponDamage) {
      weaponBaseDamage = def.baseWeaponDamage;
    }
    if (slot === 'off_hand' && def.category === 'shield') {
      hasShield = true;
    }
  }

  return {
    effectiveAttributes,
    maxHp: computeMaxHp(effectiveAttributes.STA, hero.level),
    maxMana: computeMaxMana(effectiveAttributes.WIS, hero.level),
    manaRegenPerSec: computeManaRegen(effectiveAttributes.INT),
    armorFromEquipment,
    weaponBaseDamage,
    hasShield,
    shieldMastery: hero.combatMasteries.shields,
  };
}

/**
 * §27: Расчёт специализации героя строго по ПОСТОЯННЫМ вложениям:
 * - Нераспределённые очки НЕ учитываются (§27.5)
 * - Временные бонусы экипировки/баффов НЕ учитываются (§27.5)
 * - Атрибуты дают умеренный вклад, но не заменяют вложения в дисциплину (§27.2)
 */
export function computeSpecialization(
  hero: HeroState,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { physicalNorm: number; magicalNorm: number; profile: SpecializationProfile } {
  const combatSum = (Object.values(hero.combatMasteries) as number[]).reduce((a, b) => a + b, 0);
  const schoolSum = (Object.values(hero.schoolMasteries) as number[]).reduce((a, b) => a + b, 0);
  const darkBranchSum = (Object.values(hero.darkBranchMasteries) as number[]).reduce((a, b) => a + b, 0);
  const learnedSpellRanks = Object.values(hero.spells)
    .filter((s) => s.acquisitionState === 'Learned')
    .reduce((acc, s) => acc + Math.max(1, s.rank), 0);

  // Нормализованный физический вклад (§27.2–27.3)
  const physAttrDelta = Math.max(0, hero.baseAttributes.STR - 10) + Math.max(0, hero.baseAttributes.DEX - 10) * 0.5;
  const physicalNorm = Number(((combatSum * 0.08) + (physAttrDelta * 0.015)).toFixed(4));

  // Нормализованный магический вклад (§27.2–27.3)
  const magAttrDelta = Math.max(0, hero.baseAttributes.INT - 10) + Math.max(0, hero.baseAttributes.WIS - 10) * 0.6;
  const magicalNorm = Number(
    (((schoolSum + darkBranchSum * 0.5) * 0.07) + (learnedSpellRanks * 0.03) + (magAttrDelta * 0.015)).toFixed(4)
  );

  const delta = physicalNorm - magicalNorm;
  const bothDeveloped =
    physicalNorm >= config.specializationHybridMinFloor &&
    magicalNorm >= config.specializationHybridMinFloor;

  let profile: SpecializationProfile = 'hybrid';
  if (Math.abs(delta) <= config.specializationThresholdDelta) {
    profile = 'hybrid';
  } else if (delta > config.specializationThresholdDelta) {
    profile = bothDeveloped && magicalNorm > physicalNorm * 0.55 ? 'hybrid' : 'warrior';
  } else {
    profile = bothDeveloped && physicalNorm > magicalNorm * 0.55 ? 'hybrid' : 'mage';
  }

  return { physicalNorm, magicalNorm, profile };
}

/**
 * §1.7: Diminishing returns на XP за повторяющиеся убийства одного варианта врага между картами.
 */
export function computeDiminishedXp(
  baseXp: number,
  priorVariantKills: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): number {
  if (baseXp <= 0) return 0;
  const factor = Math.max(
    config.diminishingXpFloorFactor,
    1 - priorVariantKills * config.diminishingXpStepPerKill
  );
  return Math.max(1, Math.round(baseXp * factor));
}

export function xpThresholdForLevel(level: number): number {
  return Math.max(100, level * 150);
}

export interface LevelUpStepRecord {
  newLevel: number;
  profileUsedBeforeGrant: SpecializationProfile;
  grantedAttributePoints: number;
  grantedCombatMasteryPoints: number;
  grantedMagicPoints: number;
}

/**
 * §26.2: Обработка получения XP и многократных повышений уровня строго по шагам:
 * 1. Фиксируется состояние до повышения уровня
 * 2. Считается специализация (без нераспределённых очков!)
 * 3. Начисляются магические очки по зафиксированной специализации
 * 4. Начисляются очки атрибутов и боевого мастерства
 * 5. Полностью восстанавливаются HP и мана (без временной неуязвимости §1.13)
 * 6. Поднимается флаг уведомления пока все 3 пула не будут распределены
 */
export function grantHeroExperience(
  campaign: CampaignState,
  heroId: string,
  rawXp: number,
  enemyVariantId: string | null,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { grantedXp: number; levelUps: LevelUpStepRecord[] } {
  const hero = campaign.heroes[heroId];
  if (!hero) {
    return { grantedXp: 0, levelUps: [] };
  }

  let effectiveXp = rawXp;
  if (enemyVariantId) {
    const prevKills = campaign.killHistoryByVariant[enemyVariantId] ?? 0;
    effectiveXp = computeDiminishedXp(rawXp, prevKills, config);
    campaign.killHistoryByVariant[enemyVariantId] = prevKills + 1;
  }

  hero.xp += effectiveXp;
  const levelUps: LevelUpStepRecord[] = [];

  while (hero.xp >= hero.xpToNext) {
    hero.xp -= hero.xpToNext;
    hero.level += 1;
    hero.xpToNext = xpThresholdForLevel(hero.level);

    // Шаг 2: специализация фиксируется ДО начисления новых магических очков (§26.2)
    const specSnapshot = computeSpecialization(hero, config);
    hero.specialization = specSnapshot.profile;

    const grantedAttributePoints = config.pointsPerLevel.attributes;
    const grantedCombatMasteryPoints = config.pointsPerLevel.combatMastery;
    const grantedMagicPoints = config.pointsPerLevel.magicByProfile[specSnapshot.profile];

    // Шаг 4: независимое пополнение трёх балансов (§26.1)
    hero.unspent.attributePoints += grantedAttributePoints;
    hero.unspent.combatMasteryPoints += grantedCombatMasteryPoints;
    hero.unspent.magicPoints += grantedMagicPoints;

    // Шаг 5: полное восстановление HP и маны при повышении уровня (§1.13 / §26.2)
    const derived = computeDerivedHeroStats(hero, campaign.itemsByInstanceId);
    hero.maxHp = derived.maxHp;
    hero.hp = derived.maxHp;
    hero.maxMana = derived.maxMana;
    hero.mana = derived.maxMana;

    // Шаг 6: иконка/уведомление уровня горит пока хотя бы в одном пуле есть очки
    hero.hasUnspentLevelNotification = true;

    levelUps.push({
      newLevel: hero.level,
      profileUsedBeforeGrant: specSnapshot.profile,
      grantedAttributePoints,
      grantedCombatMasteryPoints,
      grantedMagicPoints,
    });
  }

  return { grantedXp: effectiveXp, levelUps };
}

function refreshUnspentNotification(hero: HeroState) {
  const total =
    hero.unspent.attributePoints +
    hero.unspent.combatMasteryPoints +
    hero.unspent.magicPoints;
  hero.hasUnspentLevelNotification = total > 0;
}

/**
 * §26.2–26.3: Распределение очка атрибута (разрешено в реальном времени, включая бой).
 */
export function allocateAttributePoint(
  campaign: CampaignState,
  heroId: string,
  attribute: AttributeId
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, reason: 'Герой не найден.' };
  if (hero.unspent.attributePoints < 1) {
    return { ok: false, reason: 'Недостаточно очков атрибутов.' };
  }
  if (hero.baseAttributes[attribute] >= DESIGN_TARGET_FORMULAS.ATTRIBUTE_MAX) {
    return { ok: false, reason: 'Достигнут потолок атрибута (100).' };
  }

  hero.unspent.attributePoints -= 1;
  hero.baseAttributes[attribute] += 1;
  hero.investedHistory.attributePointsSpent += 1;

  const derived = computeDerivedHeroStats(hero, campaign.itemsByInstanceId);
  const hpDiff = derived.maxHp - hero.maxHp;
  const manaDiff = derived.maxMana - hero.maxMana;
  hero.maxHp = derived.maxHp;
  hero.maxMana = derived.maxMana;
  if (hpDiff > 0) hero.hp = Math.min(hero.maxHp, hero.hp + hpDiff);
  if (manaDiff > 0) hero.mana = Math.min(hero.maxMana, hero.mana + manaDiff);

  hero.specialization = computeSpecialization(hero).profile;
  refreshUnspentNotification(hero);
  return { ok: true };
}

/**
 * §26.4, §337.1: Повышение одного из 6 боевых мастерств (без конвертации пулов и без 4-й валюты).
 */
export function allocateCombatMasteryPoint(
  campaign: CampaignState,
  heroId: string,
  mastery: CombatMasteryId
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, reason: 'Герой не найден.' };
  if (hero.unspent.combatMasteryPoints < 1) {
    return { ok: false, reason: 'Недостаточно очков боевого мастерства.' };
  }
  if (hero.combatMasteries[mastery] >= DESIGN_TARGET_FORMULAS.MASTERY_MAX) {
    return { ok: false, reason: 'Достигнут максимум мастерства (100).' };
  }

  hero.unspent.combatMasteryPoints -= 1;
  hero.combatMasteries[mastery] += 1;
  hero.investedHistory.combatPointsSpent += 1;
  hero.specialization = computeSpecialization(hero).profile;
  refreshUnspentNotification(hero);
  return { ok: true };
}

/**
 * §2.1, §26.5, §337.1: Повышение общего мастерства школы магии (1 очко магии).
 */
export function allocateMagicSchoolPoint(
  campaign: CampaignState,
  heroId: string,
  school: MagicSchoolId,
  darkBranch?: DarkBranchId
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, reason: 'Герой не найден.' };
  if (hero.unspent.magicPoints < 1) {
    return { ok: false, reason: 'Недостаточно очков магии.' };
  }

  if (school === 'dark') {
    if (!darkBranch) {
      return { ok: false, reason: 'Укажите конкретную независимую ветвь Тёмной магии (§3).' };
    }
    if (hero.darkBranchMasteries[darkBranch] >= DESIGN_TARGET_FORMULAS.SCHOOL_MASTERY_MAX) {
      return { ok: false, reason: 'Достигнут максимум ветви.' };
    }
    hero.darkBranchMasteries[darkBranch] += 1;
    // Общий показатель школы dark отражает максимальную глубину одной из 6 независимых ветвей без их слияния
    hero.schoolMasteries.dark = Math.max(...Object.values(hero.darkBranchMasteries));
  } else {
    if (hero.schoolMasteries[school] >= DESIGN_TARGET_FORMULAS.SCHOOL_MASTERY_MAX) {
      return { ok: false, reason: 'Достигнут максимум школы.' };
    }
    hero.schoolMasteries[school] += 1;
  }

  hero.unspent.magicPoints -= 1;
  hero.investedHistory.magicPointsSpent += 1;

  // Обновляем статус формул с KnownUnavailable -> ReadyToLearn при достижении требуемого уровня школы
  for (const state of Object.values(hero.spells)) {
    const def = PROTOTYPE_SPELLS[state.spellId];
    if (!def) continue;
    if (state.acquisitionState === 'KnownUnavailable' && canMeetSpellRequirements(hero, def.spellId).ok) {
      state.acquisitionState = 'ReadyToLearn';
    }
  }

  hero.specialization = computeSpecialization(hero).profile;
  refreshUnspentNotification(hero);
  return { ok: true };
}

export function canMeetSpellRequirements(
  hero: HeroState,
  spellId: string
): { ok: boolean; reason?: string } {
  const def = PROTOTYPE_SPELLS[spellId];
  if (!def) return { ok: false, reason: 'Заклинание не найдено.' };

  const schoolLevel =
    def.school === 'dark' && def.darkBranch
      ? hero.darkBranchMasteries[def.darkBranch]
      : hero.schoolMasteries[def.school];

  if (schoolLevel < def.requiredSchoolMastery) {
    return {
      ok: false,
      reason: `Требуется мастерство школы/ветви ${def.requiredSchoolMastery} (сейчас ${schoolLevel}).`,
    };
  }
  if (def.minAttributeReq) {
    for (const [attr, req] of Object.entries(def.minAttributeReq) as Array<[AttributeId, number]>) {
      if (hero.baseAttributes[attr] < req) {
        return { ok: false, reason: `Требуется ${attr} >= ${req}.` };
      }
    }
  }
  if (def.prerequisiteSpellIds && def.prerequisiteSpellIds.length > 0) {
    for (const prereqId of def.prerequisiteSpellIds) {
      const preState = hero.spells[prereqId];
      if (!preState || preState.acquisitionState !== 'Learned') {
        const preName = PROTOTYPE_SPELLS[prereqId]?.nameRu ?? prereqId;
        return {
          ok: false,
          reason: `Требуется предварительное изучение заклинания "${preName}" (§2.1.4).`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * §2.1.1, §140.4: Получение знания формулы (свиток / учитель / событие).
 * Переводит из Unknown -> KnownUnavailable или ReadyToLearn.
 */
export function acquireSpellFormula(
  hero: HeroState,
  spellId: string
): { ok: boolean; newState?: HeroState['spells'][string]['acquisitionState']; reason?: string } {
  const def = PROTOTYPE_SPELLS[spellId];
  if (!def) return { ok: false, reason: 'Неизвестная формула заклинания.' };

  const current = hero.spells[spellId] ?? {
    spellId,
    acquisitionState: 'Unknown' as const,
    rank: 0,
  };

  if (current.acquisitionState === 'Learned') {
    return { ok: false, reason: 'Заклинание уже изучено в Гримуаре.' };
  }

  const req = canMeetSpellRequirements(hero, spellId);
  current.acquisitionState = req.ok ? 'ReadyToLearn' : 'KnownUnavailable';
  hero.spells[spellId] = current;
  return { ok: true, newState: current.acquisitionState };
}

/**
 * §2.1.5, §2.1.6, §38.4: Изучение или повышение ранга конкретного заклинания (1 очко магии).
 * Дополнительно продвигает общий прогресс только своей школы (§2.1.6), не затрагивая другие школы (§2.1.3).
 */
export function learnOrUpgradeSpell(
  campaign: CampaignState,
  heroId: string,
  spellId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; schoolLevelGained?: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  const def = PROTOTYPE_SPELLS[spellId];
  if (!hero || !def) return { ok: false, reason: 'Герой или заклинание не найдены.' };
  if (hero.unspent.magicPoints < 1) {
    return { ok: false, reason: 'Недостаточно очков магии.' };
  }

  const state = hero.spells[spellId] ?? { spellId, acquisitionState: 'Unknown' as const, rank: 0 };
  if (state.acquisitionState === 'Unknown') {
    return { ok: false, reason: 'Формула ещё не получена (свиток / учитель).' };
  }

  const req = canMeetSpellRequirements(hero, spellId);
  if (!req.ok) {
    state.acquisitionState = 'KnownUnavailable';
    hero.spells[spellId] = state;
    return { ok: false, reason: req.reason };
  }

  if (state.rank >= def.maxRank) {
    return { ok: false, reason: `Достигнут максимальный ранг (${def.maxRank}).` };
  }

  hero.unspent.magicPoints -= 1;
  hero.investedHistory.magicPointsSpent += 1;
  state.acquisitionState = 'Learned';
  state.rank += 1;
  hero.spells[spellId] = state;

  // §2.1.6: Изучение/апгрейд заклинания даёт дополнительный прогресс общего уровня только этой школы
  let schoolLevelGained = false;
  if (!hero.schoolProgressBySchool) hero.schoolProgressBySchool = {};
  const prevProgress = hero.schoolProgressBySchool[def.school] ?? 0;
  const nextProgress = prevProgress + config.spellLearnSchoolProgressStep;
  if (nextProgress >= 1.0) {
    const whole = Math.floor(nextProgress);
    hero.schoolProgressBySchool[def.school] = Number((nextProgress - whole).toFixed(3));
    if (def.school === 'dark' && def.darkBranch) {
      if (hero.darkBranchMasteries[def.darkBranch] < DESIGN_TARGET_FORMULAS.SCHOOL_MASTERY_MAX) {
        hero.darkBranchMasteries[def.darkBranch] += whole;
        hero.schoolMasteries.dark = Math.max(...Object.values(hero.darkBranchMasteries));
        schoolLevelGained = true;
      }
    } else if (hero.schoolMasteries[def.school] < DESIGN_TARGET_FORMULAS.SCHOOL_MASTERY_MAX) {
      hero.schoolMasteries[def.school] += whole;
      schoolLevelGained = true;
    }
  } else {
    hero.schoolProgressBySchool[def.school] = Number(nextProgress.toFixed(3));
  }

  // Переоценка зависимых узлов после изучения предпосылки (§2.1.4)
  for (const st of Object.values(hero.spells)) {
    if (st.acquisitionState === 'KnownUnavailable' && canMeetSpellRequirements(hero, st.spellId).ok) {
      st.acquisitionState = 'ReadyToLearn';
    }
  }

  hero.specialization = computeSpecialization(hero).profile;
  refreshUnspentNotification(hero);
  return { ok: true, schoolLevelGained };
}

/**
 * §1.12, §26.6, §27.5: Перераспределение очков (respec) разрешено ТОЛЬКО до перехода на следующую карту.
 * Не создаёт и не дублирует очки (§27.5).
 */
export function respecHeroBeforeMapTransition(
  campaign: CampaignState,
  heroId: string
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, reason: 'Герой не найден.' };
  if (!hero.respecWindowOpen) {
    return {
      ok: false,
      reason: 'Окно перераспределения закрыто: respec разрешён только до начала следующей карты (§1.12).',
    };
  }

  const refundedAttr = hero.investedHistory.attributePointsSpent;
  const refundedCombat = hero.investedHistory.combatPointsSpent;
  const refundedMagic = hero.investedHistory.magicPointsSpent;

  hero.baseAttributes = {
    STR: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
    STA: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
    DEX: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
    AGI: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
    INT: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
    WIS: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
    CHA: DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE,
  };
  hero.combatMasteries = {
    one_handed: 0,
    two_handed: 0,
    polearms: 0,
    bows: 0,
    crossbows: 0,
    shields: 0,
  };
  hero.schoolMasteries = {
    elemental: 0,
    dark: 0,
    life: 0,
    mind: 0,
    light: 0,
    spatial: 0,
  };
  hero.darkBranchMasteries = {
    necromancy: 0,
    demonology: 0,
    blood_magic: 0,
    shadow_magic: 0,
    curse_magic: 0,
    void_magic: 0,
  };

  for (const st of Object.values(hero.spells)) {
    if (st.acquisitionState === 'Learned') {
      st.rank = 0;
      const req = canMeetSpellRequirements(hero, st.spellId);
      st.acquisitionState = req.ok ? 'ReadyToLearn' : 'KnownUnavailable';
    }
  }

  hero.unspent.attributePoints += refundedAttr;
  hero.unspent.combatMasteryPoints += refundedCombat;
  hero.unspent.magicPoints += refundedMagic;

  hero.investedHistory = {
    attributePointsSpent: 0,
    combatPointsSpent: 0,
    magicPointsSpent: 0,
  };

  // Сбрасываем экипировку в инвентарь, если требования перестали выполняться (§1.5)
  for (const slot of Object.keys(hero.equipment) as Array<keyof typeof hero.equipment>) {
    const instId = hero.equipment[slot];
    if (!instId) continue;
    const inst = campaign.itemsByInstanceId[instId];
    if (!inst) {
      hero.equipment[slot] = null;
      continue;
    }
    const def = PROTOTYPE_ITEMS[inst.definitionId];
    const reqAttr = def?.requirements?.attributes;
    const reqMast = def?.requirements?.masteries;
    let stillValid = true;
    if (reqAttr) {
      for (const [a, v] of Object.entries(reqAttr) as Array<[AttributeId, number]>) {
        if (hero.baseAttributes[a] < v) stillValid = false;
      }
    }
    if (reqMast) {
      for (const [m, v] of Object.entries(reqMast) as Array<[CombatMasteryId, number]>) {
        if (hero.combatMasteries[m] < v) stillValid = false;
      }
    }
    if (!stillValid) {
      hero.equipment[slot] = null;
      inst.location = { kind: 'party_inventory' };
    }
  }

  const derived = computeDerivedHeroStats(hero, campaign.itemsByInstanceId);
  hero.maxHp = derived.maxHp;
  hero.hp = Math.min(hero.hp, hero.maxHp);
  hero.maxMana = derived.maxMana;
  hero.mana = Math.min(hero.mana, hero.maxMana);
  hero.specialization = computeSpecialization(hero).profile;
  refreshUnspentNotification(hero);

  return { ok: true };
}

/**
 * §317, §331.1, §351.2: Призыв/добавление героя-спутника в активную группу.
 * Спутник делит общий PartyInventory с Аватаром, но обладает собственной индивидуальной экипировкой и очками.
 */
export function summonCompanionHeroToParty(params: {
  campaign: CampaignState;
  heroId: string;
  nameRu: string;
  specialization?: import('./types').SpecializationProfile;
  baseAttrOverride?: Partial<Record<AttributeId, number>>;
  config?: ProvisionalBalanceConfig;
}): { ok: boolean; hero?: HeroState; reason?: string } {
  const { campaign, heroId, nameRu } = params;
  const config = params.config ?? DEFAULT_WORKING_ASSUMPTIONS;

  if (campaign.activePartyHeroIds.includes(heroId)) {
    return { ok: false, reason: `Герой ${heroId} уже состоит в активной группе.` };
  }
  if (campaign.activePartyHeroIds.length >= config.maxActivePartyHeroes) {
    return {
      ok: false,
      reason: `Достигнут временный лимит активной группы (${config.maxActivePartyHeroes}, WORKING_ASSUMPTION §317).`,
    };
  }

  let hero = campaign.heroes[heroId];
  if (!hero) {
    const b = DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE;
    const baseAttributes: Record<AttributeId, number> = {
      STR: params.baseAttrOverride?.STR ?? b,
      STA: params.baseAttrOverride?.STA ?? b,
      DEX: params.baseAttrOverride?.DEX ?? b,
      AGI: params.baseAttrOverride?.AGI ?? b,
      INT: params.baseAttrOverride?.INT ?? b,
      WIS: params.baseAttrOverride?.WIS ?? b,
      CHA: params.baseAttrOverride?.CHA ?? b,
    };
    const maxHp = computeMaxHp(baseAttributes.STA, 1);
    const maxMana = computeMaxMana(baseAttributes.WIS, 1);
    hero = {
      heroId,
      isAvatar: false,
      nameRu,
      level: 1,
      xp: 0,
      xpToNext: xpThresholdForLevel(1),
      hp: maxHp,
      maxHp,
      mana: maxMana,
      maxMana,
      baseAttributes,
      combatMasteries: {
        one_handed: 1,
        two_handed: 0,
        polearms: 0,
        bows: 0,
        crossbows: 0,
        shields: 0,
      },
      schoolMasteries: {
        elemental: 0,
        dark: 0,
        life: 0,
        mind: 0,
        light: 0,
        spatial: 0,
      },
      darkBranchMasteries: {
        necromancy: 0,
        demonology: 0,
        blood_magic: 0,
        shadow_magic: 0,
        curse_magic: 0,
        void_magic: 0,
      },
      spells: {
        spell_life_mend: {
          spellId: 'spell_life_mend',
          acquisitionState: 'Learned',
          rank: 1,
        },
      },
      unspent: {
        attributePoints: 2,
        combatMasteryPoints: 1,
        magicPoints: 1,
      },
      investedHistory: {
        attributePointsSpent: 0,
        combatPointsSpent: 0,
        magicPointsSpent: 0,
      },
      respecWindowOpen: true,
      hasUnspentLevelNotification: true,
      specialization: params.specialization ?? 'hybrid',
      equipment: {
        main_hand: null,
        off_hand: null,
        armor: null,
        helm: null,
        ring_1: null,
        ring_2: null,
        amulet: null,
      },
      magicStrain: {
        index: 0,
        status: 'normal',
      },
      deathState: {
        lifecycle: 'Alive',
        respawnRemainingSec: 0,
        activeStoneOfSoulsId: null,
      },
      resistances: {},
      activeCast: null,
      schoolProgressBySchool: {},
      bonesCount: 0,
    };
    campaign.heroes[heroId] = hero;
  }

  campaign.activePartyHeroIds.push(heroId);
  return { ok: true, hero };
}

export function dismissPartyHero(
  campaign: CampaignState,
  heroId: string
): { ok: boolean; reason?: string } {
  if (heroId === campaign.avatarId) {
    return { ok: false, reason: 'Нельзя исключить главного Аватара из группы.' };
  }
  if (!campaign.activePartyHeroIds.includes(heroId)) {
    return { ok: false, reason: 'Герой не находится в активной группе.' };
  }
  campaign.activePartyHeroIds = campaign.activePartyHeroIds.filter((id) => id !== heroId);
  return { ok: true };
}

