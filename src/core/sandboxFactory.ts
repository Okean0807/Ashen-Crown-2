/**
 * ASHEN CROWN — Изолированная фабрика тестового полигона (Вертикальный срез v14.2).
 *
 * Правила §349.5, §353.5, 37_Задание:
 * - Не содержит вымышленного лора, фракций, имён героев/миссий или материалов SpellForce.
 * - Используются исключительно нейтральные технические обозначения.
 */

import { DESIGN_TARGET_FORMULAS } from './config';
import { computeMaxHp, computeMaxMana, xpThresholdForLevel } from './progression';
import { createSquadInstance } from './squadsAndEffects';
import type {
  CampaignState,
  HeroState,
  MapInstanceState,
  MissionState,
  SaveEvent,
} from './types';

export interface VerticalSliceSandbox {
  campaign: CampaignState;
  mission: MissionState;
  activeMap: MapInstanceState;
  eventJournal: SaveEvent[];
}

export function createInitialAvatarHero(heroId = 'avatar_test_01'): HeroState {
  const baseAttr = DESIGN_TARGET_FORMULAS.BASE_ATTRIBUTE;
  const maxHp = computeMaxHp(baseAttr, 1);
  const maxMana = computeMaxMana(baseAttr, 1);

  return {
    heroId,
    isAvatar: true,
    nameRu: 'Аватар (тестовый полигон)',
    level: 1,
    xp: 0,
    xpToNext: xpThresholdForLevel(1),
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    baseAttributes: {
      STR: baseAttr,
      STA: baseAttr,
      DEX: baseAttr,
      AGI: baseAttr,
      INT: baseAttr,
      WIS: baseAttr,
      CHA: baseAttr,
    },
    combatMasteries: {
      one_handed: 0,
      two_handed: 0,
      polearms: 0,
      bows: 0,
      crossbows: 0,
      shields: 0,
    },
    schoolMasteries: {
      elemental: 0,
      dark: 0,
      life: 0,
      mind: 0,
      light: 0,
      spatial: 0,
    },
    darkBranchMasteries: {
      necromancy: 0,
      demonology: 0,
      blood_magic: 0,
      shadow_magic: 0,
      curse_magic: 0,
      void_magic: 0,
    },
    spells: {
      spell_elem_fire_bolt: {
        spellId: 'spell_elem_fire_bolt',
        acquisitionState: 'Learned',
        rank: 1,
      },
      spell_elem_spark: {
        spellId: 'spell_elem_spark',
        acquisitionState: 'ReadyToLearn',
        rank: 0,
      },
      spell_life_mend: {
        spellId: 'spell_life_mend',
        acquisitionState: 'ReadyToLearn',
        rank: 0,
      },
      spell_dark_raise_skeleton: {
        spellId: 'spell_dark_raise_skeleton',
        acquisitionState: 'ReadyToLearn',
        rank: 0,
      },
      spell_dark_blood_pact: {
        spellId: 'spell_dark_blood_pact',
        acquisitionState: 'KnownUnavailable',
        rank: 0,
      },
    },
    unspent: {
      attributePoints: 4,
      combatMasteryPoints: 2,
      magicPoints: 3,
    },
    investedHistory: {
      attributePointsSpent: 0,
      combatPointsSpent: 0,
      magicPointsSpent: 0,
    },
    respecWindowOpen: true, // Доступен строго до первого перехода через портал (§1.12)
    hasUnspentLevelNotification: true,
    specialization: 'hybrid',
    equipment: {
      main_hand: 'inst_sword_1h_01',
      off_hand: null,
      armor: null,
      helm: null,
      ring_1: null,
      ring_2: null,
      amulet: null,
    },
    magicStrain: {
      index: 0,
      status: 'normal',
    },
    deathState: {
      lifecycle: 'Alive',
      respawnRemainingSec: 0,
      activeStoneOfSoulsId: 'stone_sector_a_01',
    },
    resistances: {
      fire: 0.1,
    },
    activeCast: null,
    schoolProgressBySchool: {},
    bonesCount: 5,
  };
}

