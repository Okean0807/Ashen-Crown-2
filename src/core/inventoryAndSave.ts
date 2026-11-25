/**
 * ASHEN CROWN — Экономика предметов, валюта Copper/Silver/Gold (§331),
 * торговля по NaturalCharisma (§132.3), квесты (§303), переходы через порталы (§290, §341.2)
 * и версионированные сохранения с контрольной суммой (§341.6–341.8).
 */

import { PROTOTYPE_ITEMS } from './catalog';
import {
  APPROVED_CONSTANTS,
  CONTENT_SCHEMA_VERSION,
  DEFAULT_WORKING_ASSUMPTIONS,
  DESIGN_TARGET_FORMULAS,
  GAME_BUILD_VERSION,
  SAVE_FORMAT_VERSION,
  type ProvisionalBalanceConfig,
} from './config';
import {
  acquireSpellFormula,
  computeDerivedHeroStats,
  grantHeroExperience,
} from './progression';
import { resetMagicStrainOnMapTransition } from './combatAndMagic';
import { ensureRuneTabletSynced, previewRuneSaleOrDestructionWarning } from './runesAndPlans';
import type {
  AttributeId,
  CampaignState,
  CheckpointRecord,
  CombatMasteryId,
  EquipSlotId,
  EquipmentPreviewResult,
  InventoryFilterCategory,
  InventorySortMode,
  ItemInstance,
  MapInstanceState,
  MerchantTransactionPreview,
  MissionState,
  QuestRecord,
  SaveEvent,
  SaveSnapshot,
} from './types';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * §134.8, §331.3: Преобразование CopperTotal в Copper / Silver / Gold (100:1:1).
 */
export function copperToDenominations(copperTotal: number): {
  gold: number;
  silver: number;
  copper: number;
} {
  const safe = Math.max(0, Math.floor(copperTotal));
  const gold = Math.floor(safe / APPROVED_CONSTANTS.COPPER_PER_GOLD);
  const remAfterGold = safe % APPROVED_CONSTANTS.COPPER_PER_GOLD;
  const silver = Math.floor(remAfterGold / APPROVED_CONSTANTS.COPPER_PER_SILVER);
  const copper = remAfterGold % APPROVED_CONSTANTS.COPPER_PER_SILVER;
  return { gold, silver, copper };
}

export function denominationsToCopper(gold: number, silver: number, copper: number): number {
  return (
    Math.max(0, Math.floor(gold)) * APPROVED_CONSTANTS.COPPER_PER_GOLD +
    Math.max(0, Math.floor(silver)) * APPROVED_CONSTANTS.COPPER_PER_SILVER +
    Math.max(0, Math.floor(copper))
  );
}

/**
 * §132.3, §136.4: TradeAdjustment = clamp(0, (NaturalCharisma - 30) / 5, 10)%.
 * Бонусы CHA от экипировки строго игнорируются!
 */
export function computeTradeAdjustmentPct(naturalCharisma: number): number {
  const { TRADE_CHA_THRESHOLD, TRADE_CHA_DIVISOR, TRADE_CHA_MAX_PCT } = DESIGN_TARGET_FORMULAS;
  return clamp((naturalCharisma - TRADE_CHA_THRESHOLD) / TRADE_CHA_DIVISOR, 0, TRADE_CHA_MAX_PCT);
}

export function computeBuyAndSellPricesCopper(
  definitionId: string,
  naturalCharisma: number,
  buyMultiplier = 1.0,
  sellMultiplier = 0.5
): { buyPriceCopper: number; sellPriceCopper: number; tradeAdjPct: number } {
  const def = PROTOTYPE_ITEMS[definitionId];
  if (!def) return { buyPriceCopper: 0, sellPriceCopper: 0, tradeAdjPct: 0 };

  const tradeAdjPct = computeTradeAdjustmentPct(naturalCharisma);
  const adjFactor = tradeAdjPct / 100;
  const buyPriceCopper = Math.max(1, Math.round(def.basePriceCopper * buyMultiplier * (1 - adjFactor)));
  const sellPriceCopper = Math.max(0, Math.round(def.basePriceCopper * sellMultiplier * (1 + adjFactor)));
  return { buyPriceCopper, sellPriceCopper, tradeAdjPct };
}

/**
 * §1.5: Проверка требований предмета к экипировке.
 * Считает только собственные атрибуты героя и уже надетую экипировку (исключая сам проверяемый предмет!).
 */
export function canHeroEquipItem(
  campaign: CampaignState,
  heroId: string,
  instanceId: string,
  targetSlot: EquipSlotId
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!hero || !inst) return { ok: false, reason: 'Герой или предмет не найдены.' };
  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (!def) return { ok: false, reason: 'Неизвестное определение предмета.' };

  if (!def.allowedSlots.includes(targetSlot)) {
    return { ok: false, reason: `Предмет нельзя надеть в слот ${targetSlot}.` };
  }

  // Вычисляем характеристики БЕЗ самого предмета (чтобы его собственные бонусы не удовлетворяли его же требования)
  const tempItems = { ...campaign.itemsByInstanceId };
  const isAlreadyEquippedOnHero = inst.location.kind === 'equipped' && inst.location.heroId === heroId;
  const heroClone = { ...hero, equipment: { ...hero.equipment } };
  if (isAlreadyEquippedOnHero && inst.location.kind === 'equipped') {
    heroClone.equipment[inst.location.slot] = null;
  }
  const derivedWithoutSelf = computeDerivedHeroStats(heroClone, tempItems);

  if (def.requirements?.level && hero.level < def.requirements.level) {
    return { ok: false, reason: `Требуется уровень ${def.requirements.level}.` };
  }
  if (def.requirements?.attributes) {
    for (const [attr, req] of Object.entries(def.requirements.attributes) as Array<[AttributeId, number]>) {
      if (derivedWithoutSelf.effectiveAttributes[attr] < req) {
        return {
          ok: false,
          reason: `Требуется ${attr} >= ${req} (без учёта бонусов этого предмета сейчас ${derivedWithoutSelf.effectiveAttributes[attr]}).`,
        };
      }
    }
  }
  if (def.requirements?.masteries) {
    for (const [m, req] of Object.entries(def.requirements.masteries) as Array<[CombatMasteryId, number]>) {
      if (hero.combatMasteries[m] < req) {
        return {
          ok: false,
          reason: `Требуется мастерство ${m} >= ${req} (сейчас ${hero.combatMasteries[m]}).`,
        };
      }
    }
  }

  // Если надевается off_hand при занятой двуручной пушке в main_hand
  if (targetSlot === 'off_hand' && hero.equipment.main_hand) {
    const mainInst = campaign.itemsByInstanceId[hero.equipment.main_hand];
    const mainDef = mainInst ? PROTOTYPE_ITEMS[mainInst.definitionId] : undefined;
    if (mainDef?.twoHanded) {
      return { ok: false, reason: 'Нельзя использовать левую руку с двуручным оружием.' };
    }
  }

  return { ok: true };
}

/**
 * §§317.5, 317.9, 317.11 (#3, #4, #13, #14):
 * Неразрушающий предпросмотр экипировки без hover:
 * - собирает все невыполненные требования для явной подсветки красным;
 * - показывает конфликты слотов (включая вытеснение off_hand при 2H оружии);
 * - вычисляет точные дельты статов (HP, Mana, Armor, WeaponDamage, Attributes) до подтверждения.
 */
