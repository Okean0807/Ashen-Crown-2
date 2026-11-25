/**
 * ASHEN CROWN — Локальная экономика поселений, 4-стадийная модель ресурсов и роль Food (§§338–339, §352.4).
 *
 * Гарантии:
 * - Атомарные переходы AtSource -> Carried -> Delivered -> Consumed по transactionId (§338.2)
 * - Переназначение рабочего не уничтожает груз Carried (§338.3, §339.5)
 * - Food не является периодическим upkeep: повышает MilitaryCap и лечит через Food Store (§338.5, §339.1)
 * - Неактивная карта замораживает производственные очереди без фоновой добычи (§338.7)
 */

import { DEFAULT_WORKING_ASSUMPTIONS, PLAYABLE_RACES, type ProvisionalBalanceConfig } from './config';
import type {
  CampaignState,
  LocalSettlementState,
  MapInstanceState,
  PlayableRaceId,
  RaceResourceCapability,
  RaceResourceType,
  SettlementStopReason,
  SquadInstance,
} from './types';

function addStopReason(settlement: LocalSettlementState, reason: SettlementStopReason) {
  if (!settlement.stopReasons.includes(reason)) {
    settlement.stopReasons.push(reason);
  }
}

function clearStopReason(settlement: LocalSettlementState, reason: SettlementStopReason) {
  settlement.stopReasons = settlement.stopReasons.filter((r) => r !== reason);
}

/**
 * §338.2: Стадия 1 -> 2 (AtSource -> Carried). Идемпотентна по transactionId.
 */
export function extractResourceToWorkerCarry(
  campaign: CampaignState,
  settlement: LocalSettlementState,
  workerId: string,
  baseBatchAmount: number,
  transactionId: string
): { ok: boolean; carriedAmount: number; reason?: string; stopReason?: SettlementStopReason } {
  if (campaign.processedEventIds.includes(transactionId)) {
    return { ok: false, carriedAmount: 0, reason: 'Транзакция добычи уже обработана (§338.2).' };
  }
  if (settlement.frozenOnInactiveMap) {
    return { ok: false, carriedAmount: 0, reason: 'Карта неактивна: добыча остановлена (§338.7).' };
  }
  const worker = settlement.workers[workerId];
  if (!worker) return { ok: false, carriedAmount: 0, reason: 'Работник не найден.' };
  if (worker.carrying) {
    return { ok: false, carriedAmount: 0, reason: 'Работник уже несёт не доставленный груз.' };
  }
  if (!worker.assignedDepositId) {
    addStopReason(settlement, 'no_free_worker');
    return { ok: false, carriedAmount: 0, reason: 'Работнику не назначен источник.' };
  }
  const deposit = settlement.deposits[worker.assignedDepositId];
  if (!deposit) {
    return { ok: false, carriedAmount: 0, reason: 'Источник ресурса не найден.' };
  }
  if (!deposit.routeAccessible) {
    addStopReason(settlement, 'route_blocked');
    return {
      ok: false,
      carriedAmount: 0,
      stopReason: 'route_blocked',
      reason: 'Маршрут к источнику заблокирован (§338.9).',
    };
  }
  if (deposit.remainingAmount <= 0) {
    addStopReason(settlement, 'source_depleted');
    return {
      ok: false,
      carriedAmount: 0,
      stopReason: 'source_depleted',
      reason: 'Источник ресурса исчерпан (§338.9).',
    };
  }

  clearStopReason(settlement, 'route_blocked');
  clearStopReason(settlement, 'source_depleted');

  const scaled = Math.max(1, Math.floor(baseBatchAmount * deposit.extractionEfficiency));
  const actual = Math.min(deposit.remainingAmount, scaled);
  deposit.remainingAmount -= actual;

  worker.carrying = {
    resourceType: deposit.resourceType,
    amount: actual,
    stage: 'Carried',
    sourceDepositId: deposit.depositId,
  };
  campaign.processedEventIds.push(transactionId);

  return { ok: true, carriedAmount: actual };
}

/**
 * §338.2: Стадия 2 -> 3 (Carried -> Delivered). До доставки ресурс не входит в баланс поселения.
 */
