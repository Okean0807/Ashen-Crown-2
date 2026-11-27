# ASHEN CROWN — PHASE 11.3: DEPLOYMENT REPORT

**Дата отчёта:** 27.11.2026  
**Общий статус Phase 11.3:** **`BLOCKED`** *(не завершена до получения независимого публичного HTTPS URL и фактической проверки 11 шагов владельцем на физическом смартфоне)*  
**Phase 11.4 / Phase 12:** **НЕ НАЧАТЫ** (заблокированы до завершения Phase 11.3 и отдельного согласования владельца).

---

## 1. Сводка Release Candidate и Deployment

| Поле | Фактическое значение | Статус |
|---|---|---|
| **Git commit SHA** | `9111536560dd5e85e10844e84a6c774870196a4b` (`9111536`) | `PASS` |
| **RC branch / tag** | Ветка `rc/phase-11.3` (отдельно от `main`), тег `rc-phase-11.3-frozen` *(внимание: `.git` внутри контейнера AI Studio эфемерен при холодном перезапуске; для долговременного хранения экспортируйте/отправьте репозиторий на GitHub)* | `PASS` |
| **Deployment provider** | Независимый публичный провайдер **не развёрнут**; активен только управляемый dev-контейнер Google AI Studio (Google Cloud Run) | `BLOCKED` |
| **Deployment ID / revision** | Текущий dev-контейнер AI Studio: `K_SERVICE=ais-dev-on732n7bwv63slck3xpbuf`, `K_REVISION=ais-dev-on732n7bwv63slck3xpbuf-00002-lmm`. Независимый публичный revision: **отсутствует** | `BLOCKED` |
| **Preview URL (публичный)** | **НЕ СОЗДАН** (`ais-pre-on732n7bwv63slck3xpbuf-561696380231.europe-west2.run.app` → `HTTP/2 404`; `ais-dev-on732n7bwv63slck3xpbuf-561696380231.europe-west2.run.app` закрыт `applet-auth` и даёт `HTTP 403` на смартфоне) | `BLOCKED` |
| **HTTP status (опубликованный публичный URL)** | `ais-pre`: **`404 Not Found`**; `ais-dev`: **`302` → `/__cookie_check.html` → `aistudio.google.com/applet-auth-bridge`** (`403` на смартфоне) | `FAIL` / `BLOCKED` |
| **Способ авторизации** | `ais-dev`: принудительная авторизация Google AI Studio (`applet-auth-bridge` / `applet-auth`). Публичный unauthenticated доступ (`allUsers` → `roles/run.invoker`): **не настроен** (требуется деплой владельцем) | `BLOCKED` |
| **Подтверждение загрузки JS/CSS** | На локальном `vite preview` (`dist/`): `PASS` (`200 OK`, 0 ошибок). На публичном HTTPS URL: **`BLOCKED`** (публичный URL не создан) | Локально `PASS` / Публично `BLOCKED` |
| **Результат запуска кампании** | Локальный headless Chromium (`dist/`): `PASS` (не является доказательством теста на смартфоне). Физический смартфон (11 шагов): **`NOT_TESTED` / `BLOCKED`** | `NOT_TESTED` |
| **Состояние диагностической панели (`?diag=1`)** | Реализована в `src/components/DiagnosticsOverlay.tsx`, выключена по умолчанию, не меняет игровые механики; отображает все 9 метрик: `Renderer (WebGL/2D)`, `WebGL status`, `FPS`, `Draw Calls (DC)`, `Triangles (Tri)`, `Screen resolution`, `devicePixelRatio`, `Game objects`, `Renderer errors` | Код `PASS` / Смартфон `NOT_TESTED` |

---

## 2. Аудит возможностей независимого размещения (6 проверок)

| № | Проверка | Фактический результат | Статус |
|---|---|---|---|
| **1** | Действующий Cloud Run service | Существует только внутренний AI Studio dev-контейнер (`ais-dev-on732n7bwv63slck3xpbuf`, rev `00002-lmm`). Отдельного публичного Cloud Run сервиса в проекте владельца нет; `ais-pre` возвращает `404`. | `BLOCKED` |
| **2** | Полномочия агента создавать/обновлять deployment | **Отсутствуют.** В контейнере не установлены `gcloud`, `gsutil`, `docker`, `podman`, `vercel`, `netlify`, `wrangler`, `gh`, `surge`; `firebase` CLI не авторизован (`No authorized accounts`); у агента нет инструмента публикации Cloud Run / Share App. | `BLOCKED` |
| **3** | Доступность `unauthenticated invocation` | На `ais-dev` отключена на уровне шлюза AI Studio. В собственном Cloud Run сервисе владельца доступна после деплоя и назначения `allUsers` → `roles/run.invoker` (при отсутствии org policy `Domain Restricted Sharing`). | `BLOCKED` |
| **4** | Обязательная AI Studio авторизация на текущем URL | **Да.** `ais-dev/?diag=1` перехватывается на уровне Google Frontend ещё до отдачи `index.html`: `302` → `/__cookie_check.html` → `https://aistudio.google.com/applet-auth-bridge?applet_id=7cdb7de9-0269-486e-9e23-642350312eb5&return_url=...` → `aistudio.google.com/applet-auth` (`HTTP 403` на смартфоне). | `FAIL` |
| **5** | Автономность production build `dist/` | **Да.** `dist/` является полностью статическим веб-приложением (`dist/index.html`, JS, CSS) без обязательного серверного бэкенда и без сетевых обращений к `aistudio.google.com`. | `PASS` |
| **6** | Прямой HTTPS URL без `aistudio.google.com/applet-auth` | Не может быть создан агентом без полномочий владельца на публикацию. Требуется выполнение инструкции из раздела 5. | `BLOCKED` |

