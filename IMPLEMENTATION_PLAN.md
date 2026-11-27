# IMPLEMENTATION_PLAN.md — План реализации ASHEN CROWN (по v14.2 + Lore v1.3 FINAL)

**Дата обновления:** 25.11.2026  
**Базовый канон механик:** `ASHEN_CROWN_Gameplay_Magic_Spec_v14.2` (`/public/assets/aistudio/01_MASTER_GAMEPLAY_SPEC_v14.2_6c8475f8.md`)  
**Процессное распоряжение:** `ASHEN_CROWN_CURRENT_EXECUTION_OVERRIDE.md`, `37_Задание_Google_AI_Studio_Разработка.md`  

---

## 1. Аудит реально доступной кодовой базы и окружения

### Доступные документационные материалы (`/public/assets/aistudio/`)
- `00_UPLOAD_GUIDE_AND_FIRST_PROMPT_4a0e1466.md` — индекс загрузки и стартовые правила.
- `01_MASTER_GAMEPLAY_SPEC_v14.2_6c8475f8.md` — полная спецификация механик и магии v14.2 (27 274+ строки).
- `02_LORE_WORLD_AND_MAGIC_12dc0fc0.md` — лорный пакет v1.3 FINAL (космология, магия, досье 6 ветвей и 5 школ).
- `03_LORE_PEOPLES_CAMPAIGN_AND_DECISIONS_31b365cb.md` — 6 народов, сюжетная структура, `37_Задание`, `39–43`.
- `04_IMPLEMENTATION_RULES_AND_REGISTERS_9e0a5c92.md` — правила разработки AI Studio, `Numerical Audit Register`, `Open Decisions Register (OD-001..020)`, `CURRENT_EXECUTION_OVERRIDE`.

### Доступная исходная кодовая база (Web SPA: React 19 + TypeScript + Vite 8 + Tailwind CSS v4)
- **Ранний изометрический прототип RTS/RPG (`/src/game/*`, `/src/components/*`):**
  - `src/game/types.ts`, `src/game/engine.ts`, `src/game/mapGen.ts`, `src/game/iso.ts`, `src/game/renderer.ts`, `src/game/audio.ts`
  - `src/components/TitleScreen.tsx`, `src/components/GameHUD.tsx`, `src/components/Overlays.tsx`
- **3D Character Showcase (`/src/showcase/*`):**
  - `src/showcase/HeroShowcase.tsx`, `src/showcase/kaelCharacter.ts` (Three.js 3D-персонаж со скелетной анимацией)
- **Отсутствует в репозитории:** серверный backend (Express не подключён), производственный БД-слой, полный бестиарий/каталог 130+ заклинаний с финальным числовым аудитом (`Numerical Audit`).

---

## 2. Карта требований текущей и последующих фаз (с точными ссылками v14.2 и статусами)

