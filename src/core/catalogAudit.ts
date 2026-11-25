/**
 * ASHEN CROWN — Валидатор числового аудита (§352) и схемы контентных каталогов (§353).
 *
 * Гарантии:
 * - §352.2: 6 классов числовых данных (SOURCE_EXACT, SOURCE_SECONDARY, OBSERVED, DESIGN_TARGET, UNKNOWN, CONFLICT).
 * - §352.6: Ни одно обязательное поле не может молча оставаться пустым; при CONFLICT сохранены обе стороны.
 * - §352.4 / §339.3: Проверка канонической 6-расовой матрицы ресурсов (включая Iron для Elves/Trolls, Lenya для Orcs, Aria/Moonsilver для Dark Elves).
 * - §353.3: Проверка обязательной схемы записи контентной сущности.
 * - §353.5: Прототипный отчёт честно фиксирует статус PARTIAL и не объявляет контентные каталоги завершёнными.
 */

import { PROTOTYPE_ITEMS, PROTOTYPE_SPELLS } from './catalog';
import { PLAYABLE_RACES } from './config';
import type {
  CatalogAuditReport,
  ContentCatalogEntityRecord,
  NumericalAuditEntry,
  PlayableRaceId,
  RaceResourceType,
} from './types';

const ALL_RESOURCES: RaceResourceType[] = [
  'wood',
  'stone',
  'iron',
  'aria',
  'lenya',
  'moonsilver',
  'food',
];

const EXPECTED_RACE_RESOURCES: Record<PlayableRaceId, RaceResourceType[]> = {
  humans: ['wood', 'stone', 'iron', 'aria', 'food'],
  elves: ['wood', 'iron', 'lenya', 'food'],
  dwarves: ['stone', 'iron', 'moonsilver', 'food'],
  orcs: ['wood', 'iron', 'lenya', 'food'],
  trolls: ['wood', 'stone', 'iron', 'food'],
  dark_elves: ['stone', 'iron', 'moonsilver', 'aria', 'food'],
};

/**
 * §352.2–352.6: Валидация строк числового аудита (Numerical Audit Register).
 */
