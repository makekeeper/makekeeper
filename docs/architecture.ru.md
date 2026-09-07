# Архитектура и разработка

Всё, что нужно разработчику: как приложение устроено, стек, монорепозиторий, как поднять его
локально и где лежат подробные документы. [README](../README.ru.md) — для тех, кто решает,
ставить ли приложение; этот файл — для тех, кто его меняет.

> 🇬🇧 English version: **[architecture.md](architecture.md)**

---

## Обзор архитектуры

```
┌────────────────────────────────────────────────────────────┐
│                      Браузер :8080                         │
│                  (nginx reverse proxy)                     │
└──────────────┬────────────────────────────┬────────────────┘
               │ /api/*                     │ /*
               ▼                            ▼
   ┌─────────────────────────┐   ┌─────────────────────────┐
   │  NestJS Backend         │   │  Vite / Vue 3 SPA       │
   │  :3000 /api             │   │  :4200                  │
   │  REST + Socket.io       │   │  App shell              │
   │  + Swagger /api/docs    │   │  (sidebar/router/i18n)  │
   │                         │   │                         │
   │   PluginRegistry        │   │   PluginRegistry        │
   │   ├ projects            │   │   ├ projects            │
   │   ├ inventory           │   │   ├ inventory           │
   │   ├ storages            │   │   ├ storages            │
   │   ├ logistics           │   │   ├ logistics           │
   │   ├ settings · chat     │   │   ├ settings · chat     │
   │   ├ notify · schedule   │   │   ├ notify · schedule   │
   │   ├ capture · stats     │   │   ├ capture · stats     │
   │   ├ codes · mobile      │   │   ├ codes · mobile      │
   │   ├ tags · uxmode       │   │   ├ tags · uxmode       │
   │   ├ phone-bridge        │   │   ├ phone-bridge        │
   │   └ exchange·multiuser  │   │   └ exchange·multiuser  │
   │     · external          │   │     · external          │
   │        │                │   └─────────────────────────┘
   │   Prisma ORM            │
   └────────┬────────────────┘
            ▼
   ┌─────────────────────┐
   │  PostgreSQL :5432   │
   └─────────────────────┘
```

Оба приложения — бэкенд и фронтенд — реализуют **плагинную архитектуру**: каждый функциональный домен живёт в отдельной библиотеке `libs/plugin-<id>` и содержит в одном месте свою идентичность (манифест), i18n, агентские инструменты, настройки, пункт навигации и роуты. Оболочки приложений (`apps/backend`, `apps/frontend`) лишь потребляют реестр плагинов — навигация, роуты и строки не захардкожены. Плагин **не импортирует код другого плагина**: интеграция идёт через контрибуции, capability-реестр и шину событий. Отключение плагина убирает ровно его функциональность.

---

## Технологический стек

