import assert from 'node:assert/strict';
import test from 'node:test';

import { SAVE_FORMAT_VERSION } from '../src/core/config';
import {
  computeSnapshotChecksum,
  equipItemFromPartyInventory,
  previewHeroEquipmentChange,
  previewMerchantTransaction,
  unequipSlotToPartyInventory,
  validateAndLoadSnapshot,
  verifyItemLocationInvariants,
} from '../src/core/inventoryAndSave';
import {
  activatePlanFromInventory,
  captureRuneMonument,
  computeMonumentSummonTimeSec,
  computeUnlockedRuneTabletSlots,
  ensureRuneTabletSynced,
  evaluatePlanAvailability,
  hasActiveWorkerRuneForRace,
  installRuneInTablet,
  markRuneHeroFallen,
  previewRuneSaleOrDestructionWarning,
  removeRuneFromTablet,
  summonOrResummonRuneHeroAtMonument,
  tickRunePowerRecovery,
} from '../src/core/runesAndPlans';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';

test('T-V14-31: v14.2 §144 — Rune Tablet слоты по уровню Аватара, неактивность руны в инвентаре, Rune Monument и Rune Power', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatar = sb.campaign.heroes[sb.campaign.avatarId];

  // 1. Базовые слоты Rune Tablet и расширение по уровню Аватара (§144.1, §144.3)
  assert.equal(computeUnlockedRuneTabletSlots(1), 4);
  assert.ok(computeUnlockedRuneTabletSlots(5) > computeUnlockedRuneTabletSlots(1));
  avatar.level = 5;
  const synced = ensureRuneTabletSynced(sb.campaign);
  assert.equal(synced.slots.length, computeUnlockedRuneTabletSlots(5));

  // 2. Рабочая руна эльфов лежит в PartyInventory -> НЕ активна (§144.10 #1)
  assert.equal(hasActiveWorkerRuneForRace(sb.campaign, 'elves').active, false);
  const blockedCapture = captureRuneMonument(sb.campaign, sb.activeMap, 'mon_rune_elves_01');
  assert.equal(blockedCapture.ok, false);

  // 3. После установки в Rune Tablet рабочая руна активируется и позволяет захватить Rune Monument (§144.4)
  const installed = installRuneInTablet(sb.campaign, 'inst_rune_worker_elves_01', 1);
  assert.equal(installed.ok, true);
  assert.equal(hasActiveWorkerRuneForRace(sb.campaign, 'elves').active, true);
  const captured = captureRuneMonument(sb.campaign, sb.activeMap, 'mon_rune_elves_01');
  assert.equal(captured.ok, true);
  assert.equal(sb.activeMap.worldObjects?.mon_rune_elves_01.captured, true);

  // 4. Нехватка Rune Power увеличивает время призыва, а на активной карте Rune Power восстанавливается (§144.6)
  const normalTime = computeMonumentSummonTimeSec(6, 15, 20);
  const slowTime = computeMonumentSummonTimeSec(6, 15, 5);
  assert.equal(normalTime, 6);
  assert.ok(slowTime > normalTime);

  const settlement = sb.activeMap.localSettlements.settlement_sector_a;
  settlement.runePower = 10;
  const rec = tickRunePowerRecovery(sb.activeMap, settlement, 4);
  assert.equal(rec.frozen, false);
  assert.ok(rec.recovered > 0);
  assert.ok(settlement.runePower > 10);

  // При заморозке неактивной карты восстановление Rune Power остановлено (§144.6)
  settlement.frozenOnInactiveMap = true;
  const frozenRec = tickRunePowerRecovery(sb.activeMap, settlement, 10);
  assert.equal(frozenRec.frozen, true);
  assert.equal(frozenRec.recovered, 0);
});

