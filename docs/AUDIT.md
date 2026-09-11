# CHAOS CLASH v0.19 — CODEBASE AUDIT

Source: `uploads/chaos_clash_v0_19_ipad_adminfix.html` (1,405 lines, ~309 KB, single HTML file,
one giant `<script type="module">`, Firebase 12.18.0 on project `misery-4feaf`).

## 1. What exists (verified by reading the source)

| System | Location / evidence | Quality |
|---|---|---|
| Canvas top-down renderer | `draw()`, `drawChar()`, `drawStructure()`, `drawBush()` | OK for arena; primitive shapes |
| Swept projectile collision | `segmentAabbHit()`, `segmentIceWallHit()`, `segPointDistSq()` | **Robust — reuse the approach** |
| 16 heroes | `const H = { blaze … verity }` with hp/spd/cds/kit text | Data good, kits arena-tuned |
| Status effects | slow/freeze/poison/silence/shield/invisibility/immunity via ad-hoc fields | Needs a unified Status/Buff system |
| Firebase multiplayer | room state `RS`, host-authoritative events, `onDisconnect`, transactions | Concept reusable, schema is arena-shaped |
| Rooms/lobbies/teams/spectate | `enterLobby`, `renderLobby`, `spectate` refs | Replace with MOBA lobby/draft |
| Bots | `tickBots`, `botCastAbility`, `moveBot`, practice prefs | Arena chase-bot; **rewrite for roles/laning** |
| SFX engine | `SFX` object: WebAudio osc+noise synth, compressor, remote-shot throttling | **Keep the concept, port & extend** |
| Announcer | `ANNOUNCER` via `speechSynthesis` + banner | **Keep concept** |
| Hit markers / kill crest / streak banner | CSS + `showStreakBanner`, `renderKillChain` | Keep concepts, restyle |
| Mobile HUD (draggable/resizable) | `defaultUI`, `uiPos` localStorage, `applyUIPos`, joystick code | **Keep the approach** |
| iPad perf mode | `.ipadPerf` class: kill backdrop-filter, shadows; FX caps; throttles | **Keep approach** |
| Minimap | minimap canvas in `#tc2` region | Replace with fog-aware MOBA minimap |
| Admin system | `isBotondName()` name check + sha256 passcode, `adminFab` | **Security hole — delete** |
| Verity duel dimension | `currentDuel`, `duelObstacles`, `startVerityDuel` | Delete (separate combat instance) |
| Storm / BR | `STORM_*`, `stormShrinkMs`, zone code | Delete from standard mode |
| Pickups | `PICKUPS`, `applyPickup` | Delete (BR loot) |
| Loadout passives | `PASSIVES` (19 cards), `buildLoadout` | Delete — replaced by intrinsic hero passives |
| Maps | `MAPS` (Citadel/District/Nexus/Skyline/Circuit/Foundry) | Delete — new MOBA map |
| Round system | `hostNextRound`, `roundsToWin`, countdown | Delete |
| Kill-chain match rules | kill-streak affecting match | Delete |

## 2. Keep / Rewrite / Delete

**KEEP (port into new modules)**
- WebAudio synth SFX engine design (osc ramp + shaped noise + compressor + distance/rate throttling).
- speechSynthesis announcer pattern (voice pick, rate/pitch by event tier).
- Swept segment↔AABB projectile vs. wall math; segment↔circle hit tests.
- Mobile control foundation: floating joystick, drag-to-aim buttons, per-button movable/resizable
  layout persisted to localStorage, cancel-cast zone, safe-area handling.
- iPad/iOS perf heuristics (strip backdrop-filter/box-shadow, FX caps, remote-SFX throttling).
- Hit-marker / kill-feed / streak-banner UX concepts. Adaptive quality governor concept.
- Firebase connection patterns: anonymous auth, presence via `onDisconnect`, transaction join flows.

**REWRITE (concept survives, implementation is new)**
- Combat: single raw `damage` number → full stat pipeline (HP/ATK/DEF/pen/aspd/CDR/crit/lifesteal/
  spell vamp/tenacity/shields; physical/magic/true; one authoritative damage function).
- Bots: chase-bot → role state machines (LANE/JG/ROAM/team-fight/objectives, difficulty tiers).
- Netcode: per-event room chatter → snapshot+input model (10 Hz snapshots, batched inputs at 10 Hz,
  60 FPS render via interpolation/prediction).
- Rendering: per-frame shape drawing → cached static map layers, pooled particles, sprite cache.

**DELETE**
- Storm/zones, rounds, pickups, loadout cards, FFA-as-primary, 4-team mode, duel dimension,
  name/password admin gate, old maps, old Firebase project/schema (`cr/<room>`), Cloudflare beacon.

## 3. Migration plan (phases, each ends runnable)

1. **P0 — Repo & docs**: modular `/src` tree, package.json, Firebase config artifacts, this audit.
2. **P1 — Shared simulation core** (pure JS, no DOM; shared by browser, Node server, tests):
   math/RNG, stats & damage pipeline, status system, map data (3 lanes, jungle, river, bases),
   nav (A* grid + lane polylines), entities (Hero/Minion/Monster/Turret/Core/Projectile),
   systems (waves, gold, XP, respawn, jungle, objectives, shop/items, surrender, win conditions).
3. **P2 — Headless proof**: deterministic seeded bot-vs-bot match in Node (tools/botsim.js) +
   node:test unit suites for combat/lane/jungle/structures/objectives. **Must pass before UI.**
4. **P3 — Client**: 60 FPS canvas renderer (cached layers, procedural art), camera, desktop +
   mobile controls, HUD, minimap with fog, shop UI, draft UI, scoreboard, death/recall UI,
   audio + announcer, VFX. Local mode runs the authoritative sim in-browser.
5. **P4 — Networking**: Firebase 12.19 client (`legendarena`), profiles/presence/lobby/queue/match
   metadata; host-authoritative relay (10 Hz snapshots + 10 Hz input batches) for online play with
   prediction/interpolation; Node WebSocket authoritative server (`/server`) as the production path.
6. **P5 — Backend artifacts**: `database.rules.json` (auth-scoped, server-owned state read-only),
   `firebase.json`, `.firebaserc`, emulator test script, CLI setup docs.
7. **P6 — QA**: automated suite (sim units, bot matches, WS server smoke, Firebase rules script,
   Playwright browser smoke), manual mobile checklist, QA report + known issues.
8. **P7 — Polish**: 20-hero balance pass via bot matches, balance JSON export, final docs.

## 4. Legacy → New naming

| Legacy | New |
|---|---|
| Chaos Clash | **Legend Arena** (Firebase project `legendarena`) |
| Agents | Heroes (20) with intrinsic passives |
| Pickups/Storm | Removed; replaced by jungle buffs/objectives |
| Room `cr/<id>` | `lobbies/<id>` + `matches/<id>` (see docs/FIREBASE_SETUP.md) |
