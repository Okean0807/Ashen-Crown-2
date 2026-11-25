import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runPrototypeCatalogAndAuditReport,
  validateContentCatalogRecords,
  validateNumericalAuditEntries,
  validateSixRaceResourceMatrix,
} from '../src/core/catalogAudit';
import {
  advanceAvatarRespawnTimer,
  evaluateAutonomousUndeadBehavior,
  issueNecromancyMinionOrder,
  tickNecromancyMinions,
  triggerAvatarDeath,
} from '../src/core/combatAndMagic';
import { PLAYABLE_RACES } from '../src/core/config';
import { executePortalMapTransition } from '../src/core/inventoryAndSave';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import {
  getRaceResourceCapability,
  validateSettlementResourceCostForRace,
} from '../src/core/settlementEconomy';
import type { ContentCatalogEntityRecord, NumericalAuditEntry } from '../src/core/types';

test('T-V14-40: v14.2 §107 & §105.8 #11 — Автономная нежить после смерти некроманта: последний приказ, Retreat, Autonomous Defense, блок приказов и возврат управления', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatar = sb.campaign.heroes[sb.campaign.avatarId];
  avatar.darkBranchMasteries.necromancy = 10;
  avatar.mana = 40;

  // Создаём 3 разных группы нежити с разными последними приказами (§107.8 #12)
  sb.activeMap.necromancyMinions.push(
    {
      minionId: 'undead_attacker',
      kind: 'skeleton',
      mode: 'Active',
      residualDrainPerSec: 2,
      manaUpkeepPerSec: 1,
      currentOrder: 'AttackTarget',
      orderTargetEntityId: 'enemy_01',
    },
    {
      minionId: 'undead_retreater',
      kind: 'ghoul',
      mode: 'Active',
      residualDrainPerSec: 3,
      manaUpkeepPerSec: 1.5,
      currentOrder: 'Retreat',
    },
    {
      minionId: 'undead_holder',
      kind: 'bone_warrior',
      mode: 'Active',
      residualDrainPerSec: 4,
      manaUpkeepPerSec: 2,
      currentOrder: 'HoldPosition',
    }
  );

  // Живой некромант может отдавать прямой приказ
  const aliveOrder = issueNecromancyMinionOrder(avatar, sb.activeMap, 'undead_attacker', 'AttackTarget', {
    targetEntityId: 'enemy_01',
  });
  assert.equal(aliveOrder.ok, true);

  // Смерть некроманта запускает остаточный резерв (§105) и переводит нежить в FollowingLastOrder (§107.1)
  const deathRes = triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_necro_death_slice9');
  assert.equal(deathRes.applied, true);
  assert.equal(sb.activeMap.necromancyAutonomy.active, true);
  assert.equal(sb.activeMap.necromancyMinions[0].aiState, 'FollowingLastOrder');

  // §107.5: Пока некромант мёртв, новые прямые приказы через него заблокированы
  const blockedOrder = issueNecromancyMinionOrder(avatar, sb.activeMap, 'undead_attacker', 'MoveTo');
  assert.equal(blockedOrder.ok, false);

  // §107.8 #1: Приказ AttackTarget продолжается, пока цель жива и нет непосредственной угрозы
  const s1 = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_attacker', {
    lastOrderStillValid: true,
    underDirectThreat: false,
    allyUnderAttackNearby: false,
  });
  assert.equal(s1.aiState, 'FollowingLastOrder');
  assert.equal(s1.pursuesFarTarget, false);

  // §107.8 #4: Retreat никогда самовольно не разворачивается на преследование, даже если рядом атакован союзник
  const sRetreat = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_retreater', {
    lastOrderStillValid: true,
    underDirectThreat: true,
    allyUnderAttackNearby: true,
  });
  assert.equal(sRetreat.aiState, 'FollowingLastOrder');
  assert.equal(sRetreat.pursuesFarTarget, false);

  // §107.8 #7: HoldPosition не уходит ради защиты удалённого союзника / дальнего преследования
  const sHold = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_holder', {
    lastOrderStillValid: true,
    underDirectThreat: false,
    allyUnderAttackNearby: true,
  });
  assert.equal(sHold.aiState, 'FollowingLastOrder');

  // §107.8 #5 & #2: При потере цели / локальной атаке на союзника -> DefendingAlly, затем ReturningToOrderArea
  const sAlly = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_attacker', {
    lastOrderStillValid: true,
    underDirectThreat: false,
    allyUnderAttackNearby: true,
    threatRequiresFarChase: false,
  });
  assert.equal(sAlly.aiState, 'DefendingAlly');

  const sReturn = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_attacker', {
    lastOrderStillValid: true,
    underDirectThreat: false,
    allyUnderAttackNearby: false,
    outsideOrderAreaAfterDefense: true,
  });
  assert.equal(sReturn.aiState, 'ReturningToOrderArea');

  // §107.8 #2: Назначенная цель уничтожена -> приказ сбрасывается в HoldPosition без дальнего преследования
  const sTargetLost = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_attacker', {
    lastOrderStillValid: false,
    underDirectThreat: false,
    allyUnderAttackNearby: false,
  });
  assert.equal(sTargetLost.pursuesFarTarget, false);
  assert.equal(sb.activeMap.necromancyMinions[0].currentOrder, 'HoldPosition');

  // §107.8 #9–10: Возрождение героя до исчерпания пула возвращает прямое управление игрока
  advanceAvatarRespawnTimer(sb.campaign, sb.activeMap, 120);
  const sRespawned = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_attacker', {
    lastOrderStillValid: true,
    underDirectThreat: false,
    allyUnderAttackNearby: true,
  });
  assert.equal(sRespawned.playerDirectControlActive, true);
  assert.equal(sRespawned.aiState, 'FollowingLastOrder');

  // §107.8 #8: Повторная смерть и полное исчерпание остаточного пула -> Inactive
  triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_necro_death_slice9_2');
  tickNecromancyMinions(avatar, sb.activeMap, 100);
  const sDepleted = evaluateAutonomousUndeadBehavior(avatar, sb.activeMap, 'undead_attacker', {
    lastOrderStillValid: true,
    underDirectThreat: true,
    allyUnderAttackNearby: false,
  });
  assert.equal(sDepleted.aiState, 'Inactive');

  // §105.8 #11: Переход на следующую карту НЕ переносит остаточный резерв
  advanceAvatarRespawnTimer(sb.campaign, sb.activeMap, 120);
  const portalRes = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    sb.activeMap,
    'sector_b',
    'evt_portal_slice9_necro'
  );
  assert.equal(portalRes.ok, true);
  assert.equal(portalRes.nextMap!.necromancyAutonomy.active, false);
  assert.equal(portalRes.nextMap!.necromancyAutonomy.remainingPool, 0);
});