test('T-V14-32: v14.2 §144.5 & §317.11 #7 — Hero Rune у Hero Monument, сохранность экипировки после гибели без дубля и запрет снятия руны с экипированного героя', () => {
  const sb = createInitialVerticalSliceSandbox();
  const settlement = sb.activeMap.localSettlements.settlement_sector_a;

  // Нельзя призвать героя, пока Hero Rune в PartyInventory
  const failBeforeInstall = summonOrResummonRuneHeroAtMonument({
    campaign: sb.campaign,
    map: sb.activeMap,
    monumentObjectId: 'mon_hero_sector_a_01',
    runeInstanceId: 'inst_rune_hero_vanguard_01',
    settlement,
  });
  assert.equal(failBeforeInstall.ok, false);

  // Устанавливаем Hero Rune в слот 1 и призываем у Hero Monument
  assert.equal(installRuneInTablet(sb.campaign, 'inst_rune_hero_vanguard_01', 1).ok, true);
  const summoned = summonOrResummonRuneHeroAtMonument({
    campaign: sb.campaign,
    map: sb.activeMap,
    monumentObjectId: 'mon_hero_sector_a_01',
    runeInstanceId: 'inst_rune_hero_vanguard_01',
    settlement,
  });
  assert.equal(summoned.ok, true);
  assert.equal(summoned.resummoned, false);
  const runeHeroId = summoned.hero!.heroId;

  // Надеваем предмет на призванного героя (амулет не требует спец. мастерства)
  assert.equal(
    equipItemFromPartyInventory(sb.campaign, runeHeroId, 'inst_amulet_cha_01', 'amulet').ok,
    true
  );

  // Снятие Hero Rune при надетой экипировке СТРОГО ЗАПРЕЩЕНО (§144.1, §144.5)
  const blockedRemove = removeRuneFromTablet(sb.campaign, 1);
  assert.equal(blockedRemove.ok, false);

  // Гибель героя сохраняет экипировку (§144.5, §144.10 #12)
  const itemCountBeforeDeath = Object.keys(sb.campaign.itemsByInstanceId).length;
  const fallen = markRuneHeroFallen(sb.campaign, runeHeroId);
  assert.equal(fallen.ok, true);
  assert.equal(fallen.preservedEquipmentCount, 1);
  assert.equal(sb.campaign.heroes[runeHeroId].equipment.amulet, 'inst_amulet_cha_01');

  // Повторный призыв у Hero Monument возвращает героя с той же экипировкой и БЕЗ дублей (§317.11 #7)
  const resummoned = summonOrResummonRuneHeroAtMonument({
    campaign: sb.campaign,
    map: sb.activeMap,
    monumentObjectId: 'mon_hero_sector_a_01',
    runeInstanceId: 'inst_rune_hero_vanguard_01',
    settlement,
  });
  assert.equal(resummoned.ok, true);
  assert.equal(resummoned.resummoned, true);
  assert.equal(sb.campaign.heroes[runeHeroId].equipment.amulet, 'inst_amulet_cha_01');
  assert.equal(Object.keys(sb.campaign.itemsByInstanceId).length, itemCountBeforeDeath);
  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);

  // После снятия экипировки в PartyInventory снятие Hero Rune разрешено
  assert.equal(unequipSlotToPartyInventory(sb.campaign, runeHeroId, 'amulet').ok, true);
  assert.equal(removeRuneFromTablet(sb.campaign, 1).ok, true);
  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);
});

test('T-V14-33: v14.2 §146 — Building Plans и Unit Plans: расовая привязка, постоянная активация без дубля и 5 независимых проверок', () => {
  const sb = createInitialVerticalSliceSandbox();
  const settlement = sb.activeMap.localSettlements.settlement_sector_a;

  // 1. Нельзя активировать план пехоты Людей в ветке Эльфов (§146.3, §146.13 #4)
  const wrongRace = activatePlanFromInventory(sb.campaign, 'inst_plan_unit_infantry_01', 'elves');
  assert.equal(wrongRace.ok, false);

  // 2. До активации оценка доступности чётко указывает на отсутствие знания в Plan Book (§146.6)
  const beforeAct = evaluatePlanAvailability(sb.campaign, sb.activeMap, settlement, 'plan_humans_unit_infantry');
  assert.equal(beforeAct.available, false);
  assert.equal(beforeAct.checks.knowledge, false);
  assert.equal(beforeAct.checks.monument, true);
  assert.equal(beforeAct.checks.infrastructure, true);
  assert.equal(beforeAct.checks.resources, true);
  assert.equal(beforeAct.checks.capacity, true);

  // 3. Корректная постоянная активация в разделе Людей
  const activated = activatePlanFromInventory(sb.campaign, 'inst_plan_unit_infantry_01', 'humans');
  assert.equal(activated.ok, true);
  assert.equal(sb.campaign.planBook?.plan_humans_unit_infantry?.status, 'activated');

  // 4. Теперь все 5 проверок зелёные
  const afterAct = evaluatePlanAvailability(sb.campaign, sb.activeMap, settlement, 'plan_humans_unit_infantry');
  assert.equal(afterAct.available, true);
  assert.deepEqual(afterAct.missingReasonsRu, []);

  // 5. Повторная активация дублирующего свитка отклоняется (§146.10 #2)
  sb.campaign.itemsByInstanceId.inst_plan_dup_01 = {
    instanceId: 'inst_plan_dup_01',
    definitionId: 'item_plan_unit_infantry_humans',
    quantity: 1,
    location: { kind: 'party_inventory' },
  };
  const dupAct = activatePlanFromInventory(sb.campaign, 'inst_plan_dup_01', 'humans');
  assert.equal(dupAct.ok, false);

  // 6. Если обнулить ресурсы и повредить казарму — инфраструктура и ресурсы раздельно сигнализируют причины (§146.6)
  settlement.localResources.iron = 0;
  settlement.buildings!.bld_barracks_01.operational = false;
  const blocked = evaluatePlanAvailability(sb.campaign, sb.activeMap, settlement, 'plan_humans_unit_infantry');
  assert.equal(blocked.available, false);
  assert.equal(blocked.checks.knowledge, true);
  assert.equal(blocked.checks.infrastructure, false);
  assert.equal(blocked.checks.resources, false);
  assert.ok(blocked.missingReasonsRu.length >= 2);
});