export function previewHeroEquipmentChange(
  campaign: CampaignState,
  heroId: string,
  instanceId: string,
  targetSlot: EquipSlotId
): EquipmentPreviewResult {
  const hero = campaign.heroes[heroId];
  const inst = campaign.itemsByInstanceId[instanceId];
  const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : undefined;

  if (!hero || !inst || !def) {
    return {
      canEquip: false,
      unmetReasonsRu: ['Герой или предмет не найдены.'],
      slotConflicts: [],
      statDelta: { maxHp: 0, maxMana: 0, armor: 0, weaponBaseDamage: 0, attributes: {} },
    };
  }

  const unmetReasonsRu: string[] = [];
  if (!def.allowedSlots.includes(targetSlot)) {
    unmetReasonsRu.push(`Предмет нельзя надеть в слот ${targetSlot}.`);
  }

  // Вычисляем характеристики БЕЗ самого предмета (чтобы его собственные бонусы не удовлетворяли его же требования §1.5)
  const heroCloneForReq = { ...hero, equipment: { ...hero.equipment } };
  if (inst.location.kind === 'equipped' && inst.location.heroId === heroId) {
    heroCloneForReq.equipment[inst.location.slot] = null;
  }
  const derivedWithoutSelf = computeDerivedHeroStats(heroCloneForReq, campaign.itemsByInstanceId);

  if (def.requirements?.level && hero.level < def.requirements.level) {
    unmetReasonsRu.push(`Требуется уровень ${def.requirements.level} (сейчас ${hero.level}).`);
  }
  if (def.requirements?.attributes) {
    for (const [attr, req] of Object.entries(def.requirements.attributes) as Array<[AttributeId, number]>) {
      if (derivedWithoutSelf.effectiveAttributes[attr] < req) {
        unmetReasonsRu.push(
          `Требуется ${attr} >= ${req} (сейчас ${derivedWithoutSelf.effectiveAttributes[attr]}).`
        );
      }
    }
  }
  if (def.requirements?.masteries) {
    for (const [m, req] of Object.entries(def.requirements.masteries) as Array<[CombatMasteryId, number]>) {
      if (hero.combatMasteries[m] < req) {
        unmetReasonsRu.push(`Требуется мастерство ${m} >= ${req} (сейчас ${hero.combatMasteries[m]}).`);
      }
    }
  }
  if (targetSlot === 'off_hand' && hero.equipment.main_hand) {
    const mainInst = campaign.itemsByInstanceId[hero.equipment.main_hand];
    const mainDef = mainInst ? PROTOTYPE_ITEMS[mainInst.definitionId] : undefined;
    if (mainDef?.twoHanded) {
      unmetReasonsRu.push('Нельзя использовать левую руку с двуручным оружием.');
    }
  }

  const slotConflicts: Array<{ slot: EquipSlotId; replacedItemNameRu: string }> = [];
  const prevTargetId = hero.equipment[targetSlot];
  if (prevTargetId && prevTargetId !== instanceId) {
    const prevInst = campaign.itemsByInstanceId[prevTargetId];
    const prevDef = prevInst ? PROTOTYPE_ITEMS[prevInst.definitionId] : undefined;
    if (prevDef) {
      slotConflicts.push({ slot: targetSlot, replacedItemNameRu: prevDef.nameRu });
    }
  }
  if (def.twoHanded && targetSlot === 'main_hand' && hero.equipment.off_hand) {
    const offInst = campaign.itemsByInstanceId[hero.equipment.off_hand];
    const offDef = offInst ? PROTOTYPE_ITEMS[offInst.definitionId] : undefined;
    if (offDef) {
      slotConflicts.push({ slot: 'off_hand', replacedItemNameRu: offDef.nameRu });
    }
  }

  // Симулируем экипировку на копии, чтобы получить точные дельты статов без мутации campaign
  const before = computeDerivedHeroStats(hero, campaign.itemsByInstanceId);
  const simHero = { ...hero, equipment: { ...hero.equipment } };
  if (def.twoHanded && targetSlot === 'main_hand') {
    simHero.equipment.off_hand = null;
  }
  simHero.equipment[targetSlot] = instanceId;
  const after = computeDerivedHeroStats(simHero, campaign.itemsByInstanceId);

  const attrDelta: Partial<Record<AttributeId, number>> = {};
  for (const attr of Object.keys(before.effectiveAttributes) as AttributeId[]) {
    const d = after.effectiveAttributes[attr] - before.effectiveAttributes[attr];
    if (d !== 0) attrDelta[attr] = d;
  }

  return {
    canEquip: unmetReasonsRu.length === 0,
    unmetReasonsRu,
    slotConflicts,
    statDelta: {
      maxHp: after.maxHp - before.maxHp,
      maxMana: after.maxMana - before.maxMana,
      armor: after.armorFromEquipment - before.armorFromEquipment,
      weaponBaseDamage: after.weaponBaseDamage - before.weaponBaseDamage,
      attributes: attrDelta,
    },
  };
}

/**
 * §331.1, §347.2: Атомарная экипировка из PartyInventory без дублирования InstanceID.
 */
export function equipItemFromPartyInventory(
  campaign: CampaignState,
  heroId: string,
  instanceId: string,
  targetSlot: EquipSlotId
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!hero || !inst) return { ok: false, reason: 'Герой или предмет не найдены.' };
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, reason: 'Предмет должен находиться в PartyInventory.' };
  }

  const check = canHeroEquipItem(campaign, heroId, instanceId, targetSlot);
  if (!check.ok) return check;

  const def = PROTOTYPE_ITEMS[inst.definitionId];

  // Снимаем предмет, уже находящийся в целевом слоте
  const prevInSlotId = hero.equipment[targetSlot];
  if (prevInSlotId && campaign.itemsByInstanceId[prevInSlotId]) {
    campaign.itemsByInstanceId[prevInSlotId].location = { kind: 'party_inventory' };
    hero.equipment[targetSlot] = null;
  }

  // Если надевается двуручное оружие — автоматически снимаем off_hand обратно в PartyInventory
  if (def.twoHanded && targetSlot === 'main_hand' && hero.equipment.off_hand) {
    const offId = hero.equipment.off_hand;
    if (campaign.itemsByInstanceId[offId]) {
      campaign.itemsByInstanceId[offId].location = { kind: 'party_inventory' };
    }
    hero.equipment.off_hand = null;
  }

  hero.equipment[targetSlot] = instanceId;
  inst.location = { kind: 'equipped', heroId, slot: targetSlot };

  const updated = computeDerivedHeroStats(hero, campaign.itemsByInstanceId);
  hero.maxHp = updated.maxHp;
  hero.hp = Math.min(hero.maxHp, hero.hp);
  hero.maxMana = updated.maxMana;
  hero.mana = Math.min(hero.maxMana, hero.mana);

  return { ok: true };
}

export function unequipSlotToPartyInventory(
  campaign: CampaignState,
  heroId: string,
  slot: EquipSlotId
): { ok: boolean; reason?: string } {
  const hero = campaign.heroes[heroId];
  if (!hero) return { ok: false, reason: 'Герой не найден.' };
  const instId = hero.equipment[slot];
  if (!instId) return { ok: false, reason: 'Слот пуст.' };

  const inst = campaign.itemsByInstanceId[instId];
  if (inst) {
    inst.location = { kind: 'party_inventory' };
  }
  hero.equipment[slot] = null;

  const updated = computeDerivedHeroStats(hero, campaign.itemsByInstanceId);
  hero.maxHp = updated.maxHp;
  hero.hp = Math.min(hero.maxHp, hero.hp);
  hero.maxMana = updated.maxMana;
  hero.mana = Math.min(hero.maxMana, hero.mana);

  return { ok: true };
}

