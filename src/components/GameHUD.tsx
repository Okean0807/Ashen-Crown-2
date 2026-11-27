import React, { useState } from 'react';
import type { ControlGroupSlot } from '../core/fieldCommands';
import type { FormationType } from '../core/types';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  HudSnapshot,
  MobileActionMode,
  ResourceKind,
  UNIT_BLUEPRINTS,
  UnitType,
} from '../game/types';

interface GameHUDProps {
  hud: HudSnapshot;
  desktopMinimapRef: React.RefObject<HTMLCanvasElement | null>;
  mobileMinimapRef: React.RefObject<HTMLCanvasElement | null>;
  onMinimapNav: (clientX: number, clientY: number, el: HTMLCanvasElement) => void;
  onSelectHero: () => void;
  onSelectArmy: () => void;
  onSelectUnitId: (id: string) => void;
  onToggleBuildMode: (type: BuildingType | null) => void;
  onTrainUnit: (buildingId: string, unitType: UnitType) => void;
  onRepairBuilding: (buildingId: string) => void;
  onAssignLaborer: (kind: ResourceKind) => void;
  onCommand: (cmd: 'stop' | 'follow_hero' | 'attack_move_forward') => void;
  onHeroCleave: () => void;
  onHeroRally: () => void;
  onCastSpell: (spellId: string) => void;
  onAssignControlGroup: (slot: ControlGroupSlot) => void;
  onRecallControlGroup: (slot: ControlGroupSlot) => void;
  onSetFormation: (formation: FormationType) => void;
  onOpenInventory: () => void;
  onOpenV14Slice: () => void;
  onSetMobileMode: (mode: MobileActionMode) => void;
  onToggleMute: () => void;
  onSave: () => void;
  onPause: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetCamera: () => void;
}

const BUILD_OPTIONS: BuildingType[] = ['barracks', 'archer_range', 'farm', 'tower'];
const CONTROL_SLOTS: ControlGroupSlot[] = [1, 2, 3, 4, 5, 6];
const FORMATIONS: Array<{ id: FormationType; label: string }> = [
  { id: 'compact', label: 'Компактная' },
  { id: 'loose', label: 'Рассред.' },
  { id: 'line', label: 'Линия' },
];

const BUILDING_LABELS_RU: Record<BuildingType, string> = {
  town_hall: 'Ратуша',
  barracks: 'Казармы',
  archer_range: 'Стрельбище',
  farm: 'Ферма',
  tower: 'Дозорная башня',
  orc_stronghold: 'Крепость врага',
  orc_tower: 'Башня врага',
};

const UNIT_LABELS_RU: Record<UnitType, string> = {
  hero: 'Аватар',
  laborer: 'Рабочий',
  swordsman: 'Мечник',
  archer: 'Лучник',
  skeleton_minion: 'Скелет-воин',
  orc_warrior: 'Воин врага',
  orc_archer: 'Стрелок врага',
  orc_commander: 'Командир врага',
};

const UNIT_ORDER_LABELS_RU: Record<string, string> = {
  idle: 'Ожидание',
  move: 'Движение',
  attack: 'Бой',
  attack_unit: 'Атака цели',
  attack_building: 'Осада',
  attack_move: 'Штурм',
  follow_hero: 'За Аватаром',
  interact: 'Взаимодействие',
  gather: 'Добыча',
  build: 'Стройка',
  patrol: 'Патруль',
};

const COMBAT_LOG_COLOR: Record<string, string> = {
  hit: 'text-[#e8e1d1]',
  miss: 'text-[#94a3b8]',
  block: 'text-[#93c5fd]',
  spell: 'text-[#fb923c]',
  kill: 'text-[#f87171]',
  system: 'text-[#d4a442]',
};

