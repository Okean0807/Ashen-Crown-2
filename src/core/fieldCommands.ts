/**
 * ASHEN CROWN — Контракт команд игрового поля, выделения, 6 групп быстрого выбора,
 * путевых точек/патруля, тумана войны и стека системной навигации Back (§§292.6–292.10, §348.4–348.6).
 *
 * Модуль полностью независим от конкретного 2D/3D-рендерера и готов к подключению
 * к любой визуальной сцене после решения LEGACY-GAP-001 / OD-016.
 */

import { DEFAULT_WORKING_ASSUMPTIONS, type ProvisionalBalanceConfig } from './config';
import type {
  FieldSelectionState,
  FogOfWarGrid,
  FogTileVisibility,
  SquadCommandLayer,
  UiNavigationLayer,
} from './types';

export type ControlGroupSlot = 1 | 2 | 3 | 4 | 5 | 6;

export function createInitialFieldSelectionState(): FieldSelectionState {
  return {
    selectedEntityIds: [],
    focusedEntityId: null,
    controlGroups: {
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    },
  };
}

/**
 * §292.6: Обновление выделения с поддержкой обычного выбора, Shift (добавить/снять),
 * Alt (исключить из группы) и настраиваемого предела maxUnitSelectionCount (100 в эталоне).
 */
export function updateFieldSelection(
  state: FieldSelectionState,
  targetIds: string[],
  mode: 'replace' | 'shift_toggle' | 'alt_remove',
  validAliveIds: Set<string>,
  config: ProvisionalBalanceConfig = DEFAULT_WORKING_ASSUMPTIONS
): { selectedCount: number; truncated: boolean } {
  const cleanTargets = targetIds.filter((id) => validAliveIds.has(id));
  let next = state.selectedEntityIds.filter((id) => validAliveIds.has(id));

  if (mode === 'replace') {
    next = Array.from(new Set(cleanTargets));
  } else if (mode === 'shift_toggle') {
    const set = new Set(next);
    for (const id of cleanTargets) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    next = Array.from(set);
  } else if (mode === 'alt_remove') {
    const removeSet = new Set(cleanTargets);
    next = next.filter((id) => !removeSet.has(id));
  }

  let truncated = false;
  if (next.length > config.maxUnitSelectionCount) {
    next = next.slice(0, config.maxUnitSelectionCount);
    truncated = true;
  }

  state.selectedEntityIds = next;
  if (!state.focusedEntityId || !next.includes(state.focusedEntityId)) {
    state.focusedEntityId = next[0] ?? null;
  }

  return { selectedCount: next.length, truncated };
}

/**
 * §292.6: Выбор одного портрета внутри группы без разрушения самой группы.
 */
export function focusPortraitWithinSelection(
  state: FieldSelectionState,
  entityId: string
): boolean {
  if (!state.selectedEntityIds.includes(entityId)) return false;
  state.focusedEntityId = entityId;
  return true;
}

/**
 * §292.7: Назначение одной из 6 групп быстрого выбора (Ctrl + 1..6).
 */
export function assignControlGroup(
  state: FieldSelectionState,
  slot: ControlGroupSlot,
  validAliveIds: Set<string>
): { ok: boolean; count: number } {
  const alive = state.selectedEntityIds.filter((id) => validAliveIds.has(id));
  state.controlGroups[slot] = [...alive];
  return { ok: true, count: alive.length };
}

/**
 * §292.7: Повторный выбор группы клавишей 1..6 или кнопкой портрета (отсеивает погибших).
 */
export function recallControlGroup(
  state: FieldSelectionState,
  slot: ControlGroupSlot,
  validAliveIds: Set<string>
): { ok: boolean; selectedIds: string[] } {
  const alive = state.controlGroups[slot].filter((id) => validAliveIds.has(id));
  state.controlGroups[slot] = alive;
  state.selectedEntityIds = [...alive];
  state.focusedEntityId = alive[0] ?? null;
  return { ok: alive.length > 0, selectedIds: alive };
}

/**
 * §292.10 (SPELLFORCE BASE — CONFIRMED):
 * Кнопка формаций доступна только при выделении >= 2 юнитов и НЕДОСТУПНА при выделении Аватара в группе.
 */
export function canUseFormationButton(
  selectedEntityIds: string[],
  avatarId: string
): { allowed: boolean; reasonRu?: string } {
  if (selectedEntityIds.length < 2) {
    return { allowed: false, reasonRu: 'Для формации требуется минимум 2 выбранных отряда/бойца.' };
  }
  if (selectedEntityIds.includes(avatarId)) {
    return {
      allowed: false,
      reasonRu: 'Кнопка формаций недоступна, если в группе выделен Аватар (§292.10).',
    };
  }
  return { allowed: true };
}

/**
 * §292.8: Команда движения с последовательностью путевых отметок (Shift + ПКМ)
 * или Attack-Move (Ctrl + ПКМ), без слияния в один безликий Move.
 */
export function setSquadWaypointOrder(
  layer: SquadCommandLayer,
  order: 'MoveTo' | 'AttackMove',
  point: { x: number; y: number },
  appendShiftWaypoint: boolean
): void {
  layer.playerOrder = order;
  layer.isPatrolLoop = false;
  layer.localReaction = 'None';
  layer.reactionTargetEntityId = undefined;

  if (appendShiftWaypoint && layer.waypointQueue && layer.waypointQueue.length > 0) {
    layer.waypointQueue.push({ x: point.x, y: point.y });
  } else {
    layer.waypointQueue = [{ x: point.x, y: point.y }];
  }
  layer.orderTargetPos = { ...layer.waypointQueue[0] };
}