| ID / Система | Ссылки v14.2 | Статус в спецификации | Реализовано в Срезе 1 (`/src/core/`) |
|---|---|---|---|
| **Категориальный запрет: абсолютный магический иммунитет запрещён** | §1.2, §41.4 | `APPROVED` | Да (`clampResistance` в `[-1.0, +0.75]`) |
| **Запрет self-satisfying бонусов экипировки** | §1.5 | `APPROVED` | Да (`canHeroEquipItem` считает характеристики без самого предмета) |
| **7 атрибутов + 6 боевых мастерств** | §§1.4, 1.6, 33.2, 33.9 | `APPROVED` | Да (`STR/STA/DEX/AGI/INT/WIS/CHA`, 6 мастерств) |
| **3 неконвертируемых пула очков + порядок Level-Up + распределимость в бою** | §§26.1–26.5, §1.13 | `APPROVED` | Да (`grantHeroExperience`, `allocate*Point`) |
| **Динамическая специализация без нераспределённых очков и бонусов предметов** | §27, §27.5 | `APPROVED` | Да (`computeSpecialization` до выдачи magicPoints) |
| **Diminishing returns XP между картами** | §1.7 | `APPROVED` (кривая — `OPEN`) | Да (`computeDiminishedXp`, шаг в `ProvisionalBalanceConfig`) |
| **Respec строго до перехода на следующую карту** | §1.12, §26.6 | `APPROVED` | Да (`respecHeroBeforeMapTransition` + блокировка после портала) |
| **6 фундаментальных школ магии («Элементальная магия»)** | §2.1, `AC-OWNER-007` | `APPROVED` | Да (`MAGIC_SCHOOL_LABELS`) |
| **6 независимых ветвей Тёмной магии (без слияния)** | §3 | `APPROVED` | Да (`DARK_BRANCH_LABELS`, `darkBranchMasteries`) |
| **Жизненный цикл формул в Гримуаре и свитки как перенос формулы** | §2.1.1, §140.4 | `APPROVED` | Да (`Unknown/KnownUnavailable/ReadyToLearn/Learned`, `transcribeSpellScrollToGrimoire`) |
| **Отсутствие универсальных боевых зелий HP/Mana по умолчанию** | §140.1, §242 | `APPROVED` | Да (не добавлены в ядро v14.2; старый `engine.ts` отмечен в `OPEN_ISSUES.md`) |
| **Стартовые формулы HP / Mana / Damage / Hit / Armor / Block / Magic / Trade** | §§33, 35, 38–41, 45, 132.3 | `DESIGN DECISION` (`DESIGN_TARGET`) | Да (`progression.ts`, `combatAndMagic.ts`, `inventoryAndSave.ts`) |
| **Единый боевой конвейер (без двойного Armor/Resistance)** | §237 | `APPROVED` / Architecture | Да (`resolveCombatPackets`) |
| **MagicStrain: старт каста, без траты на базовые спеллы, 100% сброс порталом** | §§43.2–43.5 | `APPROVED` (пороги/носитель — `OPEN` / `AC-OWNER-006`) | Да (`startSpellCast`, `resetMagicStrainOnMapTransition`) |
| **Некромантия: Режим I (`Dormant_NoMana`) + Режим II (`Residual_Autonomy` без refresh) + Костяной воин** | §§3.1, 103–105 | `APPROVED` | Да (`tickNecromancyMinions`, `reraiseDormantMinions`, `grantBoneWarriorXpAndDestroy`) |
| **Смерть Аватара, 120с задержка у Stone of Souls, потеря XP** | §288, §341.5 | `120с`: `APPROVED`; % XP (`OD-001`): `OPEN` | Да (`triggerAvatarDeath`, `advanceAvatarRespawnTimer`) |
| **Экономика: Copper/Silver/Gold (100:1:1), PartyInventory vs CampaignStorage** | §§134.8, 331.1–331.3, 347 | `APPROVED` (`OD-002`, `OD-003` — `OPEN`) | Да (`copperToDenominations`, `moveItemBetweenInventoryAndStorage`, `verifyItemLocationInvariants`) |
| **Единый кошелёк кампании (`CampaignWallet`)** | §331.4, `OD-004` | `PROPOSED` | Не включён по умолчанию (`enableProposedCampaignWallet: false`) |
| **6 игровых народов и коррекции железа у Эльфов и Троллей** | §§321–328, 351.2, 352.4 | `APPROVED` (политика групп — `OPEN`) | Да (`PLAYABLE_RACES` справочник, без выдумки лора) |
| **Разделение `PlayerOrder` и `LocalReaction` отряда** | §337.2, §343.6 | `APPROVED` | Да (`SquadCommandLayer`, `issueSquadPlayerOrder`, `triggerSquadLocalReaction`) |
| **Questbook: адаптивный UI без авто-маркеров, 6 статусов, RewardId** | §§299, 303 | `USER APPROVED` (`§299`) | Да (`V14VerticalSliceModal.tsx`, `completeQuestStageAndMaybeReward`) |
| **Портальный переход без Expedition Prep + версионированный SaveSnapshot с checksum** | §§290, 341.2, 341.4, 341.6–341.8 | `APPROVED` | Да (`executePortalMapTransition`, перенос выживших `FieldArmy`, `createSaveSnapshot`, `validateAndLoadSnapshot`) |
| **Локальная экономика поселений: 4 стадии ресурса, безопасное переназначение, Food без upkeep, заморозка карты** | §§338–339, §352.4 | `APPROVED` / Architecture (`OD-010` баланс — `OPEN`) | Да (`src/core/settlementEconomy.ts`: `AtSource->Carried->Delivered`, `Food` cap/heal, `Rune Power`, `stopReasons`, freeze) |
| **Существа/отряды (`SquadInstance` + `UnitInstance`), `FieldArmy/Garrison`, Enemy AI без всеведения, `§337.3` автокаст, `§42` эффекты и DR контроля** | §§42, 337.3, 343.2–343.8 | `DESIGN DECISION` / Architecture (`§42.4` коэфф. — `OPEN`) | Да (`src/core/squadsAndEffects.ts`: `applyControlEffect` DR, `filterAutoCastEligibleSpells`, `EnemyGroupAIState`) |
| **Жизненный цикл `MapInstance`, Checkpoints, `ReturnPolicy`, аудит softlock и объекты `§316`** | §§316, 341.7, 341.11, 346.5, 346.8–346.9 | `APPROVED` / Architecture (`OD-018` слоты — `OPEN`) | Да (`src/core/missionAndWorld.ts`, `inventoryAndSave.ts`: валидатор переходов, `AllowReturn`/`OneWay`, pre-portal checkpoints) |
| **Диалоги без глобальной кармы, блокировка ввода, двухшаговая торговля и предвыбор цели** | §§309–315, 333.4–333.7, 347.5, 348.4, 348.6 | `APPROVED` / UI/UX Contract | Да (`PROTOTYPE_DIALOGUES`, `applyDialogueChoice`, `previewMerchantTransaction`, стек `Back/Escape` в `V14VerticalSliceModal.tsx`) |
| **Комбинированное древо школ, прерывание каста без возврата маны, Некромантия §3.1 и магия NPC** | §§2.1.4–2.1.8, 3.1, 6, 40.3–40.4, 337.3 | `APPROVED` (кривая прогресса школы и цены костей — `OPEN`) | Да (`progression.ts`, `combatAndMagic.ts`, `squadsAndEffects.ts`: `prerequisiteSpellIds`, прогресс только своей школы, `applyCombatInterruptToHeroCast`, кости/трупы/духи §3.1, `executeNpcCasterAutoTurn`) |
| **Последовательная миграция сохранений v0->v1->v2, Manual Slots vs AutoSave Ring, боевой сейв-блок** | §§341.6–341.8, 341.15 | `APPROVED` (глубина слотов — `OPEN`) | Да (`inventoryAndSave.ts`, `saveManager.ts`: `migrateSnapshotSequential` с сохранением `extraMetadata`, `canCreateSaveInContext`, `loadLatestValidAutoSave`) |
| **Мульти-геройная группа, общий `PartyInventory` и индивидуальная экипировка** | §§317, 331.1, 351.2 | `APPROVED` (лимит отряда — `OPEN`) | Да (`progression.ts`: `summonCompanionHeroToParty`, `dismissPartyHero`, UI переключения активного героя) |
| **Магия разума без всесилия (боссы, нежить/конструкты, сюжет, воля командира, DR)** | §§4–5, §42.4 | `APPROVED` | Да (`squadsAndEffects.ts`: `applyMindEffectToTarget`, `tickMindEffectsExpiry`) |
| **Формации отрядов без стат-бонусов и ролевой групповой приказ** | §§11.4–11.5 | `APPROVED` | Да (`squadsAndEffects.ts`: `setSquadFormation`, `issueMultiSquadOrder`) |
| **Слотовое строительство, заморозка стройки и ремонт отдельно от лечения бойцов** | §§15.5–15.8, §338.9, §338.11.5 | `APPROVED` | Да (`settlementEconomy.ts`: `startBuildingConstruction`, `damageSettlementBuilding`, `repairSettlementBuilding`) |
| **Обязательный аудит матрицы боевых формул** | §36.1.1–10 | `APPROVED` | Да (`squadsAndEffects.ts`: `runMandatoryCombatMatrixAudit`) |
| **Пополнение потерь отрядов за Wood/Iron (вне боя, с казармой, без авто-воскрешения командиров)** | §14.6 | `APPROVED` / `DESIGN DECISION` | Да (`settlementEconomy.ts`: `replenishSquadFromSettlement`) |
| **Начисление XP герою за победы армии (при отсутствии RPG-деревьев у обычных солдат)** | §14.8, §1.7 | `APPROVED` | Да (`squadsAndEffects.ts`: `awardArmyVictoryXpToHero`) |
| **Аудит экономического softlock поселения без выдачи бесплатных ресурсов** | §338.8 | `APPROVED` / Architecture | Да (`settlementEconomy.ts`: `validateSettlementEconomicPlayability`) |
| **Зависимости квестов (`prerequisiteQuestIds`), защита квест-предметов от удаления и явная проверка запрета зелий HP/Mana** | §§303, 347.7, 140.1, 242 | `APPROVED` | Да (`inventoryAndSave.ts`: `activateQuestIfPrerequisitesMet`, `discardOrDestroyInventoryItem`, `isCombatConsumableAllowed`) |
| **Руны (`WorkerRune` / `HeroRune`), `Rune Tablet`, `Rune/Hero Monuments` и `Rune Power`** | §144, `37_Задание` §3 | `SPELLFORCE BASE — VERIFIED` (число слотов и темп `Rune Power` — `OPEN`) | Да (`src/core/runesAndPlans.ts`: слоты от уровня Аватара, неактивность руны в `PartyInventory`, захват `Rune Monument`, сохранение экипировки при гибели/повторном призыве у `Hero Monument` без дублей, запрет снятия `HeroRune` с экипированного героя, замедление при нехватке `Rune Power`, предупреждение §144.7) |
| **Строительные и военные планы (`Building Plans` / `Unit Plans`) и `Plan Book`** | §146 | `SPELLFORCE BASE — VERIFIED` | Да (`src/core/runesAndPlans.ts`: строгое разделение `building`/`unit`, расовая привязка, постоянная активация без эксплойта дублей и 5 независимых проверок `evaluatePlanAvailability`) |
| **Мобильный осмотр экипировки без hover, предпросмотр дельт статов/конфликтов и двухшаговое удаление** | §§317.5, 317.9, 317.11 | `APPROVED` / UI/UX Contract | Да (`inventoryAndSave.ts`: `previewHeroEquipmentChange`, `V14VerticalSliceModal.tsx`: красная подсветка невыполненных требований inline, окно предпросмотра статов/2H-конфликтов и 2-шаговое подтверждение удаления с предупреждением для рун) |
| **Безлимитный `PartyInventory`: стаки, разделение/объединение, категории и сортировка** | §§274.1–274.3 | `USER APPROVED` (`OD-003` размер стака — `OPEN`) | Да (`inventoryAndSave.ts`: `canStacksMerge`, `pickupItemToPartyInventory`, `splitItemStack`, `mergeItemStacks`, `queryPartyInventoryItems` + фильтры/сортировка в UI) |
| **Единая матрица требований/разблокировок (`UnlockLockCode`) и анти-тупиковый аудит кампании без лора** | §§258.2–258.7, 262.2–262.4, 275.4–275.5 | `CAMPAIGN PROGRESSION CONTRACT` / `VERTICAL CAMPAIGN VALIDATION` | Да (`src/core/campaignAudit.ts`: `evaluateUnifiedUnlock` со всеми 16 кодами, `detectDependencyCycles`, `runCampaignAntiDeadlockAudit` + 10-этапный тест `T-V14-39`) |

