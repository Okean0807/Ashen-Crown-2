import test from 'node:test';
import assert from 'node:assert/strict';

import { executePortalMapTransition } from '../src/core/inventoryAndSave';
import { learnOrUpgradeSpell } from '../src/core/progression';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import {
  deliverWorkerCarryToSettlement,
  enqueueSquadProduction,
  extractResourceToWorkerCarry,
  healSquadWithFoodStore,
  reassignWorkerSafe,
  tickSettlementProduction,
  upgradeMilitaryCapWithFood,
} from '../src/core/settlementEconomy';
import {
  applyBuffOrDebuff,
  applyControlEffect,
  applyHealingPacket,
  changeSquadAllegiance,
  filterAutoCastEligibleSpells,
  stepEnemyGroupPursuit,
  switchSquadDeployment,
  updateEnemyGroupKnowledge,
} from '../src/core/squadsAndEffects';

test('v14.2 §§338.2–338.3 & §339.5: 4-стадийная модель ресурсов, защита от дублей и сохранность Carried при переназначении', () => {
  const sb = createInitialVerticalSliceSandbox();
  const s = sb.activeMap.localSettlements.settlement_sector_a;
  const woodBefore = s.localResources.wood ?? 0;

  // Добыча (AtSource -> Carried)
  const ext = extractResourceToWorkerCarry(sb.campaign, s, 'w_01', 15, 'tx_ext_01');
  assert.equal(ext.ok, true);
  assert.equal(ext.carriedAmount, 15);
  assert.equal(s.localResources.wood, woodBefore); // Ещё не в балансе поселения до доставки!

  // Повтор той же транзакции не дублирует ресурс (§338.2)
  assert.equal(extractResourceToWorkerCarry(sb.campaign, s, 'w_01', 15, 'tx_ext_01').ok, false);

  // Переназначение на другой источник сохраняет Carried (§338.3, §339.5)
  const reass = reassignWorkerSafe(s, 'w_01', 'dep_iron_01');
  assert.equal(reass.ok, true);
  assert.equal(reass.preservedCarryAmount, 15);
  assert.equal(s.workers.w_01.carrying?.resourceType, 'wood');

  // При заблокированном маршруте доставка не зачисляется и груз остаётся на руках
  s.deposits.dep_wood_01.routeAccessible = false;
  assert.equal(deliverWorkerCarryToSettlement(sb.campaign, s, 'w_01', 'tx_deliv_fail').ok, false);
  assert.equal(s.workers.w_01.carrying?.amount, 15);

  // Открываем маршрут -> доставка зачисляет ровно 15 wood
  s.deposits.dep_wood_01.routeAccessible = true;
  const deliv = deliverWorkerCarryToSettlement(sb.campaign, s, 'w_01', 'tx_deliv_ok');
  assert.equal(deliv.ok, true);
  assert.equal(s.localResources.wood, woodBefore + 15);
  assert.equal(s.workers.w_01.carrying, null);
});