| Слой | Технология |
|------|-----------|
| **Монорепо** | [Nx 23](https://nx.dev) |
| **Бэкенд** | [NestJS 11](https://nestjs.com) (REST + Socket.io + [Swagger](https://swagger.io)) |
| **Фронтенд** | [Vue 3](https://vuejs.org) + [Vite 7](https://vitejs.dev) + [Vue Router 4](https://router.vuejs.org) + [Pinia 3](https://pinia.vuejs.org) |
| **UI** | [Tailwind CSS 3](https://tailwindcss.com) + [Lucide Icons](https://lucide.dev) |
| **ORM / Миграции** | [Prisma 7](https://www.prisma.io) |
| **База данных** | PostgreSQL 16 |
| **Среда разработки** | VS Code Dev Container (Node 22 / Debian Bookworm) |
| **Тесты** | Jest 30 (backend) + Vitest 4 (frontend) |
| **Линтер / Форматтер** | ESLint 9 + Prettier 3 |
| **Язык** | TypeScript 5.9 (strict) |

---

## Структура монорепозитория

```
makekeeper/
├── apps/
│   ├── backend/                    # NestJS: оболочка + рантайм агента
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # Схема БД
│   │   │   └── migrations/         # История миграций
│   │   ├── Dockerfile
│   │   └── src/app/                # Bootstrap, регистрация плагинов, Swagger
│   └── frontend/                   # Vue 3 SPA (оболочка: sidebar/router/i18n)
│       ├── src/plugins/loader.ts   # Регистрация frontend-плагинов (по одной строке)
│       ├── tailwind.config.js      # Единственный конфиг Tailwind (сканирует apps/** и libs/**)
│       ├── Dockerfile
│       └── nginx.prod.conf
├── libs/
│   ├── plugin-contract/            # Framework-agnostic типы: манифест, типы инструментов, ORef
│   ├── backend-core/               # Общая NestJS-инфраструктура: Prisma, реестры, i18n
│   ├── frontend-core/              # Общая Vue-инфраструктура: реестр, дизайн-система, тосты
│   └── plugin-<id>/                # Самостоятельный плагин (backend + frontend + i18n)
│       └── src/{backend,frontend,i18n}
├── deploy/                         # docker-compose.prod.yml + install.sh (self-host)
├── docs/                           # Документация разработчика (см. ниже)
├── .devcontainer/                  # Dev Container: nginx, startup.sh, docker-compose
├── nx.json                         # Конфигурация Nx
└── package.json                    # Зависимости монорепо (версии строго зафиксированы)
```

**Правило импортов:** никаких относительных импортов между проектами — только алиасы
`@makekeeper/*`. Границы модулей проверяет NX в линте.

---

## Плагины

Каждый плагин — самостоятельная библиотека `libs/plugin-<id>`. Ядро (`projects`, `settings`) не отключается; остальные можно включать/выключать (в многопользовательском режиме — на уровне пользователя).

| Плагин | Название | Назначение |
|--------|----------|-----------|
| `projects` | Проекты | Стадии DIY-проектов и управление задачами. `IDEA → PLANNING → IN_PROGRESS → TESTING → COMPLETED` |
| `inventory` | Инвентарь | Учёт компонентов и мест хранения, минимальные остатки |
| `storages` | Хранилище | Ячейки и локации хранения компонентов |
| `logistics` | Логистика | Планирование закупок и трекинг посылок. `CART → ORDERED → SHIPPED → DELIVERED` |
| `settings` | Настройки | Подключение AI-провайдеров и конфигурация ключей |
| `chat` | AI-ассистент | Панель диалогового AI-ассистента |
| `notify` | Уведомления | Шина и входящие: любой плагин сообщает человеку факт; маршруты по типам в каналы, тихие часы, журнал доставок |
| `schedule` | Напоминания и календарь | Напоминания по правилам RFC 5545 с часовым поясом, хуки плагинов в назначенный момент и календарь как живой вид на даты других плагинов |
| `capture` | Съёмка с телефона | Фото детали с телефона по QR-коду (опц. Cloudflare-туннель) |
| `phone-bridge` | Мост телефона | Сессия сопряжённого телефона за съёмкой и сканированием — QR-сопряжение, доступ по токену, опц. туннель |
| `codes` | Этикетки и сканирование | QR / Code 128 на любой объект плагинов и обратное сканирование |
| `mobile` | Интерфейс телефона | Устанавливаемая телефонная поверхность `/m` — свои экраны, а не сжатый десктоп |
| `stats` | Статистика | Ежедневные агрегаты активности плагинов и графики |
| `tags` | Теги | Универсальная система тегов и поиск по всем объектам |
| `uxmode` | Режим интерфейса | Переключатель «простой / продвинутый» с переопределениями по функциям |
| `multiuser` | Многопользовательский режим | Опциональные аккаунты, изоляция данных по scope и общий доступ |
| `exchange` | Экспорт / импорт | Перенос проектов, хранилищ и бэкапов между инстансами (`.mkx`) |
| `external` | Внешние плагины | Сторонние плагины в своих контейнерах: обнаружение, сопряжение, разрешения, подписанные вызовы |

Как добавить или изменить плагин — канонический рецепт в [`docs/plugins.md`](plugins.md).

---

## Сквозные механизмы

- **Плагинный реестр.** Оболочки собирают навигацию, роуты и строки из реестра — ничего не захардкожено. Кросс-плагинная интеграция — через контрибуции, `CapabilityRegistryService` и шину событий (`docs/plugins.md`).
- **Слой агентских возможностей.** Каждый плагин публикует методы как атомарные инструменты для AI-агента, классифицированные в коде: `READ` (безопасное чтение), `WRITE` (авто-запись с аудитом) и `DESTRUCTIVE` (рантайм блокирует и требует явного подтверждения пользователя). Подробнее: [`docs/agent-capabilities.md`](agent-capabilities.md).
- **Канонические ссылки на объекты (ORef).** Любой объект именуется одной ссылкой `mk://<pluginId>/<entityType>/<entityId>`. Формат/разбор — только в `libs/plugin-contract` (`docs/object-refs.md`).
- **Многопользовательский оверлей.** Опциональный JWT-логин, изоляция данных по scope, общий доступ и персональный набор плагинов. Каждый плагин обязан работать корректно и с оверлеем, и без него (`docs/multiuser.md`).
- **Шифрование секретов.** API-ключи и прочие секреты шифруются в БД; в многопользовательском режиме — изоляция ключей по пользователю.
- **i18n.** Никаких строковых литералов в коде, кроме i18n-ключей. Каждый плагин владеет своими локалями `en`/`ru`; бэкенд-текст резолвится через `PluginI18nService`.
- **Реалтайм и офлайн.** Обновления через Socket.io; фронтенд устойчив к обрыву связи.

---

## База данных

Схема управляется через **Prisma**. Основные группы моделей:

```
Project ──< Task ──< TaskComponent >── Component
        ──< ProjectComponent >── Component ──< OrderComponent >── Order
        ──< AIChatSession ──< AIChatMessage
Order ──< TrackingEvent ; Supplier ──< Order ; ReturnRequest
Component ──< StockMovement ; StockSnapshot ; StatsDaily
Storage (ячейки хранения) ; Tag ──< TagLink (полиморфные теги)
User ──< ScopeGrant ; UserKeyring ──< KeySession ; SecretAccessLog   (multiuser)
AIProviderConfig ; AgentToolConfig ; PluginConfig ; CaptureSession   (настройки/рантайм)
```

Полный перечень моделей — в [`apps/backend/prisma/schema.prisma`](../apps/backend/prisma/schema.prisma).

---

## Быстрый старт (Dev Container)

> **Требования:** Docker Desktop, VS Code с расширением [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

1. Откройте папку проекта в VS Code.
2. Нажмите **«Reopen in Container»** (или `Ctrl+Shift+P` → _Dev Containers: Reopen in Container_).
3. Dev Container автоматически:
   - установит зависимости (`npm install`);
   - запустит PostgreSQL и Nginx через Docker Compose;
   - применит миграции Prisma (бэкенд затем наполнит пустую базу демо-мастерской);
   - поднимет NestJS backend на `:3000` и Vite frontend на `:4200` (Nginx проксирует их на `:8080`).
4. Откройте **http://localhost:8080** в браузере.

Логи сервисов — в `.devcontainer/logs/`.

---

## Разработка без Dev Container

### Предварительные требования

- Node.js ≥ 22
- Docker (для PostgreSQL) или локальный PostgreSQL 16

### Настройка

1. Установите зависимости:
   ```sh
   npm install
   ```

2. Создайте `.env` в корне (см. `.env.example`):
   ```env
   DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/diy_inspector?schema=public"
   ```

3. Запустите PostgreSQL и dev-nginx:
   ```sh
   docker compose -f .devcontainer/docker-compose.yml up -d
   ```

4. Примените миграции:
   ```sh
   cd apps/backend
   npx prisma migrate deploy
   cd ../..
   ```

   При первом старте бэкенд наполняет пустую базу демонстрационной мастерской;
   `DEMO_SEED=0` — стартовать пустым.

5. Запустите оба приложения:
   ```sh
   npx nx run-many --targets=serve
   ```
   - Backend: http://localhost:3000
   - Frontend: http://localhost:4200

Полезные команды Nx:

```sh
npx nx serve <project>       # dev-сервер одного проекта
npx nx build <project>       # сборка одного проекта
npx nx run-many -t build     # собрать всё (сначала библиотеки)
npx nx lint <project>        # линт одного проекта
npm run format               # prettier
```

---

## API и документация

Все эндпоинты доступны по префиксу `/api`. Плагины регистрируют свои контроллеры сами,
поэтому набор роутов зависит от включённых плагинов. Базовые:

| Метод | Путь | Описание |
|-------|------|---------|
| `GET` | `/api` | Health check |
| `GET` | `/api/plugins` | Список зарегистрированных плагинов |
| `GET` | `/api/projects` | Проекты с задачами и компонентами |
| `GET` | `/api/inventory/components` | Компоненты инвентаря |
| `GET` | `/api/logistics/orders` | Заказы |
| `GET` | `/api/logistics/shopping-list` | Список недостающих компонентов |
| `GET` | `/api/settings/providers` | AI-конфигурации |

**Интерактивная документация API — Swagger UI по адресу `/api/docs`** (с OAuth2-логином при
включённом многопользовательском режиме). См. [`docs/api-docs.md`](api-docs.md).

---

## Тестирование

```sh
# Все тесты
npx nx run-many --targets=test

# Только backend (Jest)
npx nx test backend

# Только frontend (Vitest)
npx nx test frontend

# Один файл
npx nx test <project> --testFile=src/path/to/file.spec.ts
```

---

## Конфигурация

Процессные переменные окружения (см. `.env.example`):

| Переменная | Описание | Пример |
|-----------|---------|--------|
| `DATABASE_URL` | Строка подключения к PostgreSQL | `postgresql://user:pass@localhost:5432/diy_inspector?schema=public` |
| `UPLOADS_DIR` | Каталог для загруженных файлов | `./uploads` |
| `PORT` | Порт бэкенда | `3000` |
| `APP_SECRET` | Ключ шифрования секретов в БД | *(сгенерировать)* |
| `JWT_SECRET` | Ключ подписи JWT (многопользовательский режим) | *(сгенерировать)* |

Настройки уровня плагинов (ключи AI-провайдеров, параметры capture и т.д.) хранятся в БД
и задаются через UI, а не через переменные окружения. Полный справочник переменных для
self-host — в **[INSTALL.md](../INSTALL.md)**.

---

## Документация разработчика

| Документ | О чём |
|----------|-------|
| [`CLAUDE.md`](../CLAUDE.md) | Операционное руководство и конвенции репозитория |
| [`docs/plugins.md`](plugins.md) | Рецепт создания/изменения плагина; слоты, capability, события |
| [`docs/agent-capabilities.md`](agent-capabilities.md) | Слой агентских инструментов (READ / WRITE / DESTRUCTIVE) |
| [`docs/multiuser.md`](multiuser.md) | Многопользовательский оверлей: права и изоляция данных |
| [`docs/object-refs.md`](object-refs.md) | Канонические ссылки на объекты `mk://` |
| [`docs/exchange.md`](exchange.md) | Формат экспорта/импорта `.mkx` |
| [`docs/api-docs.md`](api-docs.md) | Swagger/OpenAPI на `/api/docs` |
| [`docs/mcp.md`](mcp.md) | MCP-сервер: подключение Claude Desktop/Code к инстансу |
| [`docs/tls-public-access.md`](tls-public-access.md) | Публичный доступ по TLS / туннели |
| [`INSTALL.md`](../INSTALL.md) | Установка и сопровождение self-host |

---