export function deliverWorkerCarryToSettlement(
  campaign: CampaignState,
  settlement: LocalSettlementState,
  workerId: string,
  transactionId: string
): { ok: boolean; deliveredAmount: number; resourceType?: RaceResourceType; reason?: string } {
  if (campaign.processedEventIds.includes(transactionId)) {
    return { ok: false, deliveredAmount: 0, reason: 'Транзакция доставки уже обработана (§338.2).' };
  }
  const worker = settlement.workers[workerId];
  if (!worker || !worker.carrying) {
    return { ok: false, deliveredAmount: 0, reason: 'У работника нет груза в состоянии Carried.' };
  }

  const deposit = settlement.deposits[worker.carrying.sourceDepositId];
  if (deposit && !deposit.routeAccessible) {
    addStopReason(settlement, 'route_blocked');
    return { ok: false, deliveredAmount: 0, reason: 'Маршрут доставки заблокирован — груз остаётся на руках (§338.3).' };
  }

  const { resourceType, amount } = worker.carrying;
  settlement.localResources[resourceType] = (settlement.localResources[resourceType] ?? 0) + amount;
  worker.carrying = null;
  campaign.processedEventIds.push(transactionId);
  clearStopReason(settlement, 'route_blocked');

  return { ok: true, deliveredAmount: amount, resourceType };
}

/**
 * §338.3, §339.5: Безопасное переназначение работника — НЕ уничтожает уже собранный груз Carried.
 */
export function reassignWorkerSafe(
  settlement: LocalSettlementState,
  workerId: string,
  newDepositId: string | null
): { ok: boolean; preservedCarryAmount: number; reason?: string } {
  const worker = settlement.workers[workerId];
  if (!worker) return { ok: false, preservedCarryAmount: 0, reason: 'Работник не найден.' };
  if (newDepositId !== null && !settlement.deposits[newDepositId]) {
    return { ok: false, preservedCarryAmount: 0, reason: 'Целевой источник ресурса не найден.' };
  }
  worker.assignedDepositId = newDepositId;
  return {
    ok: true,
    preservedCarryAmount: worker.carrying?.amount ?? 0,
  };
}

/**
 * §338.5, §339.1: Расход Food на повышение MilitaryCap через Headquarters (без периодического upkeep).
 */
export function upgradeMilitaryCapWithFood(
  campaign: CampaignState,
  settlement: LocalSettlementState,
  transactionId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; newMilitaryCap: number; foodSpent: number; reason?: string } {
  if (campaign.processedEventIds.includes(transactionId)) {
    return {
      ok: false,
      newMilitaryCap: settlement.militaryCap,
      foodSpent: 0,
      reason: 'Операция уже выполнена.',
    };
  }
  const currentFood = settlement.localResources.food ?? 0;
  const cost = config.foodPerMilitaryCapStep;
  if (currentFood < cost) {
    addStopReason(settlement, 'insufficient_input');
    return {
      ok: false,
      newMilitaryCap: settlement.militaryCap,
      foodSpent: 0,
      reason: `Недостаточно Food: нужно ${cost}, есть ${currentFood}.`,
    };
  }
  settlement.localResources.food = currentFood - cost;
  settlement.militaryCap += config.militaryCapStepAmount;
  campaign.processedEventIds.push(transactionId);
  clearStopReason(settlement, 'insufficient_input');

  return {
    ok: true,
    newMilitaryCap: settlement.militaryCap,
    foodSpent: cost,
  };
}

/**
 * §338.5, §339.1, §42.1: Food Store лечит только живых раненых бойцов отряда за счёт Food (не воскрешает мёртвых).
 */