/**
 * §140.4: Использование свитка заклинания переносит знание в Гримуар (не боевой расходник).
 */
export function transcribeSpellScrollToGrimoire(
  campaign: CampaignState,
  heroId: string,
  instanceId: string
): { ok: boolean; spellId?: string; reason?: string } {
  const hero = campaign.heroes[heroId];
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!hero || !inst) return { ok: false, reason: 'Герой или свиток не найдены.' };
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, reason: 'Свиток должен быть в PartyInventory.' };
  }
  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (!def || def.category !== 'spell_scroll' || !def.grantsSpellId) {
    return { ok: false, reason: 'Предмет не является свитком заклинания.' };
  }

  const res = acquireSpellFormula(hero, def.grantsSpellId);
  if (!res.ok) return { ok: false, reason: res.reason };

  if (inst.quantity > 1) {
    inst.quantity -= 1;
  } else {
    delete campaign.itemsByInstanceId[instanceId];
  }
  return { ok: true, spellId: def.grantsSpellId };
}

/**
 * §331.2: Перемещение между PartyInventory (без лимита) и CampaignStorage (ограниченный склад, доступный в разрешённых точках).
 */
export function moveItemBetweenInventoryAndStorage(
  campaign: CampaignState,
  map: MapInstanceState,
  instanceId: string,
  direction: 'to_storage' | 'to_inventory',
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; reason?: string } {
  if (!map.atAuthorizedStoragePoint) {
    return {
      ok: false,
      reason: 'Удалённый доступ к CampaignStorage запрещён: переместите героя к точке склада (§331.2).',
    };
  }
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!inst) return { ok: false, reason: 'Предмет не найден.' };

  if (direction === 'to_storage') {
    if (inst.location.kind !== 'party_inventory') {
      return { ok: false, reason: 'На склад можно перенести только предмет из PartyInventory.' };
    }
    const storedCount = Object.values(campaign.itemsByInstanceId).filter(
      (i) => i.location.kind === 'campaign_storage'
    ).length;
    if (storedCount >= config.campaignStorageCapacity) {
      return {
        ok: false,
        reason: `Склад кампании заполнен (${storedCount}/${config.campaignStorageCapacity}, временная ёмкость OD-002).`,
      };
    }
    inst.location = { kind: 'campaign_storage' };
    return { ok: true };
  } else {
    if (inst.location.kind !== 'campaign_storage') {
      return { ok: false, reason: 'Предмет не находится на CampaignStorage.' };
    }
    inst.location = { kind: 'party_inventory' };
    return { ok: true };
  }
}

/**
 * §347.5, §348.4: Предпросмотр торговой операции без мутации состояния.
 * Отображает предмет, цену, итоговый баланс и признак дополнительного подтверждения до списания/продажи.
 */
export function previewMerchantTransaction(
  campaign: CampaignState,
  merchantId: string,
  mode: 'buy' | 'sell',
  targetId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): MerchantTransactionPreview {
  const merchant = campaign.merchants[merchantId];
  const avatar = campaign.heroes[campaign.avatarId];
  const walletKey = config.enableProposedCampaignWallet
    ? 'proposedCampaignWalletCopper'
    : 'localMapWalletCopper';
  const balanceBefore = campaign[walletKey];

  if (!merchant || !avatar) {
    return {
      ok: false,
      mode,
      definitionId: targetId,
      itemNameRu: 'Неизвестно',
      quantity: 0,
      priceCopper: 0,
      balanceBeforeCopper: balanceBefore,
      balanceAfterCopper: balanceBefore,
      requiresExtraConfirm: false,
      reason: 'Торговец или Аватар не найдены.',
    };
  }

  if (mode === 'buy') {
    const def = PROTOTYPE_ITEMS[targetId];
    if (!def || !merchant.stockDefinitionIds.includes(targetId)) {
      return {
        ok: false,
        mode,
        definitionId: targetId,
        itemNameRu: def?.nameRu ?? targetId,
        quantity: 0,
        priceCopper: 0,
        balanceBeforeCopper: balanceBefore,
        balanceAfterCopper: balanceBefore,
        requiresExtraConfirm: false,
        reason: 'Товар отсутствует у этого торговца.',
      };
    }
    const { buyPriceCopper } = computeBuyAndSellPricesCopper(
      targetId,
      avatar.baseAttributes.CHA,
      merchant.buyPriceMultiplier,
      merchant.sellPriceMultiplier
    );
    const canAfford = balanceBefore >= buyPriceCopper;
    return {
      ok: canAfford,
      mode,
      definitionId: targetId,
      itemNameRu: def.nameRu,
      quantity: 1,
      priceCopper: buyPriceCopper,
      balanceBeforeCopper: balanceBefore,
      balanceAfterCopper: canAfford ? balanceBefore - buyPriceCopper : balanceBefore,
      requiresExtraConfirm: buyPriceCopper >= 5000,
      warningRu:
        buyPriceCopper >= 5000
          ? 'Крупная покупка (>= 50 Silver): подтвердите списание средств.'
          : undefined,
      reason: canAfford ? undefined : `Недостаточно средств: требуется ${buyPriceCopper} Copper.`,
    };
  }

  // mode === 'sell' -> targetId = instanceId
  const inst = campaign.itemsByInstanceId[targetId];
  const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : undefined;
  if (!inst || !def) {
    return {
      ok: false,
      mode,
      definitionId: '',
      instanceId: targetId,
      itemNameRu: 'Неизвестно',
      quantity: 0,
      priceCopper: 0,
      balanceBeforeCopper: balanceBefore,
      balanceAfterCopper: balanceBefore,
      requiresExtraConfirm: false,
      reason: 'Предмет не найден.',
    };
  }
  if (inst.location.kind !== 'party_inventory') {
    return {
      ok: false,
      mode,
      definitionId: inst.definitionId,
      instanceId: inst.instanceId,
      itemNameRu: def.nameRu,
      quantity: inst.quantity,
      priceCopper: 0,
      balanceBeforeCopper: balanceBefore,
      balanceAfterCopper: balanceBefore,
      requiresExtraConfirm: false,
      reason: 'Продавать можно только предметы из PartyInventory.',
    };
  }
  if (inst.isQuestProtected) {
    return {
      ok: false,
      mode,
      definitionId: inst.definitionId,
      instanceId: inst.instanceId,
      itemNameRu: def.nameRu,
      quantity: inst.quantity,
      priceCopper: 0,
      balanceBeforeCopper: balanceBefore,
      balanceAfterCopper: balanceBefore,
      requiresExtraConfirm: false,
      reason: 'Нельзя продать защищённый квестовый предмет (§347.7).',
    };
  }

  const { sellPriceCopper } = computeBuyAndSellPricesCopper(
    inst.definitionId,
    avatar.baseAttributes.CHA,
    merchant.buyPriceMultiplier,
    merchant.sellPriceMultiplier
  );
  const ownedSameDef = Object.values(campaign.itemsByInstanceId).filter(
    (i) => i.definitionId === inst.definitionId && i.location.kind !== 'merchant'
  ).length;
  const isLastCopy = ownedSameDef <= 1;
  const runeWarn = previewRuneSaleOrDestructionWarning(campaign, inst.instanceId);

  return {
    ok: true,
    mode,
    definitionId: inst.definitionId,
    instanceId: inst.instanceId,
    itemNameRu: def.nameRu,
    quantity: inst.quantity,
    priceCopper: sellPriceCopper,
    balanceBeforeCopper: balanceBefore,
    balanceAfterCopper: balanceBefore + sellPriceCopper,
    requiresExtraConfirm: runeWarn.requiresExtraConfirm || isLastCopy || def.category === 'spell_scroll',
    warningRu: runeWarn.isRune
      ? runeWarn.warningRu
      : def.category === 'spell_scroll'
        ? 'Свиток формулы можно перенести в Гримуар вместо продажи (§140.4).'
        : isLastCopy
          ? 'Единственный экземпляр этого предмета в отряде.'
          : undefined,
  };
}

