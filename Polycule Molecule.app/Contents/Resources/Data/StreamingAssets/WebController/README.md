# Web controller

Phones open the host URL (HTTP + WebSocket `/ws`). Unity polls `GET /unity/inputs` and posts `POST /unity/state`.

**Default (no Node):** In Play mode, `EmbeddedWebControllerServer` (C#) listens on **3847** and serves `public/`. No `npm install` required for LAN play.

**Optional Node** (same API as before, includes embedded `@ngrok/ngrok` if you use `NGROK_AUTHTOKEN`):

```bash
cd WebController
npm install
npm start
```

`WebControllerServerLauncher` uses the embedded server first; if it cannot bind or fails `/health`, it starts `server.js` when present.

**Phones off LAN (Internet)** — Unity still uses `localhost:3847` for game traffic; the QR code needs a public HTTPS base URL.

- **In-process server + ngrok:** put `NGROK_AUTHTOKEN=…` in `ngrok.local.env`. Unity tries to run the **ngrok** binary (Homebrew paths, PATH, then `/bin/bash -lc "command -v ngrok"` on macOS). If you still see “Cannot find the specified file”, set **`NGROK_EXE=/full/path/to/ngrok`** (from `which ngrok` in Terminal). Or run **`ngrok http 3847`** yourself; the game polls `127.0.0.1:4040` first.
- **Node + npm:** `NGROK_AUTHTOKEN` + `npm start` still uses `@ngrok/ngrok` inside Node if you prefer that path.
- **Unity starts Node for you:** the spawned process does **not** inherit a token you only exported in Terminal (unless you launched the Unity Editor from that same shell). Use **`ngrok.local.env`**: copy `ngrok.local.env.example` → `ngrok.local.env`, put your token on the `NGROK_AUTHTOKEN=` line (file is gitignored). Or stop any old `node` on 3847 and run `NGROK_AUTHTOKEN=... npm start` yourself before Play.
- **Fixed URL:** set `PUBLIC_CONTROLLER_URL=https://…/` when starting Node (Cloudflare, Tailscale, reverse proxy, etc.).
- **ngrok CLI:** run `ngrok http 3847`; Unity can fall back to `http://127.0.0.1:4040/api/tunnels` if enabled on `GameManager`.
- **Manual:** paste the base URL into **GameManager → Public Controller Url Override**.

### ngrok hostname (not random) and the browser warning page

**Stable / custom subdomain**  
Free tunnels often get a random name like `tracing-scoff-grumbly.ngrok-free.dev`. To use a **fixed** name you control:

1. In [ngrok dashboard → Domains](https://dashboard.ngrok.com/domains), create or claim a domain (free tier may include a static `*.ngrok-free.dev` slot; paid plans add more options).
2. Put it in `ngrok.local.env` as **`NGROK_DOMAIN=myname.ngrok-free.dev`** (hostname only, no `https://`).  
   When Unity starts the ngrok CLI, it runs `ngrok http 3847 --domain=…` so the URL stays the same across runs (if your plan allows that domain).

**“You are about to visit…” interstitial**  
ngrok shows this on the **free** tier for normal browser page loads. Ways to reduce or remove it:

- **This project:** all **`fetch`** calls from the phone UI send **`ngrok-skip-browser-warning: true`**, which ngrok documents as a way to skip the warning on those requests.
- **Limitation:** the **first** time someone opens the link, the **top-level** navigation (loading the HTML page) may still show the warning once; browsers cannot add that header on the initial address-bar load or on **WebSocket** handshakes. After tapping **Visit Site**, the session usually continues normally; **`fetch`** fallbacks avoid the warning on those requests.
- **Remove it completely:** use a **paid** ngrok plan, or tunnel through another provider without that page.
