import { rankValue } from '../util.js';
import { addBuff, dealDamage, heal, isTargetable, getBuff } from '../combat.js';
import { enemiesInRadius, inCone, resetAttack } from './common.js';

const Q_OUTER = 425;
const Q_INNER = 205;
const E_RANGE = 535;
const E_HALF_ANGLE = (25 * Math.PI) / 180;

function bleedStacks(game, t) {
  const d = t.dots.find((x) => x.name === 'bleed');
  return d && d.end > game.time ? d.stacks : 0;
}

export function applyBleed(game, c, t) {
  if (!t.alive) return;
  const might = c.s.mightUntil > game.time;
  const prev = bleedStacks(game, t);
  const stacks = might ? 5 : Math.min(5, prev + 1);
  const total = 13 + c.level + 0.3 * c.stats.bonusAd;
  const d = game.addDot(t, { name: 'bleed', src: c.id, total, duration: 5, interval: 1.25, type: 'physical' });
  d.stacks = stacks;
  if (stacks === 5 && t.kind === 'champion' && !might) {
    c.s.mightUntil = game.time + 5;
    addBuff(game, c, { name: 'noxian_might', duration: 5, adFlat: 30 + (200 * (c.level - 1)) / 17 });
    game.emit({ type: 'noxian_might', id: c.id });
  }
}

