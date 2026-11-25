import assert from 'node:assert/strict';
import test from 'node:test';

import {
  equipItemFromPartyInventory,
  verifyItemLocationInvariants,
} from '../src/core/inventoryAndSave';
import {
  dismissPartyHero,
  summonCompanionHeroToParty,
} from '../src/core/progression';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import {
  damageSettlementBuilding,
  enqueueSquadProduction,
  repairSettlementBuilding,
  startBuildingConstruction,
  tickSettlementProduction,
} from '../src/core/settlementEconomy';
import {
  applyMindEffectToTarget,
  createSquadInstance,
  issueMultiSquadOrder,
  runMandatoryCombatMatrixAudit,
  setSquadFormation,
  tickMindEffectsExpiry,
} from '../src/core/squadsAndEffects';

test('T-V14-22: v14.2 §§317, 331.1, 347.2, 351.2 — мульти-геройная группа, общий PartyInventory и индивидуальная экипировка без дублей', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatarId = sb.campaign.avatarId;

  const summon = summonCompanionHeroToParty({
    campaign: sb.campaign,
    heroId: 'hero_companion_1',
    nameRu: 'Спутник-страж',
    baseAttrOverride: { STR: 14, STA: 14 },
  });
  assert.equal(summon.ok, true);
  assert.ok(sb.campaign.activePartyHeroIds.includes('hero_companion_1'));

  // Общий PartyInventory позволяет надеть предмет из сумки на спутника, не трогая экипировку Аватара (§317, §331.1)
  const eqComp = equipItemFromPartyInventory(
    sb.campaign,
    'hero_companion_1',
    'inst_amulet_cha_01',
    'amulet'
  );
  assert.equal(eqComp.ok, true);
  assert.equal(sb.campaign.heroes.hero_companion_1.equipment.amulet, 'inst_amulet_cha_01');
  assert.equal(sb.campaign.heroes[avatarId].equipment.amulet, null);
  assert.deepEqual(sb.campaign.itemsByInstanceId.inst_amulet_cha_01.location, {
    kind: 'equipped',
    heroId: 'hero_companion_1',
    slot: 'amulet',
  });

  // Нельзя надеть тот же самый экземпляр на Аватара без снятия (§347.2)
  const dupEq = equipItemFromPartyInventory(
    sb.campaign,
    avatarId,
    'inst_amulet_cha_01',
    'amulet'
  );
  assert.equal(dupEq.ok, false);
  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);

  // Аватара нельзя отпустить, спутника — можно (§317)
  assert.equal(dismissPartyHero(sb.campaign, avatarId).ok, false);
  assert.equal(dismissPartyHero(sb.campaign, 'hero_companion_1').ok, true);
  assert.equal(sb.campaign.activePartyHeroIds.includes('hero_companion_1'), false);
});

