import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateAttributePoint, allocateMagicSchoolPoint } from '../src/core/progression';
import { GameEngine } from '../src/game/engine';
import { createCamera, gridToWorld, worldToScreen } from '../src/game/iso';
import { projectGridPoint3D } from '../src/game/isoRenderer3D';
import { ITEM_CATALOG } from '../src/game/types';

test('T-V14-49: Живая сцена GameEngine исполняет магию v14.2, MagicStrain, некромантию (§105), запрет зелий (§140.1/§242) и возрождение 120с (§288)', () => {
  const engine = new GameEngine();
  engine.initNewWorld(true);

  const hero = engine.getHero();
  assert.ok(hero, 'Аватар должен присутствовать на сцене');
  const snapStart = engine.getHudSnapshot();
  assert.ok(snapStart.v14Core, 'HudSnapshot должен содержать сводку v14Core');
  assert.equal(engine.inventory.some((i) => i.slot === 'consumable'), false, 'Стартовых боевых зелий нет');

  // Запрет боевых зелий (§140.1, §242)
  engine.inventory.push(ITEM_CATALOG.healing_draught);
  const invIdx = engine.inventory.length - 1;
  hero.hp = Math.max(10, hero.maxHp - 50);
  engine.core.getAvatar().hp = hero.hp;
  const hpBeforePotion = hero.hp;
  engine.equipOrUseItem(invIdx);
  assert.equal(hero.hp, hpBeforePotion, 'Боевое зелье не должно восстанавливать HP (§242)');
  assert.equal(engine.inventory.length, invIdx + 1, 'Боевое зелье не расходуется');

  // Каст заклинания Огненный разряд (F) тратит ману и повышает MagicStrain (§§38–43)
  const manaBefore = engine.core.getAvatar().mana;
  const strainBefore = engine.core.getAvatar().magicStrain.index;
  const castFire = engine.castHeroSpell('spell_elem_fire_bolt');
  assert.equal(castFire, true, 'Огненный разряд должен успешно применяться');
  assert.ok(engine.core.getAvatar().mana < manaBefore, 'Мана Аватара должна уменьшиться');
  assert.ok(
    engine.core.getAvatar().magicStrain.index > strainBefore,
    'MagicStrain должен вырасти после заклинания'
  );
  assert.ok(
    engine.projectiles.some((p) => p.kind === 'fireball' && p.damageType === 'fire'),
    'На сцене должен появиться 3D-снаряд fireball с damageType=fire'
  );

  // Каст некромантии Поднять скелета (X) создаёт живого скелета и регистрирует его в activeMap.necromancyMinions (§105)
  engine.core.getAvatar().mana = engine.core.getAvatar().maxMana;
  const castSkel = engine.castHeroSpell('spell_dark_raise_skeleton');
  assert.equal(castSkel, true, 'Призыв скелета должен успешно сработать');
  assert.ok(
    engine.units.some((u) => u.type === 'skeleton_minion' && !u.dormant),
    'На карте должен появиться активный skeleton_minion'
  );
  assert.ok(
    engine.core.sandbox.activeMap.necromancyMinions.length >= 1,
    'Скелет должен быть зарегистрирован в activeMap.necromancyMinions'
  );

  // Смерть Аватара запускает канонический таймер возрождения 120с у Stone of Souls (§288)
  const deathRes = engine.core.applyDamageToAvatar(hero, 99999);
  assert.equal(deathRes.died, true);
  assert.equal(deathRes.respawnSec, 120, 'Таймер возрождения должен быть равен ровно 120с (§288)');
  assert.equal(engine.core.getAvatar().deathState.lifecycle, 'RespawnPending');
  assert.equal(hero.deadTimer, 120);

  // Продвигаем симуляцию на 120с — Аватар возрождается
  const tickRes = engine.core.tickCoreSimulation(120, hero);
  assert.equal(tickRes.avatarRespawned, true, 'Через 120с Аватар должен возродиться');
  assert.equal(engine.core.getAvatar().deathState.lifecycle, 'Alive');
  assert.equal(hero.deadTimer, 0);
});

