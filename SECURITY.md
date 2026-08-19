# Security Policy

## What any-console is, security-wise

any-console gives a browser **full shell access to the host it runs on**.
Terminals, job execution, Git operations, and file read/write all run as the
OS user that owns the service. Treat access to any-console exactly like SSH
access to that machine: **anyone who holds the auth token (or a signed-in
device) can run arbitrary commands on your host.** There is no sandbox
between the web UI and your shell — that is the product working as designed,
which is why the deployment guidance below matters.

## Intended deployment

any-console is designed to be reachable **only from a private network you
trust** — a Tailscale tailnet, a LAN behind a firewall, or localhost.

- **Never expose it directly to the public internet** — no router port
  forwarding, no Tailscale Funnel, no cloudflared / ngrok tunnels, no public
  reverse proxy. The single-token auth model is not designed to withstand
  internet-wide credential stuffing or token brute force.
- The recommended setup is [Tailscale Serve](https://tailscale.com/kb/1312/serve)
  for HTTPS inside your tailnet, or plain HTTP on a trusted LAN.
- The server itself listens over plain HTTP (`0.0.0.0` by default) and does
  not infer trust from where a connection appears to come from — anything
  that can reach the port can attempt authentication. If the app is reached
  exclusively through Tailscale Serve (which proxies to `127.0.0.1`), bind
  the server to loopback (`__global__.host: "127.0.0.1"` in `config.json`)
  so the plain-HTTP port is not also reachable over the LAN.
- Be careful with *any* other tunnel or proxy on the same host (`ssh -L`,
  nginx, cloudflared): they can make external requests appear to come from
  loopback. any-console always requires token / device-cookie authentication
  regardless of transport — there is no header-based auto-auth to worry
  about here.

## Authentication model

The model is intentionally simple (see `docs/DECISIONS.md` #3: single token,
no user separation):

- A random 32-character token is generated on first start and stored in
  `data/auth.json`. It is printed to the startup log once.
- Signing in exchanges the token for a per-device cookie. Devices can be
  reviewed and revoked individually from **Settings → Security**, and the
  token itself can be rotated there.
- A signed-in device can add another device via a QR code (**Settings →
  Security → Add new device**) instead of retyping the token. The QR link
  is short-lived (90s) and single-use; it never widens access beyond the
  existing single-user model — it is device provisioning, not user invites.
  See `docs/DECISIONS.md` #28.
- There are no user accounts or roles. One token means full access.
- Request rate limiting and security headers are enabled by default.
- Authentication cannot be disabled for a managed (`start`/`setup`) service.
  `ANY_CONSOLE_DISABLE_AUTH=1` only works for `./any-console run` in the
  foreground — intended for disposable local development, never for a
  reachable deployment.

## If the token leaks

Assume full compromise of the OS user running any-console. Rotate the token
from **Settings → Security** (or delete `data/auth.json` and restart to
generate a new one), revoke all devices, and audit the host: shell history,
tmux sessions, Git remotes/credentials, and `~/.ssh` reachable by that user.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub private vulnerability reporting](https://github.com/kt0319/any-console/security/advisories/new)
rather than opening a public issue. Reports are handled on a best-effort
basis — this is a single-maintainer project — but authentication bypasses
and remote code execution reachable *without* a valid token are treated as
top priority.
