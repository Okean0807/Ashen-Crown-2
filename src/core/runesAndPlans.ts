/**
 * ASHEN CROWN — Подсистема рун, Rune Tablet, Rune/Hero Monuments (§144) и строительных/военных планов Plan Book (§146).
 *
 * Гарантии (v14.2 §§144, 146, 317.8, 37_Задание §3):
 * - Руны в PartyInventory не активны, пока не установлены в ячейки Rune Tablet (§144.10 #1).
 * - Новые ячейки Rune Tablet открываются по мере роста уровня Аватара (§144.1, §144.3).
 * - Worker Rune даёт доступ к Rune Monument своей расы, но не заменяет Plans, здания и ресурсы (§144.10 #2, #8).
 * - Hero Rune связывает личность героя и его экипировку: гибель не уничтожает экипировку,
 *   повторный призыв у Hero Monument не дублирует предметы, а снятие/замена Hero Rune
 *   строго требует предварительно снять всю экипировку героя обратно в PartyInventory (§144.5, §144.10 #12-14).
 * - Rune Power восстанавливается постепенно на активной карте; её нехватка увеличивает время призыва (§144.6).
 * - Plans делятся на building и unit, строго привязаны к народу, активируются один раз постоянно
 *   и проверяются по 5 независимым условиям с явной причиной недоступности (§146.3, §146.5, §146.6).
 */

import { PROTOTYPE_ITEMS, PROTOTYPE_PLANS } from './catalog';
import { DEFAULT_WORKING_ASSUMPTIONS, type ProvisionalBalanceConfig } from './config';
import { summonCompanionHeroToParty } from './progression';
import type {
  CampaignState,
  HeroState,
  LocalSettlementState,
  MapInstanceState,
  PlayableRaceId,
  RuneTabletState,
} from './types';

/**
 * §144.1, §144.3: Расчёт числа открытых ячеек Rune Tablet по уровню Аватара.
 */
export function computeUnlockedRuneTabletSlots(
  avatarLevel: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): number {
  const extra = Math.floor(Math.max(0, avatarLevel - 1) / Math.max(1, config.runeTabletLevelsPerNewSlot));
  return Math.min(config.runeTabletMaxSlots, config.runeTabletBaseSlots + extra);
}

/**
 * Гарантирует актуальное число ячеек Rune Tablet в соответствии с уровнем Аватара.
 */
export function ensureRuneTabletSynced(
  campaign: CampaignState,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): RuneTabletState {
  const avatarLevel = campaign.heroes[campaign.avatarId]?.level ?? 1;
  const targetSlots = computeUnlockedRuneTabletSlots(avatarLevel, config);
  if (!campaign.runeTablet) {
    campaign.runeTablet = { slots: [] };
  }
  while (campaign.runeTablet.slots.length < targetSlots) {
    campaign.runeTablet.slots.push({
      slotIndex: campaign.runeTablet.slots.length,
      runeInstanceId: null,
    });
  }
  return campaign.runeTablet;
}

/**
 * §144.3, §144.10 #1: Установка Worker Rune или Hero Rune из PartyInventory в открытую ячейку Rune Tablet.
 */
export function installRuneInTablet(
  campaign: CampaignState,
  runeInstanceId: string,
  slotIndex: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; reason?: string } {
  const tablet = ensureRuneTabletSynced(campaign, config);
  const inst = campaign.itemsByInstanceId[runeInstanceId];
  if (!inst) return { ok: false, reason: 'Руна не найдена.' };
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, reason: 'Для установки в Rune Tablet руна должна находиться в PartyInventory (§144.3).' };
  }
  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (!def || (def.category !== 'worker_rune' && def.category !== 'hero_rune')) {
    return { ok: false, reason: 'В Rune Tablet можно помещать только Worker Runes и Hero Runes (§144.3).' };
  }
  const slot = tablet.slots[slotIndex];
  if (!slot) {
    return {
      ok: false,
      reason: `Ячейка Rune Tablet #${slotIndex + 1} ещё не открыта текущим уровнем Аватара (§144.1).`,
    };
  }
  if (slot.runeInstanceId) {
    return {
      ok: false,
      reason: `Ячейка #${slotIndex + 1} занята; сначала освободите её (для Hero Rune — сняв экипировку героя §144.5).`,
    };
  }

  // Не допускаем установку двух рун одного и того же HeroId одновременно
  if (def.category === 'hero_rune' && def.runeHeroId) {
    const duplicateHeroSlot = tablet.slots.find((s) => {
      if (!s.runeInstanceId) return false;
      const otherInst = campaign.itemsByInstanceId[s.runeInstanceId];
      const otherDef = otherInst ? PROTOTYPE_ITEMS[otherInst.definitionId] : undefined;
      return otherDef?.runeHeroId === def.runeHeroId;
    });
    if (duplicateHeroSlot) {
      return {
        ok: false,
        reason: `Руна героя "${def.runeHeroNameRu ?? def.runeHeroId}" уже установлена в Rune Tablet.`,
      };
    }
  }

  slot.runeInstanceId = runeInstanceId;
  inst.location = { kind: 'rune_tablet', slotIndex };
  return { ok: true };
}

