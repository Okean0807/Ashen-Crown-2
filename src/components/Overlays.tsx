import React from 'react';
import { EquipSlot, HudSnapshot, ItemDef } from '../game/types';

interface InventoryModalProps {
  hud: HudSnapshot;
  onClose: () => void;
  onUseOrEquip: (index: number) => void;
}

const RARITY_COLOR: Record<ItemDef['rarity'], string> = {
  common: 'text-[#d6cfc0] border-[#3d4454]',
  rare: 'text-[#60a5fa] border-[#3b82f6]/50',
  epic: 'text-[#facc15] border-[#c49a45]/70',
};

export const InventoryModal: React.FC<InventoryModalProps> = ({
  hud,
  onClose,
  onUseOrEquip,
}) => {
  const hero = hud.hero;
  const slots: Array<{ key: EquipSlot; label: string }> = [
    { key: 'weapon', label: 'Weapon' },
    { key: 'armor', label: 'Armor' },
    { key: 'relic', label: 'Relic' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
      <div className="w-full max-w-lg bg-[#12151d] border border-[#c49a45]/45 rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252b38]">
          <div>
            <h2 className="font-display text-lg font-bold text-[#eae3d2]">
              Aldric — Equipment &amp; Bag
            </h2>
            {hero && (
              <p className="text-xs text-[#9e9788] font-mono-num">
                Level {hero.level ?? 1} · ATK {hero.baseAtk} · ARM {hero.baseArmor} · HP {Math.ceil(hero.hp)}/{hero.maxHp}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-3 py-1.5 bg-[#1d222e] hover:bg-[#282f40] text-[#eae3d2] text-xs font-medium rounded cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5 max-h-[75vh] overflow-y-auto custom-scroll">
          {/* Equipped Slots */}
          <div>
            <h3 className="text-xs font-semibold text-[#c49a45] mb-2">Equipped Gear</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {slots.map((s) => {
                const item = hud.equipment[s.key];
                return (
                  <div
                    key={s.key}
                    className={`p-3 rounded bg-[#181c26] border ${
                      item ? RARITY_COLOR[item.rarity] : 'border-[#272d3b] text-[#6d7485]'
                    }`}
                  >
                    <div className="text-[11px] text-[#8f8879]">{s.label}</div>
                    <div className="text-xs font-semibold mt-0.5 truncate">
                      {item ? item.name : 'Empty Slot'}
                    </div>
                    <div className="text-[11px] text-[#9e9788] mt-1">
                      {item ? item.description : 'Find gear in ruins'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Backpack */}
          <div>
            <h3 className="text-xs font-semibold text-[#c49a45] mb-2">
              Backpack ({hud.inventory.length})
            </h3>
            {hud.inventory.length === 0 ? (
              <p className="text-xs text-[#7e8596] py-3">
                No unequipped items. Explore ruin chests and defeat Orcs to find gear.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {hud.inventory.map((item, idx) => (
                  <button
                    key={`${item.id}_${idx}`}
                    type="button"
                    onClick={() => onUseOrEquip(idx)}
                    className={`text-left p-3 rounded bg-[#181c26] hover:bg-[#212735] border transition-colors cursor-pointer ${RARITY_COLOR[item.rarity]}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold truncate">{item.name}</span>
                      <span className="text-[11px] text-[#c49a45] shrink-0">
                        {item.slot === 'consumable' ? 'Drink' : 'Equip'}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#9e9788] mt-1">{item.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md bg-[#12151d] border border-[#c49a45]/55 rounded-lg p-6 shadow-2xl text-center">
        <p className="text-xs tracking-[0.2em] uppercase text-[#c49a45] font-semibold">
          {isVictory ? 'Scenario Complete' : 'Settlement Fallen'}
        </p>
        <h2 className="font-display text-3xl font-bold text-[#f2ece0] mt-1">
          {isVictory ? 'Victory at Dawn' : 'Defeat'}
        </h2>
        <p className="text-sm text-[#b8b09f] mt-2">
          {isVictory
            ? 'Warchief Grimgor has fallen and the borderland settlement stands secure.'
            : 'Your Town Hall was destroyed by the Orc warband before the frontier could be secured.'}
        </p>

        <div className="grid grid-cols-2 gap-3 my-5 p-4 rounded bg-[#171b25] border border-[#262d3c] text-left">
          <div>
            <div className="text-[11px] text-[#8f8879]">Time Elapsed</div>
            <div className="text-sm font-mono-num font-semibold text-[#eae3d2]">
              {mins}m {secs.toString().padStart(2, '0')}s
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8f8879]">Hero Level</div>
            <div className="text-sm font-mono-num font-semibold text-[#facc15]">
              Level {hud.hero?.level ?? 1}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8f8879]">Orcs Slain</div>
            <div className="text-sm font-mono-num font-semibold text-[#eae3d2]">
              {hud.stats.orcsSlain}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8f8879]">Swordsmen Trained</div>
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
            Play Again
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="min-h-[44px] px-5 py-2.5 bg-[#1b202c] hover:bg-[#252c3c] text-[#eae3d2] text-sm font-medium rounded border border-[#323a4d] cursor-pointer whitespace-nowrap"
          >
            Title Screen
          </button>
        </div>
      </div>
    </div>
  );
};

interface PauseModalProps {
  onResume: () => void;
  onSave: () => void;
  onOpenShowcase: () => void;
  onRestart: () => void;
  onTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  onResume,
  onSave,
  onOpenShowcase,
  onRestart,
  onTitle,
}) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-xs bg-[#12151d] border border-[#c49a45]/45 rounded-lg p-6 shadow-2xl flex flex-col gap-3">
      <h2 className="font-display text-2xl font-bold text-[#f2ece0] text-center mb-1">
        Game Paused
      </h2>
      <button
        type="button"
        onClick={onResume}
        className="min-h-[44px] w-full bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] font-semibold text-sm rounded cursor-pointer"
      >
        Resume
      </button>
      <button
        type="button"
        onClick={onSave}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#eae3d2] font-medium text-sm rounded border border-[#2f3647] cursor-pointer"
      >
        Save Campaign
      </button>
      <button
        type="button"
        onClick={onOpenShowcase}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#d9d2c2] font-medium text-sm rounded border border-[#3a4359] cursor-pointer"
      >
        3D Hero Showcase
      </button>
      <button
        type="button"
        onClick={onRestart}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#eae3d2] font-medium text-sm rounded border border-[#2f3647] cursor-pointer"
      >
        Restart Scenario
      </button>
      <button
        type="button"
        onClick={onTitle}
        className="min-h-[44px] w-full bg-[#1a1f2b] hover:bg-[#232939] text-[#c49a45] font-medium text-sm rounded border border-[#2f3647] cursor-pointer"
      >
        Title Screen
      </button>
    </div>
  </div>
);