/**
 * §292.8: Установка замкнутого маршрута патрулирования (Alt + ПКМ).
 */
export function setSquadPatrolRoute(
  layer: SquadCommandLayer,
  points: Array<{ x: number; y: number }>
): { ok: boolean; reason?: string } {
  if (points.length < 2) {
    return { ok: false, reason: 'Для маршрута патрулирования требуется минимум 2 точки (§292.8).' };
  }
  layer.playerOrder = 'Patrol';
  layer.isPatrolLoop = true;
  layer.waypointQueue = points.map((p) => ({ x: p.x, y: p.y }));
  layer.orderTargetPos = { ...layer.waypointQueue[0] };
  layer.localReaction = 'None';
  return { ok: true };
}

/**
 * §292.8: Продвижение к следующей путевой отметке (для Patrol — циклическое, для MoveTo/AttackMove — с удалением пройденной).
 */
export function advanceSquadWaypoint(
  layer: SquadCommandLayer
): { completedRoute: boolean; nextTargetPos?: { x: number; y: number } } {
  if (!layer.waypointQueue || layer.waypointQueue.length === 0) {
    layer.orderTargetPos = undefined;
    return { completedRoute: true };
  }

  if (layer.isPatrolLoop && layer.playerOrder === 'Patrol') {
    const reached = layer.waypointQueue.shift()!;
    layer.waypointQueue.push(reached);
    layer.orderTargetPos = { ...layer.waypointQueue[0] };
    return { completedRoute: false, nextTargetPos: layer.orderTargetPos };
  }

  layer.waypointQueue.shift();
  if (layer.waypointQueue.length === 0) {
    layer.orderTargetPos = undefined;
    layer.playerOrder = 'Idle';
    return { completedRoute: true };
  }

  layer.orderTargetPos = { ...layer.waypointQueue[0] };
  return { completedRoute: false, nextTargetPos: layer.orderTargetPos };
}

export function clearSquadWaypoints(layer: SquadCommandLayer): void {
  layer.waypointQueue = [];
  layer.isPatrolLoop = false;
  layer.orderTargetPos = undefined;
}

/**
 * §292.9 (SPELLFORCE BASE — CONFIRMED):
 * Трёхсостоянийная модель тумана войны (Unexplored -> Visible -> ExploredShrouded).
 * Ранее исследованная область никогда не откатывается обратно в Unexplored.
 */
export function createFogOfWarGrid(width: number, height: number): FogOfWarGrid {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));
  return {
    width: safeW,
    height: safeH,
    tiles: Array<FogTileVisibility>(safeW * safeH).fill('Unexplored'),
  };
}

export function getFogTileState(grid: FogOfWarGrid, x: number, y: number): FogTileVisibility {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'Unexplored';
  return grid.tiles[y * grid.width + x];
}

export function updateFogOfWarVisibility(
  grid: FogOfWarGrid,
  observers: Array<{ x: number; y: number; visionRadius: number }>
): { visibleCount: number; exploredCount: number } {
  // 1. Все ранее видимые тайлы переходят в ExploredShrouded (не в Unexplored!)
  for (let i = 0; i < grid.tiles.length; i++) {
    if (grid.tiles[i] === 'Visible') {
      grid.tiles[i] = 'ExploredShrouded';
    }
  }

  // 2. Тайлы в радиусе обзора Аватара или дружественных юнитов становятся Visible
  for (const obs of observers) {
    const r = Math.max(0, obs.visionRadius);
    const rSq = r * r;
    const minX = Math.max(0, Math.floor(obs.x - r));
    const maxX = Math.min(grid.width - 1, Math.ceil(obs.x + r));
    const minY = Math.max(0, Math.floor(obs.y - r));
    const maxY = Math.min(grid.height - 1, Math.ceil(obs.y + r));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - obs.x;
        const dy = y - obs.y;
        if (dx * dx + dy * dy <= rSq) {
          grid.tiles[y * grid.width + x] = 'Visible';
        }
      }
    }
  }

  let visibleCount = 0;
  let exploredCount = 0;
  for (const t of grid.tiles) {
    if (t === 'Visible') {
      visibleCount += 1;
      exploredCount += 1;
    } else if (t === 'ExploredShrouded') {
      exploredCount += 1;
    }
  }
  return { visibleCount, exploredCount };
}

/**
 * §348.4 & §348.6: Детерминированный стек слоёв системной навигации (Android Back / Escape).
 * Всегда закрывает или отменяет только самый верхний безопасный слой без подтверждения деструктивного действия.
 */
export function pushUiNavigationLayer(
  stack: UiNavigationLayer[],
  layer: UiNavigationLayer
): UiNavigationLayer[] {
  const filtered = stack.filter((l) => l.layerId !== layer.layerId);
  return [...filtered, layer];
}

export function handleSystemBackNavigation(stack: UiNavigationLayer[]): {
  nextStack: UiNavigationLayer[];
  cancelledLayer: UiNavigationLayer | null;
  confirmedDestructiveAction: false;
} {
  if (stack.length === 0) {
    return { nextStack: [], cancelledLayer: null, confirmedDestructiveAction: false };
  }
  const nextStack = stack.slice(0, -1);
  const cancelledLayer = stack[stack.length - 1];
  return {
    nextStack,
    cancelledLayer,
    confirmedDestructiveAction: false,
  };
}

export function areWorldCommandsBlockedByUiStack(stack: UiNavigationLayer[]): boolean {
  return stack.some((l) => l.blocksWorldCommands);
}