---

## 3. Технический план по этапам

1. **Этап 1 (ВЫПОЛНЕН): Лоро-независимое доменное ядро Среза 1 (`v14.2`) + UI + автотесты.**
   - Без переписывания существующих `src/game/*` и `src/showcase/*`.
2. **Этап 2 (ВЫПОЛНЕН): Архитектура RTS-поселений, 4-стадийная логистика, Food, `SquadInstance` и Enemy AI без всеведения (`§§42, 337.3, 338–339, 341.4, 343`).**
   - Реализованы модули `src/core/settlementEconomy.ts` и `src/core/squadsAndEffects.ts`, добавлена вкладка «Поселение» и тесты `tests/v14_slice2.test.ts`.
3. **Этап 3 (ВЫПОЛНЕН): Жизненный цикл карт, объекты `§316`, диалоги без кармы, `ReturnPolicy`, `Checkpoints` и защита ввода (`§§309–316, 333, 341.7, 341.11, 346.5–346.9, 347.5, 348.4–348.6`).**
   - Реализован модуль `src/core/missionAndWorld.ts`, безопасный предпросмотр сделок, откат к checkpoint и тесты `tests/v14_slice3.test.ts`.
4. **Этап 4 (ВЫПОЛНЕН): Комбинированное древо магии, прерывание каста без возврата маны, некромантия §3.1 (кости, decayed, духи), магия NPC/фракций и система слотов/миграций сохранений (`§§2.1.4–2.1.8, 3.1, 6, 40.3–40.4, 341.6–341.8`).**
   - Реализован модуль `src/core/saveManager.ts`, последовательная миграция `v0 -> v1 -> v2`, UI-контролы и тесты `tests/v14_slice4.test.ts`.