export function healSquadWithFoodStore(
  campaign: CampaignState,
  settlement: LocalSettlementState,
  squad: SquadInstance,
  transactionId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; unitsHealed: number; foodSpent: number; reason?: string } {
  if (campaign.processedEventIds.includes(transactionId)) {
    return { ok: false, unitsHealed: 0, foodSpent: 0, reason: 'Операция лечения уже выполнена.' };
  }
  const woundedLiving = squad.units.filter((u) => u.alive && u.hp < u.maxHp);
  if (woundedLiving.length === 0) {
    return { ok: false, unitsHealed: 0, foodSpent: 0, reason: 'Нет живых раненых бойцов в отряде.' };
  }

  let availableFood = settlement.localResources.food ?? 0;
  if (availableFood < config.foodPerUnitHeal) {
    return {
      ok: false,
      unitsHealed: 0,
      foodSpent: 0,
      reason: `Недостаточно Food для Food Store (нужно минимум ${config.foodPerUnitHeal}).`,
    };
  }

  let unitsHealed = 0;
  let foodSpent = 0;
  for (const unit of woundedLiving) {
    if (availableFood < config.foodPerUnitHeal) break;
    availableFood -= config.foodPerUnitHeal;
    foodSpent += config.foodPerUnitHeal;
    unit.hp = unit.maxHp;
    unitsHealed += 1;
  }

  settlement.localResources.food = availableFood;
  campaign.processedEventIds.push(transactionId);

  return { ok: true, unitsHealed, foodSpent };
}

/**
 * §338.5, §338.9: Постановка отряда в очередь производства с явной проверкой MilitaryCap, ресурсов и Rune Power.
 */
export function enqueueSquadProduction(
  settlement: LocalSettlementState,
  orderId: string,
  squadDefId: string,
  resourceCost: Partial<Record<RaceResourceType, number>>,
  requiresRunePower: number,
  militarySlotsNeeded: number,
  buildTimeSec: number
): { ok: boolean; stopReason?: SettlementStopReason; reason?: string } {
  if (settlement.frozenOnInactiveMap) {
    addStopReason(settlement, 'paused');
    return { ok: false, stopReason: 'paused', reason: 'Карта неактивна: очередь заморожена (§338.7).' };
  }
  if (settlement.militaryUsed + militarySlotsNeeded > settlement.militaryCap) {
    addStopReason(settlement, 'cap_reached');
    return {
      ok: false,
      stopReason: 'cap_reached',
      reason: `Достигнут MilitaryCap (${settlement.militaryUsed}/${settlement.militaryCap}). Повысьте лимит через Food (§339.1).`,
    };
  }
  if (settlement.runePower < requiresRunePower) {
    addStopReason(settlement, 'insufficient_rune_power');
    return {
      ok: false,
      stopReason: 'insufficient_rune_power',
      reason: `Недостаточно Rune Power (${settlement.runePower}/${requiresRunePower}) — не смешивается с маной (§338.5).`,
    };
  }

  const raceProfile = PLAYABLE_RACES[settlement.raceId];
  for (const [resKey, amt] of Object.entries(resourceCost) as Array<[RaceResourceType, number]>) {
    if (!raceProfile.resourcesUsed.includes(resKey)) {
      return {
        ok: false,
        stopReason: 'missing_building',
        reason: `Ресурс ${resKey} не используется экономикой расы ${raceProfile.nameRu} (§339.3).`,
      };
    }
    if ((settlement.localResources[resKey] ?? 0) < amt) {
      addStopReason(settlement, 'insufficient_input');
      return {
        ok: false,
        stopReason: 'insufficient_input',
        reason: `Недостаточно ${resKey}: требуется ${amt}.`,
      };
    }
  }

  if (settlement.buildings) {
    const barracks = Object.values(settlement.buildings).find((b) => b.category === 'barracks');
    if (barracks && !barracks.operational) {
      addStopReason(settlement, barracks.constructionRemainingSec > 0 ? 'missing_building' : 'building_damaged');
      return {
        ok: false,
        stopReason: barracks.constructionRemainingSec > 0 ? 'missing_building' : 'building_damaged',
        reason:
          barracks.constructionRemainingSec > 0
            ? `Строительство "${barracks.nameRu}" ещё не завершено (§15.6).`
            : `Здание "${barracks.nameRu}" повреждено и требует ремонта (§15.8, §338.9).`,
      };
    }
  }

  for (const [resKey, amt] of Object.entries(resourceCost) as Array<[RaceResourceType, number]>) {
    settlement.localResources[resKey] = (settlement.localResources[resKey] ?? 0) - amt;
  }
  settlement.runePower -= requiresRunePower;
  settlement.militaryUsed += militarySlotsNeeded;
  settlement.productionQueue.push({
    orderId,
    squadDefId,
    remainingTimeSec: buildTimeSec,
    totalTimeSec: buildTimeSec,
    requiresRunePower,
    pausedReason: null,
  });

  clearStopReason(settlement, 'cap_reached');
  clearStopReason(settlement, 'insufficient_rune_power');
  clearStopReason(settlement, 'insufficient_input');
  clearStopReason(settlement, 'building_damaged');
  clearStopReason(settlement, 'missing_building');
  return { ok: true };
}

