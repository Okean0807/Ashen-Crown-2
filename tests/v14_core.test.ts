import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVED_CONSTANTS,
  DEFAULT_WORKING_ASSUMPTIONS,
  MAGIC_SCHOOL_LABELS,
  PLAYABLE_RACES,
  DARK_BRANCH_LABELS,
} from '../src/core/config';
import {
  allocateAttributePoint,
  allocateCombatMasteryPoint,
  allocateMagicSchoolPoint,
  computeDiminishedXp,
  computeManaRegen,
  computeMaxHp,
  computeMaxMana,
  computeSpecialization,
  grantHeroExperience,
  learnOrUpgradeSpell,
  respecHeroBeforeMapTransition,
} from '../src/core/progression';
import {
  advanceAvatarRespawnTimer,
  clampResistance,
  completeSquadLocalReaction,
  computeDamageAfterArmor,
  computeHitChancePct,
  computeRawPhysicalDamage,
  computeSpellEffectPower,
  computeSpellManaCost,
  grantBoneWarriorXpAndDestroy,
  issueSquadPlayerOrder,
  reraiseDormantMinions,
  resolveCombatPackets,
  startSpellCast,
  tickNecromancyMinions,
  triggerAvatarDeath,
  triggerSquadLocalReaction,
} from '../src/core/combatAndMagic';
import {
  canHeroEquipItem,
  computeBuyAndSellPricesCopper,
  copperToDenominations,
  createSaveSnapshot,
  denominationsToCopper,
  equipItemFromPartyInventory,
  executeMerchantBuy,
  executeMerchantSell,
  executePortalMapTransition,
  moveItemBetweenInventoryAndStorage,
  transcribeSpellScrollToGrimoire,
  validateAndLoadSnapshot,
  verifyItemLocationInvariants,
  completeQuestStageAndMaybeReward,
} from '../src/core/inventoryAndSave';
import { createInitialVerticalSliceSandbox } from '../src/core/sandboxFactory';

test('v14.2 §§321, 352.4 & AC-OWNER-007: ровно 6 рас и строгая терминология школ/ветвей', () => {
  assert.equal(Object.keys(PLAYABLE_RACES).length, 6);
  assert.equal(MAGIC_SCHOOL_LABELS.elemental, 'Элементальная магия');
  assert.equal(Object.keys(MAGIC_SCHOOL_LABELS).length, 6);
  assert.equal(Object.keys(DARK_BRANCH_LABELS).length, 6);
  assert.ok(!PLAYABLE_RACES.humans.resourcesUsed.includes('lenya'));
  assert.ok(PLAYABLE_RACES.orcs.resourcesUsed.includes('lenya'));
  assert.ok(PLAYABLE_RACES.elves.resourcesUsed.includes('iron'));
  assert.ok(PLAYABLE_RACES.trolls.resourcesUsed.includes('iron'));
});

test('v14.2 §35 & §45: контрольные числовые примеры HP, Mana, Damage, HitChance, Armor и Magic', () => {
  assert.equal(computeMaxHp(10, 1), 100);
  assert.equal(computeMaxHp(20, 1), 220);
  assert.equal(computeMaxMana(10, 1), 50);
  assert.equal(computeManaRegen(10), 0.5);

  // §35.3: W=30, STR=20, M=40 -> (30 + 12) * 1.6 = 67.2
  assert.equal(computeRawPhysicalDamage(30, 20, 40), 67.2);
  // §35.4: DEX=20, AGI=10 -> 78.5%
  assert.equal(computeHitChancePct(20, 10), 78.5);
  // §35.5: Armor 0 -> 100, 50 -> 66.67, 100 -> 50, 200 -> 33.33
  assert.equal(Number(computeDamageAfterArmor(100, 0).toFixed(2)), 100);
  assert.equal(Number(computeDamageAfterArmor(100, 50).toFixed(2)), 66.67);
  assert.equal(Number(computeDamageAfterArmor(100, 100).toFixed(2)), 50);
  assert.equal(Number(computeDamageAfterArmor(100, 200).toFixed(2)), 33.33);

  // §45.1: SchoolMastery 0/50/100 -> ManaCost 40/35/30 при base 40
  const sb = createInitialVerticalSliceSandbox();
  const hero = sb.campaign.heroes[sb.campaign.avatarId];
  hero.schoolMasteries.elemental = 0;
  hero.spells.spell_elem_fire_bolt.rank = 1;
  assert.equal(computeSpellManaCost(hero, 'spell_elem_fire_bolt'), 14);
  hero.schoolMasteries.elemental = 100;
  assert.equal(computeSpellManaCost(hero, 'spell_elem_fire_bolt'), 11); // ceil(14 * 0.75)
  // EffectPower при basePower=28, SchoolMastery=100 (1.6x), Rank 5 (1.4x), INT=10 (1.0x)
  hero.spells.spell_elem_fire_bolt.rank = 5;
  assert.equal(computeSpellEffectPower(hero, 'spell_elem_fire_bolt', sb.campaign.itemsByInstanceId), 62.72);
});