5. **Этап 5 (ВЫПОЛНЕН): Мульти-геройная группа, Магия разума без всесилия, формации/групповые приказы, слотовое строительство/ремонт и аудит формул (`§§4–5, 11.4–11.5, 15.5–15.8, 36.1, 317, 351.2`).**
   - Расширены `config.ts`, `types.ts`, `progression.ts`, `settlementEconomy.ts`, `squadsAndEffects.ts`, `sandboxFactory.ts`, `V14VerticalSliceModal.tsx` и добавлены тесты `tests/v14_slice5.test.ts`.
6. **Этап 6 (ВЫПОЛНЕН):**
   - Пополнение отрядов (`§14.6`), начисление XP герою за победы армии (`§14.8`), аудит экономического softlock (`§338.8`), проверка зависимостей квестов (`§303`), блокировка удаления квест-предметов (`§347.7`), явный контроль запрета боевых зелий HP/Mana (`§140.1`, `§242`), UI-контролы и сквозной интеграционный тест `T-V14-30` (`tests/v14_slice6.test.ts`).
7. **Этап 7 (ВЫПОЛНЕН — закрытие верифицированных подсистем `§§144, 146, 317.5/9/11` и миграция сохранений v3):**
   - Реализован `src/core/runesAndPlans.ts` (руны, `Rune Tablet`, `Rune/Hero Monuments`, `Rune Power`, `Building/Unit Plans`, `Plan Book` с 5 проверками), `previewHeroEquipmentChange`, последовательная миграция `v1 -> v2 -> v3`, UI-контролы без hover и с 2-шаговым удалением в `V14VerticalSliceModal.tsx`, тесты `tests/v14_slice7.test.ts` (`T-V14-31..35`).