/**
 * §144.1, §144.5, §144.10 #14: Снятие руны из Rune Tablet обратно в PartyInventory.
 * Для Hero Rune строго запрещено, если на связанном герое остаётся экипировка!
 */
export function removeRuneFromTablet(
  campaign: CampaignState,
  slotIndex: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; reason?: string } {
  const tablet = ensureRuneTabletSynced(campaign, config);
  const slot = tablet.slots[slotIndex];
  if (!slot || !slot.runeInstanceId) {
    return { ok: false, reason: 'Указанная ячейка Rune Tablet пуста.' };
  }

  const inst = campaign.itemsByInstanceId[slot.runeInstanceId];
  const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : undefined;

  if (def?.category === 'hero_rune' && def.runeHeroId) {
    const hero = campaign.heroes[def.runeHeroId];
    if (hero) {
      const equippedCount = Object.values(hero.equipment).filter((id) => id !== null).length;
      if (equippedCount > 0) {
        return {
          ok: false,
          reason: `Нельзя заменить или снять Hero Rune "${def.nameRu}": с героя "${hero.nameRu}" сначала нужно снять всю экипировку (${equippedCount} поз.) в PartyInventory (§144.1, §144.5).`,
        };
      }
      campaign.activePartyHeroIds = campaign.activePartyHeroIds.filter((id) => id !== hero.heroId);
    }
  }

  if (inst) {
    inst.location = { kind: 'party_inventory' };
  }
  slot.runeInstanceId = null;
  return { ok: true };
}

/**
 * Проверяет, активна ли в Rune Tablet рабочая руна указанного народа (§144.10 #1-2).
 */
export function hasActiveWorkerRuneForRace(
  campaign: CampaignState,
  raceId: PlayableRaceId
): { active: boolean; runeLevel: number } {
  const slots = campaign.runeTablet?.slots ?? [];
  let maxLevel = 0;
  for (const s of slots) {
    if (!s.runeInstanceId) continue;
    const inst = campaign.itemsByInstanceId[s.runeInstanceId];
    if (!inst || inst.location.kind !== 'rune_tablet') continue;
    const def = PROTOTYPE_ITEMS[inst.definitionId];
    if (def?.category === 'worker_rune' && def.runeRaceId === raceId) {
      maxLevel = Math.max(maxLevel, def.runeLevel ?? 1);
    }
  }
  return { active: maxLevel > 0, runeLevel: maxLevel };
}

/**
 * §144.4, §144.10 #2, #4: Захват/активация Rune Monument в мире требует активной Worker Rune этого народа в Rune Tablet.
 */
export function captureRuneMonument(
  campaign: CampaignState,
  map: MapInstanceState,
  monumentObjectId: string
): { ok: boolean; reason?: string } {
  const obj = map.worldObjects?.[monumentObjectId];
  if (!obj || obj.kind !== 'rune_monument' || !obj.monumentRaceId) {
    return { ok: false, reason: 'Rune Monument не найден на активной карте.' };
  }
  const check = hasActiveWorkerRuneForRace(campaign, obj.monumentRaceId);
  if (!check.active) {
    return {
      ok: false,
      reason: `Нельзя активировать "${obj.nameRu}": рабочая руна народа ${obj.monumentRaceId} не установлена в Rune Tablet (§144.10 #1-2).`,
    };
  }
  obj.captured = true;
  obj.activated = true;
  return { ok: true };
}

/**
 * §144.5, §144.10 #12: Гибель призванного героя НЕ уничтожает его экипировку и сохраняет HeroState для повторного призыва.
 */
