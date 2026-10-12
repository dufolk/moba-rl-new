import { DT, TICK_RATE, Rng, dist, dist2, clamp, rankValue } from './util.js';
import { MAP_LENGTH, LAYOUT, teamX, clampToMap } from './map.js';
import {
  DEFAULT_CONFIG, XP_TABLE, MAX_LEVEL, MINIONS, TOWER, NEXUS, RELIC, SUMMONERS, ITEMS, MAX_ITEMS, itemPrice,
} from './data.js';
import {
  addBuff, refreshStatus, computeChampionStats, cooldown, dealDamage, isTargetable, heal, interrupt, getBuff,
} from './combat.js';
import { CHAMPION_DEFS } from './champions/index.js';
import { Bot } from './bot.js';

const COUNTER_KEYS = [
  'dmgToChamp', 'dmgTakenChamp', 'dmgTakenOther', 'dmgToStructure', 'gold', 'xp',
  'lastHits', 'kills', 'deaths', 'towerKills', 'towersLost', 'healed',
];

function emptyCounters() {
  const o = {};
  for (const k of COUNTER_KEYS) o[k] = 0;
  return o;
}

export class Game {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.seed = config.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.time = 0;
    this.tick = 0;
    this.units = [];
    this.byId = new Map();
    this.nextId = 1;
    this.projectiles = [];
    this.events = [];
    this.pending = [[], []];
    this.inputLog = [];
    this.champions = [null, null];
    this.towers = [[], []];
    this.nexus = [null, null];
    this.relics = LAYOUT.relics.map((r, i) => ({ id: i, x: r.x, y: r.y, availableAt: RELIC.firstSpawn }));
    this.waveCount = 0;
    this.nextWaveAt = this.cfg.firstWaveTime;
    this.over = false;
    this.winner = -1;
    this.timeout = false;
    this.firstBlood = false;
    this.totals = [emptyCounters(), emptyCounters()];
    this.delta = [emptyCounters(), emptyCounters()];
    this.fountainTick = 0;

