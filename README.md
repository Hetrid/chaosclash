# LEGEND ARENA

An original 5v5 three-lane mobile MOBA (browser, iPad/phone-first). Fully original heroes, map
("The Sundered Vale"), items, monsters and audio — no assets or names from any existing MOBA.

- **20 legends**, each with intrinsic passive + 2 skills + ultimate, roles (EXP / JUNGLE / MID / GOLD / ROAM)
- **Win condition:** destroy the enemy Core (or team surrender vote). No match timer, ever.
- **Full sim:** minion waves with last-hit gold, jungle camps with leash/reset, Ember Crest & Azure Mind
  buffs, Ancient Shell & War Colossus team objectives, tiered turrets with anti-backdoor protection,
  fog of war with bushes, recall channel, item shop with component build paths, scaling respawns,
  death recap, surrender votes, generated SFX + TTS announcer.
- **Bot AI** with 3 difficulty tiers, role behaviors, teamfight/objective decisions.
- **Deterministic sim** (fixed 30 Hz timestep) — headless bot-vs-bot matches via `npm run sim`.

---

## 1. Play it right now (local)

```bash
cd legendarena
npm install                # ws runtime dep + playwright devDep
npx playwright install chromium   # only needed for the e2e tests
python3 -m http.server 8077       # or: npx serve , or any static file server
# open http://localhost:8077
```

Then: **PLAY → pick role → pick hero → LOCK IN.** Left joystick moves; right side is
Basic / S1 / S2 / ULT / Spell / Recall. Desktop testing keys: WASD, Q/E/R, Space, F, B, P, Tab.