export function validateNumericalAuditEntries(entries: NumericalAuditEntry[]): {
  ok: boolean;
  errorsRu: string[];
} {
  const errorsRu: string[] = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    const tag = `${e.entityId || `#${idx}`}.${e.field || '?'}`;

    if (!e.entityId?.trim()) errorsRu.push(`${tag}: отсутствует стабильный entityId (§352.2).`);
    if (!e.field?.trim()) errorsRu.push(`${tag}: не указано проверяемое поле field.`);
    if (!e.unit?.trim()) errorsRu.push(`${tag}: отсутствует единица измерения unit (§352.2).`);
    if (!e.sourceGame?.trim()) errorsRu.push(`${tag}: не указан sourceGame.`);
    if (!e.edition?.trim()) errorsRu.push(`${tag}: не указан edition.`);
    if (!e.patch?.trim()) errorsRu.push(`${tag}: не указан patch.`);
    if (!e.campaignScope?.trim()) errorsRu.push(`${tag}: не указан campaignScope.`);
    if (!e.sourceRef?.trim()) errorsRu.push(`${tag}: отсутствует ссылка на источник sourceRef.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.checkedAt || '')) {
      errorsRu.push(`${tag}: некорректная дата проверки checkedAt (ожидается YYYY-MM-DD).`);
    }

    if (e.confidence !== 'UNKNOWN' && (e.value === null || e.value === undefined || e.value === '')) {
      errorsRu.push(`${tag}: поле value пустое при статусе ${e.confidence} (§352.6).`);
    }

    if (e.confidence === 'UNKNOWN' && !e.notes?.trim()) {
      errorsRu.push(`${tag}: статус UNKNOWN обязан содержать пояснение в notes (§352.6).`);
    }

    if (e.confidence === 'CONFLICT') {
      if (
        !e.conflictAlternative ||
        e.conflictAlternative.value === '' ||
        !e.conflictAlternative.sourceRef?.trim() ||
        !e.conflictAlternative.context?.trim()
      ) {
        errorsRu.push(
          `${tag}: статус CONFLICT обязан сохранять альтернативное значение, sourceRef и context (§352.2).`
        );
      }
    }
  }

  return { ok: errorsRu.length === 0, errorsRu };
}

/**
 * §339.2–339.5 & §352.4: Валидация канонической матрицы 6 рас и их ресурсных способностей.
 */
export function validateSixRaceResourceMatrix(): {
  ok: boolean;
  errorsRu: string[];
} {
  const errorsRu: string[] = [];
  const raceIds = Object.keys(PLAYABLE_RACES) as PlayableRaceId[];
  if (raceIds.length !== 6) {
    errorsRu.push(`Ожидалось строго 6 игровых народов (§321, §351.2), обнаружено: ${raceIds.length}.`);
  }

  for (const raceId of Object.keys(EXPECTED_RACE_RESOURCES) as PlayableRaceId[]) {
    const profile = PLAYABLE_RACES[raceId];
    if (!profile) {
      errorsRu.push(`Отсутствует профиль расы ${raceId}.`);
      continue;
    }

    const expected = [...EXPECTED_RACE_RESOURCES[raceId]].sort();
    const actual = [...profile.resourcesUsed].sort();
    if (expected.join(',') !== actual.join(',')) {
      errorsRu.push(
        `Раса ${raceId}: расхождение resourcesUsed (${actual.join(', ')}) с каноном §339.3 (${expected.join(', ')}).`
      );
    }

    for (const res of ALL_RESOURCES) {
      const cap = profile.resourceCapabilities?.[res];
      if (!cap) {
        errorsRu.push(`Раса ${raceId}: отсутствует запись resourceCapabilities.${res}.`);
        continue;
      }
      const shouldUse = expected.includes(res);
      if (cap.used !== shouldUse) {
        errorsRu.push(`Раса ${raceId}: resourceCapabilities.${res}.used=${cap.used}, ожидалось ${shouldUse}.`);
      }
    }

    // §339.2 / §352.4: Специальная проверка Iron у Elves и Trolls
    if (raceId === 'elves' || raceId === 'trolls') {
      const ironCap = profile.resourceCapabilities.iron;
      if (!ironCap.used || ironCap.hasEfficientOwnExtraction) {
        errorsRu.push(
          `Раса ${raceId}: Iron обязан быть used=true, но hasEfficientOwnExtraction=false (§339.2, §352.4).`
        );
      }
    }

    // §339.4–339.5: Dark Elves используют SlaveWorker
    if (raceId === 'dark_elves' && profile.defaultWorkerRole !== 'SlaveWorker') {
      errorsRu.push('Раса dark_elves обязана фиксировать defaultWorkerRole="SlaveWorker" (§339.4–339.5).');
    }
  }

  return { ok: errorsRu.length === 0, errorsRu };
}

/**
 * §353.3: Валидация записей контентного каталога + кросс-проверка стоимости против матрицы 6 рас (§352.4).
 */
export function validateContentCatalogRecords(records: ContentCatalogEntityRecord[]): {
  ok: boolean;
  errorsRu: string[];
} {
  const errorsRu: string[] = [];
  const seenIds = new Set<string>();

  for (let idx = 0; idx < records.length; idx++) {
    const r = records[idx];
    const tag = r.contentId || `record#${idx}`;

    if (!r.contentId?.trim()) {
      errorsRu.push(`${tag}: отсутствует стабильный contentId (§353.3).`);
    } else if (seenIds.has(r.contentId)) {
      errorsRu.push(`${tag}: дубликат contentId.`);
    } else {
      seenIds.add(r.contentId);
    }

    if (!r.displayName?.trim()) errorsRu.push(`${tag}: отсутствует displayName.`);
    if (!r.sourceGame?.trim() || !r.edition?.trim() || !r.patch?.trim() || !r.campaignScope?.trim()) {
      errorsRu.push(`${tag}: неполный provenance (sourceGame/edition/patch/campaignScope, §353.3).`);
    }
    if (!Array.isArray(r.sourceRefs) || r.sourceRefs.length === 0) {
      errorsRu.push(`${tag}: отсутствует sourceRefs.`);
    }
    if (!r.gameplayRole?.trim()) errorsRu.push(`${tag}: отсутствует gameplayRole.`);

    // Кросс-проверка ресурсной стоимости против 6-расовой матрицы (§339.3, §352.4)
    if (r.raceOrFactionId !== 'neutral' && r.raceOrFactionId !== 'all_races') {
      const profile = PLAYABLE_RACES[r.raceOrFactionId];
      if (!profile) {
        errorsRu.push(`${tag}: неизвестный raceOrFactionId="${r.raceOrFactionId}".`);
      } else {
        for (const [resKey, amount] of Object.entries(r.cost)) {
          if ((amount ?? 0) > 0) {
            const res = resKey as RaceResourceType;
            if (!profile.resourceCapabilities[res]?.used) {
              errorsRu.push(
                `${tag}: стоимость использует ресурс "${res}", недопустимый для расы ${profile.nameRu} (§339.3, §352.4).`
              );
            }
          }
        }
      }
    }

    // §352.6 / §353.3: Запрет молча пустых значений в stats без фиксации в unknownFields
    for (const [statKey, statVal] of Object.entries(r.stats)) {
      if ((statVal.value === null || statVal.value === undefined) && !r.unknownFields.includes(statKey)) {
        errorsRu.push(
          `${tag}: параметр stats.${statKey} пуст, но не перечислен в unknownFields (§352.6, §353.3).`
        );
      }
    }
  }

  return { ok: errorsRu.length === 0, errorsRu };
}