/**
 * §347.5, §347.7: Атомарные операции покупки и продажи у торговца (идемпотентно по transactionId).
 */
export function executeMerchantBuy(
  campaign: CampaignState,
  merchantId: string,
  definitionId: string,
  transactionId: string,
  newInstanceId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; priceCopper: number; reason?: string } {
  if (campaign.processedEventIds.includes(transactionId)) {
    return { ok: false, priceCopper: 0, reason: 'Транзакция уже обработана (защита от дубля).' };
  }
  const merchant = campaign.merchants[merchantId];
  const avatar = campaign.heroes[campaign.avatarId];
  const def = PROTOTYPE_ITEMS[definitionId];
  if (!merchant || !avatar || !def) {
    return { ok: false, priceCopper: 0, reason: 'Торговец, Аватар или товар не найдены.' };
  }
  if (!merchant.stockDefinitionIds.includes(definitionId)) {
    return { ok: false, priceCopper: 0, reason: 'Товар отсутствует у этого торговца.' };
  }

  // §132.3: Только NaturalCharisma (baseAttributes.CHA), без бонусов экипировки!
  const { buyPriceCopper } = computeBuyAndSellPricesCopper(
    definitionId,
    avatar.baseAttributes.CHA,
    merchant.buyPriceMultiplier,
    merchant.sellPriceMultiplier
  );

  const walletKey = config.enableProposedCampaignWallet
    ? 'proposedCampaignWalletCopper'
    : 'localMapWalletCopper';

  if (campaign[walletKey] < buyPriceCopper) {
    return {
      ok: false,
      priceCopper: buyPriceCopper,
      reason: `Недостаточно средств: требуется ${buyPriceCopper} Copper.`,
    };
  }

  campaign[walletKey] -= buyPriceCopper;
  campaign.itemsByInstanceId[newInstanceId] = {
    instanceId: newInstanceId,
    definitionId,
    quantity: 1,
    location: { kind: 'party_inventory' },
  };
  campaign.processedEventIds.push(transactionId);

  return { ok: true, priceCopper: buyPriceCopper };
}

export function executeMerchantSell(
  campaign: CampaignState,
  merchantId: string,
  instanceId: string,
  transactionId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; payoutCopper: number; reason?: string } {
  if (campaign.processedEventIds.includes(transactionId)) {
    return { ok: false, payoutCopper: 0, reason: 'Транзакция уже обработана.' };
  }
  const merchant = campaign.merchants[merchantId];
  const avatar = campaign.heroes[campaign.avatarId];
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!merchant || !avatar || !inst) {
    return { ok: false, payoutCopper: 0, reason: 'Торговец или предмет не найдены.' };
  }
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, payoutCopper: 0, reason: 'Продавать можно только предметы из PartyInventory.' };
  }
  if (inst.isQuestProtected) {
    return { ok: false, payoutCopper: 0, reason: 'Нельзя продать защищённый квестовый предмет (§347.7).' };
  }

  const { sellPriceCopper } = computeBuyAndSellPricesCopper(
    inst.definitionId,
    avatar.baseAttributes.CHA,
    merchant.buyPriceMultiplier,
    merchant.sellPriceMultiplier
  );

  const walletKey = config.enableProposedCampaignWallet
    ? 'proposedCampaignWalletCopper'
    : 'localMapWalletCopper';

  campaign[walletKey] += sellPriceCopper;
  delete campaign.itemsByInstanceId[instanceId];
  campaign.processedEventIds.push(transactionId);

  return { ok: true, payoutCopper: sellPriceCopper };
}

/**
 * §347.2 инвариант: ни один экземпляр не может существовать дважды или в двух контейнерах сразу.
 */
