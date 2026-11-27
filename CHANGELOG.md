# CHANGELOG.md — Журнал изменений кодовой базы ASHEN CROWN

## 24.11.2026 — Реализация Среза 1 (доменное ядро `v14.2`, полигон UI, автотесты, документация)

### Новые файлы доменного ядра `v14.2` (`/src/core/`)
- `src/core/config.ts` — утверждённые константы (`APPROVED_CONSTANTS`), стартовые формульные параметры (`DESIGN_TARGET_FORMULAS`), настраиваемая конфигурация открытых решений (`DEFAULT_WORKING_ASSUMPTIONS`), справочники 7 атрибутов, 6 боевых мастерств, 6 школ магии (с `Элементальная магия` по `AC-OWNER-007`), 6 ветвей Тёмной магии и матрица 6 рас (§352.4).
- `src/core/types.ts` — канонические TypeScript-контракты для `CampaignState`, `MissionState`, `MapInstanceState`, `HeroState`, 3 пулов очков, `ItemDefinition`/`ItemInstance`/`ItemLocation`, `DamagePacket`/`CombatResolutionLog`, `NecromancyMinion`, `SquadCommandLayer`, 6-статусного `QuestRecord`, `SaveSnapshot`.
- `src/core/catalog.ts` — лоро-независимый технический каталог прототипных заклинаний (включая Кровавую магию с оплатой HP по `AC-AUD-007` и правила `autoCastEligible` §337.3) и предметов (включая тестовый 2H-меч с self-bonus STR для проверки §1.5, амулет `+15 CHA` для проверки §132.3, свиток §140.4 и защищённый квестовый предмет §347.7).
- `src/core/progression.ts` — формулы HP/Mana/ManaRegen (§33), `computeSpecialization` без учёта нераспределённых очков и бонусов предметов (§27.5), diminishing XP между картами (§1.7), пошаговый `grantHeroExperience` (§26.2), распределение 3 независимых пулов, жизненный цикл формул Гримуара и pre-transition `respecHeroBeforeMapTransition` (§1.12).
- `src/core/combatAndMagic.ts` — единый боевой конвейер (§237), потолок сопротивлений `+75%` без абсолютного иммунитета (§1.2), расчёт силы/стоимости/каста заклинаний (§§38–40), `MagicStrain` с полным сбросом при переходе порталом (§43.4), режимы некромантии `Dormant_NoMana` и `Residual_Autonomy` без обновления пула при повторной смерти + механика Костяного воина (§§3.1, 105), 120с возрождение у `Stone of Souls` (§288), разделение `PlayerOrder` и `LocalReaction` отряда (§337.2, §343.6).
- `src/core/inventoryAndSave.ts` — пересчёт `Copper/Silver/Gold` (`100:1:1`), торговая поправка строго по `NaturalCharisma` (§132.3), экипировка с блокировкой self-bonus (§1.5) и авто-снятием `off_hand` для двуручного оружия, перенос свитков в Гримуар (§140.4), доступ к `CampaignStorage` только у точки склада (§331.2), проверка инвариантов предметов (§347.2), идемпотентные квестовые награды по `RewardId`, атомарный портальный переход (§290, §341.2) и `SaveSnapshot` с контрольной суммой FNV-1a (§341.8).
- `src/core/sandboxFactory.ts` — изолированная фабрика стартового состояния полигона без вымышленного лора.

### Изменения и добавления UI
- `src/components/V14VerticalSliceModal.tsx` — новый полноэкранный мобильно-адаптивный интерфейс на русском языке для интерактивной проверки всех систем Среза 1 (`Герой`, `Магия и Бой`, `Склад и Портал`, `Questbook` с 1-колоночным мобильным режимом + кнопкой «Назад к списку» и 2-колоночным десктопным режимом по §299).
- `src/components/TitleScreen.tsx` — добавлена кнопка «Системы v14.2» без изменения существующих кнопок запуска кампании и 3D-демо.
- `src/components/Overlays.tsx` — в `PauseModal` добавлена кнопка «Системы v14.2».
- `src/App.tsx` — подключён модал `V14VerticalSliceModal` с защитой от конфликта горячих клавиш.

### Тесты и инфраструктура
- `package.json` — добавлен скрипт `"test": "tsx --test tests/*.test.ts"`.
- `tests/v14_core.test.ts` — 7 автоматизированных acceptance-тестов по спецификации `v14.2`.
- `tests/legacy_regression.test.ts` — 2 регрессионных теста сохранности существующего прототипа RTS/RPG и изометрической камеры.

### Управляющие документы в корне репозитория
- `IMPLEMENTATION_PLAN.md`, `OPEN_ISSUES.md`, `DECISIONS.md`, `CHANGELOG.md`, `TEST_REPORT.md`.

---

## 24.11.2026 — Реализация Среза 2 (Локальная экономика поселений, Отряды, Enemy AI, Эффекты §42)

### Новые модули ядра `/src/core/`
- `src/core/settlementEconomy.ts` — 4-стадийный атомарный цикл ресурса `AtSource -> Carried -> Delivered -> Consumed` по `transactionId` (§338.2), безопасное переназначение работника без потери груза `Carried` (§338.3, §339.5), повышение `MilitaryCap` и лечение через `Food Store` без периодического upkeep (§338.5, §339.1), отдельный `Rune Power`, диагностика причин остановки (§338.9) и заморозка очередей на неактивной карте (§338.7).
- `src/core/squadsAndEffects.ts` — разделение `CreatureDefinition`, `UnitInstance` и `SquadInstance` (§343.2), `Demon != Hostile` (§343.3), взаимоисключающие `FieldArmy`/`Garrison` (§338.6), явная смена `allegiance` (§343.8), `EnemyGroupAIState` без глобального всеведения с лимитом преследования (§343.7), белый список автокаста (§337.3), лечение без воскрешения и оверхил-щита (§42.1), обновление баффов без бесконечного стака (§42.2) и diminishing returns повторного контроля (§42.4).

