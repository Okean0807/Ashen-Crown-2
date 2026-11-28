# ASHEN CROWN — PHASE 11.3: FULL AUTOMATED VALIDATION REPORT

**Дата валидации:** 2026-11-28  
**Репозиторий:** `Okean0807/Ashen-Crown-2`  
**Ветка и `HEAD`:** `main` (`9032979656e4336937ac2aa5a671b98de88253d8`)  
**Рабочее дерево:** утверждённые изменения очистки Phase 11.3 сохранены и не закоммичены (`4 files changed, 1 insertion(+), 892 deletions(-)`)  
**Статус автоматической технической валидации (Gates A–C):** **`PASS`**  
**Статус браузерной runtime-проверки (Gate D) и физического смартфона (Gate E):** **`NOT_TESTED`**

---

## 1. Environment & Network Verification

| Проверка | Команда / Источник | Фактический результат | Статус |
|---|---|---|---|
| DNS + HTTPS `https://registry.npmjs.org/` | `getent ahosts registry.npmjs.org` & `curl -I https://registry.npmjs.org/` | DNS `104.16.9.34`, `HTTP/2 200` | **`PASS`** |
| DNS + HTTPS `https://github.com/` | `getent ahosts github.com` & `curl -I https://github.com/` | DNS `192.168.0.6`, `HTTP/2 200` | **`PASS`** |
| DNS + HTTPS `https://api.github.com/` | `getent ahosts api.github.com` & `curl -I https://api.github.com/` | DNS `192.168.0.6`, `HTTP/2 200` | **`PASS`** |
| HTTPS `https://bun.sh/` | `curl -I https://bun.sh/` | `HTTP/2 200` | **`PASS`** |
| Установка официального Bun в user-space | `https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip` + сверка `SHASUMS256.txt` → `/home/antigravity/.local/bin/bun` | `bun-linux-x64.zip: OK`, версия **`1.4.5`** (совместим с `bun.lock` `lockfileVersion: 2`); системный `/usr/local/bun/bin/bun` (`1.2.14`) и файлы проекта не тронуты | **`PASS`** |
| Node.js / npm | `node --version` / `npm --version` | `v22.23.5` / `12.2.2` | **`PASS`** |

---

## 2. Dependency Installation & Automated Validation Results

| # | Проверка | Точная команда | Exit Code | Фактический результат | Статус |
|---|---|---|---|---|---|
| 1 | Воспроизводимая установка зависимостей | `"$HOME/.local/bin/bun" install --frozen-lockfile` | `0` | `bun install v1.4.5`: **`187 packages installed [70.30s]`**; `package.json` и `bun.lock` не изменены; `package-lock.json` не создан | **`PASS`** |
| 2 | Полный набор автотестов (`57/57`) | `npm test` (`tsx --test tests/*.test.ts`) | `0` | **`tests 57, pass 57, fail 0, cancelled 0, skipped 0`** (`duration_ms: 11209.57`) | **`PASS`** |
| 3 | Регрессионный тест `T-V14-54` (Phase 11.2 DEF-02) | В составе `npm test` (`tests/v14_phase11_integration.test.ts`) | `0` | `ok 15 - T-V14-54 (Phase 11.2 DEF-02)` (`28.00 ms`) | **`PASS`** |
| 4 | Регрессионный тест `T-V14-55` (Phase 11.2 DEF-04) | В составе `npm test` (`tests/v14_phase11_integration.test.ts`) | `0` | `ok 16 - T-V14-55 (Phase 11.2 DEF-04)` (`12.00 ms`) | **`PASS`** |
| 5 | Проверка типов TypeScript | `npx tsc --noEmit` | `0` | `0` ошибок типизации | **`PASS`** |
| 6 | Production-сборка Vite | `npm run build` (`vite build`, `vite v8.3.8`) | `0` | `1698 modules transformed`, `✓ built in 4.96s` (`dist/index.html`, `dist/assets/index-5QEQWqQ1.js`, `dist/assets/index-CHoYSy4f.css`) | **`PASS`** |
| 7 | Проверка отсутствия CommonJS `require(` в `src/` | `rg -n 'require\(' src` | `1` (0 совпадений) | `0` совпадений | **`PASS`** |
| 8 | Сканирование исходников, тестов и `dist/` на внешние диагностические запросы | `rg -n "jsonplaceholder\|networkDiagnostic\|networkReachabilityProbe\|diagnose-boot-403\|__ASHEN_NET_DIAG__\|__ASHEN_NET_PROBE__" src/ tests/ index.html package.json vite.config.ts dist/index.html dist/assets/index-5QEQWqQ1.js` | `1` (0 совпадений) | **`0` совпадений** (в том числе в скомпилированном `dist/assets/index-5QEQWqQ1.js`) | **`PASS`** |
| 9 | Сохранность `?diag=1` и `DiagnosticsOverlay.tsx` | `rg -n "params\.get\('diag'\)\|DiagnosticsOverlay" src/App.tsx src/components/DiagnosticsOverlay.tsx` | `0` | Подключение `?diag=1` (`src/App.tsx:58`) и `<DiagnosticsOverlay />` (`src/App.tsx:1017`) сохранены | **`PASS`** |
| 10 | Проверка чистоты diff | `git diff --check` | `0` | `0` замечаний | **`PASS`** |
| 11 | Браузерная runtime-проверка (Gate D: десктоп/мобильный viewport, WebGL + 2D fallback, `?diag=1`, save/load) | — | N/A | Не выполнялась в рамках данной задачи | **`NOT_TESTED`** |
| 12 | Проверка на физическом смартфоне (Gate E: 11 шагов владельца) | — | N/A | Не выполнялась (требуется отдельно согласованный Preview Deployment и тест владельца на смартфоне) | **`NOT_TESTED`** |

