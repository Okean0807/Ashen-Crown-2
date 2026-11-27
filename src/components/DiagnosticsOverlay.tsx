import React from 'react';

export interface RuntimeDiagnosticsSnapshot {
  renderer: 'WebGL (Three.js)' | '2D (Canvas fallback)';
  fps: number;
  frameMs: number;
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  devicePixelRatio: number;
  effectiveDpr: number;
  webglState: 'OK (WebGL2)' | 'OK (WebGL1)' | 'CONTEXT LOST' | 'UNAVAILABLE';
  gpuRenderer: string;
  isSoftwareGl: boolean;
  gameObjects: {
    total: number;
    units: number;
    buildings: number;
    projectiles: number;
    particles: number;
    sceneMeshes3D: number | null;
    drawCalls: number | null;
    triangles: number | null;
  };
  errors: string[];
}

interface DiagnosticsOverlayProps {
  data: RuntimeDiagnosticsSnapshot;
  onClose: () => void;
}

export const DiagnosticsOverlay: React.FC<DiagnosticsOverlayProps> = ({ data, onClose }) => {
  const webglBadgeColor =
    data.webglState.startsWith('OK')
      ? data.isSoftwareGl
        ? 'text-[#fbbf24]'
        : 'text-[#4ade80]'
      : 'text-[#f87171]';

  return (
    <aside
      aria-label="Диагностическая панель"
      className="fixed top-[114px] left-2 sm:top-14 sm:left-3 z-50 w-[256px] max-w-[calc(100vw-80px)] bg-[#0c1018]/94 border border-[#c49a45]/60 rounded-lg p-2.5 shadow-2xl text-[11px] leading-snug text-[#eae3d2] select-text"
    >
      <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-[#252c3b]">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#c49a45]">
          Диагностика RC 11.3
        </span>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[32px] px-2.5 py-0.5 bg-[#1b202d] hover:bg-[#262d3f] border border-[#323b4f] rounded text-[11px] font-medium text-[#eae3d2] cursor-pointer"
        >
          Скрыть
        </button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 font-mono-num">
        <dt className="text-[#8e95a6]">Renderer:</dt>
        <dd className="text-right font-semibold text-[#f2ece0] truncate">{data.renderer}</dd>

        <dt className="text-[#8e95a6]">FPS:</dt>
        <dd className="text-right font-semibold text-[#4ade80]">
          {data.fps} ({data.frameMs.toFixed(1)} ms)
        </dd>

        <dt className="text-[#8e95a6]">Экран:</dt>
        <dd className="text-right text-[#eae3d2]">
          {data.viewportWidth}×{data.viewportHeight}
        </dd>

        <dt className="text-[#8e95a6]">Буфер:</dt>
        <dd className="text-right text-[#b8b09f]">
          {data.canvasWidth}×{data.canvasHeight}
        </dd>

        <dt className="text-[#8e95a6]">DPR:</dt>
        <dd className="text-right text-[#eae3d2]">
          {data.devicePixelRatio.toFixed(2)} (рендер {data.effectiveDpr.toFixed(2)})
        </dd>

        <dt className="text-[#8e95a6]">WebGL:</dt>
        <dd className={`text-right font-semibold ${webglBadgeColor}`}>
          {data.webglState}
          {data.isSoftwareGl ? ' · SW' : ''}
        </dd>

        {data.gpuRenderer && (
          <>
            <dt className="text-[#8e95a6]">GPU:</dt>
            <dd className="text-right text-[10px] text-[#b8b09f] truncate" title={data.gpuRenderer}>
              {data.gpuRenderer}
            </dd>
          </>
        )}

        <dt className="text-[#8e95a6]">Объекты:</dt>
        <dd className="text-right text-[#eae3d2] font-semibold">{data.gameObjects.total}</dd>
      </dl>

      <div className="mt-1 pt-1 border-t border-[#1e2432] text-[10px] text-[#9e9788] font-mono-num flex flex-wrap gap-x-2 gap-y-0.5">
        <span>Юн: {data.gameObjects.units}</span>
        <span>Зд: {data.gameObjects.buildings}</span>
        <span>Сн: {data.gameObjects.projectiles}</span>
        <span>Чст: {data.gameObjects.particles}</span>
        {data.gameObjects.drawCalls !== null && (
          <span>DC: {data.gameObjects.drawCalls}</span>
        )}
        {data.gameObjects.triangles !== null && (
          <span>Tri: {data.gameObjects.triangles}</span>
        )}
      </div>

      <div className="mt-1.5 pt-1.5 border-t border-[#1e2432]">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[#8e95a6] mb-0.5">
          Ошибки рендерера ({data.errors.length})
        </div>
        {data.errors.length === 0 ? (
          <div className="text-[10px] text-[#4ade80]">Нет ошибок</div>
        ) : (
          <ul className="max-h-20 overflow-y-auto space-y-0.5 text-[10px] text-[#f87171] break-words">
            {data.errors.map((err, idx) => (
              <li key={idx}>• {err}</li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};