### Обновления существующих модулей и UI
- `src/core/config.ts`, `src/core/types.ts` — контракты `WorkerAgent`, `ResourceDepositNode`, `ProductionOrderEntry`, `SquadInstance`, `EnemyGroupAIState`, `ActiveStatusEffect`, `ControlDiminishingRecord` и настраиваемые `WORKING_ASSUMPTION` параметры для `§42.4`, `§337.3`, `§338.10`.
- `src/core/inventoryAndSave.ts` — перенос порталом только выживших бойцов переносимых `FieldArmy`-отрядов без воскрешения павших и без `Garrison` (§341.4) + заморозка покидаемой карты (§338.7).
- `src/core/sandboxFactory.ts` — стартовые узлы ресурсов, рабочие, полевой/гарнизонный/вражеский отряды и нейтральный демон.
- `src/components/V14VerticalSliceModal.tsx` — добавлена 5-я вкладка «Поселение» и интерактивные проверки `§42.4` / `§337.3` в «Бой/Магия».
- `tests/v14_slice2.test.ts` — 4 новых автоматизированных acceptance-теста (всего 13 тестов).

---

## 24.11.2026 — Реализация Среза 3 (Жизненный цикл `MapInstance`, объекты §316, диалоги без кармы, `ReturnPolicy`, `Checkpoints`, безопасная торговля и предвыбор цели)

### Новые модули ядра `/src/core/`
- `src/core/missionAndWorld.ts` — валидатор переходов жизненного цикла карты (§341.11 `UNLOADED..FAILED`), защита команд от активных диалогов/подтверждений (§333.7, §348.4), обработчик объектов мира `Interact`/`Loot`/`Gather`/`Attack` (§316, §346.5), система ветвящихся диалогов с проверкой условий и статусом `Closed` без глобальной кармы (§§309–315, §333.4–333.6), проверка `defeatOnAvatarDeath` (§341.5, §346.9), аудит проходимости `validateMissionPlayability` и восстановление через `restoreFromCheckpoint` (§341.7, §346.9).

### Обновления существующих модулей и UI
- `src/core/types.ts` — контракты `WorldInteractiveObject`, `DialogueDefinition`/`Choice`/`Condition`, `CheckpointRecord`, `MerchantTransactionPreview`, `MissionPlayabilityReport`, `CampaignState.archivedMapsByDefinitionId` и `MissionState.defeatOnAvatarDeath`.
- `src/core/inventoryAndSave.ts` — предпросмотр торговых операций `previewMerchantTransaction` без мутаций (§347.5, §348.4), автоматическое создание `CheckpointRecord` перед переходом через портал (§341.7), архивация покинутой карты и поддержка `ReturnPolicy` (`AllowReturn` с восстановлением замороженного состояния без фоновой симуляции / `OneWay` с блокировкой возврата по §§346.7–346.8).
- `src/core/sandboxFactory.ts` — интерактивные объекты полигона (`Stone of Souls`, полевой контейнер добычи, дежурный координатор сектора, портал).
- `src/components/V14VerticalSliceModal.tsx` — двухшаговое подтверждение/отмена сделки у торговца (§347.5), предвыбор и безопасная отмена цели заклинания без расхода маны (§348.4), блок «Объекты сектора и Диалог» во вкладке «Задания», модальный слой диалога с сохранением `PlayerOrder` отрядов и стековой обработкой Back/Escape (§348.6), управление `ReturnPolicy`/паузой карты/аудитом проходимости/откатом к `Checkpoint`.
- `tests/v14_slice3.test.ts` — 5 новых автоматизированных acceptance-тестов (`T-V14-12..16`, всего 18 тестов).

---

## 24.11.2026 — Реализация Среза 4 (Древо школ, прерывание каста §40.3–40.4, некромантия §3.1, магия NPC §6, слоты и миграции сохранений §341.6–341.8)

### Новые модули ядра `/src/core/`
- `src/core/saveManager.ts` — раздельные ручные слоты (`manualSlots`) и кольцевой буфер автосохранений (`autoSaveRing`), явная блокировка сохранений в бою при `allowSaveDuringCombat = false` (§341.6) и `loadLatestValidAutoSave` с автоматическим fallback на предыдущую валидную копию (§341.7).

### Обновления существующих модулей и UI
- `src/core/config.ts` — `SAVE_FORMAT_VERSION = 2`, настраиваемые параметры `WORKING_ASSUMPTION` для `manualSaveSlotCount`, `autoSaveRingCapacity`, `spellLearnSchoolProgressStep`, `boneWarriorBaseBonesCost`, `boneWarriorMinBonesCost`.
- `src/core/types.ts`, `src/core/catalog.ts`, `src/core/sandboxFactory.ts` — `tier` (`basic`/`advanced`), `prerequisiteSpellIds`, базовое заклинание `spell_elem_spark`, `ActiveCastState`, `CorpseEntity`, `SaveRepositoryState`, `extraMetadata`.
- `src/core/progression.ts` — проверка `prerequisiteSpellIds` и изолированный вклад изучения/апгрейда заклинания в прогресс уровня своей школы (§§2.1.4, 2.1.6–2.1.8).
- `src/core/combatAndMagic.ts` — активный каст и прерывание уроном `> CastStabilityThreshold` без возврата маны (`beginHeroCast`, `applyCombatInterruptToHeroCast`, `advanceHeroActiveCast`, §§40.3–40.4), а также механики `§3.1 APPROVED`: `lootBonesFromCorpse`, `computeBoneWarriorBonesCost`, `createBoneWarriorFromBones`, `reraiseCorpseForNecromancy` (блокировка `decayed`) и `interactWithCorpseSpirit` (запрет подчинения духа при разрешённом диалоге).
- `src/core/squadsAndEffects.ts` — `executeNpcCasterAutoTurn` для магии NPC/фракций с соблюдением белого списка `§337.3`, резерва маны, `allegiance` и подавления при `Retreat` (§6).
- `src/core/inventoryAndSave.ts` — последовательная миграция `migrateSnapshotSequential` (`v0 -> v1 -> v2`) на копии данных с сохранением неизвестных полей в `extraMetadata` (§341.8).
- `src/components/V14VerticalSliceModal.tsx` — элементы проверки активного каста/прерывания, костей/некромантии §3.1, ручных слотов/AutoSave Ring и боевой блокировки сохранений.
- `tests/v14_slice4.test.ts` — 5 новых автоматизированных acceptance-тестов (`T-V14-17..21`, всего 23 теста).