test('v14.2 §§338.5, 338.7, 339.1 & 341.4: Food лимит/лечение без upkeep, заморозка очереди и перенос выживших отрядов порталом', () => {
  const sb = createInitialVerticalSliceSandbox();
  const s = sb.activeMap.localSettlements.settlement_sector_a;
  const sqAlpha = sb.activeMap.squadRoster!.squad_alpha;

  // Стартовый состав отряда Альфа: 4 бойца, #1 ранен (55/110), #3 погиб (0, alive=false)
  assert.equal(sqAlpha.units.filter((u) => u.alive).length, 3);

  // Food Store лечит только живого раненого, не воскрешая погибшего #3 (§339.1, §42.1)
  const healRes = healSquadWithFoodStore(sb.campaign, s, sqAlpha, 'tx_food_heal_01');
  assert.equal(healRes.ok, true);
  assert.equal(healRes.unitsHealed, 1);
  assert.equal(sqAlpha.units[1].hp, sqAlpha.units[1].maxHp);
  assert.equal(sqAlpha.units[3].alive, false);

  // Food повышает MilitaryCap через HQ (§339.1)
  const capBefore = s.militaryCap;
  const capUp = upgradeMilitaryCapWithFood(sb.campaign, s, 'tx_food_cap_01');
  assert.equal(capUp.ok, true);
  assert.ok(capUp.newMilitaryCap > capBefore);

  // Постановка производства с проверкой Rune Power и заморозкой неактивной карты (§338.5, §338.7)
  const enq = enqueueSquadProduction(s, 'ord_1', 'sq_def_infantry', { wood: 20, iron: 10 }, 15, 3, 20);
  assert.equal(enq.ok, true);
  assert.equal(s.runePower, 25); // 40 - 15 (ману Аватара не трогает!)

  const t1 = tickSettlementProduction(sb.activeMap, s, 5);
  assert.equal(t1.frozen, false);
  assert.equal(s.productionQueue[0].remainingTimeSec, 15);

  // Переключаем второй отряд явно между Garrison <-> FieldArmy без дублирования (§338.6)
  sb.activeMap.squadRoster!.squad_garrison_01 = switchSquadDeployment(
    sb.activeMap.squadRoster!.squad_garrison_01,
    'Garrison'
  );

  // Портал: замораживает старое поселение и переносит ТОЛЬКО выживших из portable FieldArmy (§338.7, §341.4)
  const tr = executePortalMapTransition(sb.campaign, sb.mission, sb.activeMap, 'sector_b', 'tr_slice2_01');
  assert.equal(tr.ok, true);
  assert.equal(s.frozenOnInactiveMap, true);
  // На неактивной карте очередь НЕ двигается (§338.7)
  const tFrozen = tickSettlementProduction(sb.activeMap, s, 100);
  assert.equal(tFrozen.frozen, true);
  assert.equal(s.productionQueue[0].remainingTimeSec, 15);

  // На Секторе Б присутствует squad_alpha с фактическими 3 живыми бойцами (4-й не воскрес!), а Garrison не перенесён
  assert.equal(tr.nextMap?.squadRoster?.squad_alpha.units.length, 3);
  assert.equal(tr.nextMap?.squadRoster?.squad_garrison_01, undefined);
});

test('v14.2 §§343.3, 343.7, 343.8 & 337.3: Enemy AI без всеведения, Demon != Hostile, белый список автокаста', () => {
  const sb = createInitialVerticalSliceSandbox();
  const demon = sb.activeMap.squadRoster!.squad_neutral_demon;
  assert.equal(demon.allegiance, 'Neutral'); // Demon не обязан быть Hostile (§343.3)

  // Явная идемпотентная смена allegiance (§343.8)
  assert.equal(changeSquadAllegiance(sb.campaign, demon, 'Ally', 'evt_al_1').changed, true);
  assert.equal(demon.allegiance, 'Ally');
  assert.equal(changeSquadAllegiance(sb.campaign, demon, 'Hostile', 'evt_al_1').changed, false);
  assert.equal(demon.allegiance, 'Ally');

  // Enemy AI без источника знания остаётся у дома (§343.7)
  let patrolAi = sb.activeMap.enemyAiGroups!.squad_enemy_patrol;
  assert.equal(patrolAi.knowledgeSource, 'none');
  patrolAi = stepEnemyGroupPursuit(patrolAi, { x: 40, y: 40 });
  assert.equal(patrolAi.state, 'IdleAtHome');

  // Контакт local_detection -> преследование -> превышение maxPursuitDistance сбрасывает в ReturningHome
  patrolAi = updateEnemyGroupKnowledge(patrolAi, 'local_detection', { x: 44, y: 41 }, 10);
  assert.equal(patrolAi.state, 'Pursuing');
  patrolAi = stepEnemyGroupPursuit(patrolAi, { x: 56, y: 40 }); // 16м > maxPursuitDistance 12м
  assert.equal(patrolAi.state, 'ReturningHome');
  assert.equal(patrolAi.knowledgeSource, 'none');

  // Белый список автокаста (§337.3)
  const avatar = sb.campaign.heroes[sb.campaign.avatarId];
  learnOrUpgradeSpell(sb.campaign, avatar.heroId, 'spell_dark_raise_skeleton');
  learnOrUpgradeSpell(sb.campaign, avatar.heroId, 'spell_life_mend');
  const autoList = filterAutoCastEligibleSpells(avatar, 'AttackMove');
  const fire = autoList.find((x) => x.spellId === 'spell_elem_fire_bolt');
  const skel = autoList.find((x) => x.spellId === 'spell_dark_raise_skeleton');
  const mend = autoList.find((x) => x.spellId === 'spell_life_mend');
  assert.equal(fire?.eligible, true);
  assert.equal(mend?.eligible, true);
  assert.equal(skel?.eligible, false); // Призыв запрещён в автокасте

  // При Retreat атакующая магия подавляется (§337.2)
  const retreatList = filterAutoCastEligibleSpells(avatar, 'Retreat');
  assert.equal(retreatList.find((x) => x.spellId === 'spell_elem_fire_bolt')?.eligible, false);
});

