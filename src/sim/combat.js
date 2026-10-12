import { growth } from './util.js';
import { ITEMS } from './data.js';

// ---------------------------------------------------------------- buffs ----

const CC_KEYS = ['stun', 'root', 'silence', 'slow', 'disarm'];

/**
 * Add (or refresh, by name) a timed buff/debuff.
 * Recognized fields: stun, root, silence, airborne, disarm, slow (0..1), slowDecay,
 * msPct, msFlat, asPct, adFlat, armorRedPct, dr, tenacity, untargetable, grievous, ghost.
 */
export function addBuff(game, u, buff) {
  if (!u.alive) return null;
  let dur = buff.duration;
  if (!buff.noTenacity && CC_KEYS.some((k) => buff[k])) dur *= 1 - (u.status.tenacity || 0);
  const b = { ...buff, start: game.time, end: game.time + dur, duration: dur };
  const i = u.buffs.findIndex((x) => x.name === buff.name);
  if (i >= 0) u.buffs[i] = b;
  else u.buffs.push(b);
  if (buff.stun || buff.airborne) interrupt(game, u);
  if (CC_KEYS.some((k) => buff[k]) || buff.airborne) {
    game.emit({ type: 'cc', id: u.id, name: buff.name, duration: dur });
  }
  refreshStatus(game, u);
  return b;
}

export function removeBuff(u, name) {
  const i = u.buffs.findIndex((x) => x.name === name);
  if (i >= 0) u.buffs.splice(i, 1);
}

export function getBuff(u, name) {
  for (const b of u.buffs) if (b.name === name) return b;
  return null;
}

/** Cancel attack windups and interruptible casts. */
export function interrupt(game, u) {
  u.windup = null;
  if (u.cast && !u.cast.uninterruptible) {
    game.emit({ type: 'cast_cancel', id: u.id, slot: u.cast.slot });
    u.cast = null;
  }
}

/** Expire buffs and recompute the aggregated status flags / modifiers. */
export function refreshStatus(game, u) {
  const t = game.time;
  const s = {
    stun: false, root: false, silence: false, airborne: false, disarm: false, untargetable: false, ghost: false,
    slow: 0, msPct: 0, msFlat: 0, asPct: 0, adFlat: 0, armorRedPct: 0, dr: 0, tenacity: 0, grievous: false,
  };
  let keep = 0;
  for (let i = 0; i < u.buffs.length; i++) {
    const b = u.buffs[i];
    if (b.end <= t) continue;
    u.buffs[keep++] = b;
    if (b.stun) s.stun = true;
    if (b.root) s.root = true;
    if (b.silence) s.silence = true;
    if (b.airborne) s.airborne = true;
    if (b.disarm) s.disarm = true;
    if (b.untargetable) s.untargetable = true;
    if (b.ghost) s.ghost = true;
    if (b.grievous) s.grievous = true;
    if (b.slow) {
      const v = b.slowDecay ? b.slow * ((b.end - t) / b.duration) : b.slow;
      if (v > s.slow) s.slow = v;
    }
    if (b.msPct) s.msPct += b.msPctDecay ? b.msPct * ((b.end - t) / b.duration) : b.msPct;
    if (b.msFlat) s.msFlat += b.msFlat;
    if (b.asPct) s.asPct += b.asPct;
    if (b.adFlat) s.adFlat += b.adFlat;
    if (b.armorRedPct) s.armorRedPct = Math.max(s.armorRedPct, b.armorRedPct);
    if (b.dr) s.dr = Math.max(s.dr, b.dr);
    if (b.tenacity) s.tenacity = Math.max(s.tenacity, b.tenacity);
  }
  u.buffs.length = keep;
  u.status = s;
  if (u.kind !== 'champion') {
    // Minions / structures: apply modifiers on top of static base stats.
    const st = u.stats;
    st.armor = u.base.armor * (1 - s.armorRedPct);
    st.mr = u.base.mr;
    st.ms = applyMoveSpeed(u.base.ms || 0, 0, s);
  }
}

export function applyMoveSpeed(base, flat, s) {
  let ms = (base + flat + s.msFlat) * (1 + s.msPct) * (1 - s.slow);
  if (ms > 490) ms = ms * 0.5 + 230;
  else if (ms > 415) ms = ms * 0.8 + 83;
  else if (ms < 220) ms = ms * 0.5 + 110;
  return ms;
}

// ---------------------------------------------------------------- stats ----

export function computeChampionStats(game, c) {
  const b = c.def.base;
  const L = c.level;
  const s = c.status;
  const it = { ad: 0, hp: 0, armor: 0, mr: 0, as: 0, ms: 0, haste: 0, adBasePct: 0, attackDr: 0, healAmp: 0 };
  for (const id of c.items) {
    const d = ITEMS[id];
    for (const k in it) if (d[k]) it[k] += d[k];
  }
  const baseAd = growth(b.ad, b.adG, L);
  const ad = baseAd * (1 + it.adBasePct) + it.ad + s.adFlat + (c.extraAd || 0);
  const maxHp = growth(b.hp, b.hpG, L) + it.hp;
  const asBonus = growth(0, b.asG, L) + it.as + s.asPct;
  const st = c.stats;
  const oldMax = st.maxHp || maxHp;
  st.baseAd = baseAd;
  st.ad = ad;
  st.bonusAd = ad - baseAd;
  st.maxHp = maxHp;
  st.armor = (growth(b.armor, b.armorG, L) + it.armor + (c.extraArmor || 0)) * (1 - s.armorRedPct);
  st.mr = growth(b.mr, b.mrG, L) + it.mr + (c.extraMr || 0);
  st.as = Math.min(2.5, b.as * (1 + asBonus));
  st.range = b.range;
  st.ms = applyMoveSpeed(b.ms, it.ms, s);
  st.haste = it.haste;
  st.hpRegen = growth(b.hpRegen, b.hpRegenG, L);
  st.maxMana = b.mana ? growth(b.mana, b.manaG, L) : 0;
  st.manaRegen = b.mana ? growth(b.manaRegen, b.manaRegenG, L) : 0;
  st.tenacity = s.tenacity;
  st.dr = s.dr;
  st.attackDr = it.attackDr;
  st.healAmp = it.healAmp;
  st.armorPenPct = c.armorPenPct || 0;
  if (maxHp > oldMax && c.alive) c.hp += maxHp - oldMax;
  if (c.hp > maxHp) c.hp = maxHp;
  if (c.mana > st.maxMana) c.mana = st.maxMana;
}

