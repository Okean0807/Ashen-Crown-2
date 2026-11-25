/**
 * ASHEN CROWN — Жизненный цикл карты (§341.11), интерактивные объекты (§316, §346.5),
 * диалоги с последствиями без глобальной кармы (§§309–315, 333.4–333.7),
 * и аудит проходимости / восстановление через Checkpoints (§341.7, §346.9).
 */

import { DEFAULT_WORKING_ASSUMPTIONS, type ProvisionalBalanceConfig } from './config';
import {
  completeQuestStageAndMaybeReward,
  pickupItemToPartyInventory,
  validateAndLoadSnapshot,
} from './inventoryAndSave';
import { computeDerivedHeroStats, grantHeroExperience } from './progression';
import { captureRuneMonument } from './runesAndPlans';
import type {
  CampaignState,
  DialogueChoice,
  DialogueCondition,
  DialogueDefinition,
  LootContainerEntry,
  MapInstanceState,
  MapLifecycleState,
  MissionPlayabilityReport,
  MissionState,
  SaveEvent,
  WorldActionVerb,
  WorldInteractiveObject,
} from './types';

const ALLOWED_MAP_LIFECYCLE_TRANSITIONS: Record<MapLifecycleState, MapLifecycleState[]> = {
  UNLOADED: ['LOADING', 'FAILED'],
  LOADING: ['READY', 'FAILED'],
  READY: ['RUNNING', 'UNLOADING', 'FAILED'],
  RUNNING: ['PAUSED', 'RESOLVING', 'SAVING', 'UNLOADING', 'FAILED'],
  PAUSED: ['RUNNING', 'SAVING', 'RESOLVING', 'UNLOADING', 'FAILED'],
  SAVING: ['RUNNING', 'PAUSED', 'FAILED'],
  RESOLVING: ['UNLOADING', 'FAILED'],
  UNLOADING: ['UNLOADED', 'FAILED'],
  FAILED: ['UNLOADED', 'LOADING'],
};

/**
 * §341.11: Валидатор переходов жизненного цикла карты.
 * Недопустимые переходы блокируются без изменения текущего состояния.
 */
export function transitionMapLifecycle(
  map: MapInstanceState,
  nextState: MapLifecycleState
): { ok: boolean; from: MapLifecycleState; to: MapLifecycleState; reason?: string } {
  const from = map.lifecycle;
  if (from === nextState) {
    return { ok: true, from, to: nextState };
  }
  const allowed = ALLOWED_MAP_LIFECYCLE_TRANSITIONS[from];
  if (!allowed.includes(nextState)) {
    return {
      ok: false,
      from,
      to: nextState,
      reason: `Недопустимый переход жизненного цикла карты: ${from} -> ${nextState} (§341.11).`,
    };
  }
  map.lifecycle = nextState;
  return { ok: true, from, to: nextState };
}

/**
 * §§341.11, 333.7, 348.4: Разрешение на подачу игровых команд миру.
 * Блокирует команды мира до READY, во время PAUSED/RESOLVING и пока открыт диалог или экран подтверждения сделки.
 */
export function canAcceptMapCommands(
  map: MapInstanceState,
  options: { dialogueOpen?: boolean; pendingConfirmationOpen?: boolean } = {}
): { allowed: boolean; reason?: string } {
  if (options.dialogueOpen) {
    return {
      allowed: false,
      reason: 'Открыт слой диалога: команды миру заблокированы, приказы армии сохранены (§333.7, §348.4).',
    };
  }
  if (options.pendingConfirmationOpen) {
    return {
      allowed: false,
      reason: 'Ожидается подтверждение операции: команды миру заблокированы (§348.4).',
    };
  }
  if (map.lifecycle !== 'RUNNING') {
    return {
      allowed: false,
      reason: `Карта в состоянии ${map.lifecycle}: команды принимаются только в RUNNING (§341.11).`,
    };
  }
  return { allowed: true };
}

/**
 * §316, §346.5: Взаимодействие с интерактивными объектами карты по каноническим глаголам.
 */