---

## 24.11.2026 — Реализация Среза 5 (Мульти-геройная группа §317, Магия разума §§4–5, Формации §§11.4–11.5, Слотовое строительство и ремонт §§15.5–15.8, Аудит §36.1)

### Обновления модулей ядра `/src/core/` и UI
- `src/core/config.ts` — `GAME_BUILD_VERSION = '0.5.0-v14.2-slice5'`, добавлены `WORKING_ASSUMPTION` параметры `maxActivePartyHeroes`, `buildingRepairCostWood`, `buildingRepairHpStep`.
- `src/core/types.ts`, `src/core/sandboxFactory.ts` — контракты `SettlementBuildingSlot`, `SettlementBuildingInstance`, `FormationType`, `MindEffectKind`, `NpcAuthorityTier`, `ActiveMindInfluence` и стартовые стройплощадки/здания в `settlement_sector_a`.
- `src/core/progression.ts` — функции `summonCompanionHeroToParty` и `dismissPartyHero` (§317, §331.1, §351.2) с общим `PartyInventory` и индивидуальными слотами экипировки.
- `src/core/settlementEconomy.ts` — слотовое не-мгновенное строительство (`startBuildingConstruction`), заморозка таймеров стройки на неактивной карте, постановка очереди казармы на паузу при повреждении (`damageSettlementBuilding` с сохранением несвязанных ресурсов) и раздельный от лечения юнитов ремонт за Wood (`repairSettlementBuilding`).
- `src/core/squadsAndEffects.ts` — формации без автоматических бонусов статов (`setSquadFormation`, §11.4), ролевой групповой приказ с сохранением standoff для стрелков (`issueMultiSquadOrder`, §11.5), Магия разума без всесилия и с возвратом `allegiance` (`applyMindEffectToTarget`, `tickMindEffectsExpiry`, §§4–5, §42.4), а также обязательный аудит боевых формул `runMandatoryCombatMatrixAudit` (§36.1) на статических ES-импортах.
- `src/components/V14VerticalSliceModal.tsx` — выбор активного героя/спутника в «Герой» и «Склад», кнопки Магии разума и аудита §36.1 в «Бой/Магия», панель стройплощадок/ремонта и формаций/группового приказа в «Поселение».
- `tests/v14_slice5.test.ts` — 5 новых автоматизированных acceptance-тестов (`T-V14-22..26`, всего 28 тестов).

---

## 24.11.2026 — Реализация Среза 6 (Завершение неблокированного канонического домена `v14.2`: §§14.6, 14.8, 140.1, 242, 303, 338.8, 347.7)

### Обновления модулей ядра `/src/core/` и UI
- `src/core/config.ts`, `src/core/types.ts` — `GAME_BUILD_VERSION = '0.6.0-v14.2-slice6'`, добавлены `squadReplenishUnitWood`, `squadReplenishUnitIron` (`WORKING_ASSUMPTION`) и `SquadInstance.maxUnitCount`.
- `src/core/settlementEconomy.ts` — реализованы `replenishSquadFromSettlement` (`§14.6`: вне боя, с исправной казармой, за Wood/Iron, без авто-воскрешения особых командиров) и `validateSettlementEconomicPlayability` (`§338.8`: выявление экономического softlock без выдачи бесплатных ресурсов).
- `src/core/squadsAndEffects.ts` — добавлено `awardArmyVictoryXpToHero` (`§14.8`: XP за победы армии начисляется герою с учётом `§1.7`, обычные бойцы `UnitInstance` не имеют RPG-характеристик).
- `src/core/inventoryAndSave.ts` — добавлены `activateQuestIfPrerequisitesMet` (`§303` проверка `prerequisiteQuestIds`), `discardOrDestroyInventoryItem` (`§347.7` блокировка удаления квест-предметов) и `isCombatConsumableAllowed` (`§140.1`, `§242` запрет боевых зелий HP/Mana).
- `src/components/V14VerticalSliceModal.tsx` — добавлены кнопки «Пополнить Альфу (Wood/Iron §14.6)», «Аудит экономики §338.8», «Победа армии (+XP герою §14.8)» и «Удалить» в `PartyInventory` (с демонстрацией защиты квестовых предметов).
- `tests/v14_slice6.test.ts` — 4 новых теста (`T-V14-27..30`), включая сквозной E2E-тест `T-V14-30` (всего 32 теста).

---

## 25.11.2026 — Реализация Среза 7 (Руны и `Rune Tablet` §144, `Plans` и `Plan Book` §146, мобильный предпросмотр экипировки и 2-шаговое удаление §317.5/9/11, миграция `SaveSnapshot v3`)

