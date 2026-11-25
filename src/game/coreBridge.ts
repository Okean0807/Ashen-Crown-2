/**
 * ASHEN CROWN — Мост интеграции доменного ядра `src/core/*` в живую изометрическую сцену `src/game/*`
 * (Phase 11 — Playable Vertical Slice поверх немодифицированного `src/core/*`).
 *
 * Принципы:
 * - Не переписывает и не изменяет утверждённые правила `src/core/*` (v14.2).
 * - Выступает единым авторитетным источником для характеристик Аватара, экипировки и PartyInventory (§§1.5, 33, 331, 347),
 *   магии и MagicStrain (§§38–43), боевого конвейера с попаданием/блоком/сопротивлениями (§237),
 *   смерти/возрождения 120с у Stone of Souls (§288), некромантии (§§3.1, 105, 107),
 *   взаимодействия с объектами мира (§316), окна добычи (§128), команд поля (§292) и сохранений v3 с FNV-1a (§341.8).
 */

import { PROTOTYPE_ITEMS, PROTOTYPE_SPELLS } from '../core/catalog';
import {
  advanceAvatarRespawnTimer,
  computeRawPhysicalDamage,
  computeSpellManaCost,
  reraiseDormantMinions,
  resolveCombatPackets,
  startSpellCast,
  tickMagicStrainDecay,
  tickNecromancyMinions,
  triggerAvatarDeath,
} from '../core/combatAndMagic';
import {
  APPROVED_CONSTANTS,
  DEFAULT_WORKING_ASSUMPTIONS,
  GAME_BUILD_VERSION,
} from '../core/config';
import {
  assignControlGroup,
  canUseFormationButton,
  createFogOfWarGrid,
  createInitialFieldSelectionState,
  recallControlGroup,
  updateFieldSelection,
  updateFogOfWarVisibility,
  type ControlGroupSlot,
} from '../core/fieldCommands';
import {
  copperToDenominations,
  createSaveSnapshot,
  equipItemFromPartyInventory,
  isCombatConsumableAllowed,
  pickupItemToPartyInventory,
  previewHeroEquipmentChange,
  transcribeSpellScrollToGrimoire,
  unequipSlotToPartyInventory,
  validateAndLoadSnapshot,
} from '../core/inventoryAndSave';
import {
  interactWithWorldObject,
  openLootContainer,
  takeAllLootEntries,
  takeSingleLootEntry,
} from '../core/missionAndWorld';
import {
  computeDerivedHeroStats,
  grantHeroExperience,
  learnOrUpgradeSpell,
} from '../core/progression';
import {
  createInitialVerticalSliceSandbox,
  type VerticalSliceSandbox,
} from '../core/sandboxFactory';
import { canCreateSaveInContext } from '../core/saveManager';
import { applyHealingPacket, setSquadFormation } from '../core/squadsAndEffects';
import type {
  CombatMasteryId,
  DamageType,
  EquipSlotId,
  FieldSelectionState,
  FogOfWarGrid,
  FormationType,
  HeroState,
  ItemCategory,
  ItemDefinition,
  LootContainerEntry,
  NecromancyMinion,
} from '../core/types';
import { MAP_SIZE } from './iso';
import type {
  ActiveLootWindowState,
  CombatLogEntry,
  CoreEquippedSlotView,
  CoreInventoryItemView,
  HudV14CoreSummary,
  ResourceKind,
  Tile,
  Unit,
} from './types';

export interface CoreSpellActionResult {
  ok: boolean;
  spellId: string;
  effectPower: number;
  manaSpent: number;
  reasonRu?: string;
}

export interface CoreCombatResolveResult {
  finalDamage: number;
  targetHpAfter: number;
  targetDied: boolean;
  missed: boolean;
  blocked: boolean;
}

const SPECIALIZATION_LABELS_RU: Record<HeroState['specialization'], string> = {
  warrior: 'Воин',
  mage: 'Маг',
  hybrid: 'Гибрид',
};

const BASE_QUICK_SPELL_SLOTS: Array<{ spellId: string; hotkey: string }> = [
  { spellId: 'spell_elem_fire_bolt', hotkey: 'F' },
  { spellId: 'spell_life_mend', hotkey: 'G' },
  { spellId: 'spell_dark_raise_skeleton', hotkey: 'X' },
];

const EXTRA_UNLOCKABLE_SPELLS: Array<{ spellId: string; hotkey: string }> = [
  { spellId: 'spell_elem_frost_nova', hotkey: 'C' },
  { spellId: 'spell_elem_spark', hotkey: 'V' },
];

const EQUIP_SLOT_META: Array<{
  slot: EquipSlotId;
  labelRu: string;
  group: 'weapon' | 'armor' | 'relic';
}> = [
  { slot: 'main_hand', labelRu: 'Правая рука', group: 'weapon' },
  { slot: 'off_hand', labelRu: 'Левая рука', group: 'weapon' },
  { slot: 'armor', labelRu: 'Доспех', group: 'armor' },
  { slot: 'helm', labelRu: 'Шлем', group: 'armor' },
  { slot: 'amulet', labelRu: 'Амулет', group: 'relic' },
  { slot: 'ring_1', labelRu: 'Кольцо I', group: 'relic' },
  { slot: 'ring_2', labelRu: 'Кольцо II', group: 'relic' },
];

export function formatCopperRu(copperTotal: number): string {
  const { gold, silver, copper } = copperToDenominations(copperTotal);
  return `${gold}з ${silver}с ${copper}м`;
}