export function interactWithWorldObject(
  campaign: CampaignState,
  map: MapInstanceState,
  objectId: string,
  verb: WorldActionVerb,
  actorKind: 'avatar' | 'combat_unit' | 'worker',
  eventId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; text: string; openDialogueId?: string; targetMapDefId?: string } {
  const cmdCheck = canAcceptMapCommands(map);
  if (!cmdCheck.allowed) {
    return { ok: false, text: cmdCheck.reason ?? 'Карта недоступна.' };
  }

  const obj = map.worldObjects?.[objectId];
  if (!obj) {
    return { ok: false, text: 'Объект мира не найден.' };
  }
  if (!obj.allowedVerbs.includes(verb)) {
    return {
      ok: false,
      text: `Действие ${verb} недопустимо для "${obj.nameRu}" (§316: разрешено ${obj.allowedVerbs.join(', ')}).`,
    };
  }

  if (verb === 'Interact' && actorKind !== 'avatar') {
    return { ok: false, text: 'Глагол Interact доступен только Аватару (§316, §346.5).' };
  }
  if (verb === 'Gather' && actorKind !== 'worker') {
    return { ok: false, text: 'Глагол Gather доступен только назначенным рабочим (§346.5).' };
  }
  if (verb === 'Attack' && actorKind === 'worker') {
    return { ok: false, text: 'Рабочий без боевой роли не выполняет атакующий приказ по объекту.' };
  }

  if (obj.kind === 'stone_of_souls' && verb === 'Interact') {
    if (!map.availableStoneOfSoulsIds.includes(obj.objectId)) {
      map.availableStoneOfSoulsIds.push(obj.objectId);
    }
    map.activeStoneOfSoulsId = obj.objectId;
    obj.activated = true;
    const avatar = campaign.heroes[campaign.avatarId];
    if (avatar) {
      avatar.deathState.activeStoneOfSoulsId = obj.objectId;
    }
    return {
      ok: true,
      text: `Активирован Stone of Souls "${obj.nameRu}" (точка возрождения 120с обновлена, §288).`,
    };
  }

  if (obj.kind === 'portal' && verb === 'Interact') {
    return {
      ok: true,
      targetMapDefId: obj.targetMapDefId,
      text: `Портал "${obj.nameRu}" готов к переходу (${obj.targetMapDefId ?? 'target'}).`,
    };
  }

  if (obj.kind === 'npc_contact' && verb === 'Interact') {
    return {
      ok: true,
      openDialogueId: obj.dialogueId,
      text: `Открыт диалог с "${obj.nameRu}" (§333.6, §348.2).`,
    };
  }

  if (obj.kind === 'loot_cache' && verb === 'Loot') {
    if (obj.consumed || campaign.processedEventIds.includes(eventId)) {
      return { ok: false, text: 'Контейнер добычи уже собран (защита от повторного лута §346.6).' };
    }
    campaign.processedEventIds.push(eventId);
    obj.consumed = true;

    const gainedParts: string[] = [];
    if (obj.lootCopper && obj.lootCopper > 0) {
      const walletKey = config.enableProposedCampaignWallet
        ? 'proposedCampaignWalletCopper'
        : 'localMapWalletCopper';
      campaign[walletKey] += obj.lootCopper;
      gainedParts.push(`${obj.lootCopper} Copper`);
    }
    if (obj.lootItemDefinitionId) {
      const instId = `inst_loot_${obj.objectId}_${campaign.processedEventIds.length}`;
      campaign.itemsByInstanceId[instId] = {
        instanceId: instId,
        definitionId: obj.lootItemDefinitionId,
        quantity: 1,
        location: { kind: 'party_inventory' },
      };
      gainedParts.push(`предмет ${obj.lootItemDefinitionId}`);
    }

    return {
      ok: true,
      text: `Добыча из "${obj.nameRu}" получена в PartyInventory: ${gainedParts.join(', ') || 'пусто'}.`,
    };
  }

  if (obj.kind === 'rune_pillar' && verb === 'Interact') {
    if (obj.activated) {
      return { ok: false, text: `Объект "${obj.nameRu}" уже активирован.` };
    }
    obj.activated = true;
    map.localFlags[`activated_${obj.objectId}`] = true;
    return {
      ok: true,
      text: `Объект "${obj.nameRu}" переведён в активное состояние.`,
    };
  }

  if (obj.kind === 'rune_monument' && verb === 'Interact') {
    const res = captureRuneMonument(campaign, map, obj.objectId);
    return {
      ok: res.ok,
      text: res.ok
        ? `Rune Monument "${obj.nameRu}" захвачен и активирован по рабочей руне (§144.4).`
        : res.reason ?? 'Не удалось захватить Rune Monument.',
    };
  }

  if (obj.kind === 'hero_monument' && verb === 'Interact') {
    obj.activated = true;
    return {
      ok: true,
      text: `Hero Monument "${obj.nameRu}" активен: призыв и повторный призыв героев доступны через Rune Tablet во вкладке «Поселение» (§144.4–144.5).`,
    };
  }

  return { ok: false, text: 'Обработчик объекта не определён.' };
}

