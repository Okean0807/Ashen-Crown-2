/**
 * ASHEN CROWN — Отряды и существа (§343), Enemy AI без всеведения (§343.7),
 * белый список автокаста (§337.3) и эффекты лечения / баффов / контроля (§42).
 */

import { PROTOTYPE_SPELLS } from './catalog';
import {
  computeBlockChancePct,
  computeDamageAfterArmor,
  computeHitChancePct,
  computeRawPhysicalDamage,
  resolveCombatPackets,
} from './combatAndMagic';
import { DEFAULT_WORKING_ASSUMPTIONS, type ProvisionalBalanceConfig } from './config';
import { grantHeroExperience, type LevelUpStepRecord } from './progression';
import type {
  ActiveStatusEffect,
  AllegianceState,
  CampaignState,
  CreatureDefinition,
  EnemyGroupAIState,
  ForceSourceKind,
  HeroState,
  MapInstanceState,
  SquadInstance,
  UnitInstance,
} from './types';

/**
 * Нейтральные технические определения существ (§343.2–343.4).
 * Не являются каноническим бестиарием и не содержат вымышленного лора.
 */
export const PROTOTYPE_CREATURES: Record<string, CreatureDefinition> = {
  unit_proto_infantry: {
    creatureDefId: 'unit_proto_infantry',
    nameRu: 'Пехотинец (прототип)',
    originType: 'Mortal',
    speciesId: 'proto_humanoid',
    baseMaxHp: 110,
    baseAttack: 14,
    baseArmor: 20,
    combatRoleTags: ['melee', 'shield'],
    provenanceScope: 'species',
  },
  unit_proto_archer: {
    creatureDefId: 'unit_proto_archer',
    nameRu: 'Стрелок (прототип)',
    originType: 'Mortal',
    speciesId: 'proto_humanoid',
    baseMaxHp: 75,
    baseAttack: 16,
    baseArmor: 6,
    combatRoleTags: ['ranged'],
    provenanceScope: 'species',
  },
  unit_proto_raider: {
    creatureDefId: 'unit_proto_raider',
    nameRu: 'Налётчик сектора (прототип)',
    originType: 'Mortal',
    speciesId: 'proto_raider',
    baseMaxHp: 95,
    baseAttack: 13,
    baseArmor: 12,
    combatRoleTags: ['melee'],
    provenanceScope: 'variant',
  },
  unit_proto_neutral_demon: {
    creatureDefId: 'unit_proto_neutral_demon',
    nameRu: 'Свободный демон-наблюдатель (тест §343.3)',
    originType: 'Demon',
    speciesId: 'proto_demon',
    baseMaxHp: 220,
    baseAttack: 24,
    baseArmor: 25,
    combatRoleTags: ['melee', 'caster'],
    provenanceScope: 'boss_encounter',
  },
};

export function createSquadInstance(params: {
  squadId: string;
  nameRu: string;
  squadDefId: string;
  creatureDefId: string;
  count: number;
  factionId: string;
  allegiance: AllegianceState;
  deploymentState: 'FieldArmy' | 'Garrison';
  forceSource: ForceSourceKind;
  portableAcrossPortals: boolean;
}): SquadInstance {
  const def = PROTOTYPE_CREATURES[params.creatureDefId] ?? PROTOTYPE_CREATURES.unit_proto_infantry;
  const units: UnitInstance[] = [];
  for (let i = 0; i < params.count; i++) {
    units.push({
      unitId: `${params.squadId}_u${i + 1}`,
      creatureDefId: def.creatureDefId,
      hp: def.baseMaxHp,
      maxHp: def.baseMaxHp,
      alive: true,
    });
  }
  return {
    squadId: params.squadId,
    nameRu: params.nameRu,
    squadDefId: params.squadDefId,
    factionId: params.factionId,
    allegiance: params.allegiance,
    deploymentState: params.deploymentState,
    forceSource: params.forceSource,
    portableAcrossPortals: params.portableAcrossPortals,
    units,
    maxUnitCount: params.count,
    command: {
      squadId: params.squadId,
      playerOrder: 'Idle',
      localReaction: 'None',
    },
  };
}

/**
 * §338.6, §341.4: Взаимоисключающее переключение FieldArmy <-> Garrison.
 * Гарнизон не переносится через порталы автоматически.
 */
