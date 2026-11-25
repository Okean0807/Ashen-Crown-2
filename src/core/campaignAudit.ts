/**
 * ASHEN CROWN — Единая матрица требований/разблокировок (§258) и сквозной анти-тупиковый аудит кампании (§258.7, §262.4).
 *
 * Гарантии (v14.2 §§258, 262, 275.4–275.5):
 * - Возвращает ВСЕ критические коды причин недоступности (UnlockLockCode[]), а не только первую (§258.4).
 * - Выявляет циклические зависимости квестов и планов (§262.4 #3).
 * - Проверяет отсутствие дублирования предметов, рун и отрядов между активной и архивными картами (§262.4 #5, §275.4).
 * - Проверяет заморозку архивных территорий (§275.5) и достижимость миссии/экономики без выдачи бесплатных ресурсов.
 */

import { PROTOTYPE_ITEMS, PROTOTYPE_PLANS, PROTOTYPE_SPELLS } from './catalog';
import { previewHeroEquipmentChange, verifyItemLocationInvariants } from './inventoryAndSave';
import { validateMissionPlayability } from './missionAndWorld';
import { evaluatePlanAvailability, hasActiveWorkerRuneForRace } from './runesAndPlans';
import { validateSettlementEconomicPlayability } from './settlementEconomy';
import type {
  CampaignAuditReport,
  CampaignState,
  EquipSlotId,
  LocalSettlementState,
  MapInstanceState,
  MissionState,
  UnlockEvaluationResult,
  UnlockLockCode,
} from './types';

function addLock(
  lockCodes: UnlockLockCode[],
  reasonsRu: string[],
  code: UnlockLockCode,
  reasonRu: string
): void {
  if (!lockCodes.includes(code)) {
    lockCodes.push(code);
  }
  reasonsRu.push(reasonRu);
}

/**
 * §§258.2–258.4: Единая диагностика разблокировки по 9-шаговому порядку с возвратом ВСЕХ критических кодов.
 */