/**
 * Нейтральный технический диалог для проверки §§309–315, 333.4–333.6 без вымышленного лора.
 */
export const PROTOTYPE_DIALOGUES: Record<string, DialogueDefinition> = {
  dlg_sector_coordinator: {
    dialogueId: 'dlg_sector_coordinator',
    titleRu: 'Координатор логистики сектора А (§333.6)',
    entryNodeId: 'node_start',
    nodes: {
      node_start: {
        nodeId: 'node_start',
        speakerRu: 'Дежурный координатор сектора',
        textRu:
          'Протокол связи активен. Выберите режим обработки поручения снабжения без глобальной кармы или автоматической навигации.',
        choices: [
          {
            choiceId: 'ch_inspect_storage',
            textRu: 'Подтвердить аудит склада (завершить этап «Учёт снабжения»)',
            nextNodeId: 'node_done_audit',
            condition: {
              requiredQuestStatus: { questId: 'quest_side_supply_audit', status: 'Active' },
            },
            consequenceEventId: 'dlg_evt_confirm_supply_audit',
            effect: {
              completeQuestStage: {
                questId: 'quest_side_supply_audit',
                stageId: 'stage_storage_check',
              },
              setLocalFlag: { flag: 'supply_audit_signed', value: true },
            },
          },
          {
            choiceId: 'ch_cha_negotiate',
            textRu: '[Проверка CHA >= 12] Запросить резервный паёк свитков в PartyInventory',
            nextNodeId: 'node_granted_scroll',
            condition: {
              minAttribute: { attr: 'CHA', value: 12 },
            },
            consequenceEventId: 'dlg_evt_bonus_scroll',
            effect: {
              grantItemDefId: 'item_scroll_frost_nova',
              grantXp: 45,
              setWorldFlag: { flag: 'sector_a_bonus_issued', value: true },
            },
          },
          {
            choiceId: 'ch_close_side_branch',
            textRu: 'Закрыть поручение снабжения альтернативно (статус Closed §333.4)',
            nextNodeId: 'node_closed_branch',
            condition: {
              requiredQuestStatus: { questId: 'quest_side_supply_audit', status: 'Active' },
            },
            consequenceEventId: 'dlg_evt_close_supply_branch',
            effect: {
              closeQuestId: 'quest_side_supply_audit',
              setWorldFlag: { flag: 'supply_branch_closed_alt', value: true },
            },
          },
          {
            choiceId: 'ch_leave',
            textRu: 'Завершить разговор без изменений',
            nextNodeId: null,
          },
        ],
      },
      node_done_audit: {
        nodeId: 'node_done_audit',
        speakerRu: 'Дежурный координатор сектора',
        textRu: 'Акт аудита снабжения зафиксирован. Награда зачислена однократно.',
        choices: [{ choiceId: 'ch_exit_1', textRu: 'Закрыть диалог', nextNodeId: null }],
      },
      node_granted_scroll: {
        nodeId: 'node_granted_scroll',
        speakerRu: 'Дежурный координатор сектора',
        textRu: 'Формулярный свиток передан в PartyInventory (однократно).',
        choices: [{ choiceId: 'ch_exit_2', textRu: 'Закрыть диалог', nextNodeId: null }],
      },
      node_closed_branch: {
        nodeId: 'node_closed_branch',
        speakerRu: 'Дежурный координатор сектора',
        textRu: 'Альтернативный исход применён: поручение переведено в статус Closed (не Failed).',
        choices: [{ choiceId: 'ch_exit_3', textRu: 'Закрыть диалог', nextNodeId: null }],
      },
    },
  },
};

