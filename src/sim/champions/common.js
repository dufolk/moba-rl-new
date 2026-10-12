import { normAngle } from '../util.js';
import { isTargetable } from '../combat.js';
import { growth } from '../util.js';

export function enemiesInRadius(game, team, x, y, r, kinds = ['champion', 'minion']) {
  const out = [];
  for (const u of game.units) {
    if (u.team === team || !kinds.includes(u.kind) || !isTargetable(u)) continue;
    const dx = u.x - x, dy = u.y - y;
    const rr = r + u.radius;
    if (dx * dx + dy * dy <= rr * rr) out.push(u);
  }
  return out;
}

export function inCone(ox, oy, angle, range, halfAngle, u) {
  const dx = u.x - ox, dy = u.y - oy;
  const d = Math.hypot(dx, dy);
  if (d > range + u.radius) return false;
  if (d < u.radius) return true;
  const a = Math.abs(normAngle(Math.atan2(dy, dx) - angle));
  // allow hitting the edge of the unit's collision circle
  return a <= halfAngle + Math.asin(Math.min(1, u.radius / d));
}

export function bonusHp(c) {
  return c.stats.maxHp - growth(c.def.base.hp, c.def.base.hpG, c.level);
}

export function resetAttack(game, c) {
  if (c.nextAttackAt > game.time) c.nextAttackAt = game.time;
}