test('T-V14-41: v14.2 §339.2–339.5 & §352.4 — Каноническая ресурсная матрица 6 рас, Iron для Эльфов/Троллей и SlaveWorker Тёмных эльфов', () => {
  const matrixCheck = validateSixRaceResourceMatrix();
  assert.equal(matrixCheck.ok, true, matrixCheck.errorsRu.join('; '));

  // Elves & Trolls: Iron используется, но без стандартной эффективной собственной Iron Mine (§339.2, §352.4)
  for (const race of ['elves', 'trolls'] as const) {
    const cap = getRaceResourceCapability(race, 'iron');
    assert.equal(cap.used, true);
    assert.equal(cap.hasEfficientOwnExtraction, false);
    const costCheck = validateSettlementResourceCostForRace(race, { wood: 10, iron: 5 });
    assert.equal(costCheck.ok, true);
    assert.ok(costCheck.warningsRu.length >= 1);
  }

  // Orcs используют Lenya, а не Aria (§352.4)
  assert.equal(validateSettlementResourceCostForRace('orcs', { lenya: 10 }).ok, true);
  assert.equal(validateSettlementResourceCostForRace('orcs', { aria: 10 }).ok, false);

  // Dark Elves используют Aria + Moonsilver, а не Lenya, и работают через SlaveWorker (§339.4–339.5, §352.4)
  assert.equal(validateSettlementResourceCostForRace('dark_elves', { aria: 10, moonsilver: 5 }).ok, true);
  assert.equal(validateSettlementResourceCostForRace('dark_elves', { lenya: 10 }).ok, false);
  assert.equal(PLAYABLE_RACES.dark_elves.defaultWorkerRole, 'SlaveWorker');
});

