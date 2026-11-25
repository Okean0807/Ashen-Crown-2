import assert from 'node:assert/strict';
import test from 'node:test';

import { beginHeroCast, applyCombatInterruptToHeroCast } from '../src/core/combatAndMagic';
import {
  activateQuestIfPrerequisitesMet,
  createSaveSnapshot,
  discardOrDestroyInventoryItem,
  equipItemFromPartyInventory,
  executePortalMapTransition,
  isCombatConsumableAllowed,
  validateAndLoadSnapshot,
  verifyItemLocationInvariants,
} from '../src/core/inventoryAndSave';
import { summonCompanionHeroToParty } from '../src/core/progression';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import {
  damageSettlementBuilding,
  repairSettlementBuilding,
  replenishSquadFromSettlement,
  validateSettlementEconomicPlayability,
} from '../src/core/settlementEconomy';
import {
  applyMindEffectToTarget,
  awardArmyVictoryXpToHero,
  tickMindEffectsExpiry,
} from '../src/core/squadsAndEffects';

test('T-V14-27 (§14.6, §14.8): Пополнение отряда вне боя/с казармой, отказ командиру и XP герою за победы армии', () => {
  const sb = createInitialVerticalSliceSandbox();
  const settlement = sb.activeMap.localSettlements.settlement_sector_a;
  const alpha = sb.activeMap.squadRoster!.squad_alpha;

  // В активном бою пополнение запрещено (§14.6)
  const blockedCombat = replenishSquadFromSettlement({
    campaign: sb.campaign,
    settlement,
    squad: alpha,
    transactionId: 'rep_combat_block',
    inCombat: true,
  });
  assert.equal(blockedCombat.ok, false);

  // Повреждённая казарма блокирует пополнение
  damageSettlementBuilding(settlement, 'bld_barracks_01', 180);
  const blockedDamaged = replenishSquadFromSettlement({
    campaign: sb.campaign,
    settlement,
    squad: alpha,
    transactionId: 'rep_damaged_block',
    inCombat: false,
  });
  assert.equal(blockedDamaged.ok, false);
  assert.equal(blockedDamaged.stopReason, 'building_damaged');

  // После ремонта казармы пополнение восстанавливает павшего бойца (units[3]) за Wood + Iron
  repairSettlementBuilding(settlement, 'bld_barracks_01');
  const woodBefore = settlement.localResources.wood ?? 0;
  const ironBefore = settlement.localResources.iron ?? 0;
  const repOk = replenishSquadFromSettlement({
    campaign: sb.campaign,
    settlement,
    squad: alpha,
    transactionId: 'rep_ok_01',
    inCombat: false,
  });
  assert.equal(repOk.ok, true);
  assert.equal(repOk.replenishedUnits, 1);
  assert.equal(alpha.units[3].alive, true);
  assert.equal(alpha.units[3].hp, alpha.units[3].maxHp);
  assert.equal(settlement.localResources.wood, woodBefore - repOk.woodSpent);
  assert.equal(settlement.localResources.iron, ironBefore - repOk.ironSpent);

  // Особый командир (npcTier === 'commander') не воскрешается пополнением (§14.6)
  alpha.npcTier = 'commander';
  alpha.units[0].alive = false;
  alpha.units[0].hp = 0;
  const blockedCommander = replenishSquadFromSettlement({
    campaign: sb.campaign,
    settlement,
    squad: alpha,
    transactionId: 'rep_cmd_block',
    inCombat: false,
  });
  assert.equal(blockedCommander.ok, false);

  // Победа армии начисляет XP герою, при этом обычные солдаты не имеют RPG-характеристик (§14.8)
  const patrol = sb.activeMap.squadRoster!.squad_enemy_patrol;
  const avatarBeforeXp = sb.campaign.heroes[sb.campaign.avatarId].xp;
  const armyXp = awardArmyVictoryXpToHero({
    campaign: sb.campaign,
    defeatedSquad: patrol,
    transactionId: 'army_win_01',
    baseXpPerUnit: 50,
  });
  assert.equal(armyXp.ok, true);
  assert.ok(armyXp.grantedXp > 0);
  assert.ok(
    sb.campaign.heroes[sb.campaign.avatarId].xp > avatarBeforeXp || armyXp.levelUps.length > 0
  );
  assert.equal('xp' in alpha.units[1], false);
  assert.equal('baseAttributes' in alpha.units[1], false);
});

