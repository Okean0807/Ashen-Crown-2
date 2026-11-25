/**
 * ASHEN CROWN — Единый боевой конвейер (§237), магия и MagicStrain (§§38–43),
 * автономность нежити некроманта (§§3.1, 103–105), смерть Аватара (§288, §341.5)
 * и разделение PlayerOrder vs LocalReaction (§337.2, §343.6).
 */

import { PROTOTYPE_SPELLS } from './catalog';
import {
  APPROVED_CONSTANTS,
  DEFAULT_WORKING_ASSUMPTIONS,
  DESIGN_TARGET_FORMULAS,
  type ProvisionalBalanceConfig,
} from './config';
import { computeDerivedHeroStats } from './progression';
import type {
  ActiveCastState,
  CampaignState,
  CombatMasteryId,
  CombatResolutionLog,
  CombatTargetSnapshot,
  CorpseEntity,
  DamagePacket,
  DamageType,
  HeroState,
  MapInstanceState,
  MissionState,
  PlayerOrderType,
  SquadCommandLayer,
  UndeadAutonomyAIState,
} from './types';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * §33.5: Damage_raw = (W + 1.2 * (STR - 10)) * (1 + 0.015 * M)
 */
export function computeRawPhysicalDamage(
  weaponDamage: number,
  effectiveStr: number,
  relevantMastery: number
): number {
  const { BASE_ATTRIBUTE, PHYS_DMG_PER_STR, MASTERY_DMG_PER_POINT } = DESIGN_TARGET_FORMULAS;
  const masteryFactor = 1 + MASTERY_DMG_PER_POINT * relevantMastery;
  return Number(((weaponDamage + PHYS_DMG_PER_STR * (effectiveStr - BASE_ATTRIBUTE)) * masteryFactor).toFixed(3));
}

/**
 * §33.6: HitChance = clamp(5..95%, 75 + 0.35 * (DEX - AGI))
 */
export function computeHitChancePct(attackerDex: number, targetAgi: number): number {
  const { HIT_BASE, HIT_COEFF, HIT_MIN, HIT_MAX } = DESIGN_TARGET_FORMULAS;
  return clamp(HIT_BASE + HIT_COEFF * (attackerDex - targetAgi), HIT_MIN, HIT_MAX);
}

/**
 * §33.8: BlockChance = clamp(5..40%, 5 + 0.35 * M_shield)
 */
export function computeBlockChancePct(shieldMastery: number): number {
  const { BLOCK_BASE, BLOCK_COEFF, BLOCK_MIN, BLOCK_MAX } = DESIGN_TARGET_FORMULAS;
  return clamp(BLOCK_BASE + BLOCK_COEFF * shieldMastery, BLOCK_MIN, BLOCK_MAX);
}

/**
 * §33.7: Armor reduction = 100 / (100 + A)
 */
export function computeDamageAfterArmor(rawDamage: number, armor: number): number {
  const safeArmor = Math.max(0, armor);
  return rawDamage * (DESIGN_TARGET_FORMULAS.ARMOR_SCALE / (DESIGN_TARGET_FORMULAS.ARMOR_SCALE + safeArmor));
}

/**
 * §41.2 + §1.2: R строго ограничивается [-1.0, +0.75].
 * Абсолютный иммунитет к магии (R >= 1.0) заблокирован системно, в том числе для боссов.
 */
export function clampResistance(rawResistance: number | undefined): number {
  const r = rawResistance ?? 0;
  return clamp(r, DESIGN_TARGET_FORMULAS.RESISTANCE_MIN, DESIGN_TARGET_FORMULAS.RESISTANCE_MAX);
}

/**
 * §237: Единый конвейер разрешения боевого действия (физического, магического или смешанного).
 * Гарантирует отсутствие двойного снижения одного и того же защитного слоя (§237.4).
 */
