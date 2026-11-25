import assert from 'node:assert/strict';
import test from 'node:test';

import { PROTOTYPE_ITEMS } from '../src/core/catalog';
import { DEFAULT_WORKING_ASSUMPTIONS } from '../src/core/config';
import {
  detectDependencyCycles,
  evaluateUnifiedUnlock,
  runCampaignAntiDeadlockAudit,
} from '../src/core/campaignAudit';
import {
  canStacksMerge,
  completeQuestStageAndMaybeReward,
  createSaveSnapshot,
  executePortalMapTransition,
  mergeItemStacks,
  pickupItemToPartyInventory,
  queryPartyInventoryItems,
  splitItemStack,
  validateAndLoadSnapshot,
  verifyItemLocationInvariants,
} from '../src/core/inventoryAndSave';
import { applyDialogueChoice, interactWithWorldObject } from '../src/core/missionAndWorld';
import {
  activatePlanFromInventory,
  captureRuneMonument,
  installRuneInTablet,
  summonOrResummonRuneHeroAtMonument,
} from '../src/core/runesAndPlans';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import {
  enqueueSquadProduction,
  startBuildingConstruction,
  tickSettlementProduction,
} from '../src/core/settlementEconomy';

test('T-V14-36: v14.2 §274 — безлимитный PartyInventory, стаки, split/merge с сохранением количества и фильтрация/сортировка', () => {
  const sb = createInitialVerticalSliceSandbox();

  // 1. Подбор 5 свитков поверх 1 существующего при временном maxStackSize = 4 -> 4 + 2 без блокировки подбора (§274.1, §274.3)
  const customCfg = { ...DEFAULT_WORKING_ASSUMPTIONS, maxStackSize: 4 };
  const pick = pickupItemToPartyInventory(sb.campaign, 'item_scroll_frost_nova', 5, 'pick_scroll', {
    config: customCfg,
  });
  assert.equal(pick.ok, true);
  assert.equal(pick.addedQuantity, 5);
  const scrollStacks = Object.values(sb.campaign.itemsByInstanceId).filter(
    (i) => i.location.kind === 'party_inventory' && i.definitionId === 'item_scroll_frost_nova'
  );
  const totalScrolls = scrollStacks.reduce((sum, s) => sum + s.quantity, 0);
  assert.equal(totalScrolls, 6);
  assert.equal(scrollStacks.length, 2);

  // 2. Разделение стака сохраняет общее количество (§274.3)
  const mainStack = scrollStacks.find((s) => s.quantity === 4)!;
  assert.equal(splitItemStack(sb.campaign, mainStack.instanceId, 1, 'split_scroll_01').ok, true);
  assert.equal(mainStack.quantity, 3);
  assert.equal(sb.campaign.itemsByInstanceId.split_scroll_01.quantity, 1);

  // 3. Объединение совместимых стаков сохраняет сумму и удаляет опустевший источник (§274.3)
  const merged = mergeItemStacks(sb.campaign, 'split_scroll_01', mainStack.instanceId);
  assert.equal(merged.ok, true);
  assert.equal(merged.sourceRemoved, true);
  assert.equal(mainStack.quantity, 4);
  assert.equal(sb.campaign.itemsByInstanceId.split_scroll_01, undefined);

  // 4. Несовместимые предметы (квестовый vs обычный, экипировка) НЕ объединяются (§274.2)
  sb.campaign.itemsByInstanceId.quest_scroll_fake = {
    instanceId: 'quest_scroll_fake',
    definitionId: 'item_scroll_frost_nova',
    quantity: 1,
    location: { kind: 'party_inventory' },
    isQuestProtected: true,
  };
  assert.equal(canStacksMerge(mainStack, sb.campaign.itemsByInstanceId.quest_scroll_fake), false);
  assert.equal(
    canStacksMerge(sb.campaign.itemsByInstanceId.inst_sword_2h_01, sb.campaign.itemsByInstanceId.inst_shield_01),
    false
  );

  // 5. Категории и сортировка PartyInventory (§274.1)
  const runesOnly = queryPartyInventoryItems(sb.campaign, { category: 'runes' });
  assert.ok(runesOnly.length >= 2);
  const byPrice = queryPartyInventoryItems(sb.campaign, { category: 'equipment', sortBy: 'price_desc' });
  assert.ok(byPrice.length >= 2);
  for (let i = 1; i < byPrice.length; i++) {
    assert.ok(
      PROTOTYPE_ITEMS[byPrice[i - 1].definitionId].basePriceCopper >=
        PROTOTYPE_ITEMS[byPrice[i].definitionId].basePriceCopper
    );
  }
});