/**
 * §338.7, §15.6: Прогресс очереди производства и незавершённого строительства только пока карта RUNNING.
 * При уходе с карты frozenOnInactiveMap = true — таймеры сохраняются точно без фоновой накрутки.
 */
export function tickSettlementProduction(
  map: MapInstanceState,
  settlement: LocalSettlementState,
  dtSec: number
): { completedOrderIds: string[]; completedBuildingIds: string[]; frozen: boolean } {
  if (map.lifecycle !== 'RUNNING' || settlement.frozenOnInactiveMap || dtSec <= 0) {
    return { completedOrderIds: [], completedBuildingIds: [], frozen: true };
  }

  const completedOrderIds: string[] = [];
  const completedBuildingIds: string[] = [];

  if (settlement.buildings) {
    for (const b of Object.values(settlement.buildings)) {
      if (b.constructionRemainingSec > 0) {
        b.constructionRemainingSec = Math.max(0, Number((b.constructionRemainingSec - dtSec).toFixed(3)));
        if (b.constructionRemainingSec <= 0 && b.hp > 0) {
          b.operational = true;
          completedBuildingIds.push(b.buildingId);
        }
      }
    }
  }

  const nextQueue = [];
  for (const entry of settlement.productionQueue) {
    if (entry.pausedReason) {
      nextQueue.push(entry);
      continue;
    }
    entry.remainingTimeSec = Math.max(0, Number((entry.remainingTimeSec - dtSec).toFixed(3)));
    if (entry.remainingTimeSec <= 0) {
      completedOrderIds.push(entry.orderId);
    } else {
      nextQueue.push(entry);
    }
  }
  settlement.productionQueue = nextQueue;
  return { completedOrderIds, completedBuildingIds, frozen: false };
}

/**
 * §15.5, §15.6: Начало строительства здания строго на разрешённой строительной площадке (не в произвольной точке)
 * и с ненулевым временем постройки.
 */
export function startBuildingConstruction(params: {
  settlement: LocalSettlementState;
  slotId: string;
  buildingId: string;
  category: import('./types').SettlementBuildingCategory;
  nameRu: string;
  woodCost: number;
  stoneCost: number;
  buildTimeSec: number;
  maxHp?: number;
}): { ok: boolean; reason?: string } {
  const { settlement, slotId, buildingId, category, nameRu, woodCost, stoneCost, buildTimeSec } = params;
  if (settlement.frozenOnInactiveMap) {
    return { ok: false, reason: 'Карта неактивна: строительство заморожено (§338.7).' };
  }
  const slot = settlement.buildingSlots?.[slotId];
  if (!slot) {
    return { ok: false, reason: `Строительная площадка "${slotId}" не найдена (§15.5).` };
  }
  if (slot.occupiedByBuildingId) {
    return { ok: false, reason: `Площадка "${slotId}" уже занята зданием ${slot.occupiedByBuildingId}.` };
  }
  if (!slot.allowedCategories.includes(category)) {
    return { ok: false, reason: `На площадке "${slotId}" запрещено строить категорию ${category} (§15.5).` };
  }
  if ((settlement.localResources.wood ?? 0) < woodCost || (settlement.localResources.stone ?? 0) < stoneCost) {
    addStopReason(settlement, 'insufficient_input');
    return { ok: false, reason: `Недостаточно ресурсов для строительства (нужно ${woodCost} Wood, ${stoneCost} Stone).` };
  }

  settlement.localResources.wood = (settlement.localResources.wood ?? 0) - woodCost;
  settlement.localResources.stone = (settlement.localResources.stone ?? 0) - stoneCost;
  if (!settlement.buildings) settlement.buildings = {};

  const maxHp = params.maxHp ?? 250;
  settlement.buildings[buildingId] = {
    buildingId,
    slotId,
    category,
    nameRu,
    hp: maxHp,
    maxHp,
    operational: false,
    constructionRemainingSec: Math.max(1, buildTimeSec),
    constructionTotalSec: Math.max(1, buildTimeSec),
  };
  slot.occupiedByBuildingId = buildingId;
  clearStopReason(settlement, 'insufficient_input');
  return { ok: true };
}

