import { rankValue, DT } from '../util.js';
import { addBuff, addShield, dealDamage, heal, cooldown, isTargetable } from '../combat.js';
import { raycastTerrain } from '../map.js';
import { enemiesInRadius, inCone, resetAttack } from './common.js';

const W_RANGE = 610;
const W_HALF_ANGLE = (40 * Math.PI) / 180;
const E_RANGE = 800;
const E_SPEED = 1900;
const E2_RANGE = 800;
const R_RADIUS = 450;

function qCd(c) {
  return cooldown(c, rankValue([9, 8.25, 7.5, 6.75, 6], c.ranks.Q));
}

function structureCircles(game) {
  return game.obstacles().map((o) => ({ x: o.x, y: o.y, r: o.radius }));
}

export default {
  key: 'camille',
  name: 'Camille',
  title: '青钢影',
  base: {
    hp: 650, hpG: 99, hpRegen: 1.7, hpRegenG: 0.16, mana: 339, manaG: 52, manaRegen: 1.63, manaRegenG: 0.15,
    ad: 68, adG: 3.8, as: 0.644, asG: 0.025, armor: 35, armorG: 5, mr: 32, mrG: 2.05,
    ms: 340, range: 125, windup: 0.3,
  },
  resource: 'mana',
  firstSkills: ['Q', 'E', 'W'],
  maxOrder: ['Q', 'E', 'W'],
  build: ['dagger', 'ruby_crystal', 'pickaxe', 'trinity', 'boots', 'cloth_armor', 'steelcaps', 'giants_belt', 'pickaxe', 'sterak', 'pickaxe', 'cloth_armor', 'long_sword', 'deaths_dance', 'giants_belt', 'null_mantle', 'spirit_visage'],

  init(game, c) {
    c.s = { q: null, e: null, hook: null, r: null, passiveReadyAt: 0 };
  },

  abilities: {
    Q: {
      name: '精准礼仪', targeting: 'self', castTime: 0, manualCd: true, cd: [9, 8.25, 7.5, 6.75, 6], cost: [25, 25, 25, 25, 25], range: 0,
      desc: '强化下次普攻并加速。命中后可再次施放；间隔1.5秒后的二段造成双倍加成并转化为真实伤害。',
      blocked(game, c) {
        return !!c.s.q;
      },
      cast(game, c, ctx) {
        c.s.q = { stage: 1, until: game.time + 3.5, rank: ctx.rank, armed: true };
        resetAttack(game, c);
      },
      canRecast(game, c) {
        return !!c.s.q && c.s.q.stage === 2 && !c.s.q.armed;
      },
      recast(game, c) {
        c.s.q.armed = true;
        c.s.q.until = game.time + 3.5;
        game.emit({ type: 'cast', id: c.id, slot: 'Q', recast: true, x: c.x, y: c.y, target: -1, castTime: 0 });
        resetAttack(game, c);
      },
    },
    W: {
      name: '战术横扫', targeting: 'point', castTime: 0.75, canMove: true, cd: [17, 15.5, 14, 12.5, 11], cost: [50, 55, 60, 65, 70], range: W_RANGE,
      desc: '蓄力后向前方锥形横扫。外圈命中造成额外最大生命值伤害、大幅减速并回复生命。',
      cast(game, c, ctx) {
        const ang = Math.atan2(ctx.y - c.y, ctx.x - c.x);
        c.facing = ang;
        game.emit({ type: 'camille_w', id: c.id, angle: ang, x: c.x, y: c.y });
        const base = rankValue([70, 100, 130, 160, 190], ctx.rank) + 0.6 * c.stats.bonusAd;
        const pct = rankValue([0.06, 0.065, 0.07, 0.075, 0.08], ctx.rank) + 0.025 * (c.stats.bonusAd / 100);
        for (const u of enemiesInRadius(game, c.team, c.x, c.y, W_RANGE)) {
          if (!inCone(c.x, c.y, ang, W_RANGE, W_HALF_ANGLE, u)) continue;
          const d = Math.hypot(u.x - c.x, u.y - c.y);
          const outer = d + u.radius * 0.5 >= W_RANGE / 2;
          let dmg = base;
          if (outer) {
            let extra = pct * u.stats.maxHp;
            if (u.kind === 'minion') extra = Math.min(extra, 300);
            dmg += extra;
          }
          const dealt = dealDamage(game, c, u, dmg, 'physical', { ability: 'W', label: outer ? 'camille_w_outer' : 'camille_w' });
          if (outer && u.alive) addBuff(game, u, { name: 'camille_w_slow', duration: 2, slow: 0.8, slowDecay: true });
          if (outer && u.kind === 'champion') heal(game, c, dealt);
        }
      },
    },
    E: {
      name: '钩索', targeting: 'point', castTime: 0, cd: [16, 15, 14, 13, 12], cost: [70, 70, 70, 70, 70], range: E_RANGE,
      desc: '射出钩索拉向墙体；在墙上可再次施放，冲刺撞击首个敌方英雄造成伤害与眩晕，并获得攻速。',
      cast(game, c, ctx) {
        let dx = ctx.x - c.x, dy = ctx.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        c.facing = Math.atan2(dy, dx);
        c.s.hook = { x: c.x, y: c.y, dx, dy, traveled: 0, rank: ctx.rank };
        game.emit({ type: 'camille_hook', id: c.id, dx, dy });
      },
      canRecast(game, c) {
        return !!c.s.e && c.s.e.stage === 2;
      },
      recast(game, c, ctx) {
        if (c.status.root) return false;
        let dx = (ctx.x ?? c.x) - c.x, dy = (ctx.y ?? c.y) - c.y;
        let d = Math.hypot(dx, dy);
        if (d < 1) { dx = -Math.cos(c.facing); dy = -Math.sin(c.facing); d = 1; }
        dx /= d; dy /= d;
        const rank = c.s.e.rank;
        c.s.e = { stage: 3 };
        const tx = c.x + dx * E2_RANGE, ty = c.y + dy * E2_RANGE;
        const speed = 1050 + c.stats.ms;
        game.emit({ type: 'camille_e2', id: c.id, x: tx, y: ty });
        let hitChamp = null;
        game.startDash(c, {
          x: tx, y: ty, speed, name: 'camille_e2', ignoreStructures: true,
          onStep: (u) => {
            const enemy = game.champions[1 - c.team];
            if (isTargetable(enemy) && Math.hypot(enemy.x - u.x, enemy.y - u.y) <= u.radius + enemy.radius + 25) {
              hitChamp = enemy;
              return true;
            }
            return false;
          },
          onEnd: () => {
            c.s.e = null;
            const dmg = rankValue([60, 95, 130, 165, 200], rank) + 0.75 * c.stats.bonusAd;
            game.emit({ type: 'camille_e2_land', id: c.id, x: c.x, y: c.y, hit: hitChamp ? hitChamp.id : -1 });
            for (const u of enemiesInRadius(game, c.team, c.x, c.y, 175)) {
              dealDamage(game, c, u, dmg, 'physical', { ability: 'E', label: 'camille_e' });
            }
            if (hitChamp && hitChamp.alive) addBuff(game, hitChamp, { name: 'camille_e_stun', duration: 0.75, stun: true });
            addBuff(game, c, { name: 'camille_e_as', duration: 5, asPct: rankValue([0.4, 0.5, 0.6, 0.7, 0.8], rank) });
          },
        });
      },
    },
    R: {
      name: '海克斯最后通牒', targeting: 'unit', champOnly: true, castTime: 0, cd: [140, 115, 90], cost: [100, 100, 100], range: 475,
      uninterruptible: true,
      desc: '跃向敌方英雄，期间不可选取；落地后形成禁锢区域，目标无法离开，普攻附带当前生命值魔法伤害。',
      cast(game, c, ctx) {
        const t = ctx.target;
        c.s.hook = null;
        c.s.e = null;
        game.emit({ type: 'camille_r', id: c.id, target: t.id });
        addBuff(game, c, { name: 'camille_r_leap', duration: 0.55, untargetable: true, noTenacity: true });
        game.startDash(c, {
          target: t.id, speed: 1600, stopDist: c.radius + t.radius - 20, ignoreStructures: true, name: 'camille_r',
          maxTime: game.time + 0.55,
          onEnd: () => {
            c.buffs = c.buffs.filter((b) => b.name !== 'camille_r_leap');
            if (!t.alive) return;
            c.s.r = { x: t.x, y: t.y, r: R_RADIUS, end: game.time + rankValue([2.5, 3.25, 4], ctx.rank), target: t.id, rank: ctx.rank };
            game.emit({ type: 'camille_r_land', id: c.id, x: t.x, y: t.y, r: R_RADIUS, duration: c.s.r.end - game.time });
            for (const u of enemiesInRadius(game, c.team, t.x, t.y, R_RADIUS)) {
              if (u === t) continue;
              const dx = u.x - t.x, dy = u.y - t.y;
              const d = Math.hypot(dx, dy) || 1;
              game.startDash(u, { x: t.x + (dx / d) * (R_RADIUS + 60), y: t.y + (dy / d) * (R_RADIUS + 60), speed: 1200, keepFacing: true });
              addBuff(game, u, { name: 'camille_r_knock', duration: 0.3, airborne: true, noTenacity: true });
            }
          },
        });
      },
    },
  },

  update(game, c) {
    const s = c.s;
    // Hookshot flight
    if (s.hook) {
      const h = s.hook;
      const step = E_SPEED * DT;
      const hit = raycastTerrain(h.x, h.y, h.dx, h.dy, Math.min(step, E_RANGE - h.traveled), structureCircles(game));
      if (hit) {
        s.hook = null;
        s.e = { stage: 1, rank: h.rank };
        const wx = hit.x - h.dx * (c.radius * 0.6), wy = hit.y - h.dy * (c.radius * 0.6);
        game.emit({ type: 'camille_hook_attach', id: c.id, x: hit.x, y: hit.y });
        c.order = null;
        game.startDash(c, {
          x: wx, y: wy, speed: 1050 + c.stats.ms, name: 'camille_pull', slideWalls: true, ignoreStructures: true, maxTime: game.time + 1.2,
          onEnd: () => {
            s.e = { stage: 2, rank: h.rank, until: game.time + 1.5, wall: { x: hit.x, y: hit.y } };
            game.emit({ type: 'camille_on_wall', id: c.id });
          },
        });
      } else {
        h.x += h.dx * step;
        h.y += h.dy * step;
        h.traveled += step;
        if (h.traveled >= E_RANGE) {
          s.hook = null;
          c.cds.E = game.time + cooldown(c, rankValue([16, 15, 14, 13, 12], h.rank)) * 0.5;
          game.emit({ type: 'camille_hook_miss', id: c.id });
        }
      }
    }
    if (s.e && s.e.stage === 2 && game.time > s.e.until) s.e = null;
    if (s.e && s.e.stage === 1 && !c.dash) s.e = null;

    // Q expiry
    if (s.q && game.time > s.q.until) {
      s.q = null;
      c.cds.Q = game.time + qCd(c);
    }

    // Ultimatum zone
    if (s.r) {
      const t = game.byId.get(s.r.target);
      const out = Math.hypot(c.x - s.r.x, c.y - s.r.y) > s.r.r + 60;
      if (game.time > s.r.end || !t || !t.alive || (!c.dash && out)) {
        s.r = null;
        game.emit({ type: 'camille_r_end', id: c.id });
      } else {
        const dx = t.x - s.r.x, dy = t.y - s.r.y;
        const d = Math.hypot(dx, dy);
        const lim = s.r.r - t.radius * 0.5;
        if (d > lim) {
          t.x = s.r.x + (dx / d) * lim;
          t.y = s.r.y + (dy / d) * lim;
          if (t.dash) t.dash = null;
        }
      }
    }
  },

  onAttack(game, c, t, ctx) {
    const s = c.s;
    if (t.kind === 'champion' && game.time >= s.passiveReadyAt) {
      s.passiveReadyAt = game.time + (20 - (8 * (c.level - 1)) / 17);
      ctx.after.push(() => addShield(game, c, 0.2 * c.stats.maxHp, 2, 'camille_passive'));
    }
    if (s.q && s.q.armed && t.kind !== 'tower' && t.kind !== 'nexus') {
      const ratio = rankValue([0.2, 0.25, 0.3, 0.35, 0.4], s.q.rank);
      if (s.q.stage === 1) {
        ctx.label = 'camille_q';
        ctx.extra.push({ amount: ratio * c.stats.ad, type: 'physical', label: 'camille_q' });
        addBuff(game, c, { name: 'camille_q_ms', duration: 1, msPct: rankValue([0.2, 0.25, 0.3, 0.35, 0.4], s.q.rank), msPctDecay: true });
        s.q = { stage: 2, until: game.time + 3.5, rank: s.q.rank, armed: false, hitAt: game.time };
      } else {
        const charged = game.time - s.q.hitAt >= 1.5;
        const total = c.stats.ad * (1 + ratio * (charged ? 2 : 1));
        ctx.label = charged ? 'camille_q2_charged' : 'camille_q2';
        if (charged) {
          const conv = Math.min(1, 0.4 + 0.04 * (c.level - 1));
          ctx.dmg = total * (1 - conv);
          ctx.extra.push({ amount: total * conv, type: 'true', label: 'camille_q2_true' });
        } else ctx.dmg = total;
        addBuff(game, c, { name: 'camille_q_ms', duration: 1, msPct: rankValue([0.2, 0.25, 0.3, 0.35, 0.4], s.q.rank), msPctDecay: true });
        s.q = null;
        c.cds.Q = game.time + qCd(c);
      }
    }
    if (s.r && t.id === s.r.target) {
      ctx.extra.push({ amount: rankValue([5, 10, 15], s.r.rank) + rankValue([0.04, 0.06, 0.08], s.r.rank) * t.hp, type: 'magic', label: 'camille_r' });
    }
  },

  obsFeatures(game, c) {
    const s = c.s;
    return [
      s.q && s.q.stage === 1 ? 1 : 0,
      s.q && s.q.stage === 2 ? (s.q.armed ? 1 : 0.5) : 0,
      s.q && s.q.stage === 2 && game.time - s.q.hitAt >= 1.5 ? 1 : 0,
      s.hook ? 0.33 : s.e ? s.e.stage / 3 : 0,
      s.e && s.e.stage === 2 ? 1 : 0,
      s.r ? Math.max(0, s.r.end - game.time) / 4 : 0,
    ];
  },
};