8. **Этап 8 (ВЫПОЛНЕН — завершающий срез лоро-независимого контракта `§§258, 262, 274`):**
   - Реализован `src/core/campaignAudit.ts` (`evaluateUnifiedUnlock`, `detectDependencyCycles`, `runCampaignAntiDeadlockAudit`), операции со стаками и фильтрация/сортировка `PartyInventory` (`§274`) в `inventoryAndSave.ts` + UI, и сквозная 10-этапная валидация кампании без лора `T-V14-36..39` (`tests/v14_slice8.test.ts`).
9. **Этап 9 (ВЫПОЛНЕН — автономное поведение нежити `§107`, детальная ресурсная матрица 6 рас `§339 / §352.4` и валидатор числового аудита/каталогов `§§352–353`):**
   - Реализован детерминированный автомат `evaluateAutonomousUndeadBehavior` и блокировка новых прямых приказов мёртвого некроманта `issueNecromancyMinionOrder` (`§107`) в `src/core/combatAndMagic.ts`.
   - В `src/core/config.ts` и `src/core/settlementEconomy.ts` развёрнута полная матрица `resourceCapabilities` (`used/gatheredLocally/hasEfficientOwnExtraction/imported/processed`) и `defaultWorkerRole` (`SlaveWorker` для Тёмных эльфов) для всех 6 рас (`§339.2–339.5`, `§352.4`).
   - Создан модуль `src/core/catalogAudit.ts` (валидатор `NumericalAuditEntry` `§352`, валидатор `ContentCatalogEntityRecord` `§353.3`, честный отчёт статуса `PARTIAL` по `§353.5`), подключён к UI и покрыт тестами `T-V14-40..43` (`tests/v14_slice9.test.ts`).
