/**
 * ASHEN CROWN — Канонические доменные контракты данных (v14.2).
 *
 * Строго соблюдает разделение слоёв:
 * - Campaign -> Mission -> MapInstance (§341.1, §346.2)
 * - CreatureDefinition / Variant / UnitInstance / SquadInstance / NamedCharacter (§343.2)
 * - ItemDefinition / ItemInstance / PartyInventory / HeroEquipment / CampaignStorage (§331, §347.2)
 * - PlayerOrder vs LocalReaction (§337.2, §343.6)
 * - Quest 6-state machine (§303.2) & idempotent SaveSnapshot + EventJournal (§341.6–341.8)
 */

export type AttributeId = 'STR' | 'STA' | 'DEX' | 'AGI' | 'INT' | 'WIS' | 'CHA';

export type CombatMasteryId =
  | 'one_handed'
  | 'two_handed'
  | 'polearms'
  | 'bows'
  | 'crossbows'
  | 'shields';

export type MagicSchoolId = 'elemental' | 'dark' | 'life' | 'mind' | 'light' | 'spatial';

export type ElementalSubBranchId = 'fire' | 'cold' | 'lightning' | 'earth';

export type DarkBranchId =
  | 'necromancy'
  | 'demonology'
  | 'blood_magic'
  | 'shadow_magic'
  | 'curse_magic'
  | 'void_magic';

export type PlayableRaceId = 'humans' | 'elves' | 'dwarves' | 'orcs' | 'trolls' | 'dark_elves';

export type RaceResourceType = 'wood' | 'stone' | 'iron' | 'aria' | 'lenya' | 'moonsilver' | 'food';

export interface RaceResourceCapability {
  resource: RaceResourceType;
  /** §339.2 / §352.4: Использует ли раса ресурс в экономике/войсках. */
  used: boolean;
  /** Может ли добываться локально на карте (даже с пониженной эффективностью). */
  gatheredLocally: boolean;
  /** Есть ли собственное стандартное эффективное здание добычи (для Elves/Trolls по Iron = false). */
  hasEfficientOwnExtraction: boolean;
  /** Может ли поступать через импорт/поставку/торговлю. */
  imported: boolean;
  /** Участвует ли в переработке (например переработка трупов в Food у Trolls). */
  processed: boolean;
  noteRu: string;
}

export interface RaceResourceProfile {
  raceId: PlayableRaceId;
  nameRu: string;
  /** Принадлежность из §322–327; политическое объяснение отложено (AC-OWNER-004). */
  group: 'Light' | 'Dark';
  resourcesUsed: RaceResourceType[];
  ironExtractionNote: string;
  /** §339.2–339.5, §352.4: Разделение использования, локальной добычи, импорта и переработки. */
  resourceCapabilities: Record<RaceResourceType, RaceResourceCapability>;
  /** §339.4–339.5: Базовая роль персонала расы (Dark Elves -> SlaveWorker). */
  defaultWorkerRole: WorkerRole;
}

export type SpecializationProfile = 'warrior' | 'mage' | 'hybrid';

export type FormulaAcquisitionState =
  | 'Unknown'
  | 'KnownUnavailable'
  | 'ReadyToLearn'
  | 'Learned';

export interface SpellDefinition {
  spellId: string;
  nameRu: string;
  school: MagicSchoolId;
  elementalSubBranch?: ElementalSubBranchId;
  darkBranch?: DarkBranchId;
  effectType: 'damage' | 'heal' | 'buff' | 'debuff' | 'control' | 'summon' | 'utility';
  damageType?: DamageType;
  baseManaCost: number;
  /** Для некоторых заклинаний Кровавой магии (§73.3, AC-AUD-007). */
  bloodHpCost?: number;
  baseCastTimeSec: number;
  range: number;
  radius: number;
  basePower: number;
  scalingAttribute: AttributeId | null;
  requiredSchoolMastery: number;
  minAttributeReq?: Partial<Record<AttributeId, number>>;
  maxRank: number;
  castStabilityThreshold: number;
  magicStrainContribution: number;
  autoCastEligible: boolean;
  autoCastDefault: boolean;
  counterplayNote: string;
  /** §§2.1.4, 2.1.7–2.1.8: Разделение базовых (без порога школы и лимита) и зависимых узлов дерева. */
  tier?: 'basic' | 'advanced';
  prerequisiteSpellIds?: string[];
}

export interface HeroSpellState {
  spellId: string;
  acquisitionState: FormulaAcquisitionState;
  rank: number; // 0 если ещё не изучено, 1..maxRank после изучения
}

