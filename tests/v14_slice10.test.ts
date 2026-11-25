import assert from 'node:assert/strict';
import test from 'node:test';

import { runCampaignAntiDeadlockAudit } from '../src/core/campaignAudit';
import { runPrototypeCatalogAndAuditReport } from '../src/core/catalogAudit';
import { advanceAvatarRespawnTimer, triggerAvatarDeath } from '../src/core/combatAndMagic';
import {
  advanceSquadWaypoint,
  areWorldCommandsBlockedByUiStack,
  assignControlGroup,
  canUseFormationButton,
  createFogOfWarGrid,
  createInitialFieldSelectionState,
  focusPortraitWithinSelection,
  getFogTileState,
  handleSystemBackNavigation,
  pushUiNavigationLayer,
  recallControlGroup,
  setSquadPatrolRoute,
  setSquadWaypointOrder,
  updateFieldSelection,
  updateFogOfWarVisibility,
} from '../src/core/fieldCommands';
import {
  createSaveSnapshot,
  equipItemFromPartyInventory,
  executePortalMapTransition,
  transferEquippedItemBetweenHeroes,
  validateAndLoadSnapshot,
  verifyItemLocationInvariants,
} from '../src/core/inventoryAndSave';
import {
  openLootContainer,
  takeAllLootEntries,
  takeSingleLootEntry,
  validateMissionPlayability,
} from '../src/core/missionAndWorld';
import { dismissPartyHero, summonCompanionHeroToParty } from '../src/core/progression';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import { runMandatoryCombatMatrixAudit } from '../src/core/squadsAndEffects';
import type { SquadCommandLayer } from '../src/core/types';

test('T-V14-44: v14.2 §128 & §316 — Окно добычи: выборочный подбор сохраняет остаток, «Взять всё» идемпотентно и без дублей', () => {
  const sb = createInitialVerticalSliceSandbox();
  const initialCopper = sb.campaign.localMapWalletCopper;

  // Открываем полевой контейнер (420 Copper + свиток item_scroll_frost_nova)
  const opened = openLootContainer(sb.activeMap, 'obj_loot_cache_01');
  assert.equal(opened.ok, true);
  assert.equal(opened.entries.length, 2);
  assert.equal(opened.remainingCount, 2);

  // 1. Выборочный подбор только денег — свиток остаётся в контейнере, контейнер не consumed
  const copperEntry = opened.entries.find((e) => e.kind === 'copper')!;
  const singleRes = takeSingleLootEntry(sb.campaign, sb.activeMap, 'obj_loot_cache_01', copperEntry.entryId);
  assert.equal(singleRes.ok, true);
  assert.equal(singleRes.remainingCount, 1);
  assert.equal(sb.campaign.localMapWalletCopper, initialCopper + 420);
  assert.equal(sb.activeMap.worldObjects?.obj_loot_cache_01.consumed, false);

  // Повторный подбор уже взятой позиции заблокирован
  const dupSingle = takeSingleLootEntry(sb.campaign, sb.activeMap, 'obj_loot_cache_01', copperEntry.entryId);
  assert.equal(dupSingle.ok, false);

  // 2. «Взять всё» забирает оставшийся свиток (стакуется в PartyInventory по §274) и закрывает контейнер
  const takeAllRes = takeAllLootEntries(sb.campaign, sb.activeMap, 'obj_loot_cache_01');
  assert.equal(takeAllRes.ok, true);
  assert.equal(takeAllRes.takenCount, 1);
  assert.equal(sb.activeMap.worldObjects?.obj_loot_cache_01.consumed, true);

  // Повторное «Взять всё» отклоняется
  assert.equal(takeAllLootEntries(sb.campaign, sb.activeMap, 'obj_loot_cache_01').ok, false);
  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);
});