export function resolveCombatPackets(params: {
  attackerDex: number;
  target: CombatTargetSnapshot;
  packets: DamagePacket[];
  /** Детерминированные значения [0..100) для тестируемости без скрытого RNG. */
  hitRollPct?: number;
  blockRollPct?: number;
}): CombatResolutionLog {
  const { attackerDex, target, packets } = params;
  const hitRoll = params.hitRollPct ?? 0;
  const blockRoll = params.blockRollPct ?? 99;

  const needsHitCheck = packets.some((p) => p.canHitCheck);
  const hitChancePct = computeHitChancePct(attackerDex, target.agi);
  const hitSucceeded = !needsHitCheck || hitRoll < hitChancePct;

  if (!hitSucceeded) {
    return {
      hitRolled: hitRoll,
      hitChancePct,
      hitSucceeded: false,
      blocked: false,
      blockChancePct: 0,
      packetBreakdown: [],
      totalFinalDamage: 0,
      targetHpAfter: target.hp,
      targetDied: false,
      castInterrupted: false,
    };
  }

  const blockChancePct = target.hasShield ? computeBlockChancePct(target.shieldMastery) : 0;
  const canBlockAny = target.hasShield && packets.some((p) => p.canBeBlockedByShield && p.fromFrontArc);
  const blocked = canBlockAny && blockRoll < blockChancePct;

  const packetBreakdown: CombatResolutionLog['packetBreakdown'] = [];
  let totalFinalDamage = 0;

  for (const pkt of packets) {
    if (blocked && pkt.canBeBlockedByShield && pkt.fromFrontArc) {
      packetBreakdown.push({
        type: pkt.type,
        raw: pkt.rawAmount,
        afterArmor: 0,
        afterResistance: 0,
      });
      continue;
    }

    if (pkt.type === 'physical') {
      // Физический пакет: только Armor (§237.4), без повторного применения AGI или магического сопротивления
      const effArmor = Math.max(0, target.armor - (pkt.armorPenetration ?? 0));
      const afterArmor = computeDamageAfterArmor(pkt.rawAmount, effArmor);
      const afterPhysRes = afterArmor * (1 - clampResistance(target.resistances.physical));
      const rounded = Math.max(0, Number(afterPhysRes.toFixed(2)));
      totalFinalDamage += rounded;
      packetBreakdown.push({
        type: pkt.type,
        raw: pkt.rawAmount,
        afterArmor: Number(afterArmor.toFixed(2)),
        afterResistance: rounded,
      });
    } else {
      // Магический пакет: НЕ проходит через физическую броню (§237.3–237.4), только через Resistance <= 0.75
      const r = clampResistance(target.resistances[pkt.type]);
      const afterResistance = Math.max(0, pkt.rawAmount * (1 - r));
      const rounded = Number(afterResistance.toFixed(2));
      totalFinalDamage += rounded;
      packetBreakdown.push({
        type: pkt.type,
        raw: pkt.rawAmount,
        afterArmor: pkt.rawAmount,
        afterResistance: rounded,
      });
    }
  }

  totalFinalDamage = Number(totalFinalDamage.toFixed(2));
  const targetHpAfter = Math.max(0, Number((target.hp - totalFinalDamage).toFixed(2)));
  const targetDied = targetHpAfter <= 0;

  // §40.3: Прерывание каста только если фактический прошедший урон превышает CastStability
  const castInterrupted =
    Boolean(target.isCasting) &&
    totalFinalDamage > (target.castStabilityThreshold ?? 15);

  return {
    hitRolled: hitRoll,
    hitChancePct,
    hitSucceeded: true,
    blocked,
    blockChancePct,
    packetBreakdown,
    totalFinalDamage,
    targetHpAfter,
    targetDied,
    castInterrupted,
  };
}

/**
 * §38.3–38.5: Расчёт силы заклинания:
 * EffectPower = BasePower * SchoolFactor * SpellFactor * AttributeFactor
 */
export function computeSpellEffectPower(
  hero: HeroState,
  spellId: string,
  itemsByInstanceId: CampaignState['itemsByInstanceId']
): number {
  const def = PROTOTYPE_SPELLS[spellId];
  const state = hero.spells[spellId];
  if (!def || !state || state.acquisitionState !== 'Learned') return 0;

  const schoolMastery =
    def.school === 'dark' && def.darkBranch
      ? hero.darkBranchMasteries[def.darkBranch]
      : hero.schoolMasteries[def.school];

  const schoolFactor = 1 + DESIGN_TARGET_FORMULAS.SCHOOL_FACTOR_PER_POINT * schoolMastery;
  const spellFactor = 1 + DESIGN_TARGET_FORMULAS.SPELL_RANK_FACTOR_STEP * Math.max(0, state.rank - 1);

  let attrFactor = 1;
  if (def.scalingAttribute) {
    const derived = computeDerivedHeroStats(hero, itemsByInstanceId);
    const attrVal = derived.effectiveAttributes[def.scalingAttribute];
    attrFactor =
      1 +
      clamp(
        DESIGN_TARGET_FORMULAS.ATTR_SCALE_PER_POINT * (attrVal - DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE),
        0,
        DESIGN_TARGET_FORMULAS.ATTR_SCALE_CAP
      );
  }

  return Number((def.basePower * schoolFactor * spellFactor * attrFactor).toFixed(2));
}

/**
 * §39.2: ManaCost = ceil(BaseManaCost * max(0.5, 1 - 0.0025 * SchoolMastery))
 */
export function computeSpellManaCost(hero: HeroState, spellId: string): number {
  const def = PROTOTYPE_SPELLS[spellId];
  if (!def) return 0;
  const schoolMastery =
    def.school === 'dark' && def.darkBranch
      ? hero.darkBranchMasteries[def.darkBranch]
      : hero.schoolMasteries[def.school];

  const schoolCostFactor = Math.max(
    DESIGN_TARGET_FORMULAS.MANA_COST_MIN_FACTOR,
    1 - DESIGN_TARGET_FORMULAS.SCHOOL_COST_REDUCTION_PER_POINT * schoolMastery
  );
  return Math.ceil(def.baseManaCost * schoolCostFactor);
}

/**
 * §40.1: CastTime = BaseCastTime * (1 - 0.002 * SchoolMastery)
 */
export function computeSpellCastTime(hero: HeroState, spellId: string): number {
  const def = PROTOTYPE_SPELLS[spellId];
  if (!def) return 0;
  const schoolMastery =
    def.school === 'dark' && def.darkBranch
      ? hero.darkBranchMasteries[def.darkBranch]
      : hero.schoolMasteries[def.school];
  return Number((def.baseCastTimeSec * (1 - DESIGN_TARGET_FORMULAS.CAST_TIME_REDUCTION_PER_POINT * schoolMastery)).toFixed(3));
}