export interface MagicStrainState {
  /** Текущий индекс нагрузки (§43.2). Не является отдельной расходуемой валютой. */
  index: number;
  /** Полный сброс при переходе на следующую карту (§43.4 APPROVED). */
  status: 'normal' | 'elevated' | 'critical';
}

export interface UnspentPointsPools {
  /** Три строго независимых, неконвертируемых баланса (§26.1). */
  attributePoints: number;
  combatMasteryPoints: number;
  magicPoints: number;
}

export type EquipSlotId =
  | 'main_hand'
  | 'off_hand'
  | 'armor'
  | 'helm'
  | 'ring_1'
  | 'ring_2'
  | 'amulet';

export type ItemCategory =
  | 'weapon_1h'
  | 'weapon_2h'
  | 'weapon_polearm'
  | 'weapon_bow'
  | 'weapon_crossbow'
  | 'shield'
  | 'armor'
  | 'helm'
  | 'jewelry'
  | 'spell_scroll'
  | 'worker_rune'
  | 'hero_rune'
  | 'building_plan'
  | 'unit_plan'
  | 'quest_item'
  | 'material';

export interface ItemDefinition {
  definitionId: string;
  nameRu: string;
  category: ItemCategory;
  allowedSlots: EquipSlotId[];
  twoHanded?: boolean;
  stackable: boolean;
  basePriceCopper: number;
  baseWeaponDamage?: number;
  armorBonus?: number;
  shieldBlockValue?: number;
  attributeBonuses?: Partial<Record<AttributeId, number>>;
  requirements?: {
    level?: number;
    attributes?: Partial<Record<AttributeId, number>>;
    masteries?: Partial<Record<CombatMasteryId, number>>;
  };
  grantsSpellId?: string;
  /** §144: Метаданные для Worker Rune и Hero Rune (не смешиваются с обычными предметами/планами). */
  runeKind?: 'worker' | 'hero';
  runeRaceId?: PlayableRaceId;
  runeHeroId?: string;
  runeHeroNameRu?: string;
  runeLevel?: number;
  /** §146: Привязка свитка плана к определению в Plan Book. */
  planId?: string;
  /** §140.1: по умолчанию в игре нет универсальных боевых зелий HP/Mana. */
  note?: string;
}

export type ItemLocation =
  | { kind: 'party_inventory' }
  | { kind: 'campaign_storage' }
  | { kind: 'equipped'; heroId: string; slot: EquipSlotId }
  | { kind: 'rune_tablet'; slotIndex: number }
  | { kind: 'merchant'; merchantId: string };

export interface ItemInstance {
  instanceId: string;
  definitionId: string;
  quantity: number;
  location: ItemLocation;
  isQuestProtected?: boolean;
}

export interface RuneTabletSlot {
  slotIndex: number;
  runeInstanceId: string | null;
}

export interface RuneTabletState {
  slots: RuneTabletSlot[];
}

export type PlanType = 'building' | 'unit';

export interface PlanDefinition {
  planId: string;
  raceId: PlayableRaceId;
  planType: PlanType;
  targetId: string;
  displayNameRu: string;
  descriptionRu: string;
  requiredPlanIds?: string[];
  requiredBuildingCategories?: SettlementBuildingCategory[];
  requiredResources?: Partial<Record<RaceResourceType, number>>;
  requiredMilitarySlots?: number;
  requiresMonument?: boolean;
}

export interface PlayerPlanState {
  planId: string;
  status: 'uncollected' | 'collected_unactivated' | 'activated';
  activatedAtIso?: string;
}

export interface EquipmentPreviewResult {
  canEquip: boolean;
  unmetReasonsRu: string[];
  slotConflicts: Array<{ slot: EquipSlotId; replacedItemNameRu: string }>;
  statDelta: {
    maxHp: number;
    maxMana: number;
    armor: number;
    weaponBaseDamage: number;
    attributes: Partial<Record<AttributeId, number>>;
  };
}

export interface HeroEquipmentState {
  main_hand: string | null; // instanceId
  off_hand: string | null;
  armor: string | null;
  helm: string | null;
  ring_1: string | null;
  ring_2: string | null;
  amulet: string | null;
}

export type AvatarDeathLifecycle = 'Alive' | 'Dead' | 'RespawnPending' | 'Respawning';

