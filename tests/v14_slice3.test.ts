import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceAvatarRespawnTimer, triggerAvatarDeath } from '../src/core/combatAndMagic';
import {
  executePortalMapTransition,
  previewMerchantTransaction,
} from '../src/core/inventoryAndSave';
import {
  applyDialogueChoice,
  canAcceptMapCommands,
  evaluateDialogueCondition,
  evaluateMissionStatusAfterAvatarDeath,
  interactWithWorldObject,
  restoreFromCheckpoint,
  transitionMapLifecycle,
  validateMissionPlayability,
} from '../src/core/missionAndWorld';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';

test('T-V14-12: v14.2 §§341.11, 333.7 & 348.4 — валидатор жизненного цикла карты и блокировка команд слоем диалога', () => {
  const sb = createInitialVerticalSliceSandbox();

  // Валидный переход RUNNING -> PAUSED -> RUNNING
  const pauseRes = transitionMapLifecycle(sb.activeMap, 'PAUSED');
  assert.equal(pauseRes.ok, true);
  assert.equal(canAcceptMapCommands(sb.activeMap).allowed, false);

  const resumeRes = transitionMapLifecycle(sb.activeMap, 'RUNNING');
  assert.equal(resumeRes.ok, true);
  assert.equal(canAcceptMapCommands(sb.activeMap).allowed, true);

  // Открытый диалог или экран подтверждения блокируют команды миру при RUNNING карте
  assert.equal(canAcceptMapCommands(sb.activeMap, { dialogueOpen: true }).allowed, false);
  assert.equal(
    canAcceptMapCommands(sb.activeMap, { pendingConfirmationOpen: true }).allowed,
    false
  );

  // Недопустимый прямой прыжок RUNNING -> UNLOADED должен блокироваться
  const invalidDirect = transitionMapLifecycle(sb.activeMap, 'UNLOADED');
  assert.equal(invalidDirect.ok, false);
  assert.equal(sb.activeMap.lifecycle, 'RUNNING');

  // Переход RUNNING -> RESOLVING блокирует возврат в RUNNING и новые команды
  assert.equal(transitionMapLifecycle(sb.activeMap, 'RESOLVING').ok, true);
  assert.equal(canAcceptMapCommands(sb.activeMap).allowed, false);
  assert.equal(transitionMapLifecycle(sb.activeMap, 'RUNNING').ok, false);
});

test('T-V14-13: v14.2 §316 & §346.5 — глаголы взаимодействия с объектами мира и однократный Loot', () => {
  const sb = createInitialVerticalSliceSandbox();

  // Interact доступен только Аватару
  const soldierInteract = interactWithWorldObject(
    sb.campaign,
    sb.activeMap,
    'stone_sector_a_02',
    'Interact',
    'combat_unit',
    'evt_bad_actor'
  );
  assert.equal(soldierInteract.ok, false);

  // Активация второго Stone of Souls Аватаром меняет активный якорь возрождения
  const avatarInteract = interactWithWorldObject(
    sb.campaign,
    sb.activeMap,
    'stone_sector_a_02',
    'Interact',
    'avatar',
    'evt_stone_02'
  );
  assert.equal(avatarInteract.ok, true);
  assert.equal(sb.activeMap.activeStoneOfSoulsId, 'stone_sector_a_02');

  // Контейнер добычи даёт деньги и свиток строго один раз
  const copperBefore = sb.campaign.localMapWalletCopper;
  const itemsBefore = Object.keys(sb.campaign.itemsByInstanceId).length;
  const loot1 = interactWithWorldObject(
    sb.campaign,
    sb.activeMap,
    'obj_loot_cache_01',
    'Loot',
    'avatar',
    'evt_loot_cache_01'
  );
  assert.equal(loot1.ok, true);
  assert.equal(sb.campaign.localMapWalletCopper, copperBefore + 420);
  assert.equal(Object.keys(sb.campaign.itemsByInstanceId).length, itemsBefore + 1);

  const loot2 = interactWithWorldObject(
    sb.campaign,
    sb.activeMap,
    'obj_loot_cache_01',
    'Loot',
    'avatar',
    'evt_loot_cache_01_dup'
  );
  assert.equal(loot2.ok, false);
  assert.equal(sb.campaign.localMapWalletCopper, copperBefore + 420);
});