function formatDefinitionBonusesRu(def: ItemDefinition): string {
  const parts: string[] = [];
  if (def.baseWeaponDamage) {
    parts.push(`Урон ${def.baseWeaponDamage}${def.twoHanded ? ' (двуручн.)' : ''}`);
  }
  if (def.armorBonus) parts.push(`+${def.armorBonus} броня`);
  if (def.shieldBlockValue) parts.push(`блок ${def.shieldBlockValue}`);
  if (def.attributeBonuses) {
    for (const [k, v] of Object.entries(def.attributeBonuses)) {
      if (v) parts.push(`+${v} ${k}`);
    }
  }
  if (def.category === 'spell_scroll' && def.grantsSpellId) {
    const spName = PROTOTYPE_SPELLS[def.grantsSpellId]?.nameRu ?? def.grantsSpellId;
    parts.push(`Переносит формулу: ${spName.replace(/\s*\(прототип\)/g, '')}`);
  }
  if (def.category === 'worker_rune' || def.category === 'hero_rune') {
    parts.push('Активируется в Таблице рун');
  }
  if (def.category === 'building_plan' || def.category === 'unit_plan') {
    parts.push('Активируется в Книге планов');
  }
  if (def.category === 'quest_item') {
    parts.push('Квестовый предмет (защищён)');
  }
  return parts.length > 0 ? parts.join(' · ') : 'Особый предмет';
}

function classifyCategoryGroup(
  cat: ItemCategory
): 'weapon' | 'armor' | 'relic' | 'scroll' | 'special' {
  if (
    cat === 'weapon_1h' ||
    cat === 'weapon_2h' ||
    cat === 'weapon_polearm' ||
    cat === 'weapon_bow' ||
    cat === 'weapon_crossbow' ||
    cat === 'shield'
  ) {
    return 'weapon';
  }
  if (cat === 'armor' || cat === 'helm') return 'armor';
  if (cat === 'jewelry') return 'relic';
  if (cat === 'spell_scroll') return 'scroll';
  return 'special';
}

function classifyDefinitionRarity(def: ItemDefinition): 'common' | 'rare' | 'epic' {
  if (def.basePriceCopper >= 850 || def.category === 'worker_rune' || def.category === 'hero_rune') {
    return 'epic';
  }
  if (def.basePriceCopper >= 400 || def.category === 'spell_scroll') return 'rare';
  return 'common';
}

export class CoreGameBridge {
  public sandbox: VerticalSliceSandbox;
  public fieldSelection: FieldSelectionState;
  public fogGrid: FogOfWarGrid;
  public activeFormation: FormationType = 'compact';
  public activeLootWindow: ActiveLootWindowState | null = null;
  public rendererMode: 'webgl3d' | 'canvas2d' = 'webgl3d';
  public combatLog: CombatLogEntry[] = [];
  private combatLogSeq = 0;
  private deathEventSeq = 0;
  private worldInteractSeq = 0;

  constructor() {
    this.sandbox = createInitialVerticalSliceSandbox();
    this.fieldSelection = createInitialFieldSelectionState();
    this.fogGrid = createFogOfWarGrid(MAP_SIZE, MAP_SIZE);
    this.attachBattlefieldWorldObjects();
  }

  public reset(): void {
    this.sandbox = createInitialVerticalSliceSandbox();
    this.fieldSelection = createInitialFieldSelectionState();
    this.fogGrid = createFogOfWarGrid(MAP_SIZE, MAP_SIZE);
    this.activeFormation = 'compact';
    this.activeLootWindow = null;
    this.combatLog = [];
    this.combatLogSeq = 0;
    this.deathEventSeq = 0;
    this.worldInteractSeq = 0;
    this.attachBattlefieldWorldObjects();
  }

  public pushCombatLog(text: string, kind: CombatLogEntry['kind'] = 'system'): void {
    this.combatLogSeq += 1;
    this.combatLog.unshift({ id: this.combatLogSeq, text, kind });
    if (this.combatLog.length > 12) {
      this.combatLog.length = 12;
    }
  }

  private formatLootEntryLabel(entry: LootContainerEntry): string {
    if (entry.kind === 'copper') {
      return `Монеты (${formatCopperRu(entry.quantity)})`;
    }
    return PROTOTYPE_ITEMS[entry.definitionId ?? '']?.nameRu ?? entry.definitionId ?? 'Предмет';
  }

  /**
   * Регистрация сундуков руин в `activeMap.worldObjects` (§128, §316) без перезаписи уже собранных при загрузке сохранения.
   */
  private attachBattlefieldWorldObjects(): void {
    const objs = (this.sandbox.activeMap.worldObjects ??= {});
    if (!objs.chest_ruin_nw) {
      objs.chest_ruin_nw = {
        objectId: 'chest_ruin_nw',
        kind: 'loot_cache',
        nameRu: 'Сундук северо-западных руин',
        allowedVerbs: ['Loot'],
        consumed: false,
        lootEntries: [
          { entryId: 'nw_coins', kind: 'copper', quantity: 650, taken: false },
          {
            entryId: 'nw_armor',
            kind: 'item',
            definitionId: 'item_armor_brigandine',
            quantity: 1,
            taken: false,
          },
        ],
      };
    }
    if (!objs.chest_ruin_se) {
      objs.chest_ruin_se = {
        objectId: 'chest_ruin_se',
        kind: 'loot_cache',
        nameRu: 'Сундук юго-восточных руин',
        allowedVerbs: ['Loot'],
        consumed: false,
        lootEntries: [
          { entryId: 'se_coins', kind: 'copper', quantity: 850, taken: false },
          {
            entryId: 'se_ring',
            kind: 'item',
            definitionId: 'item_ring_int',
            quantity: 1,
            taken: false,
          },
        ],
      };
    }
    if (!objs.chest_ruin_ne) {
      objs.chest_ruin_ne = {
        objectId: 'chest_ruin_ne',
        kind: 'loot_cache',
        nameRu: 'Сундук северного перевала',
        allowedVerbs: ['Loot'],
        consumed: false,
        lootEntries: [
          { entryId: 'ne_coins', kind: 'copper', quantity: 1100, taken: false },
          {
            entryId: 'ne_scroll',
            kind: 'item',
            definitionId: 'item_scroll_frost_nova',
            quantity: 1,
            taken: false,
          },
        ],
      };
    }
  }