---

## 3. Контрольные суммы Production Build (`dist/`)

Сборка `vite build` (0 ошибок TypeScript, `src/core/*` и правила `v14.2` не изменялись):

| Файл | Размер (байт) | SHA-256 |
|---|---|---|
| `dist/index.html` | `1 410` | `513be937bbbe3aff86d80e2e344c15894aed194cb5cab0d25e1b294a611deef6` |
| `dist/assets/index-C55UYYGC.js` | `3 103 496` | `913021ef8e20d13337256939c3f2bf6c501e4484c91856e53ceb55b4d854ed4e` |
| `dist/assets/index-8aCK3eFC.css` | `58 880` | `0b87e5c34cea6bb2abedfe1ab8c876c1ab968d065586d8676f5e50e25bf0bd9c` |

---

## 4. Ограничения и блокеры

1. **Главный блокер (`BLOCKED`):** отсутствие у агента полномочий/CLI (`gcloud`, учётных данных GCP/Firebase/Netlify/Cloudflare) для создания публичного HTTPS-деплоя вне `aistudio.google.com/applet-auth`.
2. **Непроверенные пункты на опубликованном URL (`NOT_TESTED` / `BLOCKED`):**
   - Прямое открытие HTTPS в Chrome (Android) / Safari (iOS) без редиректа на AI Studio.
   - `HTTP 200` для главной страницы, JS и CSS на публичном URL.
   - Реальный аппаратный FPS, Draw Calls, Triangles, WebGL-контекст и 11 шагов ручного теста на физическом смартфоне.
3. **Эфемерность `.git` в контейнере:** ветка `rc/phase-11.3` (`9111536`) зафиксирована локально в текущем контейнере, но при холодном сбросе песочницы `.git` очищается — рекомендуется экспортировать/выгрузить проект через AI Studio.

---

## 5. Пошаговая инструкция для владельца (разблокировка публикации)

### Основной вариант — Google Cloud Run через интерфейс Google AI Studio

1. **Точное название действия:**
   - В Google AI Studio: **Deploy app** (**Deploy to Cloud Run**).
   - В Google Cloud Console (если после деплоя потребуется открыть публичный доступ): **Allow unauthenticated invocations** (назначение IAM-роли `Cloud Run Invoker` для `allUsers`).
2. **Где находится кнопка / настройка:**
   - **AI Studio:** верхняя правая панель редактора проекта → иконка ракеты **Deploy app** (рядом с *Share app* / *Download app*).
   - **Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/) → верхний выбор проекта → меню **☰ → Cloud Run → Services** → выбрать созданный сервис → вкладка **Security** (раздел **Authentication**) и вкладка **Networking** (раздел **Ingress Control**).
3. **Какие разрешения требуются (для аккаунта `JuriVollmer@gmail.com` в выбранном GCP-проекте):**
   - Подключённый биллинг (Cloud Billing) у выбранного Google Cloud проекта.
   - Роль **Cloud Run Admin** (`roles/run.admin`) или **Owner** / **Editor** (для создания сервиса и изменения IAM-политики `run.services.setIamPolicy`).
   - Включённые API: *Cloud Run Admin API* и *Cloud Build API* (AI Studio включает их автоматически при первом деплое).
   - Отсутствие корпоративной политики организации `Domain Restricted Sharing` (`constraints/iam.allowedPolicyMemberDomains`), блокирующей `allUsers` (для личного аккаунта Gmail обычно не мешает).
4. **Какие параметры выбрать:**
   - **Google Cloud Project:** ваш личный проект с активным биллингом.
   - **Region:** `europe-west2` (или ближайший к вам регион).
   - **Authentication (в Cloud Run → Security):** **`Allow unauthenticated invocations`** (проверить в **Permissions**, что `allUsers` имеет роль **`Cloud Run Invoker`**).
   - **Ingress Control (в Cloud Run → Networking):** **`All`**.
5. **Какие данные вернуть агенту после выполнения:**
   - Итоговый публичный **Cloud Run Service URL** (вида `https://<service>-<hash>.<region>.run.app`).
   - Название **сервиса** и **Revision ID** (указано на вкладке *Revisions* в Cloud Run).
   - Подтверждение, включён ли **Allow unauthenticated invocations** (`Да/Нет`).
   - После этого агент сразу выполнит проверку нового HTTPS URL (`HTTP 200`, отсутствие редиректа на `aistudio.google.com`, загрузку JS/CSS и запуск кампании с `?diag=1`), а затем вы пройдёте 11 шагов на физическом смартфоне.

### Альтернативный вариант без Google Cloud Billing (чистая статика `dist/` за 2 минуты)
1. **Действие:** **Download app** в Google AI Studio → локальная сборка `npm install && npm run build` → публикация папки `dist/` через **Netlify Drop** (`https://app.netlify.com/drop`) или **Cloudflare Pages** (*Direct Upload*).
2. **Где находится:** верхняя панель AI Studio → **Download app** (ZIP); затем перетащить папку `dist/` на `https://app.netlify.com/drop`.
3. **Разрешения:** не требуются права GCP или биллинг Cloud Run.
4. **Параметры:** загружать именно папку **`dist/`** (после `npm run build`).
5. **Что вернуть агенту:** полученный публичный `https://...` URL (агент проверит его в автоматическом тесте до вашего запуска на смартфоне).