test('v14.2 §1.2 & §237: запрет абсолютного иммунитета к магии и отсутствие двойного снижения через Armor', () => {
  assert.equal(APPROVED_CONSTANTS.FORBID_ABSOLUTE_MAGIC_IMMUNITY, true);
  assert.equal(clampResistance(1.0), 0.75);
  assert.equal(clampResistance(5.0), 0.75);
  assert.equal(clampResistance(-1.5), -1.0);

  const log = resolveCombatPackets({
    attackerDex: 20,
    target: {
      id: 'boss_test',
      nameRu: 'Босс',
      hp: 500,
      maxHp: 500,
      agi: 10,
      armor: 100, // снижает только physical в 2 раза
      hasShield: false,
      shieldMastery: 0,
      resistances: { fire: 1.0 }, // должен зажаться до 0.75
      isBossOrElite: true,
    },
    packets: [
      { type: 'physical', rawAmount: 100, canHitCheck: true, canBeBlockedByShield: true, fromFrontArc: true },
      { type: 'fire', rawAmount: 100, canHitCheck: false, canBeBlockedByShield: false, fromFrontArc: false },
    ],
    hitRollPct: 5,
    blockRollPct: 99,
  });

  assert.equal(log.hitSucceeded, true);
  assert.equal(log.packetBreakdown[0].afterResistance, 50); // Physical -> Armor 100 => 50
  assert.equal(log.packetBreakdown[1].afterArmor, 100); // Magic не проходит через Armor (§237.4)
  assert.equal(log.packetBreakdown[1].afterResistance, 25); // 100 * (1 - 0.75) => 25, не 0!
  assert.equal(log.totalFinalDamage, 75);
});

test('v14.2 §§1.7, 26.2, 27.5 & 1.12: XP, специализация до начисления магии, 3 пула и Respec до портала', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatarId = sb.campaign.avatarId;
  const hero = sb.campaign.heroes[avatarId];

  // Проверяем, что экипировка (+15 CHA) и нераспределённые очки НЕ ломают специализацию (§27.5)
  equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_amulet_cha_01', 'amulet');
  const specBefore = computeSpecialization(hero).profile;
  hero.unspent.attributePoints += 50;
  assert.equal(computeSpecialization(hero).profile, specBefore);
  hero.unspent.attributePoints -= 50;

  // Вкладываем в боевые мастерства, чтобы герой зафиксировался как warrior перед level up
  allocateCombatMasteryPoint(sb.campaign, avatarId, 'one_handed');
  allocateCombatMasteryPoint(sb.campaign, avatarId, 'one_handed');
  allocateAttributePoint(sb.campaign, avatarId, 'STR');
  allocateAttributePoint(sb.campaign, avatarId, 'STR');
  allocateAttributePoint(sb.campaign, avatarId, 'STR');
  hero.hp = 10;
  hero.mana = 5;

  const grantRes = grantHeroExperience(sb.campaign, avatarId, 500, 'variant_test_orc');
  assert.equal(grantRes.grantedXp, 500);
  assert.ok(grantRes.levelUps.length >= 2);
  assert.equal(grantRes.levelUps[0].profileUsedBeforeGrant, 'warrior');
  assert.equal(
    grantRes.levelUps[0].grantedMagicPoints,
    DEFAULT_WORKING_ASSUMPTIONS.pointsPerLevel.magicByProfile.warrior
  );
  // Полное восстановление HP и маны при повышении уровня (§26.2)
  assert.equal(hero.hp, hero.maxHp);
  assert.equal(hero.mana, hero.maxMana);
  assert.equal(hero.hasUnspentLevelNotification, true);

  // Повторное убийство того же варианта даёт меньше XP (§1.7)
  const repeatKill = grantHeroExperience(sb.campaign, avatarId, 500, 'variant_test_orc');
  assert.ok(repeatKill.grantedXp < 500);
  assert.equal(computeDiminishedXp(100, 100), 25); // floor 0.25

  // Respec до портала возвращает ровно вложенные очки и снимает невалидную экипировку
  const attrBeforeRespec = hero.unspent.attributePoints + hero.investedHistory.attributePointsSpent;
  const respecOk = respecHeroBeforeMapTransition(sb.campaign, avatarId);
  assert.equal(respecOk.ok, true);
  assert.equal(hero.unspent.attributePoints, attrBeforeRespec);
  assert.equal(hero.investedHistory.attributePointsSpent, 0);

  // После перехода через портал окно respec закрывается (§1.12)
  const portalRes = executePortalMapTransition(
    sb.campaign,
    sb.mission,
    sb.activeMap,
    'sector_b',
    'trans_respec_lock'
  );
  assert.equal(portalRes.ok, true);
  assert.equal(hero.respecWindowOpen, false);
  const respecAfter = respecHeroBeforeMapTransition(sb.campaign, avatarId);
  assert.equal(respecAfter.ok, false);
});

