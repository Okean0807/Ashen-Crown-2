import React from 'react';
import type { EquipSlotId } from '../core/types';
import { ActiveLootWindowState, EquipSlot, HudSnapshot, ItemDef } from '../game/types';

interface InventoryModalProps {
  hud: HudSnapshot;
  onClose: () => void;
  onEquipCoreItem: (instanceId: string) => void;
  onUnequipCoreSlot: (slot: EquipSlotId) => void;
  onTranscribeCoreScroll: (instanceId: string) => void;
  onOpenV14Slice: () => void;
}

const RARITY_META: Record<
  ItemDef['rarity'],
  { labelRu: string; titleCls: string; borderCls: string; barCls: string }
> = {
  common: {
    labelRu: 'Обычный',
    titleCls: 'text-[#e8e1d1]',
    borderCls: 'border-[#3a4254]',
    barCls: 'bg-[#7d889c]',
  },
  rare: {
    labelRu: 'Редкий',
    titleCls: 'text-[#7cc0ff]',
    borderCls: 'border-[#3b82f6]/55',
    barCls: 'bg-[#3b82f6]',
  },
  epic: {
    labelRu: 'Эпический',
    titleCls: 'text-[#f8d060]',
    borderCls: 'border-[#d4a442]/75',
    barCls: 'bg-[#d4a442]',
  },
};

const SLOT_THEME: Record<
  EquipSlot,
  {
    labelRu: string;
    emptyHintRu: string;
    iconBgCls: string;
    accentTextCls: string;
    cardTintCls: string;
  }
> = {
  weapon: {
    labelRu: 'Оружие',
    emptyHintRu: 'Нет экипированного клинка',
    iconBgCls: 'bg-[#2a1d19] border-[#b45309]/45 text-[#f5b66b]',
    accentTextCls: 'text-[#e9a559]',
    cardTintCls: 'bg-[#171821]',
  },
  armor: {
    labelRu: 'Доспех',
    emptyHintRu: 'Нагрудник не надет',
    iconBgCls: 'bg-[#182230] border-[#4774a8]/45 text-[#8cc2f6]',
    accentTextCls: 'text-[#84b8eb]',
    cardTintCls: 'bg-[#151a24]',
  },
  relic: {
    labelRu: 'Реликвия',
    emptyHintRu: 'Талисман не выбран',
    iconBgCls: 'bg-[#241b2e] border-[#935ec7]/50 text-[#d4a8ff]',
    accentTextCls: 'text-[#c99df5]',
    cardTintCls: 'bg-[#181724]',
  },
};

const SLOT_EMPTY_HINT_RU: Record<EquipSlotId, string> = {
  main_hand: 'Оружие не надето',
  off_hand: 'Щит или предмет не надет',
  armor: 'Нагрудник не надет',
  helm: 'Шлем не надет',
  amulet: 'Амулет не надет',
  ring_1: 'Кольцо не надето',
  ring_2: 'Кольцо не надето',
};

const STRAIN_LABELS_RU: Record<'normal' | 'elevated' | 'critical', { text: string; cls: string }> =
  {
    normal: { text: 'Спокойна', cls: 'text-[#5eead4]' },
    elevated: { text: 'Повышена', cls: 'text-[#fbbf24]' },
    critical: { text: 'Предельна', cls: 'text-[#f87171]' },
  };

const CATEGORY_LABELS_RU: Record<string, string> = {
  weapon_1h: 'Одноручное',
  weapon_2h: 'Двуручное',
  weapon_polearm: 'Древковое',
  weapon_bow: 'Лук',
  weapon_crossbow: 'Арбалет',
  shield: 'Щит',
  armor: 'Доспех',
  helm: 'Шлем',
  jewelry: 'Украшение',
  spell_scroll: 'Свиток магии',
  worker_rune: 'Руна рабочих',
  hero_rune: 'Руна героя',
  building_plan: 'План здания',
  unit_plan: 'План воинов',
  material: 'Материал',
  quest_item: 'Квестовый',
};

