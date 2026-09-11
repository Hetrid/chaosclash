// LEGEND ARENA — authoritative match server (P4): static hosting + WebSocket matches.
// The server owns the Sim. Clients send 10 Hz input batches; server streams 10 Hz
// per-viewer snapshots (fog-of-war respected: each human gets their team's snapshot).
// Run: npm start  →  http://0.0.0.0:8787  (ws on same port, path /ws)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Sim } from '../src/shared/game/Sim.js';
import { HERO_LIST, HEROES } from '../src/shared/heroes/HeroRegistry.js';

const PORT = process.env.PORT || 8787;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SNAP_HZ = 10, SIM_HZ = 30;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ---------- static hosting ----------
const httpServer = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    p = normalize(p).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, p);
    await stat(file);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

// ---------- matchmaking ----------
const ROLES = ['EXP', 'JUNGLE', 'MID', 'GOLD', 'ROAM'];
const queue = []; // {ws, name, hero, role, spell, diff}

function fillBots(players, humans) {
  // fill each team to 5, respecting the humans already placed on it (one hero per team max)
  for (const team of [0, 1]) {
    const onTeam = players.filter(p => p.team === team);
    const usedT = new Set(onTeam.map(p => p.hero));
    const rolesLeft = ROLES.filter(r => !onTeam.some(p => p.role === r));
    let slot = onTeam.length;
    for (const role of rolesLeft) {
      const cand = HERO_LIST.filter(h => !usedT.has(h));
      const id = cand[Math.floor(Math.random() * cand.length)];
      usedT.add(id);
      players.push({ hero: id, team, slot: slot++, name: (team === 0 ? 'Ally' : 'Foe') + slot, controller: 'bot', role, botLevel: humans[0].diff || 2 });
    }
  }
}

function tryMatch() {
  if (queue.length === 0) return;
  const now = Date.now();
  const head = queue[0];
  const partner = queue.find((q, i) => i > 0 && q.ws.readyState === 1);
  const soloWaitMs = 6000;
  if (!partner && now - head.enqueuedAt < soloWaitMs) return; // hope for a partner briefly
  const humans = partner ? [head, partner] : [head];
  for (const h of humans) queue.splice(queue.indexOf(h), 1);
  const players = humans.map((h, i) => ({ hero: h.hero, team: i, slot: 0, name: h.name || ('Player' + (i + 1)), controller: 'local', role: h.role, spell: h.spell }));
  if (humans.length === 2) {
    // give the second human a real role on team 1... but roles are per team; keep both MID? reassign:
    players[1].role = players[1].role;
  }
  fillBots(players, humans);
  const match = new Match(humans, players);
  for (const h of humans) {
    h.ws.send(JSON.stringify({
      t: 'start',
      seed: match.sim.rng ? undefined : undefined,
      you: match.humanHeroId.get(h),
      team: players[humans.indexOf(h)].team,
      players,
    }));
    match.byWs.set(h.ws, h);
  }
  matches.add(match);
  console.log(`match started: ${humans.length} human(s), ${players.length} players total`);
}

class Match {
  constructor(humans, players) {
    this.sim = new Sim({ seed: (Math.random() * 1e9) | 0, players });
    this.humans = humans;
    this.humanHeroId = new Map();
    this.byWs = new Map();
    for (const h of humans) {
      const hero = this.sim.heroes.find(x => x.controller === 'local' && x.team === players[humans.indexOf(h)].team);
      this.humanHeroId.set(h, hero ? hero.id : this.sim.heroes[0].id);
    }
    this.acc = 0; this.snapAcc = 0; this.last = Date.now();
    this.done = false;
  }
  step(dt) {
    this.acc += dt;
    while (this.acc >= 1 / SIM_HZ) {
      this.sim.step();
      this.acc -= 1 / SIM_HZ;
      if (this.sim.matchOver) { this.finish(); return; }
    }
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ) {
      this.snapAcc = 0;
      for (const [ws, h] of this.byWs) {
        if (ws.readyState !== 1) continue;
        const hero = this.sim.heroes.find(x => x.id === this.humanHeroId.get(h));
        const team = hero ? hero.team : 0;
        try { ws.send(JSON.stringify({ t: 'snap', s: this.sim.snapshot(team) })); } catch { }
      }
    }
  }
  finish() {
    if (this.done) return;
    this.done = true;
    const over = this.sim.matchOver;
    for (const [ws] of this.byWs) {
      try { ws.send(JSON.stringify({ t: 'snap', s: this.sim.snapshot(0), over })); ws.close(); } catch { }
    }
    matches.delete(this);
    console.log('match finished:', over);
  }
  drop(ws) {
    // human disconnected: their hero idles; match continues for others
    this.byWs.delete(ws);
    const hero = this.sim.heroes.find(x => [...this.humanHeroId.values()].includes(x.id) && x.controller === 'local');
    if (hero && [...this.byWs.keys()].length === 0) this.finish();
  }
}

const matches = new Set();
setInterval(tryMatch, 400);
// master loop: step every match at SIM_HZ
let lastT = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  for (const m of [...matches]) m.step(dt);
}, 1000 / SIM_HZ);

// ---------- websocket ----------
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', ws => {
  let entry = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      entry = { ws, name: (m.name || 'Guest').slice(0, 14), hero: m.hero, role: m.role, spell: m.spell, diff: Math.max(1, Math.min(3, m.diff || 2)), enqueuedAt: Date.now() };
      if (!HERO_LIST.includes(entry.hero)) { ws.send(JSON.stringify({ t: 'reject', why: 'unknown hero' })); return; }
      queue.push(entry);
      ws.send(JSON.stringify({ t: 'queued', pos: queue.length }));
    } else if (m.t === 'in') {
      // route to the right match
      for (const match of matches) {
        if (!match.byWs.has(ws)) continue;
        const hid = match.humanHeroId.get(match.byWs.get(ws));
        const hero = match.sim.heroes.find(x => x.id === hid);
        if (hero) for (const input of m.batch || []) match.sim.applyInput(hero, input);
        break;
      }
    }
  });
  ws.on('close', () => {
    const qi = queue.indexOf(entry);
    if (qi >= 0) queue.splice(qi, 1);
    for (const match of matches) if (match.byWs.has(ws)) match.drop(ws);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Legend Arena server on http://0.0.0.0:${PORT} (ws at /ws)`));