export function evaluateUnifiedUnlock(params: {
  campaign: CampaignState;
  map: MapInstanceState;
  heroId?: string;
  settlement?: LocalSettlementState | null;
  target:
    | { kind: 'equipment'; instanceId: string; targetSlot: EquipSlotId }
    | { kind: 'spell_learn'; spellId: string }
    | { kind: 'plan'; planId: string }
    | { kind: 'quest_activate'; questId: string }
    | { kind: 'portal_route'; requiredWorldFlag: string; targetMapDefId: string; returnPolicy?: MissionState['returnPolicy'] };
}): UnlockEvaluationResult {
  const { campaign, map, target } = params;
  const heroId = params.heroId ?? campaign.avatarId;
  const hero = campaign.heroes[heroId];
  const lockCodes: UnlockLockCode[] = [];
  const reasonsRu: string[] = [];

  if (target.kind === 'equipment') {
    const inst = campaign.itemsByInstanceId[target.instanceId];
    const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : undefined;
    if (!hero || !inst || !def) {
      addLock(lockCodes, reasonsRu, 'INVALID_TARGET', 'Герой или экземпляр предмета не найдены.');
      return { unlocked: false, lockCodes, reasonsRu };
    }
    const prev = previewHeroEquipmentChange(campaign, heroId, target.instanceId, target.targetSlot);
    if (!prev.canEquip) {
      if (def.requirements?.level && hero.level < def.requirements.level) {
        addLock(lockCodes, reasonsRu, 'LOCKED_LEVEL', `Требуется уровень ${def.requirements.level}.`);
      }
      if (def.requirements?.attributes) {
        for (const [attr, req] of Object.entries(def.requirements.attributes)) {
          if (prev.unmetReasonsRu.some((r) => r.includes(`${attr} >= ${req}`))) {
            addLock(lockCodes, reasonsRu, 'LOCKED_ATTRIBUTE', `Недостаточно атрибута ${attr} (нужно >= ${req}).`);
          }
        }
      }
      if (def.requirements?.masteries) {
        for (const [m, req] of Object.entries(def.requirements.masteries)) {
          if (prev.unmetReasonsRu.some((r) => r.includes(`${m} >= ${req}`))) {
            addLock(lockCodes, reasonsRu, 'LOCKED_MASTERY', `Недостаточно мастерства ${m} (нужно >= ${req}).`);
          }
        }
      }
      if (!def.allowedSlots.includes(target.targetSlot) || prev.unmetReasonsRu.some((r) => r.includes('двуручным'))) {
        addLock(lockCodes, reasonsRu, 'INVALID_STATE', 'Слот несовместим с текущим снаряжением.');
      }
    }
    return { unlocked: lockCodes.length === 0, lockCodes, reasonsRu };
  }

  if (target.kind === 'spell_learn') {
    const spell = PROTOTYPE_SPELLS[target.spellId];
    if (!hero || !spell) {
      addLock(lockCodes, reasonsRu, 'INVALID_TARGET', 'Герой или заклинание не найдены.');
      return { unlocked: false, lockCodes, reasonsRu };
    }
    const entry = hero.spells[target.spellId];
    if (!entry || entry.acquisitionState === 'Unknown') {
      addLock(lockCodes, reasonsRu, 'LOCKED_SPELL_FORMULA', `Формула "${spell.nameRu}" не получена в Гримуар.`);
    } else if (entry.rank >= spell.maxRank) {
      addLock(lockCodes, reasonsRu, 'ALREADY_CLAIMED', `Заклинание "${spell.nameRu}" уже достигло максимального ранга.`);
    }
    const schoolLv =
      spell.school === 'dark' && spell.darkBranch
        ? hero.darkBranchMasteries[spell.darkBranch]
        : hero.schoolMasteries[spell.school];
    if (schoolLv < spell.requiredSchoolMastery) {
      addLock(
        lockCodes,
        reasonsRu,
        'LOCKED_MASTERY',
        `Требуется мастерство школы ${spell.school} >= ${spell.requiredSchoolMastery} (сейчас ${schoolLv}).`
      );
    }
    for (const prereq of spell.prerequisiteSpellIds ?? []) {
      const preEntry = hero.spells[prereq];
      if (!preEntry || preEntry.acquisitionState !== 'Learned' || preEntry.rank < 1) {
        addLock(
          lockCodes,
          reasonsRu,
          'LOCKED_SPELL_FORMULA',
          `Не изучено предварительное заклинание ${PROTOTYPE_SPELLS[prereq]?.nameRu ?? prereq}.`
        );
      }
    }
    if (hero.unspent.magicPoints < 1) {
      addLock(lockCodes, reasonsRu, 'LOCKED_RESOURCE', 'Недостаточно очков магии для изучения.');
    }
    return { unlocked: lockCodes.length === 0, lockCodes, reasonsRu };
  }

  if (target.kind === 'plan') {
    const planDef = PROTOTYPE_PLANS[target.planId];
    if (!planDef) {
      addLock(lockCodes, reasonsRu, 'INVALID_TARGET', `План ${target.planId} не найден.`);
      return { unlocked: false, lockCodes, reasonsRu };
    }
    const settlement =
      params.settlement ??
      Object.values(map.localSettlements).find((s) => s.raceId === planDef.raceId) ??
      null;
    const ev = evaluatePlanAvailability(campaign, map, settlement, target.planId);
    if (!ev.checks.knowledge) {
      addLock(lockCodes, reasonsRu, 'LOCKED_PLAN', `План "${planDef.displayNameRu}" или его предпосылка не активированы в Plan Book.`);
    }
    if (!ev.checks.monument) {
      const runeActive = hasActiveWorkerRuneForRace(campaign, planDef.raceId).active;
      if (!runeActive) {
        addLock(lockCodes, reasonsRu, 'LOCKED_RUNE', `Рабочая руна народа ${planDef.raceId} не установлена в Rune Tablet.`);
      } else {
        addLock(lockCodes, reasonsRu, 'LOCKED_LOCATION', `На активной карте не захвачен Rune Monument народа ${planDef.raceId}.`);
      }
    }
    if (!ev.checks.infrastructure) {
      addLock(lockCodes, reasonsRu, 'LOCKED_BUILDING', 'Отсутствует требуемое исправное здание поселения.');
    }
    if (!ev.checks.resources) {
      addLock(lockCodes, reasonsRu, 'LOCKED_RESOURCE', 'Недостаточно локальных ресурсов поселения.');
    }
    if (!ev.checks.capacity) {
      addLock(lockCodes, reasonsRu, 'LOCKED_CAP', 'Превышен лимит MilitaryCap / WorkerCap.');
    }
    return { unlocked: lockCodes.length === 0, lockCodes, reasonsRu };
  }

  if (target.kind === 'quest_activate') {
    const quest = campaign.quests[target.questId];
    if (!quest) {
      addLock(lockCodes, reasonsRu, 'INVALID_TARGET', 'Задание не найдено.');
      return { unlocked: false, lockCodes, reasonsRu };
    }
    if (quest.status === 'Completed' || quest.status === 'Closed') {
      addLock(lockCodes, reasonsRu, 'ALREADY_CLAIMED', `Задание "${quest.titleRu}" уже завершено/закрыто.`);
    } else if (quest.status === 'Active' || quest.status === 'Failed') {
      addLock(lockCodes, reasonsRu, 'LOCKED_QUEST_STATE', `Задание "${quest.titleRu}" в статусе ${quest.status}.`);
    }
    for (const reqId of quest.prerequisiteQuestIds) {
      const req = campaign.quests[reqId];
      if (!req || (req.status !== 'Completed' && req.status !== 'Closed')) {
        addLock(
          lockCodes,
          reasonsRu,
          'LOCKED_QUEST_STATE',
          `Не выполнено предварительное задание "${req?.titleRu ?? reqId}".`
        );
      }
    }
    return { unlocked: lockCodes.length === 0, lockCodes, reasonsRu };
  }

  // portal_route
  if (!campaign.worldFlags[target.requiredWorldFlag]) {
    addLock(
      lockCodes,
      reasonsRu,
      'LOCKED_CAMPAIGN_FLAG',
      `Не установлен кампанийный флаг маршрута "${target.requiredWorldFlag}".`
    );
  }
  if (map.lifecycle !== 'RUNNING') {
    addLock(lockCodes, reasonsRu, 'INVALID_STATE', `Карта в состоянии ${map.lifecycle}, переход недоступен.`);
  }
  if (
    target.returnPolicy === 'OneWay' &&
    campaign.archivedMapsByDefinitionId?.[target.targetMapDefId]
  ) {
    addLock(
      lockCodes,
      reasonsRu,
      'LOCKED_LOCATION',
      `Политика OneWay запрещает повторный вход на карту "${target.targetMapDefId}".`
    );
  }
  return { unlocked: lockCodes.length === 0, lockCodes, reasonsRu };
}