export function markRuneHeroFallen(
  campaign: CampaignState,
  heroId: string
): { ok: boolean; preservedEquipmentCount: number; reason?: string } {
  if (heroId === campaign.avatarId) {
    return { ok: false, preservedEquipmentCount: 0, reason: 'Для Аватара используется Stone of Souls (§288).' };
  }
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, preservedEquipmentCount: 0, reason: 'Герой не найден.' };

  hero.hp = 0;
  hero.deathState.lifecycle = 'Dead';
  campaign.activePartyHeroIds = campaign.activePartyHeroIds.filter((id) => id !== heroId);
  const preservedEquipmentCount = Object.values(hero.equipment).filter((id) => id !== null).length;

  return { ok: true, preservedEquipmentCount };
}

/**
 * §144.4–144.5, §144.10 #3, #5, #13, §317.11 #7:
 * Призыв или повторный призыв конкретного героя по Hero Rune у отдельного Hero Monument.
 * Сохраняет экипировку героя без дублирования предметов.
 */
export function summonOrResummonRuneHeroAtMonument(params: {
  campaign: CampaignState;
  map: MapInstanceState;
  monumentObjectId: string;
  runeInstanceId: string;
  settlement?: LocalSettlementState;
  runePowerCost?: number;
  baseSummonTimeSec?: number;
  config?: ProvisionalBalanceConfig;
}): {
  ok: boolean;
  hero?: HeroState;
  resummoned: boolean;
  effectiveSummonTimeSec: number;
  reason?: string;
} {
  const { campaign, map, monumentObjectId, runeInstanceId, settlement } = params;
  const config = params.config ?? DEFAULT_WORKING_ASSUMPTIONS;
  const baseTime = params.baseSummonTimeSec ?? 6;
  const runePowerCost = params.runePowerCost ?? 15;

  const monument = map.worldObjects?.[monumentObjectId];
  if (!monument || monument.kind !== 'hero_monument') {
    return {
      ok: false,
      resummoned: false,
      effectiveSummonTimeSec: 0,
      reason: 'Для призыва героя требуется отдельный Hero Monument на карте (§144.4, §144.10 #5).',
    };
  }

  const inst = campaign.itemsByInstanceId[runeInstanceId];
  if (!inst || inst.location.kind !== 'rune_tablet') {
    return {
      ok: false,
      resummoned: false,
      effectiveSummonTimeSec: 0,
      reason: 'Hero Rune не установлена в Rune Tablet (§144.10 #1).',
    };
  }

  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (!def || def.category !== 'hero_rune' || !def.runeHeroId) {
    return {
      ok: false,
      resummoned: false,
      effectiveSummonTimeSec: 0,
      reason: 'Выбранная руна не является Hero Rune.',
    };
  }

  const currentRp = settlement ? settlement.runePower : runePowerCost;
  const effectiveSummonTimeSec = computeMonumentSummonTimeSec(baseTime, runePowerCost, currentRp, config);
  if (settlement) {
    settlement.runePower = Math.max(0, settlement.runePower - Math.min(settlement.runePower, runePowerCost));
  }

  const existing = campaign.heroes[def.runeHeroId];
  if (existing) {
    if (campaign.activePartyHeroIds.includes(existing.heroId) && existing.deathState.lifecycle === 'Alive') {
      return {
        ok: false,
        resummoned: false,
        effectiveSummonTimeSec: 0,
        reason: `Герой "${existing.nameRu}" уже призван и активен.`,
      };
    }
    if (
      !campaign.activePartyHeroIds.includes(existing.heroId) &&
      campaign.activePartyHeroIds.length >= config.maxActivePartyHeroes
    ) {
      return {
        ok: false,
        resummoned: false,
        effectiveSummonTimeSec: 0,
        reason: `Достигнут лимит активной группы героев (${config.maxActivePartyHeroes}).`,
      };
    }
    // Повторный призыв: возвращаем героя с сохранённой экипировкой без создания копий (§144.5, §317.11 #7)
    existing.deathState.lifecycle = 'Alive';
    existing.hp = existing.maxHp;
    existing.mana = existing.maxMana;
    if (!campaign.activePartyHeroIds.includes(existing.heroId)) {
      campaign.activePartyHeroIds.push(existing.heroId);
    }
    return { ok: true, hero: existing, resummoned: true, effectiveSummonTimeSec };
  }

  const created = summonCompanionHeroToParty({
    campaign,
    heroId: def.runeHeroId,
    nameRu: def.runeHeroNameRu ?? `Призванный герой (${def.runeHeroId})`,
    config,
  });
  if (!created.ok || !created.hero) {
    return {
      ok: false,
      resummoned: false,
      effectiveSummonTimeSec: 0,
      reason: created.reason ?? 'Не удалось призвать героя.',
    };
  }
  return { ok: true, hero: created.hero, resummoned: false, effectiveSummonTimeSec };
}