/** Stylized dark-fantasy SVG icons tailored per item archetype and equipment slot. */
const ItemGlyph: React.FC<{ slot: ItemDef['slot']; itemId?: string; muted?: boolean }> = ({
  slot,
  itemId,
  muted = false,
}) => {
  const opacity = muted ? 'opacity-35' : 'opacity-100';

  if (slot === 'weapon') {
    const isClaymore = itemId === 'runed_claymore';
    return (
      <svg
        width="26"
        height="26"
        viewBox="0 0 28 28"
        fill="none"
        className={opacity}
        aria-hidden="true"
      >
        <path
          d={isClaymore ? 'M21 4L23 5L12.5 19.5L9.5 16.5L21 4Z' : 'M20 5L22 7L12 18.5L9.5 16L20 5Z'}
          fill="currentColor"
          fillOpacity={isClaymore ? '0.92' : '0.82'}
        />
        {isClaymore && (
          <path d="M19.5 7.5L13.5 15.5" stroke="#fef3c7" strokeWidth="1.2" strokeLinecap="round" />
        )}
        <path
          d="M7 14.5L13.5 21"
          stroke="#d4a442"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d="M9.5 18.5L5.5 22.5" stroke="#9ca3af" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="4.8" cy="23.2" r="1.6" fill="#d4a442" />
      </svg>
    );
  }

  if (slot === 'armor') {
    const isRoyal = itemId === 'crown_plate';
    return (
      <svg
        width="26"
        height="26"
        viewBox="0 0 28 28"
        fill="none"
        className={opacity}
        aria-hidden="true"
      >
        <path
          d="M8.5 5.5L11.5 4.5C12.8 6.4 15.2 6.4 16.5 4.5L19.5 5.5L23 10.5L19.8 12.2L18.8 22.5L14 24.2L9.2 22.5L8.2 12.2L5 10.5L8.5 5.5Z"
          fill="currentColor"
          fillOpacity="0.28"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M14 7.5V22.5"
          stroke={isRoyal ? '#facc15' : 'currentColor'}
          strokeWidth="1.3"
          strokeOpacity="0.85"
        />
        <path
          d="M9.6 13.5H18.4"
          stroke={isRoyal ? '#facc15' : 'currentColor'}
          strokeWidth="1.2"
          strokeOpacity="0.7"
        />
        {isRoyal && <circle cx="14" cy="11.2" r="1.7" fill="#facc15" />}
      </svg>
    );
  }

  if (slot === 'relic') {
    const isSignet = itemId === 'ember_signet';
    return (
      <svg
        width="26"
        height="26"
        viewBox="0 0 28 28"
        fill="none"
        className={opacity}
        aria-hidden="true"
      >
        {isSignet ? (
          <>
            <circle
              cx="14"
              cy="15.5"
              r="7.2"
              stroke="#d4a442"
              strokeWidth="2.1"
              fill="currentColor"
              fillOpacity="0.14"
            />
            <polygon
              points="14,4.5 18,9 14,13.5 10,9"
              fill="#fb923c"
              stroke="#fde68a"
              strokeWidth="1.1"
            />
          </>
        ) : (
          <>
            <polygon
              points="14,3.5 22.5,14 14,24.5 5.5,14"
              fill="currentColor"
              fillOpacity="0.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <polygon points="14,8.2 18.2,14 14,19.8 9.8,14" fill="#e9d5ff" fillOpacity="0.85" />
          </>
        )}
      </svg>
    );
  }

  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 28 28"
      fill="none"
      className="opacity-70"
      aria-hidden="true"
    >
      <path
        d="M11.5 5H16.5V8.5L20.5 14.5C21.8 16.5 20.4 22.5 14 22.5C7.6 22.5 6.2 16.5 7.5 14.5L11.5 8.5V5Z"
        fill="#7f1d1d"
        fillOpacity="0.45"
        stroke="#f87171"
        strokeWidth="1.4"
      />
      <path d="M7 21L21 7" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
};

