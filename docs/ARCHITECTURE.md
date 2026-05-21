# Architecture

## Design decisions

- **Single-process enforced** — `_acquire_singleton_lock` rejects `uvicorn --workers > 1`. Terminal sessions, rate limiter, and TTL caches are held in process memory.
- **Git via subprocess only** — no Git libraries.
- **tmux** as the session persistence layer. Sessions survive browser closes.
- **Single shared token** — no per-user distinction. Auto-generated on first run, stored in `data/auth.json`.

For the rationale behind each decision, see [DECISIONS.md](DECISIONS.md).

## Notes for contributors

| Target | Watch out for |
|--------|---------------|
| `stores/*.js` | Referenced by many components. Renaming exports has wide impact. |
| `composables/useApi.js` | Shared API layer. Response format changes affect all callers. |
| `utils/constants.js` | Grep all references before changing a value. |
| `app-bridge.js` | Event bus. Renaming events requires updating both `emit` and `on` sides. |
