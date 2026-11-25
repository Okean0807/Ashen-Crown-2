import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ATTRIBUTE_LABELS,
  COMBAT_MASTERY_LABELS,
  DARK_BRANCH_LABELS,
  DEFAULT_WORKING_ASSUMPTIONS,
  MAGIC_SCHOOL_LABELS,
  PLAYABLE_RACES,
} from '../core/config';
import { PROTOTYPE_ITEMS, PROTOTYPE_PLANS, PROTOTYPE_SPELLS } from '../core/catalog';
import {
  advanceAvatarRespawnTimer,
  advanceHeroActiveCast,
  applyCombatInterruptToHeroCast,
  beginHeroCast,
  clampResistance,
  completeSquadLocalReaction,
  computeBoneWarriorBonesCost,
  computeRawPhysicalDamage,
  computeSpellCastTime,
  computeSpellManaCost,
  createBoneWarriorFromBones,
  interactWithCorpseSpirit,
  issueSquadPlayerOrder,
  lootBonesFromCorpse,
  reraiseCorpseForNecromancy,
  reraiseDormantMinions,
  resolveCombatPackets,
  startSpellCast,
  tickMagicStrainDecay,
  tickNecromancyMinions,
  triggerAvatarDeath,
  triggerSquadLocalReaction,
} from '../core/combatAndMagic';
import { runCampaignAntiDeadlockAudit } from '../core/campaignAudit';
import { runPrototypeCatalogAndAuditReport } from '../core/catalogAudit';
import {
  completeQuestStageAndMaybeReward,
  computeBuyAndSellPricesCopper,
  copperToDenominations,
  createSaveSnapshot,
  discardOrDestroyInventoryItem,
  equipItemFromPartyInventory,
  executeMerchantBuy,
  executeMerchantSell,
  executePortalMapTransition,
  moveItemBetweenInventoryAndStorage,
  pickupItemToPartyInventory,
  previewHeroEquipmentChange,
  previewMerchantTransaction,
  queryPartyInventoryItems,
  splitItemStack,
  transcribeSpellScrollToGrimoire,
  transferEquippedItemBetweenHeroes,
  unequipSlotToPartyInventory,
  validateAndLoadSnapshot,
  verifyItemLocationInvariants,
} from '../core/inventoryAndSave';
import {
  activatePlanFromInventory,
  captureRuneMonument,
  computeUnlockedRuneTabletSlots,
  evaluatePlanAvailability,
  installRuneInTablet,
  markRuneHeroFallen,
  previewRuneSaleOrDestructionWarning,
  removeRuneFromTablet,
  summonOrResummonRuneHeroAtMonument,
  tickRunePowerRecovery,
} from '../core/runesAndPlans';
import {
  applyDialogueChoice,
  canAcceptMapCommands,
  evaluateDialogueCondition,
  evaluateMissionStatusAfterAvatarDeath,
  interactWithWorldObject,
  openLootContainer,
  PROTOTYPE_DIALOGUES,
  restoreFromCheckpoint,
  takeAllLootEntries,
  takeSingleLootEntry,
  transitionMapLifecycle,
  validateMissionPlayability,
} from '../core/missionAndWorld';
import {
  allocateAttributePoint,
  allocateCombatMasteryPoint,
  allocateMagicSchoolPoint,
  computeDerivedHeroStats,
  computeSpecialization,
  dismissPartyHero,
  grantHeroExperience,
  learnOrUpgradeSpell,
  respecHeroBeforeMapTransition,
  summonCompanionHeroToParty,
} from '../core/progression';
import {
  createInitialVerticalSliceSandbox,
  type VerticalSliceSandbox,
} from '../core/sandboxFactory';
import {
  createEmptySaveRepository,
  loadLatestValidAutoSave,
  pushAutoSaveToRing,
  saveToManualSlot,
} from '../core/saveManager';
import {
  damageSettlementBuilding,
  deliverWorkerCarryToSettlement,
  enqueueSquadProduction,
  extractResourceToWorkerCarry,
  healSquadWithFoodStore,
  reassignWorkerSafe,
  repairSettlementBuilding,
  replenishSquadFromSettlement,
  startBuildingConstruction,
  tickSettlementProduction,
  upgradeMilitaryCapWithFood,
  validateSettlementEconomicPlayability,
} from '../core/settlementEconomy';
import {
  applyControlEffect,
  applyMindEffectToTarget,
  awardArmyVictoryXpToHero,
  changeSquadAllegiance,
  filterAutoCastEligibleSpells,
  issueMultiSquadOrder,
  runMandatoryCombatMatrixAudit,
  setSquadFormation,
  stepEnemyGroupPursuit,
  switchSquadDeployment,
  tickMindEffectsExpiry,
  updateEnemyGroupKnowledge,
} from '../core/squadsAndEffects';
import type {
  AttributeId,
  CombatMasteryId,
  CorpseEntity,
  DarkBranchId,
  EquipSlotId,
  EquipmentPreviewResult,
  FormationType,
  InventoryFilterCategory,
  InventorySortMode,
  MagicSchoolId,
  MerchantTransactionPreview,
  PlayableRaceId,
  QuestClass,
  SaveRepositoryState,
} from '../core/types';

const V14_STORAGE_KEY = 'ashen_crown_v14_slice_save_v1';

interface V14VerticalSliceModalProps {
  onClose: () => void;
  externalSandbox?: VerticalSliceSandbox;
  onExternalSync?: (next: VerticalSliceSandbox) => void;
}

type SliceTab = 'hero' | 'magic_combat' | 'settlement' | 'economy_portal' | 'questbook';

const EQUIP_SLOT_LABELS: Record<EquipSlotId, string> = {
  main_hand: 'Основная рука',
  off_hand: 'Левая рука',
  armor: 'Доспех',
  helm: 'Шлем',
  ring_1: 'Кольцо 1',
  ring_2: 'Кольцо 2',
  amulet: 'Амулет',
};

const SPEC_LABELS = {
  warrior: 'Воин (Warrior)',
  mage: 'Маг (Mage)',
  hybrid: 'Гибрид (Hybrid)',
} as const;

const STRAIN_LABELS = {
  normal: 'Норма',
  elevated: 'Повышена',
  critical: 'Критическое истощение',
} as const;

function cloneSandbox(sb: VerticalSliceSandbox): VerticalSliceSandbox {
  return JSON.parse(JSON.stringify(sb));
}

