import { Rng, dist, rankValue } from './util.js';
import { LAYOUT, teamX, halfWidth, raycastTerrain } from './map.js';
import { isTargetable, mitigationMult } from './combat.js';

/**
 * Rule-based laning bot. It only interacts with the game through game.command(),
 * exactly like a human or an RL agent, so it can be swapped for either.
 */
export class Bot {
  constructor(game, team, difficulty = 1) {
    this.game = game;
    this.team = team;
    this.difficulty = difficulty;
    this.rng = new Rng((game.seed * 7919 + team * 104729) >>> 0);
    this.period = 3;
    this.mode = 'lane';
    this.lastMove = null;
  }

  get me() { return this.game.champions[this.team]; }
  get enemy() { return this.game.champions[1 - this.team]; }

  cmd(c) { this.game.command(this.team, c); }

  moveTo(x, y) {
    const lm = this.lastMove;
    if (lm && Math.hypot(lm.x - x, lm.y - y) < 40 && this.game.time - lm.t < 0.8) return;
    this.lastMove = { x, y, t: this.game.time };
    this.cmd({ type: 'move', x, y });
  }

  attack(u) {
    this.lastMove = null;
    const c = this.me;
    if (c.order && c.order.type === 'attack' && c.order.target === u.id) return;
    this.cmd({ type: 'attack', target: u.id });
  }

  cast(slot, opts = {}) {
    const st = this.game.abilityState(this.me, slot);
    if (!st.ready) return false;
    this.cmd({ type: 'cast', slot, ...opts });
    return true;
  }

  update() {
    const g = this.game;
    if (g.tick % this.period !== this.team) return;
    if (this.difficulty < 1 && this.rng.next() > this.difficulty) return;
    const c = this.me;
    if (!c.alive || c.dash || (c.cast && !c.cast.canMove)) return;
    this.think();
  }

  dir() { return this.team === 0 ? 1 : -1; }

  enemyTowerFront() {
    for (const tw of [...this.game.towers[1 - this.team]].reverse()) if (tw.alive) return tw;
    return null;
  }

  underEnemyTowerThreat(x, y) {
    const g = this.game;
    for (const tw of g.towers[1 - this.team]) {
      if (!tw.alive) continue;
      if (Math.hypot(tw.x - x, tw.y - y) > tw.stats.range + 120) continue;
      const tgt = tw.target != null ? g.byId.get(tw.target) : null;
      if (tgt && tgt.id === this.me.id) return tw;
      const allyMinionsInRange = g.units.some((u) => u.kind === 'minion' && u.alive && u.team === this.team && dist(u, tw) < tw.stats.range);
      if (!allyMinionsInRange) return tw;
    }
    return null;
  }

  estimateBurst(c, e) {
    const g = this.game;
    const mit = mitigationMult(c, e, 'physical');
    let dmg = c.stats.ad * mit * 2;
    const r = g.abilityState(c, 'R');
    if (r.ready) dmg += this.rDamage(c, e);
    if (g.abilityState(c, 'Q').ready) dmg += c.stats.ad * 0.8 * mit;
    if (g.abilityState(c, 'E').ready) dmg += c.stats.ad * 0.9 * mit;
    return dmg;
  }

  rDamage(c, e) {
    const rank = c.ranks.R;
    if (!rank) return 0;
    if (c.champ === 'garen') return rankValue([150, 300, 450], rank) + rankValue([0.25, 0.3, 0.35], rank) * (e.stats.maxHp - e.hp);
    if (c.champ === 'darius') {
      const d = e.dots.find((x) => x.name === 'bleed');
      const stacks = d && d.end > this.game.time ? d.stacks : 0;
      return (rankValue([125, 250, 375], rank) + 0.75 * c.stats.bonusAd) * (1 + 0.2 * stacks);
    }
    return 0;
  }

