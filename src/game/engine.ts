import { sound } from './audio';
import {
  Camera,
  DEFAULT_ZOOM,
  MAP_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_H,
  clamp,
  computeFormationOffsets,
  createCamera,
  distGrid,
  gridToWorld,
  screenToWorld,
  worldToGrid,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from './iso';
import { createBuilding, createUnit, generateScenarioWorld } from './mapGen';
import {
  BUILDING_BLUEPRINTS,
  Building,
  BuildingType,
  EquipSlot,
  FloatingText,
  GameScreen,
  HudSnapshot,
  ITEM_CATALOG,
  ItemDef,
  MobileActionMode,
  ObjectiveState,
  Particle,
  Projectile,
  ResourceKind,
  Resources,
  ScenarioStats,
  Tile,
  UNIT_BLUEPRINTS,
  Unit,
  UnitType,
} from './types';

const SAVE_KEY = 'ashen_crown_save_v1';

interface Point {
  x: number;
  y: number;
}

export class GameEngine {
  public screen: GameScreen = 'TITLE';
  public tiles: Tile[][] = [];
  public units: Unit[] = [];
  public buildings: Building[] = [];
  public projectiles: Projectile[] = [];
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];

  public resources: Resources = { gold: 130, wood: 110, stone: 60 };
  public selectedUnitIds: Set<string> = new Set();
  public selectedBuildingId: string | null = null;

  public equipment: Record<EquipSlot, ItemDef | null> = {
    weapon: ITEM_CATALOG.iron_blade,
    armor: null,
    relic: null,
  };
  public inventory: ItemDef[] = [ITEM_CATALOG.healing_draught];

  public stats: ScenarioStats = {
    elapsedSec: 0,
    exploredCount: 0,
    gatheredWood: 0,
    gatheredGold: 0,
    gatheredStone: 0,
    barracksBuilt: false,
    swordsmenRecruited: 0,
    orcCampDiscovered: false,
    commanderDefeated: false,
    orcsSlain: 0,
    buildingsConstructed: 0,
    nextRaidTimer: 70,
    raidCount: 0,
  };

  public camera: Camera = createCamera(0, 0, DEFAULT_ZOOM);
  public time = 0;
  public hitstopTimer = 0;
  public buildMode: BuildingType | null = null;
  public mobileMode: MobileActionMode = 'smart';
  public hoverGrid: { gx: number; gy: number } | null = null;
  public bannerMessage: string | null = null;
  private bannerTimer = 0;

  private unitPaths: Map<string, Point[]> = new Map();
  private idCounter = 100;
  private autoSaveTimer = 0;
  private titlePanAngle = 0;

  constructor() {
    this.initNewWorld(false);
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter}`;
  }

  public hasSavedGame(): boolean {
    try {
      return Boolean(localStorage.getItem(SAVE_KEY));
    } catch {
      return false;
    }
  }

  public initNewWorld(startPlaying: boolean) {
    const world = generateScenarioWorld();
    this.tiles = world.tiles;
    this.units = world.units;
    this.buildings = world.buildings;
    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.unitPaths.clear();

    this.resources = { gold: 130, wood: 110, stone: 60 };
    this.selectedUnitIds = new Set(['u_hero']);
    this.selectedBuildingId = null;
    this.equipment = {
      weapon: ITEM_CATALOG.iron_blade,
      armor: null,
      relic: null,
    };
    this.inventory = [ITEM_CATALOG.healing_draught];

    this.stats = {
      elapsedSec: 0,
      exploredCount: 0,
      gatheredWood: 0,
      gatheredGold: 0,
      gatheredStone: 0,
      barracksBuilt: false,
      swordsmenRecruited: 1, // Starting with 1 swordsman counts? Wait: objective says "Recruit five swordsmen" -> let's count recruited or total swordsmen! Let's track newly recruited OR total swordsmen >= 5. Actually starting with 0 recruited and counting each trained swordsman (or let's set starting swordsman to 0 recruited so player recruits 5, OR count total swordsmen owned up to 5 - 1 = 4 more!). Even cleaner: start with 1 Swordsman and count `swordsmenRecruited` for each newly trained Swordsman OR total Swordsmen owned! Let's count each recruited Swordsman, and show `0/5` cleanly.
      orcCampDiscovered: false,
      commanderDefeated: false,
      orcsSlain: 0,
      buildingsConstructed: 0,
      nextRaidTimer: 72,
      raidCount: 0,
    };
    this.stats.swordsmenRecruited = 0;

    this.buildMode = null;
    this.mobileMode = 'smart';
    this.hitstopTimer = 0;

    // Focus camera on Human settlement
    const focus = gridToWorld(10, 30, 1);
    this.camera = createCamera(focus.wx, focus.wy, DEFAULT_ZOOM);
    this.updateFogOfWar();

    if (startPlaying) {
      this.screen = 'PLAYING';
      this.showBanner('The First Settlement — Explore the forest & gather resources');
    } else {
      this.screen = 'TITLE';
    }
  }

  public showBanner(msg: string, duration = 4.2) {
    this.bannerMessage = msg;
    this.bannerTimer = duration;
  }

  public saveGame(): boolean {
    try {
      const payload = {
        resources: this.resources,
        stats: this.stats,
        equipment: this.equipment,
        inventory: this.inventory,
        units: this.units,
        buildings: this.buildings,
        camera: this.camera,
        tileUpdates: this.tiles.flatMap((row) =>
          row
            .filter((t) => t.fog > 0 || t.chestLooted || t.resourceAmount !== t.maxResource)
            .map((t) => ({
              gx: t.gx,
              gy: t.gy,
              fog: t.fog,
              chestLooted: t.chestLooted,
              resourceAmount: t.resourceAmount,
              prop: t.prop,
              walkable: t.walkable,
            }))
        ),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      this.showBanner('Campaign saved');
      return true;
    } catch {
      return false;
    }
  }

  public loadGame(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const fresh = generateScenarioWorld();
      this.tiles = fresh.tiles;
      if (Array.isArray(data.tileUpdates)) {
        for (const tu of data.tileUpdates) {
          const tile = this.tiles[tu.gy]?.[tu.gx];
          if (tile) {
            tile.fog = tu.fog;
            tile.chestLooted = tu.chestLooted;
            tile.resourceAmount = tu.resourceAmount;
            tile.prop = tu.prop;
            tile.walkable = tu.walkable;
          }
        }
      }
      this.resources = data.resources ?? this.resources;
      this.stats = data.stats ?? this.stats;
      this.equipment = data.equipment ?? this.equipment;
      this.inventory = data.inventory ?? this.inventory;
      this.units = data.units ?? fresh.units;
      this.buildings = data.buildings ?? fresh.buildings;
      const loadedCam = data.camera;
      this.camera = loadedCam
        ? createCamera(loadedCam.x ?? 0, loadedCam.y ?? 0, loadedCam.zoom ?? DEFAULT_ZOOM)
        : this.camera;
      this.clampCamera();
      this.projectiles = [];
      this.particles = [];
      this.floatingTexts = [];
      this.unitPaths.clear();
      this.selectedUnitIds = new Set(['u_hero']);
      this.selectedBuildingId = null;
      this.buildMode = null;
      this.screen = 'PLAYING';
      this.updateFogOfWar();
      this.showBanner('Campaign resumed');
      return true;
    } catch {
      return false;
    }
  }

  public getHero(): Unit | null {
    return this.units.find((u) => u.type === 'hero') ?? null;
  }

  public getPopCounts(): { used: number; cap: number } {
    const used = this.units.filter((u) => u.faction === 'human' && (!u.deadTimer || u.deadTimer <= 0)).length;
    let cap = 0;
    for (const b of this.buildings) {
      if (b.faction === 'human' && b.constructed) {
        const bp = BUILDING_BLUEPRINTS[b.type];
        if (bp?.popBonus) cap += bp.popBonus;
      }
    }
    return { used, cap: Math.max(8, cap) };
  }

  public getUnitEffectiveStats(u: Unit): { atk: number; armor: number; maxHp: number } {
    if (u.type !== 'hero') {
      return { atk: u.baseAtk, armor: u.baseArmor, maxHp: u.maxHp };
    }
    const lvl = u.level ?? 1;
    let atk = u.baseAtk + (lvl - 1) * 4;
    let armor = u.baseArmor + (lvl - 1) * 1;
    let maxHp = UNIT_BLUEPRINTS.hero.maxHp + (lvl - 1) * 45;
    for (const slot of ['weapon', 'armor', 'relic'] as EquipSlot[]) {
      const item = this.equipment[slot];
      if (item) {
        atk += item.bonusAtk ?? 0;
        armor += item.bonusArmor ?? 0;
        maxHp += item.bonusHp ?? 0;
      }
    }
    return { atk, armor, maxHp };
  }

  public equipOrUseItem(index: number) {
    const item = this.inventory[index];
    const hero = this.getHero();
    if (!item || !hero || (hero.deadTimer && hero.deadTimer > 0)) return;

    if (item.slot === 'consumable') {
      const stats = this.getUnitEffectiveStats(hero);
      hero.maxHp = stats.maxHp;
      hero.hp = Math.min(hero.maxHp, hero.hp + (item.healAmount ?? 100));
      this.inventory.splice(index, 1);
      sound.gather();
      this.spawnParticles(hero.x, hero.y, 12, '#4ade80', 'magic', 8);
      this.addFloatingText(hero.x, hero.y, `+${item.healAmount ?? 100} HP`, '#4ade80');
      return;
    }

    const slot = item.slot;
    const previous = this.equipment[slot];
    this.equipment[slot] = item;
    this.inventory.splice(index, 1);
    if (previous) {
      this.inventory.push(previous);
    }
    const updated = this.getUnitEffectiveStats(hero);
    const hpDiff = updated.maxHp - hero.maxHp;
    hero.maxHp = updated.maxHp;
    if (hpDiff > 0) hero.hp = Math.min(hero.maxHp, hero.hp + hpDiff);
    else hero.hp = Math.min(hero.maxHp, hero.hp);
    sound.click();
    this.addFloatingText(hero.x, hero.y, `Equipped ${item.name}`, '#facc15');
  }

  public triggerHeroCleave() {
    const hero = this.getHero();
    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) return;
    if ((hero.cleaveCooldown ?? 0) > 0) return;

    const eff = this.getUnitEffectiveStats(hero);
    const dmg = Math.round(eff.atk * 2.2);
    hero.cleaveCooldown = 8;
    hero.attackAnimTimer = 0.25;
    this.camera.shake = Math.max(this.camera.shake, 7);
    this.hitstopTimer = 0.045;
    sound.heavyHit();

    this.particles.push({
      x: hero.x,
      y: hero.y,
      z: 6,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.4,
      maxLife: 0.4,
      size: 26,
      color: '#f97316',
      kind: 'ring',
    });
    this.spawnParticles(hero.x, hero.y, 16, '#fb923c', 'spark', 10);

    for (const e of [...this.units]) {
      if (e.faction === 'orc' && distGrid(hero.x, hero.y, e.x, e.y) <= 2.7) {
        this.damageUnit(e, dmg, hero);
      }
    }
    for (const b of [...this.buildings]) {
      if (b.faction === 'orc' && distGrid(hero.x, hero.y, b.gx + b.size * 0.5, b.gy + b.size * 0.5) <= 2.9) {
        this.damageBuilding(b, dmg);
      }
    }
  }

  public triggerHeroRally() {
    const hero = this.getHero();
    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) return;
    if ((hero.rallyCooldown ?? 0) > 0) return;

    hero.rallyCooldown = 14;
    sound.levelUp();
    this.particles.push({
      x: hero.x,
      y: hero.y,
      z: 6,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.5,
      maxLife: 0.5,
      size: 32,
      color: '#facc15',
      kind: 'ring',
    });

    for (const u of this.units) {
      if (u.faction === 'human' && (!u.deadTimer || u.deadTimer <= 0)) {
        if (distGrid(hero.x, hero.y, u.x, u.y) <= 4.8) {
          const heal = 50;
          u.hp = Math.min(u.maxHp, u.hp + heal);
          this.addFloatingText(u.x, u.y, `+${heal}`, '#4ade80');
        }
      }
    }
  }

  public centerCameraOn(gx: number, gy: number, instant = true) {
    const { wx, wy } = gridToWorld(gx, gy, 1);
    this.camera.focalX = null;
    this.camera.focalY = null;
    this.camera.targetX = wx;
    this.camera.targetY = wy;
    if (instant) {
      this.camera.x = wx;
      this.camera.y = wy;
    }
    this.clampCamera();
  }

  public panCameraByScreenDelta(dxScreen: number, dyScreen: number) {
    const dxWorld = dxScreen / this.camera.zoom;
    const dyWorld = dyScreen / this.camera.zoom;
    this.camera.focalX = null;
    this.camera.focalY = null;
    this.camera.x -= dxWorld;
    this.camera.y -= dyWorld;
    this.camera.targetX = this.camera.x;
    this.camera.targetY = this.camera.y;
    this.clampCamera();
  }

  public zoomByStep(deltaZoom: number, focalX: number, focalY: number) {
    this.camera.targetZoom = clamp(this.camera.targetZoom + deltaZoom, MIN_ZOOM, MAX_ZOOM);
    this.camera.focalX = focalX;
    this.camera.focalY = focalY;
  }

  public zoomWheel(factor: number, focalX: number, focalY: number) {
    this.camera.targetZoom = clamp(this.camera.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.camera.focalX = focalX;
    this.camera.focalY = focalY;
  }

  public resetCamera() {
    this.camera.focalX = null;
    this.camera.focalY = null;
    this.camera.targetZoom = DEFAULT_ZOOM;

    const selected = this.getSelectedHumanUnits();
    const targetUnit = selected[0] ?? this.getHero();
    if (targetUnit && (!targetUnit.deadTimer || targetUnit.deadTimer <= 0)) {
      const { wx, wy } = gridToWorld(targetUnit.x, targetUnit.y, 1);
      this.camera.targetX = wx;
      this.camera.targetY = wy;
    } else {
      const th = this.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall');
      const focus = th ? gridToWorld(th.gx + 1, th.gy + 1, 1) : gridToWorld(10, 30, 1);
      this.camera.targetX = focus.wx;
      this.camera.targetY = focus.wy;
    }
    this.clampCamera();
    sound.click();
  }

  public centerOnHero() {
    const hero = this.getHero();
    if (hero) {
      this.selectedUnitIds = new Set([hero.id]);
      this.selectedBuildingId = null;
      this.centerCameraOn(hero.x, hero.y, false);
      sound.click();
    }
  }

  public selectAllArmy() {
    const combatUnits = this.units.filter(
      (u) =>
        u.faction === 'human' &&
        (!u.deadTimer || u.deadTimer <= 0) &&
        (u.type === 'hero' || u.type === 'swordsman' || u.type === 'archer')
    );
    if (combatUnits.length > 0) {
      this.selectedUnitIds = new Set(combatUnits.map((u) => u.id));
      this.selectedBuildingId = null;
      sound.click();
    }
  }

  public selectUnitById(id: string) {
    this.selectedUnitIds = new Set([id]);
    this.selectedBuildingId = null;
    sound.click();
  }

  public canAfford(cost: Resources): boolean {
    return (
      this.resources.gold >= cost.gold &&
      this.resources.wood >= cost.wood &&
      this.resources.stone >= cost.stone
    );
  }

  private spend(cost: Resources) {
    this.resources.gold -= cost.gold;
    this.resources.wood -= cost.wood;
    this.resources.stone -= cost.stone;
  }

  public canPlaceBuildingAt(type: BuildingType, gx: number, gy: number): boolean {
    const bp = BUILDING_BLUEPRINTS[type];
    if (!bp || !this.canAfford(bp.cost)) return false;

    for (let dy = 0; dy < bp.size; dy++) {
      for (let dx = 0; dx < bp.size; dx++) {
        const tx = gx + dx;
        const ty = gy + dy;
        const t = this.tiles[ty]?.[tx];
        if (!t || !t.walkable || t.fog === 0 || t.terrain === 'bridge' || t.prop) {
          return false;
        }
        // Must not overlap existing buildings
        for (const b of this.buildings) {
          if (tx >= b.gx && tx < b.gx + b.size && ty >= b.gy && ty < b.gy + b.size) {
            return false;
          }
        }
      }
    }
    return true;
  }

  public placeBuilding(type: BuildingType, gx: number, gy: number): boolean {
    const bp = BUILDING_BLUEPRINTS[type];
    if (!bp) return false;
    if (!this.canAfford(bp.cost)) {
      this.showBanner('Not enough resources');
      return false;
    }
    if (!this.canPlaceBuildingAt(type, gx, gy)) {
      this.showBanner('Cannot build on blocked or unexplored terrain');
      return false;
    }

    this.spend(bp.cost);
    const b = createBuilding(this.nextId('b'), 'human', type, gx, gy, false);
    this.buildings.push(b);

    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const t = this.tiles[gy + dy]?.[gx + dx];
        if (t) t.walkable = false;
      }
    }

    // Push any overlapping units out slightly
    for (const u of this.units) {
      if (u.x >= gx - 0.3 && u.x <= gx + b.size + 0.3 && u.y >= gy - 0.3 && u.y <= gy + b.size + 0.3) {
        u.x = Math.max(1, gx - 0.8);
      }
    }

    this.buildMode = null;
    this.selectedBuildingId = b.id;
    this.selectedUnitIds.clear();
    sound.buildPlace();
    this.spawnParticles(gx + b.size * 0.5, gy + b.size * 0.5, 14, '#d6d3d1', 'smoke', 10);
    this.updateFogOfWar();
    return true;
  }

  public trainUnit(buildingId: string, unitType: UnitType): boolean {
    const b = this.buildings.find((item) => item.id === buildingId);
    if (!b || !b.constructed || b.faction !== 'human') return false;
    const bp = UNIT_BLUEPRINTS[unitType];
    if (!bp) return false;

    const pop = this.getPopCounts();
    const queuedCount = this.buildings
      .filter((item) => item.faction === 'human')
      .reduce((acc, item) => acc + item.queue.length, 0);
    if (pop.used + queuedCount >= pop.cap) {
      this.showBanner('Population cap reached — build a Farmstead');
      return false;
    }
    if (!this.canAfford(bp.cost)) {
      this.showBanner('Not enough resources to recruit');
      return false;
    }
    if (b.queue.length >= 5) return false;

    this.spend(bp.cost);
    b.queue.push({ unitType, remaining: bp.trainTime, total: bp.trainTime });
    sound.click();
    return true;
  }

  public assignIdleLaborer(kind: ResourceKind) {
    const idleLab =
      this.units.find(
        (u) => u.faction === 'human' && u.type === 'laborer' && u.order === 'idle'
      ) ?? this.units.find((u) => u.faction === 'human' && u.type === 'laborer');

    if (!idleLab) {
      this.showBanner('No Laborers available — train one at the Town Hall');
      return;
    }

    const node = this.findNearestResource(idleLab.x, idleLab.y, kind, 40);
    if (!node) {
      this.showBanner(`No ${kind} nodes discovered nearby`);
      return;
    }

    idleLab.order = 'gather';
    idleLab.gatherGx = node.gx;
    idleLab.gatherGy = node.gy;
    idleLab.carryingKind = undefined;
    idleLab.carryingAmount = 0;
    this.assignPathTo(idleLab, node.gx + 0.5, node.gy + 0.5, true);
    this.selectedUnitIds = new Set([idleLab.id]);
    this.selectedBuildingId = null;
    sound.command();
    this.addFloatingText(node.gx + 0.5, node.gy + 0.5, `Gather ${kind}`, '#facc15');
  }

  public issueCommandToSelected(cmd: 'stop' | 'follow_hero' | 'attack_move_forward') {
    const selected = this.getSelectedHumanUnits();
    if (selected.length === 0) return;

    if (cmd === 'stop') {
      for (const u of selected) {
        u.order = 'idle';
        u.targetUnitId = undefined;
        u.targetBuildingId = undefined;
        this.unitPaths.delete(u.id);
      }
      sound.command();
    } else if (cmd === 'follow_hero') {
      for (const u of selected) {
        if (u.type === 'hero') continue;
        u.order = 'follow_hero';
        u.targetUnitId = undefined;
        u.targetBuildingId = undefined;
      }
      sound.command();
      this.showBanner('Units following Aldric', 2.2);
    } else if (cmd === 'attack_move_forward') {
      this.issueMoveOrAttackPoint(31, 11, true);
    }
  }

  public getSelectedHumanUnits(): Unit[] {
    return this.units.filter(
      (u) => u.faction === 'human' && this.selectedUnitIds.has(u.id) && (!u.deadTimer || u.deadTimer <= 0)
    );
  }

  public handleWorldPrimaryClick(
    sx: number,
    sy: number,
    vw: number,
    vh: number,
    shiftHeld: boolean
  ) {
    const { wx, wy } = screenToWorld(sx, sy, this.camera, vw, vh);
    const { gx, gy } = worldToGrid(wx, wy, 1);
    const igx = Math.floor(gx);
    const igy = Math.floor(gy);

    if (this.buildMode) {
      this.placeBuilding(this.buildMode, igx, igy);
      return;
    }

    // Mobile explicit action modes when units are already selected
    const currentSelected = this.getSelectedHumanUnits();
    if (currentSelected.length > 0 && (this.mobileMode === 'move' || this.mobileMode === 'attack')) {
      const clickedEnemy = this.findUnitAtScreen(sx, sy, vw, vh, 'orc');
      const clickedEnemyBld = this.findBuildingAtGrid(igx, igy, 'orc');
      if (clickedEnemy) {
        this.issueAttackUnit(clickedEnemy.id);
        this.mobileMode = 'smart';
        return;
      }
      if (clickedEnemyBld) {
        this.issueAttackBuilding(clickedEnemyBld.id);
        this.mobileMode = 'smart';
        return;
      }
      this.issueMoveOrAttackPoint(gx, gy, this.mobileMode === 'attack');
      this.mobileMode = 'smart';
      return;
    }

    // Check clicking a Human unit
    const hitHuman = this.findUnitAtScreen(sx, sy, vw, vh, 'human');
    if (hitHuman) {
      if (shiftHeld) {
        if (this.selectedUnitIds.has(hitHuman.id)) this.selectedUnitIds.delete(hitHuman.id);
        else this.selectedUnitIds.add(hitHuman.id);
      } else {
        this.selectedUnitIds = new Set([hitHuman.id]);
      }
      this.selectedBuildingId = null;
      sound.click();
      return;
    }

    // Check clicking a Human building
    const hitBld = this.findBuildingAtGrid(igx, igy, 'human');
    if (hitBld) {
      this.selectedBuildingId = hitBld.id;
      this.selectedUnitIds.clear();
      sound.click();
      return;
    }

    // Smart tap-to-act when units are selected (works great for mobile & desktop!)
    if (currentSelected.length > 0) {
      const hitEnemy = this.findUnitAtScreen(sx, sy, vw, vh, 'orc');
      if (hitEnemy) {
        this.issueAttackUnit(hitEnemy.id);
        return;
      }
      const hitEnemyBld = this.findBuildingAtGrid(igx, igy, 'orc');
      if (hitEnemyBld) {
        this.issueAttackBuilding(hitEnemyBld.id);
        return;
      }
      const tile = this.tiles[igy]?.[igx];
      if (tile && tile.resourceKind && (tile.resourceAmount ?? 0) > 0) {
        this.issueGatherTile(igx, igy);
        return;
      }
      if (tile && tile.walkable) {
        this.issueMoveOrAttackPoint(gx, gy, false);
        return;
      }
    }

    // Otherwise deselect
    if (!shiftHeld) {
      this.selectedUnitIds.clear();
      this.selectedBuildingId = null;
    }
  }

  public handleWorldSecondaryClick(sx: number, sy: number, vw: number, vh: number) {
    if (this.buildMode) {
      this.buildMode = null;
      sound.click();
      return;
    }

    const selected = this.getSelectedHumanUnits();
    if (selected.length === 0) return;

    const { wx, wy } = screenToWorld(sx, sy, this.camera, vw, vh);
    const { gx, gy } = worldToGrid(wx, wy, 1);
    const igx = Math.floor(gx);
    const igy = Math.floor(gy);

    const enemy = this.findUnitAtScreen(sx, sy, vw, vh, 'orc');
    if (enemy) {
      this.issueAttackUnit(enemy.id);
      return;
    }
    const enemyBld = this.findBuildingAtGrid(igx, igy, 'orc');
    if (enemyBld) {
      this.issueAttackBuilding(enemyBld.id);
      return;
    }
    const tile = this.tiles[igy]?.[igx];
    if (tile && tile.resourceKind && (tile.resourceAmount ?? 0) > 0) {
      this.issueGatherTile(igx, igy);
      return;
    }

    this.issueMoveOrAttackPoint(gx, gy, false);
  }

  public handleMarqueeSelect(x0: number, y0: number, x1: number, y1: number, vw: number, vh: number) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    const picked: string[] = [];
    for (const u of this.units) {
      if (u.faction !== 'human' || (u.deadTimer && u.deadTimer > 0)) continue;
      const tile = this.tiles[Math.floor(u.y)]?.[Math.floor(u.x)];
      const elev = tile ? tile.elevation : 1;
      const { wx, wy } = gridToWorld(u.x, u.y, elev);
      const { sx, sy } = worldToScreen(wx, wy + TILE_H * 0.25 - 10, this.camera, vw, vh);
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        picked.push(u.id);
      }
    }

    if (picked.length > 0) {
      this.selectedUnitIds = new Set(picked);
      this.selectedBuildingId = null;
      sound.click();
    }
  }

  private findUnitAtScreen(
    sx: number,
    sy: number,
    vw: number,
    vh: number,
    faction: 'human' | 'orc'
  ): Unit | null {
    const { wx, wy } = screenToWorld(sx, sy, this.camera, vw, vh);
    let best: Unit | null = null;
    // Scale hit radius softly so units remain easy to tap at 1x without over-grabbing at 3x
    let bestDist = Math.max(24, 34 / this.camera.zoom);
    for (const u of this.units) {
      if (u.faction !== faction || (u.deadTimer && u.deadTimer > 0)) continue;
      const t = this.tiles[Math.floor(u.y)]?.[Math.floor(u.x)];
      if (faction === 'orc' && (!t || t.fog < 2)) continue;
      const elev = t ? t.elevation : 1;
      const pos = gridToWorld(u.x, u.y, elev);
      const d = Math.hypot(wx - pos.wx, wy - (pos.wy + TILE_H * 0.25 - 10));
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    return best;
  }

  private findBuildingAtGrid(
    igx: number,
    igy: number,
    faction: 'human' | 'orc'
  ): Building | null {
    for (const b of this.buildings) {
      if (b.faction !== faction) continue;
      if (igx >= b.gx && igx < b.gx + b.size && igy >= b.gy && igy < b.gy + b.size) {
        return b;
      }
    }
    return null;
  }

  private issueMoveOrAttackPoint(gx: number, gy: number, attackMove: boolean) {
    const selected = this.getSelectedHumanUnits();
    if (selected.length === 0) return;

    const offsets = computeFormationOffsets(selected.length);
    selected.forEach((u, idx) => {
      const tx = clamp(gx + offsets[idx].dx, 1.2, MAP_SIZE - 1.2);
      const ty = clamp(gy + offsets[idx].dy, 1.2, MAP_SIZE - 1.2);
      u.order = attackMove ? 'attack_move' : 'move';
      u.targetX = tx;
      u.targetY = ty;
      u.targetUnitId = undefined;
      u.targetBuildingId = undefined;
      this.assignPathTo(u, tx, ty, false);
    });

    sound.command();
    this.particles.push({
      x: gx,
      y: gy,
      z: 2,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.35,
      maxLife: 0.35,
      size: 14,
      color: attackMove ? '#ef4444' : '#4ade80',
      kind: 'ring',
    });
  }

  private issueAttackUnit(targetId: string) {
    const selected = this.getSelectedHumanUnits();
    for (const u of selected) {
      u.order = 'attack_unit';
      u.targetUnitId = targetId;
      u.targetBuildingId = undefined;
      this.unitPaths.delete(u.id);
    }
    sound.command();
  }

  private issueAttackBuilding(buildingId: string) {
    const selected = this.getSelectedHumanUnits();
    for (const u of selected) {
      u.order = 'attack_building';
      u.targetBuildingId = buildingId;
      u.targetUnitId = undefined;
      this.unitPaths.delete(u.id);
    }
    sound.command();
  }

  private issueGatherTile(gx: number, gy: number) {
    const selected = this.getSelectedHumanUnits();
    let anyLaborer = false;
    for (const u of selected) {
      if (u.type === 'laborer') {
        anyLaborer = true;
        u.order = 'gather';
        u.gatherGx = gx;
        u.gatherGy = gy;
        u.targetUnitId = undefined;
        u.targetBuildingId = undefined;
        this.assignPathTo(u, gx + 0.5, gy + 0.5, true);
      }
    }
    if (!anyLaborer) {
      // Move hero/units beside the node, or send an idle laborer if available!
      const idleLab = this.units.find(
        (u) => u.faction === 'human' && u.type === 'laborer' && u.order === 'idle'
      );
      if (idleLab) {
        idleLab.order = 'gather';
        idleLab.gatherGx = gx;
        idleLab.gatherGy = gy;
        this.assignPathTo(idleLab, gx + 0.5, gy + 0.5, true);
        this.addFloatingText(gx + 0.5, gy + 0.5, 'Laborer dispatched', '#facc15');
      } else {
        this.issueMoveOrAttackPoint(gx + 0.5, gy + 0.5, false);
      }
    } else {
      sound.command();
      this.particles.push({
        x: gx + 0.5,
        y: gy + 0.5,
        z: 2,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.35,
        maxLife: 0.35,
        size: 14,
        color: '#facc15',
        kind: 'ring',
      });
    }
  }

  public updateHover(sx: number, sy: number, vw: number, vh: number) {
    const { wx, wy } = screenToWorld(sx, sy, this.camera, vw, vh);
    const { gx, gy } = worldToGrid(wx, wy, 1);
    const igx = Math.floor(gx);
    const igy = Math.floor(gy);
    if (igx >= 0 && igx < MAP_SIZE && igy >= 0 && igy < MAP_SIZE) {
      this.hoverGrid = { gx: igx, gy: igy };
    } else {
      this.hoverGrid = null;
    }
  }

  public clampCamera() {
    const minWorld = gridToWorld(0, MAP_SIZE - 1, 1);
    const maxWorld = gridToWorld(MAP_SIZE - 1, 0, 1);
    const topWorld = gridToWorld(0, 0, 1);
    const botWorld = gridToWorld(MAP_SIZE - 1, MAP_SIZE - 1, 1);

    this.camera.x = clamp(this.camera.x, minWorld.wx + 120, maxWorld.wx - 120);
    this.camera.y = clamp(this.camera.y, topWorld.wy + 100, botWorld.wy - 100);
    this.camera.targetX = clamp(this.camera.targetX, minWorld.wx + 120, maxWorld.wx - 120);
    this.camera.targetY = clamp(this.camera.targetY, topWorld.wy + 100, botWorld.wy - 100);
    this.camera.zoom = clamp(this.camera.zoom, MIN_ZOOM, MAX_ZOOM);
    this.camera.targetZoom = clamp(this.camera.targetZoom, MIN_ZOOM, MAX_ZOOM);
  }

  private updateCameraSmoothing(dt: number, vw: number, vh: number) {
    const cam = this.camera;
    const ease = 1 - Math.exp(-14 * dt);

    if (Math.abs(cam.targetZoom - cam.zoom) > 0.001) {
      const nextZoom = cam.zoom + (cam.targetZoom - cam.zoom) * ease;
      if (cam.focalX !== null && cam.focalY !== null) {
        zoomCameraAtScreenPoint(cam, nextZoom, cam.focalX, cam.focalY, vw, vh);
      } else {
        cam.zoom = nextZoom;
      }
    } else {
      cam.zoom = cam.targetZoom;
      cam.focalX = null;
      cam.focalY = null;
    }

    if (cam.focalX === null) {
      if (Math.abs(cam.targetX - cam.x) > 0.25 || Math.abs(cam.targetY - cam.y) > 0.25) {
        cam.x += (cam.targetX - cam.x) * ease;
        cam.y += (cam.targetY - cam.y) * ease;
      } else {
        cam.x = cam.targetX;
        cam.y = cam.targetY;
      }
    }

    this.clampCamera();
  }

  public update(rawDt: number, viewportW = 1280, viewportH = 720) {
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;

    if (this.camera.shake > 0) {
      this.camera.shake = Math.max(0, this.camera.shake - dt * 28);
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerMessage = null;
    }

    if (this.screen === 'TITLE') {
      // Atmospheric slow live-world pan across settlement -> river -> ruins
      this.titlePanAngle += dt * 0.12;
      const focusX = 16 + Math.cos(this.titlePanAngle) * 7;
      const focusY = 23 + Math.sin(this.titlePanAngle) * 7;
      const { wx, wy } = gridToWorld(focusX, focusY, 1);
      this.camera.x = wx;
      this.camera.y = wy;
      this.camera.targetX = wx;
      this.camera.targetY = wy;
      this.camera.zoom = 1.15;
      this.camera.targetZoom = 1.15;
      return;
    }

    if (this.screen !== 'PLAYING') return;

    this.updateCameraSmoothing(dt, viewportW, viewportH);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      return;
    }

    this.stats.elapsedSec += dt;

    // 1. Update Buildings (construction, training queues, turret attacks)
    this.updateBuildings(dt);

    // 2. Update Units (movement, combat, harvesting, hero cooldowns)
    this.updateUnits(dt);

    // 3. Update Projectiles & Particles & Floating Texts
    this.updateProjectiles(dt);
    this.updateParticles(dt);

    // 4. Enemy Raid Spawner
    this.updateEnemyDirector(dt);

    // 5. Fog of War & Scenario Objectives
    this.updateFogOfWar();
    this.checkObjectivesAndEndState();

    // 6. Auto-save every 20 seconds
    this.autoSaveTimer += dt;
    if (this.autoSaveTimer >= 20) {
      this.autoSaveTimer = 0;
      this.saveGame();
    }
  }

  private updateBuildings(dt: number) {
    for (const b of this.buildings) {
      if (b.hitFlashTimer > 0) b.hitFlashTimer = Math.max(0, b.hitFlashTimer - dt);

      if (!b.constructed) {
        // Laborers nearby speed up building by 2x
        const nearbyWorkers = this.units.filter(
          (u) =>
            u.faction === 'human' &&
            u.type === 'laborer' &&
            distGrid(u.x, u.y, b.gx + b.size * 0.5, b.gy + b.size * 0.5) < 2.8
        ).length;
        const speedMult = 1 + nearbyWorkers * 0.85;
        b.buildProgress = Math.min(1, b.buildProgress + (dt / b.buildTime) * speedMult);
        b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.75 * dt * speedMult) / b.buildTime);

        if (b.buildProgress >= 1) {
          b.constructed = true;
          b.hp = b.maxHp;
          this.stats.buildingsConstructed += 1;
          if (b.type === 'barracks') {
            this.stats.barracksBuilt = true;
          }
          sound.complete();
          this.addFloatingText(b.gx + b.size * 0.5, b.gy + b.size * 0.5, `${b.name} Complete`, '#facc15');
        }
        continue;
      }

      // Training Queue
      if (b.queue.length > 0) {
        const current = b.queue[0];
        current.remaining -= dt;
        if (current.remaining <= 0) {
          b.queue.shift();
          const spawnPos = this.findFreeAdjacentSpot(b.gx, b.gy, b.size);
          const u = createUnit(this.nextId('u'), 'human', current.unitType, spawnPos.x, spawnPos.y);
          this.units.push(u);
          if (current.unitType === 'swordsman') {
            this.stats.swordsmenRecruited += 1;
          }
          sound.complete();
          this.addFloatingText(u.x, u.y, `${u.name} Ready`, '#60a5fa');
        }
      }

      // Defensive Tower Auto-Attack
      if (b.type === 'tower' || b.type === 'orc_tower') {
        b.attackTimer = Math.max(0, b.attackTimer - dt);
        if (b.attackTimer <= 0) {
          const cx = b.gx + b.size * 0.5;
          const cy = b.gy + b.size * 0.5;
          const enemyFaction = b.faction === 'human' ? 'orc' : 'human';
          const target = this.findNearestEnemyUnit(cx, cy, enemyFaction, 6.8);
          if (target) {
            b.attackTimer = 1.35;
            this.spawnProjectile(
              b.faction,
              cx,
              cy,
              target.x,
              target.y,
              target.id,
              undefined,
              b.type === 'tower' ? 22 : 16,
              'bolt'
            );
            sound.arrowShot();
          }
        }
      }
    }
  }

  private updateUnits(dt: number) {
    for (const u of [...this.units]) {
      if (u.deadTimer && u.deadTimer > 0) {
        u.deadTimer -= dt;
        if (u.deadTimer <= 0 && u.type === 'hero') {
          const th = this.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall');
          if (th) {
            u.deadTimer = 0;
            u.x = th.gx + 2.6;
            u.y = th.gy + 1.8;
            u.hp = Math.round(u.maxHp * 0.7);
            u.order = 'idle';
            this.spawnParticles(u.x, u.y, 18, '#60a5fa', 'magic', 14);
            this.showBanner('Aldric revived at the Bindstone');
            sound.levelUp();
          }
        }
        continue;
      }

      u.animTime += dt;
      if (u.atkTimer > 0) u.atkTimer = Math.max(0, u.atkTimer - dt);
      if (u.attackAnimTimer > 0) u.attackAnimTimer = Math.max(0, u.attackAnimTimer - dt);
      if (u.hitFlashTimer > 0) u.hitFlashTimer = Math.max(0, u.hitFlashTimer - dt);

      if (u.type === 'hero') {
        if ((u.cleaveCooldown ?? 0) > 0) u.cleaveCooldown = Math.max(0, (u.cleaveCooldown ?? 0) - dt);
        if ((u.rallyCooldown ?? 0) > 0) u.rallyCooldown = Math.max(0, (u.rallyCooldown ?? 0) - dt);
        // Subtle passive regeneration
        if (u.hp < u.maxHp) {
          u.hp = Math.min(u.maxHp, u.hp + dt * 1.4);
        }
        // Loot chests nearby
        this.checkChestLoot(u);
      }

      // Reset velocity; movement step will populate it
      u.vx = 0;
      u.vy = 0;

      const enemyFaction = u.faction === 'human' ? 'orc' : 'human';

      // Auto-acquire enemies when idle or attack-moving (non-laborer)
      if (u.type !== 'laborer' && (u.order === 'idle' || u.order === 'attack_move' || u.order === 'follow_hero')) {
        const aggroRange = u.type === 'orc_commander' ? 6.5 : u.isRanged ? 6.5 : 5.2;
        const foe = this.findNearestEnemyUnit(u.x, u.y, enemyFaction, aggroRange);
        if (foe) {
          this.engageUnit(u, foe, dt);
          continue;
        }
        const foeBld = this.findNearestEnemyBuilding(u.x, u.y, enemyFaction, 4.8);
        if (foeBld && (u.order === 'attack_move' || u.aiRole === 'raider')) {
          this.engageBuilding(u, foeBld, dt);
          continue;
        }
      }

      if (u.order === 'attack_unit') {
        const target = this.units.find(
          (item) => item.id === u.targetUnitId && (!item.deadTimer || item.deadTimer <= 0)
        );
        if (!target) {
          u.order = 'idle';
          u.targetUnitId = undefined;
        } else {
          this.engageUnit(u, target, dt);
        }
      } else if (u.order === 'attack_building') {
        const bld = this.buildings.find((item) => item.id === u.targetBuildingId);
        if (!bld) {
          u.order = 'idle';
          u.targetBuildingId = undefined;
        } else {
          this.engageBuilding(u, bld, dt);
        }
      } else if (u.order === 'gather') {
        this.updateGatherOrder(u, dt);
      } else if (u.order === 'follow_hero') {
        const hero = this.getHero();
        if (hero && (!hero.deadTimer || hero.deadTimer <= 0)) {
          const d = distGrid(u.x, u.y, hero.x, hero.y);
          if (d > 2.2) {
            this.moveAlongPathOrDirect(u, hero.x, hero.y, dt);
          }
        } else {
          u.order = 'idle';
        }
      } else if ((u.order === 'move' || u.order === 'attack_move') && u.targetX !== undefined && u.targetY !== undefined) {
        const arrived = this.moveAlongPathOrDirect(u, u.targetX, u.targetY, dt);
        if (arrived) {
          u.order = 'idle';
          u.targetX = undefined;
          u.targetY = undefined;
        }
      } else if (u.faction === 'orc' && u.aiRole === 'raider') {
        // Raiders always march toward Human Town Hall
        const th = this.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall');
        if (th) {
          const foeB = this.findNearestEnemyBuilding(u.x, u.y, 'human', 4.5);
          if (foeB) {
            this.engageBuilding(u, foeB, dt);
          } else {
            this.moveAlongPathOrDirect(u, th.gx + 1, th.gy + 1, dt);
          }
        }
      }
    }

    // Soft separation between living units so squads don't overlap identically
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      if (a.deadTimer && a.deadTimer > 0) continue;
      for (let j = i + 1; j < this.units.length; j++) {
        const b = this.units[j];
        if (b.deadTimer && b.deadTimer > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.001 && d < 0.52) {
          const push = (0.52 - d) * 0.35;
          const nx = dx / d;
          const ny = dy / d;
          if (this.isPointWalkable(a.x - nx * push, a.y - ny * push)) {
            a.x -= nx * push;
            a.y -= ny * push;
          }
          if (this.isPointWalkable(b.x + nx * push, b.y + ny * push)) {
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }
  }

  private engageUnit(u: Unit, target: Unit, dt: number) {
    const d = distGrid(u.x, u.y, target.x, target.y);
    const { wx: ux } = gridToWorld(u.x, u.y, 1);
    const { wx: tx } = gridToWorld(target.x, target.y, 1);
    if (Math.abs(tx - ux) > 1) u.facing = tx >= ux ? 1 : -1;

    if (d <= u.range) {
      if (u.atkTimer <= 0) {
        u.atkTimer = u.atkCooldown;
        u.attackAnimTimer = 0.25;
        const eff = this.getUnitEffectiveStats(u);
        if (u.isRanged) {
          this.spawnProjectile(
            u.faction,
            u.x,
            u.y,
            target.x,
            target.y,
            target.id,
            undefined,
            eff.atk,
            u.faction === 'human' ? 'arrow' : 'orc_arrow'
          );
          sound.arrowShot();
        } else {
          this.damageUnit(target, eff.atk, u);
          sound.swordHit();
        }
      }
    } else {
      this.moveAlongPathOrDirect(u, target.x, target.y, dt);
    }
  }

  private engageBuilding(u: Unit, bld: Building, dt: number) {
    const bx = bld.gx + bld.size * 0.5;
    const by = bld.gy + bld.size * 0.5;
    const d = distGrid(u.x, u.y, bx, by);
    const effRange = u.range + bld.size * 0.45;
    if (d <= effRange) {
      if (u.atkTimer <= 0) {
        u.atkTimer = u.atkCooldown;
        u.attackAnimTimer = 0.25;
        const eff = this.getUnitEffectiveStats(u);
        if (u.isRanged) {
          this.spawnProjectile(
            u.faction,
            u.x,
            u.y,
            bx,
            by,
            undefined,
            bld.id,
            eff.atk,
            u.faction === 'human' ? 'arrow' : 'orc_arrow'
          );
          sound.arrowShot();
        } else {
          this.damageBuilding(bld, eff.atk);
          sound.swordHit();
        }
      }
    } else {
      this.moveAlongPathOrDirect(u, bx, by, dt);
    }
  }

  private updateGatherOrder(u: Unit, dt: number) {
    const th = this.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall');
    if (u.carryingKind && (u.carryingAmount ?? 0) > 0) {
      if (!th) {
        u.order = 'idle';
        return;
      }
      const tx = th.gx + th.size * 0.5;
      const ty = th.gy + th.size * 0.5;
      if (distGrid(u.x, u.y, tx, ty) <= 2.1) {
        const amt = u.carryingAmount ?? 12;
        const kind = u.carryingKind;
        this.resources[kind] += amt;
        if (kind === 'wood') this.stats.gatheredWood += amt;
        if (kind === 'gold') this.stats.gatheredGold += amt;
        if (kind === 'stone') this.stats.gatheredStone += amt;

        const color = kind === 'gold' ? '#facc15' : kind === 'wood' ? '#84cc16' : '#cbd5e1';
        this.addFloatingText(tx, ty, `+${amt} ${kind}`, color);
        sound.gather();
        u.carryingKind = undefined;
        u.carryingAmount = 0;

        // Return to node
        if (u.gatherGx !== undefined && u.gatherGy !== undefined) {
          this.assignPathTo(u, u.gatherGx + 0.5, u.gatherGy + 0.5, true);
        } else {
          u.order = 'idle';
        }
      } else {
        this.moveAlongPathOrDirect(u, tx, ty, dt);
      }
      return;
    }

    // Move to resource tile and harvest
    if (u.gatherGx === undefined || u.gatherGy === undefined) {
      u.order = 'idle';
      return;
    }

    const tile = this.tiles[u.gatherGy]?.[u.gatherGx];
    if (!tile || !tile.resourceKind || (tile.resourceAmount ?? 0) <= 0) {
      // Find nearby similar node
      const nextNode = this.findNearestResource(u.x, u.y, tile?.resourceKind ?? 'wood', 8);
      if (nextNode) {
        u.gatherGx = nextNode.gx;
        u.gatherGy = nextNode.gy;
        this.assignPathTo(u, nextNode.gx + 0.5, nextNode.gy + 0.5, true);
      } else {
        u.order = 'idle';
      }
      return;
    }

    const d = distGrid(u.x, u.y, u.gatherGx + 0.5, u.gatherGy + 0.5);
    if (d <= 1.55) {
      u.gatherTimer = (u.gatherTimer ?? 0) + dt;
      if (Math.random() < dt * 2.5) {
        const pCol =
          tile.resourceKind === 'gold'
            ? '#facc15'
            : tile.resourceKind === 'wood'
            ? '#a16207'
            : '#94a3b8';
        this.spawnParticles(u.gatherGx + 0.5, u.gatherGy + 0.5, 4, pCol, 'wood', 6);
      }
      if (u.gatherTimer >= 1.8) {
        u.gatherTimer = 0;
        const take = Math.min(12, tile.resourceAmount ?? 0);
        tile.resourceAmount = (tile.resourceAmount ?? 0) - take;
        u.carryingKind = tile.resourceKind;
        u.carryingAmount = take;

        if ((tile.resourceAmount ?? 0) <= 0) {
          tile.prop = undefined;
          tile.resourceKind = undefined;
          tile.walkable = true;
        }
        if (th) {
          this.assignPathTo(u, th.gx + th.size * 0.5, th.gy + th.size * 0.5, true);
        }
      }
    } else {
      this.moveAlongPathOrDirect(u, u.gatherGx + 0.5, u.gatherGy + 0.5, dt);
    }
  }

  private checkChestLoot(hero: Unit) {
    const igx = Math.floor(hero.x);
    const igy = Math.floor(hero.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.tiles[igy + dy]?.[igx + dx];
        if (t && t.prop === 'chest' && !t.chestLooted) {
          t.chestLooted = true;
          this.resources.gold += 65;
          this.stats.gatheredGold += 65;
          this.grantHeroXp(45);

          // Give curated relic/weapon/armor based on chest coordinates
          let reward = ITEM_CATALOG.healing_draught;
          if (t.gx < 16) reward = ITEM_CATALOG.leather_hauberk;
          else if (t.gy > 25) reward = ITEM_CATALOG.runed_claymore;
          else reward = ITEM_CATALOG.ember_signet;

          this.inventory.push(reward);
          sound.levelUp();
          this.spawnParticles(t.gx + 0.5, t.gy + 0.5, 16, '#facc15', 'magic', 10);
          this.addFloatingText(t.gx + 0.5, t.gy + 0.5, `Found ${reward.name}!`, '#facc15');
          this.showBanner(`Relic Chest opened: +65 Gold & ${reward.name}`);
        }
      }
    }
  }

  private damageUnit(target: Unit, rawDamage: number, attacker?: Unit) {
    const eff = this.getUnitEffectiveStats(target);
    const dmg = Math.max(2, rawDamage - eff.armor);
    target.hp -= dmg;
    target.hitFlashTimer = 0.12;
    this.spawnParticles(target.x, target.y, 5, target.faction === 'orc' ? '#84cc16' : '#ef4444', 'blood', 8);
    this.addFloatingText(target.x, target.y, `-${dmg}`, target.faction === 'orc' ? '#fca5a5' : '#f87171');

    if (target.hp <= 0) {
      target.hp = 0;
      if (target.type === 'hero') {
        target.deadTimer = 12;
        this.selectedUnitIds.delete(target.id);
        this.camera.shake = 6;
        this.showBanner('Aldric fell! Reviving at the Bindstone in 12s...');
        return;
      }

      // Remove non-hero unit
      this.units = this.units.filter((u) => u.id !== target.id);
      this.selectedUnitIds.delete(target.id);
      this.unitPaths.delete(target.id);

      this.spawnParticles(target.x, target.y, 12, '#dc2626', 'smoke', 10);
      if (target.faction === 'orc') {
        this.stats.orcsSlain += 1;
        this.resources.gold += target.type === 'orc_commander' ? 150 : 12;
        this.stats.gatheredGold += target.type === 'orc_commander' ? 150 : 12;
        this.grantHeroXp(target.type === 'orc_commander' ? 120 : 28);

        if (target.type === 'orc_commander') {
          this.stats.commanderDefeated = true;
          this.hitstopTimer = 0.075;
          this.camera.shake = 11;
          this.inventory.push(ITEM_CATALOG.crown_plate);
          this.showBanner('Warchief Grimgor is slain!');
        } else if (attacker?.type === 'hero' && Math.random() < 0.22) {
          this.inventory.push(ITEM_CATALOG.healing_draught);
          this.addFloatingText(target.x, target.y, '+Crimson Draught', '#4ade80');
        }
      }
    }
  }

  private damageBuilding(b: Building, rawDamage: number) {
    const dmg = Math.max(3, rawDamage);
    b.hp -= dmg;
    b.hitFlashTimer = 0.1;
    this.spawnParticles(b.gx + b.size * 0.5, b.gy + b.size * 0.5, 5, '#fb923c', 'spark', 10);

    if (b.hp <= 0) {
      b.hp = 0;
      // Restore walkability
      for (let dy = 0; dy < b.size; dy++) {
        for (let dx = 0; dx < b.size; dx++) {
          const t = this.tiles[b.gy + dy]?.[b.gx + dx];
          if (t) t.walkable = true;
        }
      }
      this.buildings = this.buildings.filter((item) => item.id !== b.id);
      if (this.selectedBuildingId === b.id) this.selectedBuildingId = null;
      this.camera.shake = Math.max(this.camera.shake, 8);
      this.spawnParticles(b.gx + b.size * 0.5, b.gy + b.size * 0.5, 22, '#f97316', 'smoke', 14);
      sound.heavyHit();

      if (b.faction === 'orc') {
        this.resources.gold += 50;
        this.stats.gatheredGold += 50;
        this.grantHeroXp(50);
        this.addFloatingText(b.gx + 1, b.gy + 1, '+50 Gold', '#facc15');
      }
    }
  }

  private grantHeroXp(amount: number) {
    const hero = this.getHero();
    if (!hero) return;
    hero.xp = (hero.xp ?? 0) + amount;
    while ((hero.xp ?? 0) >= (hero.xpToNext ?? 100)) {
      hero.xp = (hero.xp ?? 0) - (hero.xpToNext ?? 100);
      hero.level = (hero.level ?? 1) + 1;
      hero.xpToNext = hero.level * 110;
      const eff = this.getUnitEffectiveStats(hero);
      hero.maxHp = eff.maxHp;
      hero.hp = eff.maxHp;
      sound.levelUp();
      this.spawnParticles(hero.x, hero.y, 18, '#facc15', 'magic', 14);
      this.addFloatingText(hero.x, hero.y, `LEVEL ${hero.level}!`, '#facc15');
      this.showBanner(`Aldric reached Level ${hero.level}!`);
    }
  }

  private updateProjectiles(dt: number) {
    for (const p of [...this.projectiles]) {
      p.progress += dt / p.duration;
      if (p.progress >= 1) {
        if (p.targetUnitId) {
          const tu = this.units.find(
            (u) => u.id === p.targetUnitId && (!u.deadTimer || u.deadTimer <= 0)
          );
          if (tu) this.damageUnit(tu, p.damage);
        } else if (p.targetBuildingId) {
          const tb = this.buildings.find((b) => b.id === p.targetBuildingId);
          if (tb) this.damageBuilding(tb, p.damage);
        }
        this.projectiles = this.projectiles.filter((item) => item.id !== p.id);
      } else {
        p.x = p.startX + (p.targetX - p.startX) * p.progress;
        p.y = p.startY + (p.targetY - p.startY) * p.progress;
        p.z = 12 + Math.sin(p.progress * Math.PI) * 18;
      }
    }
  }

  private spawnProjectile(
    faction: 'human' | 'orc',
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    targetUnitId: string | undefined,
    targetBuildingId: string | undefined,
    damage: number,
    kind: Projectile['kind']
  ) {
    const dist = distGrid(sx, sy, tx, ty);
    this.projectiles.push({
      id: this.nextId('proj'),
      faction,
      x: sx,
      y: sy,
      z: 12,
      startX: sx,
      startY: sy,
      targetX: tx,
      targetY: ty,
      targetUnitId,
      targetBuildingId,
      damage,
      progress: 0,
      duration: Math.max(0.14, dist * 0.075),
      kind,
    });
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      } else {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        if (pt.kind !== 'ring') pt.vz -= 24 * dt;
        if (pt.z < 0) pt.z = 0;
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      ft.z += dt * 16;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    color: string,
    kind: Particle['kind'],
    zStart = 8
  ) {
    if (this.particles.length > 220) return;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x,
        y,
        z: zStart,
        vx: (Math.random() - 0.5) * 2.4,
        vy: (Math.random() - 0.5) * 2.4,
        vz: 14 + Math.random() * 18,
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        size: 1.8 + Math.random() * 1.8,
        color,
        kind,
      });
    }
  }

  private addFloatingText(x: number, y: number, text: string, color: string) {
    this.floatingTexts.push({
      id: this.nextId('ft'),
      x,
      y,
      z: 22,
      text,
      color,
      life: 1.15,
      maxLife: 1.15,
    });
  }

  private updateEnemyDirector(dt: number) {
    const stronghold = this.buildings.find((b) => b.type === 'orc_stronghold');
    if (!stronghold) return;

    this.stats.nextRaidTimer -= dt;
    if (this.stats.nextRaidTimer <= 0) {
      this.stats.raidCount += 1;
      this.stats.nextRaidTimer = Math.max(42, 60 - this.stats.raidCount * 3);

      const waveSize = Math.min(5, 2 + Math.floor(this.stats.raidCount * 0.6));
      for (let i = 0; i < waveSize; i++) {
        const uType: UnitType = i % 3 === 2 ? 'orc_archer' : 'orc_warrior';
        const sx = stronghold.gx - 0.8 + (i % 2) * 1.2;
        const sy = stronghold.gy + 2.4 + Math.floor(i / 2) * 0.9;
        this.units.push(
          createUnit(this.nextId('orc'), 'orc', uType, sx, sy, { aiRole: 'raider' })
        );
      }
      this.showBanner('Orc raiders are marching toward your settlement!', 4.5);
    }
  }

  private updateFogOfWar() {
    let explored = 0;
    let orcSeen = this.stats.orcCampDiscovered;

    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const t = this.tiles[y][x];
        if (t.fog === 2) t.fog = 1;
        if (t.fog >= 1) explored += 1;
      }
    }

    const revealCircle = (cx: number, cy: number, radius: number) => {
      const r2 = radius * radius;
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(MAP_SIZE - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(MAP_SIZE - 1, Math.ceil(cy + radius));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) {
            const tile = this.tiles[y][x];
            if (tile.fog === 0) explored += 1;
            tile.fog = 2;
            if (tile.regionTag === 'orc_camp') {
              orcSeen = true;
            }
          }
        }
      }
    };

    for (const u of this.units) {
      if (u.faction === 'human' && (!u.deadTimer || u.deadTimer <= 0)) {
        revealCircle(u.x, u.y, u.type === 'hero' ? 6.5 : 5.2);
      }
    }
    for (const b of this.buildings) {
      if (b.faction === 'human') {
        revealCircle(b.gx + b.size * 0.5, b.gy + b.size * 0.5, b.type === 'tower' ? 7.5 : 6.2);
      }
    }

    if (!this.stats.orcCampDiscovered && orcSeen) {
      this.stats.orcCampDiscovered = true;
      this.showBanner('Orc Encampment discovered! Defeat Warchief Grimgor!');
    }
    this.stats.exploredCount = explored;
  }

  private checkObjectivesAndEndState() {
    if (this.stats.commanderDefeated) {
      this.screen = 'VICTORY';
      sound.victory();
      return;
    }

    const townHall = this.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall');
    if (!townHall) {
      this.screen = 'DEFEAT';
      sound.defeat();
      return;
    }
  }

  public getObjectives(): ObjectiveState[] {
    const exploredGoal = 240;
    const woodGoal = 80;
    const goldGoal = 80;
    const swordsmenGoal = 5;

    return [
      {
        id: 'explore',
        title: 'Explore the surrounding forest',
        completed: this.stats.exploredCount >= exploredGoal,
        progressText: `${Math.min(this.stats.exploredCount, exploredGoal)}/${exploredGoal} tiles`,
      },
      {
        id: 'resources',
        title: 'Collect wood and gold',
        completed: this.stats.gatheredWood >= woodGoal && this.stats.gatheredGold >= goldGoal,
        progressText: `${Math.min(this.stats.gatheredWood, woodGoal)}/${woodGoal} W · ${Math.min(
          this.stats.gatheredGold,
          goldGoal
        )}/${goldGoal} G`,
      },
      {
        id: 'barracks',
        title: 'Construct a Barracks',
        completed: this.stats.barracksBuilt,
        progressText: this.stats.barracksBuilt ? 'Done' : '0/1',
      },
      {
        id: 'swordsmen',
        title: 'Recruit five Swordsmen',
        completed: this.stats.swordsmenRecruited >= swordsmenGoal,
        progressText: `${Math.min(this.stats.swordsmenRecruited, swordsmenGoal)}/${swordsmenGoal}`,
      },
      {
        id: 'orc_camp',
        title: 'Discover the Orc encampment',
        completed: this.stats.orcCampDiscovered,
        progressText: this.stats.orcCampDiscovered ? 'Discovered' : 'Unexplored',
      },
      {
        id: 'commander',
        title: 'Defeat Warchief Grimgor',
        completed: this.stats.commanderDefeated,
        progressText: this.stats.commanderDefeated ? 'Slain' : 'Active',
      },
    ];
  }

  private findNearestResource(
    x: number,
    y: number,
    kind: ResourceKind,
    maxDist: number
  ): { gx: number; gy: number } | null {
    let best: { gx: number; gy: number } | null = null;
    let bestD = maxDist;
    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const t = this.tiles[gy][gx];
        if (t.resourceKind === kind && (t.resourceAmount ?? 0) > 0) {
          const d = distGrid(x, y, gx + 0.5, gy + 0.5);
          if (d < bestD) {
            bestD = d;
            best = { gx, gy };
          }
        }
      }
    }
    return best;
  }

  private findNearestEnemyUnit(
    x: number,
    y: number,
    enemyFaction: 'human' | 'orc',
    maxDist: number
  ): Unit | null {
    let best: Unit | null = null;
    let bestD = maxDist;
    for (const u of this.units) {
      if (u.faction !== enemyFaction || (u.deadTimer && u.deadTimer > 0)) continue;
      const d = distGrid(x, y, u.x, u.y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private findNearestEnemyBuilding(
    x: number,
    y: number,
    enemyFaction: 'human' | 'orc',
    maxDist: number
  ): Building | null {
    let best: Building | null = null;
    let bestD = maxDist;
    for (const b of this.buildings) {
      if (b.faction !== enemyFaction) continue;
      const d = distGrid(x, y, b.gx + b.size * 0.5, b.gy + b.size * 0.5);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private findFreeAdjacentSpot(gx: number, gy: number, size: number): Point {
    const candidates: Point[] = [];
    for (let dy = -1; dy <= size; dy++) {
      for (let dx = -1; dx <= size; dx++) {
        if (dx >= 0 && dx < size && dy >= 0 && dy < size) continue;
        const tx = gx + dx;
        const ty = gy + dy;
        const t = this.tiles[ty]?.[tx];
        if (t && t.walkable) candidates.push({ x: tx + 0.5, y: ty + 0.5 });
      }
    }
    return candidates[0] ?? { x: gx + size + 0.5, y: gy + size + 0.5 };
  }

  private isPointWalkable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const t = this.tiles[gy]?.[gx];
    return Boolean(t && t.walkable);
  }

  private assignPathTo(u: Unit, tx: number, ty: number, adjacentOk: boolean) {
    const sx = clamp(Math.floor(u.x), 0, MAP_SIZE - 1);
    const sy = clamp(Math.floor(u.y), 0, MAP_SIZE - 1);
    let ex = clamp(Math.floor(tx), 0, MAP_SIZE - 1);
    let ey = clamp(Math.floor(ty), 0, MAP_SIZE - 1);

    if (!this.tiles[ey]?.[ex]?.walkable) {
      // Find nearest walkable neighbor around goal
      let bestX = ex;
      let bestY = ey;
      let bestDist = Infinity;
      for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = ex + dx;
            const ny = ey + dy;
            if (this.tiles[ny]?.[nx]?.walkable) {
              const d = distGrid(sx, sy, nx, ny);
              if (d < bestDist) {
                bestDist = d;
                bestX = nx;
                bestY = ny;
              }
            }
          }
        }
        if (bestDist < Infinity) break;
      }
      if (bestDist < Infinity) {
        ex = bestX;
        ey = bestY;
      }
    }

    const path = this.findGridPath(sx, sy, ex, ey);
    if (path.length > 0) {
      if (!adjacentOk && this.tiles[Math.floor(ty)]?.[Math.floor(tx)]?.walkable) {
        path[path.length - 1] = { x: tx, y: ty };
      }
      this.unitPaths.set(u.id, path);
    } else {
      this.unitPaths.set(u.id, [{ x: tx, y: ty }]);
    }
  }

  private moveAlongPathOrDirect(u: Unit, gx: number, gy: number, dt: number): boolean {
    let path = this.unitPaths.get(u.id);
    if (!path || path.length === 0) {
      // Compute path on demand if target is far or water blocks direct line
      if (distGrid(u.x, u.y, gx, gy) > 2.0) {
        this.assignPathTo(u, gx, gy, false);
        path = this.unitPaths.get(u.id);
      }
    }

    const nextPt = path && path.length > 0 ? path[0] : { x: gx, y: gy };
    const dx = nextPt.x - u.x;
    const dy = nextPt.y - u.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.22) {
      if (path && path.length > 0) {
        path.shift();
        if (path.length === 0) {
          this.unitPaths.delete(u.id);
          return true;
        }
        return false;
      }
      return true;
    }

    const step = Math.min(dist, u.speed * dt);
    const nx = (dx / dist) * step;
    const ny = (dy / dist) * step;

    const { wx: ux } = gridToWorld(u.x, u.y, 1);
    const { wx: tx } = gridToWorld(u.x + nx, u.y + ny, 1);
    if (Math.abs(tx - ux) > 0.05) u.facing = tx >= ux ? 1 : -1;

    if (this.isPointWalkable(u.x + nx, u.y + ny)) {
      u.x += nx;
      u.y += ny;
      u.vx = nx / dt;
      u.vy = ny / dt;
    } else if (this.isPointWalkable(u.x + nx, u.y)) {
      u.x += nx;
      u.vx = nx / dt;
    } else if (this.isPointWalkable(u.x, u.y + ny)) {
      u.y += ny;
      u.vy = ny / dt;
    } else {
      // Re-path around obstacle
      this.assignPathTo(u, gx, gy, false);
    }

    return false;
  }

  /**
   * Compact A* grid pathfinder on 42x42 tile map so units cross bridges reliably.
   */
  private findGridPath(sx: number, sy: number, ex: number, ey: number): Point[] {
    if (sx === ex && sy === ey) return [];
    const total = MAP_SIZE * MAP_SIZE;
    const gScore = new Float32Array(total).fill(1e9);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);

    const startIdx = sy * MAP_SIZE + sx;
    const goalIdx = ey * MAP_SIZE + ex;
    gScore[startIdx] = 0;

    const open: Array<{ idx: number; f: number }> = [
      { idx: startIdx, f: Math.abs(ex - sx) + Math.abs(ey - sy) },
    ];

    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [-1, 1, 1.414],
      [1, -1, 1.414],
      [-1, -1, 1.414],
    ];

    let iterations = 0;
    while (open.length > 0 && iterations < 900) {
      iterations += 1;
      let bestI = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestI].f) bestI = i;
      }
      const current = open.splice(bestI, 1)[0].idx;
      if (current === goalIdx) {
        const result: Point[] = [];
        let cur = goalIdx;
        while (cur !== -1 && cur !== startIdx) {
          const cy = Math.floor(cur / MAP_SIZE);
          const cx = cur % MAP_SIZE;
          result.push({ x: cx + 0.5, y: cy + 0.5 });
          cur = cameFrom[cur];
        }
        result.reverse();
        return result;
      }

      closed[current] = 1;
      const cx = current % MAP_SIZE;
      const cy = Math.floor(current / MAP_SIZE);

      for (const [dx, dy, cost] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= MAP_SIZE || ny < 0 || ny >= MAP_SIZE) continue;
        const nIdx = ny * MAP_SIZE + nx;
        if (closed[nIdx]) continue;
        if (!this.tiles[ny][nx].walkable && nIdx !== goalIdx) continue;
        // Prevent diagonal corner-cutting across water
        if (dx !== 0 && dy !== 0) {
          if (!this.tiles[cy][nx].walkable || !this.tiles[ny][cx].walkable) continue;
        }

        const tentative = gScore[current] + cost;
        if (tentative < gScore[nIdx]) {
          cameFrom[nIdx] = current;
          gScore[nIdx] = tentative;
          const h = Math.hypot(ex - nx, ey - ny);
          const existing = open.find((o) => o.idx === nIdx);
          if (existing) existing.f = tentative + h;
          else open.push({ idx: nIdx, f: tentative + h });
        }
      }
    }

    return [];
  }

  public getHudSnapshot(): HudSnapshot {
    const pop = this.getPopCounts();
    const hero = this.getHero();
    const selectedUnits = this.getSelectedHumanUnits();
    const selectedBuilding = this.selectedBuildingId
      ? this.buildings.find((b) => b.id === this.selectedBuildingId) ?? null
      : null;

    return {
      screen: this.screen,
      resources: { ...this.resources },
      popUsed: pop.used,
      popCap: pop.cap,
      selectedUnitIds: Array.from(this.selectedUnitIds),
      selectedUnits: selectedUnits.map((u) => ({ ...u })),
      selectedBuilding: selectedBuilding
        ? { ...selectedBuilding, queue: [...selectedBuilding.queue] }
        : null,
      hero: hero ? { ...hero, ...this.getUnitEffectiveStats(hero) } : null,
      equipment: { ...this.equipment },
      inventory: [...this.inventory],
      objectives: this.getObjectives(),
      stats: { ...this.stats },
      buildMode: this.buildMode,
      mobileMode: this.mobileMode,
      muted: sound.muted,
      cameraZoom: Number(this.camera.zoom.toFixed(2)),
      bannerMessage: this.bannerMessage,
      hasSavedGame: this.hasSavedGame(),
    };
  }
}