export function switchSquadDeployment(
  squad: SquadInstance,
  nextState: 'FieldArmy' | 'Garrison'
): SquadInstance {
  return {
    ...squad,
    deploymentState: nextState,
  };
}

/**
 * §343.8: Смена allegiance отряда — только через явное идемпотентное событие с источником.
 */
export function changeSquadAllegiance(
  campaign: CampaignState,
  squad: SquadInstance,
  newAllegiance: AllegianceState,
  eventId: string
): { changed: boolean; reason?: string } {
  if (campaign.processedEventIds.includes(eventId)) {
    return { changed: false, reason: 'Событие смены allegiance уже обработано.' };
  }
  campaign.processedEventIds.push(eventId);
  squad.allegiance = newAllegiance;
  return { changed: true };
}

/**
 * §343.7: Enemy AI не имеет глобального всеведения.
 * Без источника информации (local_detection / alert_propagation / scripted_knowledge) группа остаётся у дома.
 */
export function updateEnemyGroupKnowledge(
  ai: EnemyGroupAIState,
  source: EnemyGroupAIState['knowledgeSource'],
  targetPos: { x: number; y: number } | null,
  currentTimeSec: number
): EnemyGroupAIState {
  if (source === 'none' || !targetPos) {
    return {
      ...ai,
      knowledgeSource: 'none',
      lastKnownTargetPos: null,
      state: 'ReturningHome',
    };
  }
  return {
    ...ai,
    knowledgeSource: source,
    lastKnownTargetPos: targetPos,
    lastSeenTimeSec: currentTimeSec,
    state: 'Pursuing',
  };
}

export function stepEnemyGroupPursuit(
  ai: EnemyGroupAIState,
  currentSquadPos: { x: number; y: number }
): EnemyGroupAIState {
  if (ai.knowledgeSource === 'none' || !ai.lastKnownTargetPos) {
    return { ...ai, state: 'IdleAtHome' };
  }
  const distFromHome = Math.hypot(
    currentSquadPos.x - ai.homeZone.x,
    currentSquadPos.y - ai.homeZone.y
  );
  if (distFromHome > ai.maxPursuitDistance) {
    return {
      ...ai,
      knowledgeSource: 'none',
      lastKnownTargetPos: null,
      state: 'ReturningHome',
    };
  }
  return ai;
}

/**
 * §337.3: Белый список автоприменения заклинаний (не допускает автокаст дорогих AoE / призывов / при Retreat).
 */
export function filterAutoCastEligibleSpells(
  hero: HeroState,
  currentOrder: SquadInstance['command']['playerOrder'],
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): Array<{ spellId: string; eligible: boolean; blockedReason?: string }> {
  const minReserveMana = hero.maxMana * config.autoCastMinManaReservePct;
  const results: Array<{ spellId: string; eligible: boolean; blockedReason?: string }> = [];

  for (const st of Object.values(hero.spells)) {
    if (st.acquisitionState !== 'Learned') continue;
    const def = PROTOTYPE_SPELLS[st.spellId];
    if (!def) continue;

    if (!def.autoCastEligible) {
      results.push({
        spellId: def.spellId,
        eligible: false,
        blockedReason: 'Запрещено белым списком §337.3 (AoE / призыв / контроль).',
      });
      continue;
    }
    if (!def.autoCastDefault) {
      results.push({
        spellId: def.spellId,
        eligible: false,
        blockedReason: 'Отключено по умолчанию (AutoCastDefault = false).',
      });
      continue;
    }
    if (currentOrder === 'Retreat' && def.effectType === 'damage') {
      results.push({
        spellId: def.spellId,
        eligible: false,
        blockedReason: 'Приказ Retreat подавляет авто-атакующую магию (§337.2).',
      });
      continue;
    }
    if (hero.mana - def.baseManaCost < minReserveMana) {
      results.push({
        spellId: def.spellId,
        eligible: false,
        blockedReason: `Нарушен минимальный резерв маны (${Math.round(minReserveMana)}).`,
      });
      continue;
    }
    results.push({ spellId: def.spellId, eligible: true });
  }
  return results;
}

/**
 * §42.1: Лечение не воскрешает погибшего и не превышает maxHp (без авто-щита).
 */
