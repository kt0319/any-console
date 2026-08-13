# Architecture

## Design decisions

- **Single-process enforced** — `acquire_singleton_lock` rejects a second instance binding the same port. Terminal sessions, rate limiter, and TTL caches are held in process memory.
- **Git via subprocess only** — no Git libraries.
- **tmux** as the session persistence layer. Sessions survive browser closes.
- **Single shared token** — no per-user distinction. Auto-generated on first run, stored in `data/auth.json`.

For the rationale behind each decision, see [DECISIONS.md](DECISIONS.md).

## Module layout

```
server/                       Backend (Rust, axum)
  src/main.rs                 App init (CLI dispatch → singleton lock → bind), TLS termination (rustls)
  src/cli.rs                  Lightweight CLI subcommands (config / workspaces / jobs / auth / tailscale /
                               paths) used by the ./any-console launcher instead of spawning a server
  src/static_files.rs          ui/dist serving; the embed-assets build feature bakes dist/ and
                               agent_manifests/ into the release binary
  src/auth.rs                 Bearer token auth (optional), trusted-proxy detection, API tokens
  src/devices.rs               Device cookie auth (registration, listing, revocation, auto-enroll)
  src/terminal_session.rs / tmux.rs / pty.rs  tmux × PTY fork/exec × WebSocket bridge
  src/git_utils.rs / git_lock.rs  Git subprocess invocation, workspace lock
  src/git_watch.rs             Filesystem watching (notify) × WebSocket push for realtime git status
  src/screen_manifest.rs       Agent state detection from pane content (herdr manifests: bundled + remote + local override)
  src/manifest_update.rs       Periodic remote manifest updates from herdr.dev (validated, cached under data/)
  src/agent_hooks.rs           Event-driven session state from agent hooks (authoritative over manifests)
  src/foreground.rs            Foreground process group argv inspection (/proc on Linux, ps on macOS)
  src/job_match.rs             Match foreground argv against job definitions (auto-tag manual runs)
  src/config.rs / config_schema.rs  config.json read/write, schema validation
  src/config_migrations.rs     config.json schema versioning + auto-migration
  src/rate_limit.rs            In-process rate limiter
  src/preview.rs               Dev server port detection + TCP/TLS proxy
  src/push.rs                  VAPID / Web Push (RFC 8291/8292), native
  src/{workspaces,jobs,terminal,system,settings,git_*,github,dispatch,job_runner,pairing,upload_image}.rs
                               Route handlers (pairing = QR code device pairing; short-lived,
                               single-use tokens — see DECISIONS.md #28)
agent_manifests/               Vendored agent-detection manifests (TOML), read by screen_manifest.rs at runtime
                               (embedded into release binaries via the embed-assets feature)
ui/                            Frontend (Vue 3 + Pinia, built with Vite)
  components/                  Vue components
  stores/                      Pinia stores
  composables/                 Reusable logic (useApi, useTerminal, useModal, etc.)
  utils/                       Pure functions, constants, endpoints
  styles/                      Global CSS
docs/                          ARCHITECTURE.md, DECISIONS.md, A11Y_AUDIT.md, RUST_MIGRATION.md
config.json                    Config file (auto-generated, .gitignore'd)
data/auth.json                 Token storage (.gitignore'd)
```

`data/` and `config.json` live at the project root by default. Setting the
`ANY_CONSOLE_DATA_DIR` environment variable relocates both under the given
directory — the E2E disposable-server mode (see `playwright.config.js`) uses
this to keep test state fully isolated from a real deployment.

## Notes for contributors

| Target | Watch out for |
|--------|---------------|
| `stores/*.ts` | Referenced by many components. Renaming exports has wide impact. |
| `composables/useApi.ts` | Shared API layer. Response format changes affect all callers. |
| `utils/constants.ts` | Grep all references before changing a value. |
| `app-bridge.ts` | Event bus. Renaming events requires updating both `emit` and `on` sides. |
| `composables/useListDragSort.ts` | Shared drag-sort for vertical lists (Tabs, Snippets, workspace Groups). Uses pointer events + hit-detection. New sortable lists should use this instead of a custom implementation. |
| `styles/drag-utils.css` | Global CSS for `.drag-handle`, `.drag-source`, `.drag-over-above/below`. All drag-enabled rows must use these classes. |
