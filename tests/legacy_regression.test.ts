import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/game/engine';
import {
  createCamera,
  gridToWorld,
  MAX_ZOOM,
  MIN_ZOOM,
  pinchZoomCamera,
  worldToGrid,
} from '../src/game/iso';

test('Regression: изометрическая математика и pinch-to-zoom сохраняют границы 1x..3x', () => {
  const w = gridToWorld(14, 22, 1);
  const g = worldToGrid(w.wx, w.wy, 1);
  assert.ok(Math.abs(g.gx - 14) < 1e-6);
  assert.ok(Math.abs(g.gy - 22) < 1e-6);

  const cam = createCamera(w.wx, w.wy, 1.5);
  pinchZoomCamera(cam, 200, 300, 210, 310, 100, 300, 800, 600);
  assert.equal(cam.zoom, MAX_ZOOM);

  pinchZoomCamera(cam, 200, 300, 200, 300, 300, 20, 800, 600);
  assert.equal(cam.zoom, MIN_ZOOM);
});

test('Regression: существующий прототип GameEngine (RTS/RPG) инициализируется и обновляется без ошибок', () => {
  const engine = new GameEngine();
  assert.equal(engine.screen, 'TITLE');

  engine.initNewWorld(true);
  assert.equal(engine.screen, 'PLAYING');

  const snap = engine.getHudSnapshot();
  assert.ok(snap.hero);
  assert.ok(engine.units.length >= 1);
  assert.ok(snap.popUsed >= 1);
  assert.equal(snap.objectives.length, 6);

  // Несколько тиков симуляции
  for (let i = 0; i < 5; i++) {
    engine.update(0.03, 1280, 720);
  }
  assert.ok(engine.time > 0);
});