  public getAvatar(): HeroState {
    return this.sandbox.campaign.heroes[this.sandbox.campaign.avatarId];
  }

  public getDerivedAvatarStats() {
    return computeDerivedHeroStats(this.getAvatar(), this.sandbox.campaign.itemsByInstanceId);
  }

  /**
   * Синхронизация числовых статов Аватара из `HeroState` (v14.2) в визуальную сущность `Unit('hero')`.
   */
  public syncAvatarToSceneUnit(heroUnit: Unit | null): void {
    if (!heroUnit) return;
    const avatar = this.getAvatar();
    const derived = this.getDerivedAvatarStats();

    // Базовый физический урон по формуле §33.5 (с учётом активного оружия в main_hand)
    const mainHandId = avatar.equipment.main_hand;
    const mainHandInst = mainHandId ? this.sandbox.campaign.itemsByInstanceId[mainHandId] : null;
    const mainHandDef = mainHandInst ? PROTOTYPE_ITEMS[mainHandInst.definitionId] : null;
    const weaponDmg = mainHandDef?.baseWeaponDamage ?? derived.weaponBaseDamage ?? 14;
    const masteryId: CombatMasteryId = mainHandDef?.twoHanded ? 'two_handed' : 'one_handed';
    const rawPhys = computeRawPhysicalDamage(
      weaponDmg,
      derived.effectiveAttributes.STR,
      avatar.combatMasteries[masteryId]
    );

    heroUnit.maxHp = Math.max(100, Math.round(derived.maxHp));
    if (avatar.deathState.lifecycle === 'Alive') {
      avatar.maxHp = heroUnit.maxHp;
      avatar.hp = Math.min(avatar.maxHp, Math.max(1, avatar.hp));
      heroUnit.hp = avatar.hp;
      heroUnit.deadTimer = 0;
    } else {
      heroUnit.hp = 0;
      heroUnit.deadTimer = avatar.deathState.respawnRemainingSec;
    }

    heroUnit.baseAtk = Math.max(12, Math.round(rawPhys));
    heroUnit.baseArmor = Math.max(2, Math.round(derived.armorFromEquipment * 0.25));
    heroUnit.level = avatar.level;
    heroUnit.xp = avatar.xp;
    heroUnit.xpToNext = avatar.xpToNext;
    heroUnit.mana = Math.round(avatar.mana);
    heroUnit.maxMana = Math.round(derived.maxMana);
  }

  /**
   * Реальная экипировка предмета из PartyInventory через `equipItemFromPartyInventory` (§§1.5, 331.1, 347.2).
   */
  public equipCoreInventoryItem(
    instanceId: string,
    heroUnit: Unit | null
  ): { ok: boolean; itemNameRu?: string; reasonRu?: string } {
    const avatar = this.getAvatar();
    const inst = this.sandbox.campaign.itemsByInstanceId[instanceId];
    if (!inst) return { ok: false, reasonRu: 'Предмет не найден в рюкзаке.' };
    const def = PROTOTYPE_ITEMS[inst.definitionId];
    if (!def || def.allowedSlots.length === 0) {
      return { ok: false, reasonRu: 'Этот предмет нельзя надеть в слот экипировки.' };
    }

    // Если доступны 2 слота (например, ring_1 / ring_2), выбираем первый свободный
    const targetSlot =
      def.allowedSlots.find((s) => avatar.equipment[s] === null) ?? def.allowedSlots[0];
    const res = equipItemFromPartyInventory(
      this.sandbox.campaign,
      avatar.heroId,
      instanceId,
      targetSlot
    );
    if (!res.ok) {
      return { ok: false, reasonRu: res.reason ?? 'Требования предмета не выполнены.' };
    }

    this.syncAvatarToSceneUnit(heroUnit);
    this.pushCombatLog(`Экипировано: ${def.nameRu}`, 'system');
    return { ok: true, itemNameRu: def.nameRu };
  }

  public unequipCoreEquipmentSlot(
    slot: EquipSlotId,
    heroUnit: Unit | null
  ): { ok: boolean; reasonRu?: string } {
    const avatar = this.getAvatar();
    const res = unequipSlotToPartyInventory(this.sandbox.campaign, avatar.heroId, slot);
    if (!res.ok) {
      return { ok: false, reasonRu: res.reason ?? 'Не удалось снять предмет.' };
    }
    this.syncAvatarToSceneUnit(heroUnit);
    return { ok: true };
  }

  /**
   * Перенос формулы со свитка в Гримуар Аватара (§140.4).
   */
  public useCoreSpellScroll(
    instanceId: string,
    heroUnit: Unit | null
  ): { ok: boolean; spellNameRu?: string; reasonRu?: string } {
    const avatar = this.getAvatar();
    const res = transcribeSpellScrollToGrimoire(this.sandbox.campaign, avatar.heroId, instanceId);
    if (!res.ok) {
      return { ok: false, reasonRu: res.reason ?? 'Не удалось изучить свиток.' };
    }
    const spellDef = res.spellId ? PROTOTYPE_SPELLS[res.spellId] : undefined;
    const cleanName = (spellDef?.nameRu ?? res.spellId ?? 'Заклинание').replace(
      /\s*\(прототип\)/g,
      ''
    );
    this.syncAvatarToSceneUnit(heroUnit);
    this.pushCombatLog(`Гримуар пополнен: ${cleanName}`, 'spell');
    return { ok: true, spellNameRu: cleanName };
  }