export const V14VerticalSliceModal: React.FC<V14VerticalSliceModalProps> = ({
  onClose,
  externalSandbox,
  onExternalSync,
}) => {
  const [sandbox, setSandbox] = useState<VerticalSliceSandbox>(() =>
    externalSandbox ? cloneSandbox(externalSandbox) : createInitialVerticalSliceSandbox()
  );
  const [activeTab, setActiveTab] = useState<SliceTab>('hero');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedRaceId, setSelectedRaceId] = useState<PlayableRaceId>('humans');
  const [lastCombatSummary, setLastCombatSummary] = useState<string>('');
  const [storedJsonSnapshot, setStoredJsonSnapshot] = useState<string>(() => {
    try {
      return localStorage.getItem(V14_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  // Questbook §299 + Slice 3 overlays (§333.6, §347.5, §348.4, §348.6)
  const [questClassFilter, setQuestClassFilter] = useState<QuestClass>('Main');
  const [questStatusFilter, setQuestStatusFilter] = useState<'active' | 'done'>('active');
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>('quest_main_sector_gate');
  const [mobileQuestDetailOpen, setMobileQuestDetailOpen] = useState(false);
  const [pendingSpellId, setPendingSpellId] = useState<string | null>(null);
  const [pendingTrade, setPendingTrade] = useState<MerchantTransactionPreview | null>(null);
  const [pendingEquip, setPendingEquip] = useState<{
    instanceId: string;
    itemNameRu: string;
    targetSlot: EquipSlotId;
    preview: EquipmentPreviewResult;
  } | null>(null);
  const [pendingDestroyId, setPendingDestroyId] = useState<string | null>(null);
  const [invCategory, setInvCategory] = useState<InventoryFilterCategory>('all');
  const [invSort, setInvSort] = useState<InventorySortMode>('name');
  const [activeDialogue, setActiveDialogue] = useState<{
    dialogueId: string;
    nodeId: string;
  } | null>(null);
  const [activeLootContainerId, setActiveLootContainerId] = useState<string | null>(null);
  const [saveRepo, setSaveRepo] = useState<SaveRepositoryState>(() => createEmptySaveRepository());
  const [simInCombat, setSimInCombat] = useState(false);
  const [selectedHeroId, setSelectedHeroId] = useState<string>('hero_avatar_01');
  const [demoCorpse, setDemoCorpse] = useState<CorpseEntity>({
    corpseId: 'corpse_demo_01',
    nameRu: 'Останки налётчика (тест §3.1)',
    state: 'fresh',
    bonesRemaining: 4,
    bonesLooted: false,
    hasSpirit: true,
    spiritHintRu: 'Скриптованный дух: путь к узлу сектора лежит через северные врата.',
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (activeDialogue) {
          setActiveDialogue(null);
          setFeedback({
            ok: true,
            text: 'Диалог закрыт по Back/Escape без изменения приказов армии (§333.7, §348.6).',
          });
          return;
        }
        if (activeLootContainerId) {
          setActiveLootContainerId(null);
          setFeedback({
            ok: true,
            text: 'Окно добычи закрыто по Back/Escape без потери оставшихся предметов (§128, §348.6).',
          });
          return;
        }
        if (pendingDestroyId) {
          setPendingDestroyId(null);
          setFeedback({
            ok: true,
            text: 'Удаление предмета отменено: предмет сохранён (§317.9).',
          });
          return;
        }
        if (pendingEquip) {
          setPendingEquip(null);
          setFeedback({
            ok: true,
            text: 'Предпросмотр экипировки закрыт без изменений (§317.9).',
          });
          return;
        }
        if (pendingTrade) {
          setPendingTrade(null);
          setFeedback({
            ok: true,
            text: 'Торговая операция отменена: баланс и предметы не изменились (§348.4).',
          });
          return;
        }
        if (pendingSpellId) {
          setPendingSpellId(null);
          setFeedback({
            ok: true,
            text: 'Выбор цели заклинания отменён: мана и MagicStrain не потрачены (§348.4).',
          });
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeDialogue, activeLootContainerId, pendingDestroyId, pendingEquip, pendingTrade, pendingSpellId, onClose]);

  const mutateSandbox = useCallback(
    (
      fn: (draft: VerticalSliceSandbox) => { ok: boolean; text: string } | void,
      eventType?: string,
      eventScope: 'Campaign' | 'Mission' | 'MapInstance' = 'Campaign'
    ) => {
      setSandbox((prev) => {
        const draft = cloneSandbox(prev);
        const result = fn(draft);
        if (result) {
          setFeedback(result);
          if (result.ok && eventType) {
            draft.eventJournal.push({
              eventId: `evt_${Date.now()}_${draft.eventJournal.length + 1}`,
              type: eventType,
              timestampSec: draft.activeMap.simulationTimeSec,
              scope: eventScope,
              summaryRu: result.text,
            });
          }
        }
        return draft;
      });
    },
    []
  );

  useEffect(() => {
    if (onExternalSync) {
      onExternalSync(sandbox);
    }
  }, [sandbox, onExternalSync]);

  const avatar = sandbox.campaign.heroes[sandbox.campaign.avatarId];
  const inspectedHeroId =
    sandbox.campaign.activePartyHeroIds.includes(selectedHeroId) &&
    sandbox.campaign.heroes[selectedHeroId]
      ? selectedHeroId
      : sandbox.campaign.avatarId;
  const inspectedHero = sandbox.campaign.heroes[inspectedHeroId] ?? avatar;
  const derived = useMemo(
    () => computeDerivedHeroStats(inspectedHero, sandbox.campaign.itemsByInstanceId),
    [inspectedHero, sandbox.campaign.itemsByInstanceId]
  );
  const specCalc = useMemo(() => computeSpecialization(inspectedHero), [inspectedHero]);
  const walletDenom = useMemo(
    () => copperToDenominations(sandbox.campaign.localMapWalletCopper),
    [sandbox.campaign.localMapWalletCopper]
  );
  const tradeAdjPct = useMemo(() => {
    const sample = computeBuyAndSellPricesCopper('item_armor_brigandine', avatar.baseAttributes.CHA);
    return sample.tradeAdjPct;
  }, [avatar.baseAttributes.CHA]);

  const inventoryItems = useMemo(
    () => queryPartyInventoryItems(sandbox.campaign, { category: invCategory, sortBy: invSort }),
    [sandbox.campaign, invCategory, invSort]
  );
  const storageItems = useMemo(
    () =>
      Object.values(sandbox.campaign.itemsByInstanceId).filter(
        (i) => i.location.kind === 'campaign_storage'
      ),
    [sandbox.campaign.itemsByInstanceId]
  );

  const filteredQuests = useMemo(() => {
    return Object.values(sandbox.campaign.quests).filter((q) => {
      if (q.questClass !== questClassFilter) return false;
      if (questStatusFilter === 'active') {
        return q.status === 'Active' || q.status === 'Available';
      }
      return q.status === 'Completed' || q.status === 'Failed' || q.status === 'Closed';
    });
  }, [sandbox.campaign.quests, questClassFilter, questStatusFilter]);

  const activeQuestDetail = useMemo(() => {
    if (selectedQuestId && sandbox.campaign.quests[selectedQuestId]) {
      const q = sandbox.campaign.quests[selectedQuestId];
      if (filteredQuests.some((item) => item.questId === q.questId)) {
        return q;
      }
    }
    return filteredQuests[0] ?? null;
  }, [filteredQuests, sandbox.campaign.quests, selectedQuestId]);

  const squadAlpha = sandbox.activeMap.squads.squad_alpha;
  const merchant = sandbox.campaign.merchants.merchant_neutral_01;
  const invCheck = useMemo(() => verifyItemLocationInvariants(sandbox.campaign), [sandbox.campaign]);

  const handleSaveSnapshot = () => {
    const snap = createSaveSnapshot(
      sandbox.campaign,
      sandbox.mission,
      sandbox.activeMap,
      sandbox.eventJournal
    );
    const json = JSON.stringify(snap);
    try {
      localStorage.setItem(V14_STORAGE_KEY, json);
    } catch {
      // Fallback kept in state
    }
    setStoredJsonSnapshot(json);
    setFeedback({
      ok: true,
      text: `Снимок сохранён (v${snap.saveFormatVersion}, контрольная сумма ${snap.checksum}).`,
    });
  };

  const handleLoadSnapshot = (rawOverride?: string) => {
    let raw = rawOverride ?? storedJsonSnapshot;
    if (!raw) {
      try {
        raw = localStorage.getItem(V14_STORAGE_KEY) ?? '';
      } catch {
        raw = '';
      }
    }
    if (!raw) {
      setFeedback({ ok: false, text: 'Сохранённый снимок полигона v14.2 ещё не создан.' });
      return;
    }
    const res = validateAndLoadSnapshot(raw);
    if (!res.ok) {
      setFeedback({
        ok: false,
        text: `Загрузка отклонена (§341.8, текущее состояние сохранено): ${res.error}`,
      });
      return;
    }
    setSandbox({
      campaign: res.snapshot.campaign,
      mission: res.snapshot.mission,
      activeMap: res.snapshot.activeMap,
      eventJournal: res.snapshot.eventJournal,
    });
    setFeedback({
      ok: true,
      text: `Снимок ${res.snapshot.saveId} загружен и прошёл проверку целостности (${res.snapshot.checksum}).`,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0b0d12]/96 text-[#eae3d2] overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Полигон систем ASHEN CROWN v14.2"
    >
      {/* Compact Header (fits within mobile 15% cap together with tab bar) */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 bg-[#12151d] border-b border-[#c49a45]/35">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#f2ece0] truncate">
              Ядро систем ASHEN CROWN · v14.2
            </h2>
          </div>
          <p className="text-[11px] text-[#9e9788] truncate font-mono-num">
            {sandbox.activeMap.mapDefinitionId.toUpperCase()} · Ур.{avatar.level} ·{' '}
            {SPEC_LABELS[avatar.specialization]} · {walletDenom.gold}G {walletDenom.silver}S{' '}
            {walletDenom.copper}C
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const fresh = createInitialVerticalSliceSandbox();
              setSandbox(fresh);
              setSelectedHeroId(fresh.campaign.avatarId);
              setLastCombatSummary('');
              setSaveRepo(createEmptySaveRepository());
              setSimInCombat(false);
              setDemoCorpse({
                corpseId: 'corpse_demo_01',
                nameRu: 'Останки налётчика (тест §3.1)',
                state: 'fresh',
                bonesRemaining: 4,
                bonesLooted: false,
                hasSpirit: true,
                spiritHintRu: 'Скриптованный дух: путь к узлу сектора лежит через северные врата.',
              });
              setFeedback({ ok: true, text: 'Состояние тестового полигона сброшено к исходному.' });
            }}
            className="min-h-[44px] px-3 py-2 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs font-medium text-[#d6cfc0] rounded cursor-pointer whitespace-nowrap"
          >
            Сброс
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-3.5 py-2 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer whitespace-nowrap"
          >
            Закрыть
          </button>
        </div>
      </header>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 max-w-6xl w-full mx-auto">
        {/* Action Feedback Banner */}
        {feedback && (
          <div
            className={`px-3.5 py-2.5 rounded border text-xs sm:text-sm ${
              feedback.ok
                ? 'bg-[#132019] border-[#2e6f49] text-[#a7e3be]'
                : 'bg-[#261416] border-[#7f2d34] text-[#f5b4b8]'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* TAB 1: HERO & PROGRESSION */}
        {activeTab === 'hero' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Hero Overview + XP + Respec + Party Companions (§317) */}
            <section className="lg:col-span-5 bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-base font-bold text-[#f2ece0]">{inspectedHero.nameRu}</h3>
                  <p className="text-xs text-[#9e9788] mt-0.5">
                    Профиль:{' '}
                    <span className="text-[#c49a45] font-medium">
                      {SPEC_LABELS[inspectedHero.specialization]}
                    </span>
                  </p>
                </div>
                <div className="text-right font-mono-num text-xs">
                  <div className="text-[#f2ece0] font-semibold">Уровень {inspectedHero.level}</div>
                  <div className="text-[#9e9788]">
                    XP {inspectedHero.xp} / {inspectedHero.xpToNext}
                  </div>
                </div>
              </div>

              {/* Multi-Hero Party (§317, §351.2) */}
              <div className="p-3 rounded bg-[#161a24] border border-[#2a3142] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#c49a45]">
                    Активная группа героев ({sandbox.campaign.activePartyHeroIds.length}/
                    {DEFAULT_WORKING_ASSUMPTIONS.maxActivePartyHeroes} · §317)
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sandbox.campaign.activePartyHeroIds.map((hId) => {
                    const h = sandbox.campaign.heroes[hId];
                    if (!h) return null;
                    const active = hId === inspectedHeroId;
                    return (
                      <button
                        key={hId}
                        type="button"
                        onClick={() => setSelectedHeroId(hId)}
                        className={`min-h-[44px] px-3 py-1.5 text-xs rounded border cursor-pointer ${
                          active
                            ? 'bg-[#c49a45] text-[#101218] border-[#c49a45] font-semibold'
                            : 'bg-[#171b25] text-[#d6cfc0] border-[#2e364a] hover:bg-[#202635]'
                        }`}
                      >
                        {h.isAvatar ? 'Аватар' : h.nameRu}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = sandbox.campaign.activePartyHeroIds.length;
                      const compId = `hero_companion_${nextIdx}`;
                      mutateSandbox((draft) => {
                        const r = summonCompanionHeroToParty({
                          campaign: draft.campaign,
                          heroId: compId,
                          nameRu: `Спутник #${nextIdx}`,
                        });
                        if (r.ok) setSelectedHeroId(compId);
                        return {
                          ok: r.ok,
                          text: r.ok
                            ? `Призван герой-спутник "${r.hero?.nameRu}" (общий PartyInventory, индивидуальная экипировка §317).`
                            : r.reason ?? 'Невозможно призвать спутника.',
                        };
                      }, 'COMPANION_SUMMONED');
                    }}
                    className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium text-[#eae3d2] rounded cursor-pointer"
                  >
                    + Призвать спутника
                  </button>
                  {!inspectedHero.isAvatar && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = inspectedHeroId;
                        mutateSandbox((draft) => {
                          const r = dismissPartyHero(draft.campaign, targetId);
                          if (r.ok) setSelectedHeroId(draft.campaign.avatarId);
                          return {
                            ok: r.ok,
                            text: r.ok ? 'Спутник отпущен из активной группы.' : r.reason ?? '',
                          };
                        });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#2a1719] hover:bg-[#381e21] border border-[#6e3238] text-xs text-[#f5b4b8] rounded cursor-pointer"
                    >
                      Отпустить
                    </button>
                  )}
                </div>
              </div>

              {/* Vital Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono-num">
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d]">
                  <div className="text-[11px] text-[#8f8879]">HP (§33.3)</div>
                  <div className="text-sm font-semibold text-[#eae3d2]">
                    {Math.round(inspectedHero.hp)} / {derived.maxHp}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d]">
                  <div className="text-[11px] text-[#8f8879]">Мана (§33.4)</div>
                  <div className="text-sm font-semibold text-[#93c5fd]">
                    {Math.round(inspectedHero.mana)} / {derived.maxMana}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d]">
                  <div className="text-[11px] text-[#8f8879]">Реген маны</div>
                  <div className="text-sm font-semibold text-[#93c5fd]">
                    {derived.manaRegenPerSec}/с
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d]">
                  <div className="text-[11px] text-[#8f8879]">Броня</div>
                  <div className="text-sm font-semibold text-[#eae3d2]">
                    {derived.armorFromEquipment}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d]">
                  <div className="text-[11px] text-[#8f8879]">Оружие (база)</div>
                  <div className="text-sm font-semibold text-[#eae3d2]">
                    {derived.weaponBaseDamage}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d]">
                  <div className="text-[11px] text-[#8f8879]">Спец. индекс</div>
                  <div className="text-xs font-semibold text-[#c49a45]">
                    Ф:{specCalc.physicalNorm.toFixed(2)} / М:{specCalc.magicalNorm.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 3 Non-Convertible Unspent Pools */}
              <div className="p-3 rounded bg-[#161a24] border border-[#c49a45]/30 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#c49a45]">
                    Три независимых пула очков (§26.1)
                  </span>
                  {inspectedHero.hasUnspentLevelNotification && (
                    <span className="text-[11px] text-[#facc15]">Есть нераспределённые очки</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono-num text-center">
                  <div className="p-2 rounded bg-[#12151d] border border-[#262d3d]">
                    <div className="text-[10px] text-[#8f8879]">Атрибуты</div>
                    <div className="text-base font-bold text-[#f2ece0]">
                      {inspectedHero.unspent.attributePoints}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#12151d] border border-[#262d3d]">
                    <div className="text-[10px] text-[#8f8879]">Мастерство</div>
                    <div className="text-base font-bold text-[#f2ece0]">
                      {inspectedHero.unspent.combatMasteryPoints}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#12151d] border border-[#262d3d]">
                    <div className="text-[10px] text-[#8f8879]">Магия</div>
                    <div className="text-base font-bold text-[#93c5fd]">
                      {inspectedHero.unspent.magicPoints}
                    </div>
                  </div>
                </div>
              </div>

              {/* Progression Simulation Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    mutateSandbox((draft) => {
                      const res = grantHeroExperience(draft.campaign, inspectedHeroId, 200, 'variant_raider_01');
                      return {
                        ok: true,
                        text: `Получено ${res.grantedXp} XP (учёт diminishing returns §1.7). Повышений уровня: ${res.levelUps.length}.`,
                      };
                    }, 'HERO_XP_GAINED')
                  }
                  className="min-h-[44px] px-3 py-2 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                >
                  +200 XP (повторный враг §1.7)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    mutateSandbox((draft) => {
                      const res = respecHeroBeforeMapTransition(draft.campaign, inspectedHeroId);
                      return {
                        ok: res.ok,
                        text: res.ok
                          ? 'Очки перераспределены до перехода на следующую карту (§1.12).'
                          : res.reason ?? 'Ошибка respec.',
                      };
                    }, 'HERO_RESPEC')
                  }
                  className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded border cursor-pointer ${
                    inspectedHero.respecWindowOpen
                      ? 'bg-[#1c2230] hover:bg-[#252d40] border-[#c49a45]/45 text-[#eae3d2]'
                      : 'bg-[#161922] border-[#2a2f3d] text-[#6d7485]'
                  }`}
                >
                  Respec ({inspectedHero.respecWindowOpen ? 'окно открыто' : 'заблокировано §1.12'})
                </button>
              </div>
            </section>

            {/* 7 Attributes & 6 Combat Masteries */}
            <section className="lg:col-span-7 space-y-4">
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4">
                <h3 className="font-display text-sm font-bold text-[#c49a45] mb-3">
                  7 базовых атрибутов (§1.4) · Разрешено распределение в бою
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(ATTRIBUTE_LABELS) as AttributeId[]).map((attr) => {
                    const baseVal = inspectedHero.baseAttributes[attr];
                    const effVal = derived.effectiveAttributes[attr];
                    const gearDelta = effVal - baseVal;
                    return (
                      <div
                        key={attr}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[#171b25] border border-[#262d3d]"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#eae3d2] truncate">
                            {ATTRIBUTE_LABELS[attr]}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#9e9788]">
                            База: {baseVal}
                            {gearDelta !== 0 ? ` (+${gearDelta} экип.)` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={inspectedHero.unspent.attributePoints < 1}
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const r = allocateAttributePoint(draft.campaign, inspectedHeroId, attr);
                              return {
                                ok: r.ok,
                                text: r.ok ? `Атрибут ${attr} повышен.` : r.reason ?? 'Ошибка',
                              };
                            })
                          }
                          className="min-h-[44px] min-w-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] disabled:opacity-40 border border-[#3a445b] text-xs font-semibold text-[#f2ece0] rounded cursor-pointer disabled:cursor-not-allowed"
                        >
                          +1
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4">
                <h3 className="font-display text-sm font-bold text-[#c49a45] mb-3">
                  6 направлений боевого мастерства (§1.6)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(COMBAT_MASTERY_LABELS) as CombatMasteryId[]).map((mId) => (
                    <div
                      key={mId}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[#171b25] border border-[#262d3d]"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#eae3d2] truncate">
                          {COMBAT_MASTERY_LABELS[mId]}
                        </div>
                        <div className="text-[11px] font-mono-num text-[#9e9788]">
                          Уровень: {inspectedHero.combatMasteries[mId]} / 100
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={inspectedHero.unspent.combatMasteryPoints < 1}
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const r = allocateCombatMasteryPoint(draft.campaign, inspectedHeroId, mId);
                            return {
                              ok: r.ok,
                              text: r.ok ? `${COMBAT_MASTERY_LABELS[mId]} повышено.` : r.reason ?? 'Ошибка',
                            };
                          })
                        }
                        className="min-h-[44px] min-w-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] disabled:opacity-40 border border-[#3a445b] text-xs font-semibold text-[#f2ece0] rounded cursor-pointer disabled:cursor-not-allowed"
                      >
                        +1
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: MAGIC, GRIMOIRE, COMBAT, NECROMANCY & SQUAD */}
        {activeTab === 'magic_combat' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Magic Schools + Dark Branches */}
            <section className="lg:col-span-6 space-y-4">
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    6 школ магии (AC-OWNER-007)
                  </h3>
                  <span className="text-xs font-mono-num text-[#93c5fd]">
                    Очки магии: {avatar.unspent.magicPoints}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(MAGIC_SCHOOL_LABELS) as MagicSchoolId[])
                    .filter((s) => s !== 'dark')
                    .map((school) => (
                      <div
                        key={school}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[#171b25] border border-[#262d3d]"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#eae3d2] truncate">
                            {MAGIC_SCHOOL_LABELS[school]}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#9e9788]">
                            Мастерство: {avatar.schoolMasteries[school]}
                            {(avatar.schoolProgressBySchool?.[school] ?? 0) > 0
                              ? ` (+${Math.round((avatar.schoolProgressBySchool?.[school] ?? 0) * 100)}%)`
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={avatar.unspent.magicPoints < 1}
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const r = allocateMagicSchoolPoint(draft.campaign, draft.campaign.avatarId, school);
                              return {
                                ok: r.ok,
                                text: r.ok ? `${MAGIC_SCHOOL_LABELS[school]} повышена.` : r.reason ?? 'Ошибка',
                              };
                            })
                          }
                          className="min-h-[44px] min-w-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] disabled:opacity-40 border border-[#3a445b] text-xs font-semibold text-[#f2ece0] rounded cursor-pointer disabled:cursor-not-allowed"
                        >
                          +1
                        </button>
                      </div>
                    ))}
                </div>

                <div className="pt-2 border-t border-[#262d3d]">
                  <h4 className="text-xs font-semibold text-[#c49a45] mb-2">
                    Тёмная магия · 6 независимых ветвей (§3, без слияния)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(Object.keys(DARK_BRANCH_LABELS) as DarkBranchId[]).map((branch) => (
                      <div
                        key={branch}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[#171b25] border border-[#2d2333]"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#eae3d2] truncate">
                            {DARK_BRANCH_LABELS[branch]}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#9e9788]">
                            Уровень: {avatar.darkBranchMasteries[branch]}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={avatar.unspent.magicPoints < 1}
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const r = allocateMagicSchoolPoint(
                                draft.campaign,
                                draft.campaign.avatarId,
                                'dark',
                                branch
                              );
                              return {
                                ok: r.ok,
                                text: r.ok ? `Ветвь ${DARK_BRANCH_LABELS[branch]} повышена.` : r.reason ?? 'Ошибка',
                              };
                            })
                          }
                          className="min-h-[44px] min-w-[44px] px-3 bg-[#241b2e] hover:bg-[#312440] disabled:opacity-40 border border-[#4a3560] text-xs font-semibold text-[#f2ece0] rounded cursor-pointer disabled:cursor-not-allowed"
                        >
                          +1
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Grimoire & MagicStrain */}
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Гримуар и MagicStrain (§2.1, §43)
                  </h3>
                  <div className="text-xs font-mono-num">
                    Нагрузка:{' '}
                    <span
                      className={
                        avatar.magicStrain.status === 'critical'
                          ? 'text-[#f87171]'
                          : avatar.magicStrain.status === 'elevated'
                            ? 'text-[#facc15]'
                            : 'text-[#86efac]'
                      }
                    >
                      {avatar.magicStrain.index} ({STRAIN_LABELS[avatar.magicStrain.status]})
                    </span>
                  </div>
                </div>

                {pendingSpellId && PROTOTYPE_SPELLS[pendingSpellId] && (
                  <div className="p-3 rounded bg-[#1b2232] border border-[#c49a45]/60 space-y-2">
                    <div className="text-xs font-semibold text-[#f2ece0]">
                      Предвыбор цели заклинания (§348.4): {PROTOTYPE_SPELLS[pendingSpellId].nameRu}
                    </div>
                    <p className="text-[11px] text-[#c5beae]">
                      Мана ({computeSpellManaCost(avatar, pendingSpellId)}) спишется только после подтверждения. Отмена безопасна.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const spId = pendingSpellId;
                          const spell = PROTOTYPE_SPELLS[spId];
                          setPendingSpellId(null);
                          mutateSandbox((draft) => {
                            const r = startSpellCast(
                              draft.campaign,
                              draft.campaign.avatarId,
                              spId
                            );
                            if (r.ok && spId === 'spell_dark_raise_skeleton') {
                              draft.activeMap.necromancyMinions.push({
                                minionId: `skel_${draft.activeMap.necromancyMinions.length + 1}`,
                                kind: 'skeleton',
                                mode: 'Active',
                                residualDrainPerSec: 4,
                                manaUpkeepPerSec: 2,
                                currentOrder: 'Follow',
                              });
                            }
                            return {
                              ok: r.ok,
                              text: r.ok
                                ? `Каст "${spell.nameRu}": списано ${r.manaSpent} маны${r.bloodHpSpent ? ` и ${r.bloodHpSpent} HP` : ''}, сила ${r.effectPower}.`
                                : r.reason ?? 'Каст отклонён.',
                            };
                          });
                        }}
                        className="min-h-[44px] px-3 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                      >
                        Подтвердить цель и применить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingSpellId(null);
                          setFeedback({
                            ok: true,
                            text: 'Выбор цели заклинания отменён: мана и MagicStrain не потрачены (§348.4).',
                          });
                        }}
                        className="min-h-[44px] px-3 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                      >
                        Отмена (без траты маны)
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {Object.values(PROTOTYPE_SPELLS).map((spell) => {
                    const st = avatar.spells[spell.spellId] ?? {
                      spellId: spell.spellId,
                      acquisitionState: 'Unknown',
                      rank: 0,
                    };
                    const manaCost = computeSpellManaCost(avatar, spell.spellId);
                    const castTime = computeSpellCastTime(avatar, spell.spellId);
                    return (
                      <div
                        key={spell.spellId}
                        className="p-3 rounded bg-[#171b25] border border-[#262d3d] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#eae3d2]">
                            {spell.nameRu} {st.rank > 0 ? `(Ранг ${st.rank})` : ''}
                          </div>
                          <div className="text-[11px] text-[#9e9788] font-mono-num">
                            Статус: {st.acquisitionState} · Мана {manaCost}
                            {spell.bloodHpCost ? ` · Кровь ${spell.bloodHpCost} HP` : ''} · Каст {castTime}с ·
                            Strain +{spell.magicStrainContribution}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {st.acquisitionState !== 'Unknown' && st.rank < spell.maxRank && (
                            <button
                              type="button"
                              disabled={avatar.unspent.magicPoints < 1}
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const r = learnOrUpgradeSpell(
                                    draft.campaign,
                                    draft.campaign.avatarId,
                                    spell.spellId
                                  );
                                  return {
                                    ok: r.ok,
                                    text: r.ok
                                      ? `Заклинание "${spell.nameRu}" изучено/усилено.`
                                      : r.reason ?? 'Невозможно изучить.',
                                  };
                                })
                              }
                              className="min-h-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] disabled:opacity-40 border border-[#3a445b] text-xs font-medium rounded cursor-pointer disabled:cursor-not-allowed"
                            >
                              {st.rank === 0 ? 'Изучить' : '+Ранг'}
                            </button>
                          )}
                          {st.acquisitionState === 'Learned' && (
                            <button
                              type="button"
                              onClick={() => setPendingSpellId(spell.spellId)}
                              className="min-h-[44px] px-3 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                            >
                              Выбрать цель (§348.4)
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Combat Pipeline + Necromancy + Avatar Death + Squad AI */}
            <section className="lg:col-span-6 space-y-4">
              {/* §237 Combat Pipeline */}
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <h3 className="font-display text-sm font-bold text-[#c49a45]">
                  Единый боевой конвейер (§237, §1.2)
                </h3>
                <p className="text-xs text-[#9e9788]">
                  Физический урон проходит через Armor; магический — только через Resistance с потолком +75% (абсолютный иммунитет 100% заблокирован).
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const rawPhys = computeRawPhysicalDamage(
                        derived.weaponBaseDamage,
                        derived.effectiveAttributes.STR,
                        avatar.combatMasteries.one_handed
                      );
                      const log = resolveCombatPackets({
                        attackerDex: derived.effectiveAttributes.DEX,
                        target: {
                          id: 'dummy_boss_01',
                          nameRu: 'Манекен-босс (Armor 100, FireRes запрашивает 1.0 -> clamp 0.75)',
                          hp: 300,
                          maxHp: 300,
                          agi: 12,
                          armor: 100,
                          hasShield: false,
                          shieldMastery: 0,
                          resistances: { fire: clampResistance(1.0) },
                          isBossOrElite: true,
                        },
                        packets: [
                          {
                            type: 'physical',
                            rawAmount: rawPhys,
                            canHitCheck: true,
                            canBeBlockedByShield: true,
                            fromFrontArc: true,
                          },
                          {
                            type: 'fire',
                            rawAmount: 40,
                            canHitCheck: false,
                            canBeBlockedByShield: false,
                            fromFrontArc: false,
                          },
                        ],
                        hitRollPct: 10,
                        blockRollPct: 99,
                      });
                      setLastCombatSummary(
                        `Попадание ${log.hitChancePct.toFixed(1)}% -> Итог: ${log.totalFinalDamage} (Физ после Armor=100: ${log.packetBreakdown[0]?.afterResistance}, Огонь при clamp(1.0)=0.75: ${log.packetBreakdown[1]?.afterResistance}).`
                      );
                    }}
                    className="min-h-[44px] px-4 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#c49a45]/45 text-xs font-semibold rounded cursor-pointer"
                  >
                    Тест смешанного удара (§237)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const res = applyControlEffect(
                          draft.activeMap,
                          'dummy_boss_01',
                          'fear',
                          6,
                          draft.activeMap.simulationTimeSec
                        );
                        return {
                          ok: true,
                          text: res.applied
                            ? `Контроль #${res.applicationNumber} (§42.4 DR): длительность ${res.effectiveDurationSec}с (фактор ${res.factorUsed}).`
                            : `Контроль #${res.applicationNumber} (§42.4 DR): цель временно невосприимчива в окне сопротивления.`,
                        };
                      })
                    }
                    className="min-h-[44px] px-4 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-semibold rounded cursor-pointer"
                  >
                    Повторный контроль Fear (§42.4)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const order = squadAlpha?.playerOrder ?? 'Idle';
                      const list = filterAutoCastEligibleSpells(avatar, order);
                      const allowed = list.filter((i) => i.eligible).map((i) => i.spellId);
                      const blocked = list.filter((i) => !i.eligible).length;
                      setLastCombatSummary(
                        `Белый список автокаста (§337.3 при ${order}): разрешено [${allowed.join(', ') || 'нет'}], заблокировано ${blocked} (AoE/призывы/резерв).`
                      );
                    }}
                    className="min-h-[44px] px-4 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-semibold rounded cursor-pointer"
                  >
                    Проверка автокаста (§337.3)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const audit = runMandatoryCombatMatrixAudit();
                      const summary = audit.checks
                        .map((c) => `${c.id}:${c.passed ? 'OK' : 'FAIL'}(${c.metric})`)
                        .join(' · ');
                      setLastCombatSummary(`Аудит §36.1: ${audit.allPassed ? 'PASS' : 'FAIL'} — ${summary}`);
                      setFeedback({
                        ok: audit.allPassed,
                        text: audit.allPassed
                          ? `Аудит боевых формул §36.1 пройден (${audit.checks.length}/${audit.checks.length}).`
                          : 'Обнаружены расхождения в аудите §36.1.',
                      });
                    }}
                    className="min-h-[44px] px-4 py-2 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-xs font-semibold rounded cursor-pointer"
                  >
                    Аудит формул §36.1
                  </button>
                </div>
                {lastCombatSummary && (
                  <div className="p-2.5 rounded bg-[#171b25] border border-[#2d364a] text-xs font-mono-num text-[#d6cfc0]">
                    {lastCombatSummary}
                  </div>
                )}

                {/* §§4–5 APPROVED Mind Magic non-omnipotence check */}
                {sandbox.activeMap.squadRoster?.squad_enemy_patrol && (
                  <div className="pt-2 border-t border-[#262d3d] space-y-2">
                    <div className="text-xs font-semibold text-[#c49a45]">
                      Магия разума без всесилия (§§4–5 APPROVED, §42.4 DR)
                    </div>
                    <div className="text-[11px] font-mono-num text-[#9e9788]">
                      Патруль: {sandbox.activeMap.squadRoster.squad_enemy_patrol.allegiance} · приказ{' '}
                      {sandbox.activeMap.squadRoster.squad_enemy_patrol.command.playerOrder}
                      {sandbox.activeMap.squadRoster.squad_enemy_patrol.activeMindInfluence
                        ? ` · эффект ${sandbox.activeMap.squadRoster.squad_enemy_patrol.activeMindInfluence.effectKind} (${sandbox.activeMap.squadRoster.squad_enemy_patrol.activeMindInfluence.remainingSec}с)`
                        : ''}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const patrol = draft.activeMap.squadRoster?.squad_enemy_patrol;
                            if (!patrol) return { ok: false, text: 'Патруль не найден.' };
                            const r = applyMindEffectToTarget({
                              map: draft.activeMap,
                              casterHero: draft.campaign.heroes[draft.campaign.avatarId],
                              targetSquad: patrol,
                              effectKind: 'fear',
                              baseDurationSec: 8,
                              currentTimeSec: draft.activeMap.simulationTimeSec,
                            });
                            return {
                              ok: r.ok,
                              text: r.ok
                                ? `Fear применён к патрулю на ${r.effectiveDurationSec}с (приказ: Retreat, с учётом DR §42.4).`
                                : r.reason ?? '',
                            };
                          })
                        }
                        className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                      >
                        Fear на патруль
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const patrol = draft.activeMap.squadRoster?.squad_enemy_patrol;
                            if (!patrol) return { ok: false, text: 'Патруль не найден.' };
                            const r = applyMindEffectToTarget({
                              map: draft.activeMap,
                              casterHero: draft.campaign.heroes[draft.campaign.avatarId],
                              targetSquad: patrol,
                              effectKind: 'charm',
                              baseDurationSec: 8,
                              currentTimeSec: draft.activeMap.simulationTimeSec,
                            });
                            return {
                              ok: r.ok,
                              text: r.ok
                                ? `Charm применён на ${r.effectiveDurationSec}с -> временный статус ${r.resultingAllegiance}.`
                                : r.reason ?? '',
                            };
                          })
                        }
                        className="min-h-[44px] px-3 py-1.5 bg-[#241b2e] hover:bg-[#312440] border border-[#4a3560] text-xs rounded cursor-pointer"
                      >
                        Charm на патруль
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const patrol = draft.activeMap.squadRoster?.squad_enemy_patrol;
                            if (!patrol) return { ok: false, text: 'Патруль не найден.' };
                            const r = tickMindEffectsExpiry(patrol, 10);
                            return {
                              ok: true,
                              text: r.expired
                                ? `Эффект Магии разума истёк: возвращён исходный статус ${patrol.allegiance}.`
                                : 'Активного эффекта Магии разума нет или срок не истёк.',
                            };
                          })
                        }
                        className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                      >
                        Тик эффекта (+10с)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const boss = draft.activeMap.squadRoster?.squad_neutral_demon;
                            if (!boss) return { ok: false, text: 'Босс не найден.' };
                            const r = applyMindEffectToTarget({
                              map: draft.activeMap,
                              casterHero: draft.campaign.heroes[draft.campaign.avatarId],
                              targetSquad: boss,
                              effectKind: 'charm',
                              baseDurationSec: 8,
                              currentTimeSec: draft.activeMap.simulationTimeSec,
                            });
                            return {
                              ok: r.ok,
                              text: r.ok ? 'Применено.' : r.reason ?? 'Заблокировано.',
                            };
                          })
                        }
                        className="min-h-[44px] px-3 py-1.5 bg-[#2a1719] hover:bg-[#381e21] border border-[#6e3238] text-xs text-[#f5b4b8] rounded cursor-pointer"
                      >
                        Тест: Charm на босса (запрет §5)
                      </button>
                    </div>
                  </div>
                )}

                {/* §§40.3–40.4 Active Cast & Interrupt without Mana Refund */}
                <div className="pt-2 border-t border-[#262d3d] space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num">
                    <span className="font-semibold text-[#eae3d2]">
                      Активный каст (§40.3–40.4):{' '}
                      {avatar.activeCast
                        ? `${PROTOTYPE_SPELLS[avatar.activeCast.spellId]?.nameRu ?? avatar.activeCast.spellId} (${avatar.activeCast.remainingCastTimeSec}с / порог ${avatar.activeCast.castStabilityThreshold})`
                        : 'нет'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const r = beginHeroCast(
                            draft.campaign,
                            draft.campaign.avatarId,
                            'spell_elem_fire_bolt',
                            'dummy_boss_01'
                          );
                          return {
                            ok: r.ok,
                            text: r.ok
                              ? `Начат каст (списано ${r.cast?.manaAlreadySpent} маны, порог стабильности ${r.cast?.castStabilityThreshold}).`
                              : r.reason ?? 'Невозможно начать каст.',
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Начать каст (§40.3)
                    </button>
                    <button
                      type="button"
                      disabled={!avatar.activeCast}
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const hero = draft.campaign.heroes[draft.campaign.avatarId];
                          const r = applyCombatInterruptToHeroCast(hero, 25);
                          return {
                            ok: r.interrupted,
                            text: r.interrupted
                              ? `Каст прерван уроном 25 > порога! Возврат маны: ${r.manaRefunded} (§40.4).`
                              : 'Нет активного каста или урон не превысил CastStability.',
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#341a1e] hover:bg-[#462227] disabled:opacity-40 border border-[#7c3740] text-xs rounded cursor-pointer"
                    >
                      Прервать уроном (&gt;Stability, без возврата маны)
                    </button>
                    <button
                      type="button"
                      disabled={!avatar.activeCast}
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const hero = draft.campaign.heroes[draft.campaign.avatarId];
                          const r = advanceHeroActiveCast(hero, 5);
                          return {
                            ok: r.completed,
                            text: r.completed
                              ? `Каст "${r.spellId}" завершён с силой ${r.effectPower}.`
                              : 'Нет активного каста.',
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#243227] hover:bg-[#2f4233] disabled:opacity-40 border border-[#446b4b] text-xs rounded cursor-pointer"
                    >
                      Завершить каст
                    </button>
                  </div>
                </div>
              </div>

              {/* §§103-105 Necromancy & §288 Avatar Death */}
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Некромантия (§105) и Stone of Souls (§288)
                  </h3>
                  <span className="text-xs font-mono-num text-[#9e9788]">
                    Аватар: {avatar.deathState.lifecycle}
                    {avatar.deathState.lifecycle === 'RespawnPending'
                      ? ` (${avatar.deathState.respawnRemainingSec}с)`
                      : ''}
                  </span>
                </div>

                <div className="text-xs font-mono-num text-[#c5beae] space-y-1">
                  <div>
                    Активный Stone of Souls: {sandbox.activeMap.activeStoneOfSoulsId} · Задержка возрождения: 120с
                  </div>
                  <div>
                    Нежить: {sandbox.activeMap.necromancyMinions.length} (
                    {sandbox.activeMap.necromancyMinions.map((m) => m.mode).join(', ') || 'нет'}) · Пул автономии:{' '}
                    {sandbox.activeMap.necromancyAutonomy.remainingPool}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const evtId = `death_${draft.activeMap.simulationTimeSec}_${draft.campaign.processedEventIds.length}`;
                        const res = triggerAvatarDeath(draft.campaign, draft.activeMap, evtId);
                        const mStatus = evaluateMissionStatusAfterAvatarDeath(draft.mission, false);
                        return {
                          ok: res.applied,
                          text: res.applied
                            ? `Аватар пал (потеряно ${res.xpLost} XP по OD-001). Таймер Stone of Souls: 120с. Статус миссии: ${mStatus} (§341.5, §346.9).`
                            : 'Смерть уже обработана.',
                        };
                      }, 'AVATAR_DIED', 'MapInstance')
                    }
                    className="min-h-[44px] px-3 py-2 bg-[#341a1e] hover:bg-[#462227] border border-[#7c3740] text-xs font-semibold rounded cursor-pointer"
                  >
                    Симулировать смерть Аватара (§288)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const dt = 30;
                        draft.activeMap.simulationTimeSec += dt;
                        const hero = draft.campaign.heroes[draft.campaign.avatarId];
                        tickMagicStrainDecay(hero, dt);
                        const resp = advanceAvatarRespawnTimer(draft.campaign, draft.activeMap, dt);
                        const nec = tickNecromancyMinions(hero, draft.activeMap, dt);
                        return {
                          ok: true,
                          text: `Симуляция +30с: ${resp.respawned ? 'Аватар возродился у Stone of Souls! ' : ''}Уснуло нежити: ${nec.transitionedToDormant.length}.`,
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-semibold rounded cursor-pointer"
                  >
                    Шаг симуляции +30с
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const hero = draft.campaign.heroes[draft.campaign.avatarId];
                        const r = reraiseDormantMinions(hero, draft.activeMap);
                        return {
                          ok: r.raisedCount > 0,
                          text:
                            r.raisedCount > 0
                              ? `Повторно поднято нежити из Dormant_NoMana: ${r.raisedCount}.`
                              : 'Нет нежити в Dormant_NoMana или недостаточно маны / Аватар мёртв.',
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium rounded cursor-pointer sm:col-span-2"
                  >
                    Повторно поднять Dormant_NoMana нежить (§105.2)
                  </button>
                </div>

                {/* §3.1 APPROVED: Bones, Bone Warrior cost, Decayed corpse block, Spirit dialogue-only */}
                <div className="pt-2 border-t border-[#262d3d] space-y-2">
                  <div className="text-xs font-mono-num text-[#d6cfc0]">
                    Некромантия §3.1 · Кости: <span className="text-[#facc15]">{avatar.bonesCount ?? 0}</span> · Цена Костяного воина:{' '}
                    <span className="text-[#93c5fd]">{computeBoneWarriorBonesCost(avatar)} костей</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const corpseCopy: CorpseEntity = { ...demoCorpse };
                        mutateSandbox((draft) => {
                          const hero = draft.campaign.heroes[draft.campaign.avatarId];
                          const r = lootBonesFromCorpse(hero, corpseCopy, true);
                          if (r.ok) setDemoCorpse(corpseCopy);
                          return {
                            ok: r.ok,
                            text: r.ok
                              ? `Собрано костей: ${r.bonesGained} (всего у Аватара: ${hero.bonesCount ?? 0}).`
                              : r.reason ?? '',
                          };
                        });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Собрать кости ({demoCorpse.bonesRemaining})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const r = createBoneWarriorFromBones(
                            draft.campaign,
                            draft.activeMap,
                            draft.campaign.avatarId
                          );
                          return {
                            ok: r.ok,
                            text: r.ok
                              ? `Создан Костяной воин (${r.minionId}), потрачено ${r.bonesSpent} костей (§3.1).`
                              : r.reason ?? '',
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#241b2e] hover:bg-[#312440] border border-[#4a3560] text-xs rounded cursor-pointer"
                    >
                      Создать Костяного воина
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const hero = draft.campaign.heroes[draft.campaign.avatarId];
                          const decayed: CorpseEntity = {
                            corpseId: 'corpse_decayed_test',
                            nameRu: 'Истлевшие останки',
                            state: 'decayed',
                            bonesRemaining: 0,
                            bonesLooted: true,
                            hasSpirit: false,
                          };
                          const r = reraiseCorpseForNecromancy(hero, draft.activeMap, decayed);
                          return {
                            ok: r.ok,
                            text: r.ok ? 'Воскрешено.' : r.reason ?? 'Заблокировано.',
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#2a1719] hover:bg-[#381e21] border border-[#6e3238] text-xs text-[#f5b4b8] rounded cursor-pointer"
                    >
                      Тест: decayed труп (запрет)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const r = interactWithCorpseSpirit(demoCorpse, 'dialogue');
                        setFeedback({ ok: r.ok, text: r.hintRu ?? r.reason ?? '' });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Дух: диалог
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const r = interactWithCorpseSpirit(demoCorpse, 'subjugate');
                        setFeedback({ ok: r.ok, text: r.reason ?? '' });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#2a1719] hover:bg-[#381e21] border border-[#6e3238] text-xs text-[#f5b4b8] rounded cursor-pointer"
                    >
                      Тест: подчинить духа (запрет)
                    </button>
                  </div>
                </div>
              </div>

              {/* §337.2 Squad PlayerOrder vs LocalReaction */}
              {squadAlpha && (
                <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-2.5">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Отряд: PlayerOrder vs LocalReaction (§337.2, §343.6)
                  </h3>
                  <div className="text-xs font-mono-num text-[#d6cfc0]">
                    Приказ игрока: <span className="text-[#facc15]">{squadAlpha.playerOrder}</span> · Реакция:{' '}
                    <span className="text-[#93c5fd]">{squadAlpha.localReaction}</span>
                    {squadAlpha.statusReason ? ` (${squadAlpha.statusReason})` : ''}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          draft.activeMap.squads.squad_alpha = issueSquadPlayerOrder(
                            draft.activeMap.squads.squad_alpha,
                            'HoldPosition'
                          );
                          return { ok: true, text: 'Отдан прямой приказ HoldPosition.' };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      HoldPosition
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          draft.activeMap.squads.squad_alpha = issueSquadPlayerOrder(
                            draft.activeMap.squads.squad_alpha,
                            'MoveTo',
                            { x: 30, y: 20 }
                          );
                          return { ok: true, text: 'Отдан прямой приказ MoveTo.' };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      MoveTo
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          draft.activeMap.squads.squad_alpha = triggerSquadLocalReaction(
                            draft.activeMap.squads.squad_alpha,
                            'enemy_scout_01',
                            4.5
                          );
                          return { ok: true, text: 'Обработана локальная угроза на дистанции 4.5.' };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Угроза (4.5м)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          draft.activeMap.squads.squad_alpha = completeSquadLocalReaction(
                            draft.activeMap.squads.squad_alpha
                          );
                          return { ok: true, text: 'Угроза устранена — возврат к сохранённому PlayerOrder.' };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Снять угрозу
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 3: SETTLEMENT ECONOMY (§§338-339) & SQUAD ROSTER / ENEMY AI (§343) */}
        {activeTab === 'settlement' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Local Settlement Economy */}
            <section className="lg:col-span-6 space-y-4">
              {Object.values(sandbox.activeMap.localSettlements).length === 0 ? (
                <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 text-xs text-[#9e9788]">
                  На текущей карте ({sandbox.activeMap.mapDefinitionId}) нет активного локального поселения — ресурсы прошлой карты не перетекают сюда автоматически (§338.1, §341.3).
                </div>
              ) : (
                Object.values(sandbox.activeMap.localSettlements).map((settlement) => (
                  <div key={settlement.settlementId} className="space-y-4">
                    <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-[#c49a45]">
                          Локальное поселение ({PLAYABLE_RACES[settlement.raceId].nameRu} · §§338–339)
                        </h3>
                        <span className="text-xs font-mono-num text-[#93c5fd]">
                          Rune Power: {settlement.runePower}/{settlement.maxRunePower}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 font-mono-num text-center">
                        {(['wood', 'stone', 'iron', 'aria', 'food'] as const).map((rKey) => (
                          <div key={rKey} className="p-2 rounded bg-[#171b25] border border-[#262d3d]">
                            <div className="text-[10px] uppercase text-[#8f8879]">{rKey}</div>
                            <div className="text-sm font-bold text-[#f2ece0]">
                              {settlement.localResources[rKey] ?? 0}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-2 font-mono-num text-xs">
                        <div className="p-2 rounded bg-[#171b25] border border-[#262d3d]">
                          WorkerCap: {settlement.workersUsed} / {settlement.workerCap}
                        </div>
                        <div className="p-2 rounded bg-[#171b25] border border-[#262d3d]">
                          MilitaryCap: {settlement.militaryUsed} / {settlement.militaryCap}
                        </div>
                      </div>

                      <div className="text-[11px] text-[#9e9788]">
                        Food (§339.1): не тратится как периодический upkeep; повышает MilitaryCap и лечит через Food Store.
                        {settlement.stopReasons.length > 0 && (
                          <span className="text-[#facc15] block mt-1">
                            Диагностика остановки (§338.9): {settlement.stopReasons.join(', ')}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const s = draft.activeMap.localSettlements[settlement.settlementId];
                              const txId = `food_cap_${draft.campaign.processedEventIds.length + 1}`;
                              const r = upgradeMilitaryCapWithFood(draft.campaign, s, txId);
                              return {
                                ok: r.ok,
                                text: r.ok
                                  ? `MilitaryCap увеличен до ${r.newMilitaryCap} (потрачено ${r.foodSpent} Food).`
                                  : r.reason ?? '',
                              };
                            })
                          }
                          className="min-h-[44px] px-3 py-2 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                        >
                          +5 MilitaryCap за 15 Food
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const s = draft.activeMap.localSettlements[settlement.settlementId];
                              const sq = draft.activeMap.squadRoster?.squad_alpha;
                              if (!sq) return { ok: false, text: 'Отряд Альфа не найден.' };
                              const txId = `food_heal_${draft.campaign.processedEventIds.length + 1}`;
                              const r = healSquadWithFoodStore(draft.campaign, s, sq, txId);
                              return {
                                ok: r.ok,
                                text: r.ok
                                  ? `Food Store вылечил бойцов: ${r.unitsHealed} (потрачено ${r.foodSpent} Food; мёртвые не воскрешаются).`
                                  : r.reason ?? '',
                              };
                            })
                          }
                          className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-semibold rounded cursor-pointer"
                        >
                          Лечить отряд Альфа (Food Store)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const s = draft.activeMap.localSettlements[settlement.settlementId];
                              const orderId = `prod_${s.productionQueue.length + 1}_${draft.activeMap.simulationTimeSec}`;
                              const r = enqueueSquadProduction(
                                s,
                                orderId,
                                'sq_def_infantry',
                                { wood: 25, iron: 20 },
                                10,
                                4,
                                15
                              );
                              return {
                                ok: r.ok,
                                text: r.ok
                                  ? `Отряд поставлен в очередь (списано 25 wood, 20 iron, 10 Rune Power).`
                                  : r.reason ?? '',
                              };
                            })
                          }
                          className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium rounded cursor-pointer"
                        >
                          Нанять пехоту (-10 Rune Power)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const s = draft.activeMap.localSettlements[settlement.settlementId];
                              const r = tickSettlementProduction(draft.activeMap, s, 10);
                              return {
                                ok: true,
                                text: `Прогресс очереди +10с. Завершено заказов: ${r.completedOrderIds.length}, в очереди: ${s.productionQueue.length}.`,
                              };
                            })
                          }
                          className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium rounded cursor-pointer"
                        >
                          Тик очереди (+10с) · В очереди: {settlement.productionQueue.length}
                        </button>
                      </div>
                    </div>

                    {/* Workers & 4-stage resource model */}
                    <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-[#c49a45]">
                          Логистика рабочих (§338.2–338.3, §339.5)
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            mutateSandbox((draft) => {
                              const s = draft.activeMap.localSettlements[settlement.settlementId];
                              const dep = s.deposits.dep_wood_01;
                              dep.routeAccessible = !dep.routeAccessible;
                              return {
                                ok: true,
                                text: dep.routeAccessible
                                  ? 'Маршрут к лесу открыт.'
                                  : 'Маршрут к лесу заблокирован: груз Carried не зачислится до прохода (§338.3).',
                              };
                            })
                          }
                          className="min-h-[44px] px-2.5 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-[11px] rounded cursor-pointer"
                        >
                          Лес: {settlement.deposits.dep_wood_01?.routeAccessible ? 'Проходим' : 'Заблокирован'}
                        </button>
                      </div>

                      {Object.values(settlement.workers).map((w) => (
                        <div
                          key={w.workerId}
                          className="p-2.5 rounded bg-[#171b25] border border-[#262d3d] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="text-xs">
                            <div className="font-semibold text-[#eae3d2]">
                              {w.workerId} ({w.role}) → {w.assignedDepositId ?? 'свободен'}
                            </div>
                            <div className="text-[11px] font-mono-num text-[#9e9788]">
                              Груз Carried: {w.carrying ? `${w.carrying.amount} ${w.carrying.resourceType}` : 'пусто'}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const s = draft.activeMap.localSettlements[settlement.settlementId];
                                  const tx = `ext_${w.workerId}_${draft.campaign.processedEventIds.length + 1}`;
                                  const r = extractResourceToWorkerCarry(draft.campaign, s, w.workerId, 12, tx);
                                  return {
                                    ok: r.ok,
                                    text: r.ok ? `Добыто в Carried: ${r.carriedAmount}.` : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-[11px] rounded cursor-pointer"
                            >
                              Добыть
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const s = draft.activeMap.localSettlements[settlement.settlementId];
                                  const tx = `deliv_${w.workerId}_${draft.campaign.processedEventIds.length + 1}`;
                                  const r = deliverWorkerCarryToSettlement(draft.campaign, s, w.workerId, tx);
                                  return {
                                    ok: r.ok,
                                    text: r.ok
                                      ? `Доставлено в поселение: +${r.deliveredAmount} ${r.resourceType}.`
                                      : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-[11px] rounded cursor-pointer"
                            >
                              Доставить
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const s = draft.activeMap.localSettlements[settlement.settlementId];
                                  const nextDep = w.assignedDepositId === 'dep_wood_01' ? 'dep_iron_01' : 'dep_wood_01';
                                  const r = reassignWorkerSafe(s, w.workerId, nextDep);
                                  return {
                                    ok: r.ok,
                                    text: `Переназначен на ${nextDep}; сохранённый груз Carried: ${r.preservedCarryAmount}.`,
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-[11px] rounded cursor-pointer"
                            >
                              Переназначить
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Slot-bound Construction & Building Repair (§§15.5, 15.6, 15.8) */}
                    {settlement.buildings && (
                      <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-display text-sm font-bold text-[#c49a45]">
                            Стройплощадки и ремонт зданий (§§15.5–15.8)
                          </h3>
                        </div>
                        <div className="space-y-1.5 text-xs font-mono-num">
                          {Object.values(settlement.buildings).map((b) => (
                            <div
                              key={b.buildingId}
                              className="p-2 rounded bg-[#171b25] border border-[#262d3d] flex items-center justify-between gap-2"
                            >
                              <span className="text-[#eae3d2] truncate">{b.nameRu}</span>
                              <span className={b.operational ? 'text-[#86efac]' : 'text-[#facc15]'}>
                                HP {b.hp}/{b.maxHp} ·{' '}
                                {b.constructionRemainingSec > 0
                                  ? `Стройка ${b.constructionRemainingSec}с`
                                  : b.operational
                                    ? 'Исправно'
                                    : 'Повреждено'}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const s = draft.activeMap.localSettlements[settlement.settlementId];
                                const r = startBuildingConstruction({
                                  settlement: s,
                                  slotId: 'slot_defense_01',
                                  buildingId: 'bld_tower_01',
                                  category: 'defense',
                                  nameRu: 'Сторожевая башня',
                                  woodCost: 40,
                                  stoneCost: 30,
                                  buildTimeSec: 12,
                                });
                                return {
                                  ok: r.ok,
                                  text: r.ok
                                    ? 'Заложена башня на слоте slot_defense_01 (стройка 12с, не мгновенно §15.6).'
                                    : r.reason ?? '',
                                };
                              })
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                          >
                            Построить башню (slot_defense_01)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const s = draft.activeMap.localSettlements[settlement.settlementId];
                                const r = damageSettlementBuilding(s, 'bld_barracks_01', 180);
                                return {
                                  ok: r.ok,
                                  text: r.damaged
                                    ? `Казарма повреждена (HP ${r.remainingHp}): очередь остановлена, ресурсы сохранены (§15.8).`
                                    : `Урон нанесён (HP ${r.remainingHp}).`,
                                };
                              })
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#341a1e] hover:bg-[#462227] border border-[#7c3740] text-xs rounded cursor-pointer"
                          >
                            Повредить казарму (-180 HP)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const s = draft.activeMap.localSettlements[settlement.settlementId];
                                const r = repairSettlementBuilding(s, 'bld_barracks_01');
                                return {
                                  ok: r.ok,
                                  text: r.ok
                                    ? `Казарма отремонтирована (+${r.repairedHp} HP за ${r.woodSpent} Wood, без траты Food §15.8).`
                                    : r.reason ?? '',
                                };
                              })
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-xs rounded cursor-pointer"
                          >
                            Ремонт казармы (Wood)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const s = draft.activeMap.localSettlements[settlement.settlementId];
                                const sq = draft.activeMap.squadRoster?.squad_alpha;
                                if (!sq) return { ok: false, text: 'Отряд Альфа не найден.' };
                                const txId = `rep_alpha_${draft.campaign.processedEventIds.length + 1}`;
                                const r = replenishSquadFromSettlement({
                                  campaign: draft.campaign,
                                  settlement: s,
                                  squad: sq,
                                  transactionId: txId,
                                  inCombat: simInCombat,
                                });
                                return {
                                  ok: r.ok,
                                  text: r.ok
                                    ? `Пополнено бойцов Альфы: +${r.replenishedUnits} (-${r.woodSpent} Wood, -${r.ironSpent} Iron, §14.6).`
                                    : r.reason ?? '',
                                };
                              })
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                          >
                            Пополнить Альфу (Wood/Iron §14.6)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const audit = validateSettlementEconomicPlayability(settlement);
                              setFeedback({
                                ok: audit.playable,
                                text: audit.playable
                                  ? 'Аудит экономики §338.8: поселение экономически проходимо (softlock не обнаружен).'
                                  : audit.issues.join(' '),
                              });
                            }}
                            className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                          >
                            Аудит экономики §338.8
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>

            {/* Squad Roster (§343.2/343.5), Formations (§11.4–11.5) & Enemy AI without omniscience (§343.7) */}
            <section className="lg:col-span-6 space-y-4">
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <h3 className="font-display text-sm font-bold text-[#c49a45]">
                  Состав отрядов (§343.2), формации (§11.4–11.5)
                </h3>
                <div className="space-y-2">
                  {Object.values(sandbox.activeMap.squadRoster ?? {}).map((sq) => {
                    const aliveCount = sq.units.filter((u) => u.alive).length;
                    const woundedCount = sq.units.filter((u) => u.alive && u.hp < u.maxHp).length;
                    return (
                      <div
                        key={sq.squadId}
                        className="p-2.5 rounded bg-[#171b25] border border-[#262d3d] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#eae3d2] truncate">{sq.nameRu}</div>
                          <div className="text-[11px] font-mono-num text-[#9e9788]">
                            {sq.allegiance} · {sq.deploymentState} · Живых {aliveCount}/{sq.units.length}
                            {woundedCount > 0 ? ` (раненых: ${woundedCount})` : ''} · Форм.:{' '}
                            {sq.formation ?? 'compact'} · Портал:{' '}
                            {sq.portableAcrossPortals && sq.deploymentState === 'FieldArmy' ? 'переносится' : 'нет'}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                          {sq.allegiance === 'Player' && (
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const target = draft.activeMap.squadRoster?.[sq.squadId];
                                  if (!target) return { ok: false, text: 'Отряд не найден.' };
                                  const nextState =
                                    target.deploymentState === 'FieldArmy' ? 'Garrison' : 'FieldArmy';
                                  draft.activeMap.squadRoster![sq.squadId] = switchSquadDeployment(
                                    target,
                                    nextState
                                  );
                                  return {
                                    ok: true,
                                    text: `Отряд переведён в ${nextState} (без дублирования между составами §338.6).`,
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-[11px] rounded cursor-pointer"
                            >
                              {sq.deploymentState === 'FieldArmy' ? 'В Garrison' : 'В FieldArmy'}
                            </button>
                          )}
                          {sq.squadId === 'squad_neutral_demon' && (
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const target = draft.activeMap.squadRoster?.squad_neutral_demon;
                                  if (!target) return { ok: false, text: 'Сущность не найдена.' };
                                  const nextAl = target.allegiance === 'Neutral' ? 'Ally' : 'Neutral';
                                  const r = changeSquadAllegiance(
                                    draft.campaign,
                                    target,
                                    nextAl,
                                    `al_${nextAl}_${draft.campaign.processedEventIds.length + 1}`
                                  );
                                  return {
                                    ok: r.changed,
                                    text: r.changed
                                      ? `Явная транзакция allegiance (§343.8): теперь ${nextAl}.`
                                      : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#241b2e] hover:bg-[#312440] border border-[#4a3560] text-[11px] rounded cursor-pointer"
                            >
                              Сменить Allegiance
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Formations §11.4 & Multi-Squad Role Order §11.5 */}
                <div className="pt-2 border-t border-[#262d3d] space-y-2">
                  <div className="text-[11px] text-[#9e9788]">
                    Формация Альфы (§11.4 — только построение, 0 бонусов статов):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['compact', 'line', 'defensive', 'loose'] as FormationType[]).map((fm) => (
                      <button
                        key={fm}
                        type="button"
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const sq = draft.activeMap.squadRoster?.squad_alpha;
                            if (!sq) return { ok: false, text: 'Отряд не найден.' };
                            draft.activeMap.squadRoster!.squad_alpha = setSquadFormation(sq, fm);
                            return {
                              ok: true,
                              text: `Формация отряда Альфа: ${fm} (без скрытых стат-бонусов §11.4).`,
                            };
                          })
                        }
                        className={`min-h-[44px] px-2.5 text-[11px] rounded border cursor-pointer ${
                          sandbox.activeMap.squadRoster?.squad_alpha?.formation === fm
                            ? 'bg-[#c49a45] text-[#101218] border-[#c49a45] font-semibold'
                            : 'bg-[#171b25] text-[#d6cfc0] border-[#2c3448]'
                        }`}
                      >
                        {fm}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const alpha = draft.activeMap.squadRoster?.squad_alpha;
                          const gar = draft.activeMap.squadRoster?.squad_garrison_01;
                          if (!alpha || !gar) return { ok: false, text: 'Отряды не найдены.' };
                          const res = issueMultiSquadOrder([alpha, gar], 'AttackMove', { x: 40, y: 25 });
                          return {
                            ok: true,
                            text: `Групповой приказ (§11.5): ${res
                              .map((r) => `${r.squadId}=${r.roleMode}(${r.assignedPos.x},${r.assignedPos.y})`)
                              .join(', ')}.`,
                          };
                        })
                      }
                      className="min-h-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-[11px] font-semibold rounded cursor-pointer"
                    >
                      Групповой приказ (Пехота+Стрелки §11.5)
                    </button>
                  </div>
                </div>
              </div>

              {/* Enemy AI without omniscience */}
              {sandbox.activeMap.enemyAiGroups?.squad_enemy_patrol && (
                <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Enemy AI без всеведения (§343.7)
                  </h3>
                  {(() => {
                    const ai = sandbox.activeMap.enemyAiGroups!.squad_enemy_patrol;
                    return (
                      <>
                        <div className="text-xs font-mono-num text-[#d6cfc0] space-y-1">
                          <div>
                            Состояние: <span className="text-[#facc15]">{ai.state}</span> · Источник знания:{' '}
                            <span className="text-[#93c5fd]">{ai.knowledgeSource}</span>
                          </div>
                          <div>
                            База: ({ai.homeZone.x},{ai.homeZone.y}) · Лимит преследования: {ai.maxPursuitDistance}м
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const cur = draft.activeMap.enemyAiGroups!.squad_enemy_patrol;
                                draft.activeMap.enemyAiGroups!.squad_enemy_patrol =
                                  updateEnemyGroupKnowledge(
                                    cur,
                                    'local_detection',
                                    { x: 46, y: 42 },
                                    draft.activeMap.simulationTimeSec
                                  );
                                return {
                                  ok: true,
                                  text: 'Цель обнаружена через local_detection — начато преследование (§343.7).',
                                };
                              })
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                          >
                            Контакт (local_detection)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const cur = draft.activeMap.enemyAiGroups!.squad_enemy_patrol;
                                const next = stepEnemyGroupPursuit(cur, { x: 58, y: 40 }); // 18м > maxPursuitDistance 12м
                                draft.activeMap.enemyAiGroups!.squad_enemy_patrol = next;
                                return {
                                  ok: true,
                                  text: `Позиция (58,40) за пределом 12м от базы -> статус ${next.state}, знание сброшено (§343.7).`,
                                };
                              })
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                          >
                            Превысить радиус погони
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const patrol = draft.activeMap.squadRoster?.squad_enemy_patrol;
                                if (!patrol) return { ok: false, text: 'Патруль не найден.' };
                                const txId = `army_xp_${patrol.squadId}_${draft.campaign.processedEventIds.length + 1}`;
                                const r = awardArmyVictoryXpToHero({
                                  campaign: draft.campaign,
                                  defeatedSquad: patrol,
                                  transactionId: txId,
                                });
                                return {
                                  ok: r.ok,
                                  text: r.ok
                                    ? `Победа армии принесла Аватару +${r.grantedXp} XP (§14.8, бойцы отряда без личных уровней).`
                                    : r.reason ?? '',
                                };
                              }, 'ARMY_VICTORY_XP')
                            }
                            className="min-h-[44px] px-3 py-1.5 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-xs rounded cursor-pointer"
                          >
                            Победа армии (+XP герою §14.8)
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              {/* Rune Tablet (§144) & Plan Book (§146) */}
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Rune Tablet (§144) и Plan Book (§146)
                  </h3>
                  <span className="text-[11px] font-mono-num text-[#9e9788]">
                    Ячеек открыто: {computeUnlockedRuneTabletSlots(avatar.level)} (ур. Аватара {avatar.level})
                  </span>
                </div>

                {/* Rune Tablet Slots */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(sandbox.campaign.runeTablet?.slots ?? []).map((slot) => {
                    const inst = slot.runeInstanceId
                      ? sandbox.campaign.itemsByInstanceId[slot.runeInstanceId]
                      : null;
                    const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : null;
                    return (
                      <div
                        key={slot.slotIndex}
                        className="p-2.5 rounded bg-[#171b25] border border-[#262d3d] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] text-[#8f8879]">Ячейка #{slot.slotIndex + 1}</div>
                          <div className="text-xs font-medium text-[#eae3d2] truncate">
                            {def ? def.nameRu : 'Свободно'}
                          </div>
                        </div>
                        {inst && (
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const r = removeRuneFromTablet(draft.campaign, slot.slotIndex);
                                return {
                                  ok: r.ok,
                                  text: r.ok
                                    ? `Руна возвращена в PartyInventory (в инвентаре не активна §144.10).`
                                    : r.reason ?? 'Невозможно извлечь руну.',
                                };
                              })
                            }
                            className="min-h-[44px] px-2.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-[11px] rounded cursor-pointer shrink-0"
                          >
                            Извлечь
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Monument & Rune Power Controls */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const r = captureRuneMonument(draft.campaign, draft.activeMap, 'mon_rune_elves_01');
                        return {
                          ok: r.ok,
                          text: r.ok
                            ? 'Rune Monument (Эльфы) захвачен по активной рабочей руне (§144.4).'
                            : r.reason ?? '',
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                  >
                    Захватить Rune Monument (Эльфы)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const settlement = Object.values(draft.activeMap.localSettlements)[0];
                        const r = summonOrResummonRuneHeroAtMonument({
                          campaign: draft.campaign,
                          map: draft.activeMap,
                          monumentObjectId: 'mon_hero_sector_a_01',
                          runeInstanceId: 'inst_rune_hero_vanguard_01',
                          settlement,
                        });
                        if (r.ok && r.hero) setSelectedHeroId(r.hero.heroId);
                        return {
                          ok: r.ok,
                          text: r.ok
                            ? `${r.resummoned ? 'Повторно призван' : 'Призван'} герой "${r.hero?.nameRu}" у Hero Monument (время ${r.effectiveSummonTimeSec}с, без дубля предметов §144.5).`
                            : r.reason ?? '',
                        };
                      }, 'HERO_RUNE_SUMMONED')
                    }
                    className="min-h-[44px] px-3 py-1.5 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                  >
                    Призвать/Воскресить Hero Rune
                  </button>
                  {sandbox.campaign.heroes.hero_rune_vanguard && (
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          const r = markRuneHeroFallen(draft.campaign, 'hero_rune_vanguard');
                          return {
                            ok: r.ok,
                            text: r.ok
                              ? `Рунный герой пал в бою: экипировка (${r.preservedEquipmentCount} поз.) сохранена для повторного призыва (§144.5).`
                              : r.reason ?? '',
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#341a1e] hover:bg-[#462227] border border-[#7c3740] text-xs rounded cursor-pointer"
                    >
                      Симулировать гибель Hero Rune
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const s = Object.values(draft.activeMap.localSettlements)[0];
                        if (!s) return { ok: false, text: 'Нет активного поселения.' };
                        const r = tickRunePowerRecovery(draft.activeMap, s, 5);
                        return {
                          ok: !r.frozen,
                          text: r.frozen
                            ? 'Карта заморожена: Rune Power не восстанавливается в фоне (§144.6).'
                            : `Rune Power восстановлена (+${r.recovered}, сейчас ${r.runePower}/${s.maxRunePower}).`,
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                  >
                    Реген Rune Power (+5с)
                  </button>
                </div>

                {/* Plan Book (§146) */}
                <div className="pt-2 border-t border-[#262d3d] space-y-2">
                  <div className="text-xs font-semibold text-[#c49a45]">
                    Plan Book (§146 — 5 независимых проверок)
                  </div>
                  {Object.values(PROTOTYPE_PLANS).map((plan) => {
                    const settlement =
                      Object.values(sandbox.activeMap.localSettlements).find(
                        (s) => s.raceId === plan.raceId
                      ) ?? null;
                    const ev = evaluatePlanAvailability(
                      sandbox.campaign,
                      sandbox.activeMap,
                      settlement,
                      plan.planId
                    );
                    return (
                      <div
                        key={plan.planId}
                        className="p-2.5 rounded bg-[#171b25] border border-[#262d3d] space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[#eae3d2]">
                            {plan.displayNameRu} ({plan.planType} · {plan.raceId})
                          </span>
                          <span
                            className={`text-[11px] font-mono-num ${
                              ev.available ? 'text-[#86efac]' : 'text-[#f5b4b8]'
                            }`}
                          >
                            {ev.available ? 'Доступно' : 'Заблокировано'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-mono-num">
                          <span className={ev.checks.knowledge ? 'text-[#86efac]' : 'text-[#f87171]'}>
                            Знание:{ev.checks.knowledge ? 'OK' : 'НЕТ'}
                          </span>
                          <span className={ev.checks.monument ? 'text-[#86efac]' : 'text-[#f87171]'}>
                            Монумент:{ev.checks.monument ? 'OK' : 'НЕТ'}
                          </span>
                          <span className={ev.checks.infrastructure ? 'text-[#86efac]' : 'text-[#f87171]'}>
                            Инфрастр.:{ev.checks.infrastructure ? 'OK' : 'НЕТ'}
                          </span>
                          <span className={ev.checks.resources ? 'text-[#86efac]' : 'text-[#f87171]'}>
                            Ресурсы:{ev.checks.resources ? 'OK' : 'НЕТ'}
                          </span>
                          <span className={ev.checks.capacity ? 'text-[#86efac]' : 'text-[#f87171]'}>
                            Лимит:{ev.checks.capacity ? 'OK' : 'НЕТ'}
                          </span>
                        </div>
                        {ev.missingReasonsRu.length > 0 && (
                          <div className="text-[11px] text-[#f5b4b8]">{ev.missingReasonsRu[0]}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: INVENTORY, STORAGE, TRADER, PORTAL & SAVES */}
        {activeTab === 'economy_portal' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Equipment + PartyInventory + Storage */}
            <section className="lg:col-span-6 space-y-4">
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Экипировка: {inspectedHero.nameRu} (§1.5, §317, §331)
                  </h3>
                  <span className="text-[11px] font-mono-num text-[#86efac]">
                    Инварианты: {invCheck.valid ? 'OK (дублей нет)' : `ОШИБКА (${invCheck.errors.length})`}
                  </span>
                </div>
                {sandbox.campaign.activePartyHeroIds.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sandbox.campaign.activePartyHeroIds.map((hId) => {
                      const h = sandbox.campaign.heroes[hId];
                      if (!h) return null;
                      return (
                        <button
                          key={hId}
                          type="button"
                          onClick={() => setSelectedHeroId(hId)}
                          className={`min-h-[44px] px-2.5 text-[11px] rounded border cursor-pointer ${
                            hId === inspectedHeroId
                              ? 'bg-[#c49a45] text-[#101218] border-[#c49a45] font-semibold'
                              : 'bg-[#171b25] text-[#d6cfc0] border-[#2e364a]'
                          }`}
                        >
                          {h.isAvatar ? 'Аватар' : h.nameRu}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="text-[11px] text-[#9e9788]">
                  Силуэт персонажа (§128) · удалённый обмен между активными героями без ограничения расстоянием
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      null,
                      'helm',
                      null,
                      'main_hand',
                      'armor',
                      'off_hand',
                      'ring_1',
                      'amulet',
                      'ring_2',
                    ] as Array<EquipSlotId | null>
                  ).map((slot, idx) => {
                    if (!slot) {
                      return <div key={`spacer_${idx}`} className="hidden sm:block" aria-hidden="true" />;
                    }
                    const instId = inspectedHero.equipment[slot];
                    const inst = instId ? sandbox.campaign.itemsByInstanceId[instId] : null;
                    const def = inst ? PROTOTYPE_ITEMS[inst.definitionId] : null;
                    const otherActiveHeroId = (
                      sandbox.campaign.activePartyHeroIds ?? [sandbox.campaign.avatarId]
                    ).find((id) => id !== inspectedHeroId);
                    return (
                      <div
                        key={slot}
                        className="flex flex-col justify-between gap-2 p-2.5 rounded bg-[#171b25] border border-[#262d3d]"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] text-[#8f8879]">{EQUIP_SLOT_LABELS[slot]}</div>
                          <div className="text-xs font-medium text-[#eae3d2] truncate">
                            {def ? def.nameRu : 'Пусто'}
                          </div>
                        </div>
                        {inst && (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const r = unequipSlotToPartyInventory(draft.campaign, inspectedHeroId, slot);
                                  return { ok: r.ok, text: r.ok ? 'Предмет снят в PartyInventory.' : r.reason ?? '' };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-[11px] rounded cursor-pointer"
                            >
                              Снять
                            </button>
                            {otherActiveHeroId && (
                              <button
                                type="button"
                                onClick={() =>
                                  mutateSandbox((draft) => {
                                    const r = transferEquippedItemBetweenHeroes(
                                      draft.campaign,
                                      inspectedHeroId,
                                      slot,
                                      otherActiveHeroId
                                    );
                                    const targetName =
                                      draft.campaign.heroes[otherActiveHeroId]?.nameRu ?? otherActiveHeroId;
                                    return {
                                      ok: r.ok,
                                      text: r.ok
                                        ? `Предмет передан герою «${targetName}» (§128 удалённый обмен).`
                                        : r.reason ?? '',
                                    };
                                  })
                                }
                                className="min-h-[44px] px-2.5 bg-[#232b3d] hover:bg-[#2f3b54] border border-[#44567a] text-[11px] rounded cursor-pointer"
                              >
                                Передать
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    PartyInventory (без лимита · {inventoryItems.length} поз.)
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        draft.activeMap.atAuthorizedStoragePoint = !draft.activeMap.atAuthorizedStoragePoint;
                        return {
                          ok: true,
                          text: draft.activeMap.atAuthorizedStoragePoint
                            ? 'Персонаж у разрешённой точки CampaignStorage (§331.2).'
                            : 'Удалено от точки CampaignStorage — прямой доступ заблокирован.',
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-[11px] rounded cursor-pointer"
                  >
                    Точка склада: {sandbox.activeMap.atAuthorizedStoragePoint ? 'Рядом' : 'Далеко'}
                  </button>
                </div>

                {/* §274.1: Фильтры категорий, сортировка и стаки безлимитного PartyInventory */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: 'Все' },
                      { id: 'equipment', label: 'Экипировка' },
                      { id: 'runes', label: 'Руны' },
                      { id: 'plans_scrolls', label: 'Планы/Свитки' },
                      { id: 'quest_other', label: 'Квесты' },
                    ] as Array<{ id: InventoryFilterCategory; label: string }>
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setInvCategory(cat.id)}
                      className={`min-h-[44px] px-2.5 text-[11px] rounded border cursor-pointer ${
                        invCategory === cat.id
                          ? 'bg-[#c49a45] text-[#101218] border-[#c49a45] font-semibold'
                          : 'bg-[#171b25] text-[#d6cfc0] border-[#2c3448]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setInvSort((s) => (s === 'name' ? 'price_desc' : 'name'))}
                    className="min-h-[44px] px-2.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-[11px] rounded cursor-pointer"
                  >
                    Сорт.: {invSort === 'name' ? 'Имя' : 'Цена ↓'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const r = pickupItemToPartyInventory(
                          draft.campaign,
                          'item_scroll_frost_nova',
                          2,
                          `stack_scroll_${draft.activeMap.simulationTimeSec}`
                        );
                        return {
                          ok: r.ok,
                          text: r.ok
                            ? `Подобрано +2 свитка в безлимитный PartyInventory (авто-стак §274.3).`
                            : r.reason ?? '',
                        };
                      })
                    }
                    className="min-h-[44px] px-2.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-[11px] rounded cursor-pointer"
                  >
                    +2 Свитка (стак §274)
                  </button>
                </div>

                {/* §317.9 / §317.11 #14: Non-mutating equipment preview & stat delta confirmation */}
                {pendingEquip && (
                  <div className="p-3 rounded bg-[#1b2232] border border-[#c49a45]/60 space-y-2">
                    <div className="text-xs font-semibold text-[#f2ece0]">
                      Предпросмотр экипировки (§317.9): «{pendingEquip.itemNameRu}» → {EQUIP_SLOT_LABELS[pendingEquip.targetSlot]}
                    </div>
                    <div className="text-[11px] font-mono-num text-[#c5beae] flex flex-wrap gap-2">
                      <span>HP: {pendingEquip.preview.statDelta.maxHp >= 0 ? '+' : ''}{pendingEquip.preview.statDelta.maxHp}</span>
                      <span>Мана: {pendingEquip.preview.statDelta.maxMana >= 0 ? '+' : ''}{pendingEquip.preview.statDelta.maxMana}</span>
                      <span>Броня: {pendingEquip.preview.statDelta.armor >= 0 ? '+' : ''}{pendingEquip.preview.statDelta.armor}</span>
                      <span>Урон: {pendingEquip.preview.statDelta.weaponBaseDamage >= 0 ? '+' : ''}{pendingEquip.preview.statDelta.weaponBaseDamage}</span>
                      {Object.entries(pendingEquip.preview.statDelta.attributes).map(([a, v]) => (
                        <span key={a} className="text-[#93c5fd]">
                          {a}: {(v ?? 0) >= 0 ? '+' : ''}{v}
                        </span>
                      ))}
                    </div>
                    {pendingEquip.preview.slotConflicts.length > 0 && (
                      <div className="text-[11px] text-[#facc15]">
                        Будет снято в PartyInventory:{' '}
                        {pendingEquip.preview.slotConflicts
                          .map((c) => `${c.replacedItemNameRu} (${EQUIP_SLOT_LABELS[c.slot]})`)
                          .join(', ')}
                      </div>
                    )}
                    {pendingEquip.preview.unmetReasonsRu.length > 0 && (
                      <div className="text-[11px] text-[#f5b4b8]">
                        {pendingEquip.preview.unmetReasonsRu.join(' ')}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!pendingEquip.preview.canEquip}
                        onClick={() => {
                          const pe = pendingEquip;
                          setPendingEquip(null);
                          mutateSandbox((draft) => {
                            const r = equipItemFromPartyInventory(
                              draft.campaign,
                              inspectedHeroId,
                              pe.instanceId,
                              pe.targetSlot
                            );
                            return {
                              ok: r.ok,
                              text: r.ok
                                ? `Надето (${inspectedHero.nameRu}): ${pe.itemNameRu}.`
                                : r.reason ?? 'Нельзя надеть.',
                            };
                          });
                        }}
                        className="min-h-[44px] px-3 bg-[#c49a45] hover:bg-[#d6ac56] disabled:opacity-40 text-[#101218] text-xs font-semibold rounded cursor-pointer disabled:cursor-not-allowed"
                      >
                        Подтвердить экипировку
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingEquip(null)}
                        className="min-h-[44px] px-3 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}

                {/* §317.9 / §317.11 #9 / §144.7: Two-step confirmation before irreversible destruction */}
                {pendingDestroyId && (() => {
                  const targetInst = sandbox.campaign.itemsByInstanceId[pendingDestroyId];
                  const targetDef = targetInst ? PROTOTYPE_ITEMS[targetInst.definitionId] : null;
                  if (!targetInst || !targetDef) return null;
                  const runeWarn = previewRuneSaleOrDestructionWarning(sandbox.campaign, targetInst.instanceId);
                  return (
                    <div className="p-3 rounded bg-[#2a1719] border border-[#9b3d46] space-y-2">
                      <div className="text-xs font-semibold text-[#f5b4b8]">
                        Подтверждение необратимого удаления (§317.9): «{targetDef.nameRu}»
                      </div>
                      {runeWarn.warningRu && (
                        <div className="text-[11px] text-[#facc15]">{runeWarn.warningRu}</div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const id = pendingDestroyId;
                            setPendingDestroyId(null);
                            mutateSandbox((draft) => {
                              const r = discardOrDestroyInventoryItem(draft.campaign, id);
                              return {
                                ok: r.ok,
                                text: r.ok
                                  ? `Предмет "${targetDef.nameRu}" удалён из PartyInventory.`
                                  : r.reason ?? 'Удаление запрещено.',
                              };
                            });
                          }}
                          className="min-h-[44px] px-3 bg-[#8c2d36] hover:bg-[#a63640] text-[#f2ece0] text-xs font-semibold rounded cursor-pointer"
                        >
                          Подтвердить удаление
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDestroyId(null)}
                          className="min-h-[44px] px-3 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-2">
                  {inventoryItems.map((inst) => {
                    const def = PROTOTYPE_ITEMS[inst.definitionId];
                    if (!def) return null;
                    const eqPreview =
                      def.allowedSlots.length > 0
                        ? previewHeroEquipmentChange(
                            sandbox.campaign,
                            inspectedHeroId,
                            inst.instanceId,
                            def.allowedSlots[0]
                          )
                        : null;
                    const reqFailed = eqPreview !== null && !eqPreview.canEquip;
                    return (
                      <div
                        key={inst.instanceId}
                        className={`p-2.5 rounded border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                          reqFailed
                            ? 'bg-[#201417] border-[#7f2d34]'
                            : 'bg-[#171b25] border-[#262d3d]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#eae3d2] truncate">
                            {def.nameRu} {inst.quantity > 1 ? `×${inst.quantity}` : ''}{' '}
                            {inst.isQuestProtected ? '(Квестовый)' : ''}
                          </div>
                          <div className="text-[11px] text-[#8f8879]">
                            {def.note || `База: ${def.basePriceCopper} Copper`}
                          </div>
                          {reqFailed && eqPreview && (
                            <div className="text-[11px] text-[#f5b4b8] mt-0.5">
                              Нельзя надеть (§317.5): {eqPreview.unmetReasonsRu.join(' ')}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                          {def.allowedSlots.length > 0 && eqPreview && (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingEquip({
                                  instanceId: inst.instanceId,
                                  itemNameRu: def.nameRu,
                                  targetSlot: def.allowedSlots[0],
                                  preview: eqPreview,
                                })
                              }
                              className={`min-h-[44px] px-2.5 border text-[11px] rounded cursor-pointer ${
                                reqFailed
                                  ? 'bg-[#2a1719] hover:bg-[#381e21] border-[#7f2d34] text-[#f5b4b8]'
                                  : 'bg-[#1f2636] hover:bg-[#2a344a] border-[#3a445b]'
                              }`}
                            >
                              {reqFailed ? 'Требования...' : 'Надеть...'}
                            </button>
                          )}
                          {(def.category === 'worker_rune' || def.category === 'hero_rune') && (
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const slots = draft.campaign.runeTablet?.slots ?? [];
                                  const free = slots.find((s) => s.runeInstanceId === null);
                                  const r = installRuneInTablet(
                                    draft.campaign,
                                    inst.instanceId,
                                    free ? free.slotIndex : slots.length
                                  );
                                  return {
                                    ok: r.ok,
                                    text: r.ok
                                      ? `Руна "${def.nameRu}" установлена в Rune Tablet (§144.3).`
                                      : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#241b2e] hover:bg-[#312440] border border-[#4a3560] text-[11px] rounded cursor-pointer"
                            >
                              В Rune Tablet
                            </button>
                          )}
                          {(def.category === 'building_plan' || def.category === 'unit_plan') && def.planId && (
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const planDef = PROTOTYPE_PLANS[def.planId!];
                                  const r = activatePlanFromInventory(
                                    draft.campaign,
                                    inst.instanceId,
                                    planDef?.raceId ?? selectedRaceId
                                  );
                                  return {
                                    ok: r.ok,
                                    text: r.ok
                                      ? `План "${planDef?.displayNameRu ?? def.nameRu}" постоянно активирован в Plan Book (§146.5).`
                                      : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-[11px] rounded cursor-pointer"
                            >
                              В Plan Book
                            </button>
                          )}
                          {def.category === 'spell_scroll' && (
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const r = transcribeSpellScrollToGrimoire(
                                    draft.campaign,
                                    inspectedHeroId,
                                    inst.instanceId
                                  );
                                  return {
                                    ok: r.ok,
                                    text: r.ok ? 'Формула перенесена в Гримуар (§140.4).' : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-[11px] rounded cursor-pointer"
                            >
                              В Гримуар
                            </button>
                          )}
                          {def.stackable && inst.quantity > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const newId = `${inst.instanceId}_split_${Object.keys(draft.campaign.itemsByInstanceId).length + 1}`;
                                  const r = splitItemStack(draft.campaign, inst.instanceId, 1, newId);
                                  return {
                                    ok: r.ok,
                                    text: r.ok
                                      ? `Стак разделён без потери количества (§274.3).`
                                      : r.reason ?? '',
                                  };
                                })
                              }
                              className="min-h-[44px] px-2.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-[11px] rounded cursor-pointer"
                            >
                              Разделить (1)
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              mutateSandbox((draft) => {
                                const r = moveItemBetweenInventoryAndStorage(
                                  draft.campaign,
                                  draft.activeMap,
                                  inst.instanceId,
                                  'to_storage'
                                );
                                return {
                                  ok: r.ok,
                                  text: r.ok ? 'Перемещено на CampaignStorage.' : r.reason ?? '',
                                };
                              })
                            }
                            className="min-h-[44px] px-2.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-[11px] rounded cursor-pointer"
                          >
                            На склад
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const prev = previewMerchantTransaction(
                                sandbox.campaign,
                                'merchant_neutral_01',
                                'sell',
                                inst.instanceId
                              );
                              if (!prev.ok) {
                                setFeedback({ ok: false, text: prev.reason ?? 'Продажа недоступна.' });
                                return;
                              }
                              setPendingTrade(prev);
                            }}
                            className="min-h-[44px] px-2.5 bg-[#2a2117] hover:bg-[#3a2d1f] border border-[#6e522c] text-[11px] rounded cursor-pointer"
                          >
                            Продать...
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDestroyId(inst.instanceId)}
                            className="min-h-[44px] px-2.5 bg-[#2a1719] hover:bg-[#381e21] border border-[#6e3238] text-[11px] text-[#f5b4b8] rounded cursor-pointer"
                          >
                            Удалить...
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-[#262d3d] space-y-2">
                  <div className="text-xs font-semibold text-[#9e9788]">
                    CampaignStorage ({storageItems.length}/{DEFAULT_WORKING_ASSUMPTIONS.campaignStorageCapacity} · OD-002 OPEN)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {storageItems.map((inst) => (
                      <button
                        key={inst.instanceId}
                        type="button"
                        onClick={() =>
                          mutateSandbox((draft) => {
                            const r = moveItemBetweenInventoryAndStorage(
                              draft.campaign,
                              draft.activeMap,
                              inst.instanceId,
                              'to_inventory'
                            );
                            return { ok: r.ok, text: r.ok ? 'Забрано в PartyInventory.' : r.reason ?? '' };
                          })
                        }
                        className="min-h-[44px] px-3 py-1.5 bg-[#171b25] hover:bg-[#202635] border border-[#2e364a] text-xs rounded cursor-pointer"
                      >
                        Забрать: {PROTOTYPE_ITEMS[inst.definitionId]?.nameRu}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Trader + Portal + Races + Versioned Save */}
            <section className="lg:col-span-6 space-y-4">
              {/* Trader */}
              {merchant && (
                <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-[#c49a45]">
                      {merchant.nameRu} (§132.3, §331.3, §347.5)
                    </h3>
                    <div className="text-xs font-mono-num text-[#facc15]">
                      {walletDenom.gold}G {walletDenom.silver}S {walletDenom.copper}C
                    </div>
                  </div>
                  <p className="text-xs text-[#9e9788] font-mono-num">
                    NaturalCharisma: {avatar.baseAttributes.CHA} (с экип.: {derived.effectiveAttributes.CHA}) · Торговая поправка: {tradeAdjPct.toFixed(1)}%
                  </p>

                  {pendingTrade && (
                    <div className="p-3 rounded bg-[#1b2232] border border-[#c49a45]/60 space-y-2">
                      <div className="text-xs font-semibold text-[#f2ece0]">
                        Подтверждение сделки (§347.5, §348.4):{' '}
                        {pendingTrade.mode === 'buy' ? 'Покупка' : 'Продажа'} «{pendingTrade.itemNameRu}» (x{pendingTrade.quantity})
                      </div>
                      <div className="text-[11px] font-mono-num text-[#c5beae]">
                        Сумма: {pendingTrade.priceCopper} Copper · Баланс: {pendingTrade.balanceBeforeCopper} →{' '}
                        <span className="text-[#facc15] font-semibold">{pendingTrade.balanceAfterCopper}</span> Copper
                      </div>
                      {pendingTrade.warningRu && (
                        <div className="text-[11px] text-[#f5b4b8]">{pendingTrade.warningRu}</div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const tx = pendingTrade;
                            setPendingTrade(null);
                            mutateSandbox((draft) => {
                              const idx = draft.campaign.processedEventIds.length + 1;
                              if (tx.mode === 'buy') {
                                const r = executeMerchantBuy(
                                  draft.campaign,
                                  merchant.merchantId,
                                  tx.definitionId,
                                  `buy_${tx.definitionId}_${idx}`,
                                  `inst_bought_${tx.definitionId}_${idx}`
                                );
                                return {
                                  ok: r.ok,
                                  text: r.ok
                                    ? `Подтверждена покупка "${tx.itemNameRu}" за ${r.priceCopper} Copper.`
                                    : r.reason ?? '',
                                };
                              }
                              const r = executeMerchantSell(
                                draft.campaign,
                                merchant.merchantId,
                                tx.instanceId ?? '',
                                `sell_${tx.instanceId}_${idx}`
                              );
                              return {
                                ok: r.ok,
                                text: r.ok
                                  ? `Подтверждена продажа "${tx.itemNameRu}" за ${r.payoutCopper} Copper.`
                                  : r.reason ?? '',
                              };
                            }, 'MERCHANT_TX_CONFIRMED');
                          }}
                          className="min-h-[44px] px-3 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                        >
                          Подтвердить сделку
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingTrade(null);
                            setFeedback({
                              ok: true,
                              text: 'Операция у торговца отменена: баланс и предметы не изменены (§348.4).',
                            });
                          }}
                          className="min-h-[44px] px-3 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {merchant.stockDefinitionIds.map((defId) => {
                      const def = PROTOTYPE_ITEMS[defId];
                      if (!def) return null;
                      const { buyPriceCopper } = computeBuyAndSellPricesCopper(
                        defId,
                        avatar.baseAttributes.CHA,
                        merchant.buyPriceMultiplier,
                        merchant.sellPriceMultiplier
                      );
                      return (
                        <button
                          key={defId}
                          type="button"
                          onClick={() => {
                            const prev = previewMerchantTransaction(
                              sandbox.campaign,
                              merchant.merchantId,
                              'buy',
                              defId
                            );
                            if (!prev.ok) {
                              setFeedback({ ok: false, text: prev.reason ?? 'Покупка недоступна.' });
                              return;
                            }
                            setPendingTrade(prev);
                          }}
                          className="min-h-[44px] p-2.5 text-left bg-[#171b25] hover:bg-[#202635] border border-[#2c3448] rounded cursor-pointer"
                        >
                          <div className="text-xs font-medium text-[#eae3d2] truncate">{def.nameRu}</div>
                          <div className="text-[11px] font-mono-num text-[#c49a45]">
                            Купить · {buyPriceCopper} Copper
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 6 Playable Races (§352.4) */}
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-2.5">
                <h3 className="font-display text-sm font-bold text-[#c49a45]">
                  Матрица 6 народов (§321, §352.4)
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {(Object.keys(PLAYABLE_RACES) as PlayableRaceId[]).map((rId) => (
                    <button
                      key={rId}
                      type="button"
                      onClick={() => setSelectedRaceId(rId)}
                      className={`min-h-[44px] px-2 py-1.5 text-xs rounded border cursor-pointer ${
                        selectedRaceId === rId
                          ? 'bg-[#c49a45] text-[#101218] border-[#c49a45] font-semibold'
                          : 'bg-[#171b25] text-[#d6cfc0] border-[#2c3448]'
                      }`}
                    >
                      {PLAYABLE_RACES[rId].nameRu}
                    </button>
                  ))}
                </div>
                <div className="p-2.5 rounded bg-[#171b25] border border-[#262d3d] text-xs space-y-1">
                  <div className="font-semibold text-[#eae3d2]">
                    {PLAYABLE_RACES[selectedRaceId].nameRu} ({PLAYABLE_RACES[selectedRaceId].group})
                  </div>
                  <div className="text-[#93c5fd] font-mono-num">
                    Ресурсы: {PLAYABLE_RACES[selectedRaceId].resourcesUsed.join(', ')}
                  </div>
                  <div className="text-[#9e9788]">{PLAYABLE_RACES[selectedRaceId].ironExtractionNote}</div>
                </div>
              </div>

              {/* Portal Transition + ReturnPolicy + Checkpoints + Lifecycle + Save */}
              <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#c49a45]">
                    Портал (§290, §346.8), Жизненный цикл (§341.11) и Checkpoints
                  </h3>
                  <span className="text-[11px] font-mono-num text-[#93c5fd]">
                    {sandbox.activeMap.lifecycle} · ReturnPolicy: {sandbox.mission.returnPolicy}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const targetDef =
                          draft.activeMap.mapDefinitionId === 'sector_a' ? 'sector_b' : 'sector_a';
                        const tId = `portal_${targetDef}_${draft.campaign.processedTransitionIds.length + 1}`;
                        const res = executePortalMapTransition(
                          draft.campaign,
                          draft.mission,
                          draft.activeMap,
                          targetDef,
                          tId,
                          DEFAULT_WORKING_ASSUMPTIONS,
                          draft.eventJournal
                        );
                        if (res.ok && res.nextMap) {
                          draft.activeMap = res.nextMap;
                          return {
                            ok: true,
                            text: `Портал в "${targetDef}" выполнен (Checkpoint ${res.checkpointCreated?.checkpointId}). MagicStrain сброшен, respec закрыт.`,
                          };
                        }
                        return { ok: false, text: res.reason ?? 'Ошибка перехода.' };
                      }, 'PORTAL_TRANSITION', 'Mission')
                    }
                    className="min-h-[44px] px-3 py-2 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] text-xs font-semibold rounded cursor-pointer"
                  >
                    {sandbox.activeMap.mapDefinitionId === 'sector_a'
                      ? 'Портал в Сектор Б'
                      : 'Портал возврата в Сектор А'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        draft.mission.returnPolicy =
                          draft.mission.returnPolicy === 'AllowReturn' ? 'OneWay' : 'AllowReturn';
                        return {
                          ok: true,
                          text: `ReturnPolicy переключён на ${draft.mission.returnPolicy} (§346.8).`,
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-2 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                  >
                    ReturnPolicy: {sandbox.mission.returnPolicy}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateSandbox((draft) => {
                        const target =
                          draft.activeMap.lifecycle === 'RUNNING' ? 'PAUSED' : 'RUNNING';
                        const r = transitionMapLifecycle(draft.activeMap, target);
                        return {
                          ok: r.ok,
                          text: r.ok
                            ? `Жизненный цикл карты: ${r.from} -> ${r.to} (§341.11).`
                            : r.reason ?? '',
                        };
                      })
                    }
                    className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                  >
                    Пауза/Запуск карты ({sandbox.activeMap.lifecycle})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rep = validateMissionPlayability(
                        sandbox.campaign,
                        sandbox.mission,
                        sandbox.activeMap
                      );
                      setFeedback({
                        ok: rep.playable,
                        text: rep.playable
                          ? `Аудит проходимости (§346.9): OK. Checkpoints: ${(sandbox.campaign.checkpoints ?? []).length}.`
                          : `Обнаружен риск softlock: ${rep.issues.join(' ')}`,
                      });
                    }}
                    className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                  >
                    Аудит проходимости (§346.9)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rep = runCampaignAntiDeadlockAudit(
                        sandbox.campaign,
                        sandbox.mission,
                        sandbox.activeMap
                      );
                      setFeedback({
                        ok: rep.passed,
                        text: rep.passed
                          ? 'Аудит кампании (§258.7 / §262.4): OK — циклов, дублей отрядов/предметов и незамороженных архивных карт нет.'
                          : `Нарушения аудита кампании: ${rep.issuesRu.join(' ')}`,
                      });
                    }}
                    className="min-h-[44px] px-3 py-2 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-xs font-medium rounded cursor-pointer sm:col-span-2"
                  >
                    Аудит кампании (§258.7 / §262.4)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rep = runPrototypeCatalogAndAuditReport();
                      const ok = rep.overallCatalogStatus === 'PARTIAL';
                      setFeedback({
                        ok,
                        text: ok
                          ? `Аудит каталогов (§339 / §§352–353): схема и матрица ${rep.stats.racesAudited} рас валидны; статус контента честно PARTIAL (открыто пробелов: ${rep.openGapsRu.length}).`
                          : `Ошибки аудита каталогов: ${[
                              ...rep.raceMatrixErrorsRu,
                              ...rep.numericalErrorsRu,
                              ...rep.catalogErrorsRu,
                            ].join(' ')}`,
                      });
                    }}
                    className="min-h-[44px] px-3 py-2 bg-[#232b3d] hover:bg-[#2d3850] border border-[#44567a] text-xs font-medium rounded cursor-pointer sm:col-span-2"
                  >
                    Аудит каталогов и 6 рас (§339 / §§352–353)
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSnapshot}
                    className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium rounded cursor-pointer"
                  >
                    Сохранить снимок (Checksum)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSnapshot()}
                    className="min-h-[44px] px-3 py-2 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium rounded cursor-pointer"
                  >
                    Загрузить снимок
                  </button>
                  {(sandbox.campaign.checkpoints ?? []).length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const cps = sandbox.campaign.checkpoints ?? [];
                        const lastCp = cps[cps.length - 1];
                        const res = restoreFromCheckpoint(sandbox.campaign, lastCp.checkpointId);
                        if (res.ok && res.restored) {
                          setSandbox(res.restored);
                          setFeedback({
                            ok: true,
                            text: `Восстановлено из Checkpoint "${lastCp.checkpointId}" (${lastCp.mapDefinitionId}, §341.7).`,
                          });
                        } else {
                          setFeedback({ ok: false, text: res.error ?? 'Ошибка отката.' });
                        }
                      }}
                      className="min-h-[44px] px-3 py-2 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-xs font-medium rounded cursor-pointer sm:col-span-2"
                    >
                      Откат к Checkpoint: {(sandbox.campaign.checkpoints ?? []).slice(-1)[0]?.checkpointId}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleLoadSnapshot('{"saveFormatVersion":1,"checksum":"deadbeef","campaign":{}}')}
                    className="min-h-[44px] px-3 py-2 bg-[#2a1719] hover:bg-[#381e21] border border-[#6e3238] text-xs font-medium text-[#f5b4b8] rounded cursor-pointer sm:col-span-2"
                  >
                    Тест: подменить повреждённый JSON (откат запрещён)
                  </button>
                </div>

                {/* §§341.6–341.7 Manual Slots vs AutoSave Ring + Combat Save Guard */}
                <div className="pt-3 border-t border-[#262d3d] space-y-2.5">
                  <div className="text-xs font-mono-num text-[#d6cfc0]">
                    Слоты (Manual vs AutoSave Ring §341.7): Ручных{' '}
                    <span className="text-[#facc15]">{Object.keys(saveRepo.manualSlots).length}/3</span> · AutoSave{' '}
                    <span className="text-[#93c5fd]">{saveRepo.autoSaveRing.length}/3</span> · Контекст:{' '}
                    {simInCombat ? 'В бою' : 'Вне боя'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSimInCombat((v) => !v);
                        setFeedback({
                          ok: true,
                          text: `Тестовый статус боя: ${!simInCombat ? 'В бою' : 'Вне боя'}.`,
                        });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Бой: {simInCombat ? 'В бою' : 'Мир'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        mutateSandbox((draft) => {
                          draft.mission.allowSaveDuringCombat = !draft.mission.allowSaveDuringCombat;
                          return {
                            ok: true,
                            text: `allowSaveDuringCombat = ${draft.mission.allowSaveDuringCombat} (§341.6).`,
                          };
                        })
                      }
                      className="min-h-[44px] px-3 py-1.5 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                    >
                      Боевой сейв: {sandbox.mission.allowSaveDuringCombat ? 'Разрешён' : 'Запрещён'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const res = saveToManualSlot(
                          saveRepo,
                          'slot_1',
                          sandbox.campaign,
                          sandbox.mission,
                          sandbox.activeMap,
                          sandbox.eventJournal,
                          simInCombat
                        );
                        setSaveRepo(res.repo);
                        setFeedback({
                          ok: res.ok,
                          text: res.ok
                            ? `Записан ручной слот slot_1 (v${res.record?.saveFormatVersion}, ${res.record?.checksum}).`
                            : res.reason ?? 'Запись заблокирована.',
                        });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                    >
                      Manual Slot 1
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const res = pushAutoSaveToRing(
                          saveRepo,
                          sandbox.campaign,
                          sandbox.mission,
                          sandbox.activeMap,
                          sandbox.eventJournal,
                          simInCombat
                        );
                        setSaveRepo(res.repo);
                        setFeedback({
                          ok: res.ok,
                          text: res.ok
                            ? `Добавлен AutoSave (${res.record?.slotId}), ручные слоты не затронуты.`
                            : res.reason ?? 'AutoSave заблокирован.',
                        });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                    >
                      Push AutoSave
                    </button>
                    <button
                      type="button"
                      disabled={saveRepo.autoSaveRing.length === 0}
                      onClick={() => {
                        setSaveRepo((prev) => {
                          if (prev.autoSaveRing.length === 0) return prev;
                          const copy = [...prev.autoSaveRing];
                          const last = copy[copy.length - 1];
                          copy[copy.length - 1] = {
                            ...last,
                            rawJson: '{"saveFormatVersion":2,"checksum":"corrupted","campaign":{}}',
                          };
                          return { ...prev, autoSaveRing: copy };
                        });
                        setFeedback({
                          ok: true,
                          text: 'Последний AutoSave искусственно повреждён для проверки fallback (§341.7).',
                        });
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#2a1719] hover:bg-[#381e21] disabled:opacity-40 border border-[#6e3238] text-xs text-[#f5b4b8] rounded cursor-pointer"
                    >
                      Повредить последний AutoSave
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const res = loadLatestValidAutoSave(saveRepo);
                        if (res.ok && res.snapshot) {
                          setSandbox({
                            campaign: res.snapshot.campaign,
                            mission: res.snapshot.mission,
                            activeMap: res.snapshot.activeMap,
                            eventJournal: res.snapshot.eventJournal,
                          });
                          setFeedback({
                            ok: true,
                            text: `Восстановлен AutoSave "${res.loadedFromSlotId}" (пропущено битых: ${res.skippedCorrupted.length}, §341.7).`,
                          });
                        } else {
                          setFeedback({
                            ok: false,
                            text: res.error ?? 'Нет валидных автосохранений.',
                          });
                        }
                      }}
                      className="min-h-[44px] px-3 py-1.5 bg-[#243227] hover:bg-[#2f4233] border border-[#446b4b] text-xs rounded cursor-pointer"
                    >
                      Загрузить AutoSave (fallback)
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 5: WORLD OBJECTS (§316), DIALOGUE (§333.6) & QUESTBOOK (§299 USER APPROVED) */}
        {activeTab === 'questbook' && (
          <div className="space-y-4">
            {/* §316 / §346.5 Interactive World Objects */}
            {sandbox.activeMap.worldObjects &&
              Object.keys(sandbox.activeMap.worldObjects).length > 0 && (
                <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-[#c49a45]">
                      Объекты сектора {sandbox.activeMap.mapDefinitionId.toUpperCase()} (§316, §346.5)
                    </h3>
                    <span className="text-[11px] text-[#9e9788]">
                      Interact (Аватар) · Loot (добыча) · без авто-навигации
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {Object.values(sandbox.activeMap.worldObjects).map((obj) => (
                      <div
                        key={obj.objectId}
                        className="p-2.5 rounded bg-[#171b25] border border-[#262d3d] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#eae3d2] truncate">
                            {obj.nameRu}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#9e9788]">
                            {obj.kind} · {obj.consumed ? 'Собрано' : obj.activated ? 'Активно' : 'Готово'}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          {obj.allowedVerbs.map((verb) => (
                            <button
                              key={verb}
                              type="button"
                              disabled={Boolean(obj.consumed)}
                              onClick={() => {
                                if (obj.kind === 'portal' && obj.targetMapDefId) {
                                  mutateSandbox((draft) => {
                                    const tId = `portal_obj_${obj.targetMapDefId}_${draft.campaign.processedTransitionIds.length + 1}`;
                                    const res = executePortalMapTransition(
                                      draft.campaign,
                                      draft.mission,
                                      draft.activeMap,
                                      obj.targetMapDefId!,
                                      tId,
                                      DEFAULT_WORKING_ASSUMPTIONS,
                                      draft.eventJournal
                                    );
                                    if (res.ok && res.nextMap) {
                                      draft.activeMap = res.nextMap;
                                      return {
                                        ok: true,
                                        text: `Портал "${obj.nameRu}" выполнен в ${obj.targetMapDefId}.`,
                                      };
                                    }
                                    return { ok: false, text: res.reason ?? 'Ошибка портала.' };
                                  }, 'PORTAL_OBJ_TRANSITION', 'Mission');
                                  return;
                                }
                                if (obj.kind === 'loot_cache' && verb === 'Loot') {
                                  setActiveLootContainerId(obj.objectId);
                                  setFeedback({
                                    ok: true,
                                    text: `Открыто окно содержимого "${obj.nameRu}" (выборочный подбор или «Взять всё», §128).`,
                                  });
                                  return;
                                }
                                mutateSandbox((draft) => {
                                  const evtId = `world_${obj.objectId}_${verb}_${draft.campaign.processedEventIds.length + 1}`;
                                  const r = interactWithWorldObject(
                                    draft.campaign,
                                    draft.activeMap,
                                    obj.objectId,
                                    verb,
                                    'avatar',
                                    evtId
                                  );
                                  if (r.ok && r.openDialogueId) {
                                    const dlg = PROTOTYPE_DIALOGUES[r.openDialogueId];
                                    if (dlg) {
                                      setActiveDialogue({
                                        dialogueId: dlg.dialogueId,
                                        nodeId: dlg.entryNodeId,
                                      });
                                    }
                                  }
                                  return { ok: r.ok, text: r.text };
                                }, 'WORLD_OBJECT_ACTION', 'MapInstance');
                              }}
                              className="min-h-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] disabled:opacity-40 border border-[#3a445b] text-xs font-medium rounded cursor-pointer"
                            >
                              {verb}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {activeLootContainerId && (() => {
                    const containerView = openLootContainer(sandbox.activeMap, activeLootContainerId);
                    if (!containerView.ok) return null;
                    return (
                      <div className="mt-3 p-3.5 rounded-lg bg-[#161a24] border border-[#c49a45]/60 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-[#e6c273]">
                            Окно добычи (§128): {containerView.containerNameRu} · осталось {containerView.remainingCount}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={containerView.remainingCount === 0}
                              onClick={() =>
                                mutateSandbox((draft) => {
                                  const r = takeAllLootEntries(
                                    draft.campaign,
                                    draft.activeMap,
                                    activeLootContainerId
                                  );
                                  if (r.ok) setActiveLootContainerId(null);
                                  return { ok: r.ok, text: r.text };
                                }, 'LOOT_TAKE_ALL', 'MapInstance')
                              }
                              className="min-h-[44px] px-3 bg-[#243227] hover:bg-[#2f4233] disabled:opacity-40 border border-[#446b4b] text-xs font-medium rounded cursor-pointer"
                            >
                              Взять всё
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveLootContainerId(null)}
                              className="min-h-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs rounded cursor-pointer"
                            >
                              Закрыть
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {containerView.entries.map((entry) => {
                            const label =
                              entry.kind === 'copper'
                                ? `${entry.quantity} Copper`
                                : `${PROTOTYPE_ITEMS[entry.definitionId ?? '']?.nameRu ?? entry.definitionId} ×${entry.quantity}`;
                            return (
                              <div
                                key={entry.entryId}
                                className="flex items-center justify-between gap-2 p-2 rounded bg-[#10131b] border border-[#242b3c]"
                              >
                                <span
                                  className={`text-xs ${entry.taken ? 'line-through text-[#6f6b62]' : 'text-[#eae3d2]'}`}
                                >
                                  {label}
                                </span>
                                <button
                                  type="button"
                                  disabled={entry.taken}
                                  onClick={() =>
                                    mutateSandbox((draft) => {
                                      const r = takeSingleLootEntry(
                                        draft.campaign,
                                        draft.activeMap,
                                        activeLootContainerId,
                                        entry.entryId
                                      );
                                      if (r.ok && r.remainingCount === 0) {
                                        setActiveLootContainerId(null);
                                      }
                                      return { ok: r.ok, text: r.text };
                                    }, 'LOOT_TAKE_SINGLE', 'MapInstance')
                                  }
                                  className="min-h-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] disabled:opacity-40 border border-[#3a445b] text-xs rounded cursor-pointer"
                                >
                                  {entry.taken ? 'Забрано' : 'Взять'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

            <div className="bg-[#12151d] border border-[#2a3142] rounded-lg p-4 space-y-4">
              {/* Questbook Filters */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#262d3d]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuestClassFilter('Main');
                      setMobileQuestDetailOpen(false);
                    }}
                    className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded border cursor-pointer ${
                      questClassFilter === 'Main'
                        ? 'bg-[#c49a45] text-[#101218] border-[#c49a45]'
                        : 'bg-[#171b25] text-[#d6cfc0] border-[#2c3448]'
                    }`}
                  >
                    Основные
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestClassFilter('Side');
                      setMobileQuestDetailOpen(false);
                    }}
                    className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded border cursor-pointer ${
                      questClassFilter === 'Side'
                        ? 'bg-[#c49a45] text-[#101218] border-[#c49a45]'
                        : 'bg-[#171b25] text-[#d6cfc0] border-[#2c3448]'
                    }`}
                  >
                    Дополнительные
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuestStatusFilter('active');
                      setMobileQuestDetailOpen(false);
                    }}
                    className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded border cursor-pointer ${
                      questStatusFilter === 'active'
                        ? 'bg-[#1f293d] text-[#f2ece0] border-[#c49a45]/60'
                        : 'bg-[#171b25] text-[#9e9788] border-[#2c3448]'
                    }`}
                  >
                    Активные
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestStatusFilter('done');
                      setMobileQuestDetailOpen(false);
                    }}
                    className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded border cursor-pointer ${
                      questStatusFilter === 'done'
                        ? 'bg-[#1f293d] text-[#f2ece0] border-[#c49a45]/60'
                        : 'bg-[#171b25] text-[#9e9788] border-[#2c3448]'
                    }`}
                  >
                    Завершённые
                  </button>
                </div>
              </div>

              {/* Mobile: 1 column (List OR Details + Back button); Desktop >= md: 2 columns */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Quest List */}
                <div
                  className={`md:col-span-5 space-y-2 ${
                    mobileQuestDetailOpen ? 'hidden md:block' : 'block'
                  }`}
                >
                  {filteredQuests.length === 0 ? (
                    <p className="text-xs text-[#8f8879] py-6 text-center">
                      В этой категории нет заданий.
                    </p>
                  ) : (
                    filteredQuests.map((q) => {
                      const isSelected = activeQuestDetail?.questId === q.questId;
                      return (
                        <button
                          key={q.questId}
                          type="button"
                          onClick={() => {
                            setSelectedQuestId(q.questId);
                            setMobileQuestDetailOpen(true);
                          }}
                          className={`w-full min-h-[56px] text-left p-3 rounded border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#1c2231] border-[#c49a45]'
                              : 'bg-[#171b25] hover:bg-[#1b202d] border-[#272e3f]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs sm:text-sm font-semibold text-[#f2ece0]">
                              {q.titleRu}
                            </span>
                            <span className="text-[11px] font-mono-num text-[#c49a45] shrink-0">
                              {q.status}
                            </span>
                          </div>
                          <p className="text-xs text-[#9e9788] mt-1">{q.summaryRu}</p>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Quest Details */}
                <div
                  className={`md:col-span-7 ${
                    mobileQuestDetailOpen ? 'block' : 'hidden md:block'
                  }`}
                >
                  <div className="md:hidden mb-3">
                    <button
                      type="button"
                      onClick={() => setMobileQuestDetailOpen(false)}
                      className="min-h-[44px] px-4 py-2 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#c49a45]/45 text-xs font-semibold text-[#eae3d2] rounded cursor-pointer"
                    >
                      ← Назад к списку
                    </button>
                  </div>

                  {activeQuestDetail ? (
                    <div className="p-4 rounded bg-[#171b25] border border-[#283042] space-y-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-[#c49a45] font-semibold">
                          {activeQuestDetail.questClass === 'Main' ? 'Основное задание' : 'Дополнительное задание'} ·{' '}
                          {activeQuestDetail.status}
                        </div>
                        <h4 className="font-display text-lg font-bold text-[#f2ece0] mt-0.5">
                          {activeQuestDetail.titleRu}
                        </h4>
                        <p className="text-xs sm:text-sm text-[#c5beae] mt-2 leading-relaxed">
                          {activeQuestDetail.fullDescriptionRu}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-[#c49a45]">
                          Этапы (без принудительных маршрутных маркеров §299.5)
                        </div>
                        {activeQuestDetail.stages.map((st) => (
                          <div
                            key={st.stageId}
                            className="p-2.5 rounded bg-[#12151d] border border-[#242b3b] flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div
                                className={`text-xs font-medium ${
                                  st.completed ? 'text-[#86efac] line-through' : 'text-[#eae3d2]'
                                }`}
                              >
                                {st.titleRu}
                              </div>
                              <div className="text-[11px] text-[#8f8879] mt-0.5">{st.descriptionRu}</div>
                            </div>
                            {!st.completed && activeQuestDetail.status === 'Active' && (
                              <button
                                type="button"
                                onClick={() =>
                                  mutateSandbox((draft) => {
                                    const evtId = `quest_${activeQuestDetail.questId}_${st.stageId}`;
                                    const r = completeQuestStageAndMaybeReward(
                                      draft.campaign,
                                      activeQuestDetail.questId,
                                      st.stageId,
                                      evtId
                                    );
                                    return {
                                      ok: r.ok,
                                      text: r.questCompleted
                                        ? 'Задание завершено! Награда выдана однократно по RewardId.'
                                        : r.ok
                                          ? 'Этап задания отмечен выполненным.'
                                          : r.reason ?? '',
                                    };
                                  }, 'QUEST_STAGE_UPDATED')
                                }
                                className="min-h-[44px] px-3 bg-[#1f2636] hover:bg-[#2a344a] border border-[#3a445b] text-xs font-medium rounded cursor-pointer shrink-0"
                              >
                                Завершить этап
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {activeQuestDetail.loreJournalNotesRu.length > 0 && (
                        <div className="pt-2 border-t border-[#262d3d] space-y-1.5">
                          <div className="text-xs font-semibold text-[#9e9788]">Журнальные заметки</div>
                          {activeQuestDetail.loreJournalNotesRu.map((note, idx) => (
                            <p key={idx} className="text-xs text-[#b8b09f]">
                              • {note}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#8f8879] py-6 text-center">
                      Выберите задание для просмотра деталей.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* §333.7, §348.2.9, §348.4 Blocking Dialogue Overlay (preserves army orders) */}
      {activeDialogue && (() => {
        const dlg = PROTOTYPE_DIALOGUES[activeDialogue.dialogueId];
        const node = dlg?.nodes[activeDialogue.nodeId];
        if (!dlg || !node) return null;
        const mapGuard = canAcceptMapCommands(sandbox.activeMap, { dialogueOpen: true });
        return (
          <div
            className="fixed inset-0 z-60 bg-black/75 flex items-end sm:items-center justify-center p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={dlg.titleRu}
          >
            <div className="w-full max-w-lg bg-[#12151d] border border-[#c49a45]/60 rounded-lg p-4 sm:p-5 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#262d3d]">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#c49a45] font-semibold">
                    {node.speakerRu}
                  </div>
                  <h4 className="font-display text-sm sm:text-base font-bold text-[#f2ece0]">
                    {dlg.titleRu}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveDialogue(null)}
                  className="min-h-[44px] px-3 bg-[#1a1f2b] hover:bg-[#242b3b] border border-[#343c4f] text-xs rounded cursor-pointer"
                >
                  Закрыть (Back)
                </button>
              </div>
              <p className="text-xs sm:text-sm text-[#eae3d2] leading-relaxed">{node.textRu}</p>
              <div className="text-[11px] text-[#93c5fd] font-mono-num">
                {mapGuard.reason} · Приказ отряда Альфа сохранён: {squadAlpha?.playerOrder ?? 'Idle'}
              </div>
              <div className="space-y-2 pt-1">
                {node.choices.map((choice) => {
                  const cond = evaluateDialogueCondition(sandbox.campaign, choice.condition);
                  return (
                    <button
                      key={choice.choiceId}
                      type="button"
                      disabled={!cond.met}
                      onClick={() => {
                        let nextId: string | null = null;
                        mutateSandbox((draft) => {
                          const res = applyDialogueChoice(
                            draft.campaign,
                            draft.activeMap,
                            dlg.dialogueId,
                            node.nodeId,
                            choice.choiceId
                          );
                          nextId = res.nextNodeId;
                          return { ok: res.ok, text: res.summaryRu };
                        }, 'DIALOGUE_CHOICE');
                        if (nextId) {
                          setActiveDialogue({ dialogueId: dlg.dialogueId, nodeId: nextId });
                        } else {
                          setActiveDialogue(null);
                        }
                      }}
                      className="w-full min-h-[44px] p-3 text-left bg-[#171b25] hover:bg-[#202635] disabled:opacity-45 border border-[#2f374b] rounded cursor-pointer disabled:cursor-not-allowed"
                    >
                      <div className="text-xs font-medium text-[#f2ece0]">{choice.textRu}</div>
                      {!cond.met && cond.reason && (
                        <div className="text-[11px] text-[#f5b4b8] mt-0.5">{cond.reason}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bottom Tab Navigation (Thumb-Zone ergonomics, >=44px hitboxes, max 5 items) */}
      <nav
        aria-label="Разделы систем v14.2"
        className="shrink-0 grid grid-cols-5 bg-[#12151d] border-t border-[#c49a45]/35"
      >
        {(
          [
            { id: 'hero', label: 'Герой' },
            { id: 'magic_combat', label: 'Бой/Магия' },
            { id: 'settlement', label: 'Поселение' },
            { id: 'economy_portal', label: 'Склад' },
            { id: 'questbook', label: 'Задания' },
          ] as Array<{ id: SliceTab; label: string }>
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[48px] px-2 py-2 text-xs sm:text-sm font-medium border-t-2 transition-colors cursor-pointer truncate ${
                isActive
                  ? 'border-[#c49a45] text-[#f2ece0] bg-[#181c27]'
                  : 'border-transparent text-[#9e9788] hover:text-[#eae3d2]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