test('T-V14-23: v14.2 §§4–5 APPROVED, §42.4 — Магия разума без всесилия (босс/нежить/сюжет/воля командира), DR и возврат allegiance', () => {
  const sb = createInitialVerticalSliceSandbox();
  const hero = sb.campaign.heroes[sb.campaign.avatarId];
  const patrol = sb.activeMap.squadRoster!.squad_enemy_patrol;
  const bossDemon = sb.activeMap.squadRoster!.squad_neutral_demon;

  // Босс защищён от переманивания/подчинения (§5)
  const bossRes = applyMindEffectToTarget({
    map: sb.activeMap,
    casterHero: hero,
    targetSquad: bossDemon,
    effectKind: 'charm',
    baseDurationSec: 8,
    currentTimeSec: 10,
  });
  assert.equal(bossRes.ok, false);
  assert.equal(bossDemon.allegiance, 'Neutral');

  // Сюжетно защищённый NPC и Нежить также не поддаются принуждению (§5)
  const undeadSq = createSquadInstance({
    squadId: 'sq_undead_guard',
    nameRu: 'Страж-скелет',
    squadDefId: 'sq_def_undead',
    creatureDefId: 'unit_proto_raider',
    count: 2,
    factionId: 'proto_undead',
    allegiance: 'Hostile',
    deploymentState: 'FieldArmy',
    forceSource: 'patrol',
    portableAcrossPortals: false,
  });
  undeadSq.originType = 'Undead';
  assert.equal(
    applyMindEffectToTarget({
      map: sb.activeMap,
      casterHero: hero,
      targetSquad: undeadSq,
      effectKind: 'fear',
      baseDurationSec: 8,
      currentTimeSec: 10,
    }).ok,
    false
  );

  const plotSq = createSquadInstance({
    squadId: 'sq_plot_envoy',
    nameRu: 'Сюжетный посланник',
    squadDefId: 'sq_def_envoy',
    creatureDefId: 'unit_proto_raider',
    count: 1,
    factionId: 'proto_independent',
    allegiance: 'Neutral',
    deploymentState: 'FieldArmy',
    forceSource: 'patrol',
    portableAcrossPortals: false,
  });
  plotSq.plotCriticalRefusal = true;
  assert.equal(
    applyMindEffectToTarget({
      map: sb.activeMap,
      casterHero: hero,
      targetSquad: plotSq,
      effectKind: 'charm',
      baseDurationSec: 8,
      currentTimeSec: 10,
    }).ok,
    false
  );

  // Командир с высокой волей (24 > CHA 10 + mind 0 * 2 = 10) отражает влияние (§5)
  const cmdSq = createSquadInstance({
    squadId: 'sq_commander',
    nameRu: 'Полевой командир',
    squadDefId: 'sq_def_cmd',
    creatureDefId: 'unit_proto_raider',
    count: 1,
    factionId: 'proto_raiders',
    allegiance: 'Hostile',
    deploymentState: 'FieldArmy',
    forceSource: 'patrol',
    portableAcrossPortals: false,
  });
  cmdSq.npcTier = 'commander';
  cmdSq.willpowerRating = 24;
  assert.equal(
    applyMindEffectToTarget({
      map: sb.activeMap,
      casterHero: hero,
      targetSquad: cmdSq,
      effectKind: 'charm',
      baseDurationSec: 8,
      currentTimeSec: 10,
    }).ok,
    false
  );

  // Обычный патруль поддаётся Charm с DR (§42.4) и по истечении времени возвращает исходный allegiance
  const firstCharm = applyMindEffectToTarget({
    map: sb.activeMap,
    casterHero: hero,
    targetSquad: patrol,
    effectKind: 'charm',
    baseDurationSec: 8,
    currentTimeSec: 10,
  });
  assert.equal(firstCharm.ok, true);
  assert.equal(firstCharm.effectiveDurationSec, 8);
  assert.equal(patrol.allegiance, 'Ally');

  // Повторный Charm в окне DR даёт 50% длительности (4с)
  const secondCharm = applyMindEffectToTarget({
    map: sb.activeMap,
    casterHero: hero,
    targetSquad: patrol,
    effectKind: 'charm',
    baseDurationSec: 8,
    currentTimeSec: 12,
  });
  assert.equal(secondCharm.ok, true);
  assert.equal(secondCharm.effectiveDurationSec, 4);

  const exp = tickMindEffectsExpiry(patrol, 4);
  assert.equal(exp.expired, true);
  assert.equal(patrol.allegiance, 'Hostile');
});

test('T-V14-24: v14.2 §§11.4–11.5 — формации без скрытых бонусов статов и групповой приказ с сохранением боевой роли', () => {
  const sb = createInitialVerticalSliceSandbox();
  const alpha = sb.activeMap.squadRoster!.squad_alpha;
  const archers = sb.activeMap.squadRoster!.squad_garrison_01;

  const hpBefore = alpha.units[0].maxHp;
  const formed = setSquadFormation(alpha, 'defensive');
  assert.equal(formed.formation, 'defensive');
  assert.equal(formed.units[0].maxHp, hpBefore); // §11.4: нет авто-бонусов статов

  const assignments = issueMultiSquadOrder([formed, archers], 'AttackMove', { x: 50, y: 30 });
  const meleeAssign = assignments.find((a) => a.squadId === 'squad_alpha')!;
  const rangedAssign = assignments.find((a) => a.squadId === 'squad_garrison_01')!;

  assert.equal(meleeAssign.roleMode, 'melee_close');
  assert.equal(rangedAssign.roleMode, 'ranged_standoff');
  assert.equal(meleeAssign.assignedPos.x, 50);
  assert.equal(rangedAssign.assignedPos.x, 44); // -6 standoff для стрелков (§11.5)
  assert.equal(formed.command.playerOrder, 'AttackMove');
  assert.equal(archers.command.playerOrder, 'AttackMove');
});

