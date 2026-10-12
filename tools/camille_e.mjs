// Dev helper: isolated Camille hookshot -> wall dive scenario against an idle target.
import { Game } from '../src/sim/game.js';

for (const ty of [0, 300, -400]) {
  const g = new Game({ seed: 5, champions: ['camille', 'garen'], controllers: ['bot', 'idle'], firstWaveTime: 999 });
  const c = g.champions[0], e = g.champions[1];
  c.x = 6000; c.y = 0; e.x = 6400; e.y = ty; e.passive = true;
  for (const s of ['Q', 'W', 'E']) g.levelSkill(c, s);
  const log = [];
  for (let i = 0; i < 30 * 4; i++) {
    g.step();
    for (const ev of g.drainEvents()) {
      if (ev.id === c.id && /cast|camille/.test(ev.type)) log.push(`${g.time.toFixed(2)} ${ev.type}${ev.slot ? ' ' + ev.slot : ''}${ev.hit != null ? ' hit=' + ev.hit : ''} c=(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
      if (ev.type === 'damage' && ev.label === 'camille_e') log.push(`${g.time.toFixed(2)} E dmg ${ev.amount.toFixed(0)}`);
    }
  }
  console.log(`--- target at (6600, ${ty})`);
  console.log(log.join('\n'));
}