test('T-V14-28 (§338.8): Выявление экономического softlock поселения без выдачи бесплатных ресурсов', () => {
  const sb = createInitialVerticalSliceSandbox();
  const settlement = sb.activeMap.localSettlements.settlement_sector_a;

  // Исходное состояние проходимо
  const initialAudit = validateSettlementEconomicPlayability(settlement);
  assert.equal(initialAudit.playable, true);
  assert.equal(initialAudit.issues.length, 0);

  // Ломаем казарму, обнуляем Wood и перекрываем/истощаем источник Wood -> softlock (§338.8)
  damageSettlementBuilding(settlement, 'bld_barracks_01', 180);
  settlement.localResources.wood = 2;
  settlement.deposits.dep_wood_01.remainingAmount = 0;

  const softlockAudit = validateSettlementEconomicPlayability(settlement);
  assert.equal(softlockAudit.playable, false);
  assert.ok(softlockAudit.issues.length >= 1);
  // Бесплатных ресурсов не выдаётся: баланс остаётся 2
  assert.equal(settlement.localResources.wood, 2);

  // Если появляется доступный источник древесины — поселение снова восстанавливаемо
  settlement.deposits.dep_wood_01.remainingAmount = 100;
  settlement.deposits.dep_wood_01.routeAccessible = true;
  const recoveredAudit = validateSettlementEconomicPlayability(settlement);
  assert.equal(recoveredAudit.playable, true);
});

test('T-V14-29 (§§303, 347.7, 140.1, 242): Зависимости квестов, защита квест-предметов и запрет боевых зелий HP/Mana', () => {
  const sb = createInitialVerticalSliceSandbox();

  // Добавляем зависимый квест, требующий завершения quest_main_sector_gate
  sb.campaign.quests.quest_followup_gate = {
    questId: 'quest_followup_gate',
    questClass: 'Main',
    titleRu: 'Последующее задание (тест §303)',
    summaryRu: 'Доступно только после завершения магистрали перехода.',
    fullDescriptionRu: 'Проверка prerequisiteQuestIds.',
    loreJournalNotesRu: [],
    status: 'Unavailable',
    stages: [
      { stageId: 'st_1', titleRu: 'Этап 1', descriptionRu: 'Проверить.', completed: false },
    ],
    prerequisiteQuestIds: ['quest_main_sector_gate'],
  };

  const blockedQuest = activateQuestIfPrerequisitesMet(sb.campaign, 'quest_followup_gate');
  assert.equal(blockedQuest.ok, false);

  sb.campaign.quests.quest_main_sector_gate.status = 'Completed';
  const activatedQuest = activateQuestIfPrerequisitesMet(sb.campaign, 'quest_followup_gate');
  assert.equal(activatedQuest.ok, true);
  assert.equal(sb.campaign.quests.quest_followup_gate.status, 'Active');

  // Защита квестового предмета от удаления (§347.7)
  const blockedDelete = discardOrDestroyInventoryItem(sb.campaign, 'inst_quest_seal_01');
  assert.equal(blockedDelete.ok, false);
  assert.ok(sb.campaign.itemsByInstanceId.inst_quest_seal_01);

  // Не-квестовый предмет удаляется корректно
  const okDelete = discardOrDestroyInventoryItem(sb.campaign, 'inst_shield_01');
  assert.equal(okDelete.ok, true);
  assert.equal(sb.campaign.itemsByInstanceId.inst_shield_01, undefined);

  // Категорический запрет универсальных боевых зелий HP/Mana (§140.1, §242)
  assert.equal(isCombatConsumableAllowed('hp_potion').allowed, false);
  assert.equal(isCombatConsumableAllowed('mana_potion').allowed, false);
  assert.equal(isCombatConsumableAllowed('spell_scroll').allowed, false);
});