/**
 * §39.3 & §43.2–43.5: Начало подготовки заклинания:
 * - Списывает ману СРАЗУ при начале каста (и кровь HP, если применимо)
 * - Заклинания в долг запрещены (§39.5)
 * - Если каст прерван позднее, мана не возвращается (§40.4)
 * - Нагрузочные заклинания повышают MagicStrain; заклинания с contribution = 0 его не меняют (§43.5)
 */
export function startSpellCast(
  campaign: CampaignState,
  heroId: string,
  spellId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): {
  ok: boolean;
  manaSpent: number;
  bloodHpSpent: number;
  castTimeSec: number;
  effectPower: number;
  reason?: string;
} {
  const hero = campaign.heroes[heroId];
  const def = PROTOTYPE_SPELLS[spellId];
  if (!hero || !def) {
    return { ok: false, manaSpent: 0, bloodHpSpent: 0, castTimeSec: 0, effectPower: 0, reason: 'Герой или заклинание не найдены.' };
  }
  if (hero.deathState.lifecycle !== 'Alive') {
    return { ok: false, manaSpent: 0, bloodHpSpent: 0, castTimeSec: 0, effectPower: 0, reason: 'Аватар мёртв.' };
  }
  const spellState = hero.spells[spellId];
  if (!spellState || spellState.acquisitionState !== 'Learned') {
    return { ok: false, manaSpent: 0, bloodHpSpent: 0, castTimeSec: 0, effectPower: 0, reason: 'Заклинание не изучено.' };
  }

  const manaCost = computeSpellManaCost(hero, spellId);
  if (hero.mana < manaCost) {
    return {
      ok: false,
      manaSpent: 0,
      bloodHpSpent: 0,
      castTimeSec: 0,
      effectPower: 0,
      reason: `Недостаточно маны: нужно ${manaCost}, есть ${Math.floor(hero.mana)}.`,
    };
  }

  const bloodCost = def.bloodHpCost ?? 0;
  if (bloodCost > 0 && hero.hp <= bloodCost) {
    return {
      ok: false,
      manaSpent: 0,
      bloodHpSpent: 0,
      castTimeSec: 0,
      effectPower: 0,
      reason: 'Недостаточно здоровья для оплаты заклинания Кровавой магии (§73.3).',
    };
  }

  hero.mana -= manaCost;
  if (bloodCost > 0) hero.hp -= bloodCost;

  // §43.2, §43.5: MagicStrain растёт только от заклинаний с magicStrainContribution > 0
  if (def.magicStrainContribution > 0) {
    hero.magicStrain.index += def.magicStrainContribution;
    updateMagicStrainStatus(hero, config);
  }

  return {
    ok: true,
    manaSpent: manaCost,
    bloodHpSpent: bloodCost,
    castTimeSec: computeSpellCastTime(hero, spellId),
    effectPower: computeSpellEffectPower(hero, spellId, campaign.itemsByInstanceId),
  };
}

export function updateMagicStrainStatus(
  hero: HeroState,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
) {
  if (hero.magicStrain.index >= config.magicStrainCriticalThreshold) {
    hero.magicStrain.status = 'critical';
  } else if (hero.magicStrain.index >= config.magicStrainWarningThreshold) {
    hero.magicStrain.status = 'elevated';
  } else {
    hero.magicStrain.status = 'normal';
  }
}

export function tickMagicStrainDecay(
  hero: HeroState,
  dtSec: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
) {
  if (dtSec <= 0 || hero.magicStrain.index <= 0) return;
  hero.magicStrain.index = Math.max(0, Number((hero.magicStrain.index - config.magicStrainDecayPerSecond * dtSec).toFixed(3)));
  updateMagicStrainStatus(hero, config);
}

/**
 * §43.4 APPROVED: При переходе на следующую карту MagicStrain сбрасывается на 100%,
 * даже если герой закончил предыдущую карту в критическом истощении.
 */
export function resetMagicStrainOnMapTransition(hero: HeroState) {
  hero.magicStrain.index = 0;
  hero.magicStrain.status = 'normal';
}

/**
 * §288, §341.5: Смерть и возрождение Аватара:
 * - Идемпотентная обработка события смерти по eventId (исключает повторную потерю XP)
 * - Возрождение у последнего активированного Stone of Souls с задержкой 2 игровые минуты (120 сек)
 * - Экипировка и инвентарь сохраняются полностью; симуляция карты не откатывается
 */
