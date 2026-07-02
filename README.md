# any-console

[![Release](https://img.shields.io/github/v/release/kt0319/any-console)](https://github.com/kt0319/any-console/releases/latest)
[![Last commit](https://img.shields.io/github/last-commit/kt0319/any-console)](https://github.com/kt0319/any-console/commits/main)
[![CI](https://github.com/kt0319/any-console/actions/workflows/ci.yml/badge.svg)](https://github.com/kt0319/any-console/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/kt0319/any-console/branch/main/graph/badge.svg)](https://codecov.io/gh/kt0319/any-console)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-3776ab.svg)](https://www.python.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-4fc08d.svg)](https://vuejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg)](https://fastapi.tiangolo.com/)

<p align="center">
  <img src="docs/hero.webp" alt="Same tmux session, seamless across phone and PC" width="100%">
</p>

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

**Client side: any OS, any device with a modern browser.** This is the whole point of any-console — open `https://<your-host>/` from your phone, laptop, or any browser and you get the full UI.

**Host (server) side: Linux or macOS for real use.** The runtime is POSIX-portable. Service management is platform-native — `systemd` on Linux, `launchd` on macOS — and `tmux` provides persistent sessions on both. The `./any-console` helper detects the OS and drives the right service manager.

| Host setup | Platforms | Status |
|------------|-----------|--------|
| **systemd** (first-class) | Linux | Supported. Daily-use target. |
| **launchd** (first-class) | macOS | Supported. Ideal for an always-on Mac (e.g. a Mac mini server). |

A first-class host needs Linux or macOS. Browser access from any OS (macOS / Windows / iOS / Android) is fully supported and is the intended client experience.

> **macOS note:** an always-on Mac mini / Mac Studio is the sweet spot. The `launchd` service is registered as a `LaunchDaemon`, so it starts at boot and survives without an interactive login. A MacBook that sleeps or travels is a poor fit for the "check from your phone while away" use case.

## Setup

On a Linux or macOS host, `./any-console setup` registers a systemd (Linux) or launchd (macOS) service. Your SSH keys, git/gh config, and shell environment all carry over; tmux sessions persist across reboots.

### systemd (Linux) — first-class

```bash
git clone https://github.com/kt0319/any-console.git ~/any-console
cd ~/any-console
./any-console setup
```

Installs dependencies, builds the frontend, and registers a systemd service in one step. After this, manage the service with `./any-console start|stop|update|logs|...` (see [Commands](#commands)).

### launchd (macOS) — first-class

```bash
git clone https://github.com/kt0319/any-console.git ~/any-console
cd ~/any-console
./any-console setup
```

Same one-step flow as Linux. On macOS, `setup` registers a `launchd` `LaunchDaemon` (sudo required) that runs as your user and starts at boot — no interactive login needed, which is what makes a headless Mac mini work. Logs go to `logs/any-console.log` (`./any-console logs` tails it). Manage the service with the same `./any-console start|stop|restart|status|logs` commands.

Best paired with an always-on Mac mini / Mac Studio. Install the dependencies first with `brew install python node git tmux gh`.

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

## HTTPS

PWA installation and service workers require HTTPS.

**Tailscale Serve** is the easiest option — it handles certificates automatically:

```bash
tailscale serve --bg / proxy http://127.0.0.1:8888
```

Access the app at `https://<your-device>.ts.net/`.

**Direct TLS** is also supported via environment variables:

```bash
SSL_KEYFILE=/path/to/key.pem SSL_CERTFILE=/path/to/cert.pem ./any-console start
```

The default port is 8888. To change it, set `__global__.port` in `config.json`.

## Commands

For the systemd (Linux) and launchd (macOS) setups, all operations go through the `./any-console` command, which detects the OS and drives the right service manager.

```
./any-console setup      First-time setup (install deps + build + register service)
./any-console update     Update to latest (git pull + update deps + build + restart)
./any-console start      Start the service          (systemctl / launchctl)
./any-console stop       Stop the service           (systemctl / launchctl)
./any-console restart    Restart the service        (systemctl / launchctl)
./any-console status     Show status (service state, URL, version)
./any-console logs       Show service logs          (journalctl / log file)
./any-console run        Run in foreground (no service; any OS)
./any-console version    Show version
```

`run` skips the service manager entirely and starts the API directly via `python3 -m api.main`. Useful for WSL or for quick test runs without registering a service.

### Updating

```bash
./any-console update
```

Runs `git pull` → update deps → build → restart in one shot. Skips steps where nothing has changed.

## Repository layout

```
api/      Backend (FastAPI)
ui/       Frontend (Vue 3 + Pinia, built with Vite)
docs/     Architecture & design docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module-level breakdown.

## Configuration

- Workspace settings (icons, job definitions, links, etc.) are stored in `config.json`.
- Generated automatically on first run. To configure manually, copy `config.json.example` and edit it.
- Export/import is available from the settings modal.

## Project Stance

any-console started as a tool built for daily real-world use, and it stays close
to that origin: pragmatic, opinionated, and focused on what actually gets used.

- **Issues and PRs are welcome.** Responses may take a while, but they are read.
- **The project has a clear design philosophy** (see `CLAUDE.md`). Contributions
  that fit that direction are the easiest to land; ones that pull elsewhere may
  work better as a fork — that is the spirit of MIT.
- **Releases come when they're ready.** A quiet month does not mean the project is
  abandoned.
- **The roadmap is lightweight.** Features land as they prove useful in practice.

If that sounds good to you, welcome aboard.

## License

[MIT](LICENSE)
