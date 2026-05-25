# any-console

[![Release](https://img.shields.io/github/v/release/kt0319/any-console)](https://github.com/kt0319/any-console/releases/latest)
[![Last commit](https://img.shields.io/github/last-commit/kt0319/any-console)](https://github.com/kt0319/any-console/commits/main)
[![CI](https://github.com/kt0319/any-console/actions/workflows/ci.yml/badge.svg)](https://github.com/kt0319/any-console/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/kt0319/any-console/branch/main/graph/badge.svg)](https://codecov.io/gh/kt0319/any-console)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-3776ab.svg)](https://www.python.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-4fc08d.svg)](https://vuejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg)](https://fastapi.tiangolo.com/)

**A seamless dev console across phone and PC.** A self-hosted web environment where the same tmux session is accessible from any device via a browser.

Website: <https://any-console.highedge.net/>

## Why any-console?

- **Seamless across devices** — Start `npm test` on your PC, check the output on your phone during commute, and pick up where you left off when you get home. tmux sessions persist — closing the browser doesn't end the session.
- **Serious mobile input** — A custom virtual keyboard with flick input. Practical enough to run `git commit` from your phone.
- **Jobs, Git, and terminal in one place** — No tab-switching between tools. Run scripts, commit, and push — all in one tap.

## Features

- **Persistent sessions** — tmux × WebSocket; switch devices without losing your session
- **Mobile-optimized input** — Custom flick keyboard with swipe support
- **Web terminal** — xterm.js based, multi-tab and split-pane
- **Git UI** — Branch switching, commit, push/pull, diff, history, stash, merge/rebase
- **Job runner** — One-tap shell script execution; define and edit jobs from the UI
- **PWA** — Installable on phone and desktop
- **Lightweight stack** — Vue 3 + Pinia + FastAPI, built with Vite

## Platform support

The runtime (Python + Node + tmux) is POSIX-portable, but the operational tooling around it is not. Two supported setups:

| Setup | Platforms | `./any-console` CLI | Auto-update | Service mgmt |
|-------|-----------|---------------------|-------------|--------------|
| **systemd** (first-class) | Linux | yes | `./any-console update` | systemd |
| **Docker** | Linux / macOS / Windows | no | manual `git pull` + `docker compose` | docker compose |

macOS / Windows users can run any-console via Docker, but the `./any-console` helper (`start`, `update`, `logs`, etc.) requires systemd and is Linux-only. Daily-use development happens on the systemd path.

## Setup

### systemd (Linux) — first-class

```bash
git clone https://github.com/kt0319/any-console.git
cd any-console
./any-console setup
```

Installs dependencies, builds the frontend, and registers a systemd service in one step. After this, manage the service with `./any-console start|stop|update|logs|...` (see [Commands](#commands)).

### Docker (Linux / macOS / Windows)

```bash
git clone https://github.com/kt0319/any-console.git
cd any-console
docker compose -f docker/compose.yml up -d
```

Open `http://<host>:8888`.

The `./any-console` CLI does not manage Docker containers. Use `docker compose` directly for start/stop/logs, and `git pull && docker compose ... up -d --build` to update.

### Requirements

Required:

- Python 3.11+
- Node.js 18+
- `git` — used by the Git UI
- `tmux` — required for terminal session management

Optional:

- `gh` (GitHub CLI) — for fetching GitHub repos, issues, PRs, and Actions

Installation examples:

```bash
# Debian/Ubuntu
sudo apt install python3 nodejs git tmux
# optional: follow the official gh install guide

# macOS
brew install python node git tmux gh
```

## Authentication

- On first start, if `data/auth.json` does not exist, a random 32-character token is generated and saved automatically.
- The connection URL is printed to stdout and journalctl once. Open it on your device to start an authenticated session.
- On subsequent starts, `data/auth.json` is never overwritten.
- The token can be changed from the "Security" settings in the UI.

### Disabling authentication (for closed networks like Tailscale)

```bash
# via environment variable
ANY_CONSOLE_DISABLE_AUTH=1 ./any-console start

# or in config.json
# "auth_disabled": true
```

## Commands

For the systemd setup, all operations go through the `./any-console` command. (Docker users: manage with `docker compose` instead — see [Platform support](#platform-support).)

```
./any-console setup      First-time setup (install deps + build + register systemd)
./any-console update     Update to latest (git pull + update deps + build + restart)
./any-console start      Start the service          (systemctl start)
./any-console stop       Stop the service           (systemctl stop)
./any-console restart    Restart the service        (systemctl restart)
./any-console status     Show status (service state, URL, version)
./any-console logs       Show service logs          (journalctl)
./any-console version    Show version
```

### Updating

```bash
./any-console update
```

Runs `git pull` → update deps → build → restart in one shot. Skips steps where nothing has changed.

## Repository layout

```
api/      Backend (FastAPI)
ui/       Frontend (Vue 3 + Pinia, built with Vite)
docker/   Docker files
docs/     Architecture & design docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module-level breakdown.

## Configuration

- Workspace settings (icons, job definitions, links, etc.) are stored in `config.json`.
- Generated automatically on first run. To configure manually, copy `config.json.example` and edit it.
- Export/import is available from the settings modal.

## Project Stance

any-console is built primarily for the author's own daily use.

- **Issues and PRs are welcome**, but responses are best-effort and not guaranteed.
- **This project has strong opinions** (see `CLAUDE.md`). Pull requests that conflict
  with the existing design philosophy may be declined regardless of code quality.
- **Fork freely** if you want a different direction — that is the spirit of MIT.
- **Release cadence is irregular.** A quiet month does not mean the project is abandoned.
- **No SLA, no roadmap promises.** Features land when they are useful to the author.

If these terms work for you, welcome aboard.

## License

[MIT](LICENSE)