export function triggerAvatarDeath(
  campaign: CampaignState,
  map: MapInstanceState,
  eventId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { applied: boolean; xpLost: number; respawnAtStoneId: string | null } {
  if (campaign.processedEventIds.includes(eventId)) {
    return { applied: false, xpLost: 0, respawnAtStoneId: map.activeStoneOfSoulsId };
  }
  const avatar = campaign.heroes[campaign.avatarId];
  if (!avatar) {
    return { applied: false, xpLost: 0, respawnAtStoneId: null };
  }

  campaign.processedEventIds.push(eventId);
  avatar.hp = 0;
  avatar.deathState = {
    lifecycle: 'RespawnPending',
    respawnRemainingSec: APPROVED_CONSTANTS.AVATAR_RESPAWN_DELAY_SECONDS,
    activeStoneOfSoulsId: map.activeStoneOfSoulsId,
  };

  // §288, OD-001 (OPEN): небольшая потеря XP текущего уровня (configurable WORKING_ASSUMPTION)
  const xpLost = Math.floor(avatar.xp * config.avatarDeathCurrentLevelXpLossRate);
  avatar.xp = Math.max(0, avatar.xp - xpLost);

  // §105: если у некроманта есть активная нежить, включается гибридный остаточный резерв
  activateResidualAutonomyOnNecromancerDeath(avatar, map);

  return { applied: true, xpLost, respawnAtStoneId: map.activeStoneOfSoulsId };
}

export function advanceAvatarRespawnTimer(
  campaign: CampaignState,
  map: MapInstanceState,
  dtSec: number,
  mission?: MissionState
): { respawned: boolean; missionRemainsFailed?: boolean } {
  // §276.2 #5: Если миссия проиграна отдельным условием, дальнейшее возрождение не отменяет поражение миссии
  if (mission && mission.status === 'Defeat') {
    return { respawned: false, missionRemainsFailed: true };
  }
  const avatar = campaign.heroes[campaign.avatarId];
  if (!avatar || avatar.deathState.lifecycle !== 'RespawnPending') {
    return { respawned: false };
  }
  avatar.deathState.respawnRemainingSec = Math.max(0, avatar.deathState.respawnRemainingSec - dtSec);
  if (avatar.deathState.respawnRemainingSec <= 0) {
    avatar.deathState.lifecycle = 'Alive';
    avatar.hp = avatar.maxHp;
    avatar.mana = avatar.maxMana;
    avatar.deathState.activeStoneOfSoulsId = map.activeStoneOfSoulsId;
    return { respawned: true };
  }
  return { respawned: false };
}

/**
 * §§103–105: Управление двумя режимами некромантии:
 * Режим I (жив) — поддержание за ману -> при 0 маны переход в Dormant_NoMana (требует ручного re-raise).
 * Режим II (погиб) — гибридный общий резерв R(t) = max(0, R0 - sum(C_i)*t), НЕ обновляется при повторной смерти.
 */
export function activateResidualAutonomyOnNecromancerDeath(hero: HeroState, map: MapInstanceState) {
  const activeMinions = map.necromancyMinions.filter((m) => m.mode === 'Active');
  if (activeMinions.length === 0) return;

  // Защита §105: повторная смерть не обновляет уже активный/исчерпанный остаточный пул в рамках цикла
  if (map.necromancyAutonomy.active) return;

  const necromancyLevel = hero.darkBranchMasteries.necromancy;
  const r0 = Math.max(10, Math.round(hero.mana + necromancyLevel * 12));
  map.necromancyAutonomy = {
    active: true,
    initialPool: r0,
    remainingPool: r0,
    triggeredAtTimeSec: map.simulationTimeSec,
  };
  for (const m of activeMinions) {
    m.mode = 'Residual_Autonomy';
    // §107.1–107.2: В момент смерти фиксируется последний приказ; нежить продолжает его выполнять
    m.aiState = m.isDestroyed ? 'Destroyed' : 'FollowingLastOrder';
  }
}

export function tickNecromancyMinions(
  hero: HeroState,
  map: MapInstanceState,
  dtSec: number
): { transitionedToDormant: string[] } {
  const transitionedToDormant: string[] = [];

  if (hero.deathState.lifecycle === 'Alive') {
    // Режим I: некромант жив — сбрасываем флаг остаточной автономии после возврата героя,
    // но упавшая нежить остаётся в Dormant_NoMana до явного повторного поднятия (§105.2).
    map.necromancyAutonomy.active = false;
    const active = map.necromancyMinions.filter(
      (m) => !m.isDestroyed && (m.mode === 'Active' || m.mode === 'Residual_Autonomy')
    );
    let totalUpkeep = 0;
    for (const m of active) {
      m.mode = 'Active';
      m.aiState = 'FollowingLastOrder';
      totalUpkeep += m.manaUpkeepPerSec * dtSec;
    }
    if (active.length > 0) {
      if (hero.mana >= totalUpkeep) {
        hero.mana -= totalUpkeep;
      } else {
        hero.mana = 0;
        for (const m of active) {
          m.mode = 'Dormant_NoMana';
          m.aiState = 'Inactive';
          transitionedToDormant.push(m.minionId);
        }
      }
    }
    return { transitionedToDormant };
  }

  // Режим II: некромант мёртв — общий остаточный резерв (§105.3)
  const residual = map.necromancyMinions.filter((m) => !m.isDestroyed && m.mode === 'Residual_Autonomy');
  if (residual.length === 0 || !map.necromancyAutonomy.active) {
    return { transitionedToDormant };
  }

  const totalDrainRate = residual.reduce((sum, m) => sum + m.residualDrainPerSec, 0);
  map.necromancyAutonomy.remainingPool = Math.max(
    0,
    Number((map.necromancyAutonomy.remainingPool - totalDrainRate * dtSec).toFixed(3))
  );

  if (map.necromancyAutonomy.remainingPool <= 0) {
    for (const m of residual) {
      m.mode = 'Dormant_NoMana';
      m.aiState = 'Inactive';
      transitionedToDormant.push(m.minionId);
    }
  }
  return { transitionedToDormant };
}

/**
 * §105.2: Явное действие повторного поднятия нежити из Dormant_NoMana после восстановления маны.
 */
export function reraiseDormantMinions(
  hero: HeroState,
  map: MapInstanceState,
  manaCostPerMinion = 8
): { raisedCount: number } {
  if (hero.deathState.lifecycle !== 'Alive') return { raisedCount: 0 };
  let raisedCount = 0;
  for (const m of map.necromancyMinions) {
    if (m.mode === 'Dormant_NoMana' && hero.mana >= manaCostPerMinion) {
      hero.mana -= manaCostPerMinion;
      m.mode = 'Active';
      raisedCount += 1;
    }
  }
  return { raisedCount };
}

/**
 * §3.1: Костяной воин из костей — рост 5 характеристик от XP и передача накопленного XP некроманту при уничтожении.
 */
export function grantBoneWarriorXpAndDestroy(
  map: MapInstanceState,
  minionId: string,
  xpGain: number,
  destroyAfter: boolean
): { returnedXpToNecromancer: number } {
  const m = map.necromancyMinions.find((item) => item.minionId === minionId && item.kind === 'bone_warrior');
  if (!m || !m.boneWarriorStats) return { returnedXpToNecromancer: 0 };

  m.boneWarriorStats.accumulatedXp += xpGain;
  const steps = Math.floor(m.boneWarriorStats.accumulatedXp / 25);
  m.boneWarriorStats.hpBonus = steps * 10;
  m.boneWarriorStats.physicalDamageBonus = steps * 2;
  m.boneWarriorStats.defenseBonus = steps * 1;
  m.boneWarriorStats.moveSpeedBonus = Number((steps * 0.05).toFixed(2));
  m.boneWarriorStats.attackSpeedBonus = Number((steps * 0.04).toFixed(2));

  if (!destroyAfter) {
    return { returnedXpToNecromancer: 0 };
  }

  const returned = m.boneWarriorStats.accumulatedXp;
  // При пересборке из останков XP обнуляется (§3.1)
  m.boneWarriorStats.accumulatedXp = 0;
  m.boneWarriorStats.hpBonus = 0;
  m.boneWarriorStats.physicalDamageBonus = 0;
  m.boneWarriorStats.defenseBonus = 0;
  m.boneWarriorStats.moveSpeedBonus = 0;
  m.boneWarriorStats.attackSpeedBonus = 0;
  map.necromancyMinions = map.necromancyMinions.filter((item) => item.minionId !== minionId);

  return { returnedXpToNecromancer: returned };
}

/**
 * §337.2, §343.6: Строгое разделение прямого приказа игрока и локальной реакции AI отряда.
 * - MoveTo не превращается в AttackMove
 * - HoldPosition запрещает преследование, разрешая только ответ в пределах позиции
 * - После завершения локальной реакции отряд возвращается к сохранённому playerOrder
 */
export function issueSquadPlayerOrder(
  squad: SquadCommandLayer,
  order: PlayerOrderType,
  targetPos?: { x: number; y: number },
  targetEntityId?: string
): SquadCommandLayer {
  return {
    ...squad,
    playerOrder: order,
    orderTargetPos: targetPos,
    orderTargetEntityId: targetEntityId,
    localReaction: 'None',
    reactionTargetEntityId: undefined,
    statusReason: undefined,
  };
}

export function triggerSquadLocalReaction(
  squad: SquadCommandLayer,
  threatEntityId: string,
  threatDistance: number
): SquadCommandLayer {
  // При Retreat — минимальная самооборона, не прерывая отход на охоту (§337.2)
  if (squad.playerOrder === 'Retreat') {
    return {
      ...squad,
      localReaction: 'None',
      statusReason: 'Отступление в процессе; наступательная реакция подавлена (§337.2).',
    };
  }
  // При HoldPosition — защита без смещения с позиции (§337.2)
  if (squad.playerOrder === 'HoldPosition' && threatDistance > 1.8) {
    return {
      ...squad,
      localReaction: 'None',
      statusReason: 'Удержание позиции: преследование запрещено (§337.2).',
    };
  }
  return {
    ...squad,
    localReaction: 'SelfDefense',
    reactionTargetEntityId: threatEntityId,
    // playerOrder НЕ переписывается!
  };
}

export function completeSquadLocalReaction(squad: SquadCommandLayer): SquadCommandLayer {
  return {
    ...squad,
    localReaction: 'None',
    reactionTargetEntityId: undefined,
    // Автоматический возврат к действующему playerOrder (§343.6)
    statusReason: `Возврат к приказу: ${squad.playerOrder}`,
  };
}

/** Вспомогательный расчёт физического урона для пары Hero -> Weapon Mastery. */
export function masteryForItemCategory(category: string): CombatMasteryId {
  switch (category) {
    case 'weapon_2h':
      return 'two_handed';
    case 'weapon_polearm':
      return 'polearms';
    case 'weapon_bow':
      return 'bows';
    case 'weapon_crossbow':
      return 'crossbows';
    default:
      return 'one_handed';
  }
}

/**
 * §40.3–40.4: Начало активного каста с фиксацией CastStabilityThreshold.
 * Мана списывается сразу и НЕ возвращается при последующем прерывании.
 */
export function beginHeroCast(
  campaign: CampaignState,
  heroId: string,
  spellId: string,
  targetId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; cast?: ActiveCastState; reason?: string } {
  const hero = campaign.heroes[heroId];
  const def = PROTOTYPE_SPELLS[spellId];
  if (!hero || !def) return { ok: false, reason: 'Герой или заклинание не найдены.' };
  if (hero.activeCast && !hero.activeCast.interrupted && hero.activeCast.remainingCastTimeSec > 0) {
    return { ok: false, reason: 'Персонаж уже произносит другое заклинание.' };
  }

  const started = startSpellCast(campaign, heroId, spellId, config);
  if (!started.ok) return { ok: false, reason: started.reason };

  const activeCast: ActiveCastState = {
    spellId,
    targetId,
    remainingCastTimeSec: started.castTimeSec,
    totalCastTimeSec: started.castTimeSec,
    manaAlreadySpent: started.manaSpent,
    bloodHpAlreadySpent: started.bloodHpSpent,
    castStabilityThreshold: def.castStabilityThreshold,
    effectPower: started.effectPower,
    interrupted: false,
  };
  hero.activeCast = activeCast;
  return { ok: true, cast: activeCast };
}

/**
 * §40.3–40.4: Прерывание активного каста уроном (> CastStabilityThreshold) без возврата маны!
 */
export function applyCombatInterruptToHeroCast(
  hero: HeroState,
  incomingFinalDamage: number
): { interrupted: boolean; manaRefunded: number } {
  const cast = hero.activeCast;
  if (!cast || cast.interrupted || cast.remainingCastTimeSec <= 0) {
    return { interrupted: false, manaRefunded: 0 };
  }
  if (incomingFinalDamage > cast.castStabilityThreshold) {
    cast.interrupted = true;
    hero.activeCast = null;
    // §40.4: уже потраченная мана НЕ возвращается
    return { interrupted: true, manaRefunded: 0 };
  }
  return { interrupted: false, manaRefunded: 0 };
}

export function advanceHeroActiveCast(
  hero: HeroState,
  dtSec: number
): { completed: boolean; spellId?: string; effectPower?: number } {
  const cast = hero.activeCast;
  if (!cast || cast.interrupted) return { completed: false };
  cast.remainingCastTimeSec = Math.max(0, Number((cast.remainingCastTimeSec - dtSec).toFixed(3)));
  if (cast.remainingCastTimeSec <= 0) {
    const finished = { ...cast };
    hero.activeCast = null;
    return {
      completed: true,
      spellId: finished.spellId,
      effectPower: finished.effectPower,
    };
  }
  return { completed: false };
}

/**
 * §3.1 APPROVED: Добыча костей с трупа (базовый принцип 50/50 или по броску сложности).
 */
export function lootBonesFromCorpse(
  hero: HeroState,
  corpse: CorpseEntity,
  boneDropRollPassed = true
): { ok: boolean; bonesGained: number; reason?: string } {
  if (corpse.bonesLooted || corpse.bonesRemaining <= 0) {
    return { ok: false, bonesGained: 0, reason: 'Кости с этих останков уже проверены/собраны.' };
  }
  corpse.bonesLooted = true;
  if (!boneDropRollPassed) {
    corpse.bonesRemaining = 0;
    return { ok: true, bonesGained: 0, reason: 'Пригодных костей в останках не обнаружено.' };
  }
  const gained = corpse.bonesRemaining;
  corpse.bonesRemaining = 0;
  hero.bonesCount = (hero.bonesCount ?? 0) + gained;
  return { ok: true, bonesGained: gained };
}

/**
 * §3.1 APPROVED: Сильному магу требуется меньше костей для создания Костяного воина.
 */
export function computeBoneWarriorBonesCost(
  hero: HeroState,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): number {
  const necroLevel = hero.darkBranchMasteries.necromancy;
  const spellBonus = Math.max(0, (hero.spells.spell_dark_raise_skeleton?.rank ?? 1) - 1);
  const reduction = Math.floor((necroLevel + spellBonus) / 2);
  return Math.max(config.boneWarriorMinBonesCost, config.boneWarriorBaseBonesCost - reduction);
}

/**
 * §3.1 APPROVED: Создание Костяного воина из добытых костей + расход маны + 5 растущих характеристик.
 */
export function createBoneWarriorFromBones(
  campaign: CampaignState,
  map: MapInstanceState,
  heroId: string,
  manaCost = 20,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; minionId?: string; bonesSpent: number; reason?: string } {
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, bonesSpent: 0, reason: 'Герой не найден.' };
  if (hero.deathState.lifecycle !== 'Alive') {
    return { ok: false, bonesSpent: 0, reason: 'Герой мёртв.' };
  }

  // §3.1 APPROVED: одновременный лимит нежити зависит от мастерства и запаса маны
  const maxMinionsByMastery = 1 + Math.floor(hero.darkBranchMasteries.necromancy / 2);
  if (map.necromancyMinions.length >= maxMinionsByMastery) {
    return {
      ok: false,
      bonesSpent: 0,
      reason: `Достигнут лимит нежити по мастерству Некромантии (${map.necromancyMinions.length}/${maxMinionsByMastery}, §3.1).`,
    };
  }

  const bonesNeeded = computeBoneWarriorBonesCost(hero, config);
  const currentBones = hero.bonesCount ?? 0;
  if (currentBones < bonesNeeded) {
    return {
      ok: false,
      bonesSpent: 0,
      reason: `Недостаточно костей: требуется ${bonesNeeded}, имеется ${currentBones} (§3.1).`,
    };
  }
  if (hero.mana < manaCost) {
    return {
      ok: false,
      bonesSpent: 0,
      reason: `Недостаточно маны (${Math.floor(hero.mana)}/${manaCost}).`,
    };
  }

  hero.bonesCount = currentBones - bonesNeeded;
  hero.mana -= manaCost;
  const minionId = `bw_${map.necromancyMinions.length + 1}_${Math.round(map.simulationTimeSec)}`;
  map.necromancyMinions.push({
    minionId,
    kind: 'bone_warrior',
    mode: 'Active',
    residualDrainPerSec: 4,
    manaUpkeepPerSec: 2,
    boneWarriorStats: {
      accumulatedXp: 0,
      hpBonus: 0,
      physicalDamageBonus: 0,
      defenseBonus: 0,
      moveSpeedBonus: 0,
      attackSpeedBonus: 0,
    },
    currentOrder: 'Follow',
  });

  return { ok: true, minionId, bonesSpent: bonesNeeded };
}

