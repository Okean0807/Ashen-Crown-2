import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceHeroActiveCast,
  applyCombatInterruptToHeroCast,
  beginHeroCast,
  computeBoneWarriorBonesCost,
  createBoneWarriorFromBones,
  interactWithCorpseSpirit,
  lootBonesFromCorpse,
  reraiseCorpseForNecromancy,
} from '../src/core/combatAndMagic';
import { SAVE_FORMAT_VERSION } from '../src/core/config';
import {
  computeSnapshotChecksum,
  transcribeSpellScrollToGrimoire,
  validateAndLoadSnapshot,
} from '../src/core/inventoryAndSave';
import {
  allocateMagicSchoolPoint,
  learnOrUpgradeSpell,
} from '../src/core/progression';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';
import {
  canCreateSaveInContext,
  createEmptySaveRepository,
  loadLatestValidAutoSave,
  pushAutoSaveToRing,
  saveToManualSlot,
} from '../src/core/saveManager';
import {
  createSquadInstance,
  executeNpcCasterAutoTurn,
} from '../src/core/squadsAndEffects';
import type { CorpseEntity } from '../src/core/types';

test('T-V14-17: v14.2 §§2.1.4, 2.1.6–2.1.8 — базовые заклинания без порога школы, зависимости и прогресс только своей школы', () => {
  const sb = createInitialVerticalSliceSandbox();
  const hero = sb.campaign.heroes[sb.campaign.avatarId];
  hero.unspent.magicPoints = 6;

  // Переносим формулу frost_nova со свитка в Гримуар -> пока KnownUnavailable (требует elemental >= 2)
  assert.equal(transcribeSpellScrollToGrimoire(sb.campaign, hero.heroId, 'inst_scroll_frost_01').ok, true);
  assert.equal(hero.spells.spell_elem_frost_nova.acquisitionState, 'KnownUnavailable');

  // На старте elemental mastery = 0; fire_bolt уже Learned, spark — ReadyToLearn
  assert.equal(hero.schoolMasteries.elemental, 0);
  assert.equal(hero.spells.spell_elem_spark.acquisitionState, 'ReadyToLearn');
  // Можно изучить несколько базовых заклинаний при уровне школы 0 без искусственного лимита (§2.1.7–2.1.8)
  const learnSpark = learnOrUpgradeSpell(sb.campaign, hero.heroId, 'spell_elem_spark');
  assert.equal(learnSpark.ok, true);
  assert.equal(hero.spells.spell_elem_spark.acquisitionState, 'Learned');

  // Зависимый узел frost_nova требует schoolMastery >= 2 и fire_bolt (§2.1.4)
  const blockedFrost = learnOrUpgradeSpell(sb.campaign, hero.heroId, 'spell_elem_frost_nova');
  assert.equal(blockedFrost.ok, false);

  // Изучение и апгрейд заклинания Элементальной магии (шаг 0.5 * 2 = 1.0) даёт +1 уровень только elemental (§2.1.6)
  // и НЕ повышает другие школы (§2.1.3)
  const lifeBefore = hero.schoolMasteries.life;
  const darkBefore = hero.schoolMasteries.dark;
  const upgradeSpark = learnOrUpgradeSpell(sb.campaign, hero.heroId, 'spell_elem_spark');
  assert.equal(upgradeSpark.ok, true);
  assert.equal(upgradeSpark.schoolLevelGained, true);
  assert.equal(hero.schoolMasteries.elemental, 1);
  assert.equal(hero.schoolMasteries.life, lifeBefore);
  assert.equal(hero.schoolMasteries.dark, darkBefore);

  // После +1 очка в Элементальную магию достигнут порог 2 и зависимая формула frost_nova становится ReadyToLearn
  const addElem = allocateMagicSchoolPoint(sb.campaign, hero.heroId, 'elemental');
  assert.equal(addElem.ok, true);
  assert.equal(hero.schoolMasteries.elemental, 2);
  assert.equal(hero.spells.spell_elem_frost_nova.acquisitionState, 'ReadyToLearn');
});