export function verifyItemLocationInvariants(campaign: CampaignState): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const equippedIds = new Set<string>();

  for (const hero of Object.values(campaign.heroes)) {
    for (const [slot, instId] of Object.entries(hero.equipment) as Array<[EquipSlotId, string | null]>) {
      if (!instId) continue;
      if (equippedIds.has(instId)) {
        errors.push(`Дублирование экипированного предмета ${instId}.`);
      }
      equippedIds.add(instId);
      const inst = campaign.itemsByInstanceId[instId];
      if (!inst) {
        errors.push(`Экипирован несуществующий предмет ${instId} на герое ${hero.heroId}.`);
      } else if (
        inst.location.kind !== 'equipped' ||
        inst.location.heroId !== hero.heroId ||
        inst.location.slot !== slot
      ) {
        errors.push(`Рассинхронизация местонахождения ${instId} (ожидался слот ${slot}).`);
      }
    }
  }

  const tabletIds = new Set<string>();
  for (const slot of campaign.runeTablet?.slots ?? []) {
    if (!slot.runeInstanceId) continue;
    if (tabletIds.has(slot.runeInstanceId) || equippedIds.has(slot.runeInstanceId)) {
      errors.push(`Дублирование руны ${slot.runeInstanceId} между контейнерами.`);
    }
    tabletIds.add(slot.runeInstanceId);
    const inst = campaign.itemsByInstanceId[slot.runeInstanceId];
    if (!inst) {
      errors.push(`В Rune Tablet установлена несуществующая руна ${slot.runeInstanceId}.`);
    } else if (inst.location.kind !== 'rune_tablet' || inst.location.slotIndex !== slot.slotIndex) {
      errors.push(
        `Рассинхронизация местонахождения руны ${slot.runeInstanceId} (ожидалась ячейка Rune Tablet ${slot.slotIndex}).`
      );
    }
  }

  for (const inst of Object.values(campaign.itemsByInstanceId)) {
    if (inst.location.kind === 'equipped') {
      const hero = campaign.heroes[inst.location.heroId];
      if (!hero || hero.equipment[inst.location.slot] !== inst.instanceId) {
        errors.push(`Предмет ${inst.instanceId} помечен equipped, но отсутствует в слоте героя.`);
      }
    } else if (inst.location.kind === 'rune_tablet') {
      const slot = campaign.runeTablet?.slots[inst.location.slotIndex];
      if (!slot || slot.runeInstanceId !== inst.instanceId) {
        errors.push(`Руна ${inst.instanceId} помечена rune_tablet, но отсутствует в ячейке Rune Tablet.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * §303.2, §303.5, §347.7: Обновление этапа квеста и идемпотентная выдача награды по RewardId.
 */
export function completeQuestStageAndMaybeReward(
  campaign: CampaignState,
  questId: string,
  stageId: string,
  eventId: string,
  rewardItemInstanceId?: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; questCompleted: boolean; rewardGranted: boolean; reason?: string } {
  if (campaign.processedEventIds.includes(eventId)) {
    return { ok: false, questCompleted: false, rewardGranted: false, reason: 'Событие квеста уже обработано.' };
  }
  const quest: QuestRecord | undefined = campaign.quests[questId];
  if (!quest) return { ok: false, questCompleted: false, rewardGranted: false, reason: 'Задание не найдено.' };
  if (quest.status !== 'Active') {
    return { ok: false, questCompleted: false, rewardGranted: false, reason: `Задание в статусе ${quest.status}.` };
  }

  const stage = quest.stages.find((s) => s.stageId === stageId);
  if (!stage) return { ok: false, questCompleted: false, rewardGranted: false, reason: 'Этап не найден.' };

  stage.completed = true;
  campaign.processedEventIds.push(eventId);

  const allDone = quest.stages.every((s) => s.completed);
  let rewardGranted = false;

  if (allDone) {
    quest.status = 'Completed';
    if (quest.rewardId && !campaign.processedRewardIds.includes(quest.rewardId)) {
      campaign.processedRewardIds.push(quest.rewardId);
      rewardGranted = true;

      if (quest.rewardCopper && quest.rewardCopper > 0) {
        const walletKey = config.enableProposedCampaignWallet
          ? 'proposedCampaignWalletCopper'
          : 'localMapWalletCopper';
        campaign[walletKey] += quest.rewardCopper;
      }
      if (quest.rewardXp && quest.rewardXp > 0) {
        grantHeroExperience(campaign, campaign.avatarId, quest.rewardXp, null, config);
      }
      if (quest.rewardItemDefinitionId && rewardItemInstanceId) {
        campaign.itemsByInstanceId[rewardItemInstanceId] = {
          instanceId: rewardItemInstanceId,
          definitionId: quest.rewardItemDefinitionId,
          quantity: 1,
          location: { kind: 'party_inventory' },
        };
      }
    }
  }

  return { ok: true, questCompleted: allDone, rewardGranted };
}

/**
 * §290, §341.2, §43.4: Атомарный переход между картами через портал:
 * - Не требует экрана Expedition Preparation (§290)
 * - Идемпотентен по transitionId (§341.2)
 * - Полностью сбрасывает MagicStrain у героев (§43.4 APPROVED)
 * - Закрывает окно respec до начала следующей карты (§1.12)
 * - НЕ переносит локальные ресурсы поселений предыдущей карты (§341.3, §338.7)
 */
export function executePortalMapTransition(
  campaign: CampaignState,
  mission: MissionState,
  currentMap: MapInstanceState,
  nextMapDefId: string,
  transitionId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS,
  eventJournal: SaveEvent[] = []
): { ok: boolean; nextMap?: MapInstanceState; checkpointCreated?: CheckpointRecord; reason?: string } {
  if (campaign.processedTransitionIds.includes(transitionId)) {
    return { ok: false, reason: `Переход ${transitionId} уже был выполнен (идемпотентность §341.2).` };
  }

  // Атомарная проверка перед мутациями
  if (currentMap.lifecycle === 'UNLOADING' || currentMap.lifecycle === 'FAILED') {
    return { ok: false, reason: 'Недопустимое состояние карты для портала.' };
  }

  // §276.7: Переход запрещён, пока Аватар находится в Dead или RespawnPending
  const avatar = campaign.heroes[campaign.avatarId];
  if (avatar && avatar.deathState.lifecycle !== 'Alive') {
    return {
      ok: false,
      reason: 'Переход через портал запрещён, пока Аватар мёртв или ожидает возрождения (§276.7).',
    };
  }

  // §346.8: Проверка ReturnPolicy при попытке повторно войти в уже посещённую карту
  const archivedTarget = campaign.archivedMapsByDefinitionId?.[nextMapDefId];
  if (archivedTarget && mission.returnPolicy === 'OneWay') {
    return {
      ok: false,
      reason: `Политика возврата OneWay запрещает повторный вход на карту "${nextMapDefId}" (§346.8).`,
    };
  }

  // §341.7: Автоматический Checkpoint строго ДО необратимого перехода
  const prePortalSnap = createSaveSnapshot(
    campaign,
    mission,
    currentMap,
    eventJournal,
    `cp_pre_${transitionId}`
  );
  const checkpoint: CheckpointRecord = {
    checkpointId: `cp_${transitionId}`,
    reason: 'pre_portal',
    createdAtIso: prePortalSnap.createdAtIso,
    mapDefinitionId: currentMap.mapDefinitionId,
    snapshotJson: JSON.stringify(prePortalSnap),
  };
  if (!campaign.checkpoints) campaign.checkpoints = [];
  campaign.checkpoints.push(checkpoint);
  if (campaign.checkpoints.length > 5) {
    campaign.checkpoints = campaign.checkpoints.slice(-5);
  }

  currentMap.lifecycle = 'RESOLVING';
  campaign.processedTransitionIds.push(transitionId);

  // §43.4: Полный сброс MagicStrain для всех активных героев при переходе через портал
  for (const hero of Object.values(campaign.heroes)) {
    resetMagicStrainOnMapTransition(hero);
    // После перехода окно respec предыдущей карты закрывается (§1.12)
    hero.respecWindowOpen = false;
  }

  // §331.4: если PROPOSED CampaignWallet не утверждён, локальный кошелёк карты обнуляется при входе на новую карту
  if (!config.enableProposedCampaignWallet) {
    campaign.localMapWalletCopper = 0;
  }

  // §338.7: Замораживаем производственные очереди покидаемой карты (не текут в фоне)
  for (const s of Object.values(currentMap.localSettlements)) {
    s.frozenOnInactiveMap = true;
  }

  // §341.4: Перенос только выживших переносимых FieldArmy-отрядов с их фактической численностью (без воскрешения павших и без Garrison)
  const transferredRoster: NonNullable<MapInstanceState['squadRoster']> = {};
  const transferredSquads: MapInstanceState['squads'] = {};
  if (currentMap.squadRoster) {
    for (const [sqId, sq] of Object.entries(currentMap.squadRoster)) {
      if (!sq.portableAcrossPortals || sq.deploymentState !== 'FieldArmy') continue;
      const survivingUnits = sq.units.filter((u) => u.alive && u.hp > 0);
      if (survivingUnits.length === 0) continue; // §341.4.2: уничтоженный отряд не восстанавливается
      transferredRoster[sqId] = {
        ...JSON.parse(JSON.stringify(sq)),
        units: JSON.parse(JSON.stringify(survivingUnits)),
      };
      transferredSquads[sqId] = JSON.parse(JSON.stringify(sq.command));
    }
  }

  // Сохраняем снимок покинутой карты в архив (для AllowReturn без генерации с нуля §346.8)
  if (!campaign.archivedMapsByDefinitionId) {
    campaign.archivedMapsByDefinitionId = {};
  }
  const frozenCopy: MapInstanceState = JSON.parse(JSON.stringify(currentMap));
  frozenCopy.lifecycle = 'PAUSED';
  // Убираем переносимую FieldArmy из архивной карты, чтобы один отряд не оказался на двух картах (§341.4)
  if (frozenCopy.squadRoster) {
    for (const sqId of Object.keys(transferredRoster)) {
      delete frozenCopy.squadRoster[sqId];
      delete frozenCopy.squads[sqId];
    }
  }
  campaign.archivedMapsByDefinitionId[currentMap.mapDefinitionId] = frozenCopy;

  let nextMap: MapInstanceState;
  if (archivedTarget) {
    // §346.7–346.8: Восстанавливаем ранее посещённую карту при AllowReturn (без фоновой симуляции времени!)
    nextMap = JSON.parse(JSON.stringify(archivedTarget));
    delete campaign.archivedMapsByDefinitionId[nextMapDefId];
    for (const s of Object.values(nextMap.localSettlements)) {
      s.frozenOnInactiveMap = false;
    }
    if (!nextMap.squadRoster) nextMap.squadRoster = {};
    for (const [sqId, sq] of Object.entries(transferredRoster)) {
      nextMap.squadRoster[sqId] = sq;
      nextMap.squads[sqId] = transferredSquads[sqId];
    }
    nextMap.lifecycle = 'RUNNING';
  } else {
    nextMap = {
      mapInstanceId: `map_inst_${nextMapDefId}_${transitionId}`,
      mapDefinitionId: nextMapDefId,
      missionId: mission.missionId,
      lifecycle: 'READY',
      simulationTimeSec: 0,
      activeStoneOfSoulsId: `stone_${nextMapDefId}_start`,
      availableStoneOfSoulsIds: [`stone_${nextMapDefId}_start`],
      atAuthorizedStoragePoint: false,
      localSettlements: {}, // Локальные ресурсы предыдущей карты НЕ утекают сюда (§341.3)
      squads: transferredSquads,
      squadRoster: transferredRoster,
      enemyAiGroups: {},
      activeEffectsByTarget: {},
      controlTrackerByTarget: {},
      worldObjects: {
        [`stone_${nextMapDefId}_start`]: {
          objectId: `stone_${nextMapDefId}_start`,
          kind: 'stone_of_souls',
          nameRu: `Stone of Souls (${nextMapDefId})`,
          allowedVerbs: ['Interact'],
          activated: true,
        },
        [`portal_return_${currentMap.mapDefinitionId}`]: {
          objectId: `portal_return_${currentMap.mapDefinitionId}`,
          kind: 'portal',
          nameRu: `Портал возврата в ${currentMap.mapDefinitionId}`,
          allowedVerbs: ['Interact'],
          targetMapDefId: currentMap.mapDefinitionId,
        },
      },
      necromancyMinions: [],
      necromancyAutonomy: {
        active: false,
        initialPool: 0,
        remainingPool: 0,
        triggeredAtTimeSec: null,
      },
      localFlags: {},
    };
    nextMap.lifecycle = 'RUNNING';
  }

  currentMap.lifecycle = 'UNLOADED';

  return { ok: true, nextMap, checkpointCreated: checkpoint };
}

/**
 * FNV-1a 32-bit контрольная сумма для проверки целостности сохранений (§341.8).
 */
export function computeSnapshotChecksum(payloadWithoutChecksum: Omit<SaveSnapshot, 'checksum'>): string {
  const json = JSON.stringify(payloadWithoutChecksum);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createSaveSnapshot(
  campaign: CampaignState,
  mission: MissionState,
  activeMap: MapInstanceState,
  eventJournal: SaveEvent[] = [],
  saveId = `save_${Date.now()}`
): SaveSnapshot {
  const basePayload: Omit<SaveSnapshot, 'checksum'> = {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    gameBuildVersion: GAME_BUILD_VERSION,
    contentSchemaVersion: CONTENT_SCHEMA_VERSION,
    saveId,
    createdAtIso: new Date().toISOString(),
    lastCommittedEventId: eventJournal.length > 0 ? eventJournal[eventJournal.length - 1].eventId : null,
    campaign: JSON.parse(JSON.stringify(campaign)),
    mission: JSON.parse(JSON.stringify(mission)),
    activeMap: JSON.parse(JSON.stringify(activeMap)),
    eventJournal: JSON.parse(JSON.stringify(eventJournal)),
  };

  return {
    ...basePayload,
    checksum: computeSnapshotChecksum(basePayload),
  };
}

const KNOWN_SNAPSHOT_TOP_KEYS = new Set([
  'saveFormatVersion',
  'gameBuildVersion',
  'contentSchemaVersion',
  'saveId',
  'createdAtIso',
  'lastCommittedEventId',
  'checksum',
  'campaign',
  'mission',
  'activeMap',
  'eventJournal',
  'extraMetadata',
]);

/**
 * §341.8: Последовательная миграция v0 -> v1 -> v2 на копии данных
 * с заполнением полей по умолчанию и сохранением неизвестных/пользовательских полей.
 */
export function migrateSnapshotSequential(rawParsed: Record<string, unknown>): {
  snapshot: SaveSnapshot;
  migratedFromVersion?: number;
} {
  const copy = JSON.parse(JSON.stringify(rawParsed)) as Record<string, unknown>;
  const initialVersion = typeof copy.saveFormatVersion === 'number' ? copy.saveFormatVersion : 0;

  // Собираем неизвестные поля верхнего уровня, чтобы не терять их при миграции (§341.8.4)
  const existingExtra =
    typeof copy.extraMetadata === 'object' && copy.extraMetadata !== null
      ? { ...(copy.extraMetadata as Record<string, unknown>) }
      : {};

  for (const [key, value] of Object.entries(copy)) {
    if (!KNOWN_SNAPSHOT_TOP_KEYS.has(key)) {
      existingExtra[key] = value;
      delete copy[key];
    }
  }

  const snap = copy as unknown as SaveSnapshot;
  let currentVersion = initialVersion;

  // Шаг v0 -> v1: базовая нормализация журналов, метаданных и коллекций
  if (currentVersion === 0) {
    if (!snap.gameBuildVersion) snap.gameBuildVersion = '0.1.0-migrated-v0';
    if (!snap.contentSchemaVersion) snap.contentSchemaVersion = 'v14.2-core-01';
    if (!Array.isArray(snap.eventJournal)) snap.eventJournal = [];
    if (!Array.isArray(snap.campaign.processedEventIds)) snap.campaign.processedEventIds = [];
    if (!Array.isArray(snap.campaign.processedTransitionIds)) snap.campaign.processedTransitionIds = [];
    if (!Array.isArray(snap.campaign.processedRewardIds)) snap.campaign.processedRewardIds = [];
    currentVersion = 1;
    snap.saveFormatVersion = 1;
  }

  // Шаг v1 -> v2: поля Среза 3 и Среза 4 (архив карт, checkpoints, объекты §316, прогресс школ, кости, активный каст)
  if (currentVersion === 1) {
    if (!snap.campaign.archivedMapsByDefinitionId) {
      snap.campaign.archivedMapsByDefinitionId = {};
    }
    if (!snap.campaign.checkpoints) {
      snap.campaign.checkpoints = [];
    }
    if (!snap.activeMap.worldObjects) {
      snap.activeMap.worldObjects = {};
    }
    if (typeof snap.mission.defeatOnAvatarDeath !== 'boolean') {
      snap.mission.defeatOnAvatarDeath = false;
    }
    for (const hero of Object.values(snap.campaign.heroes ?? {})) {
      if (hero.activeCast === undefined) hero.activeCast = null;
      if (!hero.schoolProgressBySchool) hero.schoolProgressBySchool = {};
      if (typeof hero.bonesCount !== 'number') hero.bonesCount = 0;
    }
    currentVersion = 2;
    snap.saveFormatVersion = 2;
  }

  // Шаг v2 -> v3: поля Среза 7 (Rune Tablet §144, Plan Book §146)
  if (currentVersion === 2) {
    ensureRuneTabletSynced(snap.campaign);
    if (!snap.campaign.planBook) {
      snap.campaign.planBook = {};
    }
    currentVersion = 3;
    snap.saveFormatVersion = 3;
    snap.gameBuildVersion = GAME_BUILD_VERSION;
    snap.contentSchemaVersion = CONTENT_SCHEMA_VERSION;
  }

  if (Object.keys(existingExtra).length > 0) {
    snap.extraMetadata = existingExtra;
  }

  const { checksum: _old, ...payloadWithoutChecksum } = snap;
  snap.checksum = computeSnapshotChecksum(payloadWithoutChecksum);

  return {
    snapshot: snap,
    migratedFromVersion: initialVersion < SAVE_FORMAT_VERSION ? initialVersion : undefined,
  };
}

/**
 * §341.7–341.8: Загрузка с валидацией контрольной суммы, ссылочной целостности и последовательной миграцией.
 * Повреждённый снимок отклоняется с сохранением предыдущей рабочей копии.
 */
export function validateAndLoadSnapshot(
  rawJson: string
): { ok: true; snapshot: SaveSnapshot; migratedFromVersion?: number } | { ok: false; error: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Файл сохранения повреждён (невалидный JSON).' };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.saveFormatVersion !== 'number' ||
    typeof parsed.checksum !== 'string' ||
    !parsed.campaign ||
    !parsed.activeMap ||
    !parsed.mission
  ) {
    return { ok: false, error: 'Отсутствуют обязательные заголовки SaveSnapshot (§341.8).' };
  }

  const { checksum, ...rest } = parsed as unknown as SaveSnapshot;
  const expectedChecksum = computeSnapshotChecksum(rest);
  if (checksum !== expectedChecksum) {
    return {
      ok: false,
      error: `Нарушена контрольная сумма сохранения (ожидалась ${expectedChecksum}, получена ${checksum}).`,
    };
  }

  if (parsed.saveFormatVersion > SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Версия сохранения v${parsed.saveFormatVersion} новее поддерживаемой v${SAVE_FORMAT_VERSION}.`,
    };
  }

  const { snapshot, migratedFromVersion } = migrateSnapshotSequential(parsed);

  const invCheck = verifyItemLocationInvariants(snapshot.campaign);
  if (!invCheck.valid) {
    return {
      ok: false,
      error: `Ошибка ссылочной целостности предметов: ${invCheck.errors.join('; ')}`,
    };
  }

  return { ok: true, snapshot, migratedFromVersion };
}

/**
 * §303: Активация задания с обязательной проверкой prerequisiteQuestIds (Completed / Closed).
 */
export function activateQuestIfPrerequisitesMet(
  campaign: CampaignState,
  questId: string
): { ok: boolean; reason?: string } {
  const quest = campaign.quests[questId];
  if (!quest) {
    return { ok: false, reason: 'Задание не найдено.' };
  }
  if (quest.status !== 'Unavailable' && quest.status !== 'Available') {
    return { ok: false, reason: `Задание "${quest.titleRu}" уже в статусе ${quest.status}.` };
  }

  for (const reqId of quest.prerequisiteQuestIds) {
    const req = campaign.quests[reqId];
    if (!req || (req.status !== 'Completed' && req.status !== 'Closed')) {
      return {
        ok: false,
        reason: `Не выполнено предварительное задание "${req?.titleRu ?? reqId}" (§303).`,
      };
    }
  }

  quest.status = 'Active';
  return { ok: true };
}

/**
 * §347.7: Безопасное удаление предмета из PartyInventory с жёстким запретом удаления защищённых квестовых предметов.
 */
export function discardOrDestroyInventoryItem(
  campaign: CampaignState,
  instanceId: string
): { ok: boolean; reason?: string } {
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!inst) {
    return { ok: false, reason: 'Предмет не найден.' };
  }
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, reason: 'Удалять можно только предметы из PartyInventory.' };
  }
  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (inst.isQuestProtected || def?.category === 'quest_item') {
    return {
      ok: false,
      reason: `Удаление защищённого квестового предмета "${def?.nameRu ?? instanceId}" заблокировано (§347.7).`,
    };
  }
  delete campaign.itemsByInstanceId[instanceId];
  return { ok: true };
}

