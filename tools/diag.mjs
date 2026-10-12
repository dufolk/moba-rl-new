// Dev helper: run one bot-vs-bot game and print per-champion combat diagnostics.
// Usage: node tools/diag.mjs camille garen [seed]
import { Game } from '../src/sim/game.js';

const [a = 'camille', b = 'garen', seed = '1'] = process.argv.slice(2);
const g = new Game({ seed: Number(seed), champions: [a, b], controllers: ['bot', 'bot'], autoLevel: [true, true], autoBuy: [true, true] });
const casts = [{}, {}];
const deaths = [];
const dmg = [{ champ: 0, taken: 0, byTower: 0, byMinion: 0 }, { champ: 0, taken: 0, byTower: 0, byMinion: 0 }];
while (!g.over && g.time < 1800) {
  g.step();
  for (const ev of g.drainEvents()) {
    if (ev.type === 'cast') {
      const u = g.byId.get(ev.id);
      if (u && u.kind === 'champion') casts[u.team][ev.slot] = (casts[u.team][ev.slot] || 0) + 1;
    } else if (ev.type === 'damage') {
      const s = g.byId.get(ev.src), t = g.byId.get(ev.tgt);
      if (!t || t.kind !== 'champion') continue;
      dmg[t.team].taken += ev.amount;
      if (s && s.kind === 'champion') {
        dmg[s.team].champ += ev.amount;
        const lb = (dmg[s.team].labels ||= {});
        const k = ev.label || (ev.attack ? 'aa' : ev.dmgType);
        lb[k] = Math.round((lb[k] || 0) + ev.amount);
      }
      else if (s && s.kind === 'tower') dmg[t.team].byTower += ev.amount;
      else if (s && s.kind === 'minion') dmg[t.team].byMinion += ev.amount;
    } else if (ev.type === 'death') {
      const u = g.byId.get(ev.id);
      if (u && u.kind === 'champion') deaths.push(`${g.time.toFixed(0)}s ${u.champ} at x=${u.x.toFixed(0)} lvl ${u.level} vs lvl ${g.champions[1 - u.team].level} killer=${g.byId.get(ev.killer)?.kind}`);
    }
  }
}
console.log('winner', g.winner, 'time', (g.time / 60).toFixed(1), 'm');
for (const t of [0, 1]) {
  const c = g.champions[t];
  console.log(c.champ, 'casts', JSON.stringify(casts[t]), 'dmg', Object.fromEntries(Object.entries(dmg[t]).filter(([k]) => k !== 'labels').map(([k, v]) => [k, Math.round(v)])), 'items', c.items.join(','));
  console.log('   by source', JSON.stringify(dmg[t].labels));
}
console.log(deaths.slice(0, 12).join('\n'));