/**
 * §3.1 APPROVED: Истлевшее тело ('decayed') нельзя воскресить.
 */
export function reraiseCorpseForNecromancy(
  hero: HeroState,
  map: MapInstanceState,
  corpse: CorpseEntity,
  manaCost = 18
): { ok: boolean; reason?: string } {
  if (corpse.state === 'decayed') {
    return {
      ok: false,
      reason: `Истлевшее тело "${corpse.nameRu}" нельзя воскресить (§3.1 APPROVED).`,
    };
  }
  if (hero.mana < manaCost) {
    return { ok: false, reason: 'Недостаточно маны для воскрешения.' };
  }
  hero.mana -= manaCost;
  corpse.state = 'decayed';
  map.necromancyMinions.push({
    minionId: `raised_${corpse.corpseId}`,
    kind: 'skeleton',
    mode: 'Active',
    residualDrainPerSec: 3,
    manaUpkeepPerSec: 1.5,
    currentOrder: 'Follow',
  });
  return { ok: true };
}

/**
 * §3.1 APPROVED: Духи умерших в останках являются заскриптованными сущностями
 * и НЕ могут быть подчинены некромантом (разрешён только диалог / получение подсказки).
 */
export function interactWithCorpseSpirit(
  corpse: CorpseEntity,
  verb: 'dialogue' | 'subjugate'
): { ok: boolean; hintRu?: string; reason?: string } {
  if (!corpse.hasSpirit) {
    return { ok: false, reason: 'В этих останках не сохранился дух.' };
  }
  if (verb === 'subjugate') {
    return {
      ok: false,
      reason: 'Подчинение духов запрещено утверждённым правилом (§3.1 APPROVED): дух доступен только для сценария/информации.',
    };
  }
  return {
    ok: true,
    hintRu: corpse.spiritHintRu ?? 'Дух передаёт квестовую информацию без подчинения.',
  };
}

