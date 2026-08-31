# MakeKeeper

> 🇷🇺 Русская версия: **[README.ru.md](README.ru.md)**

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/License-FSL--1.1--ALv2-blue.svg)](LICENSE.md) &nbsp;**Source-available** — free for personal & self-hosted use; not open source. See [`LICENSING.md`](LICENSING.md).

**MakeKeeper** is a personal platform for managing DIY projects of any kind — electronics, woodworking, 3D printing, knitting, sewing, and anything else you build. It is not tied to a particular craft. The app brings a project task tracker, an inventory of parts and materials, storage locations, order logistics, statistics, and an AI assistant together in a single browser-based web interface. Everything is split into **self-contained plugins**, each of which can be enabled or disabled without touching the core.

---

## Table of contents

- [Key features](#key-features)
- [Architecture overview](#architecture-overview)
- [Tech stack](#tech-stack)
- [Monorepo layout](#monorepo-layout)
- [Plugins](#plugins)
- [Cross-cutting mechanisms](#cross-cutting-mechanisms)
- [Database](#database)
- [Installation (self-host)](#installation-self-host)
- [Quick start (Dev Container)](#quick-start-dev-container)
- [Development without a Dev Container](#development-without-a-dev-container)
- [API & documentation](#api--documentation)
- [Testing](#testing)
- [Configuration](#configuration)
- [Developer documentation](#developer-documentation)
- [Where development happens](#where-development-happens)
- [License](#license)

---

## Key features

- **Projects** with a task lifecycle and component associations.
- **Inventory & storage** — a catalogue of parts and materials, storage cells, minimum stock levels, stock movements.
- **Logistics** — orders, suppliers, parcel tracking, and an auto-computed shopping list from shortages.
- **AI assistant** — chat scoped to an object; the agent calls plugin tools (READ / WRITE / DESTRUCTIVE) with user confirmation gating destructive operations.
- **AI provider settings** — Gemini, OpenAI, Anthropic, Ollama, and any OpenAI-compatible endpoint; keys are encrypted at rest.
- **Notifications, reminders and a calendar** — one inbox in the header; every plugin posts facts to
  it, and each person decides which of them also leave the app (web push built in, more as plugins).
  Reminders are set on an object or on nothing at all, repeat by RFC 5545 rules in your own time
  zone, and the calendar draws every date the plugins already hold — nothing is stored twice.
- **Statistics** — daily activity aggregates from plugins, rendered as charts.
- **Universal tags** — one tagging system with search across every object in the app.
- **Phone capture** — shoot a part on your phone via a QR code (optionally over a Cloudflare tunnel).
- **Export / import** — move projects, storages, and full backups between instances as `.mkx` archives.
- **Multi-user mode (optional)** — accounts, per-scope data isolation, scope sharing with restrictions, and per-user plugin sets.
- **Interface mode** — a simple/advanced switch with per-feature overrides.
- **Realtime** — updates over Socket.io; **offline resilience** on the frontend.

---

## Architecture overview

```
┌────────────────────────────────────────────────────────────┐
│                      Browser :8080                         │
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
   ┌─────────────────────────┐
   │  PostgreSQL :5432       │
   └─────────────────────────┘
```

Both the backend and the frontend implement a **plugin architecture**: each functional domain
lives in its own `libs/plugin-<id>` library and declares its identity (manifest), i18n, agent
tools, settings, sidebar entry, and routes in one place. The app shells (`apps/backend`,
`apps/frontend`) merely consume the plugin registry — navigation, routes, and strings are never
hardcoded. A plugin **never imports another plugin's code**: integration happens through
contributions, a capability registry, and an event bus. Disabling a plugin removes exactly its
functionality.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | [Nx 23](https://nx.dev) |
| **Backend** | [NestJS 11](https://nestjs.com) (REST + Socket.io + [Swagger](https://swagger.io)) |
| **Frontend** | [Vue 3](https://vuejs.org) + [Vite 7](https://vitejs.dev) + [Vue Router 4](https://router.vuejs.org) + [Pinia 3](https://pinia.vuejs.org) |
| **UI** | [Tailwind CSS 3](https://tailwindcss.com) + [Lucide Icons](https://lucide.dev) |
| **ORM / migrations** | [Prisma 7](https://www.prisma.io) |
| **Database** | PostgreSQL 16 |
| **Dev environment** | VS Code Dev Container (Node 22 / Debian Bookworm) |
| **Tests** | Jest 30 (backend) + Vitest 4 (frontend) |
| **Linter / formatter** | ESLint 9 + Prettier 3 |
| **Language** | TypeScript 5.9 (strict) |

---

## Monorepo layout

```
makekeeper/
├── apps/
│   ├── backend/                    # NestJS: app shell + agent runtime
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # DB schema
│   │   │   ├── seed.ts             # Seed data
│   │   │   └── migrations/         # Migration history
│   │   ├── Dockerfile
│   │   └── src/app/                # Bootstrap, plugin registration, Swagger
│   └── frontend/                   # Vue 3 SPA (shell: sidebar/router/i18n)
│       ├── src/plugins/loader.ts   # Frontend plugin registration (one line each)
│       ├── tailwind.config.js      # The single Tailwind config (scans apps/** and libs/**)
│       ├── Dockerfile
│       └── nginx.prod.conf
├── libs/
│   ├── plugin-contract/            # Framework-agnostic types: manifest, tool types, ORef
│   ├── backend-core/               # Shared NestJS infra: Prisma, registries, i18n
│   ├── frontend-core/              # Shared Vue infra: registry, design system, toasts
│   └── plugin-<id>/                # Self-contained plugin (backend + frontend + i18n)
│       └── src/{backend,frontend,i18n}
├── deploy/                         # docker-compose.prod.yml + install.sh (self-host)
├── docs/                           # Developer documentation (see below)
├── .devcontainer/                  # Dev Container: nginx, startup.sh, docker-compose
├── nx.json                         # Nx configuration
└── package.json                    # Monorepo dependencies (strictly pinned versions)
```

**Import rule:** no cross-project relative imports — use the `@makekeeper/*` aliases only. NX
enforces module boundaries in lint.

---

## Plugins

Each plugin is a self-contained `libs/plugin-<id>` library. The core (`projects`, `settings`) is
never disabled; the rest can be toggled on and off (per user in multi-user mode).

| Plugin | Name | Purpose |
|--------|------|---------|
| `projects` | Projects | DIY project stages and task management. `IDEA → PLANNING → IN_PROGRESS → TESTING → COMPLETED` |
| `inventory` | Inventory | Component and storage-location tracking, minimum stock levels |
| `storages` | Storage | Component storage cells and locations |
| `logistics` | Logistics | Purchase planning and parcel tracking. `CART → ORDERED → SHIPPED → DELIVERED` |
| `settings` | Settings | AI provider connection and API-key configuration |
| `chat` | AI Assistant | Conversational AI assistant panel |
| `notify` | Notifications | The bus and the inbox: any plugin tells a person something; per-type routing to channels, quiet hours, a delivery log |
| `schedule` | Reminders & calendar | Reminders on RFC 5545 rules with a time zone, plugin hooks fired at a moment, and the calendar as a live view over other plugins' dates |
| `capture` | Phone photo | Shoot a part on your phone via a QR code (optional Cloudflare tunnel) |
| `phone-bridge` | Phone bridge | The paired-phone session behind capture and scanning — QR pairing, tokenised access, optional tunnel |
| `codes` | Labels & scanning | QR / Code 128 labels for anything the plugins own, and scanning them back |
| `mobile` | Phone interface | The installable phone surface at `/m` — its own screens, not a shrunken desktop |
| `stats` | Statistics | Daily aggregates of plugin activity, rendered as charts |
| `tags` | Tags | Universal tagging and search across every object |
| `uxmode` | Interface mode | Simple/advanced switch with per-feature overrides |
| `multiuser` | Multi-user mode | Optional accounts, per-scope data isolation, and scope sharing |
| `exchange` | Export / Import | Move projects, storages, and backups between instances (`.mkx`) |
| `external` | External plugins | Third-party plugins in their own containers: discovery, pairing, permissions, signed calls |

How to add or change a plugin — the canonical recipe is in [`docs/plugins.md`](docs/plugins.md).

---

## Cross-cutting mechanisms

- **Plugin registry.** The shells assemble navigation, routes, and strings from the registry — nothing is hardcoded. Cross-plugin integration goes through contributions, `CapabilityRegistryService`, and an event bus (`docs/plugins.md`).
- **Agent capabilities layer.** Every plugin exposes its methods as atomic tools for the AI agent, classified in code: `READ` (safe queries), `WRITE` (auto-runs with an audit trail), and `DESTRUCTIVE` (the runtime blocks and requires explicit human-in-the-loop confirmation). See [`docs/agent-capabilities.md`](docs/agent-capabilities.md).
- **Canonical object references (ORef).** Every object is named by one reference, `mk://<pluginId>/<entityType>/<entityId>`. Formatting/parsing lives only in `libs/plugin-contract` (`docs/object-refs.md`).
- **Multi-user overlay.** Optional JWT login, per-scope data isolation, scope sharing, and per-user plugin sets. Every plugin must stay correct with the overlay on and off (`docs/multiuser.md`).
- **Secrets encryption.** API keys and other secrets are encrypted at rest; in multi-user mode keys are isolated per user.
- **i18n.** No string literals in code other than i18n keys. Each plugin owns its `en`/`ru` locales; backend text is resolved via `PluginI18nService`.
- **Realtime & offline.** Updates over Socket.io; the frontend is resilient to connection loss.

---

## Database

The schema is managed with **Prisma**. The main model groups:

```
Project ──< Task ──< TaskComponent >── Component
        ──< ProjectComponent >── Component ──< OrderComponent >── Order
        ──< AIChatSession ──< AIChatMessage
Order ──< TrackingEvent ; Supplier ──< Order ; ReturnRequest
Component ──< StockMovement ; StockSnapshot ; StatsDaily
Storage (storage cells) ; Tag ──< TagLink (polymorphic tags)
User ──< ScopeGrant ; UserKeyring ──< KeySession ; SecretAccessLog   (multiuser)
AIProviderConfig ; AgentToolConfig ; PluginConfig ; CaptureSession   (settings/runtime)
```

The full list of models is in [`apps/backend/prisma/schema.prisma`](apps/backend/prisma/schema.prisma).

---

## Installation (self-host)

The app ships as two containers (backend + nginx/SPA) plus a bundled PostgreSQL. Images are
published to the GitHub Container Registry (ghcr.io). Install on a clean machine **in one line**:

```bash
curl -fsSL https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/install.sh | bash
```

The installer generates secrets, brings the stack up, and prints the URL (default
`http://localhost:8080`). To update, re-run with `--update`; DB migrations are applied
automatically on container start.

The stack can also be deployed manually (the same `deploy/docker-compose.prod.yml`) via
`docker compose`, **Portainer**, **Coolify**, or Dokploy.

Full guide — installation, variable reference, updating, backup/restore, and troubleshooting:
**[INSTALL.md](INSTALL.md)**.

---

## Quick start (Dev Container)

> **Requirements:** Docker Desktop, VS Code with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.

1. Open the project folder in VS Code.
2. Click **“Reopen in Container”** (or `Ctrl+Shift+P` → _Dev Containers: Reopen in Container_).
3. The Dev Container automatically:
   - installs dependencies (`npm install`);
   - starts PostgreSQL and Nginx via Docker Compose;
   - applies Prisma migrations and loads seed data;
   - brings up the NestJS backend on `:3000` and the Vite frontend on `:4200` (Nginx proxies them at `:8080`).
4. Open **http://localhost:8080** in your browser.

Service logs are in `.devcontainer/logs/`.

---

## Development without a Dev Container

### Prerequisites

- Node.js ≥ 22
- Docker (for PostgreSQL) or a local PostgreSQL 16

### Setup

1. Install dependencies:
   ```sh
   npm install
   ```

2. Create a `.env` in the repo root (see `.env.example`):
   ```env
   DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/diy_inspector?schema=public"
   ```

3. Start PostgreSQL and the dev nginx:
   ```sh
   docker compose -f .devcontainer/docker-compose.yml up -d
   ```

4. Apply migrations and load seed data:
   ```sh
   cd apps/backend
   npx prisma migrate deploy
   npx ts-node --compiler-options '{"module":"commonjs"}' prisma/seed.ts
   cd ../..
   ```

5. Start both apps:
   ```sh
   npx nx run-many --targets=serve
   ```
   - Backend: http://localhost:3000
   - Frontend: http://localhost:4200

Useful Nx commands:

```sh
npx nx serve <project>       # dev server for one project
npx nx build <project>       # build one project
npx nx run-many -t build     # build everything (libs first)
npx nx lint <project>        # lint one project
npm run format               # prettier
```

---

## API & documentation

All endpoints live under the `/api` prefix. Plugins register their own controllers, so the exact
set of routes depends on which plugins are enabled. The baseline:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api` | Health check |
| `GET` | `/api/plugins` | List of registered plugins |
| `GET` | `/api/projects` | Projects with tasks and components |
| `GET` | `/api/inventory/components` | Inventory components |
| `GET` | `/api/logistics/orders` | Orders |
| `GET` | `/api/logistics/shopping-list` | Missing components to buy |
| `GET` | `/api/settings/providers` | AI provider configs |

**Interactive API docs — Swagger UI at `/api/docs`** (with OAuth2 login when multi-user mode is
enabled). See [`docs/api-docs.md`](docs/api-docs.md).

---

## Testing

```sh
# All tests
npx nx run-many --targets=test

# Backend only (Jest)
npx nx test backend

# Frontend only (Vitest)
npx nx test frontend

# A single file
npx nx test <project> --testFile=src/path/to/file.spec.ts
```

---

## Configuration

Process-level environment variables (see `.env.example`):

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/diy_inspector?schema=public` |
| `UPLOADS_DIR` | Directory for uploaded files | `./uploads` |
| `PORT` | Backend port | `3000` |
| `APP_SECRET` | Key for encrypting secrets at rest | *(generate)* |
| `JWT_SECRET` | JWT signing key (multi-user mode) | *(generate)* |

Plugin-level settings (AI provider keys, capture options, etc.) are stored in the database and
configured through the UI, not through environment variables. The full variable reference for
self-hosting is in **[INSTALL.md](INSTALL.md)**.

---

## Developer documentation

| Document | About |
|----------|-------|
| [`CLAUDE.md`](CLAUDE.md) | Operating manual and repository conventions |
| [`docs/plugins.md`](docs/plugins.md) | Recipe for creating/changing a plugin; slots, capabilities, events |
| [`docs/agent-capabilities.md`](docs/agent-capabilities.md) | Agent tools layer (READ / WRITE / DESTRUCTIVE) |
| [`docs/multiuser.md`](docs/multiuser.md) | Multi-user overlay: rights and data isolation |
| [`docs/object-refs.md`](docs/object-refs.md) | Canonical `mk://` object references |
| [`docs/exchange.md`](docs/exchange.md) | `.mkx` export/import format |
| [`docs/api-docs.md`](docs/api-docs.md) | Swagger/OpenAPI at `/api/docs` |
| [`docs/mcp.md`](docs/mcp.md) | MCP server: connect Claude Desktop/Code to your instance |
| [`docs/tls-public-access.md`](docs/tls-public-access.md) | Public TLS access / tunnels |
| [`INSTALL.md`](INSTALL.md) | Self-host installation and maintenance |

---

## Where development happens

This GitHub repository is a **published mirror**. Development happens in a private repository, and
each release is published here as a single snapshot commit that replaces the tree wholesale.

The practical consequence: a pull request merged here would survive as a commit whose content
disappears at the next release. So pull requests are **ported by hand upstream, not merged** — and
the commit that eventually carries your change is authored by the release identity, with credit in
its message rather than in its author field.

That does not make contributions unwelcome — it makes the route explicit. Open an issue to discuss a
change, or open a pull request as the concrete form of the proposal; both are read. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the sign-off every contribution needs.

---

## License

MakeKeeper is **source-available**, not "open source" in the OSI sense.

- The application and first-party plugins (`apps/*`, `libs/plugin-*`) are licensed under the
  **Functional Source License, FSL-1.1-ALv2** ([`LICENSE.md`](LICENSE.md)). You may use, self-host,
  modify, fork and contribute for free; the only thing you may not do is a **Competing Use** — offer
  MakeKeeper, or something substantially similar, to others as a commercial or managed service. Two
  years after each release, that version additionally becomes available under **Apache-2.0**.
- The shared SDK libraries that plugin authors build on (`libs/plugin-contract`,
  `libs/frontend-core`, `libs/backend-core`) are licensed under **Apache-2.0**, so the plugin
  ecosystem is never subject to the FSL restriction.

See [`LICENSING.md`](LICENSING.md) for the full map and [`CONTRIBUTING.md`](CONTRIBUTING.md) for how
contributions are licensed. Need a commercial license? Open an issue to get in touch.