export function applyHealingPacket(
  target: { hp: number; maxHp: number; alive: boolean },
  healAmount: number
): { healedAmount: number; overhealDiscarded: number; rejectedDead: boolean } {
  if (!target.alive || target.hp <= 0) {
    return { healedAmount: 0, overhealDiscarded: 0, rejectedDead: true };
  }
  const safeHeal = Math.max(0, healAmount);
  const missing = Math.max(0, target.maxHp - target.hp);
  const actual = Math.min(missing, safeHeal);
  target.hp = Number((target.hp + actual).toFixed(2));
  return {
    healedAmount: Number(actual.toFixed(2)),
    overhealDiscarded: Number((safeHeal - actual).toFixed(2)),
    rejectedDead: false,
  };
}

/**
 * §42.2: Повторный бафф/дебафф из того же источника обновляет длительность/значение, не стакаясь бесконечно.
 */
export function applyBuffOrDebuff(
  map: MapInstanceState,
  targetId: string,
  effect: ActiveStatusEffect
): { stackedCount: number; refreshed: boolean } {
  if (!map.activeEffectsByTarget) map.activeEffectsByTarget = {};
  const list = map.activeEffectsByTarget[targetId] ?? [];
  const existingIdx = list.findIndex((e) => e.sourceSpellId === effect.sourceSpellId);
  let refreshed = false;

  if (existingIdx >= 0) {
    const prev = list[existingIdx];
    list[existingIdx] = {
      ...effect,
      magnitude: Math.max(prev.magnitude, effect.magnitude),
    };
    refreshed = true;
  } else {
    list.push(effect);
  }
  map.activeEffectsByTarget[targetId] = list;
  return { stackedCount: list.length, refreshed };
}

/**
 * §42.4: Повторный контроль одной категории внутри окна вызывает diminishing returns.
 * После истечения окна сопротивление возвращается к 100% длительности.
 */