export const InventoryModal: React.FC<InventoryModalProps> = ({
  hud,
  onClose,
  onEquipCoreItem,
  onUnequipCoreSlot,
  onTranscribeCoreScroll,
  onOpenV14Slice,
}) => {
  const hero = hud.hero;
  const v14 = hud.v14Core;
  const strainMeta = v14 ? STRAIN_LABELS_RU[v14.magicStrainStatus] : null;
  const coreEquipment = v14?.coreEquipment ?? [];
  const coreInventory = v14?.corePartyInventory ?? [];

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/75 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Снаряжение и рюкзак Аватара"
    >
      <div className="w-full max-w-2xl bg-[#11141c] border border-[#c49a45]/45 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[86vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-3.5 py-3 sm:px-5 sm:py-3.5 bg-[#151924] border-b border-[#262d3d] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base sm:text-lg font-bold text-[#f3ecdc] tracking-wide truncate">
                Снаряжение Аватара
              </h2>
              {hero && (
                <span className="text-[11px] font-mono-num text-[#d4a442] shrink-0">
                  Ур. {hero.level ?? 1}
                </span>
              )}
            </div>
            {hero && (
              <p className="text-[11px] sm:text-xs text-[#a39c8d] font-mono-num mt-0.5 truncate">
                {v14?.specializationRu ?? 'Гибрид'} · АТК {hero.baseAtk} · БРН {hero.baseArmor} · ОЗ{' '}
                {Math.ceil(hero.hp)}/{hero.maxHp}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenV14Slice}
              className="min-h-[44px] sm:min-h-[40px] px-2.5 sm:px-3 py-1.5 bg-[#1e2536] hover:bg-[#283148] border border-[#c49a45]/45 text-[#f4cf6a] text-xs font-semibold rounded cursor-pointer whitespace-nowrap"
            >
              Лист героя
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть инвентарь"
              className="min-h-[44px] min-w-[44px] sm:min-h-[40px] sm:min-w-[40px] px-2.5 py-1.5 bg-[#1a1f2b] hover:bg-[#252c3c] border border-[#2f3749] text-[#e6dfd0] text-xs font-medium rounded cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Live Action Feedback Banner inside Modal (DEF-04) */}
        {hud.bannerMessage && (
          <div
            role="status"
            className="px-3.5 py-2 sm:px-5 bg-[#241b12] border-b border-[#c49a45]/45 text-xs text-[#fde68a] shrink-0"
          >
            {hud.bannerMessage}
          </div>
        )}

        {/* Scrollable Body */}
        <div className="p-3.5 sm:p-5 flex flex-col gap-4 overflow-y-auto custom-scroll">
          {/* Compact Hero Arcane & Treasury Bar */}
          {v14 && strainMeta && (
            <div className="grid grid-cols-3 divide-x divide-[#262d3d] bg-[#161a25] border border-[#272f40] rounded-md text-[11px] sm:text-xs font-mono-num">
              <div className="px-2.5 py-2">
                <div className="text-[10px] text-[#8d8779] uppercase tracking-wider">Мана</div>
                <div className="text-[#56c2ff] font-semibold mt-0.5 truncate">
                  {v14.heroMana}/{v14.heroMaxMana}
                  <span className="text-[10px] text-[#7eaec9] font-normal ml-1">
                    +{v14.manaRegenPerSec}/с
                  </span>
                </div>
              </div>
              <div className="px-2.5 py-2">
                <div className="text-[10px] text-[#8d8779] uppercase tracking-wider">Нагрузка</div>
                <div className={`${strainMeta.cls} font-semibold mt-0.5 truncate`}>
                  {strainMeta.text} · {v14.magicStrainIndex}
                </div>
              </div>
              <div className="px-2.5 py-2">
                <div className="text-[10px] text-[#8d8779] uppercase tracking-wider">Казна</div>
                <div className="text-[#f4cf6a] font-semibold mt-0.5 truncate">
                  {v14.currencyTextRu}
                </div>
              </div>
            </div>
          )}

          {/* Equipped Slots Section — 7 canonical v14.2 slots with distinct Weapon/Armor/Relic styling */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c49a45]">
                Надетое снаряжение
              </h3>
              <span className="text-[11px] text-[#7d8496]">{coreEquipment.length} ячеек</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {coreEquipment.map((eq) => {
                const theme = SLOT_THEME[eq.group];
                const rarity = eq.nameRu ? RARITY_META[eq.rarity] : null;

                return (
                  <div
                    key={eq.slot}
                    className={`relative overflow-hidden rounded-md border p-2.5 flex items-center gap-2.5 ${
                      theme.cardTintCls
                    } ${rarity ? rarity.borderCls : 'border-[#252c3b]'}`}
                  >
                    <div
                      className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                        rarity ? rarity.barCls : 'bg-[#2c3446]'
                      }`}
                    />

                    <div
                      className={`w-10 h-10 ml-0.5 rounded border flex items-center justify-center shrink-0 ${theme.iconBgCls}`}
                    >
                      <ItemGlyph
                        slot={eq.group}
                        itemId={eq.definitionId ?? undefined}
                        muted={!eq.nameRu}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider ${theme.accentTextCls}`}
                        >
                          {eq.labelRu}
                        </span>
                        {eq.nameRu && (
                          <button
                            type="button"
                            onClick={() => onUnequipCoreSlot(eq.slot)}
                            className="min-h-[28px] px-2 py-0.5 rounded bg-[#1d2331] hover:bg-[#2a3347] border border-[#364057] text-[10px] font-medium text-[#d6cfc0] cursor-pointer shrink-0"
                          >
                            Снять
                          </button>
                        )}
                      </div>
                      <div
                        className={`text-xs font-semibold truncate mt-0.5 ${
                          rarity ? rarity.titleCls : 'text-[#6c7384]'
                        }`}
                      >
                        {eq.nameRu ?? 'Пустая ячейка'}
                      </div>
                      <div className="text-[11px] text-[#9e9788] mt-0.5 truncate">
                        {eq.nameRu ? eq.bonusesRu : SLOT_EMPTY_HINT_RU[eq.slot] ?? theme.emptyHintRu}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Party Inventory Section — canonical single-source-of-truth items */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c49a45]">
                Рюкзак отряда ({coreInventory.length})
              </h3>
              <span className="text-[10px] text-[#838b9d] text-right">
                Надевайте снаряжение или изучайте свитки
              </span>
            </div>

            {coreInventory.length === 0 ? (
              <div className="rounded-md bg-[#151923] border border-[#242b3a] px-3.5 py-4 text-center">
                <p className="text-xs text-[#9c9586]">
                  В рюкзаке пока нет свободных предметов.
                </p>
                <p className="text-[11px] text-[#70788a] mt-1">
                  Осматривайте сундуки в руинах и побеждайте врагов, чтобы пополнить снаряжение.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {coreInventory.map((item) => {
                  const rarity = RARITY_META[item.rarity];
                  const glyphSlot: EquipSlot =
                    item.group === 'weapon'
                      ? 'weapon'
                      : item.group === 'armor'
                      ? 'armor'
                      : 'relic';
                  const slotTheme = SLOT_THEME[glyphSlot];
                  const isEquippable = item.targetSlot !== null;
                  const canAct = item.isScroll || (isEquippable && item.canEquip);

                  return (
                    <div
                      key={item.instanceId}
                      className={`relative overflow-hidden rounded-md bg-[#161a24] border p-2.5 flex items-start gap-2.5 ${rarity.borderCls}`}
                    >
                      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${rarity.barCls}`} />

                      <div
                        className={`w-10 h-10 ml-0.5 rounded border flex items-center justify-center shrink-0 ${
                          item.isScroll
                            ? 'bg-[#172538] border-[#38bdf8]/45 text-[#7dd3fc]'
                            : slotTheme.iconBgCls
                        }`}
                      >
                        <ItemGlyph slot={glyphSlot} itemId={item.definitionId} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-1.5">
                          <span className={`text-xs font-semibold leading-snug ${rarity.titleCls}`}>
                            {item.nameRu}
                            {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                          </span>
                          {item.isScroll ? (
                            <button
                              type="button"
                              onClick={() => onTranscribeCoreScroll(item.instanceId)}
                              className="min-h-[32px] px-2.5 py-1 rounded bg-[#163654] hover:bg-[#1e4970] border border-[#38bdf8]/55 text-[11px] font-semibold text-[#bae6fd] cursor-pointer shrink-0"
                            >
                              Изучить
                            </button>
                          ) : isEquippable ? (
                            <button
                              type="button"
                              disabled={!canAct}
                              onClick={() => onEquipCoreItem(item.instanceId)}
                              className="min-h-[32px] px-2.5 py-1 rounded bg-[#232a3a] hover:bg-[#2f384d] disabled:opacity-40 border border-[#c49a45]/50 text-[11px] font-semibold text-[#f4cf6a] cursor-pointer disabled:cursor-not-allowed shrink-0"
                            >
                              Надеть
                            </button>
                          ) : item.isQuestProtected ? (
                            <span className="text-[10px] font-semibold text-[#fbbf24] shrink-0">
                              Защищён
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1.5 text-[10px] text-[#7f8799] mt-0.5">
                          <span className={item.isScroll ? 'text-[#7dd3fc]' : slotTheme.accentTextCls}>
                            {CATEGORY_LABELS_RU[item.category] ?? 'Предмет'}
                          </span>
                          <span>·</span>
                          <span>{rarity.labelRu}</span>
                        </div>

                        <div className="text-[11px] text-[#ada696] mt-0.5 leading-snug">
                          {item.bonusesRu}
                        </div>

                        {isEquippable && !item.canEquip && item.unmetReasonsRu.length > 0 && (
                          <div className="text-[10px] text-[#f87171] mt-1 leading-snug">
                            {item.unmetReasonsRu.join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[10px] text-[#6d7486] mt-2.5 leading-relaxed">
              Боевые зелья здоровья и маны в бою не применяются — для лечения используйте магию
              Жизни.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

interface LootChestModalProps {
  lootWindow: ActiveLootWindowState;
  onTakeEntry: (entryId: string) => void;
  onTakeAll: () => void;
  onClose: () => void;
}

export const LootChestModal: React.FC<LootChestModalProps> = ({
  lootWindow,
  onTakeEntry,
  onTakeAll,
  onClose,
}) => (
  <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/70 p-2 sm:p-4">
    <div className="w-full max-w-md bg-[#11141c] border border-[#c49a45]/55 rounded-lg shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[#151924] border-b border-[#252b38]">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#c49a45] font-semibold">
            Найденная добыча
          </p>
          <h3 className="font-display text-base font-bold text-[#f2ece0]">{lootWindow.titleRu}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[40px] px-3 py-1 bg-[#1d222e] hover:bg-[#282f40] border border-[#2f3749] text-[#eae3d2] text-xs rounded cursor-pointer"
        >
          Закрыть
        </button>
      </div>

      <div className="p-3.5 sm:p-4 flex flex-col gap-2">
        {lootWindow.entries.map((entry) => (
          <div
            key={entry.entryId}
            className="flex items-center justify-between gap-2.5 p-2.5 rounded-md bg-[#171b25] border border-[#2a3142]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-9 h-9 rounded border flex items-center justify-center shrink-0 ${
                  entry.kind === 'copper'
                    ? 'bg-[#262014] border-[#b48a2e]/50 text-[#facc15]'
                    : 'bg-[#1b2232] border-[#4b6088]/50 text-[#93c5fd]'
                }`}
              >
                {entry.kind === 'copper' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" fill="#eab308" fillOpacity="0.28" stroke="#facc15" strokeWidth="1.6" />
                    <circle cx="12" cy="12" r="4" stroke="#fde047" strokeWidth="1.2" />
                  </svg>
                ) : (
                  <ItemGlyph slot="relic" muted={entry.taken} />
                )}
              </div>
              <div className="text-xs text-[#eae3d2] min-w-0">
                <div className={entry.taken ? 'line-through text-[#6d7485] truncate' : 'font-semibold truncate'}>
                  {entry.labelRu}
                </div>
                <div className="text-[10px] text-[#9e9788]">
                  {entry.kind === 'copper' ? 'Монеты в казну отряда' : 'Предмет в инвентарь отряда'}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={entry.taken}
              onClick={() => onTakeEntry(entry.entryId)}
              className="min-h-[40px] px-3 py-1 bg-[#222938] hover:bg-[#2d364a] disabled:opacity-40 border border-[#c49a45]/45 text-xs font-semibold text-[#facc15] rounded cursor-pointer whitespace-nowrap shrink-0"
            >
              {entry.taken ? 'Взято' : 'Взять'}
            </button>
          </div>
        ))}

        <div className="flex items-center justify-end gap-2 pt-2.5 mt-1 border-t border-[#232938]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 bg-[#1a1f2b] hover:bg-[#252c3c] text-xs font-medium text-[#d6cfc0] rounded border border-[#2e3547] cursor-pointer"
          >
            Оставить
          </button>
          <button
            type="button"
            onClick={onTakeAll}
            className="min-h-[44px] px-5 py-2 bg-[#c49a45] hover:bg-[#d6ac56] text-xs font-semibold text-[#101218] rounded cursor-pointer"
          >
            Взять всё
          </button>
        </div>
      </div>
    </div>
  </div>
);

interface EndModalProps {
  hud: HudSnapshot;
  onRestart: () => void;
  onTitle: () => void;
}

export const VictoryDefeatModal: React.FC<EndModalProps> = ({ hud, onRestart, onTitle }) => {
  const isVictory = hud.screen === 'VICTORY';
  const mins = Math.floor(hud.stats.elapsedSec / 60);
  const secs = Math.floor(hud.stats.elapsedSec % 60);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4">
      <div className="w-full max-w-md bg-[#12151d] border border-[#c49a45]/55 rounded-lg p-6 shadow-2xl text-center">
        <p className="text-xs tracking-[0.2em] uppercase text-[#c49a45] font-semibold">
          {isVictory ? 'Сектор очищен' : 'Поселение пало'}
        </p>
        <h2 className="font-display text-3xl font-bold text-[#f2ece0] mt-1">
          {isVictory ? 'Победа' : 'Поражение'}
        </h2>
        <p className="text-sm text-[#b8b09f] mt-2">
          {isVictory
            ? 'Командир вражеского гарнизона повержен, пограничное поселение удержано.'
            : 'Ратуша разрушена вражеским отрядом до завершения обороны сектора.'}
        </p>

        <div className="grid grid-cols-2 gap-3 my-5 p-4 rounded bg-[#171b25] border border-[#262d3c] text-left">
          <div>
            <div className="text-[11px] text-[#8f8879]">Время</div>
            <div className="text-sm font-mono-num font-semibold text-[#eae3d2]">
              {mins}м {secs.toString().padStart(2, '0')}с
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8f8879]">Уровень Аватара</div>
            <div className="text-sm font-mono-num font-semibold text-[#facc15]">
              Уровень {hud.hero?.level ?? 1}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8f8879]">Повержено врагов</div>
            <div className="text-sm font-mono-num font-semibold text-[#eae3d2]">
              {hud.stats.orcsSlain}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8f8879]">Нанято мечников</div>
            <div className="text-sm font-mono-num font-semibold text-[#eae3d2]">
              {hud.stats.swordsmenRecruited}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRestart}
            className="min-h-[44px] px-6 py-2.5 bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] font-semibold text-sm rounded cursor-pointer whitespace-nowrap"
          >
            Играть снова
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="min-h-[44px] px-5 py-2.5 bg-[#1b202c] hover:bg-[#252c3c] text-[#eae3d2] text-sm font-medium rounded border border-[#323a4d] cursor-pointer whitespace-nowrap"
          >
            Главное меню
          </button>
        </div>
      </div>
    </div>
  );
};