export function cooldown(c, base) {
  const h = c.stats.haste || 0;
  return (base * 100) / (100 + h);
}

// --------------------------------------------------------------- damage ----

export function mitigationMult(src, tgt, type) {
  if (type === 'true') return 1;
  let res = type === 'physical' ? tgt.stats.armor : tgt.stats.mr;
  if (res > 0 && type === 'physical' && src && src.stats && src.stats.armorPenPct) res *= 1 - src.stats.armorPenPct;
  return res >= 0 ? 100 / (100 + res) : 2 - 100 / (100 - res);
}

export function isTargetable(u) {
  if (!u || !u.alive) return false;
  if (u.status && u.status.untargetable) return false;
  if (u.kind === 'tower' || u.kind === 'nexus') return u.vulnerable;
  return true;
}

/**
 * Apply damage from src to tgt. Returns the HP actually removed (post-mitigation).
 * opts: { attack, ability, label, noAggro, noHooks }
 */
export function dealDamage(game, src, tgt, raw, type, opts = {}) {
  if (!tgt.alive || raw <= 0) return 0;
  if (tgt.invulnerable) return 0;
  let amount = raw * mitigationMult(src, tgt, type);
  if (tgt.kind === 'champion') {
    if (tgt.stats.dr) amount *= 1 - tgt.stats.dr;
    if (opts.attack && tgt.stats.attackDr) amount *= 1 - tgt.stats.attackDr;
  }
  if (!opts.noHooks && tgt.def && tgt.def.onTakeDamage) amount = tgt.def.onTakeDamage(game, tgt, src, amount, type, opts);
  // shields
  let absorbed = 0;
  if (tgt.shields && tgt.shields.length) {
    for (const sh of tgt.shields) {
      if (sh.end <= game.time || sh.amount <= 0) continue;
      const a = Math.min(sh.amount, amount - absorbed);
      sh.amount -= a;
      absorbed += a;
      if (absorbed >= amount) break;
    }
    tgt.shields = tgt.shields.filter((sh) => sh.amount > 0.01 && sh.end > game.time);
  }
  const dmg = amount - absorbed;
  tgt.hp -= dmg;
  tgt.lastDamagedAt = game.time;
  if (src) {
    tgt.lastDamagedBy = src.id;
    if (src.kind === 'champion' || src.kind === 'tower') tgt.lastHitByChampOrTowerAt = game.time;
  }
  game.emit({
    type: 'damage', src: src ? src.id : -1, tgt: tgt.id, amount: dmg, absorbed, dmgType: type,
    attack: !!opts.attack, label: opts.label || null,
  });
  if (src && src.kind === 'champion') {
    src.stats_dealt = (src.stats_dealt || 0) + dmg;
    if (tgt.kind === 'champion') {
      game.track(src.team, 'dmgToChamp', dmg + absorbed);
      game.track(tgt.team, 'dmgTakenChamp', dmg + absorbed);
      src.lastCombatAt = game.time;
      tgt.lastCombatAt = game.time;
      if (!opts.noAggro) game.callForHelp(src, tgt);
    } else if (tgt.kind === 'tower' || tgt.kind === 'nexus') {
      game.track(src.team, 'dmgToStructure', dmg);
    }
  }
  if (tgt.kind === 'champion' && src && src.kind !== 'champion') game.track(tgt.team, 'dmgTakenOther', dmg);
  if (!opts.noHooks && src && src.def && src.def.onDealDamage) src.def.onDealDamage(game, src, tgt, dmg + absorbed, type, opts);
  if (tgt.hp <= 0) {
    tgt.hp = 0;
    game.handleDeath(tgt, src);
  }
  return dmg;
}

export function heal(game, u, amount, src = null) {
  if (!u.alive || amount <= 0) return 0;
  let a = amount;
  if (u.status.grievous) a *= 0.6;
  if (u.stats.healAmp) a *= 1 + u.stats.healAmp;
  const before = u.hp;
  u.hp = Math.min(u.stats.maxHp, u.hp + a);
  const healed = u.hp - before;
  if (healed > 1) game.emit({ type: 'heal', tgt: u.id, amount: healed });
  return healed;
}

export function addShield(game, u, amount, duration, name) {
  u.shields = u.shields.filter((s) => s.name !== name);
  u.shields.push({ amount, end: game.time + duration, name, max: amount });
  game.emit({ type: 'shield', tgt: u.id, amount, name });
}

export function shieldTotal(u, time) {
  let s = 0;
  for (const sh of u.shields) if (sh.end > time) s += sh.amount;
  return s;
}