test('T-V14-14: v14.2 §§309–315 & 333.4–333.7 — диалоги, условия, статус Closed и сохранение приказа армии', () => {
  const sb = createInitialVerticalSliceSandbox();
  const savedOrderBefore = sb.activeMap.squads.squad_alpha.playerOrder;

  // Условие CHA >= 12 не выполнено на базовых 10 CHA
  const condFail = evaluateDialogueCondition(sb.campaign, {
    minAttribute: { attr: 'CHA', value: 12 },
  });
  assert.equal(condFail.met, false);

  // Альтернативное закрытие побочного задания переводит его в Closed (не Failed)
  const dlgRes = applyDialogueChoice(
    sb.campaign,
    sb.activeMap,
    'dlg_sector_coordinator',
    'node_start',
    'ch_close_side_branch'
  );
  assert.equal(dlgRes.ok, true);
  assert.equal(dlgRes.consequenceApplied, true);
  assert.equal(dlgRes.nextNodeId, 'node_closed_branch');
  assert.equal(sb.campaign.quests.quest_side_supply_audit.status, 'Closed');
  assert.equal(sb.campaign.worldFlags.supply_branch_closed_alt, true);

  // Повторный выбор не применяет последствия повторно и не сбрасывает приказ армии
  const dlgDup = applyDialogueChoice(
    sb.campaign,
    sb.activeMap,
    'dlg_sector_coordinator',
    'node_start',
    'ch_close_side_branch'
  );
  assert.equal(dlgDup.ok, false); // Условие requiredQuestStatus: Active уже не выполняется
  assert.equal(sb.activeMap.squads.squad_alpha.playerOrder, savedOrderBefore);
});

test('T-V14-15: v14.2 §§341.5, 341.7, 346.8 & 346.9 — ReturnPolicy, pre-portal Checkpoint, смерть Аватара != поражение и восстановление softlock', () => {
  const sb = createInitialVerticalSliceSandbox();

  // Смерть Аватара не завершает миссию поражением по умолчанию (§341.5)
  triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_avatar_death_s3');
  const mStatus = evaluateMissionStatusAfterAvatarDeath(sb.mission, false);
  assert.equal(mStatus, 'Active');

  // Завершаем 120с возрождение у Stone of Souls перед использованием портала (§276.7)
  const respawned = advanceAvatarRespawnTimer(sb.campaign, sb.activeMap, 120, sb.mission);
  assert.equal(respawned.respawned, true);

  // Создаётся pre-portal Checkpoint, сектор А архивируется с замороженным поселением
  const t1 = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    sb.activeMap,
    'sector_b',
    'tr_to_b'
  );
  assert.equal(t1.ok, true);
  assert.ok(t1.nextMap);
  assert.ok(t1.checkpointCreated);
  assert.equal(sb.campaign.archivedMapsByDefinitionId?.sector_a?.localSettlements.settlement_sector_a.frozenOnInactiveMap, true);

  // При AllowReturn возврат на sector_a восстанавливает сохранённое поселение и размораживает его
  const tBack = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    t1.nextMap!,
    'sector_a',
    'tr_back_a'
  );
  assert.equal(tBack.ok, true);
  assert.equal(
    tBack.nextMap?.localSettlements.settlement_sector_a.frozenOnInactiveMap,
    false
  );
  assert.equal(tBack.nextMap?.localSettlements.settlement_sector_a.localResources.wood, 180);

  // При OneWay повторный вход на sector_b из архива должен быть запрещён
  sb.mission.returnPolicy = 'OneWay';
  const tBlocked = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    tBack.nextMap!,
    'sector_b',
    'tr_blocked_oneway'
  );
  assert.equal(tBlocked.ok, false);

  // Имитация невозможного состояния (провал обязательного Main квеста) -> аудит и откат к Checkpoint
  sb.campaign.quests.quest_main_sector_gate.status = 'Failed';
  const audit = validateMissionPlayability(sb.campaign, sb.mission, tBack.nextMap!);
  assert.equal(audit.playable, false);
  assert.ok(audit.recommendedCheckpointId);

  const restored = restoreFromCheckpoint(sb.campaign, audit.recommendedCheckpointId!);
  assert.equal(restored.ok, true);
  assert.equal(restored.restored?.campaign.quests.quest_main_sector_gate.status, 'Active');
});

test('T-V14-16: v14.2 §§347.5 & 348.4 — предпросмотр торговли без мутаций и защита от продажи квест-предметов', () => {
  const sb = createInitialVerticalSliceSandbox();
  const walletBefore = sb.campaign.localMapWalletCopper;

  const buyPreview = previewMerchantTransaction(
    sb.campaign,
    'merchant_neutral_01',
    'buy',
    'item_armor_brigandine'
  );
  assert.equal(buyPreview.ok, true);
  assert.equal(buyPreview.balanceBeforeCopper, walletBefore);
  assert.equal(buyPreview.balanceAfterCopper, walletBefore - buyPreview.priceCopper);
  // Предпросмотр (и отмена) не изменяет баланс!
  assert.equal(sb.campaign.localMapWalletCopper, walletBefore);

  // Продажа единственного свитка предупреждает игрока
  const sellScrollPreview = previewMerchantTransaction(
    sb.campaign,
    'merchant_neutral_01',
    'sell',
    'inst_scroll_frost_01'
  );
  assert.equal(sellScrollPreview.ok, true);
  assert.equal(sellScrollPreview.requiresExtraConfirm, true);

  // Квестовый предмет заблокирован ещё на стадии предпросмотра
  const questSellPreview = previewMerchantTransaction(
    sb.campaign,
    'merchant_neutral_01',
    'sell',
    'inst_quest_seal_01'
  );
  assert.equal(questSellPreview.ok, false);
});
