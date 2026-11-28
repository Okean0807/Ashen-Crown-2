# ASHEN CROWN — PHASE 11.3: RUNTIME VALIDATION REPORT

**Дата валидации:** 2026-11-28  
**Репозиторий:** `Okean0807/Ashen-Crown-2`  
**Базовый коммит (`HEAD`):** `9032979656e4336937ac2aa5a671b98de88253d8` (`main`, незакоммиченная очистка Phase 11.3 + фикс `DEF-11.3-01`)  
**Среда прогона:** `npx vite preview --host 127.0.0.1 --port 4173` (production `dist/`), Chromium (`chromium-1255`), Python Playwright (headless Linux x86_64, Software WebGL SwiftShader + 2D Canvas Fallback)  
**Важное ограничение:** эмуляция мобильных viewport в Playwright (`is_mobile=True, has_touch=True`) и программный SwiftShader **не являются** проверкой на физическом Android-устройстве и не отражают производительность аппаратного мобильного GPU.

---

## 1. Production Build Artifacts Under Test

| Артефакт | Размер (байт) | Gzip | SHA-256 |
|---|---|---|---|
| `dist/index.html` | `1 410` | `0.65 kB` | `eabdeae656be0a3d3ebd81759994d57fa85a352747fd36e97b2647121d0a29d5` |
| `dist/assets/index-BlFjGGIV.js` | `1 430 186` | `384.08 kB` | `a188a7e155b690bbce95520e975a3bfdb701ed4ffb4919458c7779ff56b81fb1` |
| `dist/assets/index-DKkSa4mG.css` | `45 012` | `9.24 kB` | `d0a7b5faffeb71ee576b88596dcfc4a551e082fc0c3235315009c696e11abc81` |

---

## 2. Stage B — Desktop Production Runtime Validation (`1280×720`)

| № | Проверка | Статус | Фактический результат и доказательство |
|---|---|---|---|
| B1 | Запуск production preview | **`PASS`** | `npx vite preview --host 127.0.0.1 --port 4173` запущен и отвечает `HTTP 200` |
| B2 | HTTP-ответ и отсутствие ошибок загрузки | **`PASS`** | `/` → `200`, `/?diag=1` → `200`, `failed_local_requests: 0`, `page_errors: 0`, `forbidden_external_requests: 0` (0 запросов к `jsonplaceholder.typicode.com` и `aistudio.google.com`) |
| B3 | Загрузка основных JS/CSS-ресурсов | **`PASS`** | `GET /assets/index-*.js` (`200`, `text/javascript`) и `GET /assets/index-*.css` (`200`, `text/css`) |
| B4 | Запуск приложения и главного меню | **`PASS`** | Титульный экран отображается (`Начать кампанию` видна), `?diag=1` выключен по умолчанию на `/` (`diag_off_by_default: true`) и включается на `/?diag=1` (`b01_desktop_title.png`) |
| B5 | Запуск кампании | **`PASS`** | Клик `Начать кампанию` открывает игровую сцену и HUD `<header>` (`b02_desktop_campaign.png`) |
| B6 | Отображение игрового мира | **`PASS`** | `<canvas>` `1280×720` отрисован и не пуст (`canvas_non_blank: true`), `22` объекта (`Юн: 18, Зд: 4`) |
| B7 | Перемещение Avatar | **`PASS`** | Правый/левый клик по карте выполнен без `page_errors` |
| B8 | Камера: zoom, pan | **`PASS`** | Кнопки `Приблизить` / `Отдалить`, колесо мыши и перетаскивание камеры работают без ошибок |
| B9 | Выбор юнитов | **`PASS`** | Кнопки `Армия` и `Аватар` переключают выделение без ошибок |
| B10 | Группы и приказы | **`PASS`** | `Ctrl+4` назначает группу (`Группа 4` в баннере), `4` вызывает группу |
| B11 | Формирования (`§292.10`) | **`PASS`** | Во вкладке `Приказы и строй` при выделенном Аватаре все 3 кнопки (`Компактная`, `Рассред.`, `Линия`) заблокированы (`disabled: true`) |
| B12 | Combat log (`Журнал боя`) | **`PASS`** | Панель `Журнал боя` открывается и отображается корректно (`b03_desktop_combat_log.png`) |
| B13 | Использование доступной способности | **`PASS`** | Нажатие `G` (`Восстановление`) при выделенном Аватаре выполняется без исключений |
| B14 | Инвентарь и экипировка | **`PASS`** | `Рюкзак` открывает `Снаряжение Аватара` (`b04_desktop_inventory.png`), присутствует подпись `Шлем не надет` (`DEF-06` intact), закрывается по `Escape` |
| B15 | Сохранение и загрузка | **`PASS`** | `Меню` → `Сохранить кампанию` записывает валидный payload в `localStorage['ashen_crown_save_v1']`; после `page.reload()` появляется `Продолжить игру`, клик восстанавливает игровую сцену (`restored_campaign_after_reload: true`) |
| B16 | Soul Stone, chest и portal | **`NOT_TESTED`** *(в live browser)* | Не подводился Аватар вплотную к объектам в коротком smoke-сценарии Playwright; логика полностью покрыта автотестами `T-V14-49`, `T-V14-50`, `T-V14-52` (`PASS`) |
| B17 | Поведение при смерти Avatar (`120с`, `§288`) | **`NOT_TESTED`** *(в live browser)* | Не доводилось до гибели Аватара в коротком smoke-сценарии Playwright; полностью покрыто автотестами `T-V14-49` и `T-V14-55` (`PASS`) |
| B18 | Pause / Win / Lose | **`PARTIAL`** | **Pause (`Меню`):** `PASS` (`b05_desktop_pause.png`, видны `Продолжить`, `Сохранить кампанию`, `Диагностика`). **Win / Lose:** `NOT_TESTED` в коротком browser smoke-сценарии (требует полного боя/зачистки карты) |

