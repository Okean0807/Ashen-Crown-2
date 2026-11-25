/**
 * ASHEN CROWN — Управление слотами сохранений, кольцом автосохранений и fallback-восстановлением (§§341.6–341.7).
 */

import { DEFAULT_WORKING_ASSUMPTIONS, type ProvisionalBalanceConfig } from './config';
import { createSaveSnapshot, validateAndLoadSnapshot } from './inventoryAndSave';
import type {
  CampaignState,
  MapInstanceState,
  MissionState,
  SaveEvent,
  SaveRepositoryState,
  SaveSlotRecord,
  SaveSnapshot,
} from './types';

export function createEmptySaveRepository(): SaveRepositoryState {
  return {
    manualSlots: {},
    autoSaveRing: [],
  };
}

/**
 * §341.6: Явная проверка возможности сохранения в текущем боевом/сценарном контексте.
 */
export function canCreateSaveInContext(
  mission: MissionState,
  inCombat: boolean
): { allowed: boolean; reason?: string } {
  if (inCombat && !mission.allowSaveDuringCombat) {
    return {
      allowed: false,
      reason: 'Сохранение во время боя запрещено настройками текущей миссии (allowSaveDuringCombat = false, §341.6).',
    };
  }
  return { allowed: true };
}

/**
 * §341.7: Сохранение в ручной слот. Ручные слоты строго изолированы от автосохранений.
 */
export function saveToManualSlot(
  repo: SaveRepositoryState,
  slotId: string,
  campaign: CampaignState,
  mission: MissionState,
  activeMap: MapInstanceState,
  eventJournal: SaveEvent[] = [],
  inCombat = false,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; repo: SaveRepositoryState; record?: SaveSlotRecord; reason?: string } {
  const ctx = canCreateSaveInContext(mission, inCombat);
  if (!ctx.allowed) {
    return { ok: false, repo, reason: ctx.reason };
  }

  const slotNumberMatch = slotId.match(/(\d+)$/);
  if (slotNumberMatch && Number(slotNumberMatch[1]) > config.manualSaveSlotCount) {
    return {
      ok: false,
      repo,
      reason: `Слот "${slotId}" превышает лимит ручных слотов (${config.manualSaveSlotCount}).`,
    };
  }

  const snap = createSaveSnapshot(campaign, mission, activeMap, eventJournal, `manual_${slotId}_${Date.now()}`);
  const record: SaveSlotRecord = {
    slotId,
    kind: 'manual',
    savedAtIso: snap.createdAtIso,
    mapDefinitionId: activeMap.mapDefinitionId,
    saveFormatVersion: snap.saveFormatVersion,
    checksum: snap.checksum,
    rawJson: JSON.stringify(snap),
  };

  return {
    ok: true,
    repo: {
      ...repo,
      manualSlots: {
        ...repo.manualSlots,
        [slotId]: record,
      },
    },
    record,
  };
}

/**
 * §341.7: Кольцевой буфер автосохранений. Никогда не перезаписывает ручные слоты.
 */
export function pushAutoSaveToRing(
  repo: SaveRepositoryState,
  campaign: CampaignState,
  mission: MissionState,
  activeMap: MapInstanceState,
  eventJournal: SaveEvent[] = [],
  inCombat = false,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { ok: boolean; repo: SaveRepositoryState; record?: SaveSlotRecord; reason?: string } {
  const ctx = canCreateSaveInContext(mission, inCombat);
  if (!ctx.allowed) {
    return { ok: false, repo, reason: ctx.reason };
  }

  const snap = createSaveSnapshot(
    campaign,
    mission,
    activeMap,
    eventJournal,
    `auto_${Date.now()}_${repo.autoSaveRing.length + 1}`
  );
  const record: SaveSlotRecord = {
    slotId: `autosave_${repo.autoSaveRing.length + 1}`,
    kind: 'autosave',
    savedAtIso: snap.createdAtIso,
    mapDefinitionId: activeMap.mapDefinitionId,
    saveFormatVersion: snap.saveFormatVersion,
    checksum: snap.checksum,
    rawJson: JSON.stringify(snap),
  };

  const nextRing = [...repo.autoSaveRing, record].slice(-Math.max(1, config.autoSaveRingCapacity));

  return {
    ok: true,
    repo: {
      ...repo,
      autoSaveRing: nextRing,
    },
    record,
  };
}

/**
 * §341.7–341.8: Загрузка последнего валидного автосохранения с автоматическим fallback
 * на предыдущую рабочую копию без стирания повреждённой или активного состояния.
 */
export function loadLatestValidAutoSave(repo: SaveRepositoryState): {
  ok: boolean;
  snapshot?: SaveSnapshot;
  loadedFromSlotId?: string;
  skippedCorrupted: Array<{ slotId: string; error: string }>;
  error?: string;
} {
  const skippedCorrupted: Array<{ slotId: string; error: string }> = [];

  for (let i = repo.autoSaveRing.length - 1; i >= 0; i--) {
    const rec = repo.autoSaveRing[i];
    const loaded = validateAndLoadSnapshot(rec.rawJson);
    if (loaded.ok) {
      return {
        ok: true,
        snapshot: loaded.snapshot,
        loadedFromSlotId: rec.slotId,
        skippedCorrupted,
      };
    }
    skippedCorrupted.push({
      slotId: rec.slotId,
      error: loaded.error,
    });
  }

  return {
    ok: false,
    skippedCorrupted,
    error:
      skippedCorrupted.length > 0
        ? `Все автосохранения повреждены (${skippedCorrupted.map((s) => `${s.slotId}: ${s.error}`).join(' | ')}).`
        : 'Кольцо автосохранений пусто.',
  };
}