test('T-V14-18: v14.2 §§40.3–40.4 — активный каст, устойчивость к слабому урону и прерывание без возврата маны', () => {
  const sb = createInitialVerticalSliceSandbox();
  const hero = sb.campaign.heroes[sb.campaign.avatarId];
  const manaStart = hero.mana;

  const castStart = beginHeroCast(sb.campaign, hero.heroId, 'spell_elem_fire_bolt', 'enemy_01');
  assert.equal(castStart.ok, true);
  assert.ok(hero.activeCast);
  const spent = castStart.cast!.manaAlreadySpent;
  assert.equal(hero.mana, manaStart - spent);

  // Слабый удар <= CastStabilityThreshold (18) НЕ прерывает каст
  const weakHit = applyCombatInterruptToHeroCast(hero, 15);
  assert.equal(weakHit.interrupted, false);
  assert.ok(hero.activeCast);

  // Сильный удар > CastStabilityThreshold (18) прерывает каст, мана НЕ возвращается (§40.4)
  const strongHit = applyCombatInterruptToHeroCast(hero, 24);
  assert.equal(strongHit.interrupted, true);
  assert.equal(strongHit.manaRefunded, 0);
  assert.equal(hero.activeCast, null);
  assert.equal(hero.mana, manaStart - spent);

  // Новый каст без сильного прерывания успешно завершается по времени
  const cast2 = beginHeroCast(sb.campaign, hero.heroId, 'spell_elem_fire_bolt', 'enemy_01');
  assert.equal(cast2.ok, true);
  const done = advanceHeroActiveCast(hero, 5);
  assert.equal(done.completed, true);
  assert.equal(done.spellId, 'spell_elem_fire_bolt');
  assert.equal(hero.activeCast, null);
});

test('T-V14-19: v14.2 §3.1 (APPROVED) — кости с трупов, удешевление Костяного воина от мастерства, запрет decayed трупа и запрет подчинения духов', () => {
  const sb = createInitialVerticalSliceSandbox();
  const hero = sb.campaign.heroes[sb.campaign.avatarId];
  hero.bonesCount = 0;

  const freshCorpse: CorpseEntity = {
    corpseId: 'c_fresh',
    nameRu: 'Свежие останки',
    state: 'fresh',
    bonesRemaining: 5,
    bonesLooted: false,
    hasSpirit: true,
    spiritHintRu: 'Ключ от сектора у патруля на севере.',
  };

  // Сбор костей с трупа однократен
  const lootRes = lootBonesFromCorpse(hero, freshCorpse, true);
  assert.equal(lootRes.ok, true);
  assert.equal(lootRes.bonesGained, 5);
  assert.equal(hero.bonesCount, 5);
  assert.equal(lootBonesFromCorpse(hero, freshCorpse, true).ok, false);

  // Сильному магу требуется меньше костей (§3.1)
  const noviceCost = computeBoneWarriorBonesCost(hero);
  hero.darkBranchMasteries.necromancy = 6;
  const masterCost = computeBoneWarriorBonesCost(hero);
  assert.ok(masterCost < noviceCost);

  // Создание Костяного воина из добытых костей
  const created = createBoneWarriorFromBones(sb.campaign, sb.activeMap, hero.heroId);
  assert.equal(created.ok, true);
  assert.equal(created.bonesSpent, masterCost);
  assert.equal(hero.bonesCount, 5 - masterCost);

  // Истлевшее тело ('decayed') нельзя воскресить (§3.1 APPROVED)
  const decayedCorpse: CorpseEntity = {
    corpseId: 'c_decayed',
    nameRu: 'Истлевшие останки',
    state: 'decayed',
    bonesRemaining: 0,
    bonesLooted: true,
    hasSpirit: false,
  };
  const raiseDecayed = reraiseCorpseForNecromancy(hero, sb.activeMap, decayedCorpse);
  assert.equal(raiseDecayed.ok, false);

  // Духа умершего можно опросить в диалоге, но НЕЛЬЗЯ подчинить (§3.1 APPROVED)
  const spiritDialogue = interactWithCorpseSpirit(freshCorpse, 'dialogue');
  assert.equal(spiritDialogue.ok, true);
  assert.ok(spiritDialogue.hintRu?.includes('севере'));

  const spiritSubjugate = interactWithCorpseSpirit(freshCorpse, 'subjugate');
  assert.equal(spiritSubjugate.ok, false);
});

