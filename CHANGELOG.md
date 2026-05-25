# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-25

Initial public release.

### Highlights

- **Seamless across devices.** Persistent tmux sessions reachable from any browser; switch between phone, tablet, and PC without losing context.
- **Mobile-first input.** Custom on-screen keyboard with flick / swipe gestures, snippet chips, and an enter / send mode that adapts to context. Practical enough to commit, push, and run scripts from a phone.
- **Jobs, Git, and terminal in one place.** Run shell jobs, drive git (branches, commits, push / pull, diff, history, stash, merge / rebase), and use a full web terminal without tab-switching.
- **Self-hosted, single-user.** Designed to live behind Tailscale on a homelab box; assumes you trust the device on the other side of the wire.

### Added

#### Web terminal

- xterm.js-based multi-tab terminal with split-pane (horizontal / vertical / grid).
- Tmux-backed persistent sessions; closing the browser does not end the session.
- WebSocket reconnection with backoff; resume after sleep / lid close.
- URL detection in terminal buffer; tap a URL to open externally.
- Image paste / drag-and-drop upload into the active terminal.

#### Mobile keyboard bar

- Minimum / full QWERTY toggle pinned to the bottom of the screen.
- Flick input for symbols, function keys, and arrows.
- Shift / Ctrl / Symbol / Fn modes with mutual-exclusion rules tuned for one-thumb use.
- Snippet chips for one-tap insertion of frequently used commands.
- Long-press repeat and accelerated repeat for arrows and backspace.
- Camera key to upload an image straight from the device camera.

#### Git UI

- Branch list, switch, create, delete.
- Commit history with graph and per-commit file diff.
- Working-tree changes view (numstat + per-file diff).
- Push / pull / fetch with upstream awareness; one-tap set-upstream.
- Stash list and apply / drop.
- Merge / rebase entry points.
- File browser with rename, delete, upload, download.
- GitHub pane: issues, pull requests, actions (requires `gh`).

#### Jobs / scripts

- One-tap shell script execution from a dedicated Jobs pane.
- Job definitions editable from the UI; per-job environment and cwd.
- Output streamed to a dedicated tab.

#### Workspace management

- Multiple workspaces (directories) with quick switching.
- Per-workspace status bar: branch, dirty indicator, ahead / behind, last commit message.
- Workspace open / close from the modal selector.

#### Layout and PWA

- Panel-bottom layout for narrow displays (mobile and narrow PC windows), with title bar and status bar adapted to the available width.
- PWA install support; service worker bypass list for development.
- Split-mode UI with drag-and-drop pane swap.

#### Operations

- `./any-console` CLI on Linux + systemd for setup / start / stop / update / logs.
- Docker Compose recipe for Linux / macOS / Windows.
- `./any-console update` for in-place upgrade on systemd hosts.

### Notes

- Single-user by design. Run behind Tailscale or another trusted network boundary; there is no multi-tenant auth model.
- Tested primarily on Raspberry Pi (Linux + systemd + tmux). macOS / Windows are supported via Docker.

[Unreleased]: https://github.com/kt0319/any-console/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kt0319/any-console/releases/tag/v0.1.0
