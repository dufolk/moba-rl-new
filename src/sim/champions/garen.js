import { rankValue } from '../util.js';
import { addBuff, addShield, dealDamage, cooldown, isTargetable } from '../combat.js';
import { enemiesInRadius, bonusHp, resetAttack } from './common.js';

const SPIN_DURATION = 3;
const SPIN_HITS = 7;
const SPIN_RADIUS = 325;

function endSpin(game, c) {
  const s = c.s;
  if (!s.spin) return;
  s.spin = null;
  c.cds.E = game.time + cooldown(c, rankValue([9, 8.25, 7.5, 6.75, 6], c.ranks.E));
  game.emit({ type: 'spin_end', id: c.id });
}

export default {
  key: 'garen',
  name: 'Garen',
  title: '德玛西亚之力',
  base: {
    hp: 690, hpG: 98, hpRegen: 1.6, hpRegenG: 0.1, mana: 0,
    ad: 69, adG: 4.5, as: 0.625, asG: 0.0365, armor: 36, armorG: 5.2, mr: 32, mrG: 2.05,
    ms: 340, range: 175, windup: 0.3,
  },
  resource: 'none',
  firstSkills: ['Q', 'E', 'W'],
  maxOrder: ['E', 'Q', 'W'],
  build: ['long_sword', 'boots', 'ruby_crystal', 'warhammer', 'black_cleaver', 'cloth_armor', 'steelcaps', 'pickaxe', 'giants_belt', 'sterak', 'null_mantle', 'giants_belt', 'spirit_visage', 'cloth_armor', 'giants_belt', 'sunfire'],

  init(game, c) {
    c.s = { qUntil: 0, spin: null };
  },

  abilities: {
    Q: {
      name: '致命打击', targeting: 'self', castTime: 0, cd: [8, 8, 8, 8, 8], range: 0,
      desc: '移除减速，获得移速加成；下次普攻造成额外伤害并沉默目标。',
      cast(game, c, ctx) {
        c.buffs = c.buffs.filter((b) => !b.slow);
        addBuff(game, c, { name: 'garen_q_ms', duration: rankValue([1, 1.65, 2.3, 2.95, 3.6], ctx.rank), msPct: 0.35 });
        c.s.qUntil = game.time + 4.5;
        c.s.qRank = ctx.rank;
        resetAttack(game, c);
      },
    },
    W: {
      name: '勇气', targeting: 'self', castTime: 0, cd: [23, 21, 19, 17, 15], range: 0,
      desc: '获得短暂护盾与韧性，并在数秒内减少受到的伤害。',
      cast(game, c, ctx) {
        addBuff(game, c, { name: 'garen_w', duration: rankValue([2, 2.75, 3.5, 4.25, 5], ctx.rank), dr: 0.3 });
        addBuff(game, c, { name: 'garen_w_ten', duration: 0.75, tenacity: 0.6 });
        addShield(game, c, 45 + 40 * ctx.rank + 0.18 * bonusHp(c), 0.75, 'garen_w');
      },
    },
    E: {
      name: '审判', targeting: 'self', castTime: 0, cd: [9, 8.25, 7.5, 6.75, 6], range: SPIN_RADIUS, manualCd: true,
      desc: '快速旋转3秒，对周围敌人持续造成物理伤害。再次施放可提前结束。',
      cast(game, c, ctx) {
        c.s.qUntil = 0;
        c.s.spin = { start: game.time, end: game.time + SPIN_DURATION, next: game.time + 0.05, hits: {}, rank: ctx.rank };
        c.cds.E = game.time + 999;
        addBuff(game, c, { name: 'garen_e_ghost', duration: SPIN_DURATION, ghost: true });
      },
      canRecast(game, c) {
        return !!c.s.spin && game.time - c.s.spin.start > 0.4;
      },
      recast(game, c) {
        c.buffs = c.buffs.filter((b) => b.name !== 'garen_e_ghost');
        endSpin(game, c);
      },
    },
    R: {
      name: '德玛西亚正义', targeting: 'unit', champOnly: true, castTime: 0.435, cd: [120, 100, 80], range: 400,
      desc: '召唤德玛西亚之剑，对敌方英雄造成真实伤害（基于目标已损失生命值）。',
      cast(game, c, ctx) {
        const t = ctx.target;
        if (!t || !t.alive) return;
        const dmg = rankValue([150, 300, 450], ctx.rank) + rankValue([0.25, 0.3, 0.35], ctx.rank) * (t.stats.maxHp - t.hp);
        game.emit({ type: 'garen_r', id: c.id, target: t.id });
        dealDamage(game, c, t, dmg, 'true', { ability: 'R', label: 'garen_r' });
      },
    },
  },

  cannotAttack(game, c) {
    return !!c.s.spin;
  },

  update(game, c) {
    const s = c.s;
    // Passive: Perseverance
    if (game.time - (c.lastHitByChampOrTowerAt ?? -99) >= 8) {
      const pct = 0.003 + 0.0006 * (c.level - 1);
      c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.maxHp * pct / 30);
      s.perseverance = true;
    } else s.perseverance = false;

    if (s.spin) {
      const sp = s.spin;
      while (s.spin && game.time >= sp.next && sp.next < sp.end) {
        sp.next += SPIN_DURATION / SPIN_HITS;
        const rank = sp.rank;
        const per = rankValue([4, 8, 12, 16, 20], rank) + (8.2 * (c.level - 1)) / 17 + rankValue([0.32, 0.34, 0.36, 0.38, 0.4], rank) * c.stats.ad;
        const hits = enemiesInRadius(game, c.team, c.x, c.y, SPIN_RADIUS);
        const lone = hits.length === 1 && hits[0].kind === 'champion';
        game.emit({ type: 'spin_tick', id: c.id });
        for (const u of hits) {
          const amt = u.kind === 'champion' ? per * (lone ? 1.25 : 1) : per * 0.75;
          dealDamage(game, c, u, amt, 'physical', { ability: 'E', label: 'garen_e' });
          if (u.kind === 'champion') {
            sp.hits[u.id] = (sp.hits[u.id] || 0) + 1;
            if (sp.hits[u.id] === 6) addBuff(game, u, { name: 'garen_e_shred', duration: 6, armorRedPct: 0.25 });
          }
        }
      }
      if (s.spin && game.time >= sp.end) endSpin(game, c);
    }
  },

  onAttack(game, c, t, ctx) {
    const s = c.s;
    if (s.qUntil > game.time) {
      s.qUntil = 0;
      ctx.label = 'garen_q';
      ctx.extra.push({ amount: 30 * s.qRank + 0.5 * c.stats.ad, type: 'physical', label: 'garen_q' });
      if (t.kind === 'champion') ctx.after.push(() => { if (isTargetable(t)) addBuff(game, t, { name: 'garen_q_silence', duration: 1.5, silence: true }); });
    }
  },

  obsFeatures(game, c) {
    const s = c.s;
    return [
      s.qUntil > game.time ? 1 : 0,
      s.spin ? Math.max(0, s.spin.end - game.time) / 3 : 0,
      c.buffs.some((b) => b.name === 'garen_w') ? 1 : 0,
      s.perseverance ? 1 : 0,
      0, 0,
    ];
  },
};
