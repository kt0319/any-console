# Architecture

## Design decisions

- **Single-process enforced** — `_acquire_singleton_lock` rejects `uvicorn --workers > 1`. Terminal sessions, rate limiter, and TTL caches are held in process memory.
- **Git via subprocess only** — no Git libraries.
- **tmux** as the session persistence layer. Sessions survive browser closes.
- **Single shared token** — no per-user distinction. Auto-generated on first run, stored in `data/auth.json`.

For the rationale behind each decision, see [DECISIONS.md](DECISIONS.md).

## Module layout

```
api/                          Backend (FastAPI)
  main.py                     App init, static file serving, /auth/check, image upload
  auth.py                     Bearer token auth (optional), trusted-proxy detection
  runner.py                   Job execution (subprocess, default timeout 300s)
  terminal_session.py / tmux.py  tmux × pty.fork × WebSocket bridge
  git_utils.py / git_lock.py  Git subprocess invocation, workspace lock
  config.py / config_schema.py  config.json read/write, Pydantic validation, schema versioning + auto-migration
  rate_limiter.py             In-process rate limiter
  routers/                    workspaces, jobs, terminal, system, settings, git, github
ui/                           Frontend (Vue 3 + Pinia, built with Vite)
  components/                 Vue components
  stores/                     Pinia stores
  composables/                Reusable logic (useApi, useTerminal, useModal, etc.)
  utils/                      Pure functions, constants, endpoints
  styles/                     Global CSS
docker/                       Dockerfile, compose.yml
docs/                         ARCHITECTURE.md, DECISIONS.md, A11Y_AUDIT.md
config.json                   Config file (auto-generated, .gitignore'd)
data/auth.json                Token storage (.gitignore'd)
```

## Notes for contributors

| Target | Watch out for |
|--------|---------------|
| `stores/*.js` | Referenced by many components. Renaming exports has wide impact. |
| `composables/useApi.js` | Shared API layer. Response format changes affect all callers. |
| `utils/constants.js` | Grep all references before changing a value. |
| `app-bridge.js` | Event bus. Renaming events requires updating both `emit` and `on` sides. |