export interface HeroState {
  heroId: string;
  isAvatar: boolean;
  nameRu: string;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  /** Постоянные базовые атрибуты (исключая временные бонусы экипировки). */
  baseAttributes: Record<AttributeId, number>;
  combatMasteries: Record<CombatMasteryId, number>;
  schoolMasteries: Record<MagicSchoolId, number>;
  darkBranchMasteries: Record<DarkBranchId, number>;
  spells: Record<string, HeroSpellState>;
  unspent: UnspentPointsPools;
  /** Вложение в дисциплины — для отслеживания без 4-й расходуемой валюты (§28.3, §337.1). */
  investedHistory: {
    attributePointsSpent: number;
    combatPointsSpent: number;
    magicPointsSpent: number;
  };
  /** Окно перераспределения до перехода на следующую карту (§1.12, §26.6). */
  respecWindowOpen: boolean;
  hasUnspentLevelNotification: boolean;
  specialization: SpecializationProfile;
  equipment: HeroEquipmentState;
  magicStrain: MagicStrainState;
  deathState: {
    lifecycle: AvatarDeathLifecycle;
    respawnRemainingSec: number;
    activeStoneOfSoulsId: string | null;
  };
  /** Постоянные сопротивления [-1.0, +0.75] (§41.2). */
  resistances: Partial<Record<DamageType, number>>;
  /** §40.3–40.4: Активный незавершённый каст для проверки прерывания уроном без возврата маны. */
  activeCast?: ActiveCastState | null;
  /** §2.1.6: Дробный прогресс общего уровня школы от изучения отдельных заклинаний. */
  schoolProgressBySchool?: Partial<Record<MagicSchoolId, number>>;
  /** §3.1: Кости, добытые с умерших существ для создания костяных воинов. */
  bonesCount?: number;
}

export type DamageType =
  | 'physical'
  | 'fire'
  | 'cold'
  | 'lightning'
  | 'earth'
  | 'dark'
  | 'mind'
  | 'light'
  | 'spatial'
  | 'life';

export interface DamagePacket {
  type: DamageType;
  rawAmount: number;
  canHitCheck: boolean;
  canBeBlockedByShield: boolean;
  fromFrontArc: boolean;
  armorPenetration?: number;
}

export interface CombatTargetSnapshot {
  id: string;
  nameRu: string;
  hp: number;
  maxHp: number;
  agi: number;
  armor: number;
  hasShield: boolean;
  shieldMastery: number;
  resistances: Partial<Record<DamageType, number>>;
  isCasting?: boolean;
  castStabilityThreshold?: number;
  /** Охраняемая пометка §1.2: абсолютный иммунитет к магии не допускается. */
  isBossOrElite?: boolean;
}

export interface CombatResolutionLog {
  hitRolled: number;
  hitChancePct: number;
  hitSucceeded: boolean;
  blocked: boolean;
  blockChancePct: number;
  packetBreakdown: Array<{
    type: DamageType;
    raw: number;
    afterArmor: number;
    afterResistance: number;
  }>;
  totalFinalDamage: number;
  targetHpAfter: number;
  targetDied: boolean;
  castInterrupted: boolean;
}

export type NecromancyMinionMode = 'Active' | 'Dormant_NoMana' | 'Residual_Autonomy';

/** §107.7: Детерминированные состояния ИИ автономной нежити после смерти некроманта. */
export type UndeadAutonomyAIState =
  | 'FollowingLastOrder'
  | 'DefendingSelf'
  | 'DefendingAlly'
  | 'ReturningToOrderArea'
  | 'Inactive'
  | 'Destroyed';

export interface NecromancyMinion {
  minionId: string;
  kind: 'skeleton' | 'bone_warrior' | 'ghoul';
  mode: NecromancyMinionMode;
  residualDrainPerSec: number; // C_i в §105.3
  manaUpkeepPerSec: number;
  /** Правило §3.1: Костяной воин из костей растёт в 5 характеристиках и возвращает XP при гибели. */
  boneWarriorStats?: {
    accumulatedXp: number;
    hpBonus: number;
    physicalDamageBonus: number;
    defenseBonus: number;
    moveSpeedBonus: number;
    attackSpeedBonus: number;
  };
  currentOrder: PlayerOrderType;
  /** §107: Состояние автомата автономного поведения и параметры последнего приказа. */
  aiState?: UndeadAutonomyAIState;
  orderTargetEntityId?: string;
  orderTargetPos?: { x: number; y: number };
  isDestroyed?: boolean;
}

export interface NecromancyAutonomyPool {
  active: boolean;
  /** R_0 — стартовый резерв в момент гибели некроманта (§105.3). Не обновляется при повторной смерти. */
  initialPool: number;
  remainingPool: number;
  triggeredAtTimeSec: number | null;
}