10. **Этап 10 (ВЫПОЛНЕН — завершение лоро-независимого доменного ядра `1.0.0-v14.2-core`: `§§128, 276, 277, 292.6–292.10, 348.4–348.6`):**
   - Реализовано окно выборочной и полной добычи контейнеров (`openLootContainer`, `takeSingleLootEntry`, `takeAllLootEntries`, `§128`) в `missionAndWorld.ts` + UI.
   - Реализованы силуэт экипировки персонажа (`§128`), удалённый атомарный обмен экипировкой между активными героями (`transferEquippedItemBetweenHeroes`, `§128 / §277 #1–3`), запрет перехода порталом при смерти Аватара (`§276.7`) и необратимость поражения миссии при возрождении (`§276.2 #5`).
   - Создан модуль `src/core/fieldCommands.ts`: выделение до 100 юнитов с Shift/Alt и фокусом портрета (`§292.6`), 6 групп быстрого выбора `Ctrl+1..6` (`§292.7`), запрет кнопки формаций при выделении Аватара (`§292.10`), путевые точки/патруль (`§292.8`), 3-состоянийный туман войны (`§292.9`) и детерминированный стек навигации Back/Escape (`§348.4–348.6`).
   - Покрыто тестами `T-V14-44..48` (`tests/v14_slice10.test.ts`), включая сводный Release Gate тест всех 5 аудит-движков ядра.