test('T-V14-37: v14.2 §258.3–258.4 — Единая матрица разблокировок возвращает ВСЕ критические коды UnlockLockCode сразу', () => {
  const sb = createInitialVerticalSliceSandbox();
  const settlement = sb.activeMap.localSettlements.settlement_sector_a;

  // 1. 2H меч одновременно заблокирован по атрибуту (STR) и мастерству (two_handed)
  const eqCheck = evaluateUnifiedUnlock({
    campaign: sb.campaign,
    map: sb.activeMap,
    target: { kind: 'equipment', instanceId: 'inst_sword_2h_01', targetSlot: 'main_hand' },
  });
  assert.equal(eqCheck.unlocked, false);
  assert.ok(eqCheck.lockCodes.includes('LOCKED_ATTRIBUTE'));
  assert.ok(eqCheck.lockCodes.includes('LOCKED_MASTERY'));

  // 2. План лучников Эльфов одновременно не имеет: Plan Book, Worker Rune, поселения/казармы, ресурсов и лимита
  const elfPlanCheck = evaluateUnifiedUnlock({
    campaign: sb.campaign,
    map: sb.activeMap,
    settlement: null,
    target: { kind: 'plan', planId: 'plan_elves_unit_archer' },
  });
  assert.equal(elfPlanCheck.unlocked, false);
  assert.ok(elfPlanCheck.lockCodes.includes('LOCKED_PLAN'));
  assert.ok(elfPlanCheck.lockCodes.includes('LOCKED_RUNE'));
  assert.ok(elfPlanCheck.lockCodes.includes('LOCKED_BUILDING'));
  assert.ok(elfPlanCheck.lockCodes.includes('LOCKED_RESOURCE'));
  assert.ok(elfPlanCheck.lockCodes.includes('LOCKED_CAP'));

  // 3. Заклинание frost_nova без формулы, без мастерства школы и без очков магии
  sb.campaign.heroes[sb.campaign.avatarId].unspent.magicPoints = 0;
  const spellCheck = evaluateUnifiedUnlock({
    campaign: sb.campaign,
    map: sb.activeMap,
    target: { kind: 'spell_learn', spellId: 'spell_elem_frost_nova' },
  });
  assert.equal(spellCheck.unlocked, false);
  assert.ok(spellCheck.lockCodes.includes('LOCKED_SPELL_FORMULA'));
  assert.ok(spellCheck.lockCodes.includes('LOCKED_MASTERY'));
  assert.ok(spellCheck.lockCodes.includes('LOCKED_RESOURCE'));

  // 4. Маршрут портала без кампанийного флага
  const routeCheck = evaluateUnifiedUnlock({
    campaign: sb.campaign,
    map: sb.activeMap,
    settlement,
    target: {
      kind: 'portal_route',
      requiredWorldFlag: 'missing_chapter_flag',
      targetMapDefId: 'sector_b',
    },
  });
  assert.equal(routeCheck.unlocked, false);
  assert.ok(routeCheck.lockCodes.includes('LOCKED_CAMPAIGN_FLAG'));

  // 5. Завершённый квест возвращает ALREADY_CLAIMED
  const doneQuestCheck = evaluateUnifiedUnlock({
    campaign: sb.campaign,
    map: sb.activeMap,
    target: { kind: 'quest_activate', questId: 'quest_side_initial_report' },
  });
  assert.equal(doneQuestCheck.unlocked, false);
  assert.ok(doneQuestCheck.lockCodes.includes('ALREADY_CLAIMED'));
});