export const GameHUD: React.FC<GameHUDProps> = ({
  hud,
  desktopMinimapRef,
  mobileMinimapRef,
  onMinimapNav,
  onSelectHero,
  onSelectArmy,
  onSelectUnitId,
  onToggleBuildMode,
  onTrainUnit,
  onRepairBuilding,
  onAssignLaborer,
  onCommand,
  onHeroCleave,
  onHeroRally,
  onCastSpell,
  onAssignControlGroup,
  onRecallControlGroup,
  onSetFormation,
  onOpenInventory,
  onOpenV14Slice,
  onSetMobileMode,
  onToggleMute,
  onSave,
  onPause,
  onZoomIn,
  onZoomOut,
  onResetCamera,
}) => {
  const [showObjectives, setShowObjectives] = useState(false);
  const [showCombatLog, setShowCombatLog] = useState(false);
  const [rightTab, setRightTab] = useState<'build' | 'orders'>('build');
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'build' | 'map' | 'army'>('none');
  const [mobileGroupAssignMode, setMobileGroupAssignMode] = useState(false);

  const currentObj =
    hud.objectives.find((o) => !o.completed) ?? hud.objectives[hud.objectives.length - 1];
  const completedCount = hud.objectives.filter((o) => o.completed).length;

  const selectedHero =
    hud.selectedUnits.length === 1 && hud.selectedUnits[0].type === 'hero' ? hud.hero : null;
  const singleUnit = hud.selectedUnits.length === 1 ? hud.selectedUnits[0] : null;
  const selectedBld = hud.selectedBuilding;
  const selectedBldBp = selectedBld ? BUILDING_BLUEPRINTS[selectedBld.type] : null;
  const v14 = hud.v14Core;

  const handleMinimapPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    onMinimapNav(e.clientX, e.clientY, e.currentTarget);
  };

  const isDuplicateRespawnBanner = Boolean(
    v14 &&
      v14.avatarRespawnSec > 0 &&
      hud.bannerMessage &&
      (hud.bannerMessage === 'Аватар возрождается у Камня Душ' ||
        /^Аватар пал! Возрождение у Камня Душ/.test(hud.bannerMessage))
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between">
      {/* TOP BAR — 2 responsive rows on mobile (<640px), single clean row on sm+/tablet/desktop (DEF-01, DEF-03, DEF-05) */}
      <header className="pointer-events-auto flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2 px-2 py-1.5 sm:px-3 lg:px-4 sm:py-2 bg-[#10131a]/96 border-b border-[#c49a45]/30 text-xs">
        {/* Row 1 (mobile) / Left+Right clusters via sm:contents */}
        <div className="flex items-center justify-between gap-2 min-w-0 sm:contents">
          {/* Resources Cluster */}
          <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 font-mono-num shrink-0 sm:order-1">
            <div className="flex items-center gap-1" title="Золото / Руда">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6" fill="#eab308" stroke="#fef08a" strokeWidth="1.2" />
              </svg>
              <span className="font-semibold text-[#facc15]">{hud.resources.gold}</span>
            </div>
            <div className="flex items-center gap-1" title="Древесина">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 2L13 11H3L8 2Z" fill="#65a30d" />
                <rect x="7" y="11" width="2" height="3" fill="#78350f" />
              </svg>
              <span className="font-semibold text-[#a3e635]">{hud.resources.wood}</span>
            </div>
            <div className="flex items-center gap-1" title="Камень">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <polygon points="3,13 5,5 11,4 14,13" fill="#94a3b8" />
              </svg>
              <span className="font-semibold text-[#cbd5e1]">{hud.resources.stone}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1 text-[#d6cfc0]" title="Лимит армии">
              <span className="text-[#8f8879]">Отр</span>
              <span className="font-semibold">
                {hud.popUsed}/{hud.popCap}
              </span>
            </div>
            {v14 && (
              <div
                className="hidden lg:flex items-center gap-3 pl-2 border-l border-[#2a3142] text-[11px]"
                title="Магические показатели и казна Аватара"
              >
                <span className="text-[#38bdf8]">
                  Мана {v14.heroMana}/{v14.heroMaxMana}
                </span>
                <span
                  className={
                    v14.magicStrainStatus === 'critical'
                      ? 'text-[#f87171]'
                      : v14.magicStrainStatus === 'elevated'
                      ? 'text-[#fbbf24]'
                      : 'text-[#86efac]'
                  }
                >
                  Нагрузка {v14.magicStrainIndex}
                </span>
                <span className="text-[#facc15]">{v14.currencyTextRu}</span>
              </div>
            )}
          </div>

          {/* System Controls */}
          <div className="flex items-center gap-1.5 shrink-0 sm:order-3">
            <button
              type="button"
              onClick={onOpenV14Slice}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded bg-[#1c2231] hover:bg-[#252d42] border border-[#c49a45]/50 text-[#facc15] font-semibold cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            >
              <span className="hidden lg:inline">Лист героя</span>
              <span className="lg:hidden">Герой</span>
              {v14 && v14.unspentTotal > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-[#c49a45] text-[#101218] text-[10px] font-mono-num font-bold leading-none">
                  +{v14.unspentTotal}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              className="hidden sm:inline-flex items-center min-h-[34px] px-2 lg:px-2.5 py-1 rounded bg-[#181c26] hover:bg-[#222836] border border-[#2d3444] text-[#d6cfc0] cursor-pointer whitespace-nowrap"
            >
              {hud.muted ? 'Без звука' : 'Звук'}
            </button>
            <button
              type="button"
              onClick={() => setShowCombatLog((v) => !v)}
              className={`hidden sm:inline-flex items-center min-h-[34px] px-2 lg:px-2.5 py-1 rounded border text-xs cursor-pointer whitespace-nowrap ${
                showCombatLog
                  ? 'bg-[#242c3e] border-[#c49a45]/60 text-[#facc15]'
                  : 'bg-[#181c26] hover:bg-[#222836] border-[#2d3444] text-[#d6cfc0]'
              }`}
            >
              Журнал
            </button>
            <button
              type="button"
              onClick={onSave}
              className="hidden lg:inline-flex items-center min-h-[34px] px-2.5 py-1 rounded bg-[#181c26] hover:bg-[#222836] border border-[#2d3444] text-[#d6cfc0] cursor-pointer whitespace-nowrap"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={onPause}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded bg-[#181c26] hover:bg-[#222836] border border-[#c49a45]/40 text-[#eae3d2] cursor-pointer whitespace-nowrap"
            >
              Меню
            </button>
          </div>
        </div>

        {/* Row 2 (mobile) / Center Objectives cluster (sm+) + Mobile Journal & Army Controls Triggers */}
        <div className="flex items-center gap-1.5 min-w-0 sm:flex-1 sm:justify-center sm:order-2">
          <div className="relative flex-1 min-w-0 sm:flex-initial sm:max-w-[230px] lg:max-w-xs">
            <button
              type="button"
              onClick={() => setShowObjectives((s) => !s)}
              className="w-full min-h-[44px] sm:min-h-[34px] flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 rounded bg-[#181c26] hover:bg-[#202634] border border-[#c49a45]/35 text-[#eae3d2] cursor-pointer"
            >
              <span className="text-[11px] font-mono-num text-[#c49a45] shrink-0">
                {completedCount}/{hud.objectives.length}
              </span>
              <span className="truncate text-xs font-medium text-left">{currentObj?.title}</span>
            </button>

            {showObjectives && (
              <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 mt-2 w-[min(18rem,calc(100vw-1rem))] sm:w-80 bg-[#12151e] border border-[#c49a45]/45 rounded-md p-3.5 shadow-2xl z-30">
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#252b38]">
                  <span className="font-display text-sm font-bold text-[#eae3d2]">
                    Задачи сектора
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowObjectives(false)}
                    className="min-h-[36px] px-2 text-xs text-[#9e9788] hover:text-[#eae3d2] cursor-pointer"
                  >
                    Закрыть
                  </button>
                </div>
                <ul className="flex flex-col gap-2">
                  {hud.objectives.map((obj, idx) => (
                    <li key={obj.id} className="flex items-start justify-between gap-2 text-xs">
                      <span
                        className={obj.completed ? 'text-[#4ade80] line-through' : 'text-[#eae3d2]'}
                      >
                        {idx + 1}. {obj.title}
                      </span>
                      <span className="font-mono-num text-[11px] text-[#9e9788] shrink-0">
                        {obj.progressText}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Mobile-only compact entry points for Combat Log & Squad Groups/Formations (DEF-03) */}
          <button
            type="button"
            onClick={() => setShowCombatLog((v) => !v)}
            className={`sm:hidden shrink-0 min-h-[44px] px-2.5 rounded border text-xs font-medium cursor-pointer whitespace-nowrap ${
              showCombatLog
                ? 'bg-[#242c3e] border-[#c49a45]/60 text-[#facc15]'
                : 'bg-[#181c26] border-[#2d3444] text-[#d6cfc0]'
            }`}
          >
            Журнал
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawer((d) => (d === 'army' ? 'none' : 'army'))}
            className={`md:hidden shrink-0 min-h-[44px] sm:min-h-[34px] px-2.5 rounded border text-xs font-semibold cursor-pointer whitespace-nowrap ${
              mobileDrawer === 'army'
                ? 'bg-[#c49a45] border-[#c49a45] text-[#101218]'
                : 'bg-[#181c26] border-[#c49a45]/40 text-[#eae3d2]'
            }`}
          >
            Строй
          </button>
        </div>
      </header>

      {/* Center Top Notification, Respawn Notice & Build Mode Banner (padded away from right zoom bar — DEF-05 & DEF-07) */}
      <div className="flex flex-col items-center gap-1.5 mt-2 pl-2.5 pr-[68px] sm:px-16">
        {v14 && v14.avatarRespawnSec > 0 && (
          <div className="max-w-full px-3.5 py-1.5 rounded bg-[#1a1322]/96 border border-[#38bdf8]/60 text-xs sm:text-sm text-[#bae6fd] shadow-lg text-center font-mono-num">
            Аватар возрождается у Камня Душ: {v14.avatarRespawnSec} с
            {v14.activeMinionsCount > 0
              ? ` · Автономность нежити: ${v14.residualAutonomyPool}`
              : ''}
          </div>
        )}
        {hud.buildMode && (
          <div className="pointer-events-auto max-w-full flex flex-wrap items-center justify-center gap-2 px-3.5 py-1.5 rounded bg-[#12161f]/96 border border-[#c49a45] text-xs text-[#eae3d2] shadow-lg">
            <span>
              Постройка: <strong>{BUILDING_LABELS_RU[hud.buildMode]}</strong> — выберите свободную
              клетку
            </span>
            <button
              type="button"
              onClick={() => onToggleBuildMode(null)}
              className="min-h-[36px] sm:min-h-[28px] px-2.5 py-0.5 bg-[#7f1d1d] hover:bg-[#991b1b] text-white rounded cursor-pointer"
            >
              Отмена
            </button>
          </div>
        )}
        {hud.bannerMessage && !isDuplicateRespawnBanner && (
          <div className="max-w-full px-3.5 py-1.5 rounded bg-[#11141c]/96 border border-[#c49a45]/40 text-xs sm:text-sm text-[#f3ead8] shadow-lg text-center">
            {hud.bannerMessage}
          </div>
        )}
      </div>

      {/* Collapsible Live Combat & Event Log (safe positioning below mobile 2-row header — DEF-03, DEF-05) */}
      {showCombatLog && v14 && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto fixed left-2.5 right-[68px] sm:right-auto top-[112px] sm:top-14 z-20 sm:w-72 bg-[#10131a]/96 border border-[#c49a45]/40 rounded-md p-2.5 shadow-xl"
        >
          <div className="flex items-center justify-between pb-1 mb-1.5 border-b border-[#252b38]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#c49a45]">
              Журнал боя
            </span>
            <button
              type="button"
              onClick={() => setShowCombatLog(false)}
              aria-label="Закрыть журнал боя"
              className="min-h-[32px] min-w-[32px] text-xs text-[#9e9788] hover:text-[#eae3d2] cursor-pointer"
            >
              ✕
            </button>
          </div>
          {v14.combatLog.length === 0 ? (
            <p className="text-[11px] text-[#7e8596]">Событий боя пока нет.</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto custom-scroll text-[11px]">
              {v14.combatLog.slice(0, 8).map((entry) => (
                <li key={entry.id} className={COMBAT_LOG_COLOR[entry.kind] ?? 'text-[#e8e1d1]'}>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Fixed Camera Controls (Zoom In, Zoom Out, Reset Camera — offset below mobile 2-row header) */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className="pointer-events-auto fixed right-2 top-[112px] sm:right-2.5 sm:top-14 z-20 flex flex-col items-center gap-1 bg-[#10131a]/96 border border-[#c49a45]/35 rounded-md p-1 shadow-xl"
      >
        <button
          type="button"
          onClick={onZoomIn}
          disabled={hud.cameraZoom >= 2.98}
          aria-label="Приблизить"
          title="Приблизить"
          className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#181c26] hover:bg-[#232939] active:scale-95 disabled:opacity-40 text-[#eae3d2] text-base font-bold cursor-pointer"
        >
          +
        </button>
        <span className="text-[10px] font-mono-num text-[#c49a45] leading-none py-0.5">
          {hud.cameraZoom.toFixed(1)}x
        </span>
        <button
          type="button"
          onClick={onZoomOut}
          disabled={hud.cameraZoom <= 1.02}
          aria-label="Отдалить"
          title="Отдалить"
          className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#181c26] hover:bg-[#232939] active:scale-95 disabled:opacity-40 text-[#eae3d2] text-base font-bold cursor-pointer"
        >
          -
        </button>
        <button
          type="button"
          onClick={onResetCamera}
          aria-label="Сброс камеры"
          title="Сбросить камеру (R)"
          className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#181c26] hover:bg-[#232939] active:scale-95 border-t border-[#262d3c] text-[#facc15] cursor-pointer"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      </div>

      {/* DESKTOP BOTTOM DOCK */}
      <div className="hidden md:flex items-end justify-between gap-3 p-3 mt-auto">
        {/* Bottom-Left: Minimap + Quick Select + 6 Control Groups (§292.7) */}
        <div className="pointer-events-auto flex flex-col gap-1.5 bg-[#10131a]/96 border border-[#c49a45]/35 rounded-md p-2.5 shadow-xl">
          <canvas
            ref={desktopMinimapRef}
            width={148}
            height={148}
            onPointerDown={handleMinimapPointer}
            onPointerMove={(e) => {
              if (e.buttons === 1) handleMinimapPointer(e);
            }}
            className="w-[148px] h-[148px] rounded border border-[#2a3140] cursor-crosshair block"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onSelectHero}
              className="py-1.5 px-2 bg-[#1a202c] hover:bg-[#252d3d] border border-[#c49a45]/40 rounded text-[11px] font-semibold text-[#facc15] cursor-pointer whitespace-nowrap"
            >
              Аватар (Space)
            </button>
            <button
              type="button"
              onClick={onSelectArmy}
              className="py-1.5 px-2 bg-[#1a202c] hover:bg-[#252d3d] border border-[#323a4d] rounded text-[11px] font-semibold text-[#eae3d2] cursor-pointer whitespace-nowrap"
            >
              Армия
            </button>
          </div>
          {v14 && (
            <div className="grid grid-cols-6 gap-1" title="Группы 1–6: клик — выбрать, Ctrl+клик — назначить">
              {CONTROL_SLOTS.map((slot) => {
                const count = v14.controlGroupCounts[slot] ?? 0;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) onAssignControlGroup(slot);
                      else onRecallControlGroup(slot);
                    }}
                    className={`py-1 rounded border text-[10px] font-mono-num cursor-pointer ${
                      count > 0
                        ? 'bg-[#1f2636] border-[#c49a45]/60 text-[#facc15]'
                        : 'bg-[#151922] border-[#262d3c] text-[#7e8596]'
                    }`}
                  >
                    {slot}
                    {count > 0 ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom-Center: Selection Inspector & Live v14.2 Magic Bar */}
        <div className="pointer-events-auto flex-1 max-w-xl bg-[#10131a]/96 border border-[#c49a45]/35 rounded-md p-3 shadow-xl min-h-[142px] flex flex-col justify-between">
          {selectedHero ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-[#facc15]">
                      Аватар
                    </span>
                    <span className="text-xs font-mono-num text-[#c49a45]">
                      Ур. {selectedHero.level ?? 1} · {v14?.specializationRu ?? 'Гибрид'}
                    </span>
                    {v14 && (v14.activeMinionsCount > 0 || v14.dormantMinionsCount > 0) && (
                      <span className="text-[11px] font-mono-num text-[#38bdf8]">
                        Скелеты: {v14.activeMinionsCount} акт.
                        {v14.dormantMinionsCount > 0 ? ` / ${v14.dormantMinionsCount} сон` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono-num text-[#cbd5e1] mt-0.5">
                    HP {Math.ceil(selectedHero.hp)}/{selectedHero.maxHp} · MP {v14?.heroMana ?? 0}/
                    {v14?.heroMaxMana ?? 0} · АТК {selectedHero.baseAtk} · БРН {selectedHero.baseArmor} · XP{' '}
                    {selectedHero.xp ?? 0}/{selectedHero.xpToNext ?? 100}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenInventory}
                  className="px-3 py-1.5 bg-[#1f2533] hover:bg-[#2a3245] border border-[#c49a45]/50 rounded text-xs font-semibold text-[#eae3d2] cursor-pointer whitespace-nowrap"
                >
                  Рюкзак ({v14?.corePartyInventory.length ?? hud.inventory.length})
                </button>
              </div>

              {/* Martial Abilities + Canonical v14.2 Spells (§§38–43) */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={(selectedHero.cleaveCooldown ?? 0) > 0}
                  onClick={onHeroCleave}
                  className="flex-1 min-w-[88px] py-1.5 px-2 bg-[#7f1d1d] hover:bg-[#991b1b] disabled:opacity-45 rounded text-[11px] font-semibold text-white cursor-pointer truncate"
                  title="Мощный круговой удар (Q)"
                >
                  {(selectedHero.cleaveCooldown ?? 0) > 0
                    ? `Удар (${Math.ceil(selectedHero.cleaveCooldown ?? 0)}с)`
                    : 'Удар (Q)'}
                </button>
                <button
                  type="button"
                  disabled={(selectedHero.rallyCooldown ?? 0) > 0}
                  onClick={onHeroRally}
                  className="flex-1 min-w-[88px] py-1.5 px-2 bg-[#1e3a8a] hover:bg-[#2549ab] disabled:opacity-45 rounded text-[11px] font-semibold text-white cursor-pointer truncate"
                  title="Боевой клич — лечение отряда (E)"
                >
                  {(selectedHero.rallyCooldown ?? 0) > 0
                    ? `Клич (${Math.ceil(selectedHero.rallyCooldown ?? 0)}с)`
                    : 'Клич (E)'}
                </button>
                {v14?.spells.map((sp) => (
                  <button
                    key={sp.spellId}
                    type="button"
                    disabled={!sp.canCast}
                    onClick={() => onCastSpell(sp.spellId)}
                    title={`${sp.nameRu} (${sp.hotkey}) — ${sp.manaCost} маны`}
                    className={`flex-1 min-w-[96px] py-1.5 px-2 disabled:opacity-40 rounded text-[11px] font-semibold text-white cursor-pointer truncate border ${
                      sp.school === 'elemental'
                        ? 'bg-[#9a3412] hover:bg-[#c2410c] border-[#fb923c]/40'
                        : sp.school === 'life'
                        ? 'bg-[#166534] hover:bg-[#15803d] border-[#4ade80]/40'
                        : 'bg-[#3b0764] hover:bg-[#581c87] border-[#a78bfa]/40'
                    }`}
                  >
                    {sp.nameRu.split(' ')[0]} ({sp.hotkey}) · {sp.manaCost}
                  </button>
                ))}
              </div>
            </div>
          ) : singleUnit ? (
            <div className="flex flex-col justify-between gap-2 h-full">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-sm font-bold text-[#eae3d2]">
                    {UNIT_LABELS_RU[singleUnit.type] ?? singleUnit.name}
                  </div>
                  <div className="text-xs font-mono-num text-[#9e9788] mt-0.5">
                    HP {Math.ceil(singleUnit.hp)}/{singleUnit.maxHp} · АТК {singleUnit.baseAtk} · БРН{' '}
                    {singleUnit.baseArmor}
                  </div>
                </div>
                <span className="text-xs text-[#c49a45]">
                  {singleUnit.dormant
                    ? 'Покой (нет маны)'
                    : UNIT_ORDER_LABELS_RU[singleUnit.order] ?? singleUnit.order}
                </span>
              </div>
              <p className="text-xs text-[#a69f90]">
                {UNIT_BLUEPRINTS[singleUnit.type]?.description}
              </p>
            </div>
          ) : hud.selectedUnits.length > 1 ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-display font-bold text-[#eae3d2]">
                  Выбран отряд ({hud.selectedUnits.length})
                </span>
                <span className="text-[#9e9788]">
                  Shift+ПКМ — точка · Alt+ПКМ — патруль
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[82px] overflow-y-auto custom-scroll">
                {hud.selectedUnits.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onSelectUnitId(u.id)}
                    className="px-2 py-1 rounded bg-[#191e29] hover:bg-[#252c3c] border border-[#323a4d] text-[11px] text-[#eae3d2] cursor-pointer font-mono-num"
                  >
                    {UNIT_LABELS_RU[u.type] ?? u.name} · {Math.ceil((u.hp / u.maxHp) * 100)}%
                  </button>
                ))}
              </div>
            </div>
          ) : selectedBld && selectedBldBp ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-display text-sm font-bold text-[#eae3d2]">
                    {BUILDING_LABELS_RU[selectedBld.type] ?? selectedBld.name}
                  </span>
                  <span className="ml-2 text-xs font-mono-num text-[#9e9788]">
                    HP {Math.ceil(selectedBld.hp)}/{selectedBld.maxHp}
                  </span>
                </div>
                {!selectedBld.constructed ? (
                  <span className="text-xs font-mono-num text-[#facc15]">
                    Строится {Math.round(selectedBld.buildProgress * 100)}%
                  </span>
                ) : selectedBld.faction === 'human' && selectedBld.hp < selectedBld.maxHp ? (
                  <button
                    type="button"
                    onClick={() => onRepairBuilding(selectedBld.id)}
                    className="px-2.5 py-1 bg-[#1e2d1f] hover:bg-[#283d29] border border-[#84cc16]/55 rounded text-xs font-semibold text-[#bef264] cursor-pointer whitespace-nowrap"
                  >
                    Ремонт (15Д)
                  </button>
                ) : null}
              </div>
              {selectedBld.constructed && selectedBld.faction === 'human' && selectedBld.hp < selectedBld.maxHp && (
                <div className="text-[11px] text-[#fbbf24]">
                  Постройка повреждена — очередь обучения на паузе до ремонта древесиной.
                </div>
              )}
              {selectedBld.constructed && selectedBldBp.trains ? (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedBldBp.trains.map((uType) => {
                    const ubp = UNIT_BLUEPRINTS[uType];
                    return (
                      <button
                        key={uType}
                        type="button"
                        onClick={() => onTrainUnit(selectedBld.id, uType)}
                        className="px-3 py-1.5 bg-[#1b2230] hover:bg-[#252f42] border border-[#c49a45]/45 rounded text-xs text-[#eae3d2] cursor-pointer text-left"
                      >
                        <div className="font-semibold">
                          Нанять: {UNIT_LABELS_RU[uType] ?? ubp.name}
                        </div>
                        <div className="text-[11px] font-mono-num text-[#9e9788]">
                          {ubp.cost.gold}З {ubp.cost.wood > 0 ? `· ${ubp.cost.wood}Д` : ''}
                        </div>
                      </button>
                    );
                  })}
                  {selectedBld.queue.length > 0 && (
                    <div className="text-xs font-mono-num text-[#60a5fa] ml-auto">
                      {selectedBld.hp < selectedBld.maxHp ? 'Пауза: ' : 'Обучение: '}
                      {UNIT_LABELS_RU[selectedBld.queue[0].unitType]} (
                      {Math.ceil(selectedBld.queue[0].remaining)}с) · Очередь{' '}
                      {selectedBld.queue.length}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#9e9788]">{selectedBldBp.description}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col justify-center items-center h-full text-center text-xs text-[#8f8879]">
              <span>Выберите Аватара, воинов или постройку для отдачи приказов и найма.</span>
              <span className="mt-1">
                Совет: ПКМ по дереву, жиле или каменоломне отправляет рабочего · F/G/X — заклинания.
              </span>
            </div>
          )}
        </div>

        {/* Bottom-Right: Construction, Formations (§292.10) & Orders Card */}
        <div className="pointer-events-auto w-80 bg-[#10131a]/96 border border-[#c49a45]/35 rounded-md p-2.5 shadow-xl flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#181c26] rounded">
            <button
              type="button"
              onClick={() => setRightTab('build')}
              className={`py-1.5 text-xs font-semibold rounded cursor-pointer ${
                rightTab === 'build'
                  ? 'bg-[#c49a45] text-[#101218]'
                  : 'text-[#b5ae9e] hover:text-[#eae3d2]'
              }`}
            >
              Стройка и добыча
            </button>
            <button
              type="button"
              onClick={() => setRightTab('orders')}
              className={`py-1.5 text-xs font-semibold rounded cursor-pointer ${
                rightTab === 'orders'
                  ? 'bg-[#c49a45] text-[#101218]'
                  : 'text-[#b5ae9e] hover:text-[#eae3d2]'
              }`}
            >
              Приказы и строй
            </button>
          </div>

          {rightTab === 'build' ? (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                {BUILD_OPTIONS.map((bt) => {
                  const bp = BUILDING_BLUEPRINTS[bt];
                  const active = hud.buildMode === bt;
                  const affordable =
                    hud.resources.gold >= bp.cost.gold &&
                    hud.resources.wood >= bp.cost.wood &&
                    hud.resources.stone >= bp.cost.stone;
                  return (
                    <button
                      key={bt}
                      type="button"
                      onClick={() => onToggleBuildMode(active ? null : bt)}
                      className={`p-2 rounded border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#c49a45]/25 border-[#facc15]'
                          : affordable
                          ? 'bg-[#181c26] hover:bg-[#222836] border-[#2e3545]'
                          : 'bg-[#151820] border-[#252a36] opacity-55'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[#eae3d2] truncate">
                        {BUILDING_LABELS_RU[bt]}
                      </div>
                      <div className="text-[10px] font-mono-num text-[#a69f90] mt-0.5">
                        {bp.cost.wood}Д · {bp.cost.gold}З
                        {bp.cost.stone > 0 ? ` · ${bp.cost.stone}К` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-[#232938]">
                <button
                  type="button"
                  onClick={() => onAssignLaborer('wood')}
                  className="py-1.5 px-2 bg-[#1a221c] hover:bg-[#233026] border border-[#3a543f] rounded text-[11px] font-medium text-[#a3e635] cursor-pointer"
                >
                  Лес
                </button>
                <button
                  type="button"
                  onClick={() => onAssignLaborer('gold')}
                  className="py-1.5 px-2 bg-[#242014] hover:bg-[#332c19] border border-[#6e5a23] rounded text-[11px] font-medium text-[#facc15] cursor-pointer"
                >
                  Руда
                </button>
                <button
                  type="button"
                  onClick={() => onAssignLaborer('stone')}
                  className="py-1.5 px-2 bg-[#1c2128] hover:bg-[#262d37] border border-[#424d5c] rounded text-[11px] font-medium text-[#cbd5e1] cursor-pointer"
                >
                  Камень
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onCommand('follow_hero')}
                  className="py-2 px-2.5 bg-[#181c26] hover:bg-[#232938] border border-[#2f3647] rounded text-xs font-medium text-[#eae3d2] cursor-pointer"
                >
                  За Аватаром
                </button>
                <button
                  type="button"
                  onClick={() => onCommand('attack_move_forward')}
                  className="py-2 px-2.5 bg-[#2a1719] hover:bg-[#3b1e21] border border-[#7f1d1d] rounded text-xs font-medium text-[#fca5a5] cursor-pointer"
                >
                  Атака на восток
                </button>
                <button
                  type="button"
                  onClick={() => onCommand('stop')}
                  className="py-2 px-2.5 bg-[#181c26] hover:bg-[#232938] border border-[#2f3647] rounded text-xs font-medium text-[#eae3d2] cursor-pointer"
                >
                  Удерживать
                </button>
                <button
                  type="button"
                  onClick={onSelectArmy}
                  className="py-2 px-2.5 bg-[#181c26] hover:bg-[#232938] border border-[#2f3647] rounded text-xs font-medium text-[#c49a45] cursor-pointer"
                >
                  Вся армия
                </button>
              </div>
              {v14 && (
                <div className="pt-1.5 border-t border-[#232938]">
                  <div className="flex items-center justify-between text-[10px] text-[#9e9788] mb-1">
                    <span>Формации отряда</span>
                    {!v14.canUseFormation && (
                      <span className="text-[#fbbf24]">Нужны войска</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {FORMATIONS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        disabled={!v14.canUseFormation}
                        title={v14.formationReasonRu ?? `Построение: ${f.label}`}
                        onClick={() => onSetFormation(f.id)}
                        className={`py-1.5 px-1.5 rounded text-[11px] font-semibold border cursor-pointer disabled:opacity-40 ${
                          v14.activeFormation === f.id
                            ? 'bg-[#c49a45] text-[#101218] border-[#c49a45]'
                            : 'bg-[#181c26] text-[#d6cfc0] border-[#2e3545] hover:bg-[#222836]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MOBILE RESPONSIVE BOTTOM BAR & DRAWERS (< 768px) */}
      <div className="md:hidden flex flex-col gap-2 p-2 mt-auto">
        {mobileDrawer === 'none' &&
          (selectedHero || selectedBld || hud.selectedUnits.length > 0) && (
            <div className="pointer-events-auto bg-[#10131a]/96 border border-[#c49a45]/40 rounded-md p-2 flex flex-col gap-2">
              {selectedHero ? (
                <>
                  <div className="flex items-center justify-between text-xs font-mono-num">
                    <div>
                      <span className="font-display font-bold text-[#facc15] mr-1.5">
                        Аватар Ур.{selectedHero.level ?? 1}
                      </span>
                      <span className="text-[#cbd5e1]">
                        {Math.ceil(selectedHero.hp)}/{selectedHero.maxHp} HP
                      </span>
                      {v14 && (
                        <span className="text-[#38bdf8] ml-1.5">
                          {v14.heroMana}/{v14.heroMaxMana} MP
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={onOpenInventory}
                      className="min-h-[44px] px-2.5 bg-[#1d2230] border border-[#c49a45]/50 rounded text-xs font-semibold text-[#eae3d2] whitespace-nowrap"
                    >
                      Рюкзак ({v14?.corePartyInventory.length ?? hud.inventory.length})
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={(selectedHero.cleaveCooldown ?? 0) > 0}
                      onClick={onHeroCleave}
                      className="flex-1 min-w-[60px] min-h-[44px] px-1.5 bg-[#7f1d1d] disabled:opacity-45 rounded text-[11px] font-semibold text-white"
                    >
                      {(selectedHero.cleaveCooldown ?? 0) > 0
                        ? `${Math.ceil(selectedHero.cleaveCooldown ?? 0)}с`
                        : 'Удар'}
                    </button>
                    <button
                      type="button"
                      disabled={(selectedHero.rallyCooldown ?? 0) > 0}
                      onClick={onHeroRally}
                      className="flex-1 min-w-[60px] min-h-[44px] px-1.5 bg-[#1e3a8a] disabled:opacity-45 rounded text-[11px] font-semibold text-white"
                    >
                      Клич
                    </button>
                    {v14?.spells.map((sp) => (
                      <button
                        key={sp.spellId}
                        type="button"
                        disabled={!sp.canCast}
                        onClick={() => onCastSpell(sp.spellId)}
                        className={`flex-1 min-w-[66px] min-h-[44px] px-1.5 disabled:opacity-40 rounded text-[10px] font-semibold text-white truncate ${
                          sp.school === 'elemental'
                            ? 'bg-[#9a3412]'
                            : sp.school === 'life'
                            ? 'bg-[#166534]'
                            : 'bg-[#3b0764]'
                        }`}
                      >
                        {sp.nameRu.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </>
              ) : selectedBld && selectedBldBp ? (
                <div className="w-full flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs">
                    <div className="font-semibold text-[#eae3d2]">
                      {BUILDING_LABELS_RU[selectedBld.type]}
                    </div>
                    {!selectedBld.constructed ? (
                      <div className="text-[#facc15] font-mono-num">
                        {Math.round(selectedBld.buildProgress * 100)}%
                      </div>
                    ) : selectedBld.hp < selectedBld.maxHp ? (
                      <div className="text-[#fbbf24] text-[10px]">
                        Повреждено ({Math.ceil(selectedBld.hp)}/{selectedBld.maxHp})
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedBld.constructed &&
                      selectedBld.faction === 'human' &&
                      selectedBld.hp < selectedBld.maxHp && (
                        <button
                          type="button"
                          onClick={() => onRepairBuilding(selectedBld.id)}
                          className="min-h-[44px] px-2.5 bg-[#1e2d1f] border border-[#84cc16]/55 rounded text-xs font-semibold text-[#bef264]"
                        >
                          Ремонт (15Д)
                        </button>
                      )}
                    {selectedBld.constructed &&
                      selectedBldBp.trains &&
                      selectedBldBp.trains.map((uType) => {
                        const ubp = UNIT_BLUEPRINTS[uType];
                        return (
                          <button
                            key={uType}
                            type="button"
                            onClick={() => onTrainUnit(selectedBld.id, uType)}
                            className="min-h-[44px] px-3 bg-[#1c2333] border border-[#c49a45]/45 rounded text-xs font-semibold text-[#eae3d2]"
                          >
                            +{UNIT_LABELS_RU[uType]} ({ubp.cost.gold}З)
                          </button>
                        );
                      })}
                  </div>
                </div>
              ) : (
                <div className="w-full flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#eae3d2]">
                    Выбрано: {hud.selectedUnits.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onSetMobileMode(hud.mobileMode === 'attack' ? 'smart' : 'attack')
                      }
                      className={`min-h-[44px] px-3 rounded text-xs font-semibold ${
                        hud.mobileMode === 'attack'
                          ? 'bg-[#991b1b] text-white'
                          : 'bg-[#1a1f2b] border border-[#323a4d] text-[#fca5a5]'
                      }`}
                    >
                      {hud.mobileMode === 'attack' ? 'Укажите цель' : 'Атака'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onCommand('follow_hero')}
                      className="min-h-[44px] px-3 bg-[#1a1f2b] border border-[#323a4d] rounded text-xs font-semibold text-[#eae3d2]"
                    >
                      За Аватаром
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        {mobileDrawer === 'build' && (
          <div className="pointer-events-auto bg-[#10131a]/96 border border-[#c49a45]/45 rounded-md p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-bold text-[#eae3d2]">
                Строительство и добыча
              </span>
              <button
                type="button"
                onClick={() => setMobileDrawer('none')}
                className="min-h-[44px] px-2.5 text-xs text-[#9e9788]"
              >
                Закрыть
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BUILD_OPTIONS.map((bt) => {
                const bp = BUILDING_BLUEPRINTS[bt];
                return (
                  <button
                    key={bt}
                    type="button"
                    onClick={() => {
                      onToggleBuildMode(bt);
                      setMobileDrawer('none');
                    }}
                    className="min-h-[46px] p-2 bg-[#181c26] border border-[#2f3647] rounded text-left"
                  >
                    <div className="text-xs font-semibold text-[#eae3d2]">
                      {BUILDING_LABELS_RU[bt]}
                    </div>
                    <div className="text-[11px] font-mono-num text-[#9e9788]">
                      {bp.cost.wood}Д · {bp.cost.gold}З
                      {bp.cost.stone > 0 ? ` · ${bp.cost.stone}К` : ''}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  onAssignLaborer('wood');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] bg-[#1a221c] border border-[#3a543f] rounded text-xs font-medium text-[#a3e635]"
              >
                Лес
              </button>
              <button
                type="button"
                onClick={() => {
                  onAssignLaborer('gold');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] bg-[#242014] border border-[#6e5a23] rounded text-xs font-medium text-[#facc15]"
              >
                Руда
              </button>
              <button
                type="button"
                onClick={() => {
                  onAssignLaborer('stone');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] bg-[#1c2128] border border-[#424d5c] rounded text-xs font-medium text-[#cbd5e1]"
              >
                Камень
              </button>
            </div>
          </div>
        )}

        {mobileDrawer === 'army' && v14 && (
          <div className="pointer-events-auto bg-[#10131a]/96 border border-[#c49a45]/45 rounded-md p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-[#eae3d2]">
                Группы, строй и приказы
              </span>
              <button
                type="button"
                onClick={() => setMobileDrawer('none')}
                className="min-h-[44px] px-2.5 text-xs text-[#9e9788]"
              >
                Закрыть
              </button>
            </div>

            {/* 6 Control Groups with touch-friendly Select / Assign mode toggle (§292.7) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-[#9e9788]">Группы отряда (1–6)</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMobileGroupAssignMode(false)}
                    className={`min-h-[36px] px-2 rounded text-[11px] font-semibold border ${
                      !mobileGroupAssignMode
                        ? 'bg-[#c49a45] text-[#101218] border-[#c49a45]'
                        : 'bg-[#181c26] text-[#d6cfc0] border-[#2e3545]'
                    }`}
                  >
                    Выбрать
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileGroupAssignMode(true)}
                    className={`min-h-[36px] px-2 rounded text-[11px] font-semibold border ${
                      mobileGroupAssignMode
                        ? 'bg-[#c49a45] text-[#101218] border-[#c49a45]'
                        : 'bg-[#181c26] text-[#d6cfc0] border-[#2e3545]'
                    }`}
                  >
                    Назначить
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {CONTROL_SLOTS.map((slot) => {
                  const count = v14.controlGroupCounts[slot] ?? 0;
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-label={
                        mobileGroupAssignMode
                          ? `Назначить группу ${slot}`
                          : `Выбрать группу ${slot}`
                      }
                      onClick={() => {
                        if (mobileGroupAssignMode) {
                          onAssignControlGroup(slot);
                          setMobileGroupAssignMode(false);
                        } else {
                          onRecallControlGroup(slot);
                        }
                      }}
                      className={`min-h-[44px] rounded border text-xs font-mono-num font-semibold ${
                        count > 0
                          ? 'bg-[#1f2636] border-[#c49a45]/60 text-[#facc15]'
                          : 'bg-[#151922] border-[#262d3c] text-[#8f96a8]'
                      }`}
                    >
                      {slot}
                      {count > 0 ? `(${count})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Squad Formations (§292.10) */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-[#232938]">
              <div className="flex items-center justify-between text-[11px] text-[#9e9788]">
                <span>Формация отряда</span>
                {!v14.canUseFormation && (
                  <span className="text-[#fbbf24]">Выберите войска</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {FORMATIONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={!v14.canUseFormation}
                    title={v14.formationReasonRu ?? `Построение: ${f.label}`}
                    onClick={() => onSetFormation(f.id)}
                    className={`min-h-[44px] px-2 rounded text-xs font-semibold border disabled:opacity-40 ${
                      v14.activeFormation === f.id
                        ? 'bg-[#c49a45] text-[#101218] border-[#c49a45]'
                        : 'bg-[#181c26] text-[#d6cfc0] border-[#2e3545]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Squad Quick Orders */}
            <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-[#232938]">
              <button
                type="button"
                onClick={() => {
                  onCommand('follow_hero');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] px-2 bg-[#181c26] border border-[#2f3647] rounded text-xs font-medium text-[#eae3d2]"
              >
                За Аватаром
              </button>
              <button
                type="button"
                onClick={() => {
                  onCommand('attack_move_forward');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] px-2 bg-[#2a1719] border border-[#7f1d1d] rounded text-xs font-medium text-[#fca5a5]"
              >
                На восток
              </button>
              <button
                type="button"
                onClick={() => {
                  onCommand('stop');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] px-2 bg-[#181c26] border border-[#2f3647] rounded text-xs font-medium text-[#eae3d2]"
              >
                Удерживать
              </button>
            </div>
          </div>
        )}

        {mobileDrawer === 'map' && (
          <div className="pointer-events-auto bg-[#10131a]/96 border border-[#c49a45]/45 rounded-md p-3 flex flex-col items-center gap-2">
            <div className="w-full flex items-center justify-between">
              <span className="font-display text-sm font-bold text-[#eae3d2]">Карта сектора</span>
              <button
                type="button"
                onClick={() => setMobileDrawer('none')}
                className="min-h-[44px] px-2.5 text-xs text-[#9e9788]"
              >
                Закрыть
              </button>
            </div>
            <canvas
              ref={mobileMinimapRef}
              width={180}
              height={180}
              onPointerDown={handleMinimapPointer}
              onPointerMove={(e) => {
                if (e.buttons === 1) handleMinimapPointer(e);
              }}
              className="w-[180px] h-[180px] rounded border border-[#2a3140]"
            />
          </div>
        )}

        {/* Mobile Main Bottom Navigation Dock (>= 44px touch targets) */}
        <div className="pointer-events-auto grid grid-cols-5 gap-1.5 bg-[#10131a]/96 border border-[#c49a45]/35 rounded-md p-1.5">
          <button
            type="button"
            onClick={onSelectHero}
            className="min-h-[44px] rounded bg-[#181c26] text-xs font-semibold text-[#facc15]"
          >
            Аватар
          </button>
          <button
            type="button"
            onClick={onSelectArmy}
            className="min-h-[44px] rounded bg-[#181c26] text-xs font-semibold text-[#eae3d2]"
          >
            Армия
          </button>
          <button
            type="button"
            onClick={() =>
              onSetMobileMode(hud.mobileMode === 'select_box' ? 'smart' : 'select_box')
            }
            className={`min-h-[44px] rounded text-xs font-semibold ${
              hud.mobileMode === 'select_box'
                ? 'bg-[#c49a45] text-[#101218]'
                : 'bg-[#181c26] text-[#eae3d2]'
            }`}
          >
            Рамка
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawer((d) => (d === 'build' ? 'none' : 'build'))}
            className={`min-h-[44px] rounded text-xs font-semibold ${
              mobileDrawer === 'build'
                ? 'bg-[#c49a45] text-[#101218]'
                : 'bg-[#181c26] text-[#eae3d2]'
            }`}
          >
            Стройка
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawer((d) => (d === 'map' ? 'none' : 'map'))}
            className={`min-h-[44px] rounded text-xs font-semibold ${
              mobileDrawer === 'map'
                ? 'bg-[#c49a45] text-[#101218]'
                : 'bg-[#181c26] text-[#eae3d2]'
            }`}
          >
            Карта
          </button>
        </div>
      </div>
    </div>
  );
};