/**
 * §15.8, §338.9, §338.11.5: Повреждение здания останавливает связанные очереди,
 * но НЕ уничтожает несвязанные ресурсные балансы поселения.
 */
export function damageSettlementBuilding(
  settlement: LocalSettlementState,
  buildingId: string,
  damage: number
): { ok: boolean; damaged: boolean; remainingHp: number; reason?: string } {
  const b = settlement.buildings?.[buildingId];
  if (!b) return { ok: false, damaged: false, remainingHp: 0, reason: 'Здание не найдено.' };
  b.hp = Math.max(0, b.hp - Math.max(0, damage));
  if (b.hp < b.maxHp * 0.5) {
    b.operational = false;
    addStopReason(settlement, 'building_damaged');
    if (b.category === 'barracks') {
      for (const entry of settlement.productionQueue) {
        entry.pausedReason = 'building_damaged';
      }
    }
  }
  return { ok: true, damaged: !b.operational, remainingHp: b.hp };
}

/**
 * §15.8: Ремонт здания — отдельный экономический процесс (за ресурсы, НЕ за Food Store и без лечения бойцов).
 */
export function repairSettlementBuilding(
  settlement: LocalSettlementState,
  buildingId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; repairedHp: number; woodSpent: number; reason?: string } {
  const b = settlement.buildings?.[buildingId];
  if (!b) return { ok: false, repairedHp: 0, woodSpent: 0, reason: 'Здание не найдено.' };
  if (b.constructionRemainingSec > 0) {
    return { ok: false, repairedHp: 0, woodSpent: 0, reason: 'Нельзя ремонтировать незавершённую стройку.' };
  }
  if (b.hp >= b.maxHp) {
    return { ok: false, repairedHp: 0, woodSpent: 0, reason: 'Здание уже полностью исправно.' };
  }
  const availableWood = settlement.localResources.wood ?? 0;
  if (availableWood < config.buildingRepairCostWood) {
    addStopReason(settlement, 'insufficient_input');
    return {
      ok: false,
      repairedHp: 0,
      woodSpent: 0,
      reason: `Недостаточно Wood для ремонта (${availableWood}/${config.buildingRepairCostWood}).`,
    };
  }

  const prevHp = b.hp;
  settlement.localResources.wood = availableWood - config.buildingRepairCostWood;
  b.hp = Math.min(b.maxHp, b.hp + config.buildingRepairHpStep);
  if (b.hp >= b.maxHp * 0.5) {
    b.operational = true;
    clearStopReason(settlement, 'building_damaged');
    if (b.category === 'barracks') {
      for (const entry of settlement.productionQueue) {
        if (entry.pausedReason === 'building_damaged') entry.pausedReason = null;
      }
    }
  }
  clearStopReason(settlement, 'insufficient_input');
  return {
    ok: true,
    repairedHp: b.hp - prevHp,
    woodSpent: config.buildingRepairCostWood,
  };
}

/**
 * §14.6: Пополнение потерянных бойцов отряда из ресурсов поселения:
 * - запрещено в активном бою;
 * - требует исправной казармы (barracks);
 * - не воскрешает автоматически особого командира (npcTier === 'commander') и не восстанавливает уникальные предметы;
 * - тратит локальные Wood и Iron (отдельно от Food Store лечения живых раненых §42.1).
 */