    for (const team of [0, 1]) this.createStructures(team);
    this.updateVulnerability();
    for (const team of [0, 1]) this.createChampion(team, this.cfg.champions[team]);
    this.bots = [0, 1].map((team) => (this.cfg.controllers[team] === 'bot' ? new Bot(this, team, this.cfg.botDifficulty) : null));
  }

  // ------------------------------------------------------------ helpers ----

  emit(ev) {
    ev.t = this.time;
    this.events.push(ev);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  track(team, key, v) {
    this.totals[team][key] += v;
    this.delta[team][key] += v;
  }

  drainDelta() {
    const d = this.delta;
    this.delta = [emptyCounters(), emptyCounters()];
    return d;
  }

  makeUnit(props) {
    const u = {
      id: this.nextId++, alive: true, buffs: [], shields: [], dots: [], facing: 0,
      status: null, stats: {}, windup: null, cast: null, dash: null, ...props,
    };
    refreshStatus(this, u);
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  enemyOf(team) {
    return 1 - team;
  }

  obstacles() {
    const out = [];
    for (const t of [0, 1]) {
      for (const tw of this.towers[t]) if (tw.alive) out.push(tw);
      if (this.nexus[t].alive) out.push(this.nexus[t]);
    }
    return out;
  }

  // ------------------------------------------------------------ setup ----

  createStructures(team) {
    const dir = team === 0 ? 1 : -1;
    for (const def of LAYOUT.towers) {
      const hp = def.tier === 'nexus' ? TOWER.nexusTowerHp : TOWER.hp;
      const tw = this.makeUnit({
        kind: 'tower', team, tier: def.tier, x: teamX(team, def.x), y: def.y, radius: TOWER.radius,
        hp, base: { armor: TOWER.armor, mr: TOWER.mr, ms: 0 },
        stats: { maxHp: hp, armor: TOWER.armor, mr: TOWER.mr, range: TOWER.range, ms: 0 },
        target: null, forced: false, nextShotAt: 0, warm: 0, lastChampTarget: -1, vulnerable: false,
        facing: dir > 0 ? 0 : Math.PI,
      });
      this.towers[team].push(tw);
    }
    this.nexus[team] = this.makeUnit({
      kind: 'nexus', team, x: teamX(team, LAYOUT.nexusX), y: 0, radius: NEXUS.radius, hp: NEXUS.hp,
      base: { armor: NEXUS.armor, mr: NEXUS.mr, ms: 0 },
      stats: { maxHp: NEXUS.hp, armor: NEXUS.armor, mr: NEXUS.mr, ms: 0 }, vulnerable: false,
    });
  }

  createChampion(team, key) {
    const def = CHAMPION_DEFS[key];
    if (!def) throw new Error(`Unknown champion: ${key}`);
    const c = this.makeUnit({
      kind: 'champion', team, champ: key, def, name: def.name,
      x: teamX(team, LAYOUT.spawnX), y: 0, facing: team === 0 ? 0 : Math.PI, radius: 65,
      level: 1, xp: 0, gold: this.cfg.startGold, skillPoints: 1, ranks: { Q: 0, W: 0, E: 0, R: 0 },
      cds: { Q: 0, W: 0, E: 0, R: 0, D: 0, F: 0 }, items: [], order: null, nextAttackAt: 0,
      respawnAt: 0, hp: 1, mana: 0, kills: 0, deaths: 0, cs: 0, s: {}, lastDamagedAt: -99, lastCombatAt: -99,
      sheenReadyAt: 0, sheenArmed: false,
    });
    computeChampionStats(this, c);
    c.hp = c.stats.maxHp;
    c.mana = c.stats.maxMana;
    if (def.init) def.init(this, c);
    for (let l = 1; l < this.cfg.startLevel; l++) this.gainXp(c, XP_TABLE[l] - c.xp, true);
    computeChampionStats(this, c);
    c.hp = c.stats.maxHp;
    c.mana = c.stats.maxMana;
    this.champions[team] = c;
    if (this.cfg.autoLevel[team]) this.autoLevel(c);
    return c;
  }

  // ----------------------------------------------------- progression ----

  gainXp(c, amount, silent = false) {
    if (c.level >= MAX_LEVEL || amount <= 0) return;
    c.xp += amount;
    if (!silent) this.track(c.team, 'xp', amount);
    while (c.level < MAX_LEVEL && c.xp >= XP_TABLE[c.level]) {
      c.level++;
      c.skillPoints++;
      if (!silent) this.emit({ type: 'level_up', id: c.id, level: c.level });
    }
    if (this.cfg.autoLevel[c.team]) this.autoLevel(c);
  }

  canLevelSkill(c, slot) {
    if (c.skillPoints <= 0) return false;
    const r = c.ranks[slot];
    if (slot === 'R') return r < 3 && c.level >= 6 + 5 * r;
    return r < 5 && r < Math.ceil(c.level / 2);
  }

  levelSkill(c, slot) {
    if (!this.canLevelSkill(c, slot)) return false;
    c.ranks[slot]++;
    c.skillPoints--;
    this.emit({ type: 'skill_up', id: c.id, slot, rank: c.ranks[slot] });
    return true;
  }

  autoLevel(c) {
    let guard = 0;
    while (c.skillPoints > 0 && guard++ < 10) {
      let done = false;
      for (const s of c.def.firstSkills) {
        if (c.ranks[s] === 0 && this.levelSkill(c, s)) { done = true; break; }
      }
      if (done) continue;
      for (const s of ['R', ...c.def.maxOrder]) {
        if (this.levelSkill(c, s)) { done = true; break; }
      }
      if (!done) break;
    }
  }

  canShop(c) {
    if (!c.alive) return true;
    return Math.abs(c.x - teamX(c.team, LAYOUT.fountainX)) < LAYOUT.fountainHealRadius;
  }

  buy(c, itemId) {
    const it = ITEMS[itemId];
    if (!it || !this.canShop(c)) return false;
    const { price, used } = itemPrice(c.items, itemId);
    if (c.gold < price || c.items.length - used.length >= MAX_ITEMS) return false;
    c.gold -= price;
    c.items = c.items.filter((_, i) => !used.includes(i));
    c.items.push(itemId);
    computeChampionStats(this, c);
    this.emit({ type: 'buy', id: c.id, item: itemId });
    return true;
  }

  sell(c, index) {
    if (!this.canShop(c) || index < 0 || index >= c.items.length) return false;
    const id = c.items.splice(index, 1)[0];
    c.gold += Math.floor(ITEMS[id].cost * 0.7);
    computeChampionStats(this, c);
    return true;
  }

  autoBuy(c) {
    if (!this.canShop(c)) return;
    const build = c.def.build;
    c.buildIdx = c.buildIdx || 0;
    while (c.buildIdx < build.length && this.buy(c, build[c.buildIdx])) c.buildIdx++;
  }

  // ---------------------------------------------------------- commands ----

  /** Queue a command for a team's champion; applied at the start of the next tick. */
  command(team, cmd) {
    this.pending[team].push(cmd);
  }

  applyCommands() {
    for (const team of [0, 1]) {
      const q = this.pending[team];
      if (!q.length) continue;
      this.pending[team] = [];
      const c = this.champions[team];
      for (const cmd of q) {
        if (this.cfg.recordInputs) this.inputLog.push([this.tick, team, cmd]);
        this.execCommand(c, cmd);
      }
    }
  }

  execCommand(c, cmd) {
    switch (cmd.type) {
      case 'levelup': this.levelSkill(c, cmd.slot); return;
      case 'buy': this.buy(c, cmd.item); return;
      case 'sell': this.sell(c, cmd.index); return;
    }
    if (!c.alive) return;
    switch (cmd.type) {
      case 'move':
        c.order = { type: 'move', x: cmd.x, y: cmd.y };
        c.windup = null;
        break;
      case 'attack': {
        const t = this.byId.get(cmd.target);
        if (!t || t.team === c.team || !isTargetable(t)) return;
        if (!(c.windup && c.windup.target === t.id)) c.windup = null;
        c.order = { type: 'attack', target: t.id };
        break;
      }
      case 'attackmove':
        c.order = { type: 'attackmove', x: cmd.x, y: cmd.y, target: null };
        break;
      case 'stop':
        c.order = { type: 'stop' };
        c.windup = null;
        break;
      case 'cast':
        this.tryCast(c, cmd.slot, cmd);
        break;
    }
  }

  // ----------------------------------------------------------- casting ----

  abilityState(c, slot) {
    // Used by HUD / observations: { rank, ready, cdLeft, recast, cost }
    if (slot === 'D' || slot === 'F') {
      return { rank: 1, ready: this.time >= c.cds[slot], cdLeft: Math.max(0, c.cds[slot] - this.time), recast: false, cost: 0 };
    }
    const ab = c.def.abilities[slot];
    const rank = c.ranks[slot];
    const recast = !!(ab.canRecast && ab.canRecast(this, c));
    const cost = ab.cost && rank > 0 ? rankValue(ab.cost, rank) : 0;
    const cdLeft = Math.max(0, c.cds[slot] - this.time);
    const ready = rank > 0 && (recast || (cdLeft <= 0 && c.mana >= cost && !(ab.blocked && ab.blocked(this, c))));
    return { rank, ready, cdLeft, recast, cost };
  }

  tryCast(c, slot, ctx) {
    if (!c.alive || this.over) return false;
    const st = c.status;
    if (st.stun || st.airborne) return false;
    if (c.dash && !c.dash.allowCast) return false;
    if (slot === 'D' || slot === 'F') return this.castSummoner(c, slot, ctx);
    if (c.cast) return false;
    if (st.silence) return false;
    const ab = c.def.abilities[slot];
    if (!ab || c.ranks[slot] <= 0) return false;
    if (ab.canRecast && ab.canRecast(this, c)) return ab.recast(this, c, ctx) !== false;
    if (this.time < c.cds[slot]) return false;
    if (ab.blocked && ab.blocked(this, c)) return false;
    const rank = c.ranks[slot];
    const cost = ab.cost ? rankValue(ab.cost, rank) : 0;
    if (c.mana < cost) return false;

    let target = null;
    if (ab.targeting === 'unit') {
      target = this.byId.get(ctx.target);
      if (!target || target.team === c.team || !isTargetable(target)) return false;
      if (ab.champOnly && target.kind !== 'champion') return false;
      if (dist(c, target) - target.radius > ab.range) {
        c.order = { type: 'castTo', slot, target: target.id };
        c.windup = null;
        return true;
      }
    }
    let x = ctx.x ?? c.x + Math.cos(c.facing) * 100;
    let y = ctx.y ?? c.y + Math.sin(c.facing) * 100;
    if (target) { x = target.x; y = target.y; }
    if (ab.targeting !== 'self' && (x !== c.x || y !== c.y)) c.facing = Math.atan2(y - c.y, x - c.x);

    c.mana -= cost;
    if (!ab.manualCd) c.cds[slot] = this.time + cooldown(c, rankValue(ab.cd, rank));
    c.windup = null;
    if (c.order && c.order.type === 'castTo') c.order = null;
    const castCtx = { x, y, target, rank };
    this.emit({ type: 'cast', id: c.id, slot, x, y, target: target ? target.id : -1, castTime: ab.castTime || 0 });
    this.onAbilityUsed(c);
    if (ab.castTime > 0) {
      c.cast = { slot, end: this.time + ab.castTime, start: this.time, ctx: castCtx, ab, canMove: !!ab.canMove, uninterruptible: !!ab.uninterruptible };
    } else {
      ab.cast(this, c, castCtx);
    }
    return true;
  }

  onAbilityUsed(c) {
    if (c.items.some((id) => ITEMS[id].sheen) && this.time >= c.sheenReadyAt) c.sheenArmed = true;
  }

  castSummoner(c, slot, ctx) {
    if (this.time < c.cds[slot]) return false;
    const sp = SUMMONERS[slot];
    if (slot === 'D') {
      let dx = (ctx.x ?? c.x) - c.x, dy = (ctx.y ?? c.y) - c.y;
      let d = Math.hypot(dx, dy);
      if (d < 1) { dx = Math.cos(c.facing); dy = Math.sin(c.facing); d = 1; }
      const r = Math.min(d, sp.range);
      const from = { x: c.x, y: c.y };
      c.x += (dx / d) * r;
      c.y += (dy / d) * r;
      c.facing = Math.atan2(dy, dx);
      this.resolveStructures(c);
      clampToMap(c, 30);
      c.cds.D = this.time + sp.cd;
      this.emit({ type: 'flash', id: c.id, from, to: { x: c.x, y: c.y } });
      return true;
    }
    if (slot === 'F') {
      const t = this.byId.get(ctx.target);
      if (!t || t.kind !== 'champion' || t.team === c.team || !isTargetable(t)) return false;
      if (dist(c, t) - t.radius > sp.range) return false;
      const total = 70 + 20 * c.level;
      this.addDot(t, { name: 'ignite', src: c.id, total, duration: sp.duration, interval: 1, type: 'true' });
      addBuff(this, t, { name: 'ignite_gw', duration: sp.duration, grievous: true });
      c.cds.F = this.time + sp.cd;
      this.emit({ type: 'ignite', id: c.id, target: t.id });
      return true;
    }
    return false;
  }

  /** Damage-over-time. Same-name dots are refreshed. `stacks` multiplies damage. */
  addDot(u, dot) {
    const existing = u.dots.find((d) => d.name === dot.name);
    const d = { stacks: 1, ...dot, end: this.time + dot.duration, nextTick: this.time + dot.interval };
    if (existing) {
      Object.assign(existing, d, { nextTick: existing.nextTick });
      return existing;
    }
    u.dots.push(d);
    return d;
  }

  updateDots(u) {
    if (!u.dots.length) return;
    for (const d of u.dots) {
      while (u.alive && this.time >= d.nextTick && d.nextTick <= d.end + 1e-6) {
        const src = this.byId.get(d.src) || null;
        const per = (d.total * d.stacks * d.interval) / d.duration;
        dealDamage(this, src, u, per, d.type, { label: d.name, dot: true, noAggro: true });
        d.nextTick += d.interval;
      }
    }
    u.dots = u.dots.filter((d) => d.end > this.time && u.alive);
  }

  // ---------------------------------------------------------- movement ----

  resolveStructures(u) {
    for (const o of this.obstacles()) {
      const r = o.radius + u.radius * 0.8;
      const dx = u.x - o.x, dy = u.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1;
        u.x = o.x + (dx / d) * r;
        u.y = o.y + (dy / d) * r;
      }
    }
  }

  steer(u, dirx, diry, dTarget) {
    for (const o of this.obstacles()) {
      const r = o.radius + u.radius * 0.8 + 6;
      const cx = o.x - u.x, cy = o.y - u.y;
      const proj = cx * dirx + cy * diry;
      if (proj <= 0 || proj > dTarget + r) continue;
      let lx = cx - dirx * proj, ly = cy - diry * proj;
      const ld = Math.hypot(lx, ly);
      if (ld >= r) continue;
      let ax, ay;
      if (ld < 1e-3) { ax = diry; ay = -dirx; } else { ax = -lx / ld; ay = -ly / ld; }
      const px = o.x + ax * (r + 8) - u.x, py = o.y + ay * (r + 8) - u.y;
      const pd = Math.hypot(px, py) || 1;
      return [px / pd, py / pd];
    }
    return [dirx, diry];
  }

  /** Move a unit toward a point for one tick. Returns true when arrived. */
  moveToward(u, tx, ty, stopDist = 0) {
    if (u.status.root) return false;
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopDist + 0.5) return true;
    const step = u.stats.ms * DT;
    let nx = dx / d, ny = dy / d;
    [nx, ny] = this.steer(u, nx, ny, d);
    u.facing = Math.atan2(ny, nx);
    if (d - stopDist <= step) {
      u.x += nx * (d - stopDist);
      u.y += ny * (d - stopDist);
    } else {
      u.x += nx * step;
      u.y += ny * step;
    }
    this.resolveStructures(u);
    clampToMap(u, u.kind === 'champion' ? 30 : u.radius);
    return d - stopDist <= step;
  }

  /**
   * Start a dash / forced movement.
   * opts: { speed, x, y, target (homing id), stopDist, airborne, onEnd, allowCast, ignoreTerrain }
   */
  startDash(u, opts) {
    interrupt(this, u);
    u.dash = { stopDist: 0, ...opts };
    this.emit({ type: 'dash', id: u.id, x: opts.x, y: opts.y, speed: opts.speed, name: opts.name || null });
  }

  stepDash(u) {
    const d0 = u.dash;
    let tx = d0.x, ty = d0.y;
    if (d0.target != null) {
      const t = this.byId.get(d0.target);
      if (t && t.alive) { tx = t.x; ty = t.y; d0.x = tx; d0.y = ty; }
    }
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    const step = d0.speed * DT;
    if (d > 1e-3 && !d0.keepFacing) u.facing = Math.atan2(dy, dx);
    let arrived = false;
    if (d - d0.stopDist <= step) {
      if (d > 1e-3) {
        const k = Math.max(0, d - d0.stopDist) / d;
        u.x += dx * k;
        u.y += dy * k;
      }
      arrived = true;
    } else {
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
    }
    const before = { x: u.x, y: u.y };
    clampToMap(u, u.kind === 'champion' ? 30 : u.radius);
    if (!d0.ignoreStructures) this.resolveStructures(u);
    if (Math.abs(before.x - u.x) + Math.abs(before.y - u.y) > 1 && !d0.slideWalls) arrived = true;
    if (d0.maxTime != null && this.time >= d0.maxTime) arrived = true;
    if (d0.onStep) {
      const stop = d0.onStep(u);
      if (stop) arrived = true;
    }
    if (arrived && u.dash === d0) {
      u.dash = null;
      if (d0.onEnd) d0.onEnd(u);
    }
  }

  // ----------------------------------------------------------- attacks ----

  inAttackRange(u, t, extra = 0) {
    return dist(u, t) <= u.stats.range + u.radius + t.radius + extra;
  }

  canAttackNow(c) {
    if (c.status.disarm || c.status.stun || c.status.airborne) return false;
    if (c.def && c.def.cannotAttack && c.def.cannotAttack(this, c)) return false;
    return this.time >= c.nextAttackAt;
  }

  startAttack(u, t) {
    const at = 1 / u.stats.as;
    const windup = at * (u.kind === 'champion' ? u.def.base.windup : u.base.windup);
    u.windup = { target: t.id, hitAt: this.time + windup, start: this.time, duration: windup };
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    this.emit({ type: 'attack_start', id: u.id, target: t.id, windup, attackTime: at });
  }

  finishAttack(u, t) {
    u.nextAttackAt = u.windup ? u.windup.start + 1 / u.stats.as : this.time + 1 / u.stats.as;
    u.windup = null;
    if (u.kind === 'champion') this.championAttackHit(u, t);
    else this.minionAttackHit(u, t);
  }

  championAttackHit(c, t) {
    const ctx = { dmg: c.stats.ad, type: 'physical', extra: [], after: [], label: null };
    if (c.def.onAttack) c.def.onAttack(this, c, t, ctx);
    if (c.sheenArmed && this.time >= c.sheenReadyAt && t.kind !== 'tower' && t.kind !== 'nexus') {
      ctx.extra.push({ amount: c.stats.baseAd * 2, type: 'physical', label: 'sheen' });
      c.sheenArmed = false;
      c.sheenReadyAt = this.time + 1.5;
    }
    if (t.kind === 'champion' && c.items.some((id) => ITEMS[id].cleave)) {
      const b = getBuff(t, 'cleaver');
      const stacks = Math.min(6, (b ? b.stacks : 0) + 1);
      addBuff(this, t, { name: 'cleaver', duration: 6, armorRedPct: 0.05 * stacks, stacks });
    }
    this.emit({ type: 'attack_hit', id: c.id, target: t.id, label: ctx.label });
    dealDamage(this, c, t, ctx.dmg, ctx.type, { attack: true, label: ctx.label });
    for (const e of ctx.extra) if (t.alive) dealDamage(this, c, t, e.amount, e.type, { attack: true, label: e.label, proc: true });
    for (const f of ctx.after) f();
  }

  minionAttackHit(m, t) {
    const b = m.base;
    let dmg = m.stats.ad;
    if (t.kind === 'tower' || t.kind === 'nexus') dmg *= TOWER.minionDamageMult;
    if (b.projectileSpeed) {
      this.spawnProjectile({ kind: m.mtype, src: m.id, srcTeam: m.team, target: t.id, x: m.x, y: m.y, speed: b.projectileSpeed, dmg, dmgType: 'physical', z: 60 });
    } else {
      this.emit({ type: 'attack_hit', id: m.id, target: t.id });
      dealDamage(this, m, t, dmg, 'physical', { attack: true });
    }
  }

  spawnProjectile(p) {
    p.id = this.nextId++;
    this.projectiles.push(p);
    this.emit({ type: 'proj_spawn', id: p.id, kind: p.kind, src: p.src });
    return p;
  }

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      const t = this.byId.get(p.target);
      if (!t || !t.alive) { this.emit({ type: 'proj_end', id: p.id }); continue; }
      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * DT;
      if (d <= step + t.radius * 0.3) {
        const src = this.byId.get(p.src) || null;
        this.emit({ type: 'proj_hit', id: p.id, kind: p.kind, target: t.id, x: t.x, y: t.y });
        if (p.onHit) p.onHit(t, src);
        else dealDamage(this, src, t, p.dmg, p.dmgType, { attack: true, label: p.kind });
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  // ------------------------------------------------------------ deaths ----

  killXp(level) {
    return 140 + 45 * (level - 1);
  }

  handleDeath(u, src) {
    if (!u.alive) return;
    u.alive = false;
    u.diedAt = this.time;
    u.windup = null;
    u.cast = null;
    u.dash = null;
    this.emit({ type: 'death', id: u.id, kind: u.kind, killer: src ? src.id : -1 });
    const enemyChamp = this.champions[1 - u.team];

    if (u.kind === 'champion') {
      u.deaths++;
      u.respawnAt = this.time + this.cfg.respawnBase + this.cfg.respawnPerLevel * u.level;
      u.buffs = [];
      u.dots = [];
      u.shields = [];
      u.order = null;
      this.track(u.team, 'deaths', 1);
      if (u.def.onDeath) u.def.onDeath(this, u);
      const killer = enemyChamp;
      if (killer) {
        const g = 300 + (this.firstBlood ? 0 : 100);
        this.firstBlood = true;
        killer.gold += g;
        killer.kills++;
        this.track(killer.team, 'gold', g);
        this.track(killer.team, 'kills', 1);
        this.gainXp(killer, this.killXp(u.level));
        this.emit({ type: 'gold', id: killer.id, amount: g, x: u.x, y: u.y });
      }
    } else if (u.kind === 'minion') {
      const mdef = MINIONS[u.mtype];
      if (enemyChamp && enemyChamp.alive && dist(enemyChamp, u) <= this.cfg.minionXpRange) this.gainXp(enemyChamp, mdef.xp);
      if (src && src.kind === 'champion' && src.team !== u.team) {
        src.gold += mdef.gold;
        src.cs++;
        this.track(src.team, 'gold', mdef.gold);
        this.track(src.team, 'lastHits', 1);
        this.emit({ type: 'gold', id: src.id, amount: mdef.gold, x: u.x, y: u.y });
      }
    } else if (u.kind === 'tower') {
      this.track(u.team, 'towersLost', 1);
      if (enemyChamp) {
        enemyChamp.gold += 250;
        this.track(enemyChamp.team, 'gold', 250);
        this.track(enemyChamp.team, 'towerKills', 1);
        this.emit({ type: 'gold', id: enemyChamp.id, amount: 250, x: u.x, y: u.y });
      }
      this.updateVulnerability();
    } else if (u.kind === 'nexus') {
      this.over = true;
      this.winner = 1 - u.team;
      this.emit({ type: 'game_over', winner: this.winner });
    }
  }

  respawn(c) {
    c.alive = true;
    c.x = teamX(c.team, LAYOUT.spawnX);
    c.y = 0;
    c.facing = c.team === 0 ? 0 : Math.PI;
    c.buffs = [];
    c.dots = [];
    c.shields = [];
    c.order = null;
    c.windup = null;
    c.cast = null;
    c.dash = null;
    c.s = {};
    if (c.def.init) c.def.init(this, c);
    refreshStatus(this, c);
    computeChampionStats(this, c);
    c.hp = c.stats.maxHp;
    c.mana = c.stats.maxMana;
    this.emit({ type: 'respawn', id: c.id });
  }

  updateVulnerability() {
    for (const team of [0, 1]) {
      const [nt, inner, outer] = this.towers[team];
      outer.vulnerable = outer.alive;
      inner.vulnerable = inner.alive && !outer.alive;
      nt.vulnerable = nt.alive && !inner.alive;
      this.nexus[team].vulnerable = this.nexus[team].alive && !nt.alive;
    }
  }

  /** Enemy champion damaged an allied champion: towers & minions retaliate. */
  callForHelp(attacker, victim) {
    if (attacker.kind !== 'champion') return;
    for (const tw of this.towers[victim.team]) {
      if (!tw.alive) continue;
      if (dist(tw, attacker) <= tw.stats.range + attacker.radius && dist(tw, victim) <= tw.stats.range + victim.radius + 200) {
        if (tw.target !== attacker.id) {
          tw.target = attacker.id;
          tw.forced = true;
          this.emit({ type: 'tower_aggro', id: tw.id, target: attacker.id });
        }
      }
    }
    for (const m of this.units) {
      if (m.kind !== 'minion' || !m.alive || m.team !== victim.team) continue;
      if (dist2(m, victim) < 900 * 900 && dist2(m, attacker) < 800 * 800) {
        m.target = attacker.id;
        m.forcedUntil = this.time + 2.5;
      }
    }
  }

  // ------------------------------------------------------------- waves ----

  spawnWave() {
    this.waveCount++;
    const minutes = this.time / 60;
    const types = ['melee', 'melee', 'melee', 'caster', 'caster', 'caster'];
    if (this.waveCount % this.cfg.cannonEvery === 0) types.splice(3, 0, 'cannon');
    for (const team of [0, 1]) {
      const dir = team === 0 ? 1 : -1;
      types.forEach((mt, i) => {
        const d = MINIONS[mt];
        const k = Math.floor(this.time / 90);
        const hp = d.hp + d.hpPer90s * k;
        const laneY = ((i % 3) - 1) * 70 + this.rng.range(-15, 15);
        const back = mt === 'melee' ? 0 : mt === 'cannon' ? 140 : 260;
        this.makeUnit({
          kind: 'minion', mtype: mt, team, x: teamX(team, LAYOUT.minionSpawnX) - dir * (back + (i % 3) * 30), y: laneY,
          laneY, radius: d.radius, hp, facing: dir > 0 ? 0 : Math.PI,
          base: { armor: d.armor, mr: d.mr, ms: d.ms, windup: d.windup, projectileSpeed: d.projectileSpeed },
          stats: { maxHp: hp, ad: d.ad + d.adPer90s * k, as: d.as, range: d.range, armor: d.armor, mr: d.mr, ms: d.ms },
          target: null, nextAttackAt: 0, nextAcquireAt: 0, forcedUntil: 0, minutes,
        });
      });
    }
    this.emit({ type: 'wave', n: this.waveCount });
  }

  minionAcquire(m) {
    let best = null, bestScore = Infinity;
    const acq = 750;
    for (const u of this.units) {
      if (u.team === m.team || !isTargetable(u)) continue;
      const d = dist(m, u) - u.radius;
      if (d > acq) continue;
      let tier = 0;
      if (u.kind === 'minion') tier = 0;
      else if (u.kind === 'champion') tier = 1;
      else tier = 2;
      const score = tier * 10000 + d;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }

  updateMinion(m) {
    refreshStatus(this, m);
    this.updateDots(m);
    if (!m.alive) return;
    if (m.dash) { this.stepDash(m); return; }
    const st = m.status;
    if (st.stun || st.airborne) return;
    if (m.windup) {
      const t = this.byId.get(m.windup.target);
      if (!t || !isTargetable(t)) m.windup = null;
      else if (this.time >= m.windup.hitAt) this.finishAttack(m, t);
      return;
    }
    let t = m.target != null ? this.byId.get(m.target) : null;
    if (t && (!isTargetable(t) || dist(m, t) > 1100 || (t.kind === 'champion' && this.time > m.forcedUntil && this.time >= m.nextAcquireAt))) t = null;
    if (!t && this.time >= m.nextAcquireAt) {
      t = this.minionAcquire(m);
      m.nextAcquireAt = this.time + 0.25;
    }
    m.target = t ? t.id : null;
    if (t) {
      if (this.inAttackRange(m, t)) {
        m.facing = Math.atan2(t.y - m.y, t.x - m.x);
        if (this.time >= m.nextAttackAt) this.startAttack(m, t);
      } else {
        this.moveToward(m, t.x, t.y, m.stats.range + m.radius + t.radius - 10);
      }
      return;
    }
    const dir = m.team === 0 ? 1 : -1;
    const ty = m.y + (m.laneY - m.y) * 0.5;
    this.moveToward(m, m.x + dir * 300, ty);
  }

  separateMinions() {
    const ms = this.units.filter((u) => u.kind === 'minion' && u.alive && !u.dash);
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        const r = (a.radius + b.radius) * 0.85;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (r - d) * 0.5;
        const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
        const aw = a.windup ? 0.2 : 1, bw = b.windup ? 0.2 : 1;
        a.x -= nx * push * aw; a.y -= ny * push * aw;
        b.x += nx * push * bw; b.y += ny * push * bw;
      }
    }
    for (const m of ms) clampToMap(m, m.radius);
  }

  // ------------------------------------------------------------ towers ----

  updateTower(tw) {
    if (!tw.alive) return;
    let t = tw.target != null ? this.byId.get(tw.target) : null;
    const inRange = (u) => u && isTargetable(u) && dist(tw, u) <= tw.stats.range + u.radius;
    if (!inRange(t)) { t = null; tw.forced = false; }
    if (!t) {
      let best = null, bestD = Infinity;
      for (const pass of [0, 1]) {
        for (const u of this.units) {
          if (u.team === tw.team || (pass === 0 ? u.kind !== 'minion' : u.kind !== 'champion')) continue;
          if (!inRange(u)) continue;
          const d = dist2(tw, u);
          if (d < bestD) { bestD = d; best = u; }
        }
        if (best) break;
      }
      t = best;
      if (t) this.emit({ type: 'tower_target', id: tw.id, target: t.id });
    }
    tw.target = t ? t.id : null;
    if (!t || this.time < tw.nextShotAt) return;
    tw.nextShotAt = this.time + 1 / TOWER.as;
    if (t.kind === 'champion') {
      tw.warm = tw.lastChampTarget === t.id ? Math.min(TOWER.warmupMax, tw.warm + TOWER.warmupPerShot) : 0;
      tw.lastChampTarget = t.id;
    } else {
      tw.lastChampTarget = -1;
      tw.warm = 0;
    }
    const ad = (TOWER.ad + TOWER.adPerMin * (this.time / 60)) * (1 + tw.warm);
    this.spawnProjectile({
      kind: 'tower', src: tw.id, srcTeam: tw.team, target: t.id, x: tw.x, y: tw.y, z: 520, speed: TOWER.projectileSpeed,
      onHit: (tgt) => {
        if (tgt.kind === 'minion') dealDamage(this, tw, tgt, tgt.stats.maxHp * TOWER.vsMinionPct[tgt.mtype], 'true', { label: 'tower' });
        else dealDamage(this, tw, tgt, ad, 'physical', { label: 'tower' });
      },
    });
  }

  updateFountains() {
    this.fountainTick++;
    for (const team of [0, 1]) {
      const fx = teamX(team, LAYOUT.fountainX);
      for (const c of this.champions) {
        if (!c.alive) continue;
        const d = Math.hypot(c.x - fx, c.y);
        if (c.team === team && d < LAYOUT.fountainHealRadius) {
          c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.maxHp * 0.12 * DT);
          c.mana = Math.min(c.stats.maxMana, c.mana + c.stats.maxMana * 0.12 * DT);
        } else if (c.team !== team && d < LAYOUT.fountainLaserRange && this.fountainTick % 8 === 0) {
          dealDamage(this, this.nexus[team], c, 450, 'true', { label: 'fountain' });
          this.emit({ type: 'fountain_shot', team, target: c.id });
        }
      }
    }
  }

  updateRelics() {
    for (const r of this.relics) {
      if (this.time < r.availableAt) continue;
      for (const c of this.champions) {
        if (!c.alive || Math.hypot(c.x - r.x, c.y - r.y) > RELIC.radius + c.radius) continue;
        const h = heal(this, c, RELIC.healFlat + RELIC.healPct * c.stats.maxHp);
        if (c.stats.maxMana) c.mana = Math.min(c.stats.maxMana, c.mana + 0.08 * c.stats.maxMana);
        this.track(c.team, 'healed', h);
        r.availableAt = this.time + RELIC.respawn;
        this.emit({ type: 'relic', id: r.id, by: c.id, x: r.x, y: r.y });
        break;
      }
    }
  }

  // --------------------------------------------------------- champions ----

  updateChampion(c) {
    if (!c.alive) {
      if (this.time >= c.respawnAt) this.respawn(c);
      else {
        if (this.cfg.autoBuy[c.team]) this.autoBuy(c);
        return;
      }
    }
    refreshStatus(this, c);
    computeChampionStats(this, c);
    if (this.cfg.autoBuy[c.team]) this.autoBuy(c);
    if (c.stats.hpRegen) c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.hpRegen * DT);
    if (c.stats.maxMana) c.mana = Math.min(c.stats.maxMana, c.mana + c.stats.manaRegen * DT);
    this.updateDots(c);
    if (!c.alive) return;
    if (c.items.some((id) => ITEMS[id].immolate) && this.tick % 15 === 0) {
      for (const u of this.units) {
        if (u.team !== c.team && u.alive && (u.kind === 'minion' || u.kind === 'champion') && dist(u, c) < 325 + u.radius) {
          dealDamage(this, c, u, (12 + c.level) * 0.5 * (u.kind === 'minion' ? 1.5 : 1), 'magic', { label: 'sunfire', noAggro: true });
        }
      }
    }
    if (c.def.update) c.def.update(this, c);
    if (!c.alive) return;

    if (c.cast && this.time >= c.cast.end) {
      const k = c.cast;
      c.cast = null;
      if (!c.status.stun && !c.status.airborne) k.ab.cast(this, c, k.ctx);
    }
    if (c.dash) { this.stepDash(c); return; }
    const st = c.status;
    if (st.stun || st.airborne) return;
    if (c.cast && !c.cast.canMove) return;

    if (c.windup) {
      const t = this.byId.get(c.windup.target);
      if (!t || !isTargetable(t) || !this.inAttackRange(c, t, 250)) c.windup = null;
      else if (this.time >= c.windup.hitAt) this.finishAttack(c, t);
      else return;
    }
    this.processOrder(c);
  }

  autoAcquire(c, radius) {
    let best = null, bestD = Infinity;
    for (const u of this.units) {
      if (u.team === c.team || !isTargetable(u)) continue;
      const d = dist(c, u) - u.radius;
      if (d > radius) continue;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  /** Close in on an attack target, aiming slightly inside max range so a moving target doesn't drift back out. */
  chase(c, t) {
    const slack = Math.min(40, c.stats.range * 0.3);
    this.moveToward(c, t.x, t.y, c.stats.range + c.radius + t.radius - slack);
  }

  tryAttack(c, t) {
    c.facing = Math.atan2(t.y - c.y, t.x - c.x);
    if (this.canAttackNow(c) && !c.windup) this.startAttack(c, t);
  }

  processOrder(c) {
    const o = c.order;
    if (!o || o.type === 'stop') {
      if (this.cfg.autoAttack && !c.passive && this.canAttackNow(c) && !(c.cast && c.cast.canMove)) {
        const t = this.autoAcquire(c, c.stats.range + c.radius);
        if (t && !(o && o.type === 'stop')) this.tryAttack(c, t);
      }
      return;
    }
    switch (o.type) {
      case 'move':
        if (this.moveToward(c, o.x, o.y)) c.order = null;
        break;
      case 'attack': {
        const t = this.byId.get(o.target);
        if (!t || !isTargetable(t)) { c.order = null; break; }
        const blocked = c.def.cannotAttack && c.def.cannotAttack(this, c);
        if (this.inAttackRange(c, t)) {
          if (!blocked) this.tryAttack(c, t);
          else this.moveToward(c, t.x, t.y, c.radius + t.radius);
        } else {
          this.chase(c, t);
          if (!blocked && this.inAttackRange(c, t)) this.tryAttack(c, t);
        }
        break;
      }
      case 'attackmove': {
        let t = o.target != null ? this.byId.get(o.target) : null;
        if (!t || !isTargetable(t)) {
          t = this.autoAcquire(c, c.stats.range + c.radius + 350);
          o.target = t ? t.id : null;
        }
        if (t) {
          if (!this.inAttackRange(c, t)) this.chase(c, t);
          if (this.inAttackRange(c, t)) this.tryAttack(c, t);
        } else if (this.moveToward(c, o.x, o.y)) c.order = null;
        break;
      }
      case 'castTo': {
        const t = this.byId.get(o.target);
        if (!t || !isTargetable(t)) { c.order = null; break; }
        const ab = c.def.abilities[o.slot];
        if (dist(c, t) - t.radius <= ab.range) {
          c.order = null;
          this.tryCast(c, o.slot, { target: t.id, x: t.x, y: t.y });
        } else this.moveToward(c, t.x, t.y, ab.range + t.radius - 10);
        break;
      }
    }
  }

  // -------------------------------------------------------------- step ----

  step() {
    if (this.over) return;
    this.tick++;
    this.time = this.tick * DT;

    if (this.time >= this.nextWaveAt) {
      this.spawnWave();
      this.nextWaveAt += this.cfg.waveInterval;
    }
    for (const b of this.bots) if (b) b.update();
    this.applyCommands();

    if (this.time > this.cfg.firstWaveTime) {
      for (const c of this.champions) {
        const g = this.cfg.passiveGoldPerSec * DT;
        c.gold += g;
      }
    }

    for (const c of this.champions) this.updateChampion(c);
    for (const u of this.units) if (u.kind === 'minion' && u.alive) this.updateMinion(u);
    this.separateMinions();
    for (const team of [0, 1]) {
      for (const tw of this.towers[team]) {
        if (tw.alive) refreshStatus(this, tw);
        this.updateTower(tw);
      }
      const nx = this.nexus[team];
      if (nx.alive) nx.hp = Math.min(nx.stats.maxHp, nx.hp + NEXUS.regen * DT);
    }
    this.updateFountains();
    this.updateRelics();
    this.updateProjectiles();

    if (this.tick % 30 === 0) {
      const alive = [];
      for (const u of this.units) {
        if (u.alive || u.kind !== 'minion' || this.time - u.diedAt < 3) alive.push(u);
        else this.byId.delete(u.id);
      }
      this.units = alive;
    }
    if (!this.over && this.time >= this.cfg.maxGameTime) {
      this.over = true;
      this.timeout = true;
      const score = (t) => this.towers[t].reduce((s, tw) => s + (tw.alive ? tw.hp : 0), 0) + this.nexus[t].hp;
      const s0 = score(0), s1 = score(1);
      this.winner = s0 === s1 ? -1 : s0 > s1 ? 0 : 1;
      this.emit({ type: 'game_over', winner: this.winner, timeout: true });
    }
  }

  // ----------------------------------------------------------- replays ----

  exportReplay(meta = {}) {
    const cfg = { ...this.cfg };
    delete cfg.controllers;
    return {
      version: 1,
      seed: this.seed,
      config: cfg,
      ticks: this.tick,
      winner: this.winner,
      inputs: this.inputLog,
      meta,
    };
  }

  /** Serializable snapshot of the full state (debugging / custom observation builders). */
  snapshot() {
    const unit = (u) => ({
      id: u.id, kind: u.kind, team: u.team, x: u.x, y: u.y, hp: u.hp, maxHp: u.stats.maxHp, alive: u.alive,
      ...(u.kind === 'minion' ? { mtype: u.mtype, target: u.target } : {}),
      ...(u.kind === 'tower' ? { tier: u.tier, target: u.target, vulnerable: u.vulnerable } : {}),
      ...(u.kind === 'champion' ? {
        champ: u.champ, level: u.level, xp: u.xp, gold: u.gold, mana: u.mana, maxMana: u.stats.maxMana,
        ranks: u.ranks, items: u.items, kills: u.kills, deaths: u.deaths, cs: u.cs, facing: u.facing,
        abilities: Object.fromEntries(['Q', 'W', 'E', 'R', 'D', 'F'].map((s) => [s, this.abilityState(u, s)])),
        buffs: u.buffs.map((b) => ({ name: b.name, left: b.end - this.time })),
        stats: { ...u.stats },
      } : {}),
    });
    return {
      tick: this.tick, time: this.time, over: this.over, winner: this.winner,
      units: this.units.filter((u) => u.alive || u.kind !== 'minion').map(unit),
      projectiles: this.projectiles.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, target: p.target })),
    };
  }
}

export function replayGame(replay) {
  const g = new Game({ ...replay.config, seed: replay.seed, controllers: ['replay', 'replay'] });
  let idx = 0;
  const inputs = replay.inputs;
  g.replayStep = () => {
    const nextTick = g.tick + 1;
    while (idx < inputs.length && inputs[idx][0] < nextTick) idx++;
    while (idx < inputs.length && inputs[idx][0] === nextTick) {
      const [, team, cmd] = inputs[idx++];
      g.command(team, cmd);
    }
    g.step();
  };
  return g;
}

export { TICK_RATE, DT, clamp, MAP_LENGTH };