export type PlayerOrderType =
  | 'Idle'
  | 'MoveTo'
  | 'AttackMove'
  | 'Patrol'
  | 'Follow'
  | 'AttackTarget'
  | 'HoldPosition'
  | 'Retreat';

export type LocalReactionType = 'None' | 'SelfDefense' | 'ProtectAssignedTarget';

export interface SquadCommandLayer {
  squadId: string;
  playerOrder: PlayerOrderType;
  orderTargetPos?: { x: number; y: number };
  orderTargetEntityId?: string;
  /** §292.8: Последовательность путевых отметок (Shift) или маршрут патрулирования (Alt). */
  waypointQueue?: Array<{ x: number; y: number }>;
  isPatrolLoop?: boolean;
  localReaction: LocalReactionType;
  reactionTargetEntityId?: string;
  reactionOriginPos?: { x: number; y: number };
  statusReason?: string;
}

export type QuestClass = 'Main' | 'Side';

export type QuestStatus =
  | 'Unavailable'
  | 'Available'
  | 'Active'
  | 'Completed'
  | 'Failed'
  | 'Closed';

export interface QuestStage {
  stageId: string;
  titleRu: string;
  descriptionRu: string;
  completed: boolean;
}

export interface QuestRecord {
  questId: string;
  questClass: QuestClass;
  titleRu: string;
  summaryRu: string;
  fullDescriptionRu: string;
  loreJournalNotesRu: string[];
  status: QuestStatus;
  stages: QuestStage[];
  prerequisiteQuestIds: string[];
  rewardId?: string;
  rewardCopper?: number;
  rewardXp?: number;
  rewardItemDefinitionId?: string;
}

export type MapLifecycleState =
  | 'UNLOADED'
  | 'LOADING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'RESOLVING'
  | 'SAVING'
  | 'UNLOADING'
  | 'FAILED';

export type ResourceStage = 'AtSource' | 'Carried' | 'Delivered' | 'Consumed';

export type WorkerRole = 'GeneralWorker' | 'Gatherer' | 'BuildingOperator' | 'SlaveWorker';

export type SettlementStopReason =
  | 'source_depleted'
  | 'route_blocked'
  | 'no_free_worker'
  | 'missing_building'
  | 'insufficient_input'
  | 'cap_reached'
  | 'insufficient_rune_power'
  | 'building_damaged'
  | 'paused';

export interface ResourceDepositNode {
  depositId: string;
  resourceType: RaceResourceType;
  remainingAmount: number;
  routeAccessible: boolean;
  /** §339.2: Разделение использования и локальной добычи (например Эльфы/Тролли и Iron). */
  extractionEfficiency: number; // 1.0 стандарт, < 1.0 неэффективная/ограниченная добыча
}

export interface WorkerAgent {
  workerId: string;
  role: WorkerRole;
  assignedDepositId: string | null;
  /** §338.2–338.3: Груз на руках до доставки; сохраняется при переназначении! */
  carrying: {
    resourceType: RaceResourceType;
    amount: number;
    stage: 'Carried';
    sourceDepositId: string;
  } | null;
}

export interface ProductionOrderEntry {
  orderId: string;
  squadDefId: string;
  remainingTimeSec: number;
  totalTimeSec: number;
  requiresRunePower: number;
  pausedReason: SettlementStopReason | null;
}

export type SettlementBuildingCategory =
  | 'headquarters'
  | 'resource_storage'
  | 'barracks'
  | 'workshop'
  | 'defense'
  | 'magic_research'
  | 'food_store';

export interface SettlementBuildingSlot {
  slotId: string;
  allowedCategories: SettlementBuildingCategory[];
  occupiedByBuildingId: string | null;
}

export interface SettlementBuildingInstance {
  buildingId: string;
  slotId: string;
  category: SettlementBuildingCategory;
  nameRu: string;
  hp: number;
  maxHp: number;
  operational: boolean;
  constructionRemainingSec: number;
  constructionTotalSec: number;
}

export interface LocalSettlementState {
  settlementId: string;
  raceId: PlayableRaceId;
  /** §338: Локальные ресурсы карты; не утекают между картами автоматически. */
  localResources: Partial<Record<RaceResourceType, number>>;
  /** §338.5: Rune Power отделён от маны Аватара и обычных ресурсов. */
  runePower: number;
  maxRunePower: number;
  workerCap: number;
  workersUsed: number;
  militaryCap: number; // Пополняется Food (§338.5, §339.1), без периодического upkeep
  militaryUsed: number;
  deposits: Record<string, ResourceDepositNode>;
  workers: Record<string, WorkerAgent>;
  productionQueue: ProductionOrderEntry[];
  /** §§15.5, 15.8: Площадки застройки и здания поселения (отдельный контур ремонта от лечения бойцов). */
  buildingSlots?: Record<string, SettlementBuildingSlot>;
  buildings?: Record<string, SettlementBuildingInstance>;
  frozenOnInactiveMap?: boolean;
  stopReasons: SettlementStopReason[];
}