  /**
   * Добавление трофея в общий `PartyInventory` без дублей InstanceID (§274).
   */
  public addPrototypeLootToPartyInventory(definitionId: string, quantity = 1): void {
    this.worldInteractSeq += 1;
    pickupItemToPartyInventory(
      this.sandbox.campaign,
      definitionId,
      quantity,
      `loot_live_${this.worldInteractSeq}`,
      { config: DEFAULT_WORKING_ASSUMPTIONS }
    );
  }

  /**
   * Взаимодействие с Камнем Душ через канонический `interactWithWorldObject` (§316, §288).
   */
  public interactWithBindstone(actorKind: 'avatar' | 'combat_unit' | 'worker'): {
    ok: boolean;
    messageRu: string;
  } {
    this.worldInteractSeq += 1;
    const res = interactWithWorldObject(
      this.sandbox.campaign,
      this.sandbox.activeMap,
      'stone_sector_a_01',
      'Interact',
      actorKind,
      `evt_live_bindstone_${this.worldInteractSeq}`,
      DEFAULT_WORKING_ASSUMPTIONS
    );
    if (!res.ok) {
      return {
        ok: false,
        messageRu:
          actorKind !== 'avatar'
            ? 'Активировать Камень Душ может только Аватар.'
            : 'Не удалось активировать Камень Душ.',
      };
    }
    this.pushCombatLog('Камень Душ подтверждён как точка возрождения Аватара.', 'system');
    return {
      ok: true,
      messageRu: 'Камень Душ активен — точка возрождения Аватара закреплена.',
    };
  }

  /**
   * Взаимодействие с Порталом сектора через `interactWithWorldObject` (§316, §276.7).
   */
  public interactWithPortal(
    actorKind: 'avatar' | 'combat_unit' | 'worker',
    commanderDefeated: boolean
  ): { ok: boolean; messageRu: string } {
    const avatar = this.getAvatar();
    if (avatar.deathState.lifecycle !== 'Alive') {
      return {
        ok: false,
        messageRu: 'Переход через портал невозможен, пока Аватар не возродился.',
      };
    }
    this.worldInteractSeq += 1;
    const res = interactWithWorldObject(
      this.sandbox.campaign,
      this.sandbox.activeMap,
      'obj_portal_sector_b',
      'Interact',
      actorKind,
      `evt_live_portal_${this.worldInteractSeq}`,
      DEFAULT_WORKING_ASSUMPTIONS
    );
    if (!res.ok) {
      return {
        ok: false,
        messageRu:
          actorKind !== 'avatar'
            ? 'Активировать портал сектора может только Аватар.'
            : 'Портал недоступен в текущем состоянии карты.',
      };
    }

    if (!commanderDefeated) {
      return {
        ok: true,
        messageRu:
          'Портал в следующий сектор запечатан: сперва повергните командира вражеского лагеря.',
      };
    }

    return {
      ok: true,
      messageRu: 'Портал сектора открыт. Переход доступен в окне «Лист героя» (вкладка «Мир»).',
    };
  }

  /**
   * Проверка возможности сохранения в боевом контексте (§341.6).
   */
  public canSaveNow(inCombat: boolean): { allowed: boolean; reasonRu?: string } {
    const res = canCreateSaveInContext(this.sandbox.mission, inCombat);
    return {
      allowed: res.allowed,
      reasonRu: res.allowed
        ? undefined
        : 'Сохранение недоступно во время активного боя — выйдите из сражения.',
    };
  }

  /**
   * Тик симуляции v14.2: время карты, регенерация маны (§33.4), спад MagicStrain (§43.3),
   * содержание нежити (§105) и 120с возрождение у Stone of Souls (§288).
   */
  public tickCoreSimulation(
    dtSec: number,
    heroUnit: Unit | null
  ): {
    avatarRespawned: boolean;
    dormantMinionIds: string[];
  } {
    const avatar = this.getAvatar();
    const map = this.sandbox.activeMap;
    map.simulationTimeSec = Number((map.simulationTimeSec + dtSec).toFixed(3));

    const derived = this.getDerivedAvatarStats();
    avatar.maxHp = Math.round(derived.maxHp);
    avatar.maxMana = Math.round(derived.maxMana);

    let avatarRespawned = false;
    if (avatar.deathState.lifecycle === 'RespawnPending') {
      const res = advanceAvatarRespawnTimer(
        this.sandbox.campaign,
        map,
        dtSec,
        this.sandbox.mission
      );
      avatarRespawned = res.respawned;
    } else {
      // Регенерация маны (§33.4) и плавный спад MagicStrain (§43.3)
      avatar.mana = Math.min(avatar.maxMana, avatar.mana + derived.manaRegenPerSec * dtSec);
      tickMagicStrainDecay(avatar, dtSec, DEFAULT_WORKING_ASSUMPTIONS);
    }

    // Тик некромантии (§105): поддержание маной или общий остаточный резерв
    const necroRes = tickNecromancyMinions(avatar, map, dtSec);

    // Восстановление Rune Power поселения (§144.6)
    const settlement = map.localSettlements.settlement_sector_a;
    if (settlement && !settlement.frozenOnInactiveMap) {
      settlement.runePower = Math.min(
        settlement.maxRunePower,
        settlement.runePower + dtSec * 0.45
      );
    }

    this.syncAvatarToSceneUnit(heroUnit);
    return {
      avatarRespawned,
      dormantMinionIds: necroRes.transitionedToDormant,
    };
  }