test('T-V14-34: v14.2 §§317.5, 317.9, 317.11 & §144.7 — предпросмотр экипировки без hover, конфликты 2H, дельты статов и предупреждение для рун', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatarId = sb.campaign.avatarId;
  const avatar = sb.campaign.heroes[avatarId];

  // Надеваем щит в off_hand (требует shields >= 1 -> сначала выдаём 1 очко и проверяем предпросмотр до/после)
  const shieldPreviewFail = previewHeroEquipmentChange(sb.campaign, avatarId, 'inst_shield_01', 'off_hand');
  assert.equal(shieldPreviewFail.canEquip, false);
  assert.ok(shieldPreviewFail.unmetReasonsRu.length > 0);
  // Убеждаемся, что предпросмотр не мутировал экипировку
  assert.equal(avatar.equipment.off_hand, null);

  avatar.baseAttributes.STA = 11;
  avatar.combatMasteries.shields = 1;
  assert.equal(equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_shield_01', 'off_hand').ok, true);

  // Предпросмотр 2H меча при занятых main_hand + off_hand: показывает оба конфликта слотов и точную дельту урона/брони
  const twoHandPreview = previewHeroEquipmentChange(sb.campaign, avatarId, 'inst_sword_2h_01', 'main_hand');
  assert.equal(twoHandPreview.canEquip, false); // STR 10 < 14 и two_handed 0 < 2
  assert.ok(twoHandPreview.unmetReasonsRu.length >= 2);
  assert.equal(twoHandPreview.slotConflicts.length, 2); // main_hand + off_hand
  assert.ok(twoHandPreview.statDelta.weaponBaseDamage > 0);
  assert.ok(twoHandPreview.statDelta.armor < 0); // потеря брони от снятия щита

  // §144.7: Предупреждение при продаже/удалении руны
  const sellRunePreview = previewMerchantTransaction(
    sb.campaign,
    'merchant_neutral_01',
    'sell',
    'inst_rune_worker_elves_01'
  );
  assert.equal(sellRunePreview.ok, true);
  assert.equal(sellRunePreview.requiresExtraConfirm, true);
  assert.ok(sellRunePreview.warningRu?.includes('§144.7'));

  const activeRuneWarn = previewRuneSaleOrDestructionWarning(sb.campaign, 'inst_rune_worker_humans_01');
  assert.equal(activeRuneWarn.isRune, true);
  assert.equal(activeRuneWarn.requiresExtraConfirm, true);
  assert.ok(activeRuneWarn.warningRu?.includes('Rune Tablet'));
});

test('T-V14-35: v14.2 §341.8 — последовательная миграция сохранения v1 -> v2 -> v3 и проверка инвариантов Rune Tablet', () => {
  const sb = createInitialVerticalSliceSandbox();

  // Собираем снимок формата v1 (без runeTablet, planBook, archivedMapsByDefinitionId)
  const v1Campaign = JSON.parse(JSON.stringify(sb.campaign));
  delete v1Campaign.runeTablet;
  delete v1Campaign.planBook;
  delete v1Campaign.archivedMapsByDefinitionId;
  // Убираем тестовую руну, привязанную к rune_tablet, как в старом сохранении v1
  v1Campaign.itemsByInstanceId.inst_rune_worker_humans_01.location = { kind: 'party_inventory' };

  const v1Payload = {
    saveFormatVersion: 1,
    gameBuildVersion: '0.1.0-v14.2',
    contentSchemaVersion: 'v14.2-core-01',
    saveId: 'legacy_v1_to_v3',
    createdAtIso: '2026-11-24T00:00:00.000Z',
    lastCommittedEventId: null,
    campaign: v1Campaign,
    mission: sb.mission,
    activeMap: sb.activeMap,
    eventJournal: sb.eventJournal,
    customTagFromV1: 'preserved-v1-v3',
  };
  const v1WithChecksum = {
    ...v1Payload,
    checksum: computeSnapshotChecksum(v1Payload as unknown as Parameters<typeof computeSnapshotChecksum>[0]),
  };

  const loaded = validateAndLoadSnapshot(JSON.stringify(v1WithChecksum));
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.migratedFromVersion, 1);
    assert.equal(loaded.snapshot.saveFormatVersion, SAVE_FORMAT_VERSION);
    assert.equal(loaded.snapshot.extraMetadata?.customTagFromV1, 'preserved-v1-v3');
    assert.ok(loaded.snapshot.campaign.runeTablet);
    assert.equal(loaded.snapshot.campaign.runeTablet!.slots.length, 4);
    assert.ok(loaded.snapshot.campaign.planBook);
    assert.equal(verifyItemLocationInvariants(loaded.snapshot.campaign).valid, true);
  }

  // Проверка обнаружения порчи инварианта Rune Tablet
  sb.campaign.runeTablet!.slots[0].runeInstanceId = 'inst_sword_1h_01'; // уже equipped!
  const brokenInv = verifyItemLocationInvariants(sb.campaign);
  assert.equal(brokenInv.valid, false);
  assert.ok(brokenInv.errors.length > 0);
});