export function evaluateDialogueCondition(
  campaign: CampaignState,
  condition?: DialogueCondition
): { met: boolean; reason?: string } {
  if (!condition) return { met: true };
  const avatar = campaign.heroes[campaign.avatarId];
  if (!avatar) return { met: false, reason: 'Аватар не найден.' };

  if (condition.minAttribute) {
    const derived = computeDerivedHeroStats(avatar, campaign.itemsByInstanceId);
    const val = derived.effectiveAttributes[condition.minAttribute.attr];
    if (val < condition.minAttribute.value) {
      return {
        met: false,
        reason: `Требуется ${condition.minAttribute.attr} >= ${condition.minAttribute.value} (сейчас ${val}).`,
      };
    }
  }
  if (condition.requiredQuestStatus) {
    const q = campaign.quests[condition.requiredQuestStatus.questId];
    if (!q || q.status !== condition.requiredQuestStatus.status) {
      return {
        met: false,
        reason: `Квест ${condition.requiredQuestStatus.questId} должен быть в статусе ${condition.requiredQuestStatus.status}.`,
      };
    }
  }
  if (condition.requiredWorldFlag) {
    const flagVal = Boolean(campaign.worldFlags[condition.requiredWorldFlag.flag]);
    if (flagVal !== condition.requiredWorldFlag.expected) {
      return {
        met: false,
        reason: `Не выполнено условие флага ${condition.requiredWorldFlag.flag}.`,
      };
    }
  }
  if (condition.requiredItemDefId) {
    const hasItem = Object.values(campaign.itemsByInstanceId).some(
      (i) => i.location.kind === 'party_inventory' && i.definitionId === condition.requiredItemDefId
    );
    if (!hasItem) {
      return {
        met: false,
        reason: `Требуется предмет ${condition.requiredItemDefId} в PartyInventory.`,
      };
    }
  }
  return { met: true };
}

/**
 * §§309–315, §333.6: Выбор реплики диалога с проверкой условий и идемпотентным применением последствий.
 * Без глобальной репутации/кармы.
 */
export function applyDialogueChoice(
  campaign: CampaignState,
  map: MapInstanceState,
  dialogueId: string,
  nodeId: string,
  choiceId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): {
  ok: boolean;
  nextNodeId: string | null;
  consequenceApplied: boolean;
  summaryRu: string;
} {
  const def = PROTOTYPE_DIALOGUES[dialogueId];
  if (!def) {
    return { ok: false, nextNodeId: null, consequenceApplied: false, summaryRu: 'Диалог не найден.' };
  }
  const node = def.nodes[nodeId];
  if (!node) {
    return { ok: false, nextNodeId: null, consequenceApplied: false, summaryRu: 'Узел диалога не найден.' };
  }
  const choice: DialogueChoice | undefined = node.choices.find((c) => c.choiceId === choiceId);
  if (!choice) {
    return { ok: false, nextNodeId: null, consequenceApplied: false, summaryRu: 'Вариант ответа не найден.' };
  }

  const cond = evaluateDialogueCondition(campaign, choice.condition);
  if (!cond.met) {
    return {
      ok: false,
      nextNodeId: nodeId,
      consequenceApplied: false,
      summaryRu: cond.reason ?? 'Условие реплики не выполнено.',
    };
  }

  let consequenceApplied = false;
  const eff = choice.effect;
  if (eff && choice.consequenceEventId && !campaign.processedEventIds.includes(choice.consequenceEventId)) {
    campaign.processedEventIds.push(choice.consequenceEventId);
    consequenceApplied = true;

    if (eff.activateQuestId && campaign.quests[eff.activateQuestId]) {
      const q = campaign.quests[eff.activateQuestId];
      if (q.status === 'Available' || q.status === 'Unavailable') {
        q.status = 'Active';
      }
    }
    if (eff.completeQuestStage) {
      completeQuestStageAndMaybeReward(
        campaign,
        eff.completeQuestStage.questId,
        eff.completeQuestStage.stageId,
        `${choice.consequenceEventId}_quest_stage`,
        undefined,
        config
      );
    }
    if (eff.closeQuestId && campaign.quests[eff.closeQuestId]) {
      const q = campaign.quests[eff.closeQuestId];
      if (q.status === 'Active' || q.status === 'Available') {
        q.status = 'Closed';
      }
    }
    if (eff.failQuestId && campaign.quests[eff.failQuestId]) {
      const q = campaign.quests[eff.failQuestId];
      if (q.status === 'Active' || q.status === 'Available') {
        q.status = 'Failed';
      }
    }
    if (eff.setWorldFlag) {
      campaign.worldFlags[eff.setWorldFlag.flag] = eff.setWorldFlag.value;
    }
    if (eff.setLocalFlag) {
      map.localFlags[eff.setLocalFlag.flag] = eff.setLocalFlag.value;
    }
    if (eff.grantItemDefId) {
      const itemInstId = `inst_dlg_${choice.consequenceEventId}`;
      campaign.itemsByInstanceId[itemInstId] = {
        instanceId: itemInstId,
        definitionId: eff.grantItemDefId,
        quantity: 1,
        location: { kind: 'party_inventory' },
      };
    }
    if (eff.grantXp && eff.grantXp > 0) {
      grantHeroExperience(campaign, campaign.avatarId, eff.grantXp, null, config);
    }
  }

  return {
    ok: true,
    nextNodeId: choice.nextNodeId,
    consequenceApplied,
    summaryRu: consequenceApplied
      ? 'Выбор диалога применён однократно (§333.6).'
      : 'Переход диалога выполнен без повторной выдачи последствий.',
  };
}