test('T-V14-20: v14.2 §6 & §337.3 — магия NPC и фракций подчиняется единому белому списку, резерву маны, allegiance и Retreat', () => {
  const playerSquad = createSquadInstance({
    squadId: 'sq_p',
    nameRu: 'Игрок',
    squadDefId: 'def_p',
    creatureDefId: 'unit_proto_infantry',
    count: 1,
    factionId: 'proto_player',
    allegiance: 'Player',
    deploymentState: 'FieldArmy',
    forceSource: 'base_production',
    portableAcrossPortals: true,
  });
  const neutralSquad = createSquadInstance({
    squadId: 'sq_n',
    nameRu: 'Нейтральный наблюдатель',
    squadDefId: 'def_n',
    creatureDefId: 'unit_proto_neutral_demon',
    count: 1,
    factionId: 'proto_independent',
    allegiance: 'Neutral',
    deploymentState: 'FieldArmy',
    forceSource: 'reinforcement',
    portableAcrossPortals: false,
  });
  const enemyCasterSquad = createSquadInstance({
    squadId: 'sq_e',
    nameRu: 'Маг налётчиков',
    squadDefId: 'def_e',
    creatureDefId: 'unit_proto_raider',
    count: 1,
    factionId: 'proto_raiders',
    allegiance: 'Hostile',
    deploymentState: 'FieldArmy',
    forceSource: 'patrol',
    portableAcrossPortals: false,
  });

  const npcCaster = {
    casterId: 'npc_mage_01',
    squadId: 'sq_e',
    factionId: 'proto_raiders',
    allegiance: 'Hostile' as const,
    mana: 100,
    maxMana: 100,
    // Первое заклинание запрещено белым списком (frost_nova), второе разрешено (fire_bolt)
    knownSpellIds: ['spell_elem_frost_nova', 'spell_elem_fire_bolt'],
    schoolMasteries: { elemental: 10 },
  };

  // При Retreat атакующая магия NPC подавлена (§337.2)
  enemyCasterSquad.command.playerOrder = 'Retreat';
  const retreatTurn = executeNpcCasterAutoTurn({
    caster: npcCaster,
    casterSquad: enemyCasterSquad,
    allSquads: [playerSquad, neutralSquad, enemyCasterSquad],
  });
  assert.equal(retreatTurn.castExecuted, false);

  // В обычном бою NPC выбирает только fire_bolt (пропускает запрещённую frost_nova) и бьёт Player, игнорируя Neutral
  enemyCasterSquad.command.playerOrder = 'AttackMove';
  const neutralHpBefore = neutralSquad.units[0].hp;
  const playerHpBefore = playerSquad.units[0].hp;
  const combatTurn = executeNpcCasterAutoTurn({
    caster: npcCaster,
    casterSquad: enemyCasterSquad,
    allSquads: [playerSquad, neutralSquad, enemyCasterSquad],
  });
  assert.equal(combatTurn.castExecuted, true);
  assert.equal(combatTurn.chosenSpellId, 'spell_elem_fire_bolt');
  assert.equal(combatTurn.targetSquadId, 'sq_p');
  assert.ok(playerSquad.units[0].hp < playerHpBefore);
  assert.equal(neutralSquad.units[0].hp, neutralHpBefore);
});

