import React, { useEffect } from 'react';

interface TitleScreenProps {
  hasSavedGame: boolean;
  onNewGame: () => void;
  onContinueGame: () => void;
  onOpenShowcase: () => void;
  onOpenV14Slice: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  hasSavedGame,
  onNewGame,
  onContinueGame,
  onOpenShowcase,
  onOpenV14Slice,
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
    <div className="absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-r from-[#0a0d14]/94 via-[#0a0d14]/76 to-[#0a0d14]/22 p-6 sm:p-12">
      <div className="max-w-xl my-auto flex flex-col gap-6">
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
              <p className="text-xs tracking-[0.2em] uppercase text-[#c49a45] font-semibold">
                Сектор I · Первое поселение · Ядро v14.2
              </p>
              <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-wide text-[#f2ece0] leading-none mt-1">
                ASHEN CROWN
              </h1>
            </div>
          </div>

          <p className="text-sm sm:text-base text-[#c5beae] leading-relaxed max-w-lg mt-2">
            Возглавьте Аватара в пограничном секторе: разведайте лесные руины, развивайте
            поселение, применяйте школы магии без боевых зелий и сокрушите вражеский гарнизон за
            рекой.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onNewGame}
            className="min-h-[46px] px-7 py-3 bg-[#c49a45] hover:bg-[#d6ac56] active:scale-[0.98] text-[#101218] font-semibold text-sm sm:text-base rounded-md transition-all cursor-pointer shadow-lg whitespace-nowrap"
          >
            Начать кампанию
          </button>

          {hasSavedGame && (
            <button
              type="button"
              onClick={onContinueGame}
              className="min-h-[46px] px-6 py-3 bg-[#191d27] hover:bg-[#232938] border border-[#c49a45]/45 text-[#eae3d2] font-medium text-sm sm:text-base rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              Продолжить игру
            </button>
          )}

          <button
            type="button"
            onClick={onOpenShowcase}
            className="min-h-[46px] px-5 py-3 bg-[#141822] hover:bg-[#1e2433] border border-[#4a546b] text-[#d9d2c2] font-medium text-sm sm:text-base rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            3D Витрина героя
          </button>

          <button
            type="button"
            onClick={onOpenV14Slice}
            className="min-h-[46px] px-5 py-3 bg-[#141822] hover:bg-[#1e2433] border border-[#c49a45]/45 text-[#f2ece0] font-medium text-sm sm:text-base rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            Системы v14.2
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 pt-3 border-t border-[#c49a45]/20 text-xs text-[#9e9788] max-w-lg">
          <span>01. Разведать сектор</span>
          <span>02. Добыть дерево и руду</span>
          <span>03. Построить Казармы</span>
          <span>04. Нанять 5 мечников</span>
          <span>05. Найти лагерь врага</span>
          <span>06. Повергнуть командира</span>
        </div>
      </div>

      <div className="text-xs text-[#8f8879] tracking-wide">
        ПК: WASD камера · ЛКМ выделение · ПКМ приказ (Shift точка / Alt патруль) · F/G/X магия · Ctrl+1–6 группы &nbsp;|&nbsp; Моб.: Перетаскивание · Пинч-зум · Тап
      </div>
    </div>
  );
};