/**
 * §107.2 & §107.5 (USER APPROVED): Выдача прямого приказа нежити через героя-некроманта.
 * Пока некромант мёртв, новые прямые приказы через его магическую связь заблокированы (§107.5).
 */
export function issueNecromancyMinionOrder(
  hero: HeroState,
  map: MapInstanceState,
  minionId: string,
  order: PlayerOrderType,
  target?: { targetEntityId?: string; targetPos?: { x: number; y: number } }
): { ok: boolean; reason?: string } {
  const minion = map.necromancyMinions.find((m) => m.minionId === minionId);
  if (!minion) return { ok: false, reason: 'Существо нежити не найдено.' };
  if (minion.isDestroyed) return { ok: false, reason: 'Существо нежити уничтожено.' };
  if (hero.deathState.lifecycle !== 'Alive') {
    return {
      ok: false,
      reason: 'Некромант мёртв: автономная нежить не принимает новые прямые приказы до возрождения (§107.5).',
    };
  }
  if (minion.mode === 'Dormant_NoMana') {
    return {
      ok: false,
      reason: 'Нежить находится в неактивном состоянии (Dormant_NoMana): сначала поднимите её снова.',
    };
  }

  minion.mode = 'Active';
  minion.currentOrder = order;
  minion.orderTargetEntityId = target?.targetEntityId;
  minion.orderTargetPos = target?.targetPos ? { ...target.targetPos } : undefined;
  minion.aiState = 'FollowingLastOrder';
  return { ok: true };
}