test('T-V14-30 (E2E v14.2): Сквозной сценарий — спутник -> инвентарь -> прерывание каста -> Mind Magic -> пополнение -> портал/возврат -> сейв v2', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatarId = sb.campaign.avatarId;

  // 1. Призыв спутника и экипировка из общего PartyInventory
  const compRes = summonCompanionHeroToParty({
    campaign: sb.campaign,
    heroId: 'hero_comp_e2e',
    nameRu: 'Спутник E2E',
  });
  assert.equal(compRes.ok, true);
  assert.equal(
    equipItemFromPartyInventory(sb.campaign, 'hero_comp_e2e', 'inst_amulet_cha_01', 'amulet').ok,
    true
  );

  // 2. Начало каста и прерывание уроном без возврата маны (§40.3–40.4)
  const manaBeforeCast = sb.campaign.heroes[avatarId].mana;
  const castStart = beginHeroCast(sb.campaign, avatarId, 'spell_elem_fire_bolt', 'squad_enemy_patrol');
  assert.equal(castStart.ok, true);
  const intr = applyCombatInterruptToHeroCast(sb.campaign.heroes[avatarId], 25);
  assert.equal(intr.interrupted, true);
  assert.equal(intr.manaRefunded, 0);
  assert.ok(sb.campaign.heroes[avatarId].mana < manaBeforeCast);

  // 3. Магия разума с DR и возвратом исходного allegiance (§4-5, §42.4)
  const patrol = sb.activeMap.squadRoster!.squad_enemy_patrol;
  const charmRes = applyMindEffectToTarget({
    map: sb.activeMap,
    casterHero: sb.campaign.heroes[avatarId],
    targetSquad: patrol,
    effectKind: 'charm',
    baseDurationSec: 6,
    currentTimeSec: 10,
  });
  assert.equal(charmRes.ok, true);
  assert.equal(patrol.allegiance, 'Ally');
  const exp = tickMindEffectsExpiry(patrol, 7);
  assert.equal(exp.expired, true);
  assert.equal(patrol.allegiance, 'Hostile');

  // 4. Пополнение отряда Альфа в поселении (3 живых -> 4 живых)
  const settlement = sb.activeMap.localSettlements.settlement_sector_a;
  const alpha = sb.activeMap.squadRoster!.squad_alpha;
  const rep = replenishSquadFromSettlement({
    campaign: sb.campaign,
    settlement,
    squad: alpha,
    transactionId: 'e2e_rep_alpha',
    inCombat: false,
  });
  assert.equal(rep.ok, true);
  assert.equal(alpha.units.filter((u) => u.alive).length, 4);

  // 5. Портальный переход sector_a -> sector_b -> sector_a (AllowReturn + MagicStrain reset + Checkpoint)
  const p1 = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    sb.activeMap,
    'sector_b',
    'e2e_tr_1',
    undefined,
    sb.eventJournal
  );
  assert.equal(p1.ok, true);
  assert.ok(p1.nextMap);
  assert.equal(sb.campaign.heroes[avatarId].magicStrain.index, 0);
  assert.equal((sb.campaign.checkpoints ?? []).length, 1);

  const p2 = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    p1.nextMap!,
    'sector_a',
    'e2e_tr_2',
    undefined,
    sb.eventJournal
  );
  assert.equal(p2.ok, true);
  assert.equal(p2.nextMap?.mapDefinitionId, 'sector_a');
  assert.equal(
    p2.nextMap?.squadRoster?.squad_alpha.units.filter((u) => u.alive).length,
    4
  );

  // 6. Сохранение и загрузка SaveSnapshot v2 + проверка инвариантов предметов
  const snap = createSaveSnapshot(sb.campaign, sb.mission, p2.nextMap!, sb.eventJournal, 'e2e_save');
  const loaded = validateAndLoadSnapshot(JSON.stringify(snap));
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(verifyItemLocationInvariants(loaded.snapshot.campaign).valid, true);
    assert.equal(loaded.snapshot.campaign.activePartyHeroIds.length, 2);
  }
});