test('T-V14-42: v14.2 §352.2–352.6 — Валидатор числового аудита выявляет пропуски provenance и неполный CONFLICT', () => {
  const validEntries: NumericalAuditEntry[] = [
    {
      entityId: 'unit_test_01',
      field: 'hp',
      value: 120,
      unit: 'hp',
      sourceGame: 'ASHEN CROWN',
      edition: 'v14.2',
      patch: 'slice9',
      campaignScope: 'all_maps',
      sourceRef: 'v14.2 §352',
      confidence: 'CONFLICT',
      checkedAt: '2026-11-25',
      notes: 'Расхождение базовой редакции и Platinum.',
      conflictAlternative: {
        value: 140,
        sourceRef: 'Platinum Edition Manual',
        context: 'SotP campaign',
      },
    },
  ];
  assert.equal(validateNumericalAuditEntries(validEntries).ok, true);

  // Сломанная запись: CONFLICT без conflictAlternative + пустая единица измерения + пустое значение при DESIGN_TARGET
  const invalidEntries: NumericalAuditEntry[] = [
    {
      entityId: 'unit_broken_01',
      field: 'armor',
      value: null,
      unit: '',
      sourceGame: 'ASHEN CROWN',
      edition: 'v14.2',
      patch: 'slice9',
      campaignScope: 'all_maps',
      sourceRef: '',
      confidence: 'CONFLICT',
      checkedAt: 'bad-date',
      notes: '',
    },
  ];
  const badCheck = validateNumericalAuditEntries(invalidEntries);
  assert.equal(badCheck.ok, false);
  assert.ok(badCheck.errorsRu.length >= 4);
});

test('T-V14-43: v14.2 §353.3 & §353.5 — Валидатор контентных каталогов ловит нелегальную стоимость расы и честно фиксирует статус PARTIAL', () => {
  // 1. Аудит прототипа обязан вернуть валидный честный статус PARTIAL (запрещено объявлять завершённым по §353.5)
  const report = runPrototypeCatalogAndAuditReport();
  assert.equal(report.overallCatalogStatus, 'PARTIAL');
  assert.equal(report.raceMatrixErrorsRu.length, 0);
  assert.equal(report.numericalErrorsRu.length, 0);
  assert.equal(report.catalogErrorsRu.length, 0);
  assert.ok(report.openGapsRu.length >= 4);

  // 2. Невалидная запись каталога: юнит Орков со стоимостью в Aria + пустой stat без записи в unknownFields
  const invalidRecord: ContentCatalogEntityRecord = {
    contentId: 'bad_orc_unit',
    displayName: 'Некорректный юнит орков',
    localizedNames: { ru: 'Некорректный юнит орков' },
    entityType: 'unit',
    raceOrFactionId: 'orcs',
    sourceGame: 'ASHEN CROWN',
    edition: 'v14.2',
    patch: 'slice9',
    campaignScope: 'vertical_slice',
    sourceStatus: 'DESIGN_TARGET',
    sourceRefs: ['v14.2 §325'],
    gameplayRole: 'caster',
    requirements: [],
    cost: { aria: 25 }, // Ошибка §352.4: Орки не используют Aria!
    stats: { hp: { value: null, unit: 'hp' } }, // Ошибка §352.6: пусто без unknownFields!
    abilities: [],
    productionLinks: [],
    variants: [],
    availabilityConditions: [],
    confidence: 'DESIGN_TARGET',
    unknownFields: [],
    conflicts: [],
    designStatus: 'PARTIAL',
    acceptanceTests: [],
  };

  const check = validateContentCatalogRecords([invalidRecord]);
  assert.equal(check.ok, false);
  assert.ok(check.errorsRu.some((e) => e.includes('aria')));
  assert.ok(check.errorsRu.some((e) => e.includes('unknownFields')));
});