/**
 * §144.6, §144.10 #6-7: Постепенное восстановление Rune Power на активной карте.
 */
export function tickRunePowerRecovery(
  map: MapInstanceState,
  settlement: LocalSettlementState,
  dtSec: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { recovered: number; runePower: number; frozen: boolean } {
  if (map.lifecycle !== 'RUNNING' || settlement.frozenOnInactiveMap || dtSec <= 0) {
    return { recovered: 0, runePower: settlement.runePower, frozen: true };
  }
  const prev = settlement.runePower;
  settlement.runePower = Math.min(
    settlement.maxRunePower,
    Number((settlement.runePower + config.runePowerRegenPerSec * dtSec).toFixed(2))
  );
  return {
    recovered: Number((settlement.runePower - prev).toFixed(2)),
    runePower: settlement.runePower,
    frozen: false,
  };
}

/**
 * §144.4, §144.6, §144.10 #7: Нехватка Rune Power увеличивает время призыва (не конвертируется в ману/золото).
 */
export function computeMonumentSummonTimeSec(
  baseTimeSec: number,
  requiredRunePower: number,
  currentRunePower: number,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): number {
  if (currentRunePower >= requiredRunePower) {
    return Number(baseTimeSec.toFixed(2));
  }
  return Number((baseTimeSec * config.lowRunePowerTimeMultiplier).toFixed(2));
}

/**
 * §144.7, §144.10 #15: Предупреждение перед продажей или уничтожением активной/критической руны.
 */
export function previewRuneSaleOrDestructionWarning(
  campaign: CampaignState,
  runeInstanceId: string
): { isRune: boolean; requiresExtraConfirm: boolean; warningRu?: string } {
  const inst = campaign.itemsByInstanceId[runeInstanceId];
  const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : undefined;
  if (!inst || !def || (def.category !== 'worker_rune' && def.category !== 'hero_rune')) {
    return { isRune: false, requiresExtraConfirm: false };
  }
  if (inst.location.kind === 'rune_tablet') {
    return {
      isRune: true,
      requiresExtraConfirm: true,
      warningRu: `Внимание (§144.7): руна "${def.nameRu}" сейчас активна в Rune Tablet. Сначала извлеките её и подтвердите потерю доступа к монументу/герою.`,
    };
  }
  return {
    isRune: true,
    requiresExtraConfirm: true,
    warningRu: `Предупреждение (§144.7): продажа или уничтожение руны "${def.nameRu}" необратимо лишит доступа к связанному монументу или герою.`,
  };
}

/**
 * §146.3, §146.5, §146.10 #2, §146.13 #3-6:
 * Активация Building Plan или Unit Plan из PartyInventory в постоянный Plan Book выбранного народа.
 */
export function activatePlanFromInventory(
  campaign: CampaignState,
  instanceId: string,
  targetRaceId: PlayableRaceId
): { ok: boolean; planId?: string; reason?: string } {
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!inst) return { ok: false, reason: 'Свиток плана не найден.' };
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, reason: 'Для активации свиток плана должен находиться в PartyInventory (§146.5).' };
  }
  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (!def || (def.category !== 'building_plan' && def.category !== 'unit_plan') || !def.planId) {
    return { ok: false, reason: 'Предмет не является строительным или военным планом (§146.2).' };
  }
  const planDef = PROTOTYPE_PLANS[def.planId];
  if (!planDef) return { ok: false, reason: `Определение плана ${def.planId} не найдено.` };

  if (planDef.raceId !== targetRaceId) {
    return {
      ok: false,
      reason: `План "${planDef.displayNameRu}" принадлежит народу ${planDef.raceId} и не может быть активирован в разделе ${targetRaceId} (§146.3, §146.13 #4).`,
    };
  }

  if (!campaign.planBook) campaign.planBook = {};
  if (campaign.planBook[planDef.planId]?.status === 'activated') {
    return {
      ok: false,
      reason: `План "${planDef.displayNameRu}" уже активирован в Plan Book — повторная активация не даёт эксплойта (§146.10 #2).`,
    };
  }

  campaign.planBook[planDef.planId] = {
    planId: planDef.planId,
    status: 'activated',
    activatedAtIso: new Date().toISOString(),
  };
  if (inst.quantity > 1) {
    inst.quantity -= 1;
  } else {
    delete campaign.itemsByInstanceId[instanceId];
  }
  return { ok: true, planId: planDef.planId };
}