test('T-V14-50: Группы 1–6 (§292.7), блокировка формаций Аватара (§292.10), маршрутные точки/патруль (§292.8), окно добычи (§128) и SaveSnapshot v3 (§341.8)', () => {
  const engine = new GameEngine();
  engine.initNewWorld(true);
  const hero = engine.getHero()!;

  // Формация при выбранном только Аватаре заблокирована (§292.10)
  engine.selectedUnitIds = new Set([hero.id]);
  assert.equal(
    engine.setFormation('line'),
    false,
    'При выделении только Аватара кнопка формаций должна быть заблокирована (§292.10)'
  );

  // Формация при выделении Аватара в составе группы также заблокирована (§292.10)
  const allHumans = engine.units.filter((u) => u.faction === 'human').map((u) => u.id);
  engine.selectedUnitIds = new Set(allHumans);
  assert.equal(
    engine.setFormation('line'),
    false,
    'При наличии Аватара в группе кнопка формаций остаётся заблокированной (§292.10)'
  );

  // При выделении отряда без Аватара (>= 2 бойца) формация применяется (§292.10)
  const nonHeroHumans = engine.units
    .filter((u) => u.faction === 'human' && u.type !== 'hero')
    .map((u) => u.id);
  assert.ok(nonHeroHumans.length >= 2, 'Должно быть минимум 2 бойца/рабочих помимо Аватара');
  engine.selectedUnitIds = new Set(nonHeroHumans);
  assert.equal(engine.setFormation('line'), true, 'Формация должна применяться к отряду без Аватара');
  assert.equal(engine.core.activeFormation, 'line');

  engine.selectedUnitIds = new Set(allHumans);
  engine.assignControlGroupSlot(3);
  engine.selectedUnitIds = new Set([hero.id]);
  engine.recallControlGroupSlot(3);
  assert.equal(
    engine.selectedUnitIds.size,
    allHumans.length,
    'Группа 3 должна восстанавливать всех живых бойцов (§292.7)'
  );

  // Маршрутные точки и патруль (§292.8)
  engine.selectedUnitIds = new Set([hero.id]);
  engine.issueWaypointOrPatrol(15, 28, 'patrol');
  assert.equal(hero.order, 'patrol');
  assert.equal(hero.patrolLoop, true);
  assert.ok((hero.waypoints?.length ?? 0) >= 2);

  // Окно добычи контейнера (§128): открытие, выборочный подбор и «Взять всё»
  const chestTile = engine.tiles.flat().find((t) => t.prop === 'chest' && t.chestObjectId);
  assert.ok(chestTile, 'На карте должен быть хотя бы один сундук с chestObjectId');
  const win = engine.core.openChestLootWindow(chestTile!);
  assert.ok(win && win.entries.length >= 2, 'Окно добычи должно открываться со списком трофеев');
  const firstEntryId = win!.entries[0].entryId;
  engine.takeLootEntry(firstEntryId);
  assert.ok(
    engine.core.activeLootWindow !== null,
    'После выборочного взятия одного предмета окно остаётся открытым для оставшихся'
  );
  engine.takeAllLoot();
  assert.equal(engine.core.activeLootWindow, null, 'После «Взять всё» окно добычи закрывается');
  assert.equal(chestTile!.chestLooted, true, 'Сундук помечен как облутанный');

  // Экспорт и валидация SaveSnapshot v3 с FNV-1a (§341.8)
  const exported = engine.core.exportCoreSnapshotJson();
  const parsed = JSON.parse(exported);
  assert.equal(parsed.saveFormatVersion, 3);
  assert.ok(typeof parsed.checksum === 'string' && parsed.checksum.length === 8);
  assert.equal(engine.core.importCoreSnapshotJson(exported), true, 'Валидный снимок v3 должен загружаться');
  const corrupted = exported.replace(parsed.checksum, 'deadbeef');
  assert.equal(
    engine.core.importCoreSnapshotJson(corrupted),
    false,
    'Повреждённый снимок v3 с неверным FNV-1a должен отклоняться'
  );
});

test('T-V14-51: Точное совпадение 1:1 3D-ортографической проекции Three.js с 2D-изометрией iso.ts (< 0.01 px)', () => {
  const viewports: Array<[number, number]> = [
    [1280, 720],
    [390, 844],
    [1920, 1080],
  ];
  const zooms = [1.0, 1.35, 2.25, 3.0];
  const samplePoints: Array<[number, number, number]> = [
    [0, 0, 0],
    [10.5, 1, 30.5],
    [21.25, 2, 18.75],
    [34.8, 1, 9.2],
    [13.5, 0, 26.5],
  ];

  for (const [vw, vh] of viewports) {
    for (const zoom of zooms) {
      const centerW = gridToWorld(17.4, 22.8, 1);
      const cam = createCamera(centerW.wx, centerW.wy, zoom);
      for (const [gx, elev, gy] of samplePoints) {
        const w2d = gridToWorld(gx, gy, elev);
        const s2d = worldToScreen(w2d.wx, w2d.wy, cam, vw, vh);
        const s3d = projectGridPoint3D(gx, elev, gy, cam, vw, vh);

        const errX = Math.abs(s3d.sx - s2d.sx);
        const errY = Math.abs(s3d.sy - s2d.sy);
        assert.ok(
          errX < 0.01 && errY < 0.01,
          `Отклонение 3D/2D проекции (${errX.toFixed(4)}, ${errY.toFixed(4)}) px в точке (${gx},${elev},${gy}) при zoom=${zoom}`
        );
      }
    }
  }
});

