import React, { useEffect } from 'react';

interface TitleScreenProps {
  hasSavedGame: boolean;
  onNewGame: () => void;
  onContinueGame: () => void;
  onOpenShowcase: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  hasSavedGame,
  onNewGame,
  onContinueGame,
  onOpenShowcase,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNewGame();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNewGame]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-r from-[#0a0c12]/95 via-[#0a0c12]/78 to-[#0a0c12]/25 p-6 sm:p-12">
      <div className="max-w-xl my-auto flex flex-col gap-6">
        {/* Bespoke Inline SVG Title Lockup */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <svg
              width="56"
              height="56"
              viewBox="0 0 64 64"
              fill="none"
              aria-hidden="true"
              className="shrink-0"
            >
              <path
                d="M32 4L54 14V31C54 45.2 44.5 55.6 32 60C19.5 55.6 10 45.2 10 31V14L32 4Z"
                fill="#141821"
                stroke="#C49A45"
                strokeWidth="2.5"
              />
              <path
                d="M21 24L26 16L32 22L38 16L43 24L40 31H24L21 24Z"
                fill="#C49A45"
              />
              <path
                d="M32 26V50M26 36H38"
                stroke="#EAE3D2"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <div>
              <p className="text-xs tracking-[0.22em] uppercase text-[#c49a45] font-semibold">
                Scenario I · The First Settlement
              </p>
              <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-wide text-[#f2ece0] leading-none mt-1">
                Ashen Crown
              </h1>
            </div>
          </div>

          <p className="text-sm sm:text-base text-[#c5beae] leading-relaxed max-w-lg mt-2">
            Command Sir Aldric across a fractured borderland. Explore the dark timberlands,
            harvest gold and stone, raise your settlement, and crush Warchief Grimgor&apos;s
            encampment beyond the river.
          </p>
        </div>

        {/* Primary Action CTAs */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onNewGame}
            className="min-h-[46px] px-7 py-3 bg-[#c49a45] hover:bg-[#d6ac56] active:scale-[0.98] text-[#101218] font-semibold text-sm sm:text-base rounded-md transition-all cursor-pointer shadow-lg whitespace-nowrap"
          >
            Start Campaign
          </button>

          {hasSavedGame && (
            <button
              type="button"
              onClick={onContinueGame}
              className="min-h-[46px] px-6 py-3 bg-[#191d27] hover:bg-[#232938] border border-[#c49a45]/45 text-[#eae3d2] font-medium text-sm sm:text-base rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              Continue Saved Game
            </button>
          )}

          <button
            type="button"
            onClick={onOpenShowcase}
            className="min-h-[46px] px-5 py-3 bg-[#141822] hover:bg-[#1e2433] border border-[#4a546b] text-[#d9d2c2] font-medium text-sm sm:text-base rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            3D Hero Showcase
          </button>
        </div>

        {/* Concise Scenario Milestones Preview */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 pt-3 border-t border-[#c49a45]/20 text-xs text-[#9e9788] max-w-lg">
          <span>01. Explore Forest</span>
          <span>02. Gather Wood &amp; Gold</span>
          <span>03. Build Barracks</span>
          <span>04. Train 5 Swordsmen</span>
          <span>05. Find Orc Camp</span>
          <span>06. Slay Warchief</span>
        </div>
      </div>

      {/* Single flat control-hint line */}
      <div className="text-xs text-[#8f8879] tracking-wide">
        Desktop: WASD Pan · Drag Select · Right-Click Command · Esc Pause &nbsp;|&nbsp; Mobile: Drag Pan · Pinch Zoom · Tap Select &amp; Command
      </div>
    </div>
  );
};