/**
 * §140.1, §242 APPROVED: Явный запрет универсальных боевых зелий HP/Mana и подтверждение природы свитков.
 */
export function isCombatConsumableAllowed(
  category: 'hp_potion' | 'mana_potion' | 'spell_scroll' | 'quest_item'
): { allowed: boolean; reason: string } {
  if (category === 'hp_potion' || category === 'mana_potion') {
    return {
      allowed: false,
      reason: 'Универсальные боевые зелья HP/Mana отсутствуют по базовым правилам игры (§140.1, §242).',
    };
  }
  if (category === 'spell_scroll') {
    return {
      allowed: false,
      reason: 'Свиток заклинания переносится в Гримуар, а не используется как одноразовый боевой расходник (§140.4).',
    };
  }
  return { allowed: true, reason: 'Допустимая категория предмета.' };
}

/**
 * §274.2: Проверка допустимости объединения двух стаков.
 * Не объединяются не-стакуемые предметы, экипировка, предметы из разных контейнеров или с разным квестовым статусом.
 */
export function canStacksMerge(a: ItemInstance, b: ItemInstance): boolean {
  if (a.instanceId === b.instanceId) return false;
  if (a.definitionId !== b.definitionId) return false;
  if (Boolean(a.isQuestProtected) !== Boolean(b.isQuestProtected)) return false;
  if (a.location.kind !== b.location.kind) return false;
  const def = PROTOTYPE_ITEMS[a.definitionId];
  if (!def || !def.stackable) return false;
  if (def.allowedSlots.length > 0) return false;
  return true;
}