/**
 * §341.5 & §346.9: Смерть Аватара сама по себе НЕ завершает миссию поражением,
 * если в MissionState явно не установлено defeatOnAvatarDeath === true.
 */
export function evaluateMissionStatusAfterAvatarDeath(
  mission: MissionState,
  avatarAlive: boolean
): MissionState['status'] {
  if (mission.status !== 'Active') return mission.status;
  if (!avatarAlive && mission.defeatOnAvatarDeath === true) {
    mission.status = 'Defeat';
  }
  return mission.status;
}

/**
 * §346.9: Валидация достижимости обязательных целей миссии (диагностика softlock без молчаливого исправления).
 */
export function validateMissionPlayability(
  campaign: CampaignState,
  mission: MissionState,
  map: MapInstanceState
): MissionPlayabilityReport {
  const issues: string[] = [];

  if (map.lifecycle === 'FAILED') {
    issues.push('Карта находится в аварийном состоянии FAILED (§341.11).');
  }

  const avatar = campaign.heroes[campaign.avatarId];
  if (!avatar) {
    issues.push('В кампании отсутствует Аватар.');
  } else if (
    avatar.deathState.lifecycle !== 'Alive' &&
    (!map.activeStoneOfSoulsId || !map.availableStoneOfSoulsIds.includes(map.activeStoneOfSoulsId))
  ) {
    issues.push('Аватар мёртв, но активный Stone of Souls отсутствует на карте (softlock возрождения §288).');
  }

  if (mission.status === 'Active') {
    const failedMain = Object.values(campaign.quests).filter(
      (q) => q.questClass === 'Main' && q.status === 'Failed'
    );
    if (failedMain.length > 0) {
      issues.push(
        `Провалено обязательное основное задание (${failedMain.map((q) => q.titleRu).join(', ')}) при активной миссии.`
      );
    }
  }

  const checkpoints = campaign.checkpoints ?? [];
  const recommendedCheckpointId =
    checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].checkpointId : null;

  return {
    playable: issues.length === 0,
    issues,
    recommendedCheckpointId,
  };
}

/**
 * §341.7, §346.9: Безопасный откат к последнему валидному Checkpoint при невозможном состоянии.
 */
export function restoreFromCheckpoint(
  campaign: CampaignState,
  checkpointId: string
): {
  ok: boolean;
  restored?: {
    campaign: CampaignState;
    mission: MissionState;
    activeMap: MapInstanceState;
    eventJournal: SaveEvent[];
  };
  error?: string;
} {
  const cp = (campaign.checkpoints ?? []).find((c) => c.checkpointId === checkpointId);
  if (!cp) {
    return { ok: false, error: `Контрольная точка ${checkpointId} не найдена.` };
  }
  const loaded = validateAndLoadSnapshot(cp.snapshotJson);
  if (!loaded.ok) {
    return { ok: false, error: `Контрольная точка повреждена: ${loaded.error}` };
  }
  return {
    ok: true,
    restored: {
      campaign: loaded.snapshot.campaign,
      mission: loaded.snapshot.mission,
      activeMap: loaded.snapshot.activeMap,
      eventJournal: loaded.snapshot.eventJournal,
    },
  };
}

function hydrateLootEntries(obj: WorldInteractiveObject): LootContainerEntry[] {
  if (!obj.lootEntries) {
    const entries: LootContainerEntry[] = [];
    if (obj.lootCopper && obj.lootCopper > 0) {
      entries.push({
        entryId: `${obj.objectId}_copper`,
        kind: 'copper',
        quantity: obj.lootCopper,
        taken: Boolean(obj.consumed),
      });
    }
    if (obj.lootItemDefinitionId) {
      entries.push({
        entryId: `${obj.objectId}_item_1`,
        kind: 'item',
        definitionId: obj.lootItemDefinitionId,
        quantity: 1,
        taken: Boolean(obj.consumed),
      });
    }
    obj.lootEntries = entries;
  }
  return obj.lootEntries;
}

/**
 * §128 (USER APPROVED — SPELLFORCE FIDELITY): Открытие окна содержимого контейнера добычи
 * для выборочного подбора отдельных позиций или кнопки «Взять всё».
 */