test('T-V14-52: Полный игровой цикл вертикального среза (движение, туман, объекты мира §316, добыча/экипировка из PartyInventory, свиток Кольца холода, бой + журнал, пауза/ремонт здания §15.8)', () => {
  const engine = new GameEngine();
  engine.initNewWorld(true);
  const hero = engine.getHero()!;
  const initialExplored = engine.stats.exploredCount;

  // 1. Взаимодействие с объектами мира (§316): обычный боец НЕ может активировать Камень Душ или Портал
  const bindstoneTile = engine.tiles.flat().find((t) => t.prop === 'bindstone');
  const portalTile = engine.tiles.flat().find((t) => t.prop === 'portal');
  assert.ok(bindstoneTile, 'На карте должен быть Камень Душ (bindstone)');
  assert.ok(portalTile, 'На карте должен быть Портал сектора (portal)');

  const nonHeroUnit = engine.units.find((u) => u.faction === 'human' && u.type !== 'hero')!;
  engine.selectedUnitIds = new Set([nonHeroUnit.id]);
  assert.equal(
    engine.interactWithWorldTile(bindstoneTile!),
    false,
    'Обычный боец не может активировать Камень Душ (§316)'
  );
  assert.equal(
    engine.interactWithWorldTile(portalTile!),
    false,
    'Обычный боец не может активировать Портал (§316)'
  );

  // Аватар идёт к Камню Душ и активирует его
  engine.selectedUnitIds = new Set([hero.id]);
  assert.equal(engine.interactWithWorldTile(bindstoneTile!), true);
  for (let i = 0; i < 80; i++) {
    engine.update(0.05);
    if (hero.order === 'idle') break;
  }
  assert.equal(
    engine.core.sandbox.activeMap.worldObjects?.stone_sector_a_01?.activated,
    true,
    'Аватар должен активировать Камень Душ'
  );

  // 2. Перемещение к сундуку северного перевала (содержит свиток Кольца холода) и исследование тумана войны
  const chestNe = engine.tiles.flat().find((t) => t.chestObjectId === 'chest_ruin_ne')!;
  assert.ok(chestNe, 'Сундук северного перевала должен существовать');
  hero.x = chestNe.gx - 1;
  hero.y = chestNe.gy;
  engine.update(0.05);
  assert.ok(
    engine.stats.exploredCount > initialExplored,
    'Перемещение Аватара должно открывать новые клетки тумана войны'
  );
  assert.ok(engine.core.activeLootWindow, 'Подойдя к сундуку, Аватар открывает окно добычи (§128)');

  // Проверяем, что закрытие окна не переоткрывает его мгновенно, пока Аватар рядом
  engine.closeLootWindow();
  engine.update(0.05);
  assert.equal(engine.core.activeLootWindow, null, 'Закрытое окно добычи не должно спамить повторно');

  // Явный клик/взаимодействие снова открывает сундук и собирает трофеи в PartyInventory
  engine.interactWithWorldTile(chestNe);
  engine.update(0.05);
  assert.ok(engine.core.activeLootWindow, 'Явное взаимодействие с сундуком должно открывать окно добычи');
  engine.takeAllLoot();
  assert.equal(chestNe.chestLooted, true);

  // 3. Проверка реальной экипировки через PartyInventory и сохранности статов после тиков симуляции
  const hudAfterLoot = engine.getHudSnapshot();
  const scrollItem = hudAfterLoot.v14Core?.corePartyInventory.find(
    (it) => it.definitionId === 'item_scroll_frost_nova'
  );
  assert.ok(scrollItem, 'Свиток Кольца холода из сундука должен оказаться в PartyInventory');

  // Перенос формулы со свитка в Гримуар (§140.4): при мастерстве Стихий 1 формула KnownUnavailable,
  // а после повышения мастерства Стихий до 2 становится ReadyToLearn
  assert.equal(engine.transcribeCoreScroll(scrollItem!.instanceId), true);
  assert.equal(
    engine.core.getAvatar().spells.spell_elem_frost_nova?.acquisitionState,
    'KnownUnavailable',
    'При недостаточном мастерстве Стихий формула после свитка должна стать KnownUnavailable (§140.4)'
  );
  const upSchool1 = allocateMagicSchoolPoint(
    engine.core.sandbox.campaign,
    engine.core.sandbox.campaign.avatarId,
    'elemental'
  );
  const upSchool2 = allocateMagicSchoolPoint(
    engine.core.sandbox.campaign,
    engine.core.sandbox.campaign.avatarId,
    'elemental'
  );
  assert.equal(upSchool1.ok && upSchool2.ok, true, 'Повышение мастерства Стихий с 0 до 2 за очки магии должно сработать');
  assert.equal(
    engine.core.getAvatar().spells.spell_elem_frost_nova?.acquisitionState,
    'ReadyToLearn',
    'После достижения мастерства Стихий >= 2 формула должна стать ReadyToLearn (§140.4)'
  );

  // Надеваем реальную бригантину из PartyInventory: при STA=10 срабатывает запрет (§1.5),
  // после вложения 2 очков характеристик в STA до 12 — предмет надевается и бонус брони сохраняется после тиков update()
  engine.core.addPrototypeLootToPartyInventory('item_armor_brigandine', 1);
  const brigItem = engine
    .getHudSnapshot()
    .v14Core?.corePartyInventory.find((it) => it.definitionId === 'item_armor_brigandine');
  assert.ok(brigItem, 'Бригантина должна присутствовать в PartyInventory');
  assert.equal(engine.equipCoreItem(brigItem!.instanceId), false, 'Без STA >= 12 бригантину надеть нельзя (§1.5)');
  assert.equal(
    allocateAttributePoint(engine.core.sandbox.campaign, engine.core.sandbox.campaign.avatarId, 'STA').ok,
    true
  );
  assert.equal(
    allocateAttributePoint(engine.core.sandbox.campaign, engine.core.sandbox.campaign.avatarId, 'STA').ok,
    true
  );
  const armorBefore = hero.baseArmor;
  assert.equal(engine.equipCoreItem(brigItem!.instanceId), true, 'При STA >= 12 бригантина должна экипироваться');
  engine.update(0.05);
  engine.update(0.05);
  assert.ok(
    hero.baseArmor > armorBefore,
    `Бонус брони от экипировки из ядра должен сохраняться после тиков симуляции (${armorBefore} -> ${hero.baseArmor})`
  );

  // 4. Реальный боевой эпизод с журналом боя и новым заклинанием Кольцо холода (C)
  const enemy = engine.units.find((u) => u.faction === 'orc' && u.type !== 'orc_commander')!;
  assert.ok(enemy, 'На карте должен быть вражеский боец');
  enemy.x = hero.x + 1.8;
  enemy.y = hero.y;
  const enemyHpBefore = enemy.hp;
  engine.core.getAvatar().mana = engine.core.getAvatar().maxMana;
  assert.equal(engine.castHeroSpell('spell_elem_frost_nova'), true, 'Кольцо холода должно успешно кастоваться');
  assert.ok(enemy.hp < enemyHpBefore, 'Кольцо холода должно наносить реальный урон врагам рядом');
  assert.ok(
    (engine.getHudSnapshot().v14Core?.combatLog.length ?? 0) > 0,
    'Журнал боя должен фиксировать реальные результаты боевого конвейера'
  );

  // 5. Пауза очереди обучения повреждённого здания и ремонт древесиной (§15.8)
  const townHall = engine.buildings.find((b) => b.faction === 'human' && b.type === 'town_hall')!;
  assert.ok(townHall, 'Ратуша должна существовать');
  townHall.hp = townHall.maxHp - 80;
  engine.resources.gold = 200;
  engine.resources.wood = 100;
  assert.equal(engine.trainUnit(townHall.id, 'laborer'), true);
  const remBeforePause = townHall.queue[0].remaining;
  engine.update(0.05);
  engine.update(0.05);
  assert.equal(
    townHall.queue[0].remaining,
    remBeforePause,
    'Очередь обучения повреждённого здания должна быть на паузе (§15.8)'
  );

  // Ремонтируем Ратушу древесиной (2 шага по 50 HP -> 100% HP)
  assert.equal(engine.repairBuilding(townHall.id), true);
  assert.equal(engine.repairBuilding(townHall.id), true);
  assert.equal(townHall.hp, townHall.maxHp, 'После ремонта древесиной здание должно быть полностью восстановлено');
  engine.update(0.05);
  assert.ok(
    townHall.queue[0].remaining < remBeforePause,
    'После полного ремонта очередь обучения должна автоматически возобновиться (§15.8)'
  );
});