  /**
   * Единый боевой конвейер v14.2 (§237 + HitChance §33.6 + ShieldBlock §33.8 + потолок сопротивлений +75% §1.2).
   */
  public computeCombatDamage(params: {
    attackerIsHero: boolean;
    attackerName?: string;
    targetName?: string;
    rawDamage: number;
    damageType: DamageType;
    targetHp: number;
    targetArmor: number;
    targetIsBoss?: boolean;
    targetHasShield?: boolean;
    targetShieldMastery?: number;
    deterministicHit?: boolean;
  }): CoreCombatResolveResult {
    const derived = this.getDerivedAvatarStats();
    const attackerDex = params.attackerIsHero ? derived.effectiveAttributes.DEX : 12;
    const isPhysical = params.damageType === 'physical';
    const hitRollPct = params.deterministicHit ? 0 : Math.random() * 100;
    const blockRollPct = params.deterministicHit ? 99 : Math.random() * 100;

    const log = resolveCombatPackets({
      attackerDex,
      target: {
        id: 'scene_target',
        nameRu: params.targetName ?? (params.targetIsBoss ? 'Командир врага' : 'Боевая цель'),
        hp: params.targetHp,
        maxHp: Math.max(params.targetHp, 100),
        armor: params.targetArmor * 4,
        agi: params.targetIsBoss ? 12 : 10,
        hasShield: Boolean(params.targetHasShield),
        shieldMastery: params.targetShieldMastery ?? (params.targetHasShield ? 10 : 0),
        resistances: params.targetIsBoss ? { fire: 0.25, cold: 0.2, dark: 0.2 } : {},
        isBossOrElite: params.targetIsBoss,
      },
      packets: [
        {
          type: params.damageType,
          rawAmount: params.rawDamage,
          canHitCheck: isPhysical && !params.deterministicHit,
          canBeBlockedByShield: isPhysical && Boolean(params.targetHasShield),
          fromFrontArc: true,
        },
      ],
      hitRollPct,
      blockRollPct,
    });

    const missed = !log.hitSucceeded;
    const blocked = log.blocked;
    const finalDamage = missed ? 0 : Math.max(2, Math.round(log.totalFinalDamage));

    const atkLabel = params.attackerName ?? (params.attackerIsHero ? 'Аватар' : 'Боец');
    const tgtLabel = params.targetName ?? (params.targetIsBoss ? 'Командир врага' : 'цель');
    if (missed) {
      this.pushCombatLog(`${atkLabel} → ${tgtLabel}: промах`, 'miss');
    } else if (blocked) {
      this.pushCombatLog(`${atkLabel} → ${tgtLabel}: блок щитом (-${finalDamage})`, 'block');
    } else if (!isPhysical) {
      this.pushCombatLog(`${atkLabel} → ${tgtLabel}: магия (-${finalDamage})`, 'spell');
    } else {
      this.pushCombatLog(`${atkLabel} → ${tgtLabel}: -${finalDamage} ОЗ`, 'hit');
    }

    return {
      finalDamage,
      targetHpAfter: missed ? Math.round(params.targetHp) : Math.round(log.targetHpAfter),
      targetDied: !missed && log.targetDied,
      missed,
      blocked,
    };
  }

  /**
   * Лечение по контракту v14.2 §42.1 (без оверхил-щита и без воскрешения мёртвых).
   */
  public computeCanonicalHeal(unit: Unit, rawHeal: number): number {
    if (unit.hp <= 0 || (unit.deadTimer && unit.deadTimer > 0)) return 0;
    const res = applyHealingPacket(
      {
        hp: unit.hp,
        maxHp: unit.maxHp,
        alive: true,
      },
      rawHeal
    );
    return Math.round(res.healedAmount);
  }

  /**
   * Применение урона к Аватару с синхронизацией в `HeroState` и запуском `triggerAvatarDeath` (§288: 120с).
   */
  public applyDamageToAvatar(
    heroUnit: Unit,
    damage: number
  ): { died: boolean; xpLost: number; respawnSec: number } {
    const avatar = this.getAvatar();
    if (avatar.deathState.lifecycle !== 'Alive') {
      return {
        died: false,
        xpLost: 0,
        respawnSec: avatar.deathState.respawnRemainingSec,
      };
    }

    avatar.hp = Math.max(0, avatar.hp - damage);
    heroUnit.hp = avatar.hp;

    if (avatar.hp <= 0) {
      this.deathEventSeq += 1;
      const ev = triggerAvatarDeath(
        this.sandbox.campaign,
        this.sandbox.activeMap,
        `evt_live_avatar_death_${this.deathEventSeq}`,
        DEFAULT_WORKING_ASSUMPTIONS
      );
      heroUnit.hp = 0;
      heroUnit.deadTimer = avatar.deathState.respawnRemainingSec;
      this.pushCombatLog('Аватар пал в бою. Возрождение у Камня Душ (120 с).', 'kill');
      return {
        died: true,
        xpLost: ev.xpLost,
        respawnSec: APPROVED_CONSTANTS.AVATAR_RESPAWN_DELAY_SECONDS,
      };
    }

    return { died: false, xpLost: 0, respawnSec: 0 };
  }

  /**
   * Начисление XP Аватару с убывающей отдачей между картами (§1.7) и 3 пулами очков (§26.2).
   */
  public grantAvatarXp(
    enemyVariantId: string,
    baseXp: number,
    heroUnit: Unit | null
  ): { xpAwarded: number; leveledUpTo: number | null } {
    const avatar = this.getAvatar();
    const prevLevel = avatar.level;
    const res = grantHeroExperience(
      this.sandbox.campaign,
      this.sandbox.campaign.avatarId,
      baseXp,
      enemyVariantId,
      DEFAULT_WORKING_ASSUMPTIONS
    );
    this.syncAvatarToSceneUnit(heroUnit);
    return {
      xpAwarded: res.grantedXp,
      leveledUpTo: avatar.level > prevLevel ? avatar.level : null,
    };
  }

