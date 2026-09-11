# LEGEND ARENA — Known Issues (living document)

Honest tracker of open defects. Nothing here is "flawless" — this file exists so we never claim that.
Statuses: OPEN / WONTFIX / FIXED (with date). QA final pass (P6) must triage every OPEN item.

## Simulation / AI

- **OPEN — d1 (easy) bots can stall even games.** Seeds 2 & 7 at difficulty 1 timed out at 26 min in the
  verification matrix (5–9 turrets killed, kill counts 123–217, no core push). Even kill trades mean the
  snowball override (kill lead ≥ 12) never fires, and d1's low dive license keeps groups dancing at the
  turret line. d2/d3 and the other d1 seeds conclude in 14–25 min. Candidate fixes for the next AI pass:
  per-role pick priority for d1, wave-escort siege positioning, objective-pet-led pushes.
- **OPEN — high fight frequency.** Bot kill totals run 97–217 per match (was artificially low before the
  spatial-grid fix because hero abilities/turrets literally could not see heroes). Combat is correct now;
  tuning targets belong in the P6 balance pass (retreat curves, engage radius per archetype).
- **OPEN — minions deal ~0 damage to heroes.** Minion target scoring prefers enemy minions by a wide
  margin, so heroes standing in waves are effectively un-chipped. Acceptable for now (matches lane feel),
  revisit if hero lane sustain is too strong.
- **FIXED 2026-09-11 — heroes missing from spatial grid** (turrets/aoe/minion protect-aggro couldn't see
  them). Root cause of pre-fix artificial numbers.
- **FIXED 2026-09-11 — minions bypassed or jammed on invulnerable structures.** Minions now target the
  rearmost enemy structure on their lane even when it is invulnerable (they hold and hit for 0 until the
  vulnerability chain opens it). Prevents base-line bypass *and* the 12-minute frozen-blob stall.
- **FIXED 2026-09-11 — stalemate breakers added:** siege (cannon) minions outrange turrets (500 > 470),
  late-game wave escalation after 12:00 (+1 melee/+1 ranged, siege every 2nd wave), backdoor armor decay
  after 15:00/20:00 (×0.25 → ×0.45 → ×0.70, symmetric, never a match timer), snowball dive override at
  kill lead ≥ 12, group siege now picks the most-open lane, focus-fire minion scoring resolves wave clashes.
- **FIXED 2026-09-11 — Phoenix Feather could revive repeatedly** (phoenixUsed reset every tick because
  phoenixCdUntil was never set). Damage.js now sets `phoenixCdUntil = t + 180`; Hero.js per-tick reset now
  works against a real timestamp.
- **FIXED 2026-09-11 — Rift ultimate recast duplicated** in Sim.js and HeroRegistry.js. Consolidated into
  exported `riftBlink()`; Sim imports it.
- **FIXED 2026-09-11 — h.dmgDealt/dmgTaken never accumulated.** Now summed in dealDamage for hero sources.
- **FIXED 2026-09-11 — CONFIG_LEASH() local hoist** replaced with `CONFIG.JUNGLE_LEASH` (import added).
- **FIXED 2026-09-11 — SurrenderSystem state overwrote its own API** (`world.surrender = {...state}` clobbered
  the system object → `sim.surrender.start` vanished). State moved to `world.surrState`; BotController and
  snapshots updated.

## Tests

- `node --test tests/` → 32/32 pass (combat pipeline, lane economy/waves, jungle/structures/objectives/
  recall/surrender/shop/battle spells). Run before every commit.
- Deterministic matrix gate (`tools/botsim.js`): 7 of 9 configs conclude 14.4–25.0 min; see KNOWN ISSUES
  above for the two d1 stalls. Harnesses must call `sim.drainEvents()` per step (events accumulate).

## Client / Backend

- Playwright pinned 1.63.0 as devDependency — **install still unconfirmed** (no browser download run yet).
- Firebase wiring, netcode, and client rendering phases (P3–P5) not started at time of writing.