test('T-V14-45: v14.2 §128, §276.2 #5, §276.7 & §277 #1–3 — Удалённый обмен экипировкой между активными героями и блок портала при смерти Аватара', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatarId = sb.campaign.avatarId;

  // Призываем активного спутника в группу
  const summon = summonCompanionHeroToParty({
    campaign: sb.campaign,
    heroId: 'hero_comp_slice10',
    nameRu: 'Спутник-испытатель',
  });
  assert.equal(summon.ok, true);

  // Надеваем амулет CHA на Аватара (требований нет)
  assert.equal(
    equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_amulet_cha_01', 'amulet').ok,
    true
  );

  // 1. Удалённая передача экипированного предмета между активными героями (§128 / §277 #2)
  const xferOk = transferEquippedItemBetweenHeroes(
    sb.campaign,
    avatarId,
    'amulet',
    'hero_comp_slice10',
    'amulet'
  );
  assert.equal(xferOk.ok, true);
  assert.equal(sb.campaign.heroes[avatarId].equipment.amulet, null);
  assert.equal(sb.campaign.heroes.hero_comp_slice10.equipment.amulet, 'inst_amulet_cha_01');
  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);

  // 2. Атомарный откат: передача 2H-меча на спутника без нужной Силы/мастерства возвращает меч Аватару
  const avatar = sb.campaign.heroes[avatarId];
  avatar.baseAttributes.STR = 20;
  avatar.combatMasteries.two_handed = 5;
  assert.equal(
    equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_sword_2h_01', 'main_hand').ok,
    true
  );
  const xferRollback = transferEquippedItemBetweenHeroes(
    sb.campaign,
    avatarId,
    'main_hand',
    'hero_comp_slice10',
    'main_hand'
  );
  assert.equal(xferRollback.ok, false);
  assert.equal(avatar.equipment.main_hand, 'inst_sword_2h_01');
  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);

  // 3. Герой вне активной группы не имеет удалённого доступа (§277 #3)
  dismissPartyHero(sb.campaign, 'hero_comp_slice10');
  const xferInactive = transferEquippedItemBetweenHeroes(
    sb.campaign,
    avatarId,
    'main_hand',
    'hero_comp_slice10'
  );
  assert.equal(xferInactive.ok, false);

  // 4. §276.7: Переход порталом запрещён, пока Аватар в RespawnPending
  triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_death_portal_guard');
  const blockedPortal = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    sb.activeMap,
    'sector_b',
    'tr_blocked_while_dead'
  );
  assert.equal(blockedPortal.ok, false);

  // 5. §276.2 #5: Если миссия проиграна отдельным условием, возрождение не отменяет поражение миссии
  sb.mission.status = 'Defeat';
  const respawnBlockedByDefeat = advanceAvatarRespawnTimer(
    sb.campaign,
    sb.activeMap,
    120,
    sb.mission
  );
  assert.equal(respawnBlockedByDefeat.respawned, false);
  assert.equal(respawnBlockedByDefeat.missionRemainsFailed, true);
  assert.equal(sb.mission.status, 'Defeat');
});

test('T-V14-46: v14.2 §§292.6–292.10 — Выделение до 100 юнитов, 6 групп быстрого выбора, запрет формации с Аватаром, путевые точки и патруль', () => {
  const sel = createInitialFieldSelectionState();
  const aliveIds = new Set(['hero_avatar_01', 'sq_1', 'sq_2', 'sq_3']);

  // 1. Выделение + Shift-добавление + Alt-удаление + фокус портрета без разрушения группы (§292.6)
  updateFieldSelection(sel, ['sq_1', 'sq_2'], 'replace', aliveIds);
  updateFieldSelection(sel, ['sq_3'], 'shift_toggle', aliveIds);
  assert.deepEqual(sel.selectedEntityIds, ['sq_1', 'sq_2', 'sq_3']);
  assert.equal(focusPortraitWithinSelection(sel, 'sq_2'), true);
  assert.equal(sel.focusedEntityId, 'sq_2');
  assert.equal(sel.selectedEntityIds.length, 3);
  updateFieldSelection(sel, ['sq_3'], 'alt_remove', aliveIds);
  assert.deepEqual(sel.selectedEntityIds, ['sq_1', 'sq_2']);

  // 2. 6 групп быстрого выбора (Ctrl+1..6) и авто-очистка погибших при вызове (§292.7)
  assignControlGroup(sel, 1, aliveIds);
  aliveIds.delete('sq_2');
  const recalled = recallControlGroup(sel, 1, aliveIds);
  assert.equal(recalled.ok, true);
  assert.deepEqual(recalled.selectedIds, ['sq_1']);

  // 3. §292.10: Кнопка формаций недоступна, если в группе выделен Аватар
  assert.equal(canUseFormationButton(['sq_1', 'sq_2'], 'hero_avatar_01').allowed, true);
  assert.equal(canUseFormationButton(['hero_avatar_01', 'sq_1'], 'hero_avatar_01').allowed, false);
  assert.equal(canUseFormationButton(['sq_1'], 'hero_avatar_01').allowed, false);

  // 4. §292.8: Путевые точки (Shift) и замкнутый патруль (Alt)
  const layer: SquadCommandLayer = {
    squadId: 'sq_1',
    playerOrder: 'Idle',
    localReaction: 'None',
  };
  setSquadWaypointOrder(layer, 'MoveTo', { x: 10, y: 10 }, false);
  setSquadWaypointOrder(layer, 'MoveTo', { x: 20, y: 20 }, true);
  assert.equal(layer.waypointQueue?.length, 2);
  const step1 = advanceSquadWaypoint(layer);
  assert.equal(step1.completedRoute, false);
  assert.deepEqual(step1.nextTargetPos, { x: 20, y: 20 });
  const step2 = advanceSquadWaypoint(layer);
  assert.equal(step2.completedRoute, true);

  // Патруль зацикливается бесконечно между точками
  assert.equal(
    setSquadPatrolRoute(layer, [
      { x: 0, y: 0 },
      { x: 15, y: 0 },
    ]).ok,
    true
  );
  const p1 = advanceSquadWaypoint(layer);
  assert.equal(p1.completedRoute, false);
  assert.deepEqual(p1.nextTargetPos, { x: 15, y: 0 });
  const p2 = advanceSquadWaypoint(layer);
  assert.equal(p2.completedRoute, false);
  assert.deepEqual(p2.nextTargetPos, { x: 0, y: 0 });
});