/**
 * §107.1–107.8 (USER APPROVED): Детерминированный автомат поведения автономной нежити после смерти некроманта.
 *
 * Правила:
 * 1. При живом некроманте действует прямое управление игрока (FollowingLastOrder).
 * 2. При гибели некроманта нежить сохраняет последний действующий приказ (AttackTarget / Move / Retreat / HoldPosition и т.д.).
 * 3. Retreat никогда самовольно не разворачивается на преследование (§107.2, §107.8 #4).
 * 4. HoldPosition не покидает позицию ради удалённой цели (§107.8 #7).
 * 5. При невыполнимости последнего приказа или непосредственной локальной угрозе нежить переходит в
 *    Autonomous Defense (DefendingSelf -> DefendingAlly -> ReturningToOrderArea), без дальнего преследования (§107.3).
 * 6. При исчерпании остаточного резерва — переход в Inactive (§107.7–107.8 #8).
 */
export function evaluateAutonomousUndeadBehavior(
  hero: HeroState,
  map: MapInstanceState,
  minionId: string,
  env: {
    lastOrderStillValid: boolean;
    underDirectThreat: boolean;
    allyUnderAttackNearby: boolean;
    threatRequiresFarChase?: boolean;
    outsideOrderAreaAfterDefense?: boolean;
  }
): {
  aiState: UndeadAutonomyAIState;
  pursuesFarTarget: boolean;
  playerDirectControlActive: boolean;
  reasonRu: string;
} {
  const minion = map.necromancyMinions.find((m) => m.minionId === minionId);
  if (!minion || minion.isDestroyed) {
    return {
      aiState: 'Destroyed',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Существо нежити уничтожено и исключено из симуляции (§107.7).',
    };
  }

  if (minion.mode === 'Dormant_NoMana') {
    minion.aiState = 'Inactive';
    return {
      aiState: 'Inactive',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Остаточный резерв исчерпан или нет маны — состояние Inactive (§107.7).',
    };
  }

  // §107.8 #9–10: После возрождения героя прямое управление игрока немедленно возвращает приоритет
  if (hero.deathState.lifecycle === 'Alive') {
    minion.mode = 'Active';
    minion.aiState = 'FollowingLastOrder';
    return {
      aiState: 'FollowingLastOrder',
      pursuesFarTarget: false,
      playerDirectControlActive: true,
      reasonRu: 'Некромант жив: восстановлено прямое управление игрока (§107.8 #9–10).',
    };
  }

  // §105.5 / §107.8 #8: Исчерпан остаточный резерв
  if (!map.necromancyAutonomy.active || map.necromancyAutonomy.remainingPool <= 0) {
    minion.mode = 'Dormant_NoMana';
    minion.aiState = 'Inactive';
    return {
      aiState: 'Inactive',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Остаточный резерв исчерпан: нежить перешла в Inactive (§107.8 #8).',
    };
  }

  // §107.2 & §107.8 #4: Приказ Retreat не разворачивается на преследование
  if (minion.currentOrder === 'Retreat' && env.lastOrderStillValid) {
    minion.aiState = 'FollowingLastOrder';
    return {
      aiState: 'FollowingLastOrder',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Автономная нежить продолжает отступление (Retreat) без разворота на преследование (§107.2).',
    };
  }

  // §107.4 #1: Непосредственная угроза себе (но без дальнего преследования и без срыва HoldPosition ради удалённой цели)
  if (env.underDirectThreat && !env.threatRequiresFarChase) {
    minion.aiState = 'DefendingSelf';
    return {
      aiState: 'DefendingSelf',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Автономная защита: отражение непосредственной угрозы себе (§107.3–107.4).',
    };
  }

  // §107.4 #2: Защита ближайшего атакованного союзника (кроме HoldPosition и без дальнего ухода)
  if (
    env.allyUnderAttackNearby &&
    !env.threatRequiresFarChase &&
    minion.currentOrder !== 'HoldPosition'
  ) {
    minion.aiState = 'DefendingAlly';
    return {
      aiState: 'DefendingAlly',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Автономная защита: помощь ближайшему атакованному союзнику в локальном радиусе (§107.3–107.4).',
    };
  }

  // §107.4 #4: После локального отражения угрозы возврат в зону исходного приказа
  if (env.outsideOrderAreaAfterDefense && env.lastOrderStillValid) {
    minion.aiState = 'ReturningToOrderArea';
    return {
      aiState: 'ReturningToOrderArea',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: 'Локальная угроза устранена: возврат в район исходного приказа (§107.4 #4).',
    };
  }

  // §107.1 #1: Продолжение последнего действующего приказа, пока он выполним
  if (env.lastOrderStillValid) {
    minion.aiState = 'FollowingLastOrder';
    return {
      aiState: 'FollowingLastOrder',
      pursuesFarTarget: false,
      playerDirectControlActive: false,
      reasonRu: `Автономная нежить продолжает последний приказ (${minion.currentOrder}, §107.1).`,
    };
  }

  // §107.1 #2 & §107.3: Исходный приказ стал невыполним -> переход к удержанию района и локальной защите без дальнего преследования
  minion.currentOrder = 'HoldPosition';
  minion.orderTargetEntityId = undefined;
  minion.aiState = 'FollowingLastOrder';
  return {
    aiState: 'FollowingLastOrder',
    pursuesFarTarget: false,
    playerDirectControlActive: false,
    reasonRu: 'Исходный приказ невыполним: переключение на удержание района и локальную защиту без дальнего преследования (§107.3).',
  };
}