11. **Этап 11 (ВЫПОЛНЕН — ограниченное закрытие `LEGACY-GAP-001`, 3D PBR-апгрейд и Phase 11: Playable Vertical Slice):**
   - Интегрировано доменное ядро `src/core/*` в живую изометрическую сцену (`src/game/coreBridge.ts`, `src/game/engine.ts`) и 3D-витрину (`src/showcase/HeroShowcase.tsx`) без переписывания `src/core/*` и без изменения утверждённых механик `v14.2`: живой боевой конвейер (`§237`: `HitChance` `§33.6`, `ShieldBlock` `§33.8`, потолок сопротивлений `+75%`, живой «Журнал боя» в HUD), производные статы Аватара (`§33`), базовые и разблокируемые со свитков заклинания (`F`/`G`/`X` + `C` Морозный импульс / `V` Искра) + `MagicStrain` (`§§38–43`), некромантия (`§105`), запрет боевых зелий (`§140.1`/`§242`), 120с возрождение у Stone of Souls (`§288`), 6 групп быстрого выбора (`Ctrl+1..6`), блокировка формаций с Аватаром (`§292.10`), путевые точки/патруль (`§292.8`), 3-состоянийный туман войны (`§292.9`), кликабельное взаимодействие с объектами мира (сундуки `§128`, Камень Душ и Портал `§316` с проверкой «только Аватар»), пауза очереди повреждённых зданий и ремонт за древесину (`§15.8`).
   - Устранён двойной слой инвентаря: `InventoryModal` переведён напрямую на канонические `HeroState.equipment` (7 слотов) и `PartyInventory` ядра с проверкой требований экипировки (`§1.5`/`§317.5`), изучением свитков в Гримуар (`§140.4`) и защитой квестовых предметов (`§347.7`).
   - В живой сцене реализована полная система сохранений кампании: раздельные ключи `MANUAL_SAVE_KEY` и `AUTO_SAVE_KEY` (`§341.7`), запрет сохранения в бою при `allowSaveDuringCombat = false` (`§341.6`), `SaveSnapshot v3` с FNV-1a и автоматический откат на валидное ручное сохранение при повреждении автосохранения (`§341.8`), кнопка загрузки из меню паузы.
   - Выполнен визуальный апгрейд сцены на Three.js (`src/game/isoTextures3D.ts`, `src/game/isoModels3D.ts`, `src/game/isoRenderer3D.ts`, `src/game/renderer.ts` + Visual Polish Pass 01) с точной 1:1 проекцией (`< 0.01 px`), 2D тактическим оверлеем и авто-откатом на 2D-рендерер.
   - Покрыто автотестами `T-V14-49..53` (`tests/v14_phase11_integration.test.ts`), всего `55 / 55 PASS`.
12. **Этап 11.1 (ВЫПОЛНЕН — Runtime Validation в Chromium/Playwright):**
    - Проведена реальная браузерная и мобильная проверка (3D WebGL Software SwiftShader, 2D Fallback, мобильный viewport `390×844`, 10-шаговый игровой сценарий), зафиксированы 7 дефектов (`DEF-01..DEF-07`) и аппаратные ограничения среды (`BLOCKED` для hardware GPU/смартфонов) в `/PHASE_11_1_RUNTIME_REPORT.md`.
13. **Этап 11.2 (ВЫПОЛНЕН — Runtime Defect Fixes: стабилизация `DEF-01..DEF-07`):**
    - Устранены все 7 runtime-дефектов (`DEF-01` мобильная шапка `360/390/430/768 px`, `DEF-02` атрибуция союзных/вражеских снарядов в боевом журнале, `DEF-03` мобильный доступ к 6 группам, 3 формациям и журналу боя, `DEF-04` явные уведомления об отказе действий экипировки/свитков при мёртвом Аватаре внутри HUD и `InventoryModal` без несанкционированной автопаузы, `DEF-05` разведение баннера и zoom-панели + touch-кнопки `>=44px`, `DEF-06` исправление всех 7 пустых подписей слотов экипировки, `DEF-07` linear-RGB калибровка 3D-ландшафта/освещения и удаление дубля баннера возрождения) без модификации `/src/core/*` и правил `v14.2`.
    - Добавлены регрессионные автотесты `T-V14-54` и `T-V14-55` (`57 / 57 PASS`), пройдена повторная мульти-вьюпортная браузерная верификация, отчёт оформлен в `/PHASE_11_2_RUNTIME_FIX_REPORT.md`.
14. **Этап 12 (ЗАБЛОКИРОВАН РЕШЕНИЯМИ ВЛАДЕЛЬЦА из `OPEN_ISSUES.md`):**
    - Полное закрытие открытых решений `OD-001..020`, `OD-RUNTIME-001`, `AC-OWNER-001..006`, `AC-AUD-021`, переход на 6-расовую экономику (`OD-010`) вместо технического моста `gold -> iron + copper`, верифицированные каталоги юнитов (`OD-011`), предметов (`OD-012`), 130+ заклинаний (`OD-007`), вторая 3D-карта сектора B / 3D-NPC торговцы и сюжетные миссии (`OD-013..014`).

