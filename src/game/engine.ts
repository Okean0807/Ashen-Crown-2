import { DEFAULT_WORKING_ASSUMPTIONS } from '../core/config';
import type { ControlGroupSlot } from '../core/fieldCommands';
import type { DamageType, EquipSlotId, FormationType } from '../core/types';
import { CoreGameBridge } from './coreBridge';
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
  Faction,
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

const MANUAL_SAVE_KEY = 'ashen_crown_save_v1';
const AUTO_SAVE_KEY = 'ashen_crown_autosave_v1';

interface Point {
  x: number;
  y: number;
}

export class GameEngine {
  public core: CoreGameBridge = new CoreGameBridge();
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
  public inventory: ItemDef[] = [];

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
  private dismissedChestObjectId: string | null = null;
  private lastCombatTime = -999;

  constructor() {
    this.initNewWorld(false);
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter}`;
  }

  public hasManualSave(): boolean {
    try {
      return Boolean(localStorage.getItem(MANUAL_SAVE_KEY));
    } catch {
      return false;
    }
  }

  public hasAutoSave(): boolean {
    try {
      return Boolean(localStorage.getItem(AUTO_SAVE_KEY));
    } catch {
      return false;
    }
  }

  public hasSavedGame(): boolean {
    return this.hasManualSave() || this.hasAutoSave();
  }

  public isPlayerInActiveCombat(): boolean {
    if (this.time - this.lastCombatTime < 4.5) return true;
    const livingOrcs = this.units.filter(
      (u) => u.faction === 'orc' && (!u.deadTimer || u.deadTimer <= 0)
    );
    if (livingOrcs.length === 0) return false;
    for (const h of this.units) {
      if (h.faction !== 'human' || (h.deadTimer && h.deadTimer > 0) || h.dormant) continue;
      if (h.order === 'attack_unit' || h.order === 'attack_building') return true;
      for (const o of livingOrcs) {
        if (distGrid(h.x, h.y, o.x, o.y) <= 4.2) return true;
      }
    }
    return false;
  }

  public initNewWorld(startPlaying: boolean) {
    this.core.reset();
    const world = generateScenarioWorld();
    this.tiles = world.tiles;
    this.units = world.units;
    this.buildings = world.buildings;
    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.unitPaths.clear();

    const settlement = this.core.sandbox.activeMap.localSettlements.settlement_sector_a;
    this.resources = {
      gold: Math.max(130, settlement?.localResources.iron ?? 130),
      wood: Math.max(110, settlement?.localResources.wood ?? 110),
      stone: Math.max(60, settlement?.localResources.stone ?? 60),
    };
    this.selectedUnitIds = new Set(['u_hero']);
    this.selectedBuildingId = null;
    this.equipment = {
      weapon: ITEM_CATALOG.iron_blade,
      armor: null,
      relic: null,
    };
    // §140.1 & §242: универсальные боевые зелья HP/Mana запрещены
    this.inventory = [];

    this.stats = {
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
      nextRaidTimer: 72,
      raidCount: 0,
    };

    this.buildMode = null;
    this.mobileMode = 'smart';
    this.hitstopTimer = 0;
    this.dismissedChestObjectId = null;
    this.lastCombatTime = -999;

    // Синхронизируем стартовые параметры Аватара из доменного ядра v14.2
    this.core.syncAvatarToSceneUnit(this.getHero());
    this.syncSelectionToCore();

    // Focus camera on Human settlement
    const focus = gridToWorld(10, 30, 1);
    this.camera = createCamera(focus.wx, focus.wy, DEFAULT_ZOOM);
    this.updateFogOfWar();

    if (startPlaying) {
      this.screen = 'PLAYING';
      this.showBanner('Сектор I — Исследуйте лес, добудьте ресурсы и разгромите лагерь врага');
    } else {
      this.screen = 'TITLE';
    }
  }

  public showBanner(msg: string, duration = 4.2) {
    this.bannerMessage = msg;
    this.bannerTimer = duration;
  }

  public saveGame(mode: 'manual' | 'auto' = 'manual'): boolean {
    if (mode === 'manual') {
      const check = this.core.canSaveNow(this.isPlayerInActiveCombat());
      if (!check.allowed) {
        this.showBanner(check.reasonRu ?? 'Сохранение недоступно во время боя', 3.2);
        return false;
      }
    }
    try {
      const payload = {
        saveFormatVersion: 3,
        saveKind: mode,
        savedAtIso: new Date().toISOString(),
        coreSnapshotJson: this.core.exportCoreSnapshotJson(),
        resources: this.resources,
        stats: this.stats,
        equipment: this.equipment,
        inventory: this.inventory,
        units: this.units,
        buildings: this.buildings,
        camera: this.camera,
        controlGroups: this.core.fieldSelection.controlGroups,
        activeFormation: this.core.activeFormation,
        idCounter: this.idCounter,
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
      const targetKey = mode === 'manual' ? MANUAL_SAVE_KEY : AUTO_SAVE_KEY;
      localStorage.setItem(targetKey, JSON.stringify(payload));
      if (mode === 'manual') {
        this.showBanner('Кампания сохранена');
      }
      return true;
    } catch {
      return false;
    }
  }

  private tryLoadFromStorageKey(storageKey: string): boolean {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const fresh = generateScenarioWorld();
      this.core.reset();
      if (typeof data.coreSnapshotJson === 'string') {
        const imported = this.core.importCoreSnapshotJson(data.coreSnapshotJson);
        if (!imported) {
          return false;
        }
      }
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
            const idx = tile.gy * MAP_SIZE + tile.gx;
            if (idx >= 0 && idx < this.core.fogGrid.tiles.length) {
              this.core.fogGrid.tiles[idx] =
                tu.fog === 2 ? 'Visible' : tu.fog === 1 ? 'ExploredShrouded' : 'Unexplored';
            }
          }
        }
      }
      this.resources = data.resources ?? this.resources;
      this.stats = data.stats ?? this.stats;
      this.equipment = data.equipment ?? this.equipment;
      this.inventory = (data.inventory ?? []).filter(
        (it: ItemDef) => it.slot !== 'consumable'
      );
      this.units = data.units ?? fresh.units;
      this.buildings = data.buildings ?? fresh.buildings;
      if (typeof data.idCounter === 'number' && data.idCounter > this.idCounter) {
        this.idCounter = data.idCounter;
      }
      if (data.controlGroups && typeof data.controlGroups === 'object') {
        for (const slot of [1, 2, 3, 4, 5, 6] as ControlGroupSlot[]) {
          const arr = data.controlGroups[slot];
          this.core.fieldSelection.controlGroups[slot] = Array.isArray(arr) ? [...arr] : [];
        }
      }
      if (typeof data.activeFormation === 'string') {
        this.core.activeFormation = data.activeFormation as FormationType;
      }
      const loadedCam = data.camera;
      this.camera = loadedCam
        ? createCamera(loadedCam.x ?? 0, loadedCam.y ?? 0, loadedCam.zoom ?? DEFAULT_ZOOM)
        : this.camera;
      this.clampCamera();
      this.projectiles = [];
      this.particles = [];
      this.floatingTexts = [];
      this.unitPaths.clear();
      this.dismissedChestObjectId = null;
      this.lastCombatTime = -999;
      this.selectedUnitIds = new Set(['u_hero']);
      this.selectedBuildingId = null;
      this.buildMode = null;
      this.screen = 'PLAYING';
      this.core.syncAvatarToSceneUnit(this.getHero());
      this.syncSelectionToCore();
      this.updateFogOfWar();
      return true;
    } catch {
      return false;
    }
  }

  public loadGame(source: 'manual' | 'auto' | 'latest' = 'latest'): boolean {
    const readTimestamp = (key: string): number => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return -1;
        const parsed = JSON.parse(raw);
        const ts = typeof parsed.savedAtIso === 'string' ? Date.parse(parsed.savedAtIso) : 0;
        return Number.isFinite(ts) ? ts : 0;
      } catch {
        return 0;
      }
    };

    let candidates: string[] = [];
    if (source === 'manual') {
      candidates = [MANUAL_SAVE_KEY, AUTO_SAVE_KEY];
    } else if (source === 'auto') {
      candidates = [AUTO_SAVE_KEY, MANUAL_SAVE_KEY];
    } else {
      const mTs = readTimestamp(MANUAL_SAVE_KEY);
      const aTs = readTimestamp(AUTO_SAVE_KEY);
      candidates =
        aTs > mTs ? [AUTO_SAVE_KEY, MANUAL_SAVE_KEY] : [MANUAL_SAVE_KEY, AUTO_SAVE_KEY];
    }

    let anyPresent = false;
    for (let i = 0; i < candidates.length; i++) {
      const key = candidates[i];
      let exists = false;
      try {
        exists = Boolean(localStorage.getItem(key));
      } catch {
        exists = false;
      }
      if (!exists) continue;
      anyPresent = true;
      if (this.tryLoadFromStorageKey(key)) {
        this.showBanner(i === 0 ? 'Сохранение загружено' : 'Загружено резервное сохранение');
        return true;
      }
    }

    if (anyPresent) {
      this.showBanner('Повреждена контрольная сумма файла сохранения');
    }
    return false;
  }

  public syncFromExternalCoreMutation(): void {
    this.core.syncAvatarToSceneUnit(this.getHero());
  }

  private getAliveHumanIds(): Set<string> {
    const ids = new Set<string>();
    for (const u of this.units) {
      if (u.faction === 'human' && (!u.deadTimer || u.deadTimer <= 0)) {
        ids.add(u.id);
      }
    }
    return ids;
  }

  private syncSelectionToCore(): void {
    this.core.syncSelection(this.selectedUnitIds, this.getAliveHumanIds());
  }

  public assignControlGroupSlot(slot: ControlGroupSlot): void {
    const count = this.core.assignGroup(slot, this.selectedUnitIds, this.getAliveHumanIds());
    if (count > 0) {
      sound.click();
      this.showBanner(`Группа ${slot} назначена (${count})`, 2.0);
    }
  }

  public recallControlGroupSlot(slot: ControlGroupSlot): void {
    const ids = this.core.recallGroup(slot, this.getAliveHumanIds());
    if (ids.length > 0) {
      this.selectedUnitIds = new Set(ids);
      this.selectedBuildingId = null;
      sound.click();
    }
  }

  public setFormation(formation: FormationType): boolean {
    const heroId = this.getHero()?.id ?? 'u_hero';
    const res = this.core.trySetFormation(formation, Array.from(this.selectedUnitIds), heroId);
    if (!res.ok) {
      this.showBanner(res.reasonRu ?? 'Формация недоступна', 2.6);
      return false;
    }
    sound.click();
    const label = formation === 'compact' ? 'Плотный строй' : formation === 'line' ? 'Линия' : 'Рассыпной строй';
    this.showBanner(`Формация отряда: ${label}`, 2.2);
    return true;
  }

  public castHeroSpell(spellId: string): boolean {
    const hero = this.getHero();
    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) {
      this.showBanner('Аватар возрождается у Камня Душ', 2.5);
      return false;
    }

    const cast = this.core.castAvatarSpell(spellId, hero);
    if (!cast.ok) {
      this.showBanner(cast.reasonRu ?? 'Заклинание недоступно', 2.4);
      return false;
    }

    hero.castAnimTimer = 0.45;
    hero.attackAnimTimer = 0.3;

    if (spellId === 'spell_elem_fire_bolt') {
      const target = this.findNearestEnemyUnit(hero.x, hero.y, 'orc', 9.0);
      const targetBld = !target ? this.findNearestEnemyBuilding(hero.x, hero.y, 'orc', 9.0) : null;
      const tx = target ? target.x : targetBld ? targetBld.gx + targetBld.size * 0.5 : hero.x + hero.facing * 4.2;
      const ty = target ? target.y : targetBld ? targetBld.gy + targetBld.size * 0.5 : hero.y - 1.5;

      const dmg = Math.max(24, Math.round(cast.effectPower));
      this.spawnProjectile(
        'human',
        hero.x,
        hero.y,
        tx,
        ty,
        target?.id,
        targetBld?.id,
        dmg,
        'fireball',
        'fire',
        { id: hero.id, name: hero.name }
      );
      this.spawnParticles(hero.x, hero.y, 14, '#f97316', 'magic', 12);
      this.particles.push({
        x: hero.x,
        y: hero.y,
        z: 4,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.36,
        maxLife: 0.36,
        size: 16,
        color: '#fb923c',
        kind: 'ring',
      });
      this.addFloatingText(hero.x, hero.y, `Огненный залп (-${cast.manaSpent} МП)`, '#fb923c');
      sound.heavyHit();
      return true;
    }

    if (spellId === 'spell_life_mend') {
      const healPower = Math.max(30, Math.round(cast.effectPower));
      let healedAny = 0;
      for (const u of this.units) {
        if (u.faction === 'human' && (!u.deadTimer || u.deadTimer <= 0)) {
          if (distGrid(hero.x, hero.y, u.x, u.y) <= 5.5) {
            const healed = this.core.computeCanonicalHeal(u, healPower);
            if (healed > 0) {
              u.hp = Math.min(u.maxHp, u.hp + healed);
              if (u.type === 'hero') {
                this.core.getAvatar().hp = u.hp;
              }
              this.addFloatingText(u.x, u.y, `+${healed} HP`, '#4ade80');
              healedAny += healed;
            }
          }
        }
      }
      this.particles.push({
        x: hero.x,
        y: hero.y,
        z: 2,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.65,
        maxLife: 0.65,
        size: 28,
        color: '#34d399',
        kind: 'rune_pillar',
      });
      this.spawnParticles(hero.x, hero.y, 18, '#4ade80', 'magic', 10);
      sound.levelUp();
      if (healedAny === 0) {
        this.addFloatingText(hero.x, hero.y, 'Здоровье полное', '#86efac');
      }
      return true;
    }

    if (spellId === 'spell_dark_raise_skeleton') {
      // Сначала поднимаем дремлющую нежить из Dormant_NoMana (§105.2), если она есть
      const reraised = this.core.reraiseDormantSkeletons();
      if (reraised > 0) {
        for (const u of this.units) {
          if (u.type === 'skeleton_minion' && u.dormant) {
            u.dormant = false;
            this.spawnParticles(u.x, u.y, 12, '#38bdf8', 'magic', 10);
          }
        }
        this.showBanner(`Повторно поднято скелетов: ${reraised}`, 2.5);
      }

      const minionId = this.nextId('skel');
      this.core.registerRaisedSkeleton(minionId);
      const sx = clamp(hero.x + (Math.random() - 0.5) * 1.4, 1.5, MAP_SIZE - 1.5);
      const sy = clamp(hero.y + (Math.random() - 0.5) * 1.4, 1.5, MAP_SIZE - 1.5);
      const skel = createUnit(minionId, 'human', 'skeleton_minion', sx, sy, {
        minionId,
        dormant: false,
        order: 'follow_hero',
      });
      this.units.push(skel);

      this.particles.push({
        x: sx,
        y: sy,
        z: 2,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.7,
        maxLife: 0.7,
        size: 22,
        color: '#38bdf8',
        kind: 'rune_pillar',
      });
      this.spawnParticles(sx, sy, 18, '#a78bfa', 'magic', 10);
      this.addFloatingText(sx, sy, 'Скелет призван', '#38bdf8');
      sound.levelUp();
      return true;
    }

    if (spellId === 'spell_elem_frost_nova') {
      const dmg = Math.max(22, Math.round(cast.effectPower));
      this.particles.push({
        x: hero.x,
        y: hero.y,
        z: 4,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.48,
        maxLife: 0.48,
        size: 32,
        color: '#38bdf8',
        kind: 'ring',
      });
      this.spawnParticles(hero.x, hero.y, 20, '#7dd3fc', 'magic', 10);
      this.addFloatingText(hero.x, hero.y, `Кольцо холода (-${cast.manaSpent} МП)`, '#38bdf8');
      sound.heavyHit();
      for (const e of [...this.units]) {
        if (e.faction === 'orc' && distGrid(hero.x, hero.y, e.x, e.y) <= 4.5) {
          this.damageUnit(e, dmg, hero, 'cold');
        }
      }
      return true;
    }

    if (spellId === 'spell_elem_spark') {
      const target = this.findNearestEnemyUnit(hero.x, hero.y, 'orc', 9.0);
      const targetBld = !target ? this.findNearestEnemyBuilding(hero.x, hero.y, 'orc', 9.0) : null;
      const tx = target ? target.x : targetBld ? targetBld.gx + targetBld.size * 0.5 : hero.x + hero.facing * 4.2;
      const ty = target ? target.y : targetBld ? targetBld.gy + targetBld.size * 0.5 : hero.y - 1.2;
      const dmg = Math.max(20, Math.round(cast.effectPower));
      this.spawnProjectile(
        'human',
        hero.x,
        hero.y,
        tx,
        ty,
        target?.id,
        targetBld?.id,
        dmg,
        'bolt',
        'lightning',
        { id: hero.id, name: hero.name }
      );
      this.spawnParticles(hero.x, hero.y, 12, '#fde047', 'spark', 10);
      this.addFloatingText(hero.x, hero.y, `Искра (-${cast.manaSpent} МП)`, '#fde047');
      sound.arrowShot();
      return true;
    }

    return true;
  }

  public takeLootEntry(entryId: string): void {
    const res = this.core.takeChestEntry(entryId, this.tiles);
    if (res.ok) {
      sound.gather();
      if (res.copperGained > 0) {
        const goldUnits = Math.max(10, Math.round(res.copperGained / 10));
        this.resources.gold += goldUnits;
        this.stats.gatheredGold += goldUnits;
      }
      if (res.allTaken) {
        this.grantHeroXp(45, 'chest_ruin_loot');
      }
    }
  }

  public takeAllLoot(): void {
    const res = this.core.takeAllChestEntries(this.tiles);
    if (res.ok) {
      sound.levelUp();
      if (res.copperGained > 0) {
        const goldUnits = Math.max(15, Math.round(res.copperGained / 10));
        this.resources.gold += goldUnits;
        this.stats.gatheredGold += goldUnits;
      }
      if (res.takenCount > 0) {
        this.grantHeroXp(45, 'chest_ruin_loot');
        this.showBanner(`Собрано трофеев: ${res.takenCount}`, 2.5);
      }
    }
  }

  public closeLootWindow(): void {
    this.dismissedChestObjectId = this.core.activeLootWindow?.objectId ?? null;
    this.core.activeLootWindow = null;
  }

  private formatHeroRespawnRefusal(actionRu: string): string {
    const hero = this.getHero();
    const coreSec = this.core.getAvatar().deathState.respawnRemainingSec;
    const rawSec = coreSec > 0 ? coreSec : hero?.deadTimer ?? 0;
    const sec = Math.max(1, Math.ceil(rawSec));
    return `Аватар пал — ${actionRu} можно после возрождения у Камня Душ (через ${sec} с)`;
  }

  public equipCoreItem(instanceId: string): boolean {
    const hero = this.getHero();
    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) {
      this.showBanner(this.formatHeroRespawnRefusal('надеть предмет'), 3.4);
      return false;
    }
    const res = this.core.equipCoreInventoryItem(instanceId, hero);
    if (!res.ok) {
      this.showBanner(res.reasonRu ?? 'Требования предмета не выполнены', 3.0);
      return false;
    }
    sound.click();
    this.addFloatingText(hero.x, hero.y, `Экипировано: ${res.itemNameRu ?? 'Предмет'}`, '#facc15');
    return true;
  }

  public unequipCoreSlot(slot: EquipSlotId): boolean {
    const hero = this.getHero();
    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) {
      this.showBanner(this.formatHeroRespawnRefusal('снять снаряжение'), 3.4);
      return false;
    }
    const res = this.core.unequipCoreEquipmentSlot(slot, hero);
    if (!res.ok) {
      this.showBanner(res.reasonRu ?? 'Не удалось снять предмет', 2.4);
      return false;
    }
    sound.click();
    return true;
  }

  public transcribeCoreScroll(instanceId: string): boolean {
    const hero = this.getHero();
    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) {
      this.showBanner(this.formatHeroRespawnRefusal('изучить свиток'), 3.4);
      return false;
    }
    const res = this.core.useCoreSpellScroll(instanceId, hero);
    if (!res.ok) {
      this.showBanner(res.reasonRu ?? 'Не удалось изучить свиток', 3.0);
      return false;
    }
    sound.levelUp();
    this.addFloatingText(hero.x, hero.y, `Изучено: ${res.spellNameRu ?? 'Заклинание'}`, '#38bdf8');
    this.showBanner(`Формула «${res.spellNameRu ?? 'Заклинание'}» перенесена в Гримуар`, 3.2);
    return true;
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
    let atk = u.baseAtk;
    let armor = u.baseArmor;
    let maxHp = u.maxHp;
    for (const slot of ['weapon', 'armor', 'relic'] as EquipSlot[]) {
      const item = this.equipment[slot];
      if (item && item.id !== 'iron_blade') {
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
      if (this.core.isCombatPotionBlocked('hp_potion')) {
        this.showBanner(
          'Боевые зелья здоровья и маны в бою не применяются. Используйте магию Жизни (G).',
          3.5
        );
        sound.click();
        return;
      }
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
    this.core.getAvatar().hp = Math.min(this.core.getAvatar().maxHp, hero.hp);
    sound.click();
    this.addFloatingText(hero.x, hero.y, `Экипировано: ${item.name}`, '#facc15');
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
        this.damageUnit(e, dmg, hero, 'physical');
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
    hero.castAnimTimer = 0.35;
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
          const heal = this.core.computeCanonicalHeal(u, 50);
          if (heal > 0) {
            u.hp = Math.min(u.maxHp, u.hp + heal);
            if (u.type === 'hero') {
              const avatar = this.core.getAvatar();
              avatar.hp = Math.min(avatar.maxHp, u.hp);
            }
            this.addFloatingText(u.x, u.y, `+${heal} HP`, '#4ade80');
          }
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
      this.syncSelectionToCore();
      this.centerCameraOn(hero.x, hero.y, false);
      sound.click();
    }
  }

  public selectAllArmy() {
    const combatUnits = this.units.filter(
      (u) =>
        u.faction === 'human' &&
        (!u.deadTimer || u.deadTimer <= 0) &&
        !u.dormant &&
        (u.type === 'hero' || u.type === 'swordsman' || u.type === 'archer' || u.type === 'skeleton_minion')
    );
    if (combatUnits.length > 0) {
      this.selectedUnitIds = new Set(combatUnits.map((u) => u.id));
      this.selectedBuildingId = null;
      this.syncSelectionToCore();
      sound.click();
    }
  }

  public selectUnitById(id: string) {
    this.selectedUnitIds = new Set([id]);
    this.selectedBuildingId = null;
    this.syncSelectionToCore();
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
    this.core.recordSettlementSpend(cost.wood, cost.stone, cost.gold);
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
      this.showBanner('Недостаточно ресурсов для строительства');
      return false;
    }
    if (!this.canPlaceBuildingAt(type, gx, gy)) {
      this.showBanner('Нельзя строить на занятой или неразведанной клетке');
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
    this.syncSelectionToCore();
    sound.buildPlace();
    this.spawnParticles(gx + b.size * 0.5, gy + b.size * 0.5, 14, '#d6d3d1', 'smoke', 10);
    this.updateFogOfWar();
    return true;
  }

  public repairBuilding(buildingId: string): boolean {
    const b = this.buildings.find((item) => item.id === buildingId);
    if (!b || !b.constructed || b.faction !== 'human') return false;
    if (b.hp >= b.maxHp) return false;

    const woodCost = DEFAULT_WORKING_ASSUMPTIONS.buildingRepairCostWood;
    const hpStep = DEFAULT_WORKING_ASSUMPTIONS.buildingRepairHpStep;
    if (this.resources.wood < woodCost) {
      this.showBanner(`Для ремонта требуется ${woodCost} древесины`, 2.6);
      return false;
    }

    this.spend({ gold: 0, wood: woodCost, stone: 0 });
    const prevHp = b.hp;
    b.hp = Math.min(b.maxHp, b.hp + hpStep);
    const healed = Math.round(b.hp - prevHp);
    sound.buildPlace();
    this.spawnParticles(b.gx + b.size * 0.5, b.gy + b.size * 0.5, 12, '#a3e635', 'spark', 10);
    this.addFloatingText(b.gx + b.size * 0.5, b.gy + b.size * 0.5, `Ремонт +${healed} ОЗ`, '#86efac');
    this.core.pushCombatLog(`Ремонт постройки: +${healed} ОЗ (-${woodCost} древесины)`, 'system');
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
      this.showBanner('Достигнут лимит отряда — постройте Ферму');
      return false;
    }
    if (!this.canAfford(bp.cost)) {
      this.showBanner('Недостаточно ресурсов для найма');
      return false;
    }
    if (b.queue.length >= 5) return false;

    this.spend(bp.cost);
    b.queue.push({ unitType, remaining: bp.trainTime, total: bp.trainTime });
    sound.click();
    if (b.hp < b.maxHp) {
      this.showBanner('Здание повреждено: очередь на паузе до ремонта древесиной', 3.0);
    }
    return true;
  }

  public assignIdleLaborer(kind: ResourceKind) {
    const idleLab =
      this.units.find(
        (u) => u.faction === 'human' && u.type === 'laborer' && u.order === 'idle'
      ) ?? this.units.find((u) => u.faction === 'human' && u.type === 'laborer');

    if (!idleLab) {
      this.showBanner('Нет доступных рабочих — наймите их в Ратуше');
      return;
    }

    const node = this.findNearestResource(idleLab.x, idleLab.y, kind, 40);
    const kindRu = kind === 'wood' ? 'леса' : kind === 'gold' ? 'руды' : 'камня';
    if (!node) {
      this.showBanner(`Поблизости не найдено месторождений (${kindRu})`);
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
    this.addFloatingText(node.gx + 0.5, node.gy + 0.5, `Добыча ${kindRu}`, '#facc15');
  }

  public issueCommandToSelected(cmd: 'stop' | 'follow_hero' | 'attack_move_forward') {
    const selected = this.getSelectedHumanUnits();
    if (selected.length === 0) return;

    if (cmd === 'stop') {
      for (const u of selected) {
        u.order = 'idle';
        u.targetUnitId = undefined;
        u.targetBuildingId = undefined;
        u.interactKind = undefined;
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
      this.showBanner('Отряд следует за Аватаром', 2.2);
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
      this.syncSelectionToCore();
      sound.click();
      return;
    }

    // Check clicking a Human building
    const hitBld = this.findBuildingAtGrid(igx, igy, 'human');
    if (hitBld) {
      this.selectedBuildingId = hitBld.id;
      this.selectedUnitIds.clear();
      this.syncSelectionToCore();
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
      const interactive = this.findInteractivePropAtGrid(igx, igy);
      if (interactive) {
        this.interactWithWorldTile(interactive);
        return;
      }
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
      this.syncSelectionToCore();
    }
  }

  public handleWorldSecondaryClick(
    sx: number,
    sy: number,
    vw: number,
    vh: number,
    modifier: 'none' | 'shift' | 'alt' = 'none'
  ) {
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

    if (modifier === 'shift') {
      this.issueWaypointOrPatrol(gx, gy, 'waypoint');
      return;
    }
    if (modifier === 'alt') {
      this.issueWaypointOrPatrol(gx, gy, 'patrol');
      return;
    }

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
    const interactive = this.findInteractivePropAtGrid(igx, igy);
    if (interactive) {
      this.interactWithWorldTile(interactive);
      return;
    }
    const tile = this.tiles[igy]?.[igx];
    if (tile && tile.resourceKind && (tile.resourceAmount ?? 0) > 0) {
      this.issueGatherTile(igx, igy);
      return;
    }

    this.issueMoveOrAttackPoint(gx, gy, false);
  }

  private findInteractivePropAtGrid(igx: number, igy: number): Tile | null {
    const isInteractive = (t: Tile | undefined): t is Tile =>
      Boolean(
        t &&
          t.fog > 0 &&
          ((t.prop === 'chest' && !t.chestLooted) ||
            t.prop === 'bindstone' ||
            t.prop === 'portal')
      );

    const exact = this.tiles[igy]?.[igx];
    if (isInteractive(exact)) return exact;

    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of offsets) {
      const nb = this.tiles[igy + dy]?.[igx + dx];
      if (isInteractive(nb)) return nb;
    }
    return null;
  }

  public interactWithWorldTile(tile: Tile): boolean {
    if (
      tile.prop !== 'chest' &&
      tile.prop !== 'bindstone' &&
      tile.prop !== 'portal'
    ) {
      return false;
    }
    const selected = this.getSelectedHumanUnits();
    const heroSelected = selected.some((u) => u.type === 'hero');
    const hero = this.getHero();

    if ((tile.prop === 'bindstone' || tile.prop === 'portal') && selected.length > 0 && !heroSelected) {
      const actorKind = selected[0].type === 'laborer' ? 'worker' : 'combat_unit';
      const res =
        tile.prop === 'bindstone'
          ? this.core.interactWithBindstone(actorKind)
          : this.core.interactWithPortal(actorKind, this.stats.commanderDefeated);
      this.showBanner(res.messageRu, 3.0);
      sound.click();
      return false;
    }

    if (!hero || (hero.deadTimer && hero.deadTimer > 0)) {
      this.showBanner('Взаимодействовать с объектом может только живой Аватар', 2.6);
      return false;
    }

    this.dismissedChestObjectId = null;
    hero.order = 'interact';
    hero.interactGx = tile.gx;
    hero.interactGy = tile.gy;
    hero.interactKind = tile.prop;
    hero.targetUnitId = undefined;
    hero.targetBuildingId = undefined;
    this.assignPathTo(hero, tile.gx + 0.5, tile.gy + 0.5, true);
    sound.command();
    this.particles.push({
      x: tile.gx + 0.5,
      y: tile.gy + 0.5,
      z: 3,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.45,
      maxLife: 0.45,
      size: 16,
      color: tile.prop === 'chest' ? '#facc15' : '#38bdf8',
      kind: 'ring',
    });
    return true;
  }

  public issueWaypointOrPatrol(gx: number, gy: number, mode: 'waypoint' | 'patrol') {
    const selected = this.getSelectedHumanUnits();
    if (selected.length === 0) return;

    const tx = clamp(gx, 1.2, MAP_SIZE - 1.2);
    const ty = clamp(gy, 1.2, MAP_SIZE - 1.2);

    for (const u of selected) {
      if (mode === 'patrol') {
        u.order = 'patrol';
        u.patrolLoop = true;
        u.waypoints = [
          { x: tx, y: ty },
          { x: u.x, y: u.y },
        ];
        u.targetX = tx;
        u.targetY = ty;
        u.targetUnitId = undefined;
        u.targetBuildingId = undefined;
        this.assignPathTo(u, tx, ty, false);
      } else {
        if (!u.waypoints) u.waypoints = [];
        u.waypoints.push({ x: tx, y: ty });
        u.patrolLoop = false;
        if (u.order === 'idle' || u.targetX === undefined || u.targetY === undefined) {
          const next = u.waypoints.shift()!;
          u.order = 'move';
          u.targetX = next.x;
          u.targetY = next.y;
          this.assignPathTo(u, next.x, next.y, false);
        }
      }
    }

    sound.command();
    this.particles.push({
      x: tx,
      y: ty,
      z: 2,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.45,
      maxLife: 0.45,
      size: 16,
      color: mode === 'patrol' ? '#38bdf8' : '#a78bfa',
      kind: 'ring',
    });
    this.addFloatingText(
      tx,
      ty,
      mode === 'patrol' ? 'Патруль' : 'Маршрутная точка',
      mode === 'patrol' ? '#38bdf8' : '#c4b5fd'
    );
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
      this.syncSelectionToCore();
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

    const form = this.core.activeFormation;
    const rawOffsets = computeFormationOffsets(selected.length);
    const scale =
      form === 'loose' ? 1.55 : form === 'compact' ? 0.85 : form === 'defensive' ? 0.92 : 1.05;

    selected.forEach((u, idx) => {
      const baseOff = rawOffsets[idx];
      const dx = form === 'line' ? (idx - (selected.length - 1) * 0.5) * 0.95 : baseOff.dx * scale;
      const dy = form === 'line' ? 0 : baseOff.dy * scale;
      const tx = clamp(gx + dx, 1.2, MAP_SIZE - 1.2);
      const ty = clamp(gy + dy, 1.2, MAP_SIZE - 1.2);
      u.order = attackMove ? 'attack_move' : 'move';
      u.targetX = tx;
      u.targetY = ty;
      u.waypoints = undefined;
      u.patrolLoop = false;
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
        this.addFloatingText(gx + 0.5, gy + 0.5, 'Рабочий отправлен', '#facc15');
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

    // 0. Authoritative v14.2 core simulation tick (mana, MagicStrain, 120s respawn, necromancy)
    const heroUnit = this.getHero();
    const coreTick = this.core.tickCoreSimulation(dt, heroUnit);
    if (coreTick.avatarRespawned && heroUnit) {
      const th = this.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall');
      heroUnit.x = th ? th.gx + 2.8 : 11.5;
      heroUnit.y = th ? th.gy + 2.2 : 32.2;
      heroUnit.order = 'idle';
      this.particles.push({
        x: heroUnit.x,
        y: heroUnit.y,
        z: 2,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.85,
        maxLife: 0.85,
        size: 28,
        color: '#38bdf8',
        kind: 'rune_pillar',
      });
      this.spawnParticles(heroUnit.x, heroUnit.y, 22, '#60a5fa', 'magic', 12);
      this.showBanner('Аватар возродился у Камня Душ', 3.6);
      sound.levelUp();
    }
    if (coreTick.dormantMinionIds.length > 0) {
      const dormantSet = new Set(coreTick.dormantMinionIds);
      for (const u of this.units) {
        if (u.minionId && dormantSet.has(u.minionId)) {
          u.dormant = true;
          u.order = 'idle';
          this.unitPaths.delete(u.id);
        }
      }
      this.showBanner('Мана истощена: скелеты перешли в покой до восстановления маны', 3.2);
    }

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

    // 6. Auto-save every 20 seconds (isolated slot §341.7)
    this.autoSaveTimer += dt;
    if (this.autoSaveTimer >= 20) {
      this.autoSaveTimer = 0;
      this.saveGame('auto');
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
          this.addFloatingText(b.gx + b.size * 0.5, b.gy + b.size * 0.5, `Построено: ${b.name}`, '#facc15');
        }
        continue;
      }

      // Training Queue (§15.8: paused while building is damaged)
      if (b.queue.length > 0 && !(b.faction === 'human' && b.hp < b.maxHp)) {
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
          this.addFloatingText(u.x, u.y, `Готов: ${u.name}`, '#60a5fa');
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
              'bolt',
              'physical',
              { id: b.id, name: b.name }
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
        // 120s Avatar respawn is driven authoritatively by CoreGameBridge.tickCoreSimulation (§288)
        continue;
      }

      if (u.dormant) {
        u.vx = 0;
        u.vy = 0;
        continue;
      }

      u.animTime += dt;
      if (u.atkTimer > 0) u.atkTimer = Math.max(0, u.atkTimer - dt);
      if (u.attackAnimTimer > 0) u.attackAnimTimer = Math.max(0, u.attackAnimTimer - dt);
      if (u.castAnimTimer && u.castAnimTimer > 0) {
        u.castAnimTimer = Math.max(0, u.castAnimTimer - dt);
      }
      if (u.hitFlashTimer > 0) u.hitFlashTimer = Math.max(0, u.hitFlashTimer - dt);

      if (u.type === 'hero') {
        if ((u.cleaveCooldown ?? 0) > 0) u.cleaveCooldown = Math.max(0, (u.cleaveCooldown ?? 0) - dt);
        if ((u.rallyCooldown ?? 0) > 0) u.rallyCooldown = Math.max(0, (u.rallyCooldown ?? 0) - dt);
        // Subtle passive regeneration synced to HeroState
        if (u.hp < u.maxHp) {
          u.hp = Math.min(u.maxHp, u.hp + dt * 1.4);
          this.core.getAvatar().hp = Math.min(this.core.getAvatar().maxHp, u.hp);
        }
        // Check proximity to §128 loot containers
        this.checkChestLoot(u);
      }

      // Reset velocity; movement step will populate it
      u.vx = 0;
      u.vy = 0;

      const enemyFaction = u.faction === 'human' ? 'orc' : 'human';

      // Auto-acquire enemies when idle, patrol, or attack-moving (non-laborer)
      if (
        u.type !== 'laborer' &&
        (u.order === 'idle' || u.order === 'attack_move' || u.order === 'follow_hero' || u.order === 'patrol')
      ) {
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
      } else if (
        u.order === 'interact' &&
        u.interactGx !== undefined &&
        u.interactGy !== undefined &&
        u.interactKind
      ) {
        const tx = u.interactGx + 0.5;
        const ty = u.interactGy + 0.5;
        if (distGrid(u.x, u.y, tx, ty) <= 1.95) {
          const tile = this.tiles[u.interactGy]?.[u.interactGx];
          if (u.interactKind === 'chest' && tile && !tile.chestLooted) {
            const win = this.core.openChestLootWindow(tile);
            if (win) {
              sound.click();
              this.spawnParticles(tx, ty, 14, '#facc15', 'magic', 8);
              this.showBanner(`Открыт сундук: ${win.titleRu}`, 3.2);
            }
          } else if (u.interactKind === 'bindstone') {
            const res = this.core.interactWithBindstone('avatar');
            this.particles.push({
              x: tx,
              y: ty,
              z: 2,
              vx: 0,
              vy: 0,
              vz: 0,
              life: 0.75,
              maxLife: 0.75,
              size: 26,
              color: '#38bdf8',
              kind: 'rune_pillar',
            });
            sound.levelUp();
            this.showBanner(res.messageRu, 3.6);
          } else if (u.interactKind === 'portal') {
            const res = this.core.interactWithPortal('avatar', this.stats.commanderDefeated);
            this.particles.push({
              x: tx,
              y: ty,
              z: 4,
              vx: 0,
              vy: 0,
              vz: 0,
              life: 0.65,
              maxLife: 0.65,
              size: 28,
              color: '#818cf8',
              kind: 'ring',
            });
            sound.click();
            this.showBanner(res.messageRu, 3.8);
          }
          u.order = 'idle';
          u.interactGx = undefined;
          u.interactGy = undefined;
          u.interactKind = undefined;
          this.unitPaths.delete(u.id);
        } else {
          this.moveAlongPathOrDirect(u, tx, ty, dt);
        }
      } else if (
        (u.order === 'move' || u.order === 'attack_move' || u.order === 'patrol') &&
        u.targetX !== undefined &&
        u.targetY !== undefined
      ) {
        const arrived = this.moveAlongPathOrDirect(u, u.targetX, u.targetY, dt);
        if (arrived) {
          if (u.waypoints && u.waypoints.length > 0) {
            if (u.patrolLoop) {
              const finished = u.waypoints.shift()!;
              u.waypoints.push(finished);
              const next = u.waypoints[0];
              u.targetX = next.x;
              u.targetY = next.y;
              this.assignPathTo(u, next.x, next.y, false);
            } else {
              const next = u.waypoints.shift()!;
              u.targetX = next.x;
              u.targetY = next.y;
              this.assignPathTo(u, next.x, next.y, false);
            }
          } else {
            u.order = 'idle';
            u.targetX = undefined;
            u.targetY = undefined;
          }
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
            u.faction === 'human' ? 'arrow' : 'orc_arrow',
            'physical',
            { id: u.id, name: u.name }
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
            u.faction === 'human' ? 'arrow' : 'orc_arrow',
            'physical',
            { id: u.id, name: u.name }
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
        this.core.recordSettlementDelivery(kind, amt);
        if (kind === 'wood') this.stats.gatheredWood += amt;
        if (kind === 'gold') this.stats.gatheredGold += amt;
        if (kind === 'stone') this.stats.gatheredStone += amt;

        const color = kind === 'gold' ? '#facc15' : kind === 'wood' ? '#84cc16' : '#cbd5e1';
        const kindLabel = kind === 'gold' ? 'руды' : kind === 'wood' ? 'древесины' : 'камня';
        this.addFloatingText(tx, ty, `+${amt} ${kindLabel}`, color);
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
    if (this.core.activeLootWindow) return;
    if (this.dismissedChestObjectId) {
      let stillNearDismissed = false;
      for (const row of this.tiles) {
        for (const t of row) {
          if (t.chestObjectId === this.dismissedChestObjectId) {
            if (distGrid(hero.x, hero.y, t.gx + 0.5, t.gy + 0.5) <= 2.5) {
              stillNearDismissed = true;
            }
          }
        }
      }
      if (!stillNearDismissed) {
        this.dismissedChestObjectId = null;
      }
    }

    const igx = Math.floor(hero.x);
    const igy = Math.floor(hero.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.tiles[igy + dy]?.[igx + dx];
        if (t && t.prop === 'chest' && !t.chestLooted && t.chestObjectId) {
          if (t.chestObjectId === this.dismissedChestObjectId) continue;
          const win = this.core.openChestLootWindow(t);
          if (win) {
            sound.click();
            this.spawnParticles(t.gx + 0.5, t.gy + 0.5, 14, '#facc15', 'magic', 8);
            this.showBanner(`Открыт сундук: ${win.titleRu}`, 3.2);
            return;
          }
        }
      }
    }
  }

  private damageUnit(
    target: Unit,
    rawDamage: number,
    attacker?: Unit,
    damageType: DamageType = 'physical',
    attackerMeta?: { name?: string; faction?: Faction; isHero?: boolean }
  ) {
    this.lastCombatTime = this.time;
    const eff = this.getUnitEffectiveStats(target);
    const targetHasShield =
      target.type === 'swordsman' ||
      target.type === 'orc_commander' ||
      (target.type === 'hero' && Boolean(this.core.getAvatar().equipment.off_hand));
    const targetShieldMastery =
      target.type === 'hero'
        ? this.core.getAvatar().combatMasteries.shields
        : targetHasShield
        ? 10
        : 0;

    const fallbackFaction: Faction =
      attacker?.faction ?? attackerMeta?.faction ?? (target.faction === 'human' ? 'orc' : 'human');
    const resolvedAttackerName =
      attacker?.name ??
      attackerMeta?.name ??
      (fallbackFaction === 'orc' ? 'Противник' : 'Союзник');

    const resolved = this.core.computeCombatDamage({
      attackerIsHero: attacker?.type === 'hero' || Boolean(attackerMeta?.isHero),
      attackerName: resolvedAttackerName,
      targetName: target.name,
      rawDamage,
      damageType,
      targetHp: target.hp,
      targetArmor: eff.armor,
      targetIsBoss: target.type === 'orc_commander',
      targetHasShield,
      targetShieldMastery,
    });

    if (resolved.missed) {
      this.addFloatingText(target.x, target.y, 'Промах', '#94a3b8');
      return;
    }

    const dmg = resolved.finalDamage;
    target.hitFlashTimer = 0.12;
    const fxColor =
      damageType === 'fire'
        ? '#fb923c'
        : damageType === 'cold'
        ? '#38bdf8'
        : damageType === 'lightning'
        ? '#fde047'
        : target.faction === 'orc'
        ? '#84cc16'
        : '#ef4444';
    this.spawnParticles(
      target.x,
      target.y,
      5,
      fxColor,
      damageType === 'physical' ? 'blood' : 'spark',
      8
    );
    this.addFloatingText(
      target.x,
      target.y,
      resolved.blocked ? `Блок -${dmg}` : `-${dmg}`,
      resolved.blocked
        ? '#93c5fd'
        : damageType === 'fire'
        ? '#fb923c'
        : damageType === 'cold'
        ? '#38bdf8'
        : damageType === 'lightning'
        ? '#fde047'
        : target.faction === 'orc'
        ? '#fca5a5'
        : '#f87171'
    );

    if (target.type === 'hero') {
      const deathRes = this.core.applyDamageToAvatar(target, dmg);
      if (deathRes.died) {
        this.selectedUnitIds.delete(target.id);
        this.syncSelectionToCore();
        this.camera.shake = 7;
        this.showBanner(
          `Аватар пал! Возрождение у Камня Душ через ${deathRes.respawnSec} с...`,
          5.0
        );
      }
      return;
    }

    target.hp -= dmg;
    if (target.hp <= 0) {
      target.hp = 0;
      this.core.pushCombatLog(`${target.name} повержен`, 'kill');

      if (target.type === 'skeleton_minion' && target.minionId) {
        this.core.removeDestroyedSkeleton(target.minionId);
      }

      // Remove non-hero unit
      this.units = this.units.filter((u) => u.id !== target.id);
      this.selectedUnitIds.delete(target.id);
      this.unitPaths.delete(target.id);
      this.syncSelectionToCore();

      this.spawnParticles(target.x, target.y, 12, '#dc2626', 'smoke', 10);
      if (target.faction === 'orc') {
        this.stats.orcsSlain += 1;
        const bounty = target.type === 'orc_commander' ? 150 : 12;
        this.resources.gold += bounty;
        this.stats.gatheredGold += bounty;
        this.core.recordSettlementDelivery('gold', bounty);
        this.grantHeroXp(target.type === 'orc_commander' ? 120 : 28, target.type);

        if (target.type === 'orc_commander') {
          this.stats.commanderDefeated = true;
          this.hitstopTimer = 0.075;
          this.camera.shake = 11;
          this.inventory.push(ITEM_CATALOG.crown_plate);
          this.core.addPrototypeLootToPartyInventory('item_armor_brigandine', 1);
          this.showBanner('Военачальник врагов повержен! Победа!', 5.0);
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
        this.core.recordSettlementDelivery('gold', 50);
        this.grantHeroXp(50, 'orc_structure');
        this.addFloatingText(b.gx + 1, b.gy + 1, '+50 золота', '#facc15');
      }
    }
  }

  private grantHeroXp(amount: number, variantId = 'orc_warrior') {
    const hero = this.getHero();
    if (!hero) return;
    const res = this.core.grantAvatarXp(variantId, amount, hero);
    if (res.leveledUpTo !== null) {
      sound.levelUp();
      this.particles.push({
        x: hero.x,
        y: hero.y,
        z: 2,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0.75,
        maxLife: 0.75,
        size: 24,
        color: '#facc15',
        kind: 'rune_pillar',
      });
      this.spawnParticles(hero.x, hero.y, 18, '#facc15', 'magic', 14);
      this.addFloatingText(hero.x, hero.y, `УРОВЕНЬ ${res.leveledUpTo}!`, '#facc15');
      this.showBanner(`Аватар достиг уровня ${res.leveledUpTo}! Получены очки развития`, 3.5);
    }
  }

  private updateProjectiles(dt: number) {
    for (const p of [...this.projectiles]) {
      p.progress += dt / p.duration;
      if (p.progress >= 1) {
        const dmgType = p.damageType ?? 'physical';
        const resolvedAttacker = p.attackerId
          ? this.units.find((u) => u.id === p.attackerId)
          : undefined;
        const hero = this.getHero();
        const isHeroProjectile =
          resolvedAttacker?.type === 'hero' ||
          (hero !== null && p.attackerId === hero.id) ||
          (p.faction === 'human' && (p.kind === 'fireball' || p.kind === 'necrotic_orb'));
        const attackerMeta = {
          name:
            resolvedAttacker?.name ??
            p.attackerName ??
            (p.faction === 'orc' ? 'Противник' : 'Союзник'),
          faction: p.faction,
          isHero: isHeroProjectile,
        };

        if (p.targetUnitId) {
          const tu = this.units.find(
            (u) => u.id === p.targetUnitId && (!u.deadTimer || u.deadTimer <= 0)
          );
          if (tu) {
            this.damageUnit(tu, p.damage, resolvedAttacker, dmgType, attackerMeta);
          }
        } else if (p.targetBuildingId) {
          const tb = this.buildings.find((b) => b.id === p.targetBuildingId);
          if (tb) this.damageBuilding(tb, p.damage);
        }

        if (p.kind === 'fireball') {
          this.particles.push({
            x: p.targetX,
            y: p.targetY,
            z: 5,
            vx: 0,
            vy: 0,
            vz: 0,
            life: 0.42,
            maxLife: 0.42,
            size: 24,
            color: '#f97316',
            kind: 'ring',
          });
          this.spawnParticles(p.targetX, p.targetY, 18, '#fb923c', 'spark', 10);
          this.camera.shake = Math.max(this.camera.shake, 3.5);
          sound.heavyHit();
          for (const e of [...this.units]) {
            if (
              e.faction === 'orc' &&
              e.id !== p.targetUnitId &&
              distGrid(p.targetX, p.targetY, e.x, e.y) <= 1.65
            ) {
              this.damageUnit(
                e,
                Math.round(p.damage * 0.45),
                resolvedAttacker ?? hero ?? undefined,
                'fire',
                attackerMeta
              );
            }
          }
        }

        this.projectiles = this.projectiles.filter((item) => item.id !== p.id);
      } else {
        p.x = p.startX + (p.targetX - p.startX) * p.progress;
        p.y = p.startY + (p.targetY - p.startY) * p.progress;
        p.z = 12 + Math.sin(p.progress * Math.PI) * (p.kind === 'fireball' ? 10 : 18);
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
    kind: Projectile['kind'],
    damageType: DamageType = 'physical',
    attacker?: { id?: string; name: string }
  ) {
    const dist = distGrid(sx, sy, tx, ty);
    this.projectiles.push({
      id: this.nextId('proj'),
      faction,
      attackerId: attacker?.id,
      attackerName: attacker?.name,
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
      damageType,
      progress: 0,
      duration: Math.max(0.14, dist * (kind === 'fireball' ? 0.06 : 0.075)),
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
      this.showBanner('Вражеский отряд движется к вашему поселению!', 4.5);
    }
  }

  private updateFogOfWar() {
    const observers: Array<{ x: number; y: number; visionRadius: number }> = [];
    for (const u of this.units) {
      if (u.faction === 'human' && (!u.deadTimer || u.deadTimer <= 0)) {
        observers.push({
          x: u.x,
          y: u.y,
          visionRadius: u.type === 'hero' ? 6.8 : u.type === 'skeleton_minion' ? 4.5 : 5.4,
        });
      }
    }
    for (const b of this.buildings) {
      if (b.faction === 'human') {
        observers.push({
          x: b.gx + b.size * 0.5,
          y: b.gy + b.size * 0.5,
          visionRadius: b.type === 'tower' ? 7.8 : 6.4,
        });
      }
    }

    const res = this.core.syncFogOfWar(observers, this.tiles);
    if (!this.stats.orcCampDiscovered && res.orcCampSeen) {
      this.stats.orcCampDiscovered = true;
      this.showBanner('Лагерь врага обнаружен! Разгромите гарнизон и его командира!', 4.0);
    }
    this.stats.exploredCount = res.exploredCount;
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
        title: 'Разведать окрестности сектора',
        completed: this.stats.exploredCount >= exploredGoal,
        progressText: `${Math.min(this.stats.exploredCount, exploredGoal)}/${exploredGoal} кл.`,
      },
      {
        id: 'resources',
        title: 'Собрать древесину и руду',
        completed: this.stats.gatheredWood >= woodGoal && this.stats.gatheredGold >= goldGoal,
        progressText: `${Math.min(this.stats.gatheredWood, woodGoal)}/${woodGoal} Д · ${Math.min(
          this.stats.gatheredGold,
          goldGoal
        )}/${goldGoal} З`,
      },
      {
        id: 'barracks',
        title: 'Построить Казармы',
        completed: this.stats.barracksBuilt,
        progressText: this.stats.barracksBuilt ? 'Готово' : '0/1',
      },
      {
        id: 'swordsmen',
        title: 'Нанять 5 мечников',
        completed: this.stats.swordsmenRecruited >= swordsmenGoal,
        progressText: `${Math.min(this.stats.swordsmenRecruited, swordsmenGoal)}/${swordsmenGoal}`,
      },
      {
        id: 'orc_camp',
        title: 'Обнаружить вражеский лагерь',
        completed: this.stats.orcCampDiscovered,
        progressText: this.stats.orcCampDiscovered ? 'Найден' : 'Скрыт',
      },
      {
        id: 'commander',
        title: 'Повергнуть командира врага',
        completed: this.stats.commanderDefeated,
        progressText: this.stats.commanderDefeated ? 'Повержен' : 'Активен',
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
      v14Core: this.core.buildHudSummary(Array.from(this.selectedUnitIds), hero?.id ?? 'u_hero', {
        inCombat: this.isPlayerInActiveCombat(),
        hasManualSave: this.hasManualSave(),
        hasAutoSave: this.hasAutoSave(),
      }),
    };
  }
}