export function openLootContainer(
  map: MapInstanceState,
  objectId: string
): {
  ok: boolean;
  containerNameRu?: string;
  entries: LootContainerEntry[];
  remainingCount: number;
  reason?: string;
} {
  const obj = map.worldObjects?.[objectId];
  if (!obj || obj.kind !== 'loot_cache') {
    return { ok: false, entries: [], remainingCount: 0, reason: 'Контейнер добычи не найден.' };
  }
  const entries = hydrateLootEntries(obj);
  const remainingCount = entries.filter((e) => !e.taken).length;
  return {
    ok: true,
    containerNameRu: obj.nameRu,
    entries: entries.map((e) => ({ ...e })),
    remainingCount,
  };
}

/**
 * §128 (USER APPROVED): Выборочный подбор одной позиции из окна контейнера в PartyInventory или кошелёк.
 */
export function takeSingleLootEntry(
  campaign: CampaignState,
  map: MapInstanceState,
  objectId: string,
  entryId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; remainingCount: number; text: string } {
  const cmdCheck = canAcceptMapCommands(map);
  if (!cmdCheck.allowed) {
    return { ok: false, remainingCount: 0, text: cmdCheck.reason ?? 'Карта недоступна.' };
  }
  const obj = map.worldObjects?.[objectId];
  if (!obj || obj.kind !== 'loot_cache') {
    return { ok: false, remainingCount: 0, text: 'Контейнер добычи не найден.' };
  }
  const entries = hydrateLootEntries(obj);
  const entry = entries.find((e) => e.entryId === entryId);
  if (!entry) {
    return { ok: false, remainingCount: entries.filter((e) => !e.taken).length, text: 'Позиция добычи не найдена.' };
  }
  if (entry.taken) {
    return {
      ok: false,
      remainingCount: entries.filter((e) => !e.taken).length,
      text: 'Эта позиция уже забрана (защита от дублирования §346.6).',
    };
  }

  let text = '';
  if (entry.kind === 'copper') {
    const walletKey = config.enableProposedCampaignWallet
      ? 'proposedCampaignWalletCopper'
      : 'localMapWalletCopper';
    campaign[walletKey] += entry.quantity;
    entry.taken = true;
    text = `Забрано ${entry.quantity} Copper из "${obj.nameRu}".`;
  } else if (entry.kind === 'item' && entry.definitionId) {
    const pick = pickupItemToPartyInventory(
      campaign,
      entry.definitionId,
      entry.quantity,
      `loot_${obj.objectId}_${entry.entryId}`,
      { isQuestProtected: entry.isQuestProtected, config }
    );
    if (!pick.ok) {
      return {
        ok: false,
        remainingCount: entries.filter((e) => !e.taken).length,
        text: pick.reason ?? 'Не удалось забрать предмет.',
      };
    }
    entry.taken = true;
    text = `Забран предмет ${entry.definitionId} (×${entry.quantity}) в PartyInventory (§128 / §274).`;
  } else {
    return { ok: false, remainingCount: entries.filter((e) => !e.taken).length, text: 'Некорректная запись добычи.' };
  }

  const remainingCount = entries.filter((e) => !e.taken).length;
  if (remainingCount === 0) {
    obj.consumed = true;
  }
  return { ok: true, remainingCount, text };
}

/**
 * §128 (USER APPROVED): Полный подбор («Взять всё») оставшихся позиций из контейнера.
 */
export function takeAllLootEntries(
  campaign: CampaignState,
  map: MapInstanceState,
  objectId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; takenCount: number; text: string } {
  const obj = map.worldObjects?.[objectId];
  if (!obj || obj.kind !== 'loot_cache') {
    return { ok: false, takenCount: 0, text: 'Контейнер добычи не найден.' };
  }
  const entries = hydrateLootEntries(obj);
  const pending = entries.filter((e) => !e.taken);
  if (pending.length === 0) {
    obj.consumed = true;
    return { ok: false, takenCount: 0, text: 'Контейнер уже пуст.' };
  }

  let takenCount = 0;
  for (const entry of pending) {
    const res = takeSingleLootEntry(campaign, map, objectId, entry.entryId, config);
    if (res.ok) takenCount += 1;
  }
  if (entries.every((e) => e.taken)) {
    obj.consumed = true;
  }
  return {
    ok: takenCount > 0,
    takenCount,
    text: `Взято всё из "${obj.nameRu}" (позиций: ${takenCount}).`,
  };
}

