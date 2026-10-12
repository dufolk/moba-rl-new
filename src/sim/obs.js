// RL observation / action encoding. Kept in JS (next to the sim) so every
// consumer — Python bridge, browser debug overlay, tests — sees identical features.
//
// Coordinates are expressed in the agent's own frame: team 1 sees the map
// point-reflected (x -> L - x, y -> -y), so a single policy can play both sides.

import { MAP_LENGTH } from './map.js';
import { isTargetable, mitigationMult, shieldTotal } from './combat.js';
import { CHAMPION_KEYS } from './champions/index.js';
import { SUMMONERS } from './data.js';

export const ACTION_TYPES = ['noop', 'move', 'attack', 'Q', 'W', 'E', 'R', 'D', 'F', 'stop'];
export const N_DIRS = 16;
export const N_MINION_SLOTS = 8;
export const TARGET_SLOTS = 1 + N_MINION_SLOTS + 4; // enemy champion, minions, 3 towers, nexus
export const ACTION_NVEC = [ACTION_TYPES.length, N_DIRS, TARGET_SLOTS];

const SLOTS = ['Q', 'W', 'E', 'R', 'D', 'F'];
const CHAMP_DIM = 69;
const MINION_DIM = 12;
const STRUCT_DIM = 8;
const GLOBAL_DIM = 6;
export const OBS_DIM = CHAMP_DIM * 2 + MINION_DIM * N_MINION_SLOTS * 2 + STRUCT_DIM * 8 + GLOBAL_DIM;
export const MASK_DIM = ACTION_TYPES.length + TARGET_SLOTS;

function frame(team) {
  return team === 0
    ? { x: (x) => x, y: (y) => y, ang: (a) => a, sx: 1 }
    : { x: (x) => MAP_LENGTH - x, y: (y) => -y, ang: (a) => a + Math.PI, sx: -1 };
}

function writeChampion(o, k, game, c, me, f) {
  const t = game.time;
  const st = c.stats;
  const s = c.status;
  const dx = (c.x - me.x) * f.sx, dy = (c.y - me.y) * f.sx;
  const v = [
    c.alive ? 1 : 0, f.x(c.x) / MAP_LENGTH, f.y(c.y) / 1000, dx / 2000, dy / 2000, Math.hypot(dx, dy) / 3000,
    c.hp / st.maxHp, st.maxHp / 4000, c.hp / 4000, st.maxMana ? c.mana / st.maxMana : 0,
    c.level / 18, c.gold / 4000, st.ad / 400, st.armor / 250, st.mr / 150, st.as / 2.5, st.ms / 600, st.range / 300,
    c.alive ? 0 : Math.max(0, c.respawnAt - t) / 60, shieldTotal(c, t) / st.maxHp,
    s.stun ? 1 : 0, s.silence ? 1 : 0, s.root ? 1 : 0, s.airborne ? 1 : 0, s.slow, s.untargetable ? 1 : 0, s.ghost ? 1 : 0,
    c.windup ? 1 : 0, c.cast ? 1 : 0, c.dash ? 1 : 0,
  ];
  for (const slot of SLOTS) {
    const a = game.abilityState(c, slot);
    v.push(a.rank / 5, a.ready ? 1 : 0, Math.min(a.cdLeft, 120) / 60, a.recast ? 1 : 0);
  }
  for (const key of CHAMPION_KEYS) v.push(c.champ === key ? 1 : 0);
  const extra = c.def.obsFeatures ? c.def.obsFeatures(game, c) : [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) v.push(extra[i] || 0);
  const fa = f.ang(c.facing);
  v.push(Math.cos(fa), Math.sin(fa), c.items.length / 6, c.kills / 10, c.deaths / 10, c.cs / 200);
  for (let i = 0; i < CHAMP_DIM; i++) o[k + i] = v[i] ?? 0;
  return k + CHAMP_DIM;
}