test('T-V14-53: Сохранение и загрузка кампании (раздельные Manual/AutoSave §341.7, запрет ручного сохранения в бою §341.6, полное восстановление и откат при битом автосохранении §341.8)', () => {
  const storageMap = new Map<string, string>();
  const prevStorage = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storageMap.set(k, v);
    },
    removeItem: (k: string) => {
      storageMap.delete(k);
    },
    clear: () => {
      storageMap.clear();
    },
  };

  try {
    const engine = new GameEngine();
    engine.initNewWorld(true);
    const hero = engine.getHero()!;

    // 1. В активном бою при миссионном запрете (allowSaveDuringCombat = false) ручное сохранение заблокировано (§341.6)
    engine.core.sandbox.mission.allowSaveDuringCombat = false;
    const orc = engine.units.find((u) => u.faction === 'orc')!;
    const origOrcX = orc.x;
    const origOrcY = orc.y;
    orc.x = hero.x + 1.5;
    orc.y = hero.y;
    assert.equal(engine.isPlayerInActiveCombat(), true);
    assert.equal(engine.saveGame('manual'), false, 'Ручное сохранение в бою должно отклоняться при allowSaveDuringCombat=false (§341.6)');
    orc.x = origOrcX;
    orc.y = origOrcY;
    assert.equal(engine.isPlayerInActiveCombat(), false);

    // 2. Изменяем состояние: лутаем сундук, назначаем группу 4, меняем ресурсы и позицию Аватара
    const chestNw = engine.tiles.flat().find((t) => t.chestObjectId === 'chest_ruin_nw')!;
    engine.core.openChestLootWindow(chestNw);
    engine.takeAllLoot();
    assert.equal(chestNw.chestLooted, true);

    hero.x = 14.25;
    hero.y = 29.75;
    engine.resources.wood = 245;
    const nonHeroIds = engine.units
      .filter((u) => u.faction === 'human' && u.type !== 'hero')
      .map((u) => u.id);
    engine.selectedUnitIds = new Set(nonHeroIds);
    engine.assignControlGroupSlot(4);
    engine.setFormation('loose');

    // Ручное сохранение пишет в MANUAL_SAVE_KEY, не затрагивая AUTO_SAVE_KEY (§341.7)
    assert.equal(engine.saveGame('manual'), true);
    assert.equal(engine.hasManualSave(), true);
    assert.equal(engine.hasAutoSave(), false);

    // Автосохранение пишет в отдельный слот AUTO_SAVE_KEY (§341.7)
    assert.equal(engine.saveGame('auto'), true);
    assert.equal(engine.hasAutoSave(), true);

    // 3. Повреждаем контрольную сумму автосохранения и проверяем автоматический откат на валидное ручное сохранение (§341.8)
    const autoRaw = storageMap.get('ashen_crown_autosave_v1')!;
    const autoParsed = JSON.parse(autoRaw);
    autoParsed.savedAtIso = '2099-01-01T00:00:00.000Z';
    autoParsed.coreSnapshotJson = autoParsed.coreSnapshotJson.replace(
      /"checksum":"[0-9a-f]{8}"/,
      '"checksum":"badc0ffe"'
    );
    storageMap.set('ashen_crown_autosave_v1', JSON.stringify(autoParsed));

    const engine2 = new GameEngine();
    engine2.initNewWorld(true);
    assert.equal(
      engine2.loadGame('latest'),
      true,
      'При повреждённом последнем автосохранении загрузка должна автоматически откатиться на валидное ручное сохранение (§341.8)'
    );

    const hero2 = engine2.getHero()!;
    assert.ok(Math.abs(hero2.x - 14.25) < 0.01 && Math.abs(hero2.y - 29.75) < 0.01, 'Позиция Аватара должна восстановиться');
    assert.equal(engine2.resources.wood, 245, 'Ресурсы поселения должны восстановиться');
    assert.equal(engine2.core.activeFormation, 'loose', 'Активная формация должна восстановиться');
    assert.equal(
      engine2.core.fieldSelection.controlGroups[4].length,
      nonHeroIds.length,
      'Контрольная группа 4 должна восстановиться'
    );
    const chestNwAfter = engine2.tiles.flat().find((t) => t.chestObjectId === 'chest_ruin_nw')!;
    assert.equal(chestNwAfter.chestLooted, true, 'Облутанный сундук должен оставаться открытым на карте');
    assert.equal(
      engine2.core.sandbox.activeMap.worldObjects?.chest_ruin_nw?.consumed,
      true,
      'Облутанный сундук не должен сбрасываться в core.sandbox.activeMap.worldObjects после загрузки'
    );
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as Record<string, unknown>).localStorage;
    } else {
      (globalThis as Record<string, unknown>).localStorage = prevStorage;
    }
  }
});