test('T-V14-25: v14.2 §§15.5–15.8, §338.9 — слотовое строительство, заморозка стройки, остановка очереди при повреждении и ремонт за ресурсы', () => {
  const sb = createInitialVerticalSliceSandbox();
  const s = sb.activeMap.localSettlements.settlement_sector_a;

  // Запрещено строить неразрешённую категорию в slot_defense_01 или в занятом слоте (§15.5)
  assert.equal(
    startBuildingConstruction({
      settlement: s,
      slotId: 'slot_defense_01',
      buildingId: 'bld_bad_cat',
      category: 'barracks',
      nameRu: 'Лишняя казарма',
      woodCost: 20,
      stoneCost: 20,
      buildTimeSec: 10,
    }).ok,
    false
  );
  assert.equal(
    startBuildingConstruction({
      settlement: s,
      slotId: 'slot_hq_01',
      buildingId: 'bld_dup_hq',
      category: 'headquarters',
      nameRu: 'Второй штаб',
      woodCost: 20,
      stoneCost: 20,
      buildTimeSec: 10,
    }).ok,
    false
  );

  // Допустимая постройка в свободном слоте требует времени (не мгновенна §15.6)
  const buildTower = startBuildingConstruction({
    settlement: s,
    slotId: 'slot_defense_01',
    buildingId: 'bld_tower_01',
    category: 'defense',
    nameRu: 'Сторожевая башня',
    woodCost: 40,
    stoneCost: 30,
    buildTimeSec: 12,
  });
  assert.equal(buildTower.ok, true);
  assert.equal(s.buildings!.bld_tower_01.operational, false);
  assert.equal(s.buildings!.bld_tower_01.constructionRemainingSec, 12);

  // На неактивной карте стройка заморожена
  s.frozenOnInactiveMap = true;
  assert.equal(tickSettlementProduction(sb.activeMap, s, 20).frozen, true);
  assert.equal(s.buildings!.bld_tower_01.constructionRemainingSec, 12);
  s.frozenOnInactiveMap = false;

  // Завершение стройки на активной карте
  const tickRes = tickSettlementProduction(sb.activeMap, s, 12);
  assert.deepEqual(tickRes.completedBuildingIds, ['bld_tower_01']);
  assert.equal(s.buildings!.bld_tower_01.operational, true);

  // Ставим заказ в казарму, затем повреждаем казарму: очередь ставится на паузу, несвязанные ресурсы не пропадают (§15.8)
  const foodBefore = s.localResources.food;
  assert.equal(
    enqueueSquadProduction(s, 'ord_b_01', 'sq_def_infantry', { wood: 20, iron: 10 }, 5, 2, 10).ok,
    true
  );
  const dmgRes = damageSettlementBuilding(s, 'bld_barracks_01', 180);
  assert.equal(dmgRes.damaged, true);
  assert.equal(s.productionQueue[0].pausedReason, 'building_damaged');
  assert.equal(s.localResources.food, foodBefore);

  // Пока казарма повреждена, тик не двигает поставленный на паузу заказ и нельзя нанять новый
  tickSettlementProduction(sb.activeMap, s, 15);
  assert.equal(s.productionQueue.length, 1);
  assert.equal(
    enqueueSquadProduction(s, 'ord_b_02', 'sq_def_infantry', { wood: 20, iron: 10 }, 5, 2, 10).stopReason,
    'building_damaged'
  );

  // Ремонт казармы тратит Wood, не трогает Food/HP юнитов, и снимает паузу с очереди (§15.8)
  const squadHpBefore = sb.activeMap.squadRoster!.squad_alpha.units[1].hp;
  const repRes = repairSettlementBuilding(s, 'bld_barracks_01');
  assert.equal(repRes.ok, true);
  assert.equal(s.localResources.food, foodBefore);
  assert.equal(sb.activeMap.squadRoster!.squad_alpha.units[1].hp, squadHpBefore);
  assert.equal(s.buildings!.bld_barracks_01.operational, true);
  assert.equal(s.productionQueue[0].pausedReason, null);
});

test('T-V14-26: v14.2 §36.1 — обязательный аудит инвариантов боевой матрицы и формул', () => {
  const audit = runMandatoryCombatMatrixAudit();
  assert.equal(audit.allPassed, true);
  assert.ok(audit.checks.length >= 6);
  for (const chk of audit.checks) {
    assert.equal(chk.passed, true, `Провал проверки ${chk.id}: ${chk.labelRu} (${chk.metric})`);
  }
});
