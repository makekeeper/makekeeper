# MakeKeeper — the backend image

**You have the part. Somewhere.** MakeKeeper keeps a workshop in order: what you are
building, what you have on the shelf, where exactly it is, and what is still on its way — in
one place, on your own server.

This image is the **backend** (REST API + agent runtime, applies its database migrations on
start). A working instance is this image plus **[`makekeeper/web`](https://hub.docker.com/r/makekeeper/web)**
(nginx: serves the interface and proxies `/api`) and a PostgreSQL 16. The install below brings
up all three.

![Pair a phone, photograph a part, and it is in the inventory on the desktop](https://raw.githubusercontent.com/makekeeper/makekeeper/main/docs/media/phone-capture.gif)

![The dashboard: what can be built right now, what is blocking it, and the assistant answering with a tool call](https://raw.githubusercontent.com/makekeeper/makekeeper/main/docs/media/dashboard-light.png)

![The inventory: parts with categories, storage cells, quantities and low-stock warnings](https://raw.githubusercontent.com/makekeeper/makekeeper/main/docs/media/inventory-light.png)

## Install

One line on a clean machine with Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/install.sh | bash
```

It generates the secrets, brings up the stack and prints the URL — `http://localhost:8080` by
default. The first start fills the instance with a **demo workshop**, so nothing begins as empty
lists; one button in the app removes it when you are ready for your own data. Update by re-running
with `--update`. It also installs by hand with `docker compose`, or from **Coolify**, **Dokploy**
or **Portainer** — see [INSTALL.md](https://github.com/makekeeper/makekeeper/blob/main/INSTALL.md).

To pull this mirror instead of the primary registry, set `IMAGE_APP=docker.io/makekeeper/app`
and `IMAGE_WEB=docker.io/makekeeper/web` in the `.env` the installer wrote.

## What it does

- **Know what you can build right now.** A project lists what it needs; MakeKeeper tells you what
  is reserved, what is on the shelf, what is on its way and what is missing — before you start.
- **Find the part.** Every item has a place: a shelf, a drawer, a cell in a grid. Search by name,
  by SKU, or scan the label you printed for it.
- **Never re-order what you already have.** Minimum stock levels, stock movements, and a shopping
  list computed from the shortages of the projects you are actually building.
- **Log the shelf where the shelf is.** Pair a phone, photograph parts one after another, and
  confirm the batch at the desk — the phone is a real screen of the app, not a shrunken desktop.
- **Ask instead of clicking.** An optional AI assistant that reads and changes your workshop
  through the app's own tools, every destructive step gated by your confirmation. Bring your own
  key — Gemini, OpenAI, Anthropic, Ollama or any OpenAI-compatible endpoint — encrypted at rest.
- **Keep it yours.** Your server, your database, your files; export a project, a storage or the
  whole instance as a `.mkx` archive.

Everything above is a **plugin**: turn off what you do not use and it disappears from the
interface, the API and the assistant's tools. The app is not tied to electronics — it fits any
craft where you build things out of parts.

## Tags

`X.Y.Z` (pin this in production), `X.Y`, `latest`. Every tag is the same manifest published to
`ghcr.io/makekeeper/app`, which stays the primary registry.

## Links & licence

[Source and README](https://github.com/makekeeper/makekeeper) ·
[Install guide](https://github.com/makekeeper/makekeeper/blob/main/INSTALL.md) ·
[Releases](https://github.com/makekeeper/makekeeper/releases)

MakeKeeper is **source-available** under the FSL-1.1-ALv2 (free for personal use, self-hosting
including inside a company, modification and forking; not for offering MakeKeeper to others as a
commercial service; each release becomes Apache-2.0 two years after it ships). It is not open
source in the OSI sense, and we do not call it that.