  think() {
    const g = this.game;
    const c = this.me;
    const e = this.enemy;
    const hpPct = c.hp / c.stats.maxHp;
    const fountain = { x: teamX(this.team, LAYOUT.fountainX), y: 0 };
    const eVisible = isTargetable(e);
    const dE = eVisible ? dist(c, e) : Infinity;
    const eHpPct = e.alive ? e.hp / e.stats.maxHp : 1;

    // --- recover at fountain
    if (this.mode === 'heal') {
      if (hpPct > 0.92) this.mode = 'lane';
      else { this.moveTo(fountain.x, 0); return; }
    }
    if (hpPct < 0.22 && !(eVisible && dE < 500 && this.estimateBurst(c, e) > e.hp)) {
      this.mode = 'heal';
      if (eVisible && dE < 300 && hpPct < 0.12) this.cast('D', { x: c.x - this.dir() * 400, y: c.y });
      this.moveTo(fountain.x, 0);
      return;
    }

    // --- kill / trade
    const eUnderTower = eVisible && this.underEnemyTowerThreat(e.x, e.y);
    const canKill = eVisible && dE < 700 && this.estimateBurst(c, e) > e.hp;
    if (eVisible && !canKill && this.dodge(c, e, dE)) return;
    const minionsNearEnemy = eVisible ? this.enemyMinionsNear(e, 500) : 0;
    const wantTrade = eVisible && dE < 520 && hpPct > eHpPct - 0.15 && !eUnderTower && (minionsNearEnemy < 3 || hpPct > 0.75);
    if (canKill && (!eUnderTower || hpPct > 0.6)) {
      if (this.championCombo(c, e, dE, true)) return;
      this.attack(e);
      return;
    }
    if (wantTrade) {
      if (this.championCombo(c, e, dE, false)) return;
      this.attack(e);
      return;
    }

    // --- avoid tower aggro
    const tw = this.underEnemyTowerThreat(c.x, c.y);
    if (tw) {
      const away = Math.atan2(c.y - tw.y, c.x - tw.x);
      this.moveTo(tw.x + Math.cos(away) * (tw.stats.range + 260), tw.y + Math.sin(away) * (tw.stats.range + 260) * 0.3);
      return;
    }

    // --- farm
    const myAd = c.stats.ad;
    let lastHit = null, nearest = null, nearestD = Infinity;
    for (const u of g.units) {
      if (u.kind !== 'minion' || !u.alive || u.team === c.team) continue;
      const d = dist(c, u);
      if (d > 900) continue;
      if (this.underEnemyTowerThreat(u.x, u.y) && d > c.stats.range + 150) continue;
      const eff = myAd * mitigationMult(c, u, 'physical');
      if (u.hp <= eff * 1.05 && (!lastHit || u.hp < lastHit.hp)) lastHit = u;
      if (d < nearestD) { nearestD = d; nearest = u; }
    }
    if (lastHit) { this.attack(lastHit); return; }
    if (this.abilityFarm(c)) return;

    // --- siege
    const etw = this.enemyTowerFront();
    if (etw && etw.vulnerable) {
      const t = etw.target != null ? g.byId.get(etw.target) : null;
      if (t && t.kind === 'minion' && dist(c, etw) < 1100 && !(eVisible && dE < 700)) { this.attack(etw); return; }
    }
    const enx = g.nexus[1 - this.team];
    if (enx.vulnerable && dist(c, enx) < 1500 && !(eVisible && dE < 600)) { this.attack(enx); return; }

    if (nearest && nearestD < 650 && (!eVisible || dE > 900 || hpPct > 0.7)) { this.attack(nearest); return; }

    // --- positioning: stand behind the allied wave
    let front = null;
    for (const u of g.units) {
      if (u.kind !== 'minion' || !u.alive || u.team !== c.team) continue;
      if (!front || u.x * this.dir() > front.x * this.dir()) front = u;
    }
    let px, py;
    if (front) {
      px = front.x - this.dir() * 260;
      py = front.y * 0.5 + (this.rng.next() - 0.5) * 120;
    } else {
      const myTowers = g.towers[this.team].filter((t) => t.alive);
      const anchor = myTowers.length ? myTowers[myTowers.length - 1] : g.nexus[this.team];
      px = anchor.x - this.dir() * 300;
      py = 0;
    }
    const hw = halfWidth(px) - 120;
    py = Math.max(-hw, Math.min(hw, py));
    if (Math.hypot(px - c.x, py - c.y) > 90) this.moveTo(px, py);
  }

  enemyMinionsNear(p, r) {
    let n = 0;
    for (const u of this.game.units) if (u.kind === 'minion' && u.alive && u.team !== this.team && dist(u, p) < r) n++;
    return n;
  }

  /** Step out of the enemy's telegraphed damage zones. Returns true if a command was issued. */
  dodge(c, e, d) {
    const away = (r) => {
      const a = Math.atan2(c.y - e.y, c.x - e.x);
      this.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
      return true;
    };
    if (e.champ === 'garen' && e.s.spin && d < 480) return away(560);
    if (e.champ === 'darius' && e.cast && e.cast.slot === 'Q' && d > 190 && d < 520) return away(580);
    return false;
  }