test('v14.2 §§1.5, 132.3, 140.4, 331 & 347: запрет self-bonus экипировки, NaturalCharisma торговля, 100:1:1 и квестовая защита', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatarId = sb.campaign.avatarId;
  const hero = sb.campaign.heroes[avatarId];

  // Проверка Copper/Silver/Gold 100:1:1 (§331.3)
  assert.deepEqual(copperToDenominations(15450), { gold: 1, silver: 54, copper: 50 });
  assert.equal(denominationsToCopper(1, 54, 50), 15450);

  // Повышаем STR до 12 (2H меч требует STR 16 и даёт +4 STR сам по себе: 12+4=16 НЕ должно пройти!)
  hero.baseAttributes.STR = 12;
  hero.combatMasteries.two_handed = 2;
  const equipFail = canHeroEquipItem(sb.campaign, avatarId, 'inst_sword_2h_01', 'main_hand');
  assert.equal(equipFail.ok, false);

  // Повышаем собственную STR до 16 -> теперь можно надеть, и off_hand если был занят — освобождается
  hero.baseAttributes.STR = 16;
  hero.baseAttributes.STA = 11;
  hero.combatMasteries.shields = 1;
  assert.equal(equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_shield_01', 'off_hand').ok, true);
  assert.equal(equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_sword_2h_01', 'main_hand').ok, true);
  assert.equal(hero.equipment.off_hand, null);
  assert.equal(sb.campaign.itemsByInstanceId.inst_shield_01.location.kind, 'party_inventory');

  // §132.3: Амулет +15 CHA НЕ должен давать торговую скидку (база CHA=20 -> 0%, база CHA=40 -> 2%)
  hero.baseAttributes.CHA = 20;
  assert.equal(equipItemFromPartyInventory(sb.campaign, avatarId, 'inst_amulet_cha_01', 'amulet').ok, true);
  const priceWithAmulet = computeBuyAndSellPricesCopper('item_armor_brigandine', hero.baseAttributes.CHA);
  assert.equal(priceWithAmulet.tradeAdjPct, 0);
  assert.equal(priceWithAmulet.buyPriceCopper, 600);

  // §140.4: Свиток переносит формулу в Гримуар
  assert.equal(hero.spells.spell_elem_frost_nova, undefined);
  const scrollRes = transcribeSpellScrollToGrimoire(sb.campaign, avatarId, 'inst_scroll_frost_01');
  assert.equal(scrollRes.ok, true);
  assert.ok(hero.spells.spell_elem_frost_nova);
  assert.equal(sb.campaign.itemsByInstanceId.inst_scroll_frost_01, undefined);

  // §347.7: Защищённый квестовый предмет нельзя продать
  const sellQuestFail = executeMerchantSell(
    sb.campaign,
    'merchant_neutral_01',
    'inst_quest_seal_01',
    'tx_sell_quest'
  );
  assert.equal(sellQuestFail.ok, false);

  // Идемпотентная покупка
  const buy1 = executeMerchantBuy(
    sb.campaign,
    'merchant_neutral_01',
    'item_armor_brigandine',
    'tx_buy_01',
    'inst_armor_bought_01'
  );
  const buyDup = executeMerchantBuy(
    sb.campaign,
    'merchant_neutral_01',
    'item_armor_brigandine',
    'tx_buy_01',
    'inst_armor_bought_02'
  );
  assert.equal(buy1.ok, true);
  assert.equal(buyDup.ok, false);

  // §331.2: Склад доступен только у точки склада
  sb.activeMap.atAuthorizedStoragePoint = false;
  assert.equal(
    moveItemBetweenInventoryAndStorage(sb.campaign, sb.activeMap, 'inst_armor_bought_01', 'to_storage').ok,
    false
  );
  sb.activeMap.atAuthorizedStoragePoint = true;
  assert.equal(
    moveItemBetweenInventoryAndStorage(sb.campaign, sb.activeMap, 'inst_armor_bought_01', 'to_storage').ok,
    true
  );

  assert.equal(verifyItemLocationInvariants(sb.campaign).valid, true);
});

test('v14.2 §§3.1, 105 & 288: Некромантия (Dormant_NoMana + Residual_Autonomy без refresh) и 120с Stone of Souls', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatar = sb.campaign.heroes[sb.campaign.avatarId];
  avatar.darkBranchMasteries.necromancy = 3;
  avatar.mana = 12;

  sb.activeMap.necromancyMinions.push(
    {
      minionId: 'sk_1',
      kind: 'skeleton',
      mode: 'Active',
      residualDrainPerSec: 5,
      manaUpkeepPerSec: 10,
      currentOrder: 'Follow',
    },
    {
      minionId: 'bw_1',
      kind: 'bone_warrior',
      mode: 'Active',
      residualDrainPerSec: 5,
      manaUpkeepPerSec: 10,
      boneWarriorStats: {
        accumulatedXp: 0,
        hpBonus: 0,
        physicalDamageBonus: 0,
        defenseBonus: 0,
        moveSpeedBonus: 0,
        attackSpeedBonus: 0,
      },
      currentOrder: 'AttackMove',
    }
  );

  // Костяной воин получает XP -> растут 5 характеристик, при гибели XP передаётся некроманту (§3.1)
  grantBoneWarriorXpAndDestroy(sb.activeMap, 'bw_1', 50, false);
  const bw = sb.activeMap.necromancyMinions.find((m) => m.minionId === 'bw_1')!;
  assert.equal(bw.boneWarriorStats?.hpBonus, 20);
  assert.equal(bw.boneWarriorStats?.attackSpeedBonus, 0.08);
  const returned = grantBoneWarriorXpAndDestroy(sb.activeMap, 'bw_1', 25, true);
  assert.equal(returned.returnedXpToNecromancer, 75);

  // Режим I: 0 маны -> переход в Dormant_NoMana, затем явное поднятие (§105.2)
  const tickNoMana = tickNecromancyMinions(avatar, sb.activeMap, 2);
  assert.deepEqual(tickNoMana.transitionedToDormant, ['sk_1']);
  assert.equal(sb.activeMap.necromancyMinions[0].mode, 'Dormant_NoMana');
  avatar.mana = 30;
  assert.equal(reraiseDormantMinions(avatar, sb.activeMap).raisedCount, 1);
  assert.equal(sb.activeMap.necromancyMinions[0].mode, 'Active');

  // Режим II: смерть некроманта -> Residual_Autonomy (120с respawn, идемпотентность, пул не обновляется при повторе)
  const death1 = triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_death_1');
  assert.equal(death1.applied, true);
  assert.equal(avatar.deathState.respawnRemainingSec, 120);
  assert.equal(sb.activeMap.necromancyMinions[0].mode, 'Residual_Autonomy');
  const poolStart = sb.activeMap.necromancyAutonomy.remainingPool;

  // Дренаж пула на 2 секунды
  tickNecromancyMinions(avatar, sb.activeMap, 2);
  const poolAfterDrain = sb.activeMap.necromancyAutonomy.remainingPool;
  assert.ok(poolAfterDrain < poolStart);

  // Повторное событие с новым ID пока уже мёртв НЕ обновляет R_0 (§105), а то же событие идемпотентно
  assert.equal(triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_death_1').applied, false);
  triggerAvatarDeath(sb.campaign, sb.activeMap, 'evt_death_repeat_cycle');
  assert.equal(sb.activeMap.necromancyAutonomy.remainingPool, poolAfterDrain);

  // Через 120 секунд Аватар возрождается у Stone of Souls
  assert.equal(advanceAvatarRespawnTimer(sb.campaign, sb.activeMap, 60).respawned, false);
  assert.equal(advanceAvatarRespawnTimer(sb.campaign, sb.activeMap, 60).respawned, true);
  assert.equal(avatar.deathState.lifecycle, 'Alive');
});

test('v14.2 §§43.4, 290, 303, 337.2, 341.8: MagicStrain сброс порталом, Squad Order/Reaction, квесты и checksum Save', () => {
  const sb = createInitialVerticalSliceSandbox();
  const avatar = sb.campaign.heroes[sb.campaign.avatarId];

  // Критический MagicStrain + неполные этапы квеста
  avatar.magicStrain = { index: 92, status: 'critical' };
  const s1 = startSpellCast(sb.campaign, avatar.heroId, 'spell_life_mend'); // не learned ещё
  assert.equal(s1.ok, false);
  learnOrUpgradeSpell(sb.campaign, avatar.heroId, 'spell_life_mend');
  const castHeal = startSpellCast(sb.campaign, avatar.heroId, 'spell_life_mend');
  assert.equal(castHeal.ok, true);
  assert.equal(avatar.magicStrain.index, 92); // §43.5: contribution=0 не повышает Strain

  // §337.2: Squad PlayerOrder не перетирается локальной реакцией
  let sq = sb.activeMap.squads.squad_alpha;
  sq = issueSquadPlayerOrder(sq, 'HoldPosition');
  sq = triggerSquadLocalReaction(sq, 'enemy_far', 5.0);
  assert.equal(sq.localReaction, 'None'); // HoldPosition не гонится за далёким врагом
  sq = issueSquadPlayerOrder(sq, 'AttackMove', { x: 10, y: 10 });
  sq = triggerSquadLocalReaction(sq, 'enemy_near', 2.0);
  assert.equal(sq.localReaction, 'SelfDefense');
  assert.equal(sq.playerOrder, 'AttackMove');
  sq = completeSquadLocalReaction(sq);
  assert.equal(sq.localReaction, 'None');
  assert.equal(sq.playerOrder, 'AttackMove');

  // §303.5: Квестовая награда выдаётся ровно один раз
  completeQuestStageAndMaybeReward(sb.campaign, 'quest_side_supply_audit', 'stage_storage_check', 'q_evt_1');
  const copperAfterQuest = sb.campaign.localMapWalletCopper;
  assert.equal(sb.campaign.quests.quest_side_supply_audit.status, 'Completed');
  assert.equal(
    completeQuestStageAndMaybeReward(sb.campaign, 'quest_side_supply_audit', 'stage_storage_check', 'q_evt_1').ok,
    false
  );
  assert.equal(sb.campaign.localMapWalletCopper, copperAfterQuest);

  // §341.8: Снимок сохраняется и отклоняется при порче checksum
  const snap = createSaveSnapshot(sb.campaign, sb.mission, sb.activeMap, sb.eventJournal);
  const validJson = JSON.stringify(snap);
  const loadedOk = validateAndLoadSnapshot(validJson);
  assert.equal(loadedOk.ok, true);

  const tampered = JSON.parse(validJson);
  tampered.campaign.localMapWalletCopper = 9999999;
  const loadedBad = validateAndLoadSnapshot(JSON.stringify(tampered));
  assert.equal(loadedBad.ok, false);

  // §43.4 & §341.2: Переход через портал сбрасывает MagicStrain, обнуляет локальные поселения и идемпотентен
  const tr = executePortalMapTransition(sb.campaign, sb.mission, sb.activeMap, 'sector_b', 't_portal_01');
  assert.equal(tr.ok, true);
  assert.equal(avatar.magicStrain.index, 0);
  assert.equal(avatar.magicStrain.status, 'normal');
  assert.deepEqual(tr.nextMap?.localSettlements, {});
  assert.equal(
    executePortalMapTransition(sb.campaign, sb.mission, sb.activeMap, 'sector_b', 't_portal_01').ok,
    false
  );
});