/**
 * §262.4 #3: Обнаружение циклических зависимостей в графе предпосылок (квесты или планы).
 */
export function detectDependencyCycles(graph: Record<string, string[]>): string[][] {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const dep of graph[node] ?? []) {
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (stack.has(dep)) {
        const idx = path.indexOf(dep);
        cycles.push([...path.slice(idx), dep]);
      }
    }

    stack.delete(node);
    path.pop();
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }
  return cycles;
}

/**
 * §§258.7, 262.4, 275.4–275.5: Комплексный анти-тупиковый аудит кампании без модификации состояния.
 */
export function runCampaignAntiDeadlockAudit(
  campaign: CampaignState,
  mission: MissionState,
  activeMap: MapInstanceState
): CampaignAuditReport {
  const issuesRu: string[] = [];

  // 1. Инварианты предметов, экипировки и Rune Tablet (§262.4 #5, §347.2)
  const itemCheck = verifyItemLocationInvariants(campaign);
  if (!itemCheck.valid) {
    issuesRu.push(...itemCheck.errors);
  }

  // 2. Изоляция отрядов между активной и архивными картами (§262.4 #5-6, §275.4)
  let squadCrossMapIsolation = true;
  const seenSquads = new Map<string, string>();
  const allMaps: Array<{ label: string; map: MapInstanceState }> = [
    { label: `active:${activeMap.mapDefinitionId}`, map: activeMap },
    ...Object.entries(campaign.archivedMapsByDefinitionId ?? {}).map(([defId, m]) => ({
      label: `archived:${defId}`,
      map: m,
    })),
  ];
  for (const entry of allMaps) {
    for (const [sqId, sq] of Object.entries(entry.map.squadRoster ?? {})) {
      const prevLoc = seenSquads.get(sqId);
      if (prevLoc) {
        squadCrossMapIsolation = false;
        issuesRu.push(`Дублирование SquadID "${sqId}" на двух картах (${prevLoc} и ${entry.label}, §275.4).`);
      } else {
        seenSquads.set(sqId, entry.label);
      }
      if (sq.deploymentState === 'Garrison' && sq.portableAcrossPortals) {
        squadCrossMapIsolation = false;
        issuesRu.push(`Отряд гарнизона "${sqId}" помечен переносимым через порталы (§275.1).`);
      }
    }
  }

  // 3. Проверка отсутствия циклов в зависимостях квестов и планов (§262.4 #3)
  const questGraph: Record<string, string[]> = {};
  for (const q of Object.values(campaign.quests)) {
    questGraph[q.questId] = [...q.prerequisiteQuestIds];
  }
  const questCycles = detectDependencyCycles(questGraph);
  const planGraph: Record<string, string[]> = {};
  for (const p of Object.values(PROTOTYPE_PLANS)) {
    planGraph[p.planId] = [...(p.requiredPlanIds ?? [])];
  }
  const planCycles = detectDependencyCycles(planGraph);
  const noDependencyCycles = questCycles.length === 0 && planCycles.length === 0;
  for (const cyc of questCycles) {
    issuesRu.push(`Обнаружен цикл зависимостей заданий: ${cyc.join(' -> ')} (§262.4 #3).`);
  }
  for (const cyc of planCycles) {
    issuesRu.push(`Обнаружен цикл зависимостей планов: ${cyc.join(' -> ')} (§262.4 #3).`);
  }

  // 4. Заморозка архивных территорий (§275.5, §338.7)
  let archivedMapsFrozen = true;
  for (const [defId, archMap] of Object.entries(campaign.archivedMapsByDefinitionId ?? {})) {
    if (archMap.lifecycle === 'RUNNING') {
      archivedMapsFrozen = false;
      issuesRu.push(`Архивная карта "${defId}" остаётся в RUNNING вместо заморозки (§275.5).`);
    }
    for (const s of Object.values(archMap.localSettlements)) {
      if (!s.frozenOnInactiveMap) {
        archivedMapsFrozen = false;
        issuesRu.push(`Поселение "${s.settlementId}" на архивной карте "${defId}" не заморожено (§338.7).`);
      }
    }
  }

  // 5. Достижимость миссии (§346.9)
  const playability = validateMissionPlayability(campaign, mission, activeMap);
  if (!playability.playable) {
    issuesRu.push(...playability.issues);
  }

  // 6. Экономический аудит активных поселений (§338.8)
  let settlementEconomyPlayable = true;
  for (const s of Object.values(activeMap.localSettlements)) {
    const econ = validateSettlementEconomicPlayability(s);
    if (!econ.playable) {
      settlementEconomyPlayable = false;
      issuesRu.push(...econ.issues);
    }
  }

  return {
    passed:
      itemCheck.valid &&
      squadCrossMapIsolation &&
      noDependencyCycles &&
      archivedMapsFrozen &&
      playability.playable &&
      settlementEconomyPlayable,
    checks: {
      itemAndRuneInvariants: itemCheck.valid,
      squadCrossMapIsolation,
      noDependencyCycles,
      archivedMapsFrozen,
      missionPlayable: playability.playable,
      settlementEconomyPlayable,
    },
    issuesRu,
  };
}
