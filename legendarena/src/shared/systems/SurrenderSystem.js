// Legend Arena — team surrender voting ("FF").
import { CONFIG } from '../core/config.js';

export const SurrenderSystem = {
  init(world) {
    world.surrState = {
      active: false, team: null, by: null, endsAt: 0,
      votes: {}, // heroId -> true(yes)/false(no)
      nextAllowed: [0, 0],
    };
  },
  state(world) { return world.surrState; },

  start(world, hero) {
    const s = world.surrState;
    if (s.active) return { ok: false, why: 'vote already running' };
    if (world.t < CONFIG.SURRENDER_MIN_TIME) return { ok: false, why: 'too early' };
    if (world.t < s.nextAllowed[hero.team]) return { ok: false, why: 'cooldown' };
    s.active = true; s.team = hero.team; s.by = hero.name; s.endsAt = world.t + CONFIG.SURRENDER_VOTE_TIME;
    s.votes = { [hero.id]: true };
    world.emit({ type: 'surrenderStart', team: hero.team, by: hero.name, endsAt: s.endsAt });
    return { ok: true };
  },

  vote(world, hero, yes) {
    const s = world.surrState;
    if (!s.active || hero.team !== s.team || hero.dead && false) return { ok: false, why: 'no active vote' };
    s.votes[hero.id] = !!yes;
    world.emit({ type: 'surrenderVote', team: s.team, id: hero.id, yes: !!yes });
    this.evaluate(world, true);
    return { ok: true };
  },

  teamPlayers(world, team) {
    return world.heroes.filter(h => h.team === team);
  },

  evaluate(world, early = false) {
    const s = world.surrState;
    if (!s.active) return;
    const members = this.teamPlayers(world, s.team).filter(h => h.controller !== 'disconnected');
    const yes = members.filter(h => s.votes[h.id] === true).length;
    const no = members.filter(h => s.votes[h.id] === false).length;
    const need = Math.floor(members.length / 2) + 1;
    if (yes >= need) this.finish(world, true);
    else if (!early && world.t >= s.endsAt) this.finish(world, false);
  },

  finish(world, passed) {
    const s = world.surrState;
    s.active = false;
    s.nextAllowed[s.team] = world.t + CONFIG.SURRENDER_COOLDOWN;
    if (passed) {
      world.matchOver = { winner: s.team === 0 ? 1 : 0, reason: 'surrender' };
    }
    world.emit({ type: 'surrenderEnd', team: s.team, passed });
  },

  tick(world) {
    if (world.surrState.active) this.evaluate(world);
  },
};