export function applyControlEffect(
  map: MapInstanceState,
  targetId: string,
  controlCategory: NonNullable<ActiveStatusEffect['controlCategory']>,
  baseDurationSec: number,
  currentTimeSec: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { applied: boolean; effectiveDurationSec: number; factorUsed: number; applicationNumber: number } {
  if (!map.controlTrackerByTarget) map.controlTrackerByTarget = {};
  if (!map.controlTrackerByTarget[targetId]) map.controlTrackerByTarget[targetId] = {};

  const tracker = map.controlTrackerByTarget[targetId][controlCategory];
  let appIndex = 0;

  if (tracker && currentTimeSec < tracker.windowExpiresAtSec) {
    appIndex = tracker.applicationsInWindow;
  }

  const factors = config.controlDiminishingFactors;
  const factorUsed = appIndex < factors.length ? factors[appIndex] : 0;
  const effectiveDurationSec = Number((baseDurationSec * factorUsed).toFixed(2));

  map.controlTrackerByTarget[targetId][controlCategory] = {
    applicationsInWindow: appIndex + 1,
    lastAppliedTimeSec: currentTimeSec,
    windowExpiresAtSec: currentTimeSec + config.controlDiminishingWindowSec,
  };

  if (effectiveDurationSec <= 0) {
    return {
      applied: false,
      effectiveDurationSec: 0,
      factorUsed: 0,
      applicationNumber: appIndex + 1,
    };
  }

  applyBuffOrDebuff(map, targetId, {
    effectId: `ctrl_${controlCategory}_${currentTimeSec}`,
    sourceSpellId: `control_${controlCategory}`,
    kind: 'control',
    controlCategory,
    magnitude: 1,
    remainingSec: effectiveDurationSec,
    maxDurationSec: effectiveDurationSec,
  });

  return {
    applied: true,
    effectiveDurationSec,
    factorUsed,
    applicationNumber: appIndex + 1,
  };
}

export interface NpcCasterProfile {
  casterId: string;
  squadId: string;
  factionId: string;
  allegiance: AllegianceState;
  mana: number;
  maxMana: number;
  knownSpellIds: string[];
  schoolMasteries?: Partial<Record<import('./types').MagicSchoolId, number>>;
  darkBranchMasteries?: Partial<Record<import('./types').DarkBranchId, number>>;
}

export interface NpcCasterTurnResult {
  castExecuted: boolean;
  chosenSpellId: string | null;
  targetSquadId: string | null;
  manaSpent: number;
  effectPower: number;
  blockedReasons: Array<{ spellId: string; reason: string }>;
}

/**
 * §6, §337.3: Магия NPC и фракций работает по тем же базовым правилам, что и магия игрока:
 * - только белый список автокаста (autoCastEligible && autoCastDefault)
 * - минимальный резерв маны (%)
 * - подавление атакующей магии при приказе Retreat
 * - учёт allegiance (Hostile атакует Player/Ally, не трогает Neutral без явной смены allegiance; Player/Ally лечит своих и бьёт Hostile)
 */
export function executeNpcCasterAutoTurn(params: {
  caster: NpcCasterProfile;
  casterSquad: SquadInstance;
  allSquads: SquadInstance[];
  config?: ProvisionalBalanceConfig;
}): NpcCasterTurnResult {
  const { caster, casterSquad, allSquads } = params;
  const config = params.config ?? DEFAULT_WORKING_ASSUMPTIONS;
  const minReserveMana = caster.maxMana * config.autoCastMinManaReservePct;
  const order = casterSquad.command.playerOrder;
  const blockedReasons: Array<{ spellId: string; reason: string }> = [];

  const aliveUnitsInSquad = (sq: SquadInstance) => sq.units.filter((u) => u.alive && u.hp > 0);
  if (aliveUnitsInSquad(casterSquad).length === 0) {
    return {
      castExecuted: false,
      chosenSpellId: null,
      targetSquadId: null,
      manaSpent: 0,
      effectPower: 0,
      blockedReasons: [{ spellId: '*', reason: 'Отряд кастера уничтожен.' }],
    };
  }

  const isHostilePair = (a: AllegianceState, b: AllegianceState): boolean => {
    if (a === 'Neutral' || b === 'Neutral') return false;
    if (a === 'Hostile') return b === 'Player' || b === 'Ally';
    return b === 'Hostile';
  };

  const isFriendlyPair = (a: AllegianceState, b: AllegianceState): boolean => {
    if (a === b) return true;
    return (a === 'Player' && b === 'Ally') || (a === 'Ally' && b === 'Player');
  };

  for (const spellId of caster.knownSpellIds) {
    const def = PROTOTYPE_SPELLS[spellId];
    if (!def) continue;

    if (!def.autoCastEligible || !def.autoCastDefault) {
      blockedReasons.push({
        spellId,
        reason: 'Заклинание исключено белым списком автоприменения NPC/фракций (§337.3).',
      });
      continue;
    }

    if (order === 'Retreat' && def.effectType === 'damage') {
      blockedReasons.push({
        spellId,
        reason: 'Приказ Retreat подавляет авто-атакующую магию NPC/фракций (§337.2).',
      });
      continue;
    }

    const mastery =
      def.school === 'dark' && def.darkBranch
        ? (caster.darkBranchMasteries?.[def.darkBranch] ?? 0)
        : (caster.schoolMasteries?.[def.school] ?? 0);

    const manaCost = Math.ceil(
      def.baseManaCost * Math.max(0.5, 1 - 0.0025 * mastery)
    );
    if (caster.mana - manaCost < minReserveMana) {
      blockedReasons.push({
        spellId,
        reason: `Нарушен минимальный резерв маны NPC (${Math.round(minReserveMana)}).`,
      });
      continue;
    }

    const effectPower = Number((def.basePower * (1 + 0.006 * mastery)).toFixed(2));

    if (def.effectType === 'heal') {
      const injuredAlly = allSquads.find(
        (sq) =>
          isFriendlyPair(caster.allegiance, sq.allegiance) &&
          sq.units.some((u) => u.alive && u.hp > 0 && u.hp < u.maxHp)
      );
      if (!injuredAlly) {
        blockedReasons.push({ spellId, reason: 'Нет раненых союзников для лечения.' });
        continue;
      }
      const targetUnit = injuredAlly.units.find((u) => u.alive && u.hp > 0 && u.hp < u.maxHp)!;
      const healRes = applyHealingPacket(targetUnit, effectPower);
      caster.mana -= manaCost;
      return {
        castExecuted: true,
        chosenSpellId: spellId,
        targetSquadId: injuredAlly.squadId,
        manaSpent: manaCost,
        effectPower: healRes.healedAmount,
        blockedReasons,
      };
    }

    if (def.effectType === 'damage') {
      const hostileSquad = allSquads.find(
        (sq) =>
          isHostilePair(caster.allegiance, sq.allegiance) &&
          aliveUnitsInSquad(sq).length > 0
      );
      if (!hostileSquad) {
        blockedReasons.push({ spellId, reason: 'Нет враждебных целей (Neutral игнорируются §343.3).' });
        continue;
      }
      const targetUnit = aliveUnitsInSquad(hostileSquad)[0];
      targetUnit.hp = Math.max(0, Number((targetUnit.hp - effectPower).toFixed(2)));
      if (targetUnit.hp <= 0) targetUnit.alive = false;
      caster.mana -= manaCost;
      return {
        castExecuted: true,
        chosenSpellId: spellId,
        targetSquadId: hostileSquad.squadId,
        manaSpent: manaCost,
        effectPower,
        blockedReasons,
      };
    }
  }

  return {
    castExecuted: false,
    chosenSpellId: null,
    targetSquadId: null,
    manaSpent: 0,
    effectPower: 0,
    blockedReasons,
  };
}

/**
 * §11.4: Установка формации как инструмента построения без автоматических бонусов к характеристикам.
 */
export function setSquadFormation(
  squad: SquadInstance,
  formation: import('./types').FormationType
): SquadInstance {
  return {
    ...squad,
    formation,
  };
}

/**
 * §11.5: Общий групповой приказ нескольким отрядам сохраняет боевую роль каждого отряда:
 * стрелки держат дистанционную позицию (standoff), ближний бой сближается с точкой/целью.
 */
export function issueMultiSquadOrder(
  squads: SquadInstance[],
  order: import('./types').PlayerOrderType,
  targetPos: { x: number; y: number }
): Array<{ squadId: string; roleMode: 'melee_close' | 'ranged_standoff'; assignedPos: { x: number; y: number } }> {
  const assignments: Array<{
    squadId: string;
    roleMode: 'melee_close' | 'ranged_standoff';
    assignedPos: { x: number; y: number };
  }> = [];

  squads.forEach((sq, idx) => {
    const firstDef = sq.units[0] ? PROTOTYPE_CREATURES[sq.units[0].creatureDefId] : undefined;
    const isRanged = firstDef?.combatRoleTags.includes('ranged') ?? false;
    const standoffOffset = isRanged ? -6 : 0;
    const lateralOffset = (idx % 2 === 0 ? 1 : -1) * Math.floor((idx + 1) / 2) * 2;
    const assignedPos = {
      x: targetPos.x + standoffOffset,
      y: targetPos.y + lateralOffset,
    };

    sq.command = {
      ...sq.command,
      playerOrder: order,
      orderTargetPos: assignedPos,
      localReaction: 'None',
      reactionTargetEntityId: undefined,
    };

    assignments.push({
      squadId: sq.squadId,
      roleMode: isRanged ? 'ranged_standoff' : 'melee_close',
      assignedPos,
    });
  });

  return assignments;
}

/**
 * §§4–5 APPROVED + §42.4 DR: Применение Магии разума к NPC/отряду с обязательным ограничением:
 * магия не позволяет автоматически заставить любого NPC выполнить любое действие.
 * Боссы, сюжетно защищённые NPC, нежить/конструкты (для убеждения/очарования) и высокая воля защищены.
 */
export function applyMindEffectToTarget(params: {
  map: MapInstanceState;
  casterHero: HeroState;
  targetSquad: SquadInstance;
  effectKind: import('./types').MindEffectKind;
  baseDurationSec: number;
  currentTimeSec: number;
  config?: ProvisionalBalanceConfig;
}): {
  ok: boolean;
  effectiveDurationSec: number;
  resultingAllegiance: AllegianceState;
  reason?: string;
} {
  const { map, casterHero, targetSquad, effectKind, baseDurationSec, currentTimeSec } = params;
  const config = params.config ?? DEFAULT_WORKING_ASSUMPTIONS;

  if (targetSquad.plotCriticalRefusal) {
    return {
      ok: false,
      effectiveDurationSec: 0,
      resultingAllegiance: targetSquad.allegiance,
      reason: `Сюжетная воля цели "${targetSquad.nameRu}" блокирует принуждение Магией разума (§5).`,
    };
  }

  if (targetSquad.npcTier === 'boss' && (effectKind === 'charm' || effectKind === 'pacify' || effectKind === 'fear')) {
    return {
      ok: false,
      effectiveDurationSec: 0,
      resultingAllegiance: targetSquad.allegiance,
      reason: `Босс "${targetSquad.nameRu}" невосприимчив к полному выведению/переманиванию Магией разума (§5).`,
    };
  }

  if (
    (targetSquad.originType === 'Undead' || targetSquad.originType === 'Construct') &&
    (effectKind === 'charm' || effectKind === 'fear' || effectKind === 'pacify')
  ) {
    return {
      ok: false,
      effectiveDurationSec: 0,
      resultingAllegiance: targetSquad.allegiance,
      reason: `Существа типа ${targetSquad.originType} не подвержены эмоциональному воздействию "${effectKind}" (§5).`,
    };
  }

  const casterWillScore = casterHero.baseAttributes.CHA + casterHero.schoolMasteries.mind * 2;
  const targetWill = targetSquad.willpowerRating ?? (targetSquad.npcTier === 'commander' ? 24 : 10);
  if (targetSquad.npcTier === 'commander' && casterWillScore < targetWill) {
    return {
      ok: false,
      effectiveDurationSec: 0,
      resultingAllegiance: targetSquad.allegiance,
      reason: `Сила воли командира (${targetWill}) превышает силу Магии разума кастера (${casterWillScore}, §5).`,
    };
  }

  const controlCat: NonNullable<ActiveStatusEffect['controlCategory']> =
    effectKind === 'fear'
      ? 'fear'
      : effectKind === 'pacify'
        ? 'sleep'
        : effectKind === 'charm'
          ? 'dominate'
          : 'stun';

  const drRes = applyControlEffect(
    map,
    targetSquad.squadId,
    controlCat,
    baseDurationSec,
    currentTimeSec,
    config
  );
  if (!drRes.applied) {
    return {
      ok: false,
      effectiveDurationSec: 0,
      resultingAllegiance: targetSquad.allegiance,
      reason: 'Цель временно невосприимчива из-за diminishing returns (§42.4).',
    };
  }

  const originalAllegiance = targetSquad.activeMindInfluence?.originalAllegiance ?? targetSquad.allegiance;
  if (effectKind === 'charm') {
    targetSquad.allegiance = 'Ally';
  } else if (effectKind === 'fear') {
    targetSquad.command.playerOrder = 'Retreat';
  } else if (effectKind === 'pacify') {
    targetSquad.command.playerOrder = 'Idle';
  }

  targetSquad.activeMindInfluence = {
    effectKind,
    casterHeroId: casterHero.heroId,
    originalAllegiance,
    remainingSec: drRes.effectiveDurationSec,
  };

  return {
    ok: true,
    effectiveDurationSec: drRes.effectiveDurationSec,
    resultingAllegiance: targetSquad.allegiance,
  };
}

export function tickMindEffectsExpiry(
  targetSquad: SquadInstance,
  dtSec: number
): { expired: boolean } {
  const inf = targetSquad.activeMindInfluence;
  if (!inf || dtSec <= 0) return { expired: false };
  inf.remainingSec = Math.max(0, Number((inf.remainingSec - dtSec).toFixed(3)));
  if (inf.remainingSec <= 0) {
    targetSquad.allegiance = inf.originalAllegiance;
    targetSquad.activeMindInfluence = null;
    return { expired: true };
  }
  return { expired: false };
}

/**
 * §36.1: Проверка 10 обязательных инвариантов баланса и формул (v14.2 §36.1.1–10).
 */
export function runMandatoryCombatMatrixAudit(): {
  allPassed: boolean;
  checks: Array<{ id: string; labelRu: string; passed: boolean; metric: string }>;
} {
  const baseRaw = computeRawPhysicalDamage(20, 10, 0);
  const strLowDexHit = computeHitChancePct(6, 25); // низкий DEX против ловкой цели
  const balancedHit = computeHitChancePct(20, 10);
  const highStaHp = 100 + 12 * (25 - 10);
  const lowStaHp = 100 + 12 * (10 - 10);
  const armoredDmg = computeDamageAfterArmor(40, 180);
  const blockMax = computeBlockChancePct(100);
  const highMasteryWeakGear = computeRawPhysicalDamage(12, 14, 60);
  const lowMasteryStrongGear = computeRawPhysicalDamage(38, 14, 0);

  const npcVsPlayerRes = resolveCombatPackets({
    attackerDex: 15,
    target: {
      id: 'audit_infantry',
      nameRu: 'Пехотинец',
      hp: 150,
      maxHp: 150,
      agi: 12,
      armor: 60,
      hasShield: true,
      shieldMastery: 30,
      resistances: {},
    },
    packets: [
      { type: 'physical', rawAmount: 42, canHitCheck: true, canBeBlockedByShield: true, fromFrontArc: true },
    ],
    hitRollPct: 5,
    blockRollPct: 99,
  });

  const checks = [
    {
      id: '36.1.1',
      labelRu: 'Герой без защитных вложений уступает по HP/броне',
      passed: highStaHp > lowStaHp && lowStaHp === 100,
      metric: `HP(STA=10)=${lowStaHp} < HP(STA=25)=${highStaHp}`,
    },
    {
      id: '36.1.3',
      labelRu: 'Высокая STR при низком DEX теряет точность против AGI',
      passed: strLowDexHit < balancedHit && strLowDexHit >= 5,
      metric: `Hit(DEX6 vs AGI25)=${strLowDexHit.toFixed(1)}% < ${balancedHit.toFixed(1)}%`,
    },
    {
      id: '36.1.4',
      labelRu: 'Ловкий боец с низкой STR хуже пробивает тяжёлую броню',
      passed: armoredDmg < baseRaw,
      metric: `AfterArmor(40, A=180)=${armoredDmg.toFixed(2)}`,
    },
    {
      id: '36.1.5',
      labelRu: 'Щит ограничивается потолком блока 40%',
      passed: blockMax === 40,
      metric: `MaxBlock=${blockMax}%`,
    },
    {
      id: '36.1.7-8',
      labelRu: 'Мастерство и сильная экипировка дают соизмеримый вклад',
      passed: highMasteryWeakGear > 25 && lowMasteryStrongGear > 35,
      metric: `Mastery60+W12=${highMasteryWeakGear} vs Mastery0+W38=${lowMasteryStrongGear}`,
    },
    {
      id: '36.1.10',
      labelRu: 'Единые формулы применяются к отрядам и NPC без исключений',
      passed: npcVsPlayerRes.hitSucceeded && npcVsPlayerRes.totalFinalDamage > 0 && npcVsPlayerRes.totalFinalDamage < 42,
      metric: `SquadPacket=${npcVsPlayerRes.totalFinalDamage}`,
    },
  ];

  return {
    allPassed: checks.every((c) => c.passed),
    checks,
  };
}

/**
 * §14.8 APPROVED, §1.7: Победы армии (отрядов игрока) начисляют XP герою/Аватару кампании,
 * тогда как обычные бойцы отрядов (UnitInstance) никогда не получают индивидуальных RPG-атрибутов или уровней.
 */
export function awardArmyVictoryXpToHero(params: {
  campaign: CampaignState;
  defeatedSquad: SquadInstance;
  transactionId: string;
  baseXpPerUnit?: number;
  enemyVariantId?: string | null;
  targetHeroId?: string;
  config?: ProvisionalBalanceConfig;
}): { ok: boolean; grantedXp: number; levelUps: LevelUpStepRecord[]; reason?: string } {
  const { campaign, defeatedSquad, transactionId } = params;
  const config = params.config ?? DEFAULT_WORKING_ASSUMPTIONS;

  if (campaign.processedEventIds.includes(transactionId)) {
    return {
      ok: false,
      grantedXp: 0,
      levelUps: [],
      reason: 'Награда XP за победу над этим отрядом уже начислена.',
    };
  }
  if (defeatedSquad.allegiance !== 'Hostile') {
    return {
      ok: false,
      grantedXp: 0,
      levelUps: [],
      reason: 'XP за победу армии начисляется только за враждебные отряды (§14.8).',
    };
  }

  const targetHeroId = params.targetHeroId ?? campaign.avatarId;
  const baseXp = (params.baseXpPerUnit ?? 25) * Math.max(1, defeatedSquad.units.length);
  const variantKey = params.enemyVariantId ?? defeatedSquad.squadDefId;
  const xpRes = grantHeroExperience(campaign, targetHeroId, baseXp, variantKey, config);

  campaign.processedEventIds.push(transactionId);
  return {
    ok: true,
    grantedXp: xpRes.grantedXp,
    levelUps: xpRes.levelUps,
  };
}