### Новые модули ядра `/src/core/`
- `src/core/runesAndPlans.ts` — подсистема `§144` (`computeUnlockedRuneTabletSlots`, `ensureRuneTabletSynced`, `installRuneInTablet`, `removeRuneFromTablet` с запретом снятия `HeroRune` с экипированного героя, `hasActiveWorkerRuneForRace`, `captureRuneMonument`, `markRuneHeroFallen`, `summonOrResummonRuneHeroAtMonument` с сохранением экипировки без дублей, `tickRunePowerRecovery`, `computeMonumentSummonTimeSec`, `previewRuneSaleOrDestructionWarning`) и подсистема `§146` (`activatePlanFromInventory` с расовой привязкой и постоянной активацией без эксплойта дублей, 5-ступенчатая проверка `evaluatePlanAvailability`).

### Обновления модулей ядра и UI
- `src/core/config.ts`, `src/core/types.ts`, `src/core/catalog.ts`, `src/core/sandboxFactory.ts` — `SAVE_FORMAT_VERSION = 3`, `GAME_BUILD_VERSION = '0.7.0-v14.2-slice7'`, `CONTENT_SCHEMA_VERSION = 'v14.2-core-03'`, `WORKING_ASSUMPTION` параметры `Rune Tablet`/`Rune Power`, категории `worker_rune`/`hero_rune`/`building_plan`/`unit_plan`, локация `rune_tablet`, объекты `rune_monument`/`hero_monument` и нейтральный стартовый набор рун/планов (`PROTOTYPE_PLANS`).
- `src/core/inventoryAndSave.ts` — чистый предпросмотр `previewHeroEquipmentChange` (`§§317.5, 317.9, 317.11`), предупреждение `§144.7` в `previewMerchantTransaction`, проверка `rune_tablet` в `verifyItemLocationInvariants` и шаг последовательной миграции `v2 -> v3` в `migrateSnapshotSequential`.
- `src/core/missionAndWorld.ts` — обработчики `Interact` для `rune_monument` и `hero_monument`.
- `src/components/V14VerticalSliceModal.tsx` — карточка «Rune Tablet (§144) и Plan Book (§146)» во вкладке «Поселение», inline-подсветка невыполненных требований экипировки без hover, панель предпросмотра статов/конфликтов 2H до подтверждения, кнопки «В Rune Tablet» / «В Plan Book» и 2-шаговое подтверждение удаления с предупреждением для рун и отменой по `Escape`.
- `tests/v14_slice7.test.ts` — 5 новых тестов (`T-V14-31..35`, всего 37 тестов); обновлена проверка `SAVE_FORMAT_VERSION` в `tests/v14_slice4.test.ts`.

---

## 25.11.2026 — Реализация Среза 8 (Стаки и фильтрация `PartyInventory` §274, единая матрица разблокировок §258 и сквозной аудит кампании без лора §262)