---

## 3. Stage C — Mobile Runtime Validation (Playwright Touch Emulation)

> **Оговорка:** Playwright эмулирует viewport, DPR и touch events в Chromium на Linux x86_64. Это **НЕ** заменяет тестирование на физическом Android-смартфоне (Gate E).

| Viewport | `overflowX` | Перекрытия `<header>` | Кнопки `< 44px` | `/?diag=1` тап `Начать кампанию` | `Строй` (army drawer: 6 групп + 3 формации) | `Журнал боя` | Zoom / Армия tap | `page_errors` | Статус |
|---|---|---|---|---|---|---|---|---|---|
| **`360×800`** (DPR 2) | `0 px` | `0` | `0` | **`PASS`** *(после фикса `DEF-11.3-01`; до фикса был `FAIL`)* | **`PASS`** (`has_assign_select: true`, `has_formations: true`) | **`PASS`** | **`PASS`** | `0` | **`PASS`** |
| **`390×844`** (DPR 2) | `0 px` | `0` | `0` | **`PASS`** | **`PASS`** | **`PASS`** | **`PASS`** | `0` | **`PASS`** |
| **`430×932`** (DPR 3) | `0 px` | `0` | `0` | **`PASS`** | **`PASS`** | **`PASS`** | **`PASS`** | `0` | **`PASS`** |
| **`768×1024`** (DPR 2, tablet `sm+`) | `0 px` | `0` | `28` *(десктопный `md/sm+` layout с `h-9` / `h-8`, см. `DEF-11.3-02` Low)* | **`PASS`** | N/A (используется десктопная правая панель `Приказы и строй`) | **`PASS`** | **`PASS`** | `0` | **`PASS`** *(с замечанием Low по tablet touch targets)* |

* **Pinch-zoom:** в коде присутствует обработчик `pinchZoomCamera` (`src/game/iso.ts`, покрыт регрессионным тестом `legacy_regression.test.ts`), кнопки `+`/`-` проверены тапом в Playwright (`PASS`); реальный двупальцевый мультитач `pinch-zoom` на физическом экране — **`NOT_TESTED`** (вынесен в Android чек-лист).

---

## 4. Stage D — WebGL2 & 2D Fallback Validation

| Сценарий (`/?diag=1`) | Renderer | WebGL статус | Экран / Буфер / DPR | FPS (frameMs) | Объекты / DC / Tri | Ошибки рендерера | `page_errors` | Статус |
|---|---|---|---|---|---|---|---|---|
| **Desktop `1280×720` (WebGL2 SwiftShader)** | `WebGL (Three.js)` | `OK (WebGL2) · SW` | `1280×720` / `1280×720` / DPR `1.00` (рендер `1.00`) | `6 FPS` (`174.1 ms`) *(CPU SwiftShader)* | `22` / `DC: 459` / `Tri: 28 958` | `0` (`Нет ошибок`) | `0` | **`PASS`** |
| **Mobile `390×844` (WebGL2 SwiftShader)** | `WebGL (Three.js)` | `OK (WebGL2) · SW` | `390×844` / `585×1266` / DPR `2.00` (рендер `1.00`) | `2 FPS` (`650.1 ms`) *(CPU SwiftShader)* | `22` / `DC: 265` / `Tri: 22 430` | `0` (`Нет ошибок`) | `0` | **`PASS`** |
| **Desktop `1280×720` (2D Fallback)** | `2D (Canvas fallback)` | `UNAVAILABLE` | `1280×720` / `1280×720` / DPR `1.00` (рендер `1.00`) | `50 FPS` (`19.9 ms`) | `22` (`Юн: 18, Зд: 4`) | `1` *(ожидаемый откат при недоступности WebGL)* | `0` | **`PASS`** |
| **Mobile `390×844` (2D Fallback)** | `2D (Canvas fallback)` | `UNAVAILABLE` | `390×844` / `585×1266` / DPR `2.00` (рендер `1.50`) | `60 FPS` (`16.7 ms`) | `22` (`Юн: 18, Зд: 4`) | `1` *(ожидаемый откат при недоступности WebGL)* | `0` | **`PASS`** |

> **Замечание по производительности:** значения `2–6 FPS` получены на программном CPU-рендерере SwiftShader (`Vulkan 1.3.0 SwiftShader Device`). Они **не характеризуют** реальную скорость WebGL2 на аппаратных GPU смартфонов (Adreno / Mali / Apple GPU). Реальные замеры FPS на физическом устройстве остаются **`NOT_TESTED`**.
