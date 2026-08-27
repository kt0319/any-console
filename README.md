# any-console

[![Release](https://img.shields.io/github/v/release/kt0319/any-console)](https://github.com/kt0319/any-console/releases/latest)
[![Last commit](https://img.shields.io/github/last-commit/kt0319/any-console)](https://github.com/kt0319/any-console/commits/main)
[![CI](https://github.com/kt0319/any-console/actions/workflows/ci.yml/badge.svg)](https://github.com/kt0319/any-console/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/kt0319/any-console/branch/main/graph/badge.svg)](https://codecov.io/gh/kt0319/any-console)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-000000.svg?logo=rust)](https://www.rust-lang.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-4fc08d.svg)](https://vuejs.org/)

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
- **Workspaces** — Register repos, group them, and drive files / Git / jobs per workspace
- **Git UI** — Branch switching, commit, push/pull, diff, history, stash, merge/rebase, worktrees
- **File browser** — Browse, view, upload, and download workspace files
- **Job runner** — One-tap shell script execution; define and edit jobs from the UI
- **Agent state detection** — Sessions running known coding agents show working / idle / blocked state (screen analysis + optional hooks)
- **Push notifications** — Web Push (VAPID) for blocked agents, job phrases, and dispatch approvals
- **GitHub integration** — Issues, PRs, and Actions runs per workspace (via `gh`)
- **Dispatch API** — Queue commands from CI/automation over HTTP, approved from the UI
- **Dev server preview** — Detects listening dev servers and proxies them (TLS-capable)
- **PWA** — Installable on phone and desktop
- **Lightweight stack** — Vue 3 + Pinia frontend (Vite), Rust (axum) backend

## Platform support

**Client side: any OS, any device with a modern browser.** This is the whole point of any-console — open `https://<your-host>/` from your phone, laptop, or any browser and you get the full UI.

**Host (server) side: Linux or macOS.** The runtime is POSIX-portable. Service management is platform-native — `systemd` on Linux, `launchd` on macOS (ideal for an always-on Mac mini) — and `tmux` provides persistent sessions on both. The `./any-console` helper detects the OS and drives the right service manager.

> **macOS note:** an always-on Mac mini / Mac Studio is the sweet spot. The `launchd` service is registered as a user `LaunchAgent`, so it starts at login — enable automatic login (System Settings → Users & Groups) if the Mac runs headless. A MacBook that sleeps or travels is a poor fit for the "check from your phone while away" use case.

## Setup

Downloads a prebuilt release from [GitHub Releases](https://github.com/kt0319/any-console/releases) into `~/.any-console` and runs a non-interactive setup. No Rust/Node toolchain needed — only `git` and `tmux` at runtime:

```bash
curl -fsSL https://raw.githubusercontent.com/kt0319/any-console/main/install.sh | bash
```

Then finish service registration interactively — this registers a systemd (Linux, requires `sudo`) or launchd (macOS) service; the `./any-console` helper detects the OS. Your SSH keys, git/gh config, and shell environment all carry over; tmux sessions persist across reboots:

```bash
cd ~/.any-console && ./any-console setup
```

After this, manage the service with `./any-console start|stop|update|logs|...` (see [Commands](#commands)). To update later, see [Updating](#updating).

### Requirements

- `git` — used by the Git UI
- `tmux` — required for terminal session management
- `curl` / `tar` — used by `install.sh` and `./any-console update` (`install.sh` also needs `sha256sum` or `shasum` for checksum verification)
- `gh` (GitHub CLI, optional) — for fetching GitHub repos, issues, PRs, and Actions

Running from a source checkout (git clone) instead of a binary release additionally requires the build toolchain: Rust (`cargo`) and Node.js (`node` / `npm`).

## Authentication

> **Read [SECURITY.md](SECURITY.md) before deploying.** any-console gives the browser full shell access to the host — the token must be treated like an SSH key, and the app must never be exposed to the public internet.

- During setup (`install.sh` / `./any-console setup`), if `data/auth.json` does not exist, a random 32-character token is generated, saved, and printed once in the setup output. Open the app URL on your device and sign in with it — the device gets a revocable cookie, so you only enter the token once per device.
- An existing `data/auth.json` is never overwritten.
- The token can be changed from Settings > Auth in the UI.

### Adding a new device with a QR code

Once one device is signed in, you can add another (e.g. add your iPhone from your already-authenticated laptop) without typing the token:

1. On the signed-in device, open Settings > Auth and tap "Add new device" (an "Open on your phone" shortcut is also available in the empty-state Setup checklist).
2. Scan the QR code with the new device's camera app.
3. The new device opens the link, signs in automatically, and lands on the normal app screen.

The QR code encodes a one-time link that expires in 90 seconds and can only be used once — if it expires or was already used, the new device falls back to the normal token entry screen. See [docs/DECISIONS.md](docs/DECISIONS.md) (ADR 28) for the security rationale.

Setting up an iPhone specifically (Tailscale, PWA install, push notifications)? See [docs/IPHONE_QUICKSTART.md](docs/IPHONE_QUICKSTART.md).

### Disabling authentication for local development

Authentication can be disabled with `ANY_CONSOLE_DISABLE_AUTH=1` in the server process environment, or from the UI by turning off "Require token authentication" in Settings > Auth. Both are intended for disposable local development and tests — for normal deployments, keep token + device-cookie authentication enabled.

## Agent hooks (optional)

Terminal sessions running known coding agents (Claude Code, Codex, ...) get automatic
working / idle / blocked state detection out of the box via screen analysis.
For Claude Code you can optionally enable hook-based reporting, which is more
accurate and instant (no polling delay, no dependency on screen rendering).

```bash
./any-console hooks-setup
```

Requires the Claude Code CLI (`claude`) to be installed and on `PATH`.

This registers `scripts/claude-code-hook.sh` in `~/.claude/settings.json`. It
merges into your existing hooks config without touching other hooks, re-running
it is a no-op, and a `.bak` copy of the previous `settings.json` is kept. The
script only acts inside sessions created by any-console and never interferes
with Claude Code itself; if hook reports stop, detection falls back to screen
analysis automatically.

The script ships in both source checkouts and prebuilt release archives
(`scripts/`). If your binary install predates `scripts/` bundling, re-run
the installer once a newer release is available.

## Dispatch API

`POST /dispatch` lets external tools (CI, automation, scripts) launch or send text to a workspace session over HTTP, without opening the UI.

If any-console is only reachable via its `.ts.net` address (the default with Tailscale Serve, see [HTTPS](#https) below), the caller must be on the same tailnet — a hosted CI runner isn't by default. For GitHub Actions, add a step with [`tailscale/github-action`](https://github.com/tailscale/github-action) (OAuth client credentials in Secrets, scoped via a Tailscale ACL tag) before the `curl` step. See `.github/workflows/dispatch-on-ci-failure.yml` for a working example.

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

The request always waits in an approval queue — open it from the workspace detail's Dispatch tab, or via a push notification if enabled. Only after a human approves does the text actually get sent (immediate execution is not supported; `"direct": true` is rejected with 400).

Key fields on the request body (`server/src/dispatch.rs`):

| Field | Description |
|---|---|
| `workspace` | Workspace ID or display name to target |
| `job` | Job key to launch (default: `terminal`) |
| `text` | Text to send to the session (e.g. a shell command) |
| `branch` | Checkout this branch before running (rejected with 400 if the workspace has uncommitted changes and the branch differs from the current one) |
| `dedup_key` | Opaque string; a new request with the same key replaces the still-pending one instead of queuing a duplicate (useful for repeated CI-failure dispatches) |

For CI/automation, use a **scoped dispatch token** instead of your main token — create one from Settings > Auth > API Tokens. It can only queue dispatch requests and cannot approve queue items or access anything else, so a leaked CI secret can't be used to run arbitrary commands on its own.

## HTTPS

PWA installation and service workers require HTTPS.

**Tailscale Serve** is the easiest option — it handles certificates automatically:

```bash
tailscale serve --bg http://127.0.0.1:8888
```

Access the app at `https://<your-device>.ts.net/`.

The any-console server itself listens over HTTP. If you need another HTTPS setup, put a reverse proxy such as Caddy or nginx in front of `http://127.0.0.1:8888`.

The default bind address is `0.0.0.0` (all interfaces). When the app is reached exclusively through Tailscale Serve — which proxies to `127.0.0.1` — you can set `__global__.host` to `"127.0.0.1"` in `config.json` so the plain-HTTP port is not also reachable over the LAN.

Direct-port dev server previews can still use HTTPS. `./any-console https-setup` issues a Tailscale certificate and stores it for the preview proxy. The proxy listens on `target port + 20000` (for target ports 1024–9999), so a dev server on port 3000 becomes `https://<device>:23000/` — this works even when the main app is served through Tailscale Serve:

```bash
./any-console https-setup
```

Tailscale certificates expire after ~90 days — re-run the command to renew.

The default port is 8888. To change it, set `__global__.port` in `config.json`.

## Commands

For the systemd (Linux) and launchd (macOS) setups, all operations go through the `./any-console` command, which detects the OS and drives the right service manager.

```
./any-console setup        First-time setup (register service)
./any-console update       Update to the latest release (checksum-verified download)
./any-console start        Start the service          (systemctl / launchctl)
./any-console stop         Stop the service           (systemctl / launchctl)
./any-console restart      Restart the service        (systemctl / launchctl)
./any-console status       Show status (service state, URL, version)
./any-console logs         Show service logs          (journalctl / log file)
./any-console run          Run in foreground (no service; any OS)
./any-console hooks-setup  Register Claude Code hooks for accurate agent state detection
./any-console https-setup  Issue / renew a Tailscale cert for direct-port dev previews
./any-console uninstall    Remove the service registration, optionally clean up files
./any-console version      Show version
```

`run` skips the service manager entirely and starts the server binary directly in the foreground. Useful for WSL or for quick test runs without registering a service.

### Updating

```bash
./any-console update
```

For a binary install, this delegates to `install.sh`: checksum-verified download, atomic binary replacement, and a service restart when one is registered — the same as re-running the `curl | bash` command, and idempotent (`data/`, including `certs/`, and `config.json` are left untouched). For a source checkout, `update` instead fetches the latest release tag and rebuilds (`cargo build --release` + `npm install` + `npm run build`); it refuses to run while the tree has uncommitted changes. Source checkouts can also check for and apply updates from the UI (Settings > System Info).

Upgrade compatibility note: legacy-migration code for versions prior to 2026-06 has been removed. When upgrading from such an old version, kill leftover grouped tmux sessions (`acg-*` / `ac-*__c*`) manually if any remain (see `docs/DECISIONS.md`, ADR 16).

## Repository layout

```
server/            Backend (Rust, axum)
ui/                Frontend (Vue 3 + Pinia, built with Vite)
dist/              Frontend build output, served by the backend (generated by npm run build)
agent_manifests/   Vendored agent-detection manifests (read by the backend at runtime)
tests/             Frontend unit tests (tests/ui), Playwright E2E (tests/e2e), stress tests
scripts/           Helper scripts shipped with releases (e.g. claude-code-hook.sh)
docs/              Architecture & design docs
any-console        Launcher / service-management CLI (install.sh installs alongside it)
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