/**
 * §352–353, §355.3: Сводный честный аудит текущего прототипного каталога.
 * По правилу §353.5 статус контента остаётся PARTIAL до завершения полного числового и лорного наполнения.
 */
export function runPrototypeCatalogAndAuditReport(
  additionalNumericalEntries: NumericalAuditEntry[] = [],
  additionalCatalogRecords: ContentCatalogEntityRecord[] = []
): CatalogAuditReport {
  const baselineNumerical: NumericalAuditEntry[] = [
    {
      entityId: 'avatar_core',
      field: 'respawn_delay',
      value: 120,
      unit: 'seconds',
      sourceGame: 'ASHEN CROWN',
      edition: 'v14.2',
      patch: 'core',
      campaignScope: 'all_maps',
      sourceRef: 'v14.2 §288, §101.5',
      confidence: 'DESIGN_TARGET',
      checkedAt: '2026-11-25',
      notes: 'Утверждённая задержка возрождения у Stone of Souls (2 игровые минуты).',
    },
    {
      entityId: 'economy_currency',
      field: 'copper_per_silver',
      value: 100,
      unit: 'ratio',
      sourceGame: 'ASHEN CROWN',
      edition: 'v14.2',
      patch: 'core',
      campaignScope: 'all_maps',
      sourceRef: 'v14.2 §134.8, §331.3',
      confidence: 'DESIGN_TARGET',
      checkedAt: '2026-11-25',
      notes: '100 Copper = 1 Silver, 100 Silver = 1 Gold.',
    },
    {
      entityId: 'avatar_death',
      field: 'xp_loss_rate',
      value: null,
      unit: 'ratio',
      sourceGame: 'ASHEN CROWN',
      edition: 'v14.2',
      patch: 'core',
      campaignScope: 'all_maps',
      sourceRef: 'OPEN_ISSUES.md OD-001',
      confidence: 'UNKNOWN',
      checkedAt: '2026-11-25',
      notes: 'OD-001 OPEN: используется временное допущение 5% в ProvisionalBalanceConfig.',
    },
    ...additionalNumericalEntries,
  ];

  const baselineRecords: ContentCatalogEntityRecord[] = [
    {
      contentId: 'proto_humans_footman_squad',
      displayName: 'Отряд пехоты (тестовый)',
      localizedNames: { ru: 'Отряд пехоты (тестовый)' },
      entityType: 'unit',
      raceOrFactionId: 'humans',
      sourceGame: 'ASHEN CROWN',
      edition: 'v14.2',
      patch: 'slice9',
      campaignScope: 'vertical_slice',
      sourceStatus: 'DESIGN_TARGET',
      sourceRefs: ['v14.2 §322, §343.5'],
      gameplayRole: 'frontline_melee',
      requirements: ['building:barracks'],
      cost: { wood: 20, iron: 15, food: 5 },
      stats: { squadSize: { value: 4, unit: 'units' } },
      abilities: [],
      productionLinks: ['barracks'],
      variants: [],
      availabilityConditions: ['map_has_settlement'],
      confidence: 'DESIGN_TARGET',
      unknownFields: ['final_prod_cost_all_tiers'],
      conflicts: [],
      designStatus: 'PARTIAL',
      acceptanceTests: ['T-V14-09', 'T-V14-27'],
    },
    ...additionalCatalogRecords,
  ];

  const raceCheck = validateSixRaceResourceMatrix();
  const numCheck = validateNumericalAuditEntries(baselineNumerical);
  const catCheck = validateContentCatalogRecords(baselineRecords);

  const hasErrors = !raceCheck.ok || !numCheck.ok || !catCheck.ok;

  return {
    // §353.5: Контентные каталоги запрещено объявлять завершёнными до закрытия OD-007..014
    overallCatalogStatus: hasErrors ? 'INVALID' : 'PARTIAL',
    numericalErrorsRu: numCheck.errorsRu,
    catalogErrorsRu: catCheck.errorsRu,
    raceMatrixErrorsRu: raceCheck.errorsRu,
    openGapsRu: [
      '§353.5 / OD-007: Полный каталог заклинаний (130+ позиций) не завершён.',
      '§353.5 / OD-010: Полные таблицы стоимостей/добычи 6 рас открыты.',
      '§353.5 / OD-011–012: Полный бестиарий и производственный каталог предметов в статусе PARTIAL.',
      '§353.5 / OD-013–014: Сюжетная кампания и канонический лор отложены (DEFERRED).',
    ],
    stats: {
      racesAudited: Object.keys(PLAYABLE_RACES).length,
      prototypeItemsCount: Object.keys(PROTOTYPE_ITEMS).length,
      prototypeSpellsCount: Object.keys(PROTOTYPE_SPELLS).length,
      numericalEntriesChecked: baselineNumerical.length,
      catalogRecordsChecked: baselineRecords.length,
    },
  };
}