### Новые модули ядра `/src/core/`
- `src/core/campaignAudit.ts` — единый валидатор разблокировок `evaluateUnifiedUnlock` с 16 каноническими кодами `UnlockLockCode` (§258.4, возвращает все причины сразу), поиск циклов зависимостей `detectDependencyCycles` (§262.4 #3) и 6-факторный анти-тупиковый аудит кампании `runCampaignAntiDeadlockAudit` (§258.7, §262.4, §275.4–275.5).

### Обновления модулей ядра и UI
- `src/core/config.ts`, `src/core/types.ts` — `GAME_BUILD_VERSION = '0.8.0-v14.2-slice8'`, контракты `UnlockLockCode`, `UnlockCriticality`, `UnlockEvaluationResult`, `CampaignAuditReport`, `InventoryFilterCategory`, `InventorySortMode`.
- `src/core/inventoryAndSave.ts` — операции со стаками и организацией безлимитного `PartyInventory` (§274): `canStacksMerge`, `pickupItemToPartyInventory`, `splitItemStack`, `mergeItemStacks`, `queryPartyInventoryItems`.
- `src/components/V14VerticalSliceModal.tsx` — фильтры категорий, сортировка, кнопка `+2 Свитка (стак §274)`, кнопка `Разделить (1)` в `PartyInventory`, и кнопка «Аудит кампании (§258.7 / §262.4)» в секции портала и сохранений.
- `tests/v14_slice8.test.ts` — 4 новых теста (`T-V14-36..39`, всего 41 тест), включая сквозную 10-этапную кампанию без лора `T-V14-39` (`§262.2–262.4`).

---

## 25.11.2026 — Реализация Среза 9 (Автономное поведение нежити §107, ресурсная матрица 6 рас §339/§352.4 и валидатор числового аудита/каталогов §§352–353)

### Новые модули ядра `/src/core/`
- `src/core/catalogAudit.ts` — валидатор числового аудита `validateNumericalAuditEntries` (`§352.2–352.6` с 6 классами уверенности и контролем обеих сторон `CONFLICT`), валидатор 6-расовой ресурсной матрицы `validateSixRaceResourceMatrix` (`§339.2–339.5`, `§352.4`), валидатор записей каталога `validateContentCatalogRecords` (`§353.3`) и сводный аудит прототипа `runPrototypeCatalogAndAuditReport` с честным статусом `PARTIAL` (`§353.5`).

### Обновления модулей ядра и UI
- `src/core/config.ts`, `src/core/types.ts` — `GAME_BUILD_VERSION = '0.9.0-v14.2-slice9'`, `CONTENT_SCHEMA_VERSION = 'v14.2-core-04'`, добавлены `UndeadAutonomyAIState`, `RaceResourceCapability`, `NumericalAuditEntry`, `ContentCatalogEntityRecord`, `CatalogAuditReport`, а также полные `resourceCapabilities` и `defaultWorkerRole` для всех 6 рас в `PLAYABLE_RACES`.
- `src/core/combatAndMagic.ts` — реализованы `issueNecromancyMinionOrder` (блокировка прямых приказов мёртвого некроманта по `§107.5`) и детерминированный автомат `evaluateAutonomousUndeadBehavior` (`§107.1–107.8`: сохранение последнего приказа, `Retreat` без разворота, `HoldPosition`, локальная `DefendingSelf`/`DefendingAlly`/`ReturningToOrderArea`, `Inactive` при исчерпании резерва, возврат прямого управления после возрождения).
- `src/core/settlementEconomy.ts` — добавлены `getRaceResourceCapability` и `validateSettlementResourceCostForRace` (`§339.2–339.3`, `§352.4`).
- `src/components/V14VerticalSliceModal.tsx` — добавлена кнопка «Аудит каталогов и 6 рас (§339 / §§352–353)».
- `tests/v14_slice9.test.ts` — 4 новых теста (`T-V14-40..43`, всего 45 тестов).

---

## 25.11.2026 — Реализация Среза 10 (`1.0.0-v14.2-core`: окно добычи и силуэт §128, удалённый обмен §277, блок портала при смерти §276.7, команды поля и туман войны §292, стек Back §348)

### Новые модули ядра `/src/core/`
- `src/core/fieldCommands.ts` — рендерер-независимый модуль команд игрового поля: выделение с Shift/Alt и лимитом `maxUnitSelectionCount` (§292.6), фокус портрета без разрушения группы, 6 групп быстрого выбора `Ctrl+1..6` (§292.7), запрет кнопки формаций при выделении Аватара (§292.10), путевые точки Shift и замкнутый патруль Alt (§292.8), 3-состоянийный туман войны `Unexplored / ExploredShrouded / Visible` (§292.9) и детерминированный стек системной навигации Back/Escape (§348.4, §348.6).

### Обновления модулей ядра и UI
- `src/core/config.ts`, `src/core/types.ts` — `GAME_BUILD_VERSION = '1.0.0-v14.2-core'`, `CONTENT_SCHEMA_VERSION = 'v14.2-core-05'`, `maxUnitSelectionCount = 100` (`WORKING_ASSUMPTION`), контракты `LootContainerEntry`, `SquadCommandLayer.waypointQueue`/`isPatrolLoop`, `FogOfWarGrid`, `FieldSelectionState`, `UiNavigationLayer`.
- `src/core/missionAndWorld.ts` — окно содержимого контейнера добычи `openLootContainer`, выборочный подбор `takeSingleLootEntry` и полный подбор `takeAllLootEntries` (§128 `USER APPROVED`).
- `src/core/inventoryAndSave.ts` — удалённый атомарный обмен экипировкой `transferEquippedItemBetweenHeroes` (§128, §277 #1–3) и жёсткая блокировка портала при мёртвом/возрождающемся Аватаре (§276.7).
- `src/core/combatAndMagic.ts` — защита §276.2 #5 в `advanceAvatarRespawnTimer` (возрождение не отменяет статус `Defeat` проваленной миссии).
- `src/components/V14VerticalSliceModal.tsx` — силуэт экипировки персонажа (3-колоночная сетка с кнопкой «Передать» другому активному герою, §128) и интерактивное окно добычи (выборочный подбор / «Взять всё» + закрытие по Escape, §128 / §348.6).
- `tests/v14_slice10.test.ts` — 5 новых тестов (`T-V14-44..48`, всего 50 тестов), включая сводный Release Gate тест всех 5 аудит-движков ядра.

---

## 25.11.2026 — Этап 11 (`1.1.0-v14.2-integrated-3d`: ограниченное закрытие `LEGACY-GAP-001` — живая интеграция `src/core/*` и 3D PBR-апгрейд сцены)

### Интеграция доменного ядра в живую сцену (`src/game/*`)
- `src/game/coreBridge.ts` (НОВЫЙ) — авторитетный мост `CoreGameBridge` поверх немодифицированного `src/core/*` (производные статы Аватара `§33`, боевой конвейер `§237`, лечение `§42.1`, магия и `MagicStrain` `§§38–43`, некромантия `§105`, 120с возрождение у Stone of Souls `§288`, запрет боевых зелий `§140.1`/`§242`, выделение/6 групп/блокировка формаций Аватара `§292.6–292.10`, 3-состоянийный туман войны `§292.9`, контейнеры добычи `§128`, версионированный `SaveSnapshot v3` с FNV-1a `§341.8`).
- `src/game/engine.ts`, `src/game/types.ts`, `src/game/mapGen.ts` — подключён `CoreGameBridge` в игровой цикл, бой, каст 3 заклинаний (`F`/`G`/`X`), призыв и тик `skeleton_minion`, маршрутные точки (`Shift+ПКМ`) и патруль (`Alt+ПКМ`), группы `Ctrl+1..6`/`1..6`, 3 руинных контейнера добычи (`chest_ruin_nw/se/ne`), портал сектора, русскоязычные 6 целей и встроенный `coreSnapshotJson` в сохранение.

### 3D PBR-рендерер, модели, освещение, VFX и мобильная адаптация
- `src/game/isoTextures3D.ts` (НОВЫЙ) — детерминированный процедурный генератор `CanvasTexture` PBR-карт (земля, каменная кладка, черепица, древесина, рябь воды, мягкие контактные тени, рунические кольца).
- `src/game/isoModels3D.ts` (НОВЫЙ) — многосоставные 3D-модели 7 типов зданий (+ стройлеса), 12 объектов мира (включая парящий Stone of Souls, вихревой портал, мерцающие костры, открывающиеся сундуки, качающиеся деревья) и 8 шарнирных ригов юнитов (`hero`, `skeleton_minion`, `laborer`, `swordsman`, `archer`, `orc_warrior`, `orc_archer`, `orc_commander`).
- `src/game/isoRenderer3D.ts` (НОВЫЙ) — изометрический Three.js PBR-рендерер с точным совпадением `OrthographicCamera` 1:1 с `iso.ts` (`projectGridPoint3D`, погрешность `< 0.01 px`), рельефной 42×42 картой и горным внешним периметром в `FogExp2`, анимированной водой, плавным `DataTexture` тумана войны, `RoomEnvironment` IBL + 3-точечным освещением с динамическими тенями и локальными огнями, 3D VFX магии (кольца, восходящие рунические столбы, искры, огненные шары) и мобильными лимитами (`DPR <= 1.5`, тени `1024`, откат при потере WebGL).
- `src/game/renderer.ts` — добавлен прозрачный `renderTacticalOverlay` поверх WebGL (HP/MP-бары, маршруты/патрули, превью стройки, рамка выделения, текст урона), улучшена миникарта (`portal`, `bindstone`, `skeleton_minion`), сохранён `renderWorld` как 2D-fallback.

### Интерфейс и 3D-витрина (`src/components/*`, `src/showcase/*`)
- `src/components/GameHUD.tsx`, `src/components/Overlays.tsx`, `src/components/TitleScreen.tsx`, `src/App.tsx` — русскоязычный интерфейс без выдуманного лора и без `backdrop-filter` над WebGL, панель магии (`F`/`G`/`X`), индикаторы `MagicStrain`/маны/валюты/нежити, 6 групп быстрого выбора, 3 формации с блокировкой для Аватара (`§292.10`), окно добычи `LootChestModal` (`§128`), стек `Escape` (`§348.6`) и мобильные touch-кнопки `>= 44px`.
- `src/components/V14VerticalSliceModal.tsx` — добавлена двусторонняя синхронизация с живой игровой сессией (`externalSandbox` / `onExternalSync`).
- `src/showcase/HeroShowcase.tsx` — отображение живых `v14.2` характеристик Аватара из текущей сессии, усиленная 3D-сцена (рунический ореол, пепельные искры, тёплый свет жаровни), мобильный лимит DPR и русский UI.

### Тесты
- `tests/v14_phase11_integration.test.ts` (НОВЫЙ) — 3 новых интеграционных теста (`T-V14-49..51`, всего 53 теста): живая магия/`MagicStrain`/некромантия/блок зелий/120с возрождение, группы/формации/патруль/окно добычи/сейв v3, и субпиксельная точность 3D/2D проекции (`< 0.01 px`).

---

## 25.11.2026 — Visual Polish Pass 01 (Stylized 3D Dark Fantasy: окружение, освещение, модели, инвентарь)

Визуальная и интерфейсная доработка **без изменения игровых механик, баланса, слотов и правил `v14.2`** (`/src/core/*` не затрагивался).

### Окружение, текстуры и освещение
- `src/game/isoTextures3D.ts` — переход на 512×512 процедурные PBR-карты (`SRGBColorSpace` для albedo / `NoColorSpace` для bump): органичная почва с травинками и галькой (`terrainDetail`/`terrainBump`), тёсаная каменная кладка с фасками и мхом (`masonry`/`masonryBump`), многослойная сланцевая черепица (`roofSlate`/`roofBump`), древесные доски с коваными заклёпками (`timber`/`timberBump`), текстура коры (`bark`), рябь воды, мягкая контактная тень и руническое кольцо.
- `src/game/isoRenderer3D.ts` —
  - устранено затемнение и «замыливание» карты от `FogExp2` на ортографической камере: заменён на линейный `THREE.Fog(0x162130, 74, 148)` (0% затуманивания игровой зоны, плавная дымка по горному периметру);
  - строго отделён туман войны от декоративного тумана (`fog: false` на `fogOverlayMesh`, смягчённая непрозрачность разведанной зоны);
  - сбалансировано 3-точечное освещение (тёплое солнце `0xffe5ba`, заполняющий свет небо/земля `HemisphereLight`, холодный стальной контровой свет `0x7db3f5`, экспозиция `1.18`);
  - добавлено плавное смешивание биомов на границах (`grass`/`forest_floor`/`orc_dirt`) и влажные песчано-галечные берега у воды при сохранении чётких каменных дорог, мостов и плит руин;
  - добавлена инстансированная микросреда (`floraGroup`, 5 `InstancedMesh` вызовов): травяные пучки, лесные кустарники, камни/галька, прибрежный камыш и упавшие корни с адаптивной плотностью для мобильных GPU (`0.65x`) и программного WebGL (`0.45x`);
  - текстурирован горный внешний периметр и добавлено орбитальное вращение рунных осколков у Камня Душ.

### 3D-модели зданий, объектов и персонажей
- `src/game/isoModels3D.ts` —
  - переработаны все 7 зданий с архитектурной детализацией: контрфорсы, зубцы, светящиеся переплётные окна, настенные факелы, фахверковые балки, стойки щитов и мишени стрельбища, грядки пшеницы и снопы на ферме, кованые ворота и жаровни крепости врага;
  - улучшены природные и ресурсные объекты: корни-контрфорсы и фактурная кора деревьев (хвойные + осенние дубы), мшистые валуны, базальт с кристаллическими золотыми жилами, деревянная тренога каменоломни, руины с капителями, окованные латунью сундуки, Камень Душ с орбитальными кристаллами;
  - улучшены пропорции и силуэты всех 8 типов юнитов: ноги с сапогами, конусные кирасы с поясами и табардами, широкие наплечники, выразительные шлемы/капюшоны/клыки и рога, детализированные мечи, щиты, рекурсивные луки с колчанами и двусторонние секиры; усилен цветовой контраст «союзник (сталь/кобальт/золото) — враг (багровый/тёмное железо/кость)».

### Интерфейс инвентаря и очистка пользовательских подписей
- `src/components/Overlays.tsx` — полностью переработан `InventoryModal` (и `LootChestModal`/`PauseModal`): компактная мобильно-адаптивная компоновка, чёткая визуальная иерархия, стилизованные SVG-иконки (`ItemGlyph`) для каждого типа предметов, раздельное цветовое и рамочное оформление слотов «Оружие / Доспех / Реликвия», русскоязычные редкости (`Обычный / Редкий / Эпический`) и статусы нагрузки (`Спокойна / Повышена / Предельна`), устранены все внутренние технические обозначения (`§...`, `MagicStrain`, `normal/elevated/critical`, `v3`).
- `src/game/types.ts`, `src/components/GameHUD.tsx`, `src/game/engine.ts` — унифицирован русский язык пользовательских подписей, переведены названия и описания предметов/построек/юнитов и статусов приказов, удалены технические ссылки `§...`, `Dormant_NoMana` и `v14.2` из игровых баннеров и HUD-подписей без изменения игровой логики.

---

## 25.11.2026 — Phase 11: Playable Vertical Slice (сквозная игровая интеграция без модификации `src/core/*`)

### Игровой цикл, боевая система, объекты мира и сохранения (`src/game/*`)
- `src/game/types.ts` — добавлен приказ юнита `'interact'` (`interactGx`, `interactGy`, `interactKind`), типы `CoreEquippedSlotView`, `CoreInventoryItemView`, `CombatLogEntry`, а также расширен `HudV14CoreSummary` полями `coreEquipment`, `corePartyInventory`, `combatLog`, `inCombat`, `bindstoneActive`, `hasManualSave`, `hasAutoSave`.
- `src/game/coreBridge.ts` —
  - подключены `equipItemFromPartyInventory`, `unequipSlotToPartyInventory`, `transcribeSpellScrollToGrimoire`, `pickupItemToPartyInventory`, `previewHeroEquipmentChange`, `interactWithWorldObject`, `canCreateSaveInContext`;
  - добавлены методы `equipCoreInventoryItem`, `unequipCoreEquipmentSlot`, `useCoreSpellScroll`, `addPrototypeLootToPartyInventory`, `interactWithBindstone`, `interactWithPortal`, `canSaveNow`, `pushCombatLog`;
  - исправлена сохранность уже открытых сундуков в `attachBattlefieldWorldObjects()` после Save/Load;
  - боевой расчёт `computeCombatDamage` переведён на реальные `HitChance` (`§33.6`), `ShieldBlock` (`§33.8`) и `resolveCombatPackets` (`§237`) с записью событий в живой `combatLog` (до 12 записей);
  - `buildHudSummary().spells` динамически открывает изученные/готовые заклинания (`spell_elem_frost_nova` `C`, `spell_elem_spark` `V`) и отдаёт канонические 7 слотов экипировки (`coreEquipment`) и `PartyInventory` (`corePartyInventory`).
- `src/game/engine.ts` —
  - разделены `MANUAL_SAVE_KEY` (`ashen_crown_save_v1`) и `AUTO_SAVE_KEY` (`ashen_crown_autosave_v1`) (`§341.7`), добавлены `hasManualSave()`, `hasAutoSave()`, `isPlayerInActiveCombat()`;
  - `saveGame('manual' | 'auto')` проверяет запрет сохранения в бою (`§341.6`), сохраняет `controlGroups`, `activeFormation`, `idCounter`, `savedAtIso`, `coreSnapshotJson`, `tileUpdates`; `loadGame('manual' | 'auto' | 'latest')` автоматически откатывается с повреждённого автосохранения на валидное ручное сохранение (`§341.8`);
  - добавлены `equipCoreItem`, `unequipCoreSlot`, `transcribeCoreScroll`, `repairBuilding` (`§15.8`: 15 древесины / `+50 HP`) и автоматическая пауза очереди найма при `hp < maxHp`;
  - добавлено кликабельное взаимодействие с объектами мира (`findInteractivePropAtGrid`, `interactWithWorldTile`, приказ `'interact'`) для `chest`, `bindstone` и `portal` с проверкой «только Аватар» (`§316`) и защитой `dismissedChestObjectId` от спама повторного открытия;
  - в `castHeroSpell` добавлены `spell_elem_frost_nova` (AoE ледяной урон + кольцо VFX) и `spell_elem_spark` (разряд молнии);
  - в `damageUnit` добавлена обработка промаха/блока щитом, всплывающий текст (`Промах` / `Блок -X` / `-X`), журнал убийств и выпадение трофея босса в `PartyInventory`;
  - все оставшиеся англоязычные баннеры и всплывающие тексты переведены на русский язык.

### Пользовательский интерфейс (`src/components/*`, `src/App.tsx`)
- `src/components/Overlays.tsx` — `InventoryModal` полностью переведён на канонические 7 слотов `v14.coreEquipment` и `v14.corePartyInventory` (снять/надеть, inline-ошибки требований `§317.5`, «Изучить» для свитков `§140.4`, «Защищён» для квест-предметов); в `PauseModal` добавлена кнопка «Загрузить сохранение».
- `src/components/GameHUD.tsx` — добавлен индикатор паузы очереди и кнопка «Ремонт (15Д)» для повреждённых зданий (десктоп и мобильный режим), сворачиваемая панель «Журнал боя» (`v14.combatLog`), обновлён счётчик рюкзака и перенос панели способностей под 4–5+ заклинаний, дополнен `UNIT_ORDER_LABELS_RU` (`attack_unit`, `attack_building`, `follow_hero`, `interact`).
- `src/App.tsx` — подключены горячие клавиши `KeyC` (`spell_elem_frost_nova`) и `KeyV` (`spell_elem_spark`), проброшены `onRepairBuilding`, `onEquipCoreItem`, `onUnequipCoreSlot`, `onTranscribeCoreScroll`, `hasSavedGame` и `onLoad`.

### Тесты
- `tests/v14_phase11_integration.test.ts` — добавлены 2 сквозных теста вертикального среза (`T-V14-52` и `T-V14-53`, всего `55 / 55 PASS`): полный игровой цикл (взаимодействие `§316`, туман войны, сундук, свиток `§140.4` + прокачка школы, требование экипировки `§1.5` + прокачка STA, бой с `Frost Nova` и `combatLog`, пауза очереди и ремонт здания `§15.8`) и полный Save/Load roundtrip (боевой блок `§341.6`, изоляция `Manual`/`AutoSave` `§341.7`, fallback с битого автосохранения `§341.8`, восстановление состояния карты, групп, формации и открытых сундуков).

---

## 26.11.2026 — Phase 11.2: Runtime Defect Fixes (стабилизация `DEF-01..DEF-07` без изменения `src/core/*` и `v14.2`)

### Интерфейс и мобильная адаптация (`src/components/GameHUD.tsx`, `src/components/Overlays.tsx`)
- **DEF-01 (P0):** переработана адаптивная шапка `<header>` в 2 строки на экранах `< 640 px` (Строка 1: ресурсы + `Герой +9` + `Меню`; Строка 2: цели `0/6` + `Журнал` + `Строй`) и единую строку на `sm+` (`768 / 1280 px`) без перекрытий и без горизонтального переполнения.
- **DEF-03 (P1):** добавлена мобильная панель `Строй` (`mobileDrawer === 'army'`) с доступом к 6 группам быстрого выбора (`1–6`), переключателем режима `[Выбрать | Назначить]` (сенсорный аналог `Ctrl+1..6`), 3 формациям (`Компактная`, `Рассред.`, `Линия` с сохранением блокировки при выделении Аватара `§292.10`) и тактическим приказам, а также мобильная кнопка `Журнал` для открытия `Журнала боя`.
- **DEF-05 (P2):** верхний стек уведомлений и правая панель зума разведены по вертикали и горизонтали (`top-[112px] sm:top-14`, `pr-[68px]`), высота мобильных интерактивных кнопок приведена к touch-стандарту `min-h-[44px]`.
- **DEF-06 (P2):** в `InventoryModal` (`src/components/Overlays.tsx`) добавлен полный словарь `SLOT_EMPTY_HINT_RU` для всех 7 канонических слотов экипировки (устранена ошибочная подпись `«Нагрудник не надет»` на пустом слоте шлема `helm` -> `«Шлем не надет»`).
- **DEF-04 UI (`Overlays.tsx`) и DEF-07 UI (`GameHUD.tsx`):** в шапку `InventoryModal` (`z-40`) выведена живая строка статуса `hud.bannerMessage` (уведомления об отказе действий видны без закрытия рюкзака); исключено дублирование общего баннера возрождения поверх постоянного счётчика `Аватар возродится у Камня Душ через X с`.

### Боевая атрибуция, отклик при смерти Аватара и 3D-калибровка (`src/game/types.ts`, `src/game/engine.ts`, `src/game/isoRenderer3D.ts`)
- **DEF-02 (P1):** в `Projectile` добавлены `attackerId` и `attackerName`; все 5 точек вызова `spawnProjectile` (`fire_bolt`, `spark`, союзные/вражеские башни, лучники по юнитам и по зданиям) передают метаданные исходного атакующего, `damageUnit` и `updateProjectiles` корректно атрибутируют дальние, сплеш- и посмертные попадания (вражеские стрелы больше не подписываются как «Союзник»).
- **DEF-04 (P1):** в `equipCoreItem`, `unequipCoreSlot` и `transcribeCoreScroll` добавлено явное уведомление `formatHeroRespawnRefusal` с указанием причины и оставшихся секунд до возрождения (`120с` по `§288`); несанкционированная автопауза при открытии сундука не добавлялась, вопрос вынесен в `OPEN_ISSUES.md` (`OD-RUNTIME-001`).
- **DEF-07 (P2):** откалиброваны linear-RGB альбедо ландшафта (`terrainAlbedoHex`), цветовое пространство `THREE.SRGBColorSpace` для наземной флоры, `envMapIntensity = 0.42` / `roughness = 0.92` на террейне и 3-точечное освещение (`exposure = 1.06`, `hemi = 0.74`, `sun = 2.08`, `rim = 0.46`) с сохранением читаемости 3-состоянийного тумана войны (`fogOverlayMesh`).

### Тесты и отчёт
- `tests/v14_phase11_integration.test.ts` — добавлены регрессионные автотесты `T-V14-54` (DEF-02: вражеский лучник, погибший в полёте лучник, вражеская башня, союзный лучник, огненный шар героя) и `T-V14-55` (DEF-04: отказ действий при мёртвом Аватаре с таймером `120с` и успешное выполнение после возрождения), всего `57 / 57 PASS`.
- Создан детальный отчёт `/PHASE_11_2_RUNTIME_FIX_REPORT.md`, обновлены `OPEN_ISSUES.md`, `IMPLEMENTATION_PLAN.md`, `TEST_REPORT.md`.