  /**
   * Каст заклинания Аватаром через канонический `startSpellCast` (§§38–43).
   * Если заклинание ещё в статусе `ReadyToLearn` и у героя есть очки магии, автоматически изучает его
   * по правилам `learnOrUpgradeSpell` (§2.1.4).
   */
  public castAvatarSpell(spellId: string, heroUnit: Unit | null): CoreSpellActionResult {
    const avatar = this.getAvatar();
    const state = avatar.spells[spellId];
    if (state && state.acquisitionState === 'ReadyToLearn' && avatar.unspent.magicPoints > 0) {
      learnOrUpgradeSpell(this.sandbox.campaign, avatar.heroId, spellId, DEFAULT_WORKING_ASSUMPTIONS);
    }

    const cast = startSpellCast(
      this.sandbox.campaign,
      avatar.heroId,
      spellId,
      DEFAULT_WORKING_ASSUMPTIONS
    );
    if (!cast.ok) {
      return {
        ok: false,
        spellId,
        effectPower: 0,
        manaSpent: 0,
        reasonRu: cast.reason ?? 'Невозможно применить заклинание.',
      };
    }

    this.syncAvatarToSceneUnit(heroUnit);
    return {
      ok: true,
      spellId,
      effectPower: cast.effectPower,
      manaSpent: cast.manaSpent,
    };
  }

  /**
   * Регистрация призванного некромантией скелета в `activeMap.necromancyMinions` (§105, §107).
   */
  public registerRaisedSkeleton(minionId: string): NecromancyMinion {
    const minion: NecromancyMinion = {
      minionId,
      kind: 'skeleton',
      mode: 'Active',
      manaUpkeepPerSec: 1.4,
      residualDrainPerSec: 2.0,
      aiState: 'FollowingLastOrder',
      currentOrder: 'AttackMove',
    };
    this.sandbox.activeMap.necromancyMinions.push(minion);
    return minion;
  }

  public reraiseDormantSkeletons(): number {
    const avatar = this.getAvatar();
    const res = reraiseDormantMinions(avatar, this.sandbox.activeMap, 8);
    return res.raisedCount;
  }

  public removeDestroyedSkeleton(minionId: string): void {
    this.sandbox.activeMap.necromancyMinions = this.sandbox.activeMap.necromancyMinions.filter(
      (m) => m.minionId !== minionId
    );
  }

  /**
   * Синхронизация добычи ресурсов рабочего с локальной экономикой `settlement_sector_a` (§338).
   */
  public recordSettlementDelivery(kind: ResourceKind, amount: number): void {
    const settlement = this.sandbox.activeMap.localSettlements.settlement_sector_a;
    if (!settlement) return;
    if (kind === 'wood') {
      settlement.localResources.wood = (settlement.localResources.wood ?? 0) + amount;
    } else if (kind === 'stone') {
      settlement.localResources.stone = (settlement.localResources.stone ?? 0) + amount;
    } else if (kind === 'gold') {
      settlement.localResources.iron = (settlement.localResources.iron ?? 0) + amount;
      this.sandbox.campaign.localMapWalletCopper += amount * 25;
    }
  }

  public recordSettlementSpend(wood: number, stone: number, goldOrIron: number): void {
    const settlement = this.sandbox.activeMap.localSettlements.settlement_sector_a;
    if (!settlement) return;
    settlement.localResources.wood = Math.max(0, (settlement.localResources.wood ?? 0) - wood);
    settlement.localResources.stone = Math.max(0, (settlement.localResources.stone ?? 0) - stone);
    settlement.localResources.iron = Math.max(0, (settlement.localResources.iron ?? 0) - goldOrIron);
  }

  /**
   * Проверка запрета боевых зелий HP/Mana (§140.1, §242).
   */
  public isCombatPotionBlocked(itemKind: 'hp_potion' | 'mana_potion'): boolean {
    return !isCombatConsumableAllowed(itemKind).allowed;
  }

  /**
   * Открытие окна добычи контейнера (§128) с выборочным подбором и «Взять всё».
   */
  public openChestLootWindow(tile: Tile): ActiveLootWindowState | null {
    if (!tile.chestObjectId || tile.chestLooted) return null;
    const opened = openLootContainer(this.sandbox.activeMap, tile.chestObjectId);
    if (!opened.ok) return null;

    this.activeLootWindow = {
      objectId: tile.chestObjectId,
      tileGx: tile.gx,
      tileGy: tile.gy,
      titleRu: opened.containerNameRu ?? 'Контейнер добычи',
      entries: opened.entries.map((e) => ({
        entryId: e.entryId,
        kind: e.kind,
        labelRu: this.formatLootEntryLabel(e),
        amount: e.quantity,
        taken: e.taken,
      })),
    };
    return this.activeLootWindow;
  }

  public takeChestEntry(
    entryId: string,
    tiles: Tile[][]
  ): { ok: boolean; allTaken: boolean; copperGained: number; takenItemLabel?: string } {
    if (!this.activeLootWindow) return { ok: false, allTaken: false, copperGained: 0 };
    const win = this.activeLootWindow;
    const entryBefore = win.entries.find((e) => e.entryId === entryId);
    const res = takeSingleLootEntry(
      this.sandbox.campaign,
      this.sandbox.activeMap,
      win.objectId,
      entryId
    );
    if (!res.ok) return { ok: false, allTaken: false, copperGained: 0 };

    if (entryBefore?.kind === 'item') {
      this.pushCombatLog(`Получен предмет: ${entryBefore.labelRu}`, 'system');
    }

    const refreshed = openLootContainer(this.sandbox.activeMap, win.objectId);
    const remaining = refreshed.entries.filter((e) => !e.taken);
    if (remaining.length === 0) {
      const t = tiles[win.tileGy]?.[win.tileGx];
      if (t) t.chestLooted = true;
      this.activeLootWindow = null;
      return {
        ok: true,
        allTaken: true,
        copperGained: entryBefore?.kind === 'copper' ? entryBefore.amount : 0,
        takenItemLabel: entryBefore?.kind === 'item' ? entryBefore.labelRu : undefined,
      };
    }

    win.entries = refreshed.entries.map((e) => ({
      entryId: e.entryId,
      kind: e.kind,
      labelRu: this.formatLootEntryLabel(e),
      amount: e.quantity,
      taken: e.taken,
    }));
    return {
      ok: true,
      allTaken: false,
      copperGained: entryBefore?.kind === 'copper' ? entryBefore.amount : 0,
      takenItemLabel: entryBefore?.kind === 'item' ? entryBefore.labelRu : undefined,
    };
  }