export default {
  key: 'darius',
  name: 'Darius',
  title: '诺克萨斯之手',
  base: {
    hp: 652, hpG: 114, hpRegen: 2, hpRegenG: 0.19, mana: 263, manaG: 58, manaRegen: 1.32, manaRegenG: 0.07,
    ad: 64, adG: 5, as: 0.625, asG: 0.01, armor: 39, armorG: 5.2, mr: 32, mrG: 2.05,
    ms: 340, range: 175, windup: 0.3,
  },
  resource: 'mana',
  firstSkills: ['Q', 'E', 'W'],
  maxOrder: ['Q', 'E', 'W'],
  build: ['long_sword', 'ruby_crystal', 'boots', 'warhammer', 'black_cleaver', 'cloth_armor', 'steelcaps', 'giants_belt', 'pickaxe', 'sterak', 'pickaxe', 'cloth_armor', 'long_sword', 'deaths_dance', 'giants_belt', 'null_mantle', 'spirit_visage'],

  init(game, c) {
    c.s = { wUntil: 0, mightUntil: 0 };
  },

  abilities: {
    Q: {
      name: '大杀四方', targeting: 'self', castTime: 0.75, canMove: true, cd: [9, 8, 7, 6, 5], cost: [30, 35, 40, 45, 50], range: Q_OUTER,
      desc: '蓄力后挥舞巨斧，斧刃造成高额伤害并施加出血，每命中一名英雄回复已损失生命值。',
      cast(game, c, ctx) {
        const rank = ctx.rank;
        const full = rankValue([50, 80, 110, 140, 170], rank) + rankValue([1.0, 1.1, 1.2, 1.3, 1.4], rank) * c.stats.ad;
        let champsBladed = 0;
        game.emit({ type: 'darius_q', id: c.id, x: c.x, y: c.y });
        for (const u of enemiesInRadius(game, c.team, c.x, c.y, Q_OUTER)) {
          const d = Math.hypot(u.x - c.x, u.y - c.y);
          const blade = d + u.radius * 0.5 >= Q_INNER;
          dealDamage(game, c, u, blade ? full : full * 0.35, 'physical', { ability: 'Q', label: blade ? 'darius_q_blade' : 'darius_q_handle' });
          if (blade) {
            applyBleed(game, c, u);
            if (u.kind === 'champion') champsBladed++;
          }
        }
        if (champsBladed) heal(game, c, Math.min(3, champsBladed) * 0.13 * (c.stats.maxHp - c.hp));
      },
    },
    W: {
      name: '致残打击', targeting: 'self', castTime: 0, cd: [7, 6.5, 6, 5.5, 5], cost: [30, 30, 30, 30, 30], range: 0,
      desc: '下次普攻造成额外伤害并大幅减速目标。重置普攻。',
      cast(game, c, ctx) {
        c.s.wUntil = game.time + 4;
        c.s.wRank = ctx.rank;
        resetAttack(game, c);
      },
    },
    E: {
      name: '无情铁手', targeting: 'point', castTime: 0.25, cd: [24, 22, 20, 18, 16], cost: [45, 45, 45, 45, 45], range: E_RANGE,
      desc: '被动：获得护甲穿透。主动：将前方锥形区域内的敌人拉向自己并减速。',
      cast(game, c, ctx) {
        const ang = Math.atan2(ctx.y - c.y, ctx.x - c.x);
        c.facing = ang;
        game.emit({ type: 'darius_e', id: c.id, angle: ang });
        for (const u of enemiesInRadius(game, c.team, c.x, c.y, E_RANGE)) {
          if (!inCone(c.x, c.y, ang, E_RANGE, E_HALF_ANGLE, u)) continue;
          const dx = u.x - c.x, dy = u.y - c.y;
          const d = Math.hypot(dx, dy) || 1;
          const stop = c.radius + u.radius + 30;
          const tx = c.x + (dx / d) * stop, ty = c.y + (dy / d) * stop;
          const dur = Math.max(0.1, (d - stop) / 1500);
          addBuff(game, u, { name: 'darius_e_pull', duration: dur, airborne: true, noTenacity: true });
          game.startDash(u, { x: tx, y: ty, speed: 1500, name: 'pulled', keepFacing: true, ignoreStructures: true });
          addBuff(game, u, { name: 'darius_e_slow', duration: 1, slow: 0.4 });
        }
      },
    },
    R: {
      name: '诺克萨斯断头台', targeting: 'unit', champOnly: true, castTime: 0, cd: [120, 100, 80], cost: [100, 100, 0], range: 460,
      uninterruptible: true,
      desc: '跃向敌方英雄造成真实伤害，每层出血提升伤害；击杀可刷新冷却。',
      cast(game, c, ctx) {
        const t = ctx.target;
        game.emit({ type: 'darius_r', id: c.id, target: t.id });
        addBuff(game, c, { name: 'darius_r_unstoppable', duration: 0.6, tenacity: 1, noTenacity: true });
        game.startDash(c, {
          target: t.id, speed: 1500, stopDist: c.radius + t.radius - 10, name: 'guillotine', ignoreStructures: true,
          maxTime: game.time + 0.6,
          onEnd: () => {
            if (!t.alive || !c.alive || Math.hypot(t.x - c.x, t.y - c.y) > c.radius + t.radius + 200) return;
            const stacks = bleedStacks(game, t);
            const dmg = (rankValue([125, 250, 375], ctx.rank) + 0.75 * c.stats.bonusAd) * (1 + 0.2 * stacks);
            game.emit({ type: 'darius_r_hit', id: c.id, target: t.id, stacks });
            dealDamage(game, c, t, dmg, 'true', { ability: 'R', label: 'darius_r' });
            if (!t.alive) {
              c.cds.R = game.time;
              game.emit({ type: 'darius_r_reset', id: c.id });
            } else applyBleed(game, c, t);
          },
        });
      },
    },
  },

  update(game, c) {
    c.armorPenPct = c.ranks.E > 0 ? rankValue([0.2, 0.25, 0.3, 0.35, 0.4], c.ranks.E) : 0;
    c.stats.armorPenPct = c.armorPenPct;
  },

  cannotAttack(game, c) {
    return !!(c.cast && c.cast.slot === 'Q');
  },

  onAttack(game, c, t, ctx) {
    const s = c.s;
    if (s.wUntil > game.time) {
      s.wUntil = 0;
      ctx.label = 'darius_w';
      ctx.extra.push({ amount: rankValue([0.4, 0.45, 0.5, 0.55, 0.6], s.wRank) * c.stats.ad, type: 'physical', label: 'darius_w' });
      ctx.after.push(() => { if (isTargetable(t)) addBuff(game, t, { name: 'darius_w_slow', duration: 1, slow: 0.9 }); });
    }
    if (t.kind === 'champion' || t.kind === 'minion') ctx.after.push(() => applyBleed(game, c, t));
  },

  obsFeatures(game, c) {
    const s = c.s;
    const enemy = game.champions[1 - c.team];
    return [
      s.wUntil > game.time ? 1 : 0,
      s.mightUntil > game.time ? 1 : 0,
      c.cast && c.cast.slot === 'Q' ? 1 : 0,
      enemy ? bleedStacks(game, enemy) / 5 : 0,
      c.armorPenPct || 0,
      0,
    ];
  },
};

export { bleedStacks, getBuff };
