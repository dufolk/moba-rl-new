import { Game, replayGame } from '../src/sim/game.js';
import { CHAMPION_KEYS } from '../src/sim/champions/index.js';

function play(champs, seed, maxTicks = 30 * 60 * 30) {
  const g = new Game({
    seed, champions: champs, controllers: ['bot', 'bot'], autoLevel: [true, true], autoBuy: [true, true],
  });
  const evCount = {};
  while (!g.over && g.tick < maxTicks) {
    g.step();
    for (const e of g.drainEvents()) evCount[e.type] = (evCount[e.type] || 0) + 1;
  }
  return { g, evCount };
}

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
}

for (const a of CHAMPION_KEYS) {
  for (const b of CHAMPION_KEYS) {
    const t0 = Date.now();
    const { g, evCount } = play([a, b], 7);
    const ms = Date.now() - t0;
    const [c0, c1] = g.champions;
    const towers = g.towers.map((ts) => ts.filter((t) => t.alive).length);
    console.log(
      `${a.padEnd(8)} vs ${b.padEnd(8)} winner=${g.winner} t=${(g.time / 60).toFixed(1)}m ` +
      `K/D ${c0.kills}/${c0.deaths} vs ${c1.kills}/${c1.deaths} cs ${c0.cs}/${c1.cs} lvl ${c0.level}/${c1.level} ` +
      `towers ${towers} items ${c0.items.length}/${c1.items.length} casts=${evCount.cast || 0} ` +
      `(${(g.tick / (ms / 1000)).toFixed(0)} ticks/s)`,
    );
    check(c0.cs + c1.cs > 0, `${a} vs ${b}: no last hits`);
    check(evCount.cast > 10, `${a} vs ${b}: abilities barely used`);
    for (const c of g.champions) check(Number.isFinite(c.hp) && Number.isFinite(c.x), 'non-finite champion state');
  }
}

// Determinism: replaying recorded inputs must reproduce the same game.
{
  const { g } = play(['camille', 'darius'], 123, 30 * 240);
  const r = replayGame(JSON.parse(JSON.stringify(g.exportReplay())));
  while (r.tick < g.tick) r.replayStep();
  const a = g.champions.map((c) => [c.x.toFixed(3), c.y.toFixed(3), c.hp.toFixed(3), c.gold.toFixed(2)]);
  const b = r.champions.map((c) => [c.x.toFixed(3), c.y.toFixed(3), c.hp.toFixed(3), c.gold.toFixed(2)]);
  check(JSON.stringify(a) === JSON.stringify(b), `replay diverged: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  console.log('replay determinism:', JSON.stringify(a) === JSON.stringify(b) ? 'OK' : 'DIVERGED');
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('all sim checks passed');