/**
 * §§274.1, 274.3: Подбор предмета в безлимитный PartyInventory.
 * Никогда не блокируется вместимостью; при допустимости дополняет существующие стаки до maxStackSize (OD-003 WORKING_ASSUMPTION),
 * остаток переносится в новые стаки без потери единиц.
 */
export function pickupItemToPartyInventory(
  campaign: CampaignState,
  definitionId: string,
  quantity: number,
  idPrefix: string,
  options: { isQuestProtected?: boolean; config?: ProvisionalBalanceConfig } = {}
): { ok: boolean; touchedInstanceIds: string[]; addedQuantity: number; reason?: string } {
  const def = PROTOTYPE_ITEMS[definitionId];
  if (!def) return { ok: false, touchedInstanceIds: [], addedQuantity: 0, reason: 'Неизвестный предмет.' };
  const qty = Math.floor(quantity);
  if (qty <= 0) return { ok: false, touchedInstanceIds: [], addedQuantity: 0, reason: 'Количество должно быть > 0.' };

  const config = options.config ?? DEFAULT_WORKING_ASSUMPTIONS;
  const maxStack = def.stackable
    ? config.maxStackSize === null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, config.maxStackSize)
    : 1;
  const isQuestProtected = Boolean(options.isQuestProtected || def.category === 'quest_item');
  const touchedInstanceIds: string[] = [];
  let remaining = qty;

  if (def.stackable) {
    const existing = Object.values(campaign.itemsByInstanceId).filter(
      (i) =>
        i.location.kind === 'party_inventory' &&
        i.definitionId === definitionId &&
        Boolean(i.isQuestProtected) === isQuestProtected &&
        i.quantity < maxStack
    );
    for (const stack of existing) {
      if (remaining <= 0) break;
      const room = maxStack - stack.quantity;
      const take = Math.min(room, remaining);
      stack.quantity += take;
      remaining -= take;
      touchedInstanceIds.push(stack.instanceId);
    }
  }

  let suffix = 1;
  while (remaining > 0) {
    const chunk = Math.min(maxStack, remaining);
    let newId = `${idPrefix}_${suffix}`;
    while (campaign.itemsByInstanceId[newId]) {
      suffix += 1;
      newId = `${idPrefix}_${suffix}`;
    }
    campaign.itemsByInstanceId[newId] = {
      instanceId: newId,
      definitionId,
      quantity: chunk,
      location: { kind: 'party_inventory' },
      isQuestProtected: isQuestProtected || undefined,
    };
    touchedInstanceIds.push(newId);
    remaining -= chunk;
    suffix += 1;
  }

  return { ok: true, touchedInstanceIds, addedQuantity: qty };
}

/**
 * §274.3: Разделение стака в PartyInventory без изменения суммарного количества.
 */
