// Headless throughput benchmark: raw sim ticks/s and full RL-step cost (sim + observation encoding).
import { Game } from '../src/sim/game.js';
import { encodeObs, OBS_DIM } from '../src/sim/obs.js';

function bench(label, fn, seconds = 3) {
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < seconds * 1000) n += fn();
  const dt = (performance.now() - t0) / 1000;
  console.log(`${label.padEnd(34)} ${(n / dt).toFixed(0).padStart(8)} ticks/s  (${(n / dt / 30).toFixed(0)}x realtime)`);
}

let g = null;
const fresh = () => new Game({ seed: (Math.random() * 1e9) | 0, champions: ['garen', 'darius'], controllers: ['bot', 'bot'], autoLevel: [true, true], autoBuy: [true, true] });

bench('sim only (bot vs bot)', () => {
  if (!g || g.over) g = fresh();
  for (let i = 0; i < 300; i++) g.step();
  return 300;
});

const out = [new Float32Array(OBS_DIM), new Float32Array(OBS_DIM)];
g = null;
bench('sim + obs both teams every 4 ticks', () => {
  if (!g || g.over) g = fresh();
  for (let i = 0; i < 300; i++) {
    g.step();
    if (i % 4 === 0) { encodeObs(g, 0, out[0]); encodeObs(g, 1, out[1]); }
  }
  return 300;
});