test('T-V14-21: v14.2 §§341.6–341.8 — последовательная миграция v1->v2 с сохранением доп. полей, блок в бою, изоляция Manual/AutoSave и fallback', () => {
  const sb = createInitialVerticalSliceSandbox();

  // 1. Формируем валидный снимок v1 с неизвестным полем modCustomTag
  const v1Payload = {
    saveFormatVersion: 1,
    gameBuildVersion: '0.1.0-legacy',
    contentSchemaVersion: 'v14.2-core-01',
    saveId: 'legacy_v1_save',
    createdAtIso: '2026-11-24T00:00:00.000Z',
    lastCommittedEventId: null,
    campaign: {
      ...sb.campaign,
      archivedMapsByDefinitionId: undefined,
      checkpoints: undefined,
    },
    mission: sb.mission,
    activeMap: {
      ...sb.activeMap,
      worldObjects: undefined,
    },
    eventJournal: sb.eventJournal,
    modCustomTag: 'keep-me-across-migration',
  };
  const v1WithChecksum = {
    ...v1Payload,
    checksum: computeSnapshotChecksum(v1Payload as unknown as Parameters<typeof computeSnapshotChecksum>[0]),
  };

  const migrated = validateAndLoadSnapshot(JSON.stringify(v1WithChecksum));
  assert.equal(migrated.ok, true);
  if (migrated.ok) {
    assert.equal(migrated.migratedFromVersion, 1);
    assert.equal(migrated.snapshot.saveFormatVersion, SAVE_FORMAT_VERSION);
    assert.equal(migrated.snapshot.extraMetadata?.modCustomTag, 'keep-me-across-migration');
    assert.ok(migrated.snapshot.campaign.archivedMapsByDefinitionId);
    assert.ok(migrated.snapshot.activeMap.worldObjects);
  }

  // 2. Запрет сохранения во время боя при allowSaveDuringCombat = false (§341.6)
  sb.mission.allowSaveDuringCombat = false;
  assert.equal(canCreateSaveInContext(sb.mission, true).allowed, false);
  let repo = createEmptySaveRepository();
  const blockedManual = saveToManualSlot(
    repo,
    'slot_1',
    sb.campaign,
    sb.mission,
    sb.activeMap,
    sb.eventJournal,
    true
  );
  assert.equal(blockedManual.ok, false);

  // 3. Ручные слоты и AutoSave Ring изолированы друг от друга (§341.7)
  sb.mission.allowSaveDuringCombat = true;
  const mSave = saveToManualSlot(repo, 'slot_1', sb.campaign, sb.mission, sb.activeMap, sb.eventJournal, false);
  assert.equal(mSave.ok, true);
  repo = mSave.repo;

  // Заполняем кольцо 4 автосохранениями (ёмкость 3) — ручной слот 1 не должен перезаписаться
  for (let i = 1; i <= 4; i++) {
    sb.activeMap.simulationTimeSec = i * 10;
    const autoRes = pushAutoSaveToRing(repo, sb.campaign, sb.mission, sb.activeMap, sb.eventJournal, false);
    assert.equal(autoRes.ok, true);
    repo = autoRes.repo;
  }
  assert.equal(repo.autoSaveRing.length, 3);
  assert.ok(repo.manualSlots.slot_1);
  assert.equal(JSON.parse(repo.manualSlots.slot_1.rawJson).activeMap.simulationTimeSec, 0);

  // 4. Порча последнего автосохранения вызывает fallback на предыдущую валидную копию (§341.7–341.8)
  repo.autoSaveRing[repo.autoSaveRing.length - 1].rawJson = '{"saveFormatVersion":2,"checksum":"deadbeef","campaign":{}}';
  const fallback = loadLatestValidAutoSave(repo);
  assert.equal(fallback.ok, true);
  assert.equal(fallback.skippedCorrupted.length, 1);
  assert.equal(fallback.snapshot?.activeMap.simulationTimeSec, 30);
});