test('v14.2 §§42.1, 42.2 & 42.4: запрет лечения мёртвых, отсутствие стака одинакового баффа и diminishing returns контроля', () => {
  const sb = createInitialVerticalSliceSandbox();

  // §42.1: Лечение не воскрешает мёртвого и не даёт overheal-щит
  const deadRes = applyHealingPacket({ hp: 0, maxHp: 100, alive: false }, 50);
  assert.equal(deadRes.rejectedDead, true);
  assert.equal(deadRes.healedAmount, 0);

  const liveUnit = { hp: 80, maxHp: 100, alive: true };
  const liveRes = applyHealingPacket(liveUnit, 50);
  assert.equal(liveRes.healedAmount, 20);
  assert.equal(liveRes.overhealDiscarded, 30);
  assert.equal(liveUnit.hp, 100);

  // §42.2: Повторный бафф из одного источника обновляется без бесконечного стака
  applyBuffOrDebuff(sb.activeMap, 'target_1', {
    effectId: 'b1',
    sourceSpellId: 'spell_light_ward',
    kind: 'buff',
    targetStat: 'armor',
    magnitude: 10,
    remainingSec: 5,
    maxDurationSec: 10,
  });
  const b2 = applyBuffOrDebuff(sb.activeMap, 'target_1', {
    effectId: 'b2',
    sourceSpellId: 'spell_light_ward',
    kind: 'buff',
    targetStat: 'armor',
    magnitude: 15,
    remainingSec: 10,
    maxDurationSec: 10,
  });
  assert.equal(b2.refreshed, true);
  assert.equal(b2.stackedCount, 1);

  // §42.4: Повторный контроль внутри окна: 100% -> 50% -> 25% -> 0%, затем сброс после паузы
  const c1 = applyControlEffect(sb.activeMap, 'target_1', 'fear', 6, 10);
  const c2 = applyControlEffect(sb.activeMap, 'target_1', 'fear', 6, 14);
  const c3 = applyControlEffect(sb.activeMap, 'target_1', 'fear', 6, 18);
  const c4 = applyControlEffect(sb.activeMap, 'target_1', 'fear', 6, 20);
  assert.equal(c1.effectiveDurationSec, 6);
  assert.equal(c2.effectiveDurationSec, 3);
  assert.equal(c3.effectiveDurationSec, 1.5);
  assert.equal(c4.applied, false);
  assert.equal(c4.effectiveDurationSec, 0);

  // После истечения окна (20 + 18 = 38 -> проверяем на t=45) сопротивление сбрасывается к полной длительности
  const cReset = applyControlEffect(sb.activeMap, 'target_1', 'fear', 6, 45);
  assert.equal(cReset.applied, true);
  assert.equal(cReset.effectiveDurationSec, 6);
});