export function createInitialVerticalSliceSandbox(): VerticalSliceSandbox {
  const avatar = createInitialAvatarHero('avatar_test_01');

  const campaign: CampaignState = {
    campaignId: 'campaign_vertical_slice_01',
    avatarId: avatar.heroId,
    heroes: {
      [avatar.heroId]: avatar,
    },
    activePartyHeroIds: [avatar.heroId],
    itemsByInstanceId: {
      inst_sword_1h_01: {
        instanceId: 'inst_sword_1h_01',
        definitionId: 'item_1h_iron_sword',
        quantity: 1,
        location: { kind: 'equipped', heroId: avatar.heroId, slot: 'main_hand' },
      },
      inst_sword_2h_01: {
        instanceId: 'inst_sword_2h_01',
        definitionId: 'item_2h_heavy_blade',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_shield_01: {
        instanceId: 'inst_shield_01',
        definitionId: 'item_shield_iron',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_amulet_cha_01: {
        instanceId: 'inst_amulet_cha_01',
        definitionId: 'item_amulet_cha',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_scroll_frost_01: {
        instanceId: 'inst_scroll_frost_01',
        definitionId: 'item_scroll_frost_nova',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_quest_seal_01: {
        instanceId: 'inst_quest_seal_01',
        definitionId: 'item_quest_seal',
        quantity: 1,
        location: { kind: 'party_inventory' },
        isQuestProtected: true,
      },
      inst_storage_ring_01: {
        instanceId: 'inst_storage_ring_01',
        definitionId: 'item_ring_int',
        quantity: 1,
        location: { kind: 'campaign_storage' },
      },
      inst_rune_worker_humans_01: {
        instanceId: 'inst_rune_worker_humans_01',
        definitionId: 'item_rune_worker_humans',
        quantity: 1,
        location: { kind: 'rune_tablet', slotIndex: 0 },
      },
      inst_rune_worker_elves_01: {
        instanceId: 'inst_rune_worker_elves_01',
        definitionId: 'item_rune_worker_elves',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_rune_hero_vanguard_01: {
        instanceId: 'inst_rune_hero_vanguard_01',
        definitionId: 'item_rune_hero_vanguard',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_plan_unit_infantry_01: {
        instanceId: 'inst_plan_unit_infantry_01',
        definitionId: 'item_plan_unit_infantry_humans',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
      inst_plan_unit_archer_elves_01: {
        instanceId: 'inst_plan_unit_archer_elves_01',
        definitionId: 'item_plan_unit_archer_elves',
        quantity: 1,
        location: { kind: 'party_inventory' },
      },
    },
    runeTablet: {
      slots: [
        { slotIndex: 0, runeInstanceId: 'inst_rune_worker_humans_01' },
        { slotIndex: 1, runeInstanceId: null },
        { slotIndex: 2, runeInstanceId: null },
        { slotIndex: 3, runeInstanceId: null },
      ],
    },
    planBook: {
      plan_humans_bld_barracks: {
        planId: 'plan_humans_bld_barracks',
        status: 'activated',
        activatedAtIso: '2026-11-25T00:00:00.000Z',
      },
    },
    localMapWalletCopper: 15_450, // 1 Gold, 54 Silver, 50 Copper (§331.3)
    proposedCampaignWalletCopper: 0,
    killHistoryByVariant: {},
    quests: {
      quest_main_sector_gate: {
        questId: 'quest_main_sector_gate',
        questClass: 'Main',
        titleRu: 'Проверка магистрали перехода (Основное)',
        summaryRu: 'Подготовьте Аватара и откройте проход к сектору Б через портал.',
        fullDescriptionRu:
          'Технический сценарий проверки основного задания (§299–303): без автоматического ведения по стрелкам на карте, с явной поэтапной фиксацией прогресса.',
        loreJournalNotesRu: [
          'Журнальная заметка 01: В секторе А зафиксирован активный Stone of Souls.',
          'Журнальная заметка 02: Для прохождения этапа требуется завершить проверку систем.',
        ],
        status: 'Active',
        stages: [
          {
            stageId: 'stage_verify_equipment',
            titleRu: 'Этап 1: Подготовить снаряжение или изучить формулу',
            descriptionRu: 'Проверьте инвентарь отряда и требования к экипировке без самовыполняющихся бонусов.',
            completed: false,
          },
          {
            stageId: 'stage_portal_ready',
            titleRu: 'Этап 2: Стабилизировать сектор перед порталом',
            descriptionRu: 'Подтвердите готовность к переходу в Сектор Б (без экрана Expedition Preparation).',
            completed: false,
          },
        ],
        prerequisiteQuestIds: [],
        rewardId: 'reward_main_sector_gate',
        rewardCopper: 2500,
        rewardXp: 180,
      },
      quest_side_supply_audit: {
        questId: 'quest_side_supply_audit',
        questClass: 'Side',
        titleRu: 'Учёт снабжения сектора (Дополнительное)',
        summaryRu: 'Сверка складского контейнера и защищённых квестовых предметов.',
        fullDescriptionRu:
          'Дополнительное поручение для проверки фильтрации Questbook (§299.2): активное дополнительное задание без принудительных маршрутных маркеров.',
        loreJournalNotesRu: [
          'Заметка снабжения: Защищённая печать сектора не подлежит продаже торговцам (§347.7).',
        ],
        status: 'Active',
        stages: [
          {
            stageId: 'stage_storage_check',
            titleRu: 'Этап 1: Проверить доступ к CampaignStorage на точке склада',
            descriptionRu: 'Убедитесь, что удалённый доступ к складу вне разрешённой точки блокируется.',
            completed: false,
          },
        ],
        prerequisiteQuestIds: [],
        rewardId: 'reward_side_supply_audit',
        rewardCopper: 650,
        rewardXp: 90,
      },
      quest_side_initial_report: {
        questId: 'quest_side_initial_report',
        questClass: 'Side',
        titleRu: 'Регистрация на Stone of Souls (Дополнительное)',
        summaryRu: 'Привязка Аватара к активному якорю возрождения сектора А.',
        fullDescriptionRu:
          'Пример завершённого дополнительного задания для вкладки «Завершённые» в Questbook (§299.2).',
        loreJournalNotesRu: [
          'Аватар привязан к точке stone_sector_a_01 (задержка возрождения: 120 сек, §288).',
        ],
        status: 'Completed',
        stages: [
          {
            stageId: 'stage_bind_stone',
            titleRu: 'Этап 1: Активировать точку возрождения',
            descriptionRu: 'Якорь активирован.',
            completed: true,
          },
        ],
        prerequisiteQuestIds: [],
      },
    },
    merchants: {
      merchant_neutral_01: {
        merchantId: 'merchant_neutral_01',
        nameRu: 'Интендант полигона',
        mapDefinitionId: 'sector_a',
        stockDefinitionIds: [
          'item_1h_iron_sword',
          'item_armor_brigandine',
          'item_ring_int',
          'item_scroll_frost_nova',
        ],
        buyPriceMultiplier: 1.0,
        sellPriceMultiplier: 0.5,
      },
    },
    worldFlags: {
      portalSectorBUnlocked: true,
    },
    processedEventIds: [],
    processedTransitionIds: [],
    processedRewardIds: [],
    archivedMapsByDefinitionId: {},
    checkpoints: [],
  };

  const mission: MissionState = {
    missionId: 'mission_vertical_slice_01',
    titleRu: 'Тестовая миссия: Полигон v14.2',
    status: 'Active',
    returnPolicy: 'AllowReturn',
    allowSaveDuringCombat: true,
    defeatOnAvatarDeath: false,
  };

  const activeMap: MapInstanceState = {
    mapInstanceId: 'map_inst_sector_a_init',
    mapDefinitionId: 'sector_a',
    missionId: mission.missionId,
    lifecycle: 'RUNNING',
    simulationTimeSec: 0,
    activeStoneOfSoulsId: 'stone_sector_a_01',
    availableStoneOfSoulsIds: ['stone_sector_a_01', 'stone_sector_a_02'],
    atAuthorizedStoragePoint: true,
    localSettlements: {
      settlement_sector_a: {
        settlementId: 'settlement_sector_a',
        raceId: 'humans',
        localResources: {
          wood: 180,
          stone: 120,
          iron: 75,
          aria: 40,
          food: 35,
        },
        runePower: 40,
        maxRunePower: 100,
        workerCap: 20,
        workersUsed: 6,
        militaryCap: 15,
        militaryUsed: 6,
        deposits: {
          dep_wood_01: {
            depositId: 'dep_wood_01',
            resourceType: 'wood',
            remainingAmount: 400,
            routeAccessible: true,
            extractionEfficiency: 1.0,
          },
          dep_iron_01: {
            depositId: 'dep_iron_01',
            resourceType: 'iron',
            remainingAmount: 250,
            routeAccessible: true,
            extractionEfficiency: 1.0,
          },
          dep_food_01: {
            depositId: 'dep_food_01',
            resourceType: 'food',
            remainingAmount: 300,
            routeAccessible: true,
            extractionEfficiency: 1.0,
          },
        },
        workers: {
          w_01: {
            workerId: 'w_01',
            role: 'Gatherer',
            assignedDepositId: 'dep_wood_01',
            carrying: null,
          },
          w_02: {
            workerId: 'w_02',
            role: 'Gatherer',
            assignedDepositId: 'dep_iron_01',
            carrying: null,
          },
        },
        productionQueue: [],
        buildingSlots: {
          slot_hq_01: {
            slotId: 'slot_hq_01',
            allowedCategories: ['headquarters'],
            occupiedByBuildingId: 'bld_hq_01',
          },
          slot_barracks_01: {
            slotId: 'slot_barracks_01',
            allowedCategories: ['barracks', 'workshop'],
            occupiedByBuildingId: 'bld_barracks_01',
          },
          slot_defense_01: {
            slotId: 'slot_defense_01',
            allowedCategories: ['defense', 'magic_research'],
            occupiedByBuildingId: null,
          },
        },
        buildings: {
          bld_hq_01: {
            buildingId: 'bld_hq_01',
            slotId: 'slot_hq_01',
            category: 'headquarters',
            nameRu: 'Штаб сектора (Headquarters)',
            hp: 400,
            maxHp: 400,
            operational: true,
            constructionRemainingSec: 0,
            constructionTotalSec: 0,
          },
          bld_barracks_01: {
            buildingId: 'bld_barracks_01',
            slotId: 'slot_barracks_01',
            category: 'barracks',
            nameRu: 'Казарма сектора (Barracks)',
            hp: 300,
            maxHp: 300,
            operational: true,
            constructionRemainingSec: 0,
            constructionTotalSec: 0,
          },
        },
        frozenOnInactiveMap: false,
        stopReasons: [],
      },
    },
    squads: {
      squad_alpha: {
        squadId: 'squad_alpha',
        playerOrder: 'AttackMove',
        orderTargetPos: { x: 24, y: 18 },
        localReaction: 'None',
      },
    },
    squadRoster: {
      squad_alpha: (() => {
        const sq = createSquadInstance({
          squadId: 'squad_alpha',
          nameRu: 'Полевой отряд Альфа (пехота)',
          squadDefId: 'sq_def_infantry',
          creatureDefId: 'unit_proto_infantry',
          count: 4,
          factionId: 'proto_player',
          allegiance: 'Player',
          deploymentState: 'FieldArmy',
          forceSource: 'base_production',
          portableAcrossPortals: true,
        });
        sq.command = {
          squadId: 'squad_alpha',
          playerOrder: 'AttackMove',
          orderTargetPos: { x: 24, y: 18 },
          localReaction: 'None',
        };
        // Один раненый и один павший для проверки Food Store + переноса выживших через портал (§339.1, §341.4)
        sq.units[1].hp = 55;
        sq.units[3].hp = 0;
        sq.units[3].alive = false;
        sq.formation = 'compact';
        return sq;
      })(),
      squad_garrison_01: {
        ...createSquadInstance({
          squadId: 'squad_garrison_01',
          nameRu: 'Гарнизон аванпоста (стрелки)',
          squadDefId: 'sq_def_archer',
          creatureDefId: 'unit_proto_archer',
          count: 2,
          factionId: 'proto_player',
          allegiance: 'Player',
          deploymentState: 'Garrison',
          forceSource: 'base_production',
          portableAcrossPortals: false,
        }),
        formation: 'line',
      },
      squad_neutral_demon: {
        ...createSquadInstance({
          squadId: 'squad_neutral_demon',
          nameRu: 'Нейтральный демон-наблюдатель (§343.3)',
          squadDefId: 'sq_def_demon',
          creatureDefId: 'unit_proto_neutral_demon',
          count: 1,
          factionId: 'proto_independent',
          allegiance: 'Neutral',
          deploymentState: 'FieldArmy',
          forceSource: 'reinforcement',
          portableAcrossPortals: false,
        }),
        npcTier: 'boss',
        originType: 'Demon',
        willpowerRating: 45,
      },
      squad_enemy_patrol: {
        ...createSquadInstance({
          squadId: 'squad_enemy_patrol',
          nameRu: 'Патруль налётчиков (Enemy AI)',
          squadDefId: 'sq_def_raider',
          creatureDefId: 'unit_proto_raider',
          count: 3,
          factionId: 'proto_raiders',
          allegiance: 'Hostile',
          deploymentState: 'FieldArmy',
          forceSource: 'patrol',
          portableAcrossPortals: false,
        }),
        npcTier: 'guard',
        originType: 'Mortal',
        willpowerRating: 10,
      },
    },
    enemyAiGroups: {
      squad_enemy_patrol: {
        squadId: 'squad_enemy_patrol',
        homeZone: { x: 40, y: 40, radius: 6 },
        maxPursuitDistance: 12,
        knowledgeSource: 'none',
        lastKnownTargetPos: null,
        lastSeenTimeSec: null,
        state: 'Patrolling',
      },
    },
    activeEffectsByTarget: {},
    controlTrackerByTarget: {},
    worldObjects: {
      stone_sector_a_01: {
        objectId: 'stone_sector_a_01',
        kind: 'stone_of_souls',
        nameRu: 'Stone of Souls — Южные врата',
        allowedVerbs: ['Interact'],
        activated: true,
      },
      stone_sector_a_02: {
        objectId: 'stone_sector_a_02',
        kind: 'stone_of_souls',
        nameRu: 'Stone of Souls — Северный перекрёсток',
        allowedVerbs: ['Interact'],
        activated: false,
      },
      obj_loot_cache_01: {
        objectId: 'obj_loot_cache_01',
        kind: 'loot_cache',
        nameRu: 'Полевой контейнер снабжения (§316 Loot)',
        allowedVerbs: ['Loot'],
        lootCopper: 420,
        lootItemDefinitionId: 'item_scroll_frost_nova',
        consumed: false,
      },
      obj_npc_coordinator_01: {
        objectId: 'obj_npc_coordinator_01',
        kind: 'npc_contact',
        nameRu: 'Дежурный координатор сектора (§333.6)',
        allowedVerbs: ['Interact'],
        dialogueId: 'dlg_sector_coordinator',
      },
      obj_portal_sector_b: {
        objectId: 'obj_portal_sector_b',
        kind: 'portal',
        nameRu: 'Портал в Сектор Б',
        allowedVerbs: ['Interact'],
        targetMapDefId: 'sector_b',
      },
      mon_rune_humans_01: {
        objectId: 'mon_rune_humans_01',
        kind: 'rune_monument',
        nameRu: 'Rune Monument (Люди · §144)',
        allowedVerbs: ['Interact'],
        monumentRaceId: 'humans',
        captured: true,
        activated: true,
      },
      mon_rune_elves_01: {
        objectId: 'mon_rune_elves_01',
        kind: 'rune_monument',
        nameRu: 'Rune Monument (Эльфы · §144)',
        allowedVerbs: ['Interact'],
        monumentRaceId: 'elves',
        captured: false,
        activated: false,
      },
      mon_hero_sector_a_01: {
        objectId: 'mon_hero_sector_a_01',
        kind: 'hero_monument',
        nameRu: 'Hero Monument — Сектор А (§144.4)',
        allowedVerbs: ['Interact'],
        activated: true,
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

  const eventJournal: SaveEvent[] = [
    {
      eventId: 'evt_init_001',
      type: 'MAP_INITIALIZED',
      timestampSec: 0,
      scope: 'MapInstance',
      summaryRu: 'Инициализирован нейтральный тестовый полигон Сектор А (v14.2).',
    },
  ];

  return { campaign, mission, activeMap, eventJournal };
}