/**
 * §146.6, §146.13 #1-2, #7-9:
 * Раздельная 5-ступенчатая проверка доступности объекта плана с точными русскоязычными причинами.
 */
export function evaluatePlanAvailability(
  campaign: CampaignState,
  map: MapInstanceState,
  settlement: LocalSettlementState | null,
  planId: string
): {
  available: boolean;
  checks: {
    knowledge: boolean;
    monument: boolean;
    infrastructure: boolean;
    resources: boolean;
    capacity: boolean;
  };
  missingReasonsRu: string[];
} {
  const planDef = PROTOTYPE_PLANS[planId];
  if (!planDef) {
    return {
      available: false,
      checks: { knowledge: false, monument: false, infrastructure: false, resources: false, capacity: false },
      missingReasonsRu: ['Неизвестный идентификатор плана.'],
    };
  }

  const missingReasonsRu: string[] = [];

  // 1. Knowledge check (§146.6)
  const ownActivated = campaign.planBook?.[planId]?.status === 'activated';
  const missingPrereqPlans = (planDef.requiredPlanIds ?? []).filter(
    (reqId) => campaign.planBook?.[reqId]?.status !== 'activated'
  );
  const knowledge = ownActivated && missingPrereqPlans.length === 0;
  if (!ownActivated) {
    missingReasonsRu.push(`План "${planDef.displayNameRu}" ещё не активирован в Plan Book (§146.5).`);
  }
  for (const reqId of missingPrereqPlans) {
    missingReasonsRu.push(
      `Требуется предварительный план: ${PROTOTYPE_PLANS[reqId]?.displayNameRu ?? reqId} (§146.6).`
    );
  }

  // 2. Monument & Worker Rune check (§144.10 #2, §146.6)
  let monument = true;
  if (planDef.requiresMonument) {
    const runeCheck = hasActiveWorkerRuneForRace(campaign, planDef.raceId);
    const hasCapturedMonument = Object.values(map.worldObjects ?? {}).some(
      (obj) => obj.kind === 'rune_monument' && obj.monumentRaceId === planDef.raceId && obj.captured
    );
    if (!runeCheck.active) {
      monument = false;
      missingReasonsRu.push(`Рабочая руна народа ${planDef.raceId} не установлена в Rune Tablet (§144.10).`);
    } else if (!hasCapturedMonument) {
      monument = false;
      missingReasonsRu.push(`Не захвачен Rune Monument народа ${planDef.raceId} на активной карте (§144.4).`);
    }
  }

  // 3. Infrastructure check (§146.6)
  let infrastructure = true;
  if (!settlement || settlement.raceId !== planDef.raceId) {
    infrastructure = false;
    missingReasonsRu.push(`На карте нет активного поселения народа ${planDef.raceId}.`);
  } else {
    for (const reqCat of planDef.requiredBuildingCategories ?? []) {
      const hasOperational = Object.values(settlement.buildings ?? {}).some(
        (b) => b.category === reqCat && b.operational
      );
      if (!hasOperational) {
        infrastructure = false;
        missingReasonsRu.push(`Требуется исправное здание категории "${reqCat}" (§146.6).`);
      }
    }
  }

  // 4. Resource check (§146.6)
  let resources = true;
  if (settlement && planDef.requiredResources) {
    for (const [resKey, amt] of Object.entries(planDef.requiredResources) as Array<
      [import('./types').RaceResourceType, number]
    >) {
      const have = settlement.localResources[resKey] ?? 0;
      if (have < amt) {
        resources = false;
        missingReasonsRu.push(`Недостаточно ресурса ${resKey}: нужно ${amt}, есть ${have}.`);
      }
    }
  } else if (!settlement) {
    resources = false;
  }

  // 5. Capacity check (§146.6)
  let capacity = true;
  if (planDef.requiredMilitarySlots && planDef.requiredMilitarySlots > 0) {
    if (!settlement || settlement.militaryUsed + planDef.requiredMilitarySlots > settlement.militaryCap) {
      capacity = false;
      missingReasonsRu.push(
        `Недостаточно MilitaryCap (нужно +${planDef.requiredMilitarySlots}, сейчас ${settlement?.militaryUsed ?? 0}/${settlement?.militaryCap ?? 0}).`
      );
    }
  }

  return {
    available: knowledge && monument && infrastructure && resources && capacity,
    checks: { knowledge, monument, infrastructure, resources, capacity },
    missingReasonsRu,
  };
}
