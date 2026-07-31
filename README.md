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

> **macOS note:** an always-on Mac mini / Mac Studio is the sweet spot. The `launchd` service is registered as a user `LaunchAgent`, so it starts at login — enable automatic login (System Settings → Users & Groups) if the Mac runs headless. A MacBook that sleeps or travels is a poor fit for the "check from your phone while away" use case.
>
> **Keep the Mac awake.** macOS sleeps by default, and Tailscale cannot wake a sleeping Mac — while asleep the server is unreachable, and the burst of timeouts right after wake-up causes flaky sessions and reconnect storms. On a server Mac, disable system sleep:
>
> ```bash
> sudo pmset -a sleep 0 disksleep 0
> ```
>
> (Display sleep is fine to keep. Verify with `pmset -g` — `sleep` should be `0`.)

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

Same one-step flow as Linux. On macOS, `setup` registers a `launchd` user `LaunchAgent` (no sudo needed) that starts at login. For a headless Mac mini, enable automatic login and disable system sleep (see the macOS note above). Logs go to `logs/any-console.log` (`./any-console logs` tails it). Manage the service with the same `./any-console start|stop|restart|status|logs` commands.

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

> **Read [SECURITY.md](SECURITY.md) before deploying.** any-console gives the browser full shell access to the host — the token must be treated like an SSH key, and the app must never be exposed to the public internet.

- On first start, if `data/auth.json` does not exist, a random 32-character token is generated and saved automatically.
- The token is printed to the startup log once (stdout / journalctl / `logs/any-console.log`). Open the app URL on your device and sign in with it — the device gets a revocable cookie, so you only enter the token once per device.
- On subsequent starts, `data/auth.json` is never overwritten.
- The token can be changed from the "Security" settings in the UI.

### Adding a new device with a QR code

Once one device is signed in, you can add another (e.g. add your iPhone from your already-authenticated laptop) without typing the token:

1. On the signed-in device, open Settings > Auth and tap "Add new device" (on a desktop-sized screen with no phone paired yet, a one-time "Open on your phone" shortcut also appears on the empty-state screen).
2. Scan the QR code with the new device's camera app.
3. The new device opens the link, signs in automatically, and lands on the normal app screen.

The QR code encodes a one-time link that expires in 90 seconds and can only be used once — if it expires or was already used, the new device falls back to the normal token entry screen. See [docs/DECISIONS.md](docs/DECISIONS.md) (ADR 28) for the security rationale.

### Tailscale header auto-auth (opt-in)

When any-console is served through [Tailscale Serve](https://tailscale.com/kb/1312/serve), Tailscale adds an authenticated `Tailscale-User-Login` header. any-console can use it to skip token entry, but this is **disabled by default** and must be opted into via `config.json`:

```jsonc
// config.json
"__global__": { "trust_tailscale_auth": true }
```

The `ANY_CONSOLE_TRUST_TAILSCALE_AUTH=1` environment variable also enables it, but only where the environment actually reaches the server process — foreground runs (`ANY_CONSOLE_TRUST_TAILSCALE_AUTH=1 ./any-console run`) or a service unit you edited yourself. `./any-console start` delegates to systemd/launchd, which does **not** inherit your shell environment, so prefer `config.json` for the managed service.

> **Security note:** only enable this if requests reach any-console *exclusively* via Tailscale Serve / tailnet peers. The header check trusts loopback and tailnet (CGNAT) source addresses, so any *other* tunnel or reverse proxy on the same host (`ssh -L`, `cloudflared`, nginx, etc.) would let its clients forge the header and bypass authentication entirely. If you use any non-Tailscale proxy in front of any-console, leave this off — token + device-cookie auth works fine over Tailscale too.

A restart is required for changes to take effect.

### Disabling authentication (for closed networks like Tailscale)

```jsonc
// config.json
"__global__": { "auth_disabled": true }
```

As above, the `ANY_CONSOLE_DISABLE_AUTH=1` environment variable works only for foreground runs (`./any-console run`) or a custom service environment — not with `./any-console start`, which does not pass your shell environment to the systemd/launchd service.

## Dispatch API

`POST /dispatch` lets external tools (CI, automation, scripts) launch or send text to a workspace session over HTTP, without opening the UI.

If any-console is only reachable via its `.ts.net` address (the default with Tailscale Serve, see [HTTPS](#https) below), the caller must be on the same tailnet — a hosted CI runner isn't by default. For GitHub Actions, add a step with [`tailscale/github-action`](https://github.com/tailscale/tailscale-github-action) (OAuth client credentials in Secrets, scoped via a Tailscale ACL tag) before the `curl` step. See `.github/workflows/dispatch-on-ci-failure.yml` for a working example.

```bash
curl -X POST https://<your-device>.ts.net/dispatch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace": "my-project",
    "job": "terminal",
    "text": "npm run build\n"
  }'
```

By default (`direct: false`), the request waits in an approval queue — open it from Settings > Dispatches, or via a push notification if enabled. Only after a human approves does the text actually get sent. Set `"direct": true` to skip the queue and run immediately (not allowed for scoped dispatch tokens, see below).

Key fields on the request body (`api/routers/dispatch.py`):

| Field | Description |
|---|---|
| `workspace` | Workspace ID or display name to target |
| `job` | Job key to launch (default: `terminal`) |
| `text` | Text to send to the session (e.g. a shell command) |
| `branch` | Checkout this branch before running (rejected with 400 if the workspace has uncommitted changes and the branch differs from the current one) |
| `direct` | `true` = run immediately, skip the approval queue (default: `false`) |
| `dedup_key` | Opaque string; a new request with the same key replaces the still-pending one instead of queuing a duplicate (useful for repeated CI-failure dispatches) |

For CI/automation, use a **scoped dispatch token** instead of your main token — create one from Settings > Auth > API Tokens. It can only queue dispatch requests (`direct: true` is rejected) and cannot approve queue items or access anything else, so a leaked CI secret can't be used to run arbitrary commands on its own.

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

Upgrade compatibility note: legacy-migration code for versions prior to 2026-06 has been removed — `config.json` files keyed by workspace display name are no longer rewritten to ID keys (they still load, but new installs always use ID keys), and leftover grouped tmux sessions (`acg-*` / `ac-*__c*`) from the pre-2026-06 terminal architecture are no longer cleaned up at startup. When upgrading from such an old version, kill those stale tmux sessions manually (`tmux kill-session -t <name>`) if any remain.

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