test('T-V14-47: v14.2 §292.9 & §§348.4–348.6 — Туман войны (Unexplored/Visible/ExploredShrouded) и безопасный стек Android Back / Escape', () => {
  // 1. Туман войны сохраняет ранее исследованную область в ExploredShrouded при уходе юнита (§292.9)
  const fog = createFogOfWarGrid(10, 10);
  assert.equal(getFogTileState(fog, 2, 2), 'Unexplored');

  updateFogOfWarVisibility(fog, [{ x: 2, y: 2, visionRadius: 2 }]);
  assert.equal(getFogTileState(fog, 2, 2), 'Visible');
  assert.equal(getFogTileState(fog, 9, 9), 'Unexplored');

  // Юнит уходит в другой угол: (2,2) становится ExploredShrouded (не Unexplored!), а (8,8) — Visible
  updateFogOfWarVisibility(fog, [{ x: 8, y: 8, visionRadius: 2 }]);
  assert.equal(getFogTileState(fog, 2, 2), 'ExploredShrouded');
  assert.equal(getFogTileState(fog, 8, 8), 'Visible');

  // 2. Стек системной навигации Back / Escape (§348.4, §348.6)
  let stack = pushUiNavigationLayer([], {
    layerId: 'dlg_1',
    kind: 'dialogue',
    blocksWorldCommands: true,
  });
  stack = pushUiNavigationLayer(stack, {
    layerId: 'del_1',
    kind: 'delete_confirm',
    blocksWorldCommands: true,
  });
  assert.equal(areWorldCommandsBlockedByUiStack(stack), true);

  const back1 = handleSystemBackNavigation(stack);
  assert.equal(back1.cancelledLayer?.kind, 'delete_confirm');
  assert.equal(back1.confirmedDestructiveAction, false);
  assert.equal(areWorldCommandsBlockedByUiStack(back1.nextStack), true);

  const back2 = handleSystemBackNavigation(back1.nextStack);
  assert.equal(back2.cancelledLayer?.kind, 'dialogue');
  assert.equal(areWorldCommandsBlockedByUiStack(back2.nextStack), false);
});

test('T-V14-48: Release Gate v14.2 (1.0.0-v14.2-core) — Все аудит-движки ядра проходят совместно после save/load roundtrip', () => {
  const sb = createInitialVerticalSliceSandbox();
  const snap = createSaveSnapshot(sb.campaign, sb.mission, sb.activeMap, sb.eventJournal, 'release_gate_snap');
  const loaded = validateAndLoadSnapshot(JSON.stringify(snap));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;

  const { campaign, mission, activeMap } = loaded.snapshot;

  const combatAudit = runMandatoryCombatMatrixAudit();
  assert.equal(combatAudit.allPassed, true);

  const invAudit = verifyItemLocationInvariants(campaign);
  assert.equal(invAudit.valid, true, invAudit.errors.join('; '));

  const playabilityAudit = validateMissionPlayability(campaign, mission, activeMap);
  assert.equal(playabilityAudit.playable, true, playabilityAudit.issues.join('; '));

  const campaignAudit = runCampaignAntiDeadlockAudit(campaign, mission, activeMap);
  assert.equal(campaignAudit.passed, true, campaignAudit.issuesRu.join('; '));

  const catalogAudit = runPrototypeCatalogAndAuditReport();
  assert.equal(catalogAudit.overallCatalogStatus, 'PARTIAL');
  assert.equal(catalogAudit.raceMatrixErrorsRu.length, 0);
  assert.equal(catalogAudit.numericalErrorsRu.length, 0);
  assert.equal(catalogAudit.catalogErrorsRu.length, 0);
});
