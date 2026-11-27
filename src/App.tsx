import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlGroupSlot } from './core/fieldCommands';
import type { VerticalSliceSandbox } from './core/sandboxFactory';
import type { FormationType } from './core/types';
import {
  DiagnosticsOverlay,
  type RuntimeDiagnosticsSnapshot,
} from './components/DiagnosticsOverlay';
import { GameHUD } from './components/GameHUD';
import {
  InventoryModal,
  LootChestModal,
  PauseModal,
  VictoryDefeatModal,
} from './components/Overlays';
import { TitleScreen } from './components/TitleScreen';
import { V14VerticalSliceModal } from './components/V14VerticalSliceModal';
import { sound } from './game/audio';
import { GameEngine } from './game/engine';
import { MAP_SIZE, clamp, pinchZoomCamera } from './game/iso';
import { IsoWorldRenderer3D } from './game/isoRenderer3D';
import {
  renderMinimap,
  renderTacticalOverlay,
  renderWorld,
  type RenderState,
} from './game/renderer';
import {
  BuildingType,
  HudSnapshot,
  MobileActionMode,
  ResourceKind,
  UnitType,
} from './game/types';
import { HeroShowcase } from './showcase/HeroShowcase';

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new GameEngine();
  }

  const webglMountRef = useRef<HTMLDivElement | null>(null);
  const renderer3DRef = useRef<IsoWorldRenderer3D | null>(null);
  const use3DRef = useRef<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const desktopMinimapRef = useRef<HTMLCanvasElement | null>(null);
  const mobileMinimapRef = useRef<HTMLCanvasElement | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(() => engineRef.current!.getHudSnapshot());
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  const [v14SliceOpen, setV14SliceOpen] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('diag') === '1' || params.get('diagnostics') === '1';
  });
  const diagnosticsEnabledRef = useRef<boolean>(diagnosticsEnabled);
  diagnosticsEnabledRef.current = diagnosticsEnabled;
  const rendererErrorsRef = useRef<string[]>([]);
  const [diagSnapshot, setDiagSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(null);

  const keysHeldRef = useRef<Set<string>>(new Set());
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const pinchStateRef = useRef<{
    active: boolean;
    prevDist: number;
    prevMidX: number;
    prevMidY: number;
  }>({
    active: false,
    prevDist: 0,
    prevMidX: 0,
    prevMidY: 0,
  });
  const suppressTapAfterPinchRef = useRef(false);

  const dragStateRef = useRef<{
    active: boolean;
    mode: 'none' | 'pan' | 'marquee';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    button: number;
    pointerType: string;
  }>({
    active: false,
    mode: 'none',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    button: 0,
    pointerType: 'mouse',
  });

  const syncHud = useCallback(() => {
    if (engineRef.current) {
      setHud(engineRef.current.getHudSnapshot());
    }
  }, []);

  const handleExternalV14Sync = useCallback(
    (nextSandbox: VerticalSliceSandbox) => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.core.sandbox = JSON.parse(JSON.stringify(nextSandbox));
      engine.syncFromExternalCoreMutation();
      syncHud();
    },
    [syncHud]
  );

  // Mount Three.js 3D Isometric World Renderer (with graceful 2D Canvas fallback)
  useEffect(() => {
    const mount = webglMountRef.current;
    const engine = engineRef.current!;
    if (!mount) return;

    const pushRendererError = (msg: string) => {
      const list = rendererErrorsRef.current;
      if (list[list.length - 1] !== msg) {
        list.push(msg);
        if (list.length > 8) list.shift();
      }
    };

    try {
      const r3d = new IsoWorldRenderer3D(mount, {
        onContextLost: () => {
          use3DRef.current = false;
          engine.core.rendererMode = 'canvas2d';
          pushRendererError('WebGL context lost — выполнен откат на 2D');
        },
      });
      renderer3DRef.current = r3d;
      use3DRef.current = true;
      engine.core.rendererMode = 'webgl3d';
    } catch (err) {
      renderer3DRef.current = null;
      use3DRef.current = false;
      engine.core.rendererMode = 'canvas2d';
      pushRendererError(
        `WebGL недоступен: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return () => {
      if (renderer3DRef.current) {
        renderer3DRef.current.dispose();
        renderer3DRef.current = null;
      }
      use3DRef.current = false;
    };
  }, []);

  // Main 60fps simulation + 3D WebGL + 2D tactical overlay render loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let hudAccum = 0;
    let diagAccum = 0;
    let diagFrames = 0;
    let diagFrameMsSum = 0;

    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const isMobile = window.innerWidth < 820;
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const frame = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.05);

      const engine = engineRef.current!;
      const canvas = canvasRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Continuous WASD / Arrow camera pan
      if (engine.screen === 'PLAYING') {
        const keys = keysHeldRef.current;
        let panX = 0;
        let panY = 0;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) panX -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) panX += 1;
        if (keys.has('KeyW') || keys.has('ArrowUp')) panY -= 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) panY += 1;
        if (panX !== 0 || panY !== 0) {
          const panSpeed = 480 * dt;
          engine.panCameraByScreenDelta(-panX * panSpeed, -panY * panSpeed);
        }
      }

      engine.update(dt, vw, vh);

      const canPlace =
        engine.buildMode && engine.hoverGrid
          ? engine.canPlaceBuildingAt(
              engine.buildMode,
              engine.hoverGrid.gx,
              engine.hoverGrid.gy
            )
          : false;

      const renderState: RenderState = {
        tiles: engine.tiles,
        units: engine.units,
        buildings: engine.buildings,
        projectiles: engine.projectiles,
        particles: engine.particles,
        floatingTexts: engine.floatingTexts,
        selectedUnitIds: engine.selectedUnitIds,
        selectedBuildingId: engine.selectedBuildingId,
        camera: engine.camera,
        time: engine.time,
        buildMode: engine.buildMode,
        hoverGrid: engine.hoverGrid,
        canPlaceBuild: canPlace,
        marquee: marqueeRef.current,
      };

      const r3d = renderer3DRef.current;
      let using3D = Boolean(use3DRef.current && r3d);

      if (using3D && r3d) {
        try {
          r3d.render(renderState, vw, vh);
        } catch (err) {
          use3DRef.current = false;
          using3D = false;
          engine.core.rendererMode = 'canvas2d';
          const msg = `Ошибка WebGL render: ${err instanceof Error ? err.message : String(err)}`;
          if (rendererErrorsRef.current[rendererErrorsRef.current.length - 1] !== msg) {
            rendererErrorsRef.current.push(msg);
            if (rendererErrorsRef.current.length > 8) rendererErrorsRef.current.shift();
          }
        }
      }

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const isMobile = vw < 820;
          const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
          ctx.save();
          ctx.scale(dpr, dpr);
          if (using3D) {
            renderTacticalOverlay(ctx, vw, vh, renderState);
          } else {
            renderWorld(ctx, vw, vh, renderState);
          }
          ctx.restore();
        }
      }

      if (using3D && r3d) {
        r3d.afterDrawSync();
      }

      // Render active minimaps
      const dMini = desktopMinimapRef.current;
      if (dMini && dMini.offsetParent !== null) {
        const mCtx = dMini.getContext('2d');
        if (mCtx) {
          renderMinimap(
            mCtx,
            dMini.width,
            dMini.height,
            engine.tiles,
            engine.units,
            engine.buildings,
            engine.camera,
            vw,
            vh
          );
        }
      }
      const mMini = mobileMinimapRef.current;
      if (mMini && mMini.offsetParent !== null) {
        const mCtx = mMini.getContext('2d');
        if (mCtx) {
          renderMinimap(
            mCtx,
            mMini.width,
            mMini.height,
            engine.tiles,
            engine.units,
            engine.buildings,
            engine.camera,
            vw,
            vh
          );
        }
      }

      hudAccum += dt;
      if (hudAccum >= 0.1) {
        hudAccum = 0;
        setHud(engine.getHudSnapshot());
      }

      if (diagnosticsEnabledRef.current) {
        diagAccum += rawDt;
        diagFrames += 1;
        diagFrameMsSum += rawDt * 1000;
        if (diagAccum >= 0.5) {
          const fps = Math.round(diagFrames / diagAccum);
          const frameMs = diagFrames > 0 ? diagFrameMsSum / diagFrames : 0;
          const isMobile = vw < 820;
          const fallbackDpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
          const info3D = using3D && r3d ? r3d.getDiagnosticInfo() : null;
          const aliveUnits = engine.units.filter((u) => u.hp > 0 && (u.deadTimer ?? 0) <= 0).length;
          const aliveBuildings = engine.buildings.filter((b) => b.hp > 0).length;
          const projCount = engine.projectiles.length;
          const partCount = engine.particles.length;

          setDiagSnapshot({
            renderer: using3D ? 'WebGL (Three.js)' : '2D (Canvas fallback)',
            fps,
            frameMs,
            viewportWidth: vw,
            viewportHeight: vh,
            canvasWidth: canvas?.width ?? 0,
            canvasHeight: canvas?.height ?? 0,
            devicePixelRatio: window.devicePixelRatio || 1,
            effectiveDpr: info3D ? info3D.effectiveDpr : fallbackDpr,
            webglState: info3D ? info3D.webglState : 'UNAVAILABLE',
            gpuRenderer: info3D ? info3D.gpuRenderer : '',
            isSoftwareGl: info3D ? info3D.isSoftwareGl : false,
            gameObjects: {
              total: aliveUnits + aliveBuildings + projCount + partCount,
              units: aliveUnits,
              buildings: aliveBuildings,
              projectiles: projCount,
              particles: partCount,
              sceneMeshes3D: info3D ? info3D.sceneMeshes3D : null,
              drawCalls: info3D ? info3D.drawCalls : null,
              triangles: info3D ? info3D.triangles : null,
            },
            errors: [...rendererErrorsRef.current],
          });

          diagAccum = 0;
          diagFrames = 0;
          diagFrameMsSum = 0;
        }
      } else {
        diagAccum = 0;
        diagFrames = 0;
        diagFrameMsSum = 0;
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Prevent browser page scroll, pinch-zoom, and pull-to-refresh on the game canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preventNativeTouch = (e: TouchEvent) => {
      e.preventDefault();
    };
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };
    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const engine = engineRef.current!;
      if (engine.screen !== 'PLAYING') return;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      engine.zoomWheel(factor, e.clientX, e.clientY);
    };

    canvas.addEventListener('touchstart', preventNativeTouch, { passive: false });
    canvas.addEventListener('touchmove', preventNativeTouch, { passive: false });
    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    canvas.addEventListener('gesturestart', preventGesture);
    canvas.addEventListener('gesturechange', preventGesture);

    return () => {
      canvas.removeEventListener('touchstart', preventNativeTouch);
      canvas.removeEventListener('touchmove', preventNativeTouch);
      canvas.removeEventListener('wheel', handleNativeWheel);
      canvas.removeEventListener('gesturestart', preventGesture);
      canvas.removeEventListener('gesturechange', preventGesture);
    };
  }, []);

  // Keyboard shortcuts + v14.2 Control Groups (Ctrl+1..6 / 1..6), Spells (F/G/X), Back-stack (Esc §348.6)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'F9') {
        e.preventDefault();
        setDiagnosticsEnabled((v) => !v);
        return;
      }
      if (showcaseOpen) {
        if (e.code === 'Escape') {
          setShowcaseOpen(false);
        }
        return;
      }
      if (v14SliceOpen) {
        return;
      }
      keysHeldRef.current.add(e.code);
      const engine = engineRef.current!;

      if (engine.screen === 'PLAYING') {
        if (e.code === 'Escape') {
          if (engine.core.activeLootWindow) {
            engine.closeLootWindow();
            syncHud();
          } else if (inventoryOpen) {
            setInventoryOpen(false);
          } else if (engine.buildMode) {
            engine.buildMode = null;
            syncHud();
          } else {
            engine.screen = 'PAUSED';
            syncHud();
          }
        } else if (
          e.code === 'Digit1' ||
          e.code === 'Digit2' ||
          e.code === 'Digit3' ||
          e.code === 'Digit4' ||
          e.code === 'Digit5' ||
          e.code === 'Digit6'
        ) {
          const slot = Number(e.code.replace('Digit', '')) as ControlGroupSlot;
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            engine.assignControlGroupSlot(slot);
          } else {
            const count = engine.core.fieldSelection.controlGroups[slot].length;
            if (count > 0) {
              engine.recallControlGroupSlot(slot);
            } else if (slot === 1) {
              engine.centerOnHero();
            } else if (slot === 2) {
              engine.selectAllArmy();
            }
          }
          syncHud();
        } else if (e.code === 'Space') {
          e.preventDefault();
          engine.centerOnHero();
          syncHud();
        } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          engine.zoomByStep(0.3, window.innerWidth * 0.5, window.innerHeight * 0.5);
          syncHud();
        } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          engine.zoomByStep(-0.3, window.innerWidth * 0.5, window.innerHeight * 0.5);
          syncHud();
        } else if (e.code === 'KeyR') {
          engine.resetCamera();
          syncHud();
        } else if (e.code === 'KeyQ') {
          engine.triggerHeroCleave();
          syncHud();
        } else if (e.code === 'KeyE') {
          engine.triggerHeroRally();
          syncHud();
        } else if (e.code === 'KeyF') {
          engine.castHeroSpell('spell_elem_fire_bolt');
          syncHud();
        } else if (e.code === 'KeyG') {
          engine.castHeroSpell('spell_life_mend');
          syncHud();
        } else if (e.code === 'KeyX') {
          engine.castHeroSpell('spell_dark_raise_skeleton');
          syncHud();
        } else if (e.code === 'KeyC') {
          engine.castHeroSpell('spell_elem_frost_nova');
          syncHud();
        } else if (e.code === 'KeyV') {
          engine.castHeroSpell('spell_elem_spark');
          syncHud();
        } else if (e.code === 'KeyI') {
          setInventoryOpen((v) => !v);
        }
      } else if (engine.screen === 'PAUSED' && e.code === 'Escape') {
        engine.screen = 'PLAYING';
        syncHud();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.code);
    };

    const onBlur = () => {
      keysHeldRef.current.clear();
      pointersRef.current.clear();
      pinchStateRef.current.active = false;
      dragStateRef.current.active = false;
      marqueeRef.current = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [inventoryOpen, showcaseOpen, v14SliceOpen, syncHud]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    sound.unlock();
    const engine = engineRef.current!;
    if (engine.screen !== 'PLAYING') return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer events without active hardware pointerId
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // Entering two-finger pinch-to-zoom mode
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;

      pinchStateRef.current = {
        active: true,
        prevDist: dist,
        prevMidX: midX,
        prevMidY: midY,
      };
      suppressTapAfterPinchRef.current = true;
      dragStateRef.current.active = false;
      marqueeRef.current = null;
      return;
    }

    if (pointersRef.current.size > 2) return;

    const isMiddleOrAlt = e.button === 1 || (e.button === 0 && e.altKey);
    let mode: 'pan' | 'marquee' = 'marquee';
    if (isMiddleOrAlt) {
      mode = 'pan';
    } else if (e.pointerType === 'touch') {
      mode = engine.mobileMode === 'select_box' ? 'marquee' : 'pan';
    } else if (e.button === 2) {
      mode = 'pan';
    }

    dragStateRef.current = {
      active: true,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      button: e.button,
      pointerType: e.pointerType,
    };

    if (mode === 'marquee' && e.button === 0) {
      marqueeRef.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current!;
    if (engine.screen !== 'PLAYING') return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    engine.updateHover(e.clientX, e.clientY, vw, vh);

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }

    // Two-finger pinch-to-zoom toward the midpoint between fingers
    if (pointersRef.current.size === 2 && pinchStateRef.current.active) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;

      pinchZoomCamera(
        engine.camera,
        pinchStateRef.current.prevMidX,
        pinchStateRef.current.prevMidY,
        midX,
        midY,
        pinchStateRef.current.prevDist,
        dist,
        vw,
        vh
      );
      engine.clampCamera();

      pinchStateRef.current.prevDist = dist;
      pinchStateRef.current.prevMidX = midX;
      pinchStateRef.current.prevMidY = midY;
      return;
    }

    if (suppressTapAfterPinchRef.current) return;

    const drag = dragStateRef.current;
    if (!drag.active) return;

    const tapThreshold = drag.pointerType === 'touch' ? 11 : 6;
    const totalDist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (totalDist > tapThreshold) {
      if (!drag.moved && drag.mode === 'pan') {
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      }
      drag.moved = true;
    }

    if (drag.mode === 'pan' && drag.moved) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      engine.panCameraByScreenDelta(dx, dy);
    } else if (drag.mode === 'marquee' && drag.moved) {
      marqueeRef.current = { x0: drag.startX, y0: drag.startY, x1: e.clientX, y1: e.clientY };
    }

    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current!;
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size < 2) {
      pinchStateRef.current.active = false;
    }

    if (suppressTapAfterPinchRef.current) {
      if (pointersRef.current.size === 0) {
        suppressTapAfterPinchRef.current = false;
      }
      marqueeRef.current = null;
      dragStateRef.current.active = false;
      syncHud();
      return;
    }

    if (engine.screen !== 'PLAYING') {
      marqueeRef.current = null;
      dragStateRef.current.active = false;
      return;
    }

    const drag = dragStateRef.current;
    if (!drag.active) {
      marqueeRef.current = null;
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (drag.button === 2) {
      if (!drag.moved) {
        const mod: 'none' | 'shift' | 'alt' = e.altKey ? 'alt' : e.shiftKey ? 'shift' : 'none';
        engine.handleWorldSecondaryClick(e.clientX, e.clientY, vw, vh, mod);
      }
    } else if (drag.button === 0) {
      if (drag.mode === 'marquee' && drag.moved && marqueeRef.current) {
        engine.handleMarqueeSelect(
          marqueeRef.current.x0,
          marqueeRef.current.y0,
          marqueeRef.current.x1,
          marqueeRef.current.y1,
          vw,
          vh
        );
        if (engine.mobileMode === 'select_box') {
          engine.mobileMode = 'smart';
        }
      } else if (!drag.moved) {
        engine.handleWorldPrimaryClick(e.clientX, e.clientY, vw, vh, e.shiftKey);
      }
    }

    marqueeRef.current = null;
    drag.active = false;
    syncHud();
  };

  const handleMinimapNav = (clientX: number, clientY: number, el: HTMLCanvasElement) => {
    const rect = el.getBoundingClientRect();
    const rx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ry = clamp((clientY - rect.top) / rect.height, 0, 1);
    engineRef.current!.centerCameraOn(rx * MAP_SIZE, ry * MAP_SIZE, true);
  };

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0c131d] touch-none">
      {/* Dedicated Three.js 3D PBR Isometric World Container (never apply CSS backdrop-blur over WebGL) */}
      <div ref={webglMountRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Transparent 2D Tactical Overlay & Input Canvas (falls back to full 2D renderer if WebGL unavailable) */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute inset-0 block w-full h-full touch-none cursor-default"
      />

      {!showcaseOpen && !v14SliceOpen && hud.screen === 'TITLE' && (
        <TitleScreen
          hasSavedGame={hud.hasSavedGame}
          onNewGame={() => {
            sound.unlock();
            sound.click();
            engineRef.current!.initNewWorld(true);
            syncHud();
          }}
          onContinueGame={() => {
            sound.unlock();
            sound.click();
            if (!engineRef.current!.loadGame()) {
              engineRef.current!.initNewWorld(true);
            }
            syncHud();
          }}
          onOpenShowcase={() => {
            sound.unlock();
            sound.click();
            setShowcaseOpen(true);
          }}
          onOpenV14Slice={() => {
            sound.unlock();
            sound.click();
            setV14SliceOpen(true);
          }}
        />
      )}

      {hud.screen === 'PLAYING' && (
        <GameHUD
          hud={hud}
          desktopMinimapRef={desktopMinimapRef}
          mobileMinimapRef={mobileMinimapRef}
          onMinimapNav={handleMinimapNav}
          onSelectHero={() => {
            engineRef.current!.centerOnHero();
            syncHud();
          }}
          onSelectArmy={() => {
            engineRef.current!.selectAllArmy();
            syncHud();
          }}
          onSelectUnitId={(id) => {
            engineRef.current!.selectUnitById(id);
            syncHud();
          }}
          onToggleBuildMode={(bt: BuildingType | null) => {
            engineRef.current!.buildMode = bt;
            sound.click();
            syncHud();
          }}
          onTrainUnit={(bId: string, uType: UnitType) => {
            engineRef.current!.trainUnit(bId, uType);
            syncHud();
          }}
          onRepairBuilding={(bId: string) => {
            engineRef.current!.repairBuilding(bId);
            syncHud();
          }}
          onAssignLaborer={(kind: ResourceKind) => {
            engineRef.current!.assignIdleLaborer(kind);
            syncHud();
          }}
          onCommand={(cmd) => {
            engineRef.current!.issueCommandToSelected(cmd);
            syncHud();
          }}
          onHeroCleave={() => {
            engineRef.current!.triggerHeroCleave();
            syncHud();
          }}
          onHeroRally={() => {
            engineRef.current!.triggerHeroRally();
            syncHud();
          }}
          onCastSpell={(spellId) => {
            engineRef.current!.castHeroSpell(spellId);
            syncHud();
          }}
          onAssignControlGroup={(slot) => {
            engineRef.current!.assignControlGroupSlot(slot);
            syncHud();
          }}
          onRecallControlGroup={(slot) => {
            engineRef.current!.recallControlGroupSlot(slot);
            syncHud();
          }}
          onSetFormation={(formation: FormationType) => {
            engineRef.current!.setFormation(formation);
            syncHud();
          }}
          onOpenInventory={() => {
            sound.click();
            setInventoryOpen(true);
          }}
          onOpenV14Slice={() => {
            sound.click();
            setV14SliceOpen(true);
          }}
          onSetMobileMode={(m: MobileActionMode) => {
            engineRef.current!.mobileMode = m;
            sound.click();
            syncHud();
          }}
          onToggleMute={() => {
            sound.setMuted(!sound.muted);
            syncHud();
          }}
          onSave={() => {
            sound.click();
            engineRef.current!.saveGame();
            syncHud();
          }}
          onPause={() => {
            sound.click();
            engineRef.current!.screen = 'PAUSED';
            syncHud();
          }}
          onZoomIn={() => {
            sound.click();
            engineRef.current!.zoomByStep(
              0.35,
              window.innerWidth * 0.5,
              window.innerHeight * 0.5
            );
            syncHud();
          }}
          onZoomOut={() => {
            sound.click();
            engineRef.current!.zoomByStep(
              -0.35,
              window.innerWidth * 0.5,
              window.innerHeight * 0.5
            );
            syncHud();
          }}
          onResetCamera={() => {
            engineRef.current!.resetCamera();
            syncHud();
          }}
        />
      )}

      {hud.screen === 'PLAYING' && hud.v14Core?.activeLootWindow && (
        <LootChestModal
          lootWindow={hud.v14Core.activeLootWindow}
          onTakeEntry={(entryId) => {
            engineRef.current!.takeLootEntry(entryId);
            syncHud();
          }}
          onTakeAll={() => {
            engineRef.current!.takeAllLoot();
            syncHud();
          }}
          onClose={() => {
            engineRef.current!.closeLootWindow();
            syncHud();
          }}
        />
      )}

      {inventoryOpen && hud.screen === 'PLAYING' && (
        <InventoryModal
          hud={hud}
          onClose={() => setInventoryOpen(false)}
          onEquipCoreItem={(instanceId) => {
            engineRef.current!.equipCoreItem(instanceId);
            syncHud();
          }}
          onUnequipCoreSlot={(slot) => {
            engineRef.current!.unequipCoreSlot(slot);
            syncHud();
          }}
          onTranscribeCoreScroll={(instanceId) => {
            engineRef.current!.transcribeCoreScroll(instanceId);
            syncHud();
          }}
          onOpenV14Slice={() => {
            setInventoryOpen(false);
            setV14SliceOpen(true);
          }}
        />
      )}

      {!showcaseOpen && !v14SliceOpen && hud.screen === 'PAUSED' && (
        <PauseModal
          hasSavedGame={hud.hasSavedGame}
          diagnosticsEnabled={diagnosticsEnabled}
          onToggleDiagnostics={() => {
            sound.click();
            setDiagnosticsEnabled((v) => !v);
          }}
          onResume={() => {
            sound.click();
            engineRef.current!.screen = 'PLAYING';
            syncHud();
          }}
          onSave={() => {
            sound.click();
            const saved = engineRef.current!.saveGame('manual');
            if (saved) {
              engineRef.current!.screen = 'PLAYING';
            }
            syncHud();
          }}
          onLoad={() => {
            sound.click();
            if (engineRef.current!.loadGame('latest')) {
              setInventoryOpen(false);
            }
            syncHud();
          }}
          onOpenShowcase={() => {
            sound.click();
            setShowcaseOpen(true);
          }}
          onOpenV14Slice={() => {
            sound.click();
            setV14SliceOpen(true);
          }}
          onRestart={() => {
            sound.click();
            setInventoryOpen(false);
            engineRef.current!.initNewWorld(true);
            syncHud();
          }}
          onTitle={() => {
            sound.click();
            setInventoryOpen(false);
            engineRef.current!.screen = 'TITLE';
            syncHud();
          }}
        />
      )}

      {(hud.screen === 'VICTORY' || hud.screen === 'DEFEAT') && (
        <VictoryDefeatModal
          hud={hud}
          onRestart={() => {
            sound.click();
            setInventoryOpen(false);
            engineRef.current!.initNewWorld(true);
            syncHud();
          }}
          onTitle={() => {
            sound.click();
            setInventoryOpen(false);
            engineRef.current!.initNewWorld(false);
            syncHud();
          }}
        />
      )}

      {showcaseOpen && (
        <HeroShowcase
          onClose={() => setShowcaseOpen(false)}
          liveHero={engineRef.current!.core.getAvatar()}
          liveCampaign={engineRef.current!.core.sandbox.campaign}
        />
      )}
      {v14SliceOpen && (
        <V14VerticalSliceModal
          onClose={() => setV14SliceOpen(false)}
          externalSandbox={engineRef.current!.core.sandbox}
          onExternalSync={handleExternalV14Sync}
        />
      )}
      {diagnosticsEnabled && diagSnapshot && (
        <DiagnosticsOverlay
          data={diagSnapshot}
          onClose={() => setDiagnosticsEnabled(false)}
        />
      )}
    </main>
  );
}
