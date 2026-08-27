# Getting started from your iPhone

A step-by-step guide to reach your any-console host from an iPhone over
Tailscale, install it as an app, and get push notifications — for people who
already have a host running any-console (see the main
[README](../README.md#setup) if you haven't set one up yet).

## What you'll end up with

- `https://<your-host>.ts.net/` open in Safari, reachable only from your
  tailnet (never the public internet)
- any-console installed on your Home Screen like a native app
- Push notifications when a session needs your input

## Prerequisites

- A host already running any-console (Mac mini, Linux box, etc.) and
  registered on your [Tailscale](https://tailscale.com) tailnet
- The [Tailscale app](https://apps.apple.com/app/tailscale/id1470499037)
  installed on your iPhone and signed into the **same tailnet** as the host
- [Tailscale Serve](https://tailscale.com/kb/1312/serve) enabled on the
  host, so it's reachable over HTTPS:

  ```bash
  tailscale serve --bg http://127.0.0.1:8888
  ```

  (See [README &gt; HTTPS](../README.md#https) if the host uses a different
  port.) HTTPS is required for both PWA install and push notifications —
  skip this and the next steps won't work.

## 1. Sign in on the iPhone

Open `https://<your-host>.ts.net/` in Safari. How you sign in depends on
whether this is your first device or you already have one signed in
elsewhere:

**First device ever** — type the token. It was printed once in the output
of `./any-console setup` on the host; see
[README &gt; Authentication](../README.md#authentication).

**Already have a signed-in laptop/PC** — skip typing the token entirely:

1. On the already-signed-in device, open **Settings → Auth** and tap **Add
   new device** (an **Open on your phone** shortcut is also available in
   the empty-state Setup checklist).
2. Scan the QR code with the iPhone's Camera app and open the link it
   detects.
3. The iPhone signs in automatically — no token entry needed.

The QR link expires in 90 seconds and works once; if it expires, just
generate a new one. See [README &gt; Adding a new device with a QR
code](../README.md#adding-a-new-device-with-a-qr-code) for details.

## 2. Install as an app

Installing as a Progressive Web App gets you a Home Screen icon, a
full-screen window (no Safari chrome), and is required for push
notifications.

From inside the app, the empty-state screen (what you see before opening
any session) has a **Setup** checklist — tap **Install as app** there and
it walks you through Safari's Share → **Add to Home Screen** flow. You can
also do it manually:

1. Tap the **Share** icon in Safari's toolbar
2. Tap **Add to Home Screen**
3. Confirm — the icon appears on your Home Screen

Launch it from there from now on, not from a Safari tab.

## 3. Enable notifications (optional but recommended)

Once installed as an app (step 2 is required first — push notifications
don't work from a regular Safari tab on iOS), the Setup checklist shows
**Enable notifications**. Tap it and accept the system permission prompt.

You'll now get a push notification when an agent session is waiting for
your input (a permission prompt, a blocked command), when a dispatch
request needs approval, or when a job's configured "Notify phrase" appears
in its output — useful for checking in from your phone without keeping the
app open.

## Using it day to day

- **Sessions persist.** Closing the app or losing signal doesn't end your
  tmux session — reopen and you're back where you left off, on any device.
- **The flick keyboard is built for this.** The custom on-screen keyboard
  (KeyboardBar) supports flick input and common shell shortcuts (Ctrl+C,
  Tab, arrows) without needing an external keyboard.
- **Switching devices is seamless.** Start something on your Mac, check
  progress on your iPhone during a commute, finish it back at your desk —
  same session throughout.

## Troubleshooting

- **"Install as app" / notifications don't show up** — confirm you're on
  `https://` (not `http://`) and that `tailscale serve` is running on the
  host (`tailscale serve status`).
- **"Enable notifications" is missing from the checklist** — it is hidden
  when the notification permission was previously denied. Allow
  notifications for the installed app from iOS **Settings →
  Notifications**, or remove the Home Screen app and add it again, then
  relaunch.
- **QR code says expired or already used** — go back to Settings → Auth
  and generate a new one.
- **Host unreachable** — check that both devices are connected to
  Tailscale and on the same tailnet (`tailscale status` on the host).