export function replenishSquadFromSettlement(params: {
  campaign: CampaignState;
  settlement: LocalSettlementState;
  squad: SquadInstance;
  transactionId: string;
  inCombat: boolean;
  config?: ProvisionalBalanceConfig;
}): {
  ok: boolean;
  replenishedUnits: number;
  woodSpent: number;
  ironSpent: number;
  reason?: string;
  stopReason?: SettlementStopReason;
} {
  const { campaign, settlement, squad, transactionId, inCombat } = params;
  const config = params.config ?? DEFAULT_WORKING_ASSUMPTIONS;

  if (campaign.processedEventIds.includes(transactionId)) {
    return {
      ok: false,
      replenishedUnits: 0,
      woodSpent: 0,
      ironSpent: 0,
      reason: 'Транзакция пополнения отряда уже выполнена.',
    };
  }
  if (settlement.frozenOnInactiveMap) {
    return {
      ok: false,
      replenishedUnits: 0,
      woodSpent: 0,
      ironSpent: 0,
      stopReason: 'paused',
      reason: 'Карта неактивна: пополнение заморожено (§338.7).',
    };
  }
  if (inCombat) {
    return {
      ok: false,
      replenishedUnits: 0,
      woodSpent: 0,
      ironSpent: 0,
      reason: 'Пополнение отряда невозможно во время активного боя (§14.6).',
    };
  }
  if (squad.npcTier === 'commander') {
    return {
      ok: false,
      replenishedUnits: 0,
      woodSpent: 0,
      ironSpent: 0,
      reason: 'Особый командир не восстанавливается автоматическим пополнением отряда (§14.6).',
    };
  }

  if (settlement.buildings) {
    const barracks = Object.values(settlement.buildings).find((b) => b.category === 'barracks');
    if (!barracks) {
      addStopReason(settlement, 'missing_building');
      return {
        ok: false,
        replenishedUnits: 0,
        woodSpent: 0,
        ironSpent: 0,
        stopReason: 'missing_building',
        reason: 'Отсутствует казарма для пополнения отряда (§14.6).',
      };
    }
    if (!barracks.operational) {
      const stopReason: SettlementStopReason =
        barracks.constructionRemainingSec > 0 ? 'missing_building' : 'building_damaged';
      addStopReason(settlement, stopReason);
      return {
        ok: false,
        replenishedUnits: 0,
        woodSpent: 0,
        ironSpent: 0,
        stopReason,
        reason:
          barracks.constructionRemainingSec > 0
            ? `Казарма "${barracks.nameRu}" ещё строится.`
            : `Казарма "${barracks.nameRu}" повреждена и требует ремонта для пополнения (§14.6, §15.8).`,
      };
    }
  }

  const targetMax = squad.maxUnitCount ?? squad.units.length;
  const deadSlots = squad.units.filter((u) => !u.alive || u.hp <= 0);
  const missingCount = Math.max(0, targetMax - squad.units.length);
  const needed = deadSlots.length + missingCount;

  if (needed <= 0) {
    return {
      ok: false,
      replenishedUnits: 0,
      woodSpent: 0,
      ironSpent: 0,
      reason: 'Отряд уже в полном составе — пополнение не требуется.',
    };
  }

  const availWood = settlement.localResources.wood ?? 0;
  const availIron = settlement.localResources.iron ?? 0;
  const costW = Math.max(1, config.squadReplenishUnitWood);
  const costI = Math.max(1, config.squadReplenishUnitIron);
  const maxAffordable = Math.min(needed, Math.floor(availWood / costW), Math.floor(availIron / costI));

  if (maxAffordable < 1) {
    addStopReason(settlement, 'insufficient_input');
    return {
      ok: false,
      replenishedUnits: 0,
      woodSpent: 0,
      ironSpent: 0,
      stopReason: 'insufficient_input',
      reason: `Недостаточно ресурсов для пополнения 1 бойца (нужно ${costW} Wood и ${costI} Iron).`,
    };
  }

  const woodSpent = maxAffordable * costW;
  const ironSpent = maxAffordable * costI;
  settlement.localResources.wood = availWood - woodSpent;
  settlement.localResources.iron = availIron - ironSpent;

  let remainingToRestore = maxAffordable;
  for (const deadUnit of deadSlots) {
    if (remainingToRestore <= 0) break;
    deadUnit.alive = true;
    deadUnit.hp = deadUnit.maxHp;
    remainingToRestore -= 1;
  }

  const templateUnit = squad.units[0];
  let idxCounter = squad.units.length + 1;
  while (remainingToRestore > 0) {
    const maxHp = templateUnit?.maxHp ?? 100;
    squad.units.push({
      unitId: `${squad.squadId}_u${idxCounter}`,
      creatureDefId: templateUnit?.creatureDefId ?? 'unit_proto_infantry',
      hp: maxHp,
      maxHp,
      alive: true,
    });
    idxCounter += 1;
    remainingToRestore -= 1;
  }

  campaign.processedEventIds.push(transactionId);
  clearStopReason(settlement, 'insufficient_input');
  clearStopReason(settlement, 'building_damaged');
  clearStopReason(settlement, 'missing_building');

  return {
    ok: true,
    replenishedUnits: maxAffordable,
    woodSpent,
    ironSpent,
  };
}