test('T-V14-38: v14.2 §258.7 & §262.4 — Анти-тупиковый аудит выявляет циклы, дубли SquadID между картами и незамороженные архивные карты', () => {
  const sb = createInitialVerticalSliceSandbox();

  // На чистом стартовом состоянии аудит полностью зелёный
  const cleanAudit = runCampaignAntiDeadlockAudit(sb.campaign, sb.mission, sb.activeMap);
  assert.equal(cleanAudit.passed, true);
  assert.deepEqual(cleanAudit.issuesRu, []);

  // Внедряем циклические зависимости квестов A <-> B (§262.4 #3)
  sb.campaign.quests.quest_cycle_a = {
    questId: 'quest_cycle_a',
    questClass: 'Side',
    titleRu: 'Цикл А',
    summaryRu: '',
    fullDescriptionRu: '',
    loreJournalNotesRu: [],
    status: 'Unavailable',
    stages: [],
    prerequisiteQuestIds: ['quest_cycle_b'],
  };
  sb.campaign.quests.quest_cycle_b = {
    questId: 'quest_cycle_b',
    questClass: 'Side',
    titleRu: 'Цикл Б',
    summaryRu: '',
    fullDescriptionRu: '',
    loreJournalNotesRu: [],
    status: 'Unavailable',
    stages: [],
    prerequisiteQuestIds: ['quest_cycle_a'],
  };
  assert.ok(
    detectDependencyCycles({ quest_cycle_a: ['quest_cycle_b'], quest_cycle_b: ['quest_cycle_a'] }).length > 0
  );

  // Портал в Сектор Б, затем искусственно дублируем squad_alpha обратно в архив и размораживаем архивную карту
  const p = executePortalMapTransition(sb.campaign, sb.mission, sb.activeMap, 'sector_b', 'tr_audit_01');
  assert.equal(p.ok, true);
  const mapB = p.nextMap!;
  const archA = sb.campaign.archivedMapsByDefinitionId!.sector_a;
  archA.squadRoster!.squad_alpha = JSON.parse(JSON.stringify(mapB.squadRoster!.squad_alpha));
  archA.localSettlements.settlement_sector_a.frozenOnInactiveMap = false;

  const brokenAudit = runCampaignAntiDeadlockAudit(sb.campaign, sb.mission, mapB);
  assert.equal(brokenAudit.passed, false);
  assert.equal(brokenAudit.checks.noDependencyCycles, false);
  assert.equal(brokenAudit.checks.squadCrossMapIsolation, false);
  assert.equal(brokenAudit.checks.archivedMapsFrozen, false);
  assert.ok(brokenAudit.issuesRu.length >= 3);
});

