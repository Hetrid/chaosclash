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
   - Do **not** initialize with a README (you'll push the existing folder).

2. **Push the project** (from this workspace, after downloading it, or from your machine):
   ```bash
   cd legendarena
   git init
   git add .
   git commit -m "Legend Arena: playable vs-bots build"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/legend-arena.git
   git push -u origin main
   ```
   (Or skip git entirely: on github.com → *Add file → Upload files* → drag the project
   folders/files → Commit. Keep the folder structure exactly as in this workspace.)

3. **Enable Pages**
   - Repo → **Settings → Pages** (left sidebar).
   - **Source:** *Deploy from a branch*.
   - **Branch:** `main`, folder `/ (root)` → **Save**.

4. **Wait ~1–2 minutes**, then your game is live at:
   `https://<YOUR-USERNAME>.github.io/legend-arena/`
   If it 404s, check Settings → Pages for the build status; hard-refresh (Ctrl+Shift+R).

5. **Subpath note (already handled):** the client uses relative paths (`./src/...`), so it
   works from `/legend-arena/` subpaths without config.

### What works on Pages vs what needs a server

| Feature | GitHub Pages |
| --- | --- |
| Full vs-bots matches (the whole game today) | ✅ works |
| Firebase anonymous login + presence | ✅ works (project `legendarena`) |
| Real-time PvP multiplayer | ❌ needs the Node server (§3) |

## 3. Real-time multiplayer server (not on Pages)

The authoritative match server is in `server/` (ws + shared sim). Host it on any Node
provider (Fly.io, Render, Railway, a VPS…):

```bash
npm install
npm start                 # serves the client AND the ws endpoint
```

The client's `RemoteDriver` seam (`src/client/net.js`) is where PvP connects — the HUD,
renderer and controls consume snapshots, never the sim directly, so no client rewrites
are needed when the ws transport lands (P4/P5).

## 4. Firebase (project `legendarena`) — console + CLI

Used **only** for: anonymous auth, presence, queues/lobbies, match results.
**Never** 60 Hz position writes. The exact SDK (12.19.0, gstatic CDN) and config are in
`src/client/firebaseConfig.js`.

### Firebase Console (one-time)

1. Go to <https://console.firebase.google.com> → open project **legendarena**.
2. **Authentication → Sign-in method → enable *Anonymous***.
3. **Realtime Database** → confirm the instance `legendarena-default-rtdb` exists
   (URL `https://legendarena-default-rtdb.firebaseio.com`). Create it in the region you
   want if it doesn't exist yet.
4. **App Check** — later, only after rules are proven:
   - Register the web app with **reCAPTCHA Enterprise** for production.
   - For development use a **debug token** (App Check → Apps → Manage debug tokens).
   - Do **not** enable enforcement until the rules below are deployed and verified.

### CLI (deploy rules + hosting)

```bash
npm install -g firebase-tools
firebase login
firebase projects:list                 # verify you can see legendarena
firebase use --add legendarena         # alias it (e.g. "default")

# in the project root (firebase.json / .firebaserc / database.rules.json are ready)
firebase init                          # choose: Database, Hosting, Emulators (skip Functions unless adding)

firebase emulators:start               # local dev against emulated RTDB/Hosting
firebase deploy --only database        # push the default-deny security rules
firebase deploy --only hosting         # (optional) also host the client on Firebase
```

Rules live in `database.rules.json` (default-deny; only queue/lobby/presence/results
paths open). Deploy them before any multiplayer testing.

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