/**
 * §338.8: Аудит экономической проходимости поселения без выдачи «бесплатных» ресурсов.
 * Выявляет необратимый softlock (повреждённое ключевое здание при нехватке Wood на ремонт и отсутствии доступных источников Wood).
 */
export function validateSettlementEconomicPlayability(
  settlement: LocalSettlementState,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { playable: boolean; issues: string[] } {
  const issues: string[] = [];
  const woodAvail = settlement.localResources.wood ?? 0;
  const hasRecoverableWoodDeposit = Object.values(settlement.deposits).some(
    (d) => d.resourceType === 'wood' && d.remainingAmount > 0 && d.routeAccessible
  );

  if (settlement.buildings) {
    const brokenCritical = Object.values(settlement.buildings).filter(
      (b) =>
        (b.category === 'headquarters' || b.category === 'barracks') &&
        !b.operational &&
        b.constructionRemainingSec === 0
    );
    if (
      brokenCritical.length > 0 &&
      woodAvail < config.buildingRepairCostWood &&
      !hasRecoverableWoodDeposit
    ) {
      issues.push(
        `Экономический softlock (§338.8): ключевые здания (${brokenCritical
          .map((b) => b.nameRu)
          .join(', ')}) выведены из строя, Wood (${woodAvail}) меньше цены ремонта (${config.buildingRepairCostWood}), а доступные источники древесины исчерпаны или заблокированы.`
      );
    }
  }

  const allDepositsBlockedOrEmpty =
    Object.keys(settlement.deposits).length > 0 &&
    Object.values(settlement.deposits).every((d) => d.remainingAmount <= 0 || !d.routeAccessible);
  if (allDepositsBlockedOrEmpty && settlement.productionQueue.some((q) => q.pausedReason === 'building_damaged')) {
    issues.push(
      'Очередь производства остановлена повреждением здания при полном отсутствии доступных депозитов (§338.8).'
    );
  }

  return {
    playable: issues.length === 0,
    issues,
  };
}

/**
 * §339.2–339.3, §352.4: Возвращает детальный профиль ресурса для указанной расы
 * (разделяет использование ресурса, локальную добычу, эффективность собственной шахты, импорт и переработку).
 */
export function getRaceResourceCapability(
  raceId: PlayableRaceId,
  resource: RaceResourceType
): RaceResourceCapability {
  return PLAYABLE_RACES[raceId].resourceCapabilities[resource];
}

/**
 * §339.3 & §352.4: Проверяет, соответствует ли ресурсная стоимость постройки/отряда канонической матрице расы.
 * Например, не допускает Aria у Орков или Lenya у Тёмных эльфов, но разрешает Iron у Эльфов и Троллей
 * (с пометкой об отсутствии стандартной эффективной собственной Iron Mine).
 */
export function validateSettlementResourceCostForRace(
  raceId: PlayableRaceId,
  cost: Partial<Record<RaceResourceType, number>>
): { ok: boolean; errorsRu: string[]; warningsRu: string[] } {
  const profile = PLAYABLE_RACES[raceId];
  const errorsRu: string[] = [];
  const warningsRu: string[] = [];

  for (const [key, amount] of Object.entries(cost)) {
    if ((amount ?? 0) <= 0) continue;
    const res = key as RaceResourceType;
    const cap = profile.resourceCapabilities[res];
    if (!cap || !cap.used) {
      errorsRu.push(`Раса "${profile.nameRu}" не использует ресурс "${res}" (§339.3, §352.4).`);
    } else if (!cap.hasEfficientOwnExtraction) {
      warningsRu.push(
        `Раса "${profile.nameRu}" использует "${res}", но не имеет собственной эффективной шахты (${cap.noteRu}).`
      );
    }
  }

  return { ok: errorsRu.length === 0, errorsRu, warningsRu };
}