test('T-V14-39: v14.2 §262 — Сквозная тестовая кампания без лора (T01..T10 + обязательные сценарии отказа и восстановления)', () => {
  const sb = createInitialVerticalSliceSandbox();
  let activeMap = sb.activeMap;
  const settlementA = activeMap.localSettlements.settlement_sector_a;

  // T01: Исследование, лут контейнера без дубля и первый шаг квеста
  const lootRes = interactWithWorldObject(sb.campaign, activeMap, 'obj_loot_cache_01', 'Loot', 'avatar', 't01_loot');
  assert.equal(lootRes.ok, true);
  assert.equal(
    interactWithWorldObject(sb.campaign, activeMap, 'obj_loot_cache_01', 'Loot', 'avatar', 't01_loot_dup').ok,
    false
  );

  // T02-T03: Worker Rune (Эльфы) -> Rune Monument, постройка здания и активация Unit Plan
  assert.equal(installRuneInTablet(sb.campaign, 'inst_rune_worker_elves_01', 1).ok, true);
  assert.equal(captureRuneMonument(sb.campaign, activeMap, 'mon_rune_elves_01').ok, true);
  assert.equal(
    startBuildingConstruction({
      settlement: settlementA,
      slotId: 'slot_defense_01',
      buildingId: 'bld_tower_t03',
      category: 'defense',
      nameRu: 'Тестовая башня T03',
      woodCost: 30,
      stoneCost: 20,
      buildTimeSec: 15,
    }).ok,
    true
  );
  assert.equal(activatePlanFromInventory(sb.campaign, 'inst_plan_unit_infantry_01', 'humans').ok, true);

  // T04: Призыв Hero Rune у Hero Monument + незавершённая очередь производства (сценарий отказа §262.3)
  assert.equal(installRuneInTablet(sb.campaign, 'inst_rune_hero_vanguard_01', 2).ok, true);
  assert.equal(
    summonOrResummonRuneHeroAtMonument({
      campaign: sb.campaign,
      map: activeMap,
      monumentObjectId: 'mon_hero_sector_a_01',
      runeInstanceId: 'inst_rune_hero_vanguard_01',
      settlement: settlementA,
    }).ok,
    true
  );
  assert.equal(
    enqueueSquadProduction(settlementA, 'ord_t04', 'sq_def_infantry', { wood: 10, iron: 10 }, 5, 2, 20).ok,
    true
  );

  // T07 (альтернативная ветвь): закрываем побочный квест через диалог в статус Closed (не Failed)
  const dlgRes = applyDialogueChoice(
    sb.campaign,
    activeMap,
    'dlg_sector_coordinator',
    'node_start',
    'ch_close_side_branch'
  );
  assert.equal(dlgRes.ok, true);
  assert.equal(sb.campaign.quests.quest_side_supply_audit.status, 'Closed');

  // T05-T06: Потеря части полевой армии и переход в Сектор Б (экспедиция без базы) с незавершённой очередью в Секторе А
  activeMap.squadRoster!.squad_alpha.units[0].hp = 0;
  activeMap.squadRoster!.squad_alpha.units[0].alive = false;
  const toB = executePortalMapTransition(sb.campaign, sb.mission, activeMap, 'sector_b', 'tr_t05_b');
  assert.equal(toB.ok, true);
  activeMap = toB.nextMap!;
  // Только 2 выживших из 4 перенеслись, гарнизон остался в Секторе А, локальные ресурсы Сектора А не утекли
  assert.equal(activeMap.squadRoster!.squad_alpha.units.length, 2);
  assert.equal(activeMap.squadRoster!.squad_garrison_01, undefined);
  assert.deepEqual(activeMap.localSettlements, {});
  // Аудит кампании после перехода полностью проходит
  assert.equal(runCampaignAntiDeadlockAudit(sb.campaign, sb.mission, activeMap).passed, true);

  // T08: Возврат на постоянную территорию Сектора А (AllowReturn) -> здание, гарнизон и незавершённая очередь сохранены без фонового тика
  const backA = executePortalMapTransition(sb.campaign, sb.mission, activeMap, 'sector_a', 'tr_t08_a');
  assert.equal(backA.ok, true);
  activeMap = backA.nextMap!;
  const restoredSettlementA = activeMap.localSettlements.settlement_sector_a;
  assert.ok(restoredSettlementA.buildings?.bld_tower_t03);
  assert.equal(restoredSettlementA.buildings?.bld_tower_t03.constructionRemainingSec, 15);
  assert.equal(restoredSettlementA.productionQueue.length, 1);
  assert.ok(activeMap.squadRoster!.squad_garrison_01);
  assert.equal(activeMap.squadRoster!.squad_alpha.units.length, 2);
  // Завершаем стройку и очередь уже на активной карте
  tickSettlementProduction(activeMap, restoredSettlementA, 25);
  assert.equal(restoredSettlementA.buildings?.bld_tower_t03.operational, true);

  // T09-T10: Сохранение до завершения миссии, завершение основного задания (однократная награда), сохранение после, проверка отказа битого сейва
  const snapBefore = JSON.stringify(createSaveSnapshot(sb.campaign, sb.mission, activeMap, sb.eventJournal, 'save_t10_pre'));
  assert.equal(
    completeQuestStageAndMaybeReward(sb.campaign, 'quest_main_sector_gate', 'stage_verify_equipment', 't10_s1').ok,
    true
  );
  const doneMain = completeQuestStageAndMaybeReward(
    sb.campaign,
    'quest_main_sector_gate',
    'stage_portal_ready',
    't10_s2'
  );
  assert.equal(doneMain.questCompleted, true);
  assert.equal(doneMain.rewardGranted, true);
  // Повторная выдача награды заблокирована (§262.4 #4)
  assert.equal(
    completeQuestStageAndMaybeReward(sb.campaign, 'quest_main_sector_gate', 'stage_portal_ready', 't10_s2').ok,
    false
  );

  const snapAfter = JSON.stringify(createSaveSnapshot(sb.campaign, sb.mission, activeMap, sb.eventJournal, 'save_t10_post'));
  assert.equal(validateAndLoadSnapshot(snapBefore).ok, true);
  const loadedAfter = validateAndLoadSnapshot(snapAfter);
  assert.equal(loadedAfter.ok, true);
  if (loadedAfter.ok) {
    assert.equal(loadedAfter.snapshot.campaign.quests.quest_main_sector_gate.status, 'Completed');
    assert.equal(verifyItemLocationInvariants(loadedAfter.snapshot.campaign).valid, true);
    assert.equal(
      runCampaignAntiDeadlockAudit(
        loadedAfter.snapshot.campaign,
        loadedAfter.snapshot.mission,
        loadedAfter.snapshot.activeMap
      ).passed,
      true
    );
  }

  // Сбой сохранения / повреждённый JSON не портит валидные данные (§262.4 #11)
  const corrupted = validateAndLoadSnapshot(snapAfter.replace('quest_main_sector_gate', 'corrupted_id'));
  assert.equal(corrupted.ok, false);
});