interface PauseModalProps {
  hasSavedGame: boolean;
  diagnosticsEnabled?: boolean;
  onToggleDiagnostics?: () => void;
  onResume: () => void;
  onSave: () => void;
  onLoad: () => void;
  onOpenShowcase: () => void;
  onOpenV14Slice: () => void;
  onRestart: () => void;
  onTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  hasSavedGame,
  diagnosticsEnabled = false,
  onToggleDiagnostics,
  onResume,
  onSave,
  onLoad,
  onOpenShowcase,
  onOpenV14Slice,
  onRestart,
  onTitle,
}) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/72 p-4">
    <div className="w-full max-w-xs bg-[#12151d] border border-[#c49a45]/45 rounded-lg p-6 shadow-2xl flex flex-col gap-3">
      <h2 className="font-display text-2xl font-bold text-[#f2ece0] text-center mb-1">
        Пауза
      </h2>
      <button
        type="button"
        onClick={onResume}
        className="min-h-[44px] w-full bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] font-semibold text-sm rounded cursor-pointer"
      >
        Продолжить
      </button>
      <button
        type="button"
        onClick={onSave}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#eae3d2] font-medium text-sm rounded border border-[#2f3647] cursor-pointer"
      >
        Сохранить кампанию
      </button>
      <button
        type="button"
        disabled={!hasSavedGame}
        onClick={onLoad}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] disabled:opacity-40 text-[#eae3d2] font-medium text-sm rounded border border-[#2f3647] cursor-pointer disabled:cursor-not-allowed"
      >
        Загрузить сохранение
      </button>
      <button
        type="button"
        onClick={onOpenShowcase}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#d9d2c2] font-medium text-sm rounded border border-[#3a4359] cursor-pointer"
      >
        3D Витрина героя
      </button>
      <button
        type="button"
        onClick={onOpenV14Slice}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#f2ece0] font-medium text-sm rounded border border-[#c49a45]/45 cursor-pointer"
      >
        Лист героя и мир
      </button>
      {onToggleDiagnostics && (
        <button
          type="button"
          onClick={onToggleDiagnostics}
          className={`min-h-[44px] w-full font-medium text-xs rounded border cursor-pointer ${
            diagnosticsEnabled
              ? 'bg-[#2a2315] border-[#c49a45]/60 text-[#facc15]'
              : 'bg-[#151923] hover:bg-[#1e2433] border-[#293040] text-[#9e9788]'
          }`}
        >
          Диагностика: {diagnosticsEnabled ? 'Вкл' : 'Выкл'}
        </button>
      )}
      <button
        type="button"
        onClick={onRestart}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#eae3d2] font-medium text-sm rounded border border-[#2f3647] cursor-pointer"
      >
        Начать сектор заново
      </button>
      <button
        type="button"
        onClick={onTitle}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#c49a45] font-medium text-sm rounded border border-[#2f3647] cursor-pointer"
      >
        Главное меню
      </button>
    </div>
  </div>
);