  abilityFarm(c) {
    const g = this.game;
    const count = (r) => g.units.filter((u) => u.kind === 'minion' && u.alive && u.team !== c.team && dist(u, c) < r).length;
    if (c.champ === 'darius' && c.mana > c.stats.maxMana * 0.5 && count(425) >= 4) return this.cast('Q');
    if (c.champ === 'garen' && count(325) >= 4) return this.cast('E');
    if (c.champ === 'camille' && c.mana > c.stats.maxMana * 0.6 && count(600) >= 4) {
      const m = g.units.find((u) => u.kind === 'minion' && u.alive && u.team !== c.team && dist(u, c) < 600);
      return this.cast('W', { x: m.x, y: m.y });
    }
    return false;
  }

  /** Returns true if a command was issued. */
  championCombo(c, e, d, allIn) {
    const g = this.game;
    const ar = c.stats.range + c.radius + e.radius;
    if (c.champ === 'garen') {
      if (this.rDamage(c, e) >= e.hp && d < 450 && this.cast('R', { target: e.id })) return true;
      if (d < 600 && this.cast('Q')) return true;
      if (d < 260 && (g.abilityState(c, 'Q').cdLeft > 0 || allIn) && !c.s.qUntil && this.cast('E')) return true;
      if (d < 400 && c.lastCombatAt > g.time - 0.5 && c.hp < c.stats.maxHp * 0.8 && this.cast('W')) return true;
      if (c.s.spin) { this.moveTo(e.x, e.y); return true; }
    } else if (c.champ === 'darius') {
      if (this.rDamage(c, e) >= e.hp && d < 500 && this.cast('R', { target: e.id })) return true;
      if (d > ar + 30 && d < 520 && this.cast('E', { x: e.x, y: e.y })) return true;
      if (d < ar + 10 && this.cast('W')) return true;
      if (d > 200 && d < 400 && this.cast('Q')) return true;
      if (c.cast && c.cast.slot === 'Q') {
        // keep the target on the blade
        const want = 320;
        const ang = Math.atan2(c.y - e.y, c.x - e.x);
        this.moveTo(e.x + Math.cos(ang) * want, e.y + Math.sin(ang) * want);
        return true;
      }
    } else if (c.champ === 'camille') {
      const s = c.s;
      if (s.hook || (s.e && s.e.stage === 1)) return true;
      if ((allIn || e.hp < e.stats.maxHp * 0.55) && d < 500 && this.cast('R', { target: e.id })) return true;
      if (s.e && s.e.stage === 2 && this.cast('E', { x: e.x, y: e.y })) return true;
      if (!s.e && !s.hook && d > ar + 80 && d < 1000 && g.abilityState(c, 'E').ready) {
        const near = e.y >= c.y ? 1 : -1;
        for (const side of [near, -near]) {
          const wx = e.x - this.dir() * 120;
          const wy = side * (halfWidth(wx) + 30);
          let dx = wx - c.x, dy = wy - c.y;
          const dl = Math.hypot(dx, dy);
          dx /= dl; dy /= dl;
          const hit = raycastTerrain(c.x, c.y, dx, dy, 780, []);
          if (hit && Math.hypot(hit.x - e.x, hit.y - e.y) < 700 && this.cast('E', { x: wx, y: wy })) return true;
        }
      }
      if (d > 300 && d < 600 && this.cast('W', { x: e.x, y: e.y })) return true;
      if (d < ar + 120) {
        if (!s.q && this.cast('Q')) return true;
        if (s.q && s.q.stage === 2 && !s.q.armed && g.time - s.q.hitAt >= 1.5 && this.cast('Q')) return true;
      }
      // short trade: once Q2 is spent and no engage tool is up, back off instead of brawling
      const qCdLeft = g.abilityState(c, 'Q').cdLeft;
      if (!allIn && !s.q && !s.e && !s.r && qCdLeft > 1.5 && !g.abilityState(c, 'E').ready && d < 450) {
        const a = Math.atan2(c.y - e.y, c.x - e.x);
        this.moveTo(e.x + Math.cos(a) * 650, e.y + Math.sin(a) * 650);
        return true;
      }
    }
    return false;
  }
}