  public takeAllChestEntries(
    tiles: Tile[][]
  ): { ok: boolean; copperGained: number; takenCount: number } {
    if (!this.activeLootWindow) return { ok: false, copperGained: 0, takenCount: 0 };
    const win = this.activeLootWindow;
    const copperBefore = this.sandbox.campaign.localMapWalletCopper;
    const res = takeAllLootEntries(
      this.sandbox.campaign,
      this.sandbox.activeMap,
      win.objectId
    );
    const t = tiles[win.tileGy]?.[win.tileGx];
    if (t && res.ok) t.chestLooted = true;
    this.activeLootWindow = null;
    if (res.ok && res.takenCount > 0) {
      this.pushCombatLog(`Собрано трофеев из сундука: ${res.takenCount}`, 'system');
    }
    return {
      ok: res.ok,
      copperGained: Math.max(0, this.sandbox.campaign.localMapWalletCopper - copperBefore),
      takenCount: res.takenCount,
    };
  }

  /**
   * Синхронизация выделения и 6 групп быстрого выбора (`§292.6–292.7`, `§292.10`).
   */
  public syncSelection(selectedIds: Set<string>, aliveHumanIds: Set<string>): void {
    updateFieldSelection(
      this.fieldSelection,
      Array.from(selectedIds),
      'replace',
      aliveHumanIds,
      DEFAULT_WORKING_ASSUMPTIONS
    );
  }

  public assignGroup(
    slot: ControlGroupSlot,
    selectedIds: Set<string>,
    aliveHumanIds: Set<string>
  ): number {
    this.syncSelection(selectedIds, aliveHumanIds);
    return assignControlGroup(this.fieldSelection, slot, aliveHumanIds).count;
  }

  public recallGroup(slot: ControlGroupSlot, aliveHumanIds: Set<string>): string[] {
    const res = recallControlGroup(this.fieldSelection, slot, aliveHumanIds);
    return res.selectedIds;
  }

  public trySetFormation(
    formation: FormationType,
    selectedIds: string[],
    heroUnitId: string
  ): { ok: boolean; reasonRu?: string } {
    const check = canUseFormationButton(selectedIds, heroUnitId);
    if (!check.allowed) {
      return { ok: false, reasonRu: check.reasonRu };
    }
    this.activeFormation = formation;
    const alpha = this.sandbox.activeMap.squadRoster?.squad_alpha;
    if (alpha) {
      setSquadFormation(alpha, formation);
    }
    return { ok: true };
  }