export function splitItemStack(
  campaign: CampaignState,
  instanceId: string,
  splitQuantity: number,
  newInstanceId: string
): { ok: boolean; reason?: string } {
  const inst = campaign.itemsByInstanceId[instanceId];
  if (!inst) return { ok: false, reason: 'Стак не найден.' };
  if (inst.location.kind !== 'party_inventory') {
    return { ok: false, reason: 'Разделение доступно для стаков в PartyInventory.' };
  }
  const def = PROTOTYPE_ITEMS[inst.definitionId];
  if (!def?.stackable) {
    return { ok: false, reason: 'Нестакуемый предмет нельзя разделить (§274.2).' };
  }
  const q = Math.floor(splitQuantity);
  if (q <= 0 || q >= inst.quantity) {
    return { ok: false, reason: `Размер отделения должен быть от 1 до ${inst.quantity - 1}.` };
  }
  if (campaign.itemsByInstanceId[newInstanceId]) {
    return { ok: false, reason: `Идентификатор ${newInstanceId} уже занят.` };
  }

  inst.quantity -= q;
  campaign.itemsByInstanceId[newInstanceId] = {
    instanceId: newInstanceId,
    definitionId: inst.definitionId,
    quantity: q,
    location: { kind: 'party_inventory' },
    isQuestProtected: inst.isQuestProtected,
  };
  return { ok: true };
}

/**
 * §274.3: Объединение двух совместимых стаков без изменения суммарного количества.
 */
export function mergeItemStacks(
  campaign: CampaignState,
  sourceInstanceId: string,
  targetInstanceId: string,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; movedQuantity: number; sourceRemoved: boolean; reason?: string } {
  const src = campaign.itemsByInstanceId[sourceInstanceId];
  const dst = campaign.itemsByInstanceId[targetInstanceId];
  if (!src || !dst) {
    return { ok: false, movedQuantity: 0, sourceRemoved: false, reason: 'Один из стаков не найден.' };
  }
  if (!canStacksMerge(src, dst)) {
    return {
      ok: false,
      movedQuantity: 0,
      sourceRemoved: false,
      reason: 'Эти предметы нельзя объединить в один стак (§274.2).',
    };
  }
  const maxStack =
    config.maxStackSize === null ? Number.MAX_SAFE_INTEGER : Math.max(1, config.maxStackSize);
  const room = maxStack - dst.quantity;
  if (room <= 0) {
    return { ok: false, movedQuantity: 0, sourceRemoved: false, reason: 'Целевой стак уже полон.' };
  }
  const moved = Math.min(room, src.quantity);
  dst.quantity += moved;
  src.quantity -= moved;
  let sourceRemoved = false;
  if (src.quantity <= 0) {
    delete campaign.itemsByInstanceId[sourceInstanceId];
    sourceRemoved = true;
  }
  return { ok: true, movedQuantity: moved, sourceRemoved };
}

/**
 * §274.1: Фильтрация, поиск и сортировка безлимитного PartyInventory (UI-организация без лимита ячеек).
 */
export function queryPartyInventoryItems(
  campaign: CampaignState,
  options: {
    category?: InventoryFilterCategory;
    search?: string;
    sortBy?: InventorySortMode;
  } = {}
): ItemInstance[] {
  const cat = options.category ?? 'all';
  const q = (options.search ?? '').trim().toLowerCase();
  const sortBy = options.sortBy ?? 'name';

  const items = Object.values(campaign.itemsByInstanceId).filter((inst) => {
    if (inst.location.kind !== 'party_inventory') return false;
    const def = PROTOTYPE_ITEMS[inst.definitionId];
    if (!def) return false;

    if (cat === 'equipment' && def.allowedSlots.length === 0) return false;
    if (cat === 'runes' && def.category !== 'worker_rune' && def.category !== 'hero_rune') return false;
    if (
      cat === 'plans_scrolls' &&
      def.category !== 'spell_scroll' &&
      def.category !== 'building_plan' &&
      def.category !== 'unit_plan'
    ) {
      return false;
    }
    if (
      cat === 'quest_other' &&
      def.category !== 'quest_item' &&
      def.category !== 'material' &&
      !inst.isQuestProtected
    ) {
      return false;
    }

    if (q && !def.nameRu.toLowerCase().includes(q) && !def.definitionId.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  return items.sort((a, b) => {
    const defA = PROTOTYPE_ITEMS[a.definitionId];
    const defB = PROTOTYPE_ITEMS[b.definitionId];
    if (sortBy === 'price_desc') {
      return (defB?.basePriceCopper ?? 0) - (defA?.basePriceCopper ?? 0);
    }
    if (sortBy === 'category') {
      return (defA?.category ?? '').localeCompare(defB?.category ?? '', 'ru');
    }
    return (defA?.nameRu ?? a.instanceId).localeCompare(defB?.nameRu ?? b.instanceId, 'ru');
  });
}

/**
 * §128 & §277 #1–3 (USER APPROVED — SPELLFORCE FIDELITY):
 * Удалённая передача экипированного предмета между активными героями группы без ограничения расстоянием.
 * Герои вне активной группы (activePartyHeroIds) не имеют удалённого доступа.
 * Атомарна: при невыполнении требований получателя предмет безопасно возвращается отправителю.
 */
export function transferEquippedItemBetweenHeroes(
  campaign: CampaignState,
  fromHeroId: string,
  fromSlot: EquipSlotId,
  toHeroId: string,
  toSlot?: EquipSlotId
): { ok: boolean; instanceId?: string; reason?: string } {
  if (fromHeroId === toHeroId) {
    return { ok: false, reason: 'Отправитель и получатель совпадают.' };
  }
  const activeIds = campaign.activePartyHeroIds ?? [campaign.avatarId];
  if (!activeIds.includes(fromHeroId) || !activeIds.includes(toHeroId)) {
    return {
      ok: false,
      reason: 'Удалённый обмен экипировкой разрешён только между героями активной группы (§277 #3).',
    };
  }
  const fromHero = campaign.heroes[fromHeroId];
  const toHero = campaign.heroes[toHeroId];
  if (!fromHero || !toHero) {
    return { ok: false, reason: 'Герой не найден.' };
  }
  const instId = fromHero.equipment[fromSlot];
  if (!instId) {
    return { ok: false, reason: `В слоте ${fromSlot} у отправителя нет предмета.` };
  }
  const inst = campaign.itemsByInstanceId[instId];
  const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : undefined;
  if (!inst || !def) {
    return { ok: false, reason: 'Экземпляр предмета повреждён или не найден.' };
  }

  const targetSlot = toSlot ?? (def.allowedSlots.includes(fromSlot) ? fromSlot : def.allowedSlots[0]);
  if (!targetSlot) {
    return { ok: false, reason: 'У предмета нет допустимого слота экипировки.' };
  }

  // Шаг 1: временно переносим предмет в общий PartyInventory
  const unequip = unequipSlotToPartyInventory(campaign, fromHeroId, fromSlot);
  if (!unequip.ok) {
    return { ok: false, reason: unequip.reason };
  }

  // Шаг 2: пытаемся экипировать получателю (проверяя все требования без self-bonus)
  const equip = equipItemFromPartyInventory(campaign, toHeroId, instId, targetSlot);
  if (!equip.ok) {
    // Атомарный откат: возвращаем предмет отправителю в исходный слот
    equipItemFromPartyInventory(campaign, fromHeroId, instId, fromSlot);
    return {
      ok: false,
      reason: `Передача отменена (откат выполнен): ${equip.reason}`,
    };
  }

  return { ok: true, instanceId: instId };
}