> Opening `index.html` directly from disk (file://) mostly works too, but use a local
> server for correct module loading — some browsers block module imports on file://.

## 2. Install on GitHub Pages (free hosting, vs-bots play)

The whole client is static — GitHub Pages hosts it perfectly. Multiplayer (the Node
server) can't run on Pages; see §3 for that.

### Step-by-step

1. **Create the repo**
   - Go to <https://github.com/new> → name it e.g. `legend-arena` → Create.
   - Keep it **Public** (private repos can't use Pages on the free plan).
   - Do **not** initialize with a README.

2. **Upload the files — `index.html` must end up at the REPO ROOT**
   - Unzip `legend-arena.zip` (its contents are at the zip root: `index.html`, `src/`, `server/`, …).
   - On github.com → *Add file → Upload files* → drag **everything you extracted**
     (all files and folders together — NOT a single parent folder) → Commit.
   - Verify: the repo home page must show `index.html` directly in the file list.
     If you see a single folder `legendarena/` (or `legend-arena/`) listed instead,
     the files are nested one level too deep — that is the #1 cause of 404s.
     Fix: open that folder, select all inside it, and move the files up to the repo root
     (GitHub web UI: delete the nested upload, re-upload the inner contents).

   Or via git:
   ```bash
   git init
   git add .
   git commit -m "Legend Arena: playable vs-bots build"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/legend-arena.git
   git push -u origin main
   ```

3. **Enable Pages — pick ONE of these two methods**
   - **Method A (workflow, recommended — auto-deploys on every push):**
     Repo → *Settings → Pages* → **Source: GitHub Actions**. That's it — the included
     workflow (`.github/workflows/deploy-pages.yml`) deploys automatically. Watch the
     *Actions* tab; when green, the site is live.
   - **Method B (branch):**
     Repo → *Settings → Pages* → **Source: *Deploy from a branch*** → Branch: `main`,
     folder `/ (root)` → Save. (A `.nojekyll` file is included, so Jekyll processing is skipped.)

4. **Wait ~1–2 minutes**, then open:
   `https://<YOUR-USERNAME>.github.io/legend-arena/`
   (The exact URL is shown at the top of Settings → Pages after a successful deploy.)

### If it 404s — checklist, in order of likelihood

1. **Nested upload**: repo home shows a folder instead of `index.html` at root → fix per step 2.
2. **Pages Source not configured / wrong folder**: Settings → Pages must say
   `main / (root)` (Method B) or `GitHub Actions` (Method A) — not `/docs`, not `None`.
3. **Private repo on a free plan**: Pages doesn't serve it. Make the repo public.
4. **Deploy still running or failed**: check Settings → Pages ("Your site is live at…")
   and the *Actions* tab for a red X on the deploy workflow.
5. **Email not verified on your GitHub account** — verify via the email GitHub sent you;
   Pages refuses to build until then.
6. **Wrong URL**: it is case-sensitive and includes the repo name:
   `https://<user>.github.io/<repo>/`. `https://<user>.github.io/` alone is 404 unless
   the repo is literally named `<user>.github.io`.
7. **Browser cache**: hard refresh (Ctrl+Shift+R / long-hold reload on mobile).

### What works on Pages vs what needs a server

| Feature | GitHub Pages |
| --- | --- |
| Full vs-bots matches (the whole game today) | ✅ works |
| Firebase anonymous login + presence | ✅ works (project `legendarena`) |
| **PvP via MULTIPLAYER → PLAY ONLINE (Firebase relay)** | ✅ works (needs rules published, §4) |
| PvP against your own ws server | ❌ needs the Node server / wss (§3 Option B) |

## 3. Multiplayer (PvP) — how to play

Two ways to play online. **PLAY ONLINE works from anywhere — including iPad on the
GitHub Pages site — with no server of your own.**

### Option A · PLAY ONLINE via Firebase (works on iPad / any https page)

Firebase **is the server**: matchmaking, presence, and the match relay all run through
your `legendarena` Realtime Database. No Node process, no ports, no hosting. It works
from `https://…github.io` in Safari on iPad because there is no `ws://` connection —
only normal https calls to Firebase.

One-time setup (only step 1, the database rules — see §4 for the exact steps):

1. **Realtime Database → Rules** in the Firebase console → paste
   `database.rules.json` → **Publish**. Anonymous sign-in happens automatically on
   first visit.

To play:

1. Each player opens the game (localhost, LAN IP, or the GitHub Pages URL — any).
2. **MULTIPLAYER → PLAY ONLINE** → pick role & hero → **LOCK IN**.
3. "Searching for an opponent…" shows the live queue count. When another player queues,
   the match starts automatically: one player hosts the simulation, the other joins as
   a guest over a 10 Hz relay (inputs up, snapshots down; the client interpolates, so
   it feels smooth).
4. Win by destroying the enemy core as always; results are written to Firebase and
   shown to both players. Solo queuers are filled with bots to 5v5 on the host side.

### Option B · Custom game server (ws:// / wss://)

For LAN parties or your own hosted server, the repo ships an authoritative Node server.

1. On the server machine:
   ```bash
   npm install
   npm start            # → http://0.0.0.0:8787 (game + ws server in one)
   ```
2. Players open the game **served by that host**: `http://<host-ip>:8787`
   (find the IP with `ipconfig` / `ifconfig`; allow port 8787 through the firewall).
3. **MULTIPLAYER → CONNECT** (the address field auto-fills with the server you're on)
   → pick role & hero → LOCK IN.
4. The server is authoritative: 30 Hz sim; clients send 10 Hz input batches and render
   10 Hz interpolated snapshots. Solo players get bot fill.

Playing from an https page (e.g. GitHub Pages) against a **custom** server needs
`wss://` — browsers block plain `ws://` from https pages. Put the server behind TLS
(Fly.io / Render / Railway hand you a wss URL) and connect to
`wss://your-server.example/ws`. For LAN play just open the host's own `http://` page —
no TLS needed. **On iPad, prefer Option A.**

### Notes

- Vs-bots never touches the network: **PLAY** always runs the local simulation.
- Firebase relay writes are capped at 10 Hz input batches + 10 Hz snapshots during a
  match (never 60 Hz); presence pings every 45 s.

## 4. Firebase (project `legendarena`) — console + CLI

Used for: anonymous auth, presence, matchmaking queue, the match relay, and results —
**rate-limited to 10 Hz during matches, never 60 Hz position writes**. The exact SDK
(12.19.0, gstatic CDN) and config live in `src/client/firebaseConfig.js`.

### Firebase Console (one-time)

1. Go to <https://console.firebase.google.com> → open project **legendarena**.
2. **Authentication → Sign-in method → enable *Anonymous***.
3. **Realtime Database** → confirm the instance `legendarena-default-rtdb` exists
   (URL `https://legendarena-default-rtdb.firebaseio.com`). Create it in the region
   you want if it doesn't exist yet.
4. **App Check** — later, only after rules are proven:
   - Register the web app with **reCAPTCHA Enterprise** for production.
   - For development use a **debug token** (App Check → Apps → Manage debug tokens).
   - Do **not** enable enforcement until the rules below are deployed and verified.

### Publishing the rules (required for PLAY ONLINE)

`database.rules.json` in the repo root holds the exact rules: auth-only access, each
signed-in user writes only their own `presence/{uid}` and `queue/{uid}`, match relay
paths (`matches/{id}/…`) are writable until the match is marked done, and `results/`
is create-only.

**Console paste (fastest):**
1. **Realtime Database → Rules** tab.
2. Replace everything with the contents of `database.rules.json`.
3. Click **Publish**. PLAY ONLINE now works from any client.

**CLI:**
```bash
firebase deploy --project legendarena --only database
```

Without published rules the database is unreachable (deny-all) and the multiplayer
modal reports online play as unavailable.

### CLI (hosting / emulators, optional)

```bash
npm install -g firebase-tools
firebase login
firebase projects:list                 # verify you can see legendarena
firebase use --add legendarena         # alias it (e.g. "default")

firebase emulators:start               # local dev against emulated RTDB/Hosting
firebase deploy --only database        # push the security rules (same as console paste)
firebase deploy --only hosting         # (optional) also host the client on Firebase
```

## 5. Development & tests

```bash
npm test                # 32 node:test suites: combat, lane economy, jungle, structures, recall, surrender, shop, spells
npm run sim             # deterministic bot-vs-bot match (headless) — add --seed N --diff 1|2|3 --minutes M
node tools/mapcheck.js  # map connectivity gate ("MAP OK")
node tools/balance.js   # dumps docs/balance.json (all hero/item/monster/config tunables)
node tests/playwright/e2e.mjs       # UI smoke: menu→hero select→match, zero console errors
node tests/playwright/soak.mjs      # gameplay soak: drive, farm, kill, no errors
node tests/playwright/results.mjs   # core-destroyed → results screen → play again
node tests/playwright/systems.mjs   # recall/surrender/shop/dev-panel e2e
```

- Dev panel: open `index.html?dev=1` — **local/dev builds only** (gold, level, heal, CDs,
  hitboxes, teleport). Production authorization is account/server-based; there are no
  name/password cheats.

## 6. Project layout

```
src/shared/     authoritative simulation (sim, entities, systems, heroes, AI, map, config)
src/client/     renderer, controls, HUD, screens, sfx/TTS, net seam (this is what Pages hosts)
server/         Node authoritative match server (P4/P5)
tests/          node:test suites + Playwright e2e
tools/          botsim, mapcheck, balance dump
docs/           AUDIT.md (legacy migration plan), KNOWN_ISSUES.md, balance.json
firebase.json, .firebaserc, database.rules.json
```

## 7. Known issues

See `docs/KNOWN_ISSUES.md` — kept honest: e.g. difficulty-1 bots can stall even games,
client PvP transport not yet wired. Nothing here is claimed "flawless".