---

## 3. Production Artifact Fingerprint (`dist/`)

| Артефакт | Размер (байт) | Gzip (Vite) | SHA-256 |
|---|---|---|---|
| `dist/index.html` | `1 410` | `0.66 kB` | `805d9fe67c8f49d59cf422a53078261743834df5e1ba7dc8d670ac68b6f3b981` |
| `dist/assets/index-5QEQWqQ1.js` | `1 430 158` | `384.08 kB` | `a15ae2b1df8457e4be536f14f0fa1d0496486100d428031df43e6d63bd092684` |
| `dist/assets/index-CHoYSy4f.css` | `45 067` | `9.25 kB` | `4a62678bf024767bec0e3d6675501b021e54051eeb57d3e599279dc9bc6e2171` |

*(Примечание: это отпечаток новой очищенной сборки на `vite v8.3.8` / `bun.lock` без удалённых `networkDiagnostic.ts` и `networkReachabilityProbe.ts`; не приравнивается к утраченным хэшам `9111536`.)*

---

## 4. Final Protected-File Integrity Verification (Pre-Install vs Post-Validation)

| Защищённый файл / группа | SHA-256 ДО установки | SHA-256 ПОСЛЕ валидации | Статус |
|---|---|---|---|
| `package.json` | `5ff872a191674ee0f3d2187ce993f481b0a122c4d7a9a1d9e24bdd6093379ad1` | `5ff872a191674ee0f3d2187ce993f481b0a122c4d7a9a1d9e24bdd6093379ad1` | **`PASS`** |
| `bun.lock` | `66d07b5b2f862019f790f6830886ae08cc0855ce6bcd05859c73966483bad261` | `66d07b5b2f862019f790f6830886ae08cc0855ce6bcd05859c73966483bad261` | **`PASS`** |
| `src/components/DiagnosticsOverlay.tsx` | `8f4ad75d1fa5cc14d45da71f15dbe3e2f62a0b023a956221e1bc47e26543ece6` | `8f4ad75d1fa5cc14d45da71f15dbe3e2f62a0b023a956221e1bc47e26543ece6` | **`PASS`** |
| `src/App.tsx` | `0abd61f3f4c89fe6c5a8b1914deeb51c3d553f26922fb8f790e8a319a091a24f` | `0abd61f3f4c89fe6c5a8b1914deeb51c3d553f26922fb8f790e8a319a091a24f` | **`PASS`** |
| `src/core/*.ts` (combined sorted SHA-256, 15 files) | `44906b8f054ea1e352ad51dc3e40a63f45adeb6d364b54ace3bc5a5edcfe7651` | `44906b8f054ea1e352ad51dc3e40a63f45adeb6d364b54ace3bc5a5edcfe7651` | **`PASS`** |
| `public/assets/aistudio/*.md` (combined sorted SHA-256, 5 files) | `d8474c98df347ebc318ef6103274bc7d0610f02aaa2831d68f9c16f5b36bb5b7` | `d8474c98df347ebc318ef6103274bc7d0610f02aaa2831d68f9c16f5b36bb5b7` | **`PASS`** |

---

## 5. Git State & Compliance Verification

| Проверка Git / Ограничений | Фактическое состояние | Статус |
|---|---|---|
| `HEAD` | `9032979656e4336937ac2aa5a671b98de88253d8` | **`PASS`** |
| Текущая ветка | `main` (`main...origin/main`) | **`PASS`** |
| Новые ветки / теги | `0` новых веток, `0` тегов | **`PASS`** |
| Утверждённые незакоммиченные изменения очистки | Ровно 4 отслеживаемых файла: `M src/main.tsx`, `D src/utils/networkDiagnostic.ts`, `D src/utils/networkReachabilityProbe.ts`, `D scripts/diagnose-boot-403.mjs` (`+1 / -892`) | **`PASS`** |
| Коммит / Push / RC / Deployment / Phase 11.4 | Не выполнялись | **`PASS`** |

---

## 6. Summary by Status

* **`PASS`:** Network/Registry connectivity, official Bun `1.4.5` (user-space), `bun install --frozen-lockfile` (`187 packages`, exit `0`), `npm test` (`57/57`, including `T-V14-54` and `T-V14-55`, exit `0`), `npx tsc --noEmit` (exit `0`), `npm run build` (exit `0`), `rg 'require(' src` (`0` matches), zero external diagnostic requests in `src/`/`tests/`/`dist/`, `?diag=1` intact, all protected SHA-256 hashes unchanged, Git refs unchanged.
* **`FAIL`:** None (`0`).
* **`BLOCKED`:** None (`0`) for automated validation (Gates A–C).
* **`NOT_TESTED`:** Browser runtime validation of the new `dist/` build (Gate D) and physical smartphone 11-step validation (Gate E).