export function encodeObs(game, team, out = null) {
  const o = out || new Float32Array(OBS_DIM);
  o.fill(0);
  const f = frame(team);
  const me = game.champions[team];
  const enemy = game.champions[1 - team];
  let k = 0;
  k = writeChampion(o, k, game, me, me, f);
  k = writeChampion(o, k, game, enemy, me, f);

  const enemyMinions = [];
  const allyMinions = [];
  for (const u of game.units) {
    if (u.kind !== 'minion' || !u.alive) continue;
    (u.team === team ? allyMinions : enemyMinions).push(u);
  }
  const byDist = (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
  enemyMinions.sort(byDist);
  allyMinions.sort(byDist);
  const targets = new Array(TARGET_SLOTS).fill(-1);
  targets[0] = enemy.id;
  for (const [list, isEnemy] of [[enemyMinions, true], [allyMinions, false]]) {
    for (let i = 0; i < N_MINION_SLOTS; i++) {
      const u = list[i];
      if (u) {
        const dx = (u.x - me.x) * f.sx, dy = (u.y - me.y) * f.sx;
        const d = Math.hypot(dx, dy);
        const eff = me.stats.ad * mitigationMult(me, u, 'physical');
        o[k] = 1; o[k + 1] = dx / 2000; o[k + 2] = dy / 2000; o[k + 3] = d / 2000;
        o[k + 4] = u.hp / u.stats.maxHp; o[k + 5] = u.hp / 1000;
        o[k + 6] = u.mtype === 'melee' ? 1 : 0; o[k + 7] = u.mtype === 'caster' ? 1 : 0; o[k + 8] = u.mtype === 'cannon' ? 1 : 0;
        o[k + 9] = u.target === me.id ? 1 : 0;
        o[k + 10] = isEnemy && u.hp <= eff ? 1 : 0;
        o[k + 11] = d <= me.stats.range + me.radius + u.radius ? 1 : 0;
        if (isEnemy) targets[1 + i] = u.id;
      }
      k += MINION_DIM;
    }
  }

  for (const side of [1 - team, team]) {
    const structs = [...game.towers[side], game.nexus[side]];
    structs.forEach((s, i) => {
      const dx = (s.x - me.x) * f.sx, dy = (s.y - me.y) * f.sx;
      o[k] = s.alive ? 1 : 0; o[k + 1] = s.vulnerable ? 1 : 0; o[k + 2] = dx / 5000; o[k + 3] = dy / 2000;
      o[k + 4] = Math.hypot(dx, dy) / 5000; o[k + 5] = s.hp / s.stats.maxHp;
      o[k + 6] = s.target === me.id ? 1 : 0; o[k + 7] = s.target === enemy.id ? 1 : 0;
      if (side !== team) targets[1 + N_MINION_SLOTS + i] = s.id;
      k += STRUCT_DIM;
    });
  }

  o[k++] = game.time / 1800;
  o[k++] = Math.max(0, game.nextWaveAt - game.time) / 30;
  // relic availability, ordered so the agent's "own-side" relics come first
  const relics = team === 0 ? game.relics : [...game.relics].reverse();
  for (let i = 0; i < 4; i++) o[k++] = relics[i] && game.time >= relics[i].availableAt ? 1 : 0;

  return { obs: o, targets, mask: actionMask(game, team, targets) };
}

export function actionMask(game, team, targets) {
  const m = new Uint8Array(MASK_DIM);
  const me = game.champions[team];
  const enemy = game.champions[1 - team];
  m[0] = 1;
  m[9] = 1;
  const tm = ACTION_TYPES.length;
  let anyTarget = false;
  for (let i = 0; i < TARGET_SLOTS; i++) {
    const u = targets[i] >= 0 ? game.byId.get(targets[i]) : null;
    if (u && isTargetable(u) && me.alive) { m[tm + i] = 1; anyTarget = true; }
  }
  if (!me.alive) return m;
  const cc = me.status.stun || me.status.airborne;
  m[1] = cc ? 0 : 1;
  m[2] = anyTarget && !cc ? 1 : 0;
  const enemyOk = isTargetable(enemy);
  const dE = enemyOk ? Math.hypot(enemy.x - me.x, enemy.y - me.y) - enemy.radius : Infinity;
  ['Q', 'W', 'E', 'R'].forEach((slot, i) => {
    const a = game.abilityState(me, slot);
    const ab = me.def.abilities[slot];
    let ok = a.ready && !cc && !me.status.silence && !me.cast;
    if (ok && ab.targeting === 'unit' && !a.recast) ok = enemyOk && dE <= ab.range + 300;
    m[3 + i] = ok ? 1 : 0;
  });
  m[7] = game.abilityState(me, 'D').ready && !cc ? 1 : 0;
  m[8] = game.abilityState(me, 'F').ready && enemyOk && dE <= SUMMONERS.F.range ? 1 : 0;
  return m;
}

/** Convert a MultiDiscrete action [type, dir, target] into a game command (or null). */
export function decodeAction(game, team, action, targets) {
  const [type, dirIdx, tslot] = action;
  const me = game.champions[team];
  const enemy = game.champions[1 - team];
  const f = frame(team);
  const ang = f.ang((dirIdx / N_DIRS) * Math.PI * 2);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const name = ACTION_TYPES[type];
  switch (name) {
    case 'noop': return null;
    case 'stop': return { type: 'stop' };
    case 'move': return { type: 'move', x: me.x + dx * 350, y: me.y + dy * 350 };
    case 'attack': {
      const id = targets[tslot];
      return id >= 0 ? { type: 'attack', target: id } : null;
    }
    case 'D': return { type: 'cast', slot: 'D', x: me.x + dx * 400, y: me.y + dy * 400 };
    case 'F': return { type: 'cast', slot: 'F', target: enemy.id };
    default: {
      const ab = me.def.abilities[name];
      const range = Math.min(ab.range || 300, 700);
      return { type: 'cast', slot: name, x: me.x + dx * range, y: me.y + dy * range, target: enemy.id };
    }
  }
}
