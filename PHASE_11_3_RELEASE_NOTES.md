# ASHEN CROWN — PHASE 11.3: RELEASE NOTES (NEW RECOVERED BASELINE)

**Дата:** 2026-11-28  
**Репозиторий:** `Okean0807/Ashen-Crown-2`  
**Базовый коммит:** `9032979656e4336937ac2aa5a671b98de88253d8` (`main`)  
**Предлагаемая ветка RC (на утверждение владельца):** `rc/phase-11.3-recovered-baseline`  
**Предлагаемый тег RC (на утверждение владельца):** `rc-phase-11.3-baseline-1`

> **Важно:** данный Release Candidate является **новым проверенным базовым срезом (Recovered Baseline)** на базе `main` (`9032979`), а не восстановлением утраченного контейнерного коммита AI Studio `9111536560dd5e85e10844e84a6c774870196a4b`.

---

## 1. Изменения поверх `9032979` в этом RC Baseline

1. **Удаление временной сетевой диагностики AI Studio (утверждённая очистка):**
   * `src/main.tsx` — возвращён к чистому React bootstrap без глобального monkey-patch `window.fetch` и без внешнего зонда `https://jsonplaceholder.typicode.com/todos/1`.
   * Удалены `src/utils/networkDiagnostic.ts`, `src/utils/networkReachabilityProbe.ts`, `scripts/diagnose-boot-403.mjs`.
   * В скомпилированном production-бандле `dist/` зафиксировано `0` обращений к `jsonplaceholder.typicode.com` и `aistudio.google.com`.
2. **Устранение мобильного UI-дефекта `DEF-11.3-01` (High):**
   * `src/components/DiagnosticsOverlay.tsx` — панель диагностики переведена в режим `pointer-events-none` (с `pointer-events-auto` на кнопке `Скрыть`), благодаря чему на экране `360×800` при `/?diag=1` панель больше не блокирует нажатие на `Начать кампанию` и тапы по карте.

## 2. Сохранённые инварианты

* Доменное ядро `src/core/*` (15 модулей) и каноническая спецификация `v14.2` (`public/assets/aistudio/*`) **не изменялись**.
* `package.json` и `bun.lock` (`lockfileVersion: 2`) **не изменялись**; воспроизводимая установка выполнена через официальный `bun 1.4.5` (`bun install --frozen-lockfile`, 187 пакетов).
* Все 7 фиксов Phase 11.2 (`DEF-01..DEF-07`) и диагностическая панель `?diag=1` сохранены.

## 3. Результаты проверок

* **Автотесты (`npm test`):** `57 / 57 PASS` (`fail 0`, включая `T-V14-54` и `T-V14-55`).
* **TypeScript (`npx tsc --noEmit`):** `PASS` (`0` ошибок).
* **Production Build (`npm run build`, Vite 8.3.8):** `PASS` (`dist/index.html` `1 410 B`, `dist/assets/index-BlFjGGIV.js` `1 430 186 B` / `384.08 kB gzip`, `dist/assets/index-DKkSa4mG.css` `45 012 B` / `9.24 kB gzip`).
* **Runtime Validation (Playwright Chromium):** Desktop `1280×720` `PASS`, Mobile `360/390/430/768` `PASS`, WebGL2 SwiftShader `PASS`, 2D Fallback `PASS`.

## 4. Известные ограничения

1. **Физический Android-смартфон (`NOT_TESTED`):** реальный аппаратный FPS WebGL2, нагрев, двупальцевый pinch-zoom, системные жесты краёв экрана и `100dvh` адресной строки требуют проверки владельцем на физическом устройстве после публикации Preview Deployment.
2. **Высокое число Draw Calls в 3D (`DC: 265` на мобильном, `459` на десктопе):** решение о батчинге/инстансинге будет приниматься после фактических замеров FPS на реальном смартфоне.
3. **Планшетный режим `768×1024` (`DEF-11.3-02`, Low):** на ширине `>= 768px` используются компактные десктопные кнопки (`25–36 px` по высоте).
4. **Открытые дизайн-вопросы (`OPEN_ISSUES.md`):** `OD-001..020`, `OD-RUNTIME-001`, `AC-OWNER-001..006`, `AC-AUD-021` остаются открытыми на решение владельца.