export type AllegianceState = 'Player' | 'Ally' | 'Neutral' | 'Hostile';

export type ForceSourceKind = 'base_production' | 'patrol' | 'reinforcement' | 'avatar_party';

export interface CreatureDefinition {
  creatureDefId: string;
  nameRu: string;
  originType: 'Mortal' | 'Undead' | 'Demon' | 'Construct' | 'Beast';
  speciesId: string;
  baseMaxHp: number;
  baseAttack: number;
  baseArmor: number;
  combatRoleTags: Array<'melee' | 'ranged' | 'caster' | 'support' | 'shield'>;
  /** §343.4: Область применимости доказанных параметров. */
  provenanceScope: 'species' | 'variant' | 'boss_encounter';
}

export interface UnitInstance {
  unitId: string;
  creatureDefId: string;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export type FormationType = 'compact' | 'line' | 'defensive' | 'loose';

export type MindEffectKind = 'fear' | 'pacify' | 'charm' | 'frenzy' | 'distract';

export type NpcAuthorityTier = 'regular' | 'guard' | 'commander' | 'boss';

export interface ActiveMindInfluence {
  effectKind: MindEffectKind;
  casterHeroId: string;
  originalAllegiance: AllegianceState;
  remainingSec: number;
}

export interface SquadInstance {
  squadId: string;
  nameRu: string;
  squadDefId: string;
  factionId: string;
  allegiance: AllegianceState;
  deploymentState: 'FieldArmy' | 'Garrison';
  forceSource: ForceSourceKind;
  portableAcrossPortals: boolean;
  units: UnitInstance[];
  /** §14.6: Штатная максимальная численность отряда для пополнения потерь. */
  maxUnitCount?: number;
  command: SquadCommandLayer;
  /** §11.4: Роль построения без автоматических бонусов характеристик. */
  formation?: FormationType;
  /** §§4–5: Социальный/ранговый статус NPC для ограничений магии разума. */
  npcTier?: NpcAuthorityTier;
  originType?: CreatureDefinition['originType'];
  willpowerRating?: number;
  plotCriticalRefusal?: boolean;
  activeMindInfluence?: ActiveMindInfluence | null;
}

export type EnemyKnowledgeSource = 'none' | 'local_detection' | 'alert_propagation' | 'scripted_knowledge';

export interface EnemyGroupAIState {
  squadId: string;
  homeZone: { x: number; y: number; radius: number };
  maxPursuitDistance: number;
  knowledgeSource: EnemyKnowledgeSource;
  lastKnownTargetPos: { x: number; y: number } | null;
  lastSeenTimeSec: number | null;
  state: 'IdleAtHome' | 'Patrolling' | 'Pursuing' | 'Searching' | 'ReturningHome';
}

export interface ActiveStatusEffect {
  effectId: string;
  sourceSpellId: string;
  kind: 'buff' | 'debuff' | 'control';
  controlCategory?: 'fear' | 'sleep' | 'root' | 'stun' | 'dominate';
  targetStat?: 'armor' | 'damage' | 'speed';
  magnitude: number;
  remainingSec: number;
  maxDurationSec: number;
}

export interface ControlDiminishingRecord {
  applicationsInWindow: number;
  lastAppliedTimeSec: number;
  windowExpiresAtSec: number;
}

export type WorldObjectKind =
  | 'stone_of_souls'
  | 'portal'
  | 'loot_cache'
  | 'npc_contact'
  | 'rune_pillar'
  | 'rune_monument'
  | 'hero_monument';

export type WorldActionVerb = 'Interact' | 'Loot' | 'Gather' | 'Attack';

/** §128 (USER APPROVED): Запись содержимого контейнера для выборочной или полной добычи. */
export interface LootContainerEntry {
  entryId: string;
  kind: 'item' | 'copper';
  definitionId?: string;
  quantity: number;
  isQuestProtected?: boolean;
  taken: boolean;
}

export interface WorldInteractiveObject {
  objectId: string;
  kind: WorldObjectKind;
  nameRu: string;
  allowedVerbs: WorldActionVerb[];
  targetMapDefId?: string;
  dialogueId?: string;
  lootItemDefinitionId?: string;
  lootCopper?: number;
  /** §128: Детализированный список содержимого окна добычи (выборочный подбор / Взять всё). */
  lootEntries?: LootContainerEntry[];
  activated?: boolean;
  consumed?: boolean;
  /** §144.4: Привязка Rune Monument к народу и флаг захвата/активации. */
  monumentRaceId?: PlayableRaceId;
  captured?: boolean;
}

export interface DialogueCondition {
  minAttribute?: { attr: AttributeId; value: number };
  requiredQuestStatus?: { questId: string; status: QuestStatus };
  requiredWorldFlag?: { flag: string; expected: boolean };
  requiredItemDefId?: string;
}

export interface DialogueChoiceEffect {
  activateQuestId?: string;
  completeQuestStage?: { questId: string; stageId: string };
  closeQuestId?: string;
  failQuestId?: string;
  setWorldFlag?: { flag: string; value: boolean };
  setLocalFlag?: { flag: string; value: boolean };
  grantItemDefId?: string;
  grantXp?: number;
}

export interface DialogueChoice {
  choiceId: string;
  textRu: string;
  nextNodeId: string | null;
  condition?: DialogueCondition;
  /** Идемпотентный eventId однократного последствия (§333.6). */
  consequenceEventId?: string;
  effect?: DialogueChoiceEffect;
}

export interface DialogueNode {
  nodeId: string;
  speakerRu: string;
  textRu: string;
  choices: DialogueChoice[];
}

export interface DialogueDefinition {
  dialogueId: string;
  titleRu: string;
  entryNodeId: string;
  nodes: Record<string, DialogueNode>;
}

export interface CheckpointRecord {
  checkpointId: string;
  reason: 'pre_portal' | 'mission_resolved' | 'manual_checkpoint';
  createdAtIso: string;
  mapDefinitionId: string;
  snapshotJson: string;
}

export interface MerchantTransactionPreview {
  ok: boolean;
  mode: 'buy' | 'sell';
  definitionId: string;
  instanceId?: string;
  itemNameRu: string;
  quantity: number;
  priceCopper: number;
  balanceBeforeCopper: number;
  balanceAfterCopper: number;
  requiresExtraConfirm: boolean;
  warningRu?: string;
  reason?: string;
}

export interface MissionPlayabilityReport {
  playable: boolean;
  issues: string[];
  recommendedCheckpointId: string | null;
}

export interface MapInstanceState {
  mapInstanceId: string;
  mapDefinitionId: string;
  missionId: string;
  lifecycle: MapLifecycleState;
  simulationTimeSec: number;
  activeStoneOfSoulsId: string | null;
  availableStoneOfSoulsIds: string[];
  atAuthorizedStoragePoint: boolean;
  localSettlements: Record<string, LocalSettlementState>;
  squads: Record<string, SquadCommandLayer>;
  /** §343.2 / §343.5: Детализированные боевые отряды карты с живыми бойцами. */
  squadRoster?: Record<string, SquadInstance>;
  /** §343.7: Состояние знания и зоны преследования вражеских групп. */
  enemyAiGroups?: Record<string, EnemyGroupAIState>;
  /** §42.2 / §42.4: Активные эффекты и счётчики повторного контроля по ID цели. */
  activeEffectsByTarget?: Record<string, ActiveStatusEffect[]>;
  controlTrackerByTarget?: Record<string, Record<string, ControlDiminishingRecord>>;
  /** §316 / §346.5: Интерактивные объекты карты и их доступные глаголы действия. */
  worldObjects?: Record<string, WorldInteractiveObject>;
  necromancyMinions: NecromancyMinion[];
  necromancyAutonomy: NecromancyAutonomyPool;
  localFlags: Record<string, boolean>;
}

export interface MerchantState {
  merchantId: string;
  nameRu: string;
  mapDefinitionId: string;
  stockDefinitionIds: string[];
  buyPriceMultiplier: number; // >= 1.0
  sellPriceMultiplier: number; // 0.25..0.5
}

export interface CampaignState {
  campaignId: string;
  avatarId: string;
  heroes: Record<string, HeroState>;
  activePartyHeroIds: string[];
  /** Единственный реестр всех экземпляров предметов по ID (предотвращает дубликаты §347.2). */
  itemsByInstanceId: Record<string, ItemInstance>;
  /** Валюта: в CopperTotal, с номиналами Copper/Silver/Gold (§331.3). */
  localMapWalletCopper: number;
  /** PROPOSED §331.4: не используется как обязательный до решения владельца. */
  proposedCampaignWalletCopper: number;
  /** История убийств по ID варианта существа (для §1.7 diminishing returns между картами). */
  killHistoryByVariant: Record<string, number>;
  quests: Record<string, QuestRecord>;
  merchants: Record<string, MerchantState>;
  worldFlags: Record<string, boolean>;
  processedEventIds: string[];
  processedTransitionIds: string[];
  processedRewardIds: string[];
  /** §346.8: Сохранённые состояния ранее посещённых карт для ReturnPolicy = AllowReturn. */
  archivedMapsByDefinitionId?: Record<string, MapInstanceState>;
  /** §341.7: Автоматические контрольные точки до портала и при исходе миссии (отдельно от ручных слотов). */
  checkpoints?: CheckpointRecord[];
  /** §144: Отдельный Rune Tablet (не смешивается с PartyInventory и Plan Book). */
  runeTablet?: RuneTabletState;
  /** §146: Постоянный реестр активированных Building/Unit Plans кампании. */
  planBook?: Record<string, PlayerPlanState>;
}

export interface MissionState {
  missionId: string;
  titleRu: string;
  status: 'Active' | 'Victory' | 'Defeat';
  returnPolicy: 'AllowReturn' | 'OneWay';
  allowSaveDuringCombat: boolean;
  /** §341.5, §346.9: Смерть Аватара НЕ равна поражению миссии, если не задано явно сценарием. */
  defeatOnAvatarDeath?: boolean;
}

export interface SaveEvent {
  eventId: string;
  type: string;
  timestampSec: number;
  scope: 'Campaign' | 'Mission' | 'MapInstance';
  summaryRu: string;
}

export interface ActiveCastState {
  spellId: string;
  targetId: string;
  remainingCastTimeSec: number;
  totalCastTimeSec: number;
  manaAlreadySpent: number;
  bloodHpAlreadySpent: number;
  castStabilityThreshold: number;
  effectPower: number;
  interrupted: boolean;
}

export interface CorpseEntity {
  corpseId: string;
  nameRu: string;
  /** §3.1 APPROVED: истлевшее тело ('decayed') нельзя воскресить. */
  state: 'fresh' | 'decayed';
  bonesRemaining: number;
  bonesLooted: boolean;
  /** §3.1 APPROVED: скриптованный дух умершего — нельзя подчинить, можно только вступить в диалог/получить подсказку. */
  hasSpirit: boolean;
  spiritHintRu?: string;
}

export type SaveSlotKind = 'manual' | 'autosave';

export interface SaveSlotRecord {
  slotId: string;
  kind: SaveSlotKind;
  savedAtIso: string;
  mapDefinitionId: string;
  saveFormatVersion: number;
  checksum: string;
  rawJson: string;
}

export interface SaveRepositoryState {
  manualSlots: Record<string, SaveSlotRecord>;
  autoSaveRing: SaveSlotRecord[];
}

export interface SaveSnapshot {
  saveFormatVersion: number;
  gameBuildVersion: string;
  contentSchemaVersion: string;
  saveId: string;
  createdAtIso: string;
  lastCommittedEventId: string | null;
  checksum: string;
  campaign: CampaignState;
  mission: MissionState;
  activeMap: MapInstanceState;
  eventJournal: SaveEvent[];
  /** §341.8.4: Доп. метаданные/поля, которые не должны теряться молча при миграции версий. */
  extraMetadata?: Record<string, unknown>;
}

/** §258.4: 16 канонических кодов причин недоступности разблокировки. */
export type UnlockLockCode =
  | 'LOCKED_CAMPAIGN_FLAG'
  | 'LOCKED_LEVEL'
  | 'LOCKED_ATTRIBUTE'
  | 'LOCKED_MASTERY'
  | 'LOCKED_SPELL_FORMULA'
  | 'LOCKED_RUNE'
  | 'LOCKED_RUNE_SLOT'
  | 'LOCKED_PLAN'
  | 'LOCKED_BUILDING'
  | 'LOCKED_RESOURCE'
  | 'LOCKED_CAP'
  | 'LOCKED_LOCATION'
  | 'LOCKED_QUEST_STATE'
  | 'ALREADY_CLAIMED'
  | 'INVALID_TARGET'
  | 'INVALID_STATE';

/** §258.6: Матрица критичности игрового объекта/разблокировки. */
export type UnlockCriticality =
  | 'CRITICAL_PATH'
  | 'OPTIONAL_POWER'
  | 'ALTERNATIVE_ROUTE'
  | 'COLLECTIBLE'
  | 'WORLD_STATE';

export interface UnlockEvaluationResult {
  unlocked: boolean;
  lockCodes: UnlockLockCode[];
  reasonsRu: string[];
}

export interface CampaignAuditReport {
  passed: boolean;
  checks: {
    itemAndRuneInvariants: boolean;
    squadCrossMapIsolation: boolean;
    noDependencyCycles: boolean;
    archivedMapsFrozen: boolean;
    missionPlayable: boolean;
    settlementEconomyPlayable: boolean;
  };
  issuesRu: string[];
}

/** §274.1: Категории фильтрации и сортировки безлимитного PartyInventory. */
export type InventoryFilterCategory =
  | 'all'
  | 'equipment'
  | 'runes'
  | 'plans_scrolls'
  | 'quest_other';

export type InventorySortMode = 'name' | 'price_desc' | 'category';

/** §352.2: 6 канонических классов числовых данных для Numerical Forensic Audit. */
export type NumericalDataConfidenceClass =
  | 'SOURCE_EXACT'
  | 'SOURCE_SECONDARY'
  | 'OBSERVED'
  | 'DESIGN_TARGET'
  | 'UNKNOWN'
  | 'CONFLICT';

/** §352.2 / Numerical Audit Register: Обязательная схема строки числового аудита. */
export interface NumericalAuditEntry {
  entityId: string;
  field: string;
  value: number | string | null;
  unit: string;
  sourceGame: string;
  edition: string;
  patch: string;
  campaignScope: string;
  sourceRef: string;
  confidence: NumericalDataConfidenceClass;
  checkedAt: string; // YYYY-MM-DD
  notes: string;
  /** Обязательно при confidence === 'CONFLICT' (§352.2: оба значения и контекст сохранены). */
  conflictAlternative?: {
    value: number | string;
    sourceRef: string;
    context: string;
  };
}

/** §353.3: Обязательная схема записи контентной сущности. */
export interface ContentCatalogEntityRecord {
  contentId: string;
  displayName: string;
  localizedNames: Record<string, string>;
  entityType: 'unit' | 'building' | 'spell' | 'item' | 'resource' | 'creature';
  raceOrFactionId: PlayableRaceId | 'neutral' | 'all_races';
  sourceGame: string;
  edition: string;
  patch: string;
  campaignScope: string;
  sourceStatus: NumericalDataConfidenceClass;
  sourceRefs: string[];
  gameplayRole: string;
  requirements: string[];
  cost: Partial<Record<RaceResourceType, number>>;
  stats: Record<string, { value: number | string | null; unit: string }>;
  abilities: string[];
  productionLinks: string[];
  variants: string[];
  availabilityConditions: string[];
  confidence: NumericalDataConfidenceClass;
  unknownFields: string[];
  conflicts: string[];
  designStatus: 'APPROVED' | 'DESIGN_TARGET' | 'PARTIAL' | 'OPEN' | 'DEFERRED';
  acceptanceTests: string[];
}

export interface CatalogAuditReport {
  overallCatalogStatus: 'PARTIAL' | 'INVALID';
  numericalErrorsRu: string[];
  catalogErrorsRu: string[];
  raceMatrixErrorsRu: string[];
  openGapsRu: string[];
  stats: {
    racesAudited: number;
    prototypeItemsCount: number;
    prototypeSpellsCount: number;
    numericalEntriesChecked: number;
    catalogRecordsChecked: number;
  };
}

/** §292.9: Три состояния тумана войны (исследованная область сохраняется в Shrouded без сброса). */
export type FogTileVisibility = 'Unexplored' | 'ExploredShrouded' | 'Visible';

export interface FogOfWarGrid {
  width: number;
  height: number;
  tiles: FogTileVisibility[];
}

/** §292.6–292.7: Состояние выделения и 6 групп быстрого выбора (Ctrl + 1..6). */
export interface FieldSelectionState {
  selectedEntityIds: string[];
  focusedEntityId: string | null;
  controlGroups: Record<1 | 2 | 3 | 4 | 5 | 6, string[]>;
}

/** §348.4, §348.6: Безопасный стек навигации UI для Android Back / Escape. */
export type UiNavigationLayerKind =
  | 'spell_target_preview'
  | 'trade_confirm'
  | 'delete_confirm'
  | 'equip_preview'
  | 'loot_container'
  | 'dialogue'
  | 'quest_detail'
  | 'modal_root';

export interface UiNavigationLayer {
  layerId: string;
  kind: UiNavigationLayerKind;
  blocksWorldCommands: boolean;
}



