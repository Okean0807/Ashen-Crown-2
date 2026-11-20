import React, { useState } from 'react';
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
  onAssignLaborer: (kind: ResourceKind) => void;
  onCommand: (cmd: 'stop' | 'follow_hero' | 'attack_move_forward') => void;
  onHeroCleave: () => void;
  onHeroRally: () => void;
  onOpenInventory: () => void;
  onSetMobileMode: (mode: MobileActionMode) => void;
  onToggleMute: () => void;
  onSave: () => void;
  onPause: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetCamera: () => void;
}

const BUILD_OPTIONS: BuildingType[] = ['barracks', 'archer_range', 'farm', 'tower'];

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
  onAssignLaborer,
  onCommand,
  onHeroCleave,
  onHeroRally,
  onOpenInventory,
  onSetMobileMode,
  onToggleMute,
  onSave,
  onPause,
  onZoomIn,
  onZoomOut,
  onResetCamera,
}) => {
  const [showObjectives, setShowObjectives] = useState(false);
  const [rightTab, setRightTab] = useState<'build' | 'orders'>('build');
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'build' | 'map'>('none');

  const currentObj =
    hud.objectives.find((o) => !o.completed) ?? hud.objectives[hud.objectives.length - 1];
  const completedCount = hud.objectives.filter((o) => o.completed).length;

  const selectedHero = hud.selectedUnits.length === 1 && hud.selectedUnits[0].type === 'hero'
    ? hud.hero
    : null;
  const singleUnit = hud.selectedUnits.length === 1 ? hud.selectedUnits[0] : null;
  const selectedBld = hud.selectedBuilding;
  const selectedBldBp = selectedBld ? BUILDING_BLUEPRINTS[selectedBld.type] : null;

  const handleMinimapPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    onMinimapNav(e.clientX, e.clientY, e.currentTarget);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between">
      {/* TOP BAR */}
      <header className="pointer-events-auto flex items-center justify-between gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-[#10131a]/95 border-b border-[#c49a45]/30 text-xs">
        {/* Resources Cluster */}
        <div className="flex items-center gap-3 sm:gap-5 font-mono-num shrink-0">
          <div className="flex items-center gap-1.5" title="Gold">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="#eab308" stroke="#fef08a" strokeWidth="1.2" />
            </svg>
            <span className="font-semibold text-[#facc15]">{hud.resources.gold}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Wood">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2L13 11H3L8 2Z" fill="#65a30d" />
              <rect x="7" y="11" width="2" height="3" fill="#78350f" />
            </svg>
            <span className="font-semibold text-[#a3e635]">{hud.resources.wood}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Stone">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <polygon points="3,13 5,5 11,4 14,13" fill="#94a3b8" />
            </svg>
            <span className="font-semibold text-[#cbd5e1]">{hud.resources.stone}</span>
          </div>
          <div className="hidden xs:flex sm:flex items-center gap-1 text-[#d6cfc0]" title="Population">
            <span>Pop</span>
            <span className="font-semibold">
              {hud.popUsed}/{hud.popCap}
            </span>
          </div>
        </div>

        {/* Active Objective Dropdown Trigger */}
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setShowObjectives((s) => !s)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#181c26] hover:bg-[#202634] border border-[#c49a45]/35 text-[#eae3d2] cursor-pointer max-w-[190px] sm:max-w-xs"
          >
            <span className="text-[11px] font-mono-num text-[#c49a45] shrink-0">
              {completedCount}/{hud.objectives.length}
            </span>
            <span className="truncate text-xs font-medium">{currentObj?.title}</span>
          </button>

          {showObjectives && (
            <div className="absolute right-0 sm:left-1/2 sm:-translate-x-1/2 mt-2 w-72 sm:w-80 bg-[#12151e] border border-[#c49a45]/45 rounded-md p-3.5 shadow-2xl z-30">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#252b38]">
                <span className="font-display text-sm font-bold text-[#eae3d2]">
                  The First Settlement
                </span>
                <button
                  type="button"
                  onClick={() => setShowObjectives(false)}
                  className="text-xs text-[#9e9788] hover:text-[#eae3d2] cursor-pointer"
                >
                  Close
                </button>
              </div>
              <ul className="flex flex-col gap-2">
                {hud.objectives.map((obj, idx) => (
                  <li key={obj.id} className="flex items-start justify-between gap-2 text-xs">
                    <span className={obj.completed ? 'text-[#4ade80] line-through' : 'text-[#eae3d2]'}>
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

        {/* System Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            className="min-h-[34px] px-2.5 py-1 rounded bg-[#181c26] hover:bg-[#222836] border border-[#2d3444] text-[#d6cfc0] cursor-pointer whitespace-nowrap"
          >
            {hud.muted ? 'Unmute' : 'Sound'}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="hidden sm:inline-flex items-center min-h-[34px] px-2.5 py-1 rounded bg-[#181c26] hover:bg-[#222836] border border-[#2d3444] text-[#d6cfc0] cursor-pointer whitespace-nowrap"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onPause}
            className="min-h-[34px] px-2.5 py-1 rounded bg-[#181c26] hover:bg-[#222836] border border-[#c49a45]/40 text-[#eae3d2] cursor-pointer whitespace-nowrap"
          >
            Menu
          </button>
        </div>
      </header>

      {/* Center Top Notification & Build Mode Banner */}
      <div className="flex flex-col items-center gap-1.5 mt-2 px-3">
        {hud.buildMode && (
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-1.5 rounded bg-[#12161f]/95 border border-[#c49a45] text-xs text-[#eae3d2] shadow-lg">
            <span>
              Placing <strong>{BUILDING_BLUEPRINTS[hud.buildMode]?.name}</strong> — Click or tap green terrain
            </span>
            <button
              type="button"
              onClick={() => onToggleBuildMode(null)}
              className="px-2 py-0.5 bg-[#7f1d1d] hover:bg-[#991b1b] text-white rounded cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
        {hud.bannerMessage && (
          <div className="px-4 py-1.5 rounded bg-[#11141c]/92 border border-[#c49a45]/40 text-xs sm:text-sm text-[#f3ead8] shadow-lg text-center">
            {hud.bannerMessage}
          </div>
        )}
      </div>

      {/* Fixed Camera Controls (Zoom In, Zoom Out, Reset Camera) */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className="pointer-events-auto fixed right-2.5 top-12 sm:top-14 z-20 flex flex-col items-center gap-1 bg-[#10131a]/95 border border-[#c49a45]/35 rounded-md p-1 shadow-xl"
      >
        <button
          type="button"
          onClick={onZoomIn}
          disabled={hud.cameraZoom >= 2.98}
          aria-label="Zoom in"
          title="Zoom In"
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
          aria-label="Zoom out"
          title="Zoom Out"
          className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#181c26] hover:bg-[#232939] active:scale-95 disabled:opacity-40 text-[#eae3d2] text-base font-bold cursor-pointer"
        >
          -
        </button>
        <button
          type="button"
          onClick={onResetCamera}
          aria-label="Reset camera"
          title="Reset Camera"
          className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#181c26] hover:bg-[#232939] active:scale-95 border-t border-[#262d3c] text-[#facc15] cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      </div>

      {/* DESKTOP BOTTOM DOCK */}
      <div className="hidden md:flex items-end justify-between gap-3 p-3 mt-auto">
        {/* Bottom-Left: Minimap + Quick Select */}
        <div className="pointer-events-auto flex flex-col gap-2 bg-[#10131a]/95 border border-[#c49a45]/35 rounded-md p-2.5 shadow-xl">
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
              Hero (1)
            </button>
            <button
              type="button"
              onClick={onSelectArmy}
              className="py-1.5 px-2 bg-[#1a202c] hover:bg-[#252d3d] border border-[#323a4d] rounded text-[11px] font-semibold text-[#eae3d2] cursor-pointer whitespace-nowrap"
            >
              Army (2)
            </button>
          </div>
        </div>

        {/* Bottom-Center: Selection Inspector */}
        <div className="pointer-events-auto flex-1 max-w-lg bg-[#10131a]/95 border border-[#c49a45]/35 rounded-md p-3 shadow-xl min-h-[126px] flex flex-col justify-between">
          {selectedHero ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-[#facc15]">
                      {selectedHero.name}
                    </span>
                    <span className="text-xs font-mono-num text-[#9e9788]">
                      Lv {selectedHero.level ?? 1}
                    </span>
                  </div>
                  <div className="text-xs font-mono-num text-[#cbd5e1] mt-0.5">
                    HP {Math.ceil(selectedHero.hp)}/{selectedHero.maxHp} · ATK {selectedHero.baseAtk} · ARM {selectedHero.baseArmor} · XP {selectedHero.xp ?? 0}/{selectedHero.xpToNext ?? 100}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenInventory}
                  className="px-3 py-1.5 bg-[#1f2533] hover:bg-[#2a3245] border border-[#c49a45]/50 rounded text-xs font-semibold text-[#eae3d2] cursor-pointer whitespace-nowrap"
                >
                  Gear &amp; Bag ({hud.inventory.length})
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={(selectedHero.cleaveCooldown ?? 0) > 0}
                  onClick={onHeroCleave}
                  className="flex-1 py-2 px-3 bg-[#7f1d1d] hover:bg-[#991b1b] disabled:opacity-45 rounded text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
                >
                  {(selectedHero.cleaveCooldown ?? 0) > 0
                    ? `Ashen Cleave (${Math.ceil(selectedHero.cleaveCooldown ?? 0)}s)`
                    : 'Ashen Cleave (Q)'}
                </button>
                <button
                  type="button"
                  disabled={(selectedHero.rallyCooldown ?? 0) > 0}
                  onClick={onHeroRally}
                  className="flex-1 py-2 px-3 bg-[#1e3a8a] hover:bg-[#2549ab] disabled:opacity-45 rounded text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
                >
                  {(selectedHero.rallyCooldown ?? 0) > 0
                    ? `Rallying Cry (${Math.ceil(selectedHero.rallyCooldown ?? 0)}s)`
                    : 'Rallying Cry (E)'}
                </button>
              </div>
            </div>
          ) : singleUnit ? (
            <div className="flex flex-col justify-between gap-2 h-full">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-sm font-bold text-[#eae3d2]">{singleUnit.name}</div>
                  <div className="text-xs font-mono-num text-[#9e9788] mt-0.5">
                    HP {Math.ceil(singleUnit.hp)}/{singleUnit.maxHp} · ATK {singleUnit.baseAtk} · ARM {singleUnit.baseArmor}
                  </div>
                </div>
                <span className="text-xs text-[#c49a45] capitalize">{singleUnit.order.replace('_', ' ')}</span>
              </div>
              <p className="text-xs text-[#a69f90]">
                {UNIT_BLUEPRINTS[singleUnit.type]?.description}
              </p>
            </div>
          ) : hud.selectedUnits.length > 1 ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-display font-bold text-[#eae3d2]">
                  Warband Selected ({hud.selectedUnits.length})
                </span>
                <span className="text-[#9e9788]">Click portrait to focus</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[82px] overflow-y-auto custom-scroll">
                {hud.selectedUnits.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onSelectUnitId(u.id)}
                    className="px-2 py-1 rounded bg-[#191e29] hover:bg-[#252c3c] border border-[#323a4d] text-[11px] text-[#eae3d2] cursor-pointer font-mono-num"
                  >
                    {u.type === 'hero' ? 'Aldric' : u.name.split(' ')[0]} · {Math.ceil((u.hp / u.maxHp) * 100)}%
                  </button>
                ))}
              </div>
            </div>
          ) : selectedBld && selectedBldBp ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-display text-sm font-bold text-[#eae3d2]">
                    {selectedBld.name}
                  </span>
                  <span className="ml-2 text-xs font-mono-num text-[#9e9788]">
                    HP {Math.ceil(selectedBld.hp)}/{selectedBld.maxHp}
                  </span>
                </div>
                {!selectedBld.constructed && (
                  <span className="text-xs font-mono-num text-[#facc15]">
                    Building {Math.round(selectedBld.buildProgress * 100)}%
                  </span>
                )}
              </div>
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
                        <div className="font-semibold">Recruit {ubp.name}</div>
                        <div className="text-[11px] font-mono-num text-[#9e9788]">
                          {ubp.cost.gold}G {ubp.cost.wood > 0 ? `· ${ubp.cost.wood}W` : ''}
                        </div>
                      </button>
                    );
                  })}
                  {selectedBld.queue.length > 0 && (
                    <div className="text-xs font-mono-num text-[#60a5fa] ml-auto">
                      Training {UNIT_BLUEPRINTS[selectedBld.queue[0].unitType].name} (
                      {Math.ceil(selectedBld.queue[0].remaining)}s) · Queue {selectedBld.queue.length}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#9e9788]">{selectedBldBp.description}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col justify-center items-center h-full text-center text-xs text-[#8f8879]">
              <span>Select Aldric, a unit, or a building to view details and recruit troops.</span>
              <span className="mt-1">Tip: Click a tree, gold vein, or stone quarry to send a Laborer.</span>
            </div>
          )}
        </div>

        {/* Bottom-Right: Construction & Orders Card */}
        <div className="pointer-events-auto w-80 bg-[#10131a]/95 border border-[#c49a45]/35 rounded-md p-2.5 shadow-xl flex flex-col gap-2">
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
              Build &amp; Gather
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
              Unit Orders
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
                      <div className="text-xs font-semibold text-[#eae3d2] truncate">{bp.name}</div>
                      <div className="text-[10px] font-mono-num text-[#a69f90] mt-0.5">
                        {bp.cost.wood}W · {bp.cost.gold}G{bp.cost.stone > 0 ? ` · ${bp.cost.stone}S` : ''}
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
                  Gather Wood
                </button>
                <button
                  type="button"
                  onClick={() => onAssignLaborer('gold')}
                  className="py-1.5 px-2 bg-[#242014] hover:bg-[#332c19] border border-[#6e5a23] rounded text-[11px] font-medium text-[#facc15] cursor-pointer"
                >
                  Mine Gold
                </button>
                <button
                  type="button"
                  onClick={() => onAssignLaborer('stone')}
                  className="py-1.5 px-2 bg-[#1c2128] hover:bg-[#262d37] border border-[#424d5c] rounded text-[11px] font-medium text-[#cbd5e1] cursor-pointer"
                >
                  Mine Stone
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onCommand('follow_hero')}
                className="py-2.5 px-3 bg-[#181c26] hover:bg-[#232938] border border-[#2f3647] rounded text-xs font-medium text-[#eae3d2] cursor-pointer"
              >
                Follow Aldric
              </button>
              <button
                type="button"
                onClick={() => onCommand('attack_move_forward')}
                className="py-2.5 px-3 bg-[#2a1719] hover:bg-[#3b1e21] border border-[#7f1d1d] rounded text-xs font-medium text-[#fca5a5] cursor-pointer"
              >
                March East
              </button>
              <button
                type="button"
                onClick={() => onCommand('stop')}
                className="py-2.5 px-3 bg-[#181c26] hover:bg-[#232938] border border-[#2f3647] rounded text-xs font-medium text-[#eae3d2] cursor-pointer"
              >
                Hold Position
              </button>
              <button
                type="button"
                onClick={onSelectArmy}
                className="py-2.5 px-3 bg-[#181c26] hover:bg-[#232938] border border-[#2f3647] rounded text-xs font-medium text-[#c49a45] cursor-pointer"
              >
                Select All Army
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MOBILE RESPONSIVE BOTTOM BAR & DRAWERS (< 768px) */}
      <div className="md:hidden flex flex-col gap-2 p-2 mt-auto">
        {/* Contextual Selection Strip on Mobile */}
        {mobileDrawer === 'none' && (selectedHero || selectedBld || hud.selectedUnits.length > 0) && (
          <div className="pointer-events-auto bg-[#10131a]/95 border border-[#c49a45]/40 rounded-md p-2 flex flex-wrap items-center justify-between gap-2">
            {selectedHero ? (
              <>
                <div className="text-xs font-mono-num">
                  <span className="font-display font-bold text-[#facc15] mr-1.5">Aldric Lv{selectedHero.level ?? 1}</span>
                  <span className="text-[#cbd5e1]">{Math.ceil(selectedHero.hp)}/{selectedHero.maxHp} HP</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={(selectedHero.cleaveCooldown ?? 0) > 0}
                    onClick={onHeroCleave}
                    className="min-h-[40px] px-3 bg-[#7f1d1d] disabled:opacity-45 rounded text-xs font-semibold text-white"
                  >
                    {(selectedHero.cleaveCooldown ?? 0) > 0 ? `${Math.ceil(selectedHero.cleaveCooldown ?? 0)}s` : 'Cleave'}
                  </button>
                  <button
                    type="button"
                    disabled={(selectedHero.rallyCooldown ?? 0) > 0}
                    onClick={onHeroRally}
                    className="min-h-[40px] px-3 bg-[#1e3a8a] disabled:opacity-45 rounded text-xs font-semibold text-white"
                  >
                    Rally
                  </button>
                  <button
                    type="button"
                    onClick={onOpenInventory}
                    className="min-h-[40px] px-3 bg-[#1d2230] border border-[#c49a45]/50 rounded text-xs font-semibold text-[#eae3d2]"
                  >
                    Bag
                  </button>
                </div>
              </>
            ) : selectedBld && selectedBldBp ? (
              <div className="w-full flex items-center justify-between gap-2">
                <div className="text-xs">
                  <div className="font-semibold text-[#eae3d2]">{selectedBld.name}</div>
                  {!selectedBld.constructed && (
                    <div className="text-[#facc15] font-mono-num">
                      {Math.round(selectedBld.buildProgress * 100)}%
                    </div>
                  )}
                </div>
                {selectedBld.constructed && selectedBldBp.trains && (
                  <div className="flex items-center gap-1.5">
                    {selectedBldBp.trains.map((uType) => {
                      const ubp = UNIT_BLUEPRINTS[uType];
                      return (
                        <button
                          key={uType}
                          type="button"
                          onClick={() => onTrainUnit(selectedBld.id, uType)}
                          className="min-h-[40px] px-3 bg-[#1c2333] border border-[#c49a45]/45 rounded text-xs font-semibold text-[#eae3d2]"
                        >
                          +{ubp.name} ({ubp.cost.gold}G)
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#eae3d2]">
                  {hud.selectedUnits.length} Selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSetMobileMode(hud.mobileMode === 'attack' ? 'smart' : 'attack')}
                    className={`min-h-[40px] px-3 rounded text-xs font-semibold ${
                      hud.mobileMode === 'attack'
                        ? 'bg-[#991b1b] text-white'
                        : 'bg-[#1a1f2b] border border-[#323a4d] text-[#fca5a5]'
                    }`}
                  >
                    {hud.mobileMode === 'attack' ? 'Tap Target!' : 'Attack'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCommand('follow_hero')}
                    className="min-h-[40px] px-3 bg-[#1a1f2b] border border-[#323a4d] rounded text-xs font-semibold text-[#eae3d2]"
                  >
                    Follow
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile Build / Map Popover Drawer */}
        {mobileDrawer === 'build' && (
          <div className="pointer-events-auto bg-[#10131a]/95 border border-[#c49a45]/45 rounded-md p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-bold text-[#eae3d2]">Construct &amp; Gather</span>
              <button
                type="button"
                onClick={() => setMobileDrawer('none')}
                className="min-h-[36px] px-2.5 text-xs text-[#9e9788]"
              >
                Close
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
                    <div className="text-xs font-semibold text-[#eae3d2]">{bp.name}</div>
                    <div className="text-[11px] font-mono-num text-[#9e9788]">
                      {bp.cost.wood}W · {bp.cost.gold}G {bp.cost.stone > 0 ? `· ${bp.cost.stone}S` : ''}
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
                Wood
              </button>
              <button
                type="button"
                onClick={() => {
                  onAssignLaborer('gold');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] bg-[#242014] border border-[#6e5a23] rounded text-xs font-medium text-[#facc15]"
              >
                Gold
              </button>
              <button
                type="button"
                onClick={() => {
                  onAssignLaborer('stone');
                  setMobileDrawer('none');
                }}
                className="min-h-[44px] bg-[#1c2128] border border-[#424d5c] rounded text-xs font-medium text-[#cbd5e1]"
              >
                Stone
              </button>
            </div>
          </div>
        )}

        {mobileDrawer === 'map' && (
          <div className="pointer-events-auto bg-[#10131a]/95 border border-[#c49a45]/45 rounded-md p-3 flex flex-col items-center gap-2">
            <div className="w-full flex items-center justify-between">
              <span className="font-display text-sm font-bold text-[#eae3d2]">Battlefield Map</span>
              <button
                type="button"
                onClick={() => setMobileDrawer('none')}
                className="min-h-[36px] px-2.5 text-xs text-[#9e9788]"
              >
                Close
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
        <div className="pointer-events-auto grid grid-cols-5 gap-1.5 bg-[#10131a]/95 border border-[#c49a45]/35 rounded-md p-1.5">
          <button
            type="button"
            onClick={onSelectHero}
            className="min-h-[44px] rounded bg-[#181c26] text-xs font-semibold text-[#facc15]"
          >
            Hero
          </button>
          <button
            type="button"
            onClick={onSelectArmy}
            className="min-h-[44px] rounded bg-[#181c26] text-xs font-semibold text-[#eae3d2]"
          >
            Army
          </button>
          <button
            type="button"
            onClick={() => onSetMobileMode(hud.mobileMode === 'select_box' ? 'smart' : 'select_box')}
            className={`min-h-[44px] rounded text-xs font-semibold ${
              hud.mobileMode === 'select_box'
                ? 'bg-[#c49a45] text-[#101218]'
                : 'bg-[#181c26] text-[#eae3d2]'
            }`}
          >
            Box
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
            Build
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
            Map
          </button>
        </div>
      </div>
    </div>
  );
};