  /**
   * Синхронизация 3-состоянийного тумана войны (§292.9) через `FogOfWarGrid`.
   */
  public syncFogOfWar(
    observers: Array<{ x: number; y: number; visionRadius: number }>,
    tiles: Tile[][]
  ): { exploredCount: number; orcCampSeen: boolean } {
    const res = updateFogOfWarVisibility(this.fogGrid, observers);
    let orcCampSeen = false;
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const state = this.fogGrid.tiles[y * MAP_SIZE + x];
        const tile = tiles[y][x];
        tile.fog = state === 'Visible' ? 2 : state === 'ExploredShrouded' ? 1 : 0;
        if (tile.fog === 2 && tile.regionTag === 'orc_camp') {
          orcCampSeen = true;
        }
      }
    }
    return { exploredCount: res.exploredCount, orcCampSeen };
  }

  /**
   * Версионированный снимок сохранения `v3` с контрольной суммой FNV-1a (§341.8).
   */
  public exportCoreSnapshotJson(): string {
    const snap = createSaveSnapshot(
      this.sandbox.campaign,
      this.sandbox.mission,
      this.sandbox.activeMap,
      this.sandbox.eventJournal
    );
    return JSON.stringify(snap);
  }

  public importCoreSnapshotJson(rawJson: string): boolean {
    const res = validateAndLoadSnapshot(rawJson);
    if (!res.ok || !res.snapshot) return false;
    this.sandbox = {
      campaign: res.snapshot.campaign,
      mission: res.snapshot.mission,
      activeMap: res.snapshot.activeMap,
      eventJournal: res.snapshot.eventJournal,
    };
    this.attachBattlefieldWorldObjects();
    return true;
  }

  private buildCoreEquipmentViews(): CoreEquippedSlotView[] {
    const avatar = this.getAvatar();
    const items = this.sandbox.campaign.itemsByInstanceId;
    return EQUIP_SLOT_META.map((meta) => {
      const instId = avatar.equipment[meta.slot];
      const inst = instId ? items[instId] : null;
      const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : null;
      return {
        slot: meta.slot,
        labelRu: meta.labelRu,
        group: meta.group,
        instanceId: instId,
        definitionId: def?.definitionId ?? null,
        nameRu: def?.nameRu ?? null,
        bonusesRu: def ? formatDefinitionBonusesRu(def) : '',
        category: def?.category ?? null,
        rarity: def ? classifyDefinitionRarity(def) : 'common',
      };
    });
  }

  private buildCorePartyInventoryViews(): CoreInventoryItemView[] {
    const avatar = this.getAvatar();
    const list: CoreInventoryItemView[] = [];
    for (const inst of Object.values(this.sandbox.campaign.itemsByInstanceId)) {
      if (inst.location.kind !== 'party_inventory') continue;
      const def = PROTOTYPE_ITEMS[inst.definitionId];
      if (!def) continue;
      const targetSlot =
        def.allowedSlots.length > 0
          ? def.allowedSlots.find((s) => avatar.equipment[s] === null) ?? def.allowedSlots[0]
          : null;
      const preview = targetSlot
        ? previewHeroEquipmentChange(this.sandbox.campaign, avatar.heroId, inst.instanceId, targetSlot)
        : null;
      list.push({
        instanceId: inst.instanceId,
        definitionId: def.definitionId,
        nameRu: def.nameRu,
        category: def.category,
        group: classifyCategoryGroup(def.category),
        quantity: inst.quantity,
        targetSlot,
        canEquip: Boolean(preview?.canEquip),
        unmetReasonsRu: preview?.unmetReasonsRu ?? [],
        isScroll: def.category === 'spell_scroll',
        isQuestProtected: Boolean(inst.isQuestProtected || def.category === 'quest_item'),
        bonusesRu: formatDefinitionBonusesRu(def),
        rarity: classifyDefinitionRarity(def),
      });
    }
    return list;
  }

  public buildHudSummary(
    selectedUnitIds: string[],
    heroUnitId: string,
    opts: { inCombat?: boolean; hasManualSave?: boolean; hasAutoSave?: boolean } = {}
  ): HudV14CoreSummary {
    const avatar = this.getAvatar();
    const derived = this.getDerivedAvatarStats();
    const settlement = this.sandbox.activeMap.localSettlements.settlement_sector_a;
    const formCheck = canUseFormationButton(selectedUnitIds, heroUnitId);

    const activeMinions = this.sandbox.activeMap.necromancyMinions.filter(
      (m) => !m.isDestroyed && (m.mode === 'Active' || m.mode === 'Residual_Autonomy')
    ).length;
    const dormantMinions = this.sandbox.activeMap.necromancyMinions.filter(
      (m) => !m.isDestroyed && m.mode === 'Dormant_NoMana'
    ).length;

    const spellSlots = [...BASE_QUICK_SPELL_SLOTS];
    for (const extra of EXTRA_UNLOCKABLE_SPELLS) {
      const st = avatar.spells[extra.spellId];
      if (st && (st.acquisitionState === 'Learned' || st.acquisitionState === 'ReadyToLearn')) {
        spellSlots.push(extra);
      }
    }

    const spells = spellSlots.map(({ spellId, hotkey }) => {
      const def = PROTOTYPE_SPELLS[spellId];
      const st = avatar.spells[spellId];
      const learned = st?.acquisitionState === 'Learned';
      const canAutoLearn = st?.acquisitionState === 'ReadyToLearn' && avatar.unspent.magicPoints > 0;
      const manaCost = computeSpellManaCost(avatar, spellId);
      const cleanName = (def?.nameRu ?? spellId).replace(/\s*\(прототип\)/g, '');
      return {
        spellId,
        nameRu: cleanName,
        hotkey,
        manaCost,
        learned,
        canCast:
          avatar.deathState.lifecycle === 'Alive' &&
          (learned || canAutoLearn) &&
          avatar.mana >= manaCost,
        school: def?.school ?? 'elemental',
      };
    });

    const cg = this.fieldSelection.controlGroups;
    const bindstoneObj = this.sandbox.activeMap.worldObjects?.stone_sector_a_01;

    return {
      buildVersion: GAME_BUILD_VERSION,
      heroMana: Math.floor(avatar.mana),
      heroMaxMana: Math.round(derived.maxMana),
      manaRegenPerSec: Number(derived.manaRegenPerSec.toFixed(1)),
      magicStrainIndex: Math.round(avatar.magicStrain.index),
      magicStrainStatus: avatar.magicStrain.status,
      specializationRu: SPECIALIZATION_LABELS_RU[avatar.specialization] ?? 'Гибрид',
      unspentTotal:
        avatar.unspent.attributePoints +
        avatar.unspent.combatMasteryPoints +
        avatar.unspent.magicPoints,
      currencyTextRu: formatCopperRu(this.sandbox.campaign.localMapWalletCopper),
      settlementIron: Math.floor(settlement?.localResources.iron ?? 0),
      settlementFood: Math.floor(settlement?.localResources.food ?? 0),
      settlementRunePower: Math.floor(settlement?.runePower ?? 0),
      activeMinionsCount: activeMinions,
      dormantMinionsCount: dormantMinions,
      residualAutonomyPool: Math.round(this.sandbox.activeMap.necromancyAutonomy.remainingPool),
      canUseFormation: formCheck.allowed,
      formationReasonRu: formCheck.reasonRu,
      activeFormation: this.activeFormation,
      controlGroupCounts: {
        1: cg[1].length,
        2: cg[2].length,
        3: cg[3].length,
        4: cg[4].length,
        5: cg[5].length,
        6: cg[6].length,
      },
      spells,
      activeLootWindow: this.activeLootWindow
        ? {
            ...this.activeLootWindow,
            entries: this.activeLootWindow.entries.map((e) => ({ ...e })),
          }
        : null,
      avatarRespawnSec: Math.ceil(avatar.deathState.respawnRemainingSec),
      rendererMode: this.rendererMode,
      coreEquipment: this.buildCoreEquipmentViews(),
      corePartyInventory: this.buildCorePartyInventoryViews(),
      combatLog: [...this.combatLog],
      inCombat: Boolean(opts.inCombat),
      bindstoneActive: Boolean(bindstoneObj?.activated),
      hasManualSave: Boolean(opts.hasManualSave),
      hasAutoSave: Boolean(opts.hasAutoSave),
    };
  }
}
