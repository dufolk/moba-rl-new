import * as THREE from 'three';
import { Game, replayGame } from '../sim/game.js';
import { DT } from '../sim/util.js';
import { MID, MAP_LENGTH } from '../sim/map.js';
import { isTargetable, shieldTotal, getBuff } from '../sim/combat.js';
import { SUMMONERS } from '../sim/data.js';
import { SceneRig } from './scene.js';
import { buildEnvironment, TEAM_COLORS } from './environment.js';
import { createChampionModel } from './models/champions.js';
import { createMinionModel, TowerModel, NexusModel, RelicModel, glowSprite } from './models/units.js';
import { FX, arcGeometry } from './fx.js';
import { Overlay } from './overlay.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { ringTexture } from './textures.js';
import { simToWorld, worldToSim, simAngleToYaw, S } from './coords.js';

const CHAMP_FX = {
  garen: { slash: 0xcfe6ff, heavy: 0xffd36b },
  darius: { slash: 0xff3a2a, heavy: 0xff1a10 },
  camille: { slash: 0x6fe9ff, heavy: 0x9ff4ff },
};
const GLOW = [0x55c8ff, 0xff5a7a];
const _w = { x: 0, z: 0 };
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Dashed ring with four inward chevrons, drawn on the ground under the current attack target. */
function targetLockTexture() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.translate(n / 2, n / 2);
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,60,30,0.9)';
  g.shadowBlur = 10;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.strokeStyle = '#ff5a3a';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(0, 0, n * 0.4, a + 0.22, a + Math.PI / 2 - 0.22);
    g.stroke();
    g.save();
    g.rotate(a + Math.PI / 4);
    g.fillStyle = '#ffd2a8';
    g.beginPath();
    g.moveTo(n * 0.47, -n * 0.05);
    g.lineTo(n * 0.36, 0);
    g.lineTo(n * 0.47, n * 0.05);
    g.closePath();
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class GameView {
  constructor(opts) {
    this.opts = opts;
    this.mode = opts.mode;
    this.playerTeam = 0;
    this.settings = { indicatorCast: false };
    this.speed = 1;
    const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    if (this.mode === 'replay') {
      this.game = replayGame(opts.replay);
    } else {
      const ctl = { play: ['human', 'bot'], practice: ['human', 'idle'], spectate: ['bot', 'bot'] }[this.mode];
      this.game = new Game({
        seed, champions: opts.champions, controllers: ctl, botDifficulty: opts.botDifficulty ?? 1,
        autoLevel: [this.mode === 'spectate' || !!opts.autoLevel, true], autoBuy: [this.mode === 'spectate', true],
        firstWaveTime: this.mode === 'practice' ? 5 : 15,
      });
      if (this.mode === 'practice') {
        this.game.champions[1].x = MID - 500;
        this.game.champions[1].passive = true;
      }
    }
    this.rig = new SceneRig(opts.container, opts.quality || 'high');
    this.scene = this.rig.scene;
    this.camera = this.rig.camera;
    this.env = buildEnvironment(this.scene, opts.quality || 'high');
    this.fx = new FX(this.scene);
    this.fx.onShake = (a) => this.shake(a);
    this.overlay = new Overlay(opts.overlayCanvas);
    this.sfx = opts.sfx || new Sfx();
    this.views = new Map();
    this.projViews = new Map();
    this.realTime = 0;
    this.acc = 0;
    this.paused = false;
    this.cameraLocked = true;
    this.followTeam = 0;
    this.zoom = 16;
    this.focus = new THREE.Vector3();
    this.shakeAmt = 0;
    this.hovered = null;
    this.rightTarget = null;
    this.lastConfirm = -1;
    this.lastHoldMove = 0;
    this.heldKey = null;
    this.ringTex = ringTexture(256, 0.05);
    this.buildStructures();
    this.buildIndicators();
    this.hud = new Hud(opts.hudRoot, this);
    this.input = new Input(opts.container, this.inputHandlers());
    const me = this.game.champions[this.followTeam];
    simToWorld(me.x, me.y, _w);
    this.focus.set(_w.x, 0, _w.z);
    this.onBeforeUnload = (e) => { if (this.mode === 'play' && !this.game.over) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    if (this.mode !== 'replay') this.hud.pushAnnounce('欢迎来到嚎哭深渊', 'gold');
  }

  // ---------------------------------------------------------- setup ----

  buildStructures() {
    this.structViews = [];
    for (const team of [0, 1]) {
      for (const tw of this.game.towers[team]) {
        const m = new TowerModel(team);
        simToWorld(tw.x, tw.y, _w);
        m.root.position.set(_w.x, 0, _w.z);
        this.scene.add(m.root);
        const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
        const bg = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
        bg.translate(0, 0.5, 0);
        bg.rotateX(Math.PI / 2);
        const beam = new THREE.Mesh(bg, beamMat);
        beam.visible = false;
        this.scene.add(beam);
        this.structViews.push({ unit: tw, model: m, beam, trail: tw.hp });
      }
      const nx = this.game.nexus[team];
      const m = new NexusModel(team);
      simToWorld(nx.x, nx.y, _w);
      m.root.position.set(_w.x, 0, _w.z);
      this.scene.add(m.root);
      this.structViews.push({ unit: nx, model: m, trail: nx.hp });
    }
    this.relicViews = this.game.relics.map((r) => {
      const m = new RelicModel();
      simToWorld(r.x, r.y, _w);
      m.root.position.set(_w.x, 0, _w.z);
      this.scene.add(m.root);
      return { relic: r, model: m };
    });
  }

  buildIndicators() {
    const mk = (color, opacity) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.ringTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.rangeRing = mk(0x7fc8ff, 0.6);
    this.hoverRing = mk(0xff4040, 0.9);
    this.targetRing = mk(0xffffff, 1.0);
    this.targetRing.material.map = targetLockTexture();
    this.targetRing.material.blending = THREE.NormalBlending;
    const coneMat = new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.aimCone = new THREE.Mesh(arcGeometry(0.3, 1, -0.5, 1, 24), coneMat);
    this.aimCone.visible = false;
    this.aimHolder = new THREE.Group();
    this.aimHolder.add(this.aimCone);
    this.scene.add(this.aimHolder);
    const lineGeo = new THREE.PlaneGeometry(1, 1);
    lineGeo.rotateX(-Math.PI / 2);
    lineGeo.translate(0, 0, 0.5);
    this.aimLine = new THREE.Mesh(lineGeo, coneMat.clone());
    this.aimLine.visible = false;
    this.aimHolder.add(this.aimLine);
  }

  // -------------------------------------------------------- helpers ----

  get me() { return this.game.champions[this.playerTeam]; }

  worldPosOf(u, out = new THREE.Vector3(), h = 0) {
    const v = this.views.get(u.id);
    if (v) return out.set(v.root.position.x, h, v.root.position.z);
    simToWorld(u.x, u.y, _w);
    return out.set(_w.x, h, _w.z);
  }

  cursorWorld() {
    const m = this.input.mouse;
    _ndc.set((m.x / window.innerWidth) * 2 - 1, -(m.y / window.innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, this.camera);
    if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
    return _hit;
  }

  cursorSim() {
    const h = this.cursorWorld();
    return h ? worldToSim(h.x, h.z) : { x: this.me.x, y: this.me.y };
  }

  cameraFocusSim() {
    return worldToSim(this.focus.x, this.focus.z);
  }

  /**
   * Unit under the cursor. Each unit is a screen-space capsule from its feet to the top of the
   * model; champions get a wider capsule and win ties so they're easy to click while moving.
   * Holding ` (backquote) restricts picking to champions, as in LoL.
   */
  pickUnit() {
    const m = this.input.mouse;
    const champsOnly = this.input.keys.has('`');
    const px = 15 / this.zoom;
    let best = null, bestS = Infinity;
    const consider = (u, pos, h, r, bias) => {
      const a = this.overlay.project(this.camera, pos.x, 0, pos.z);
      const b = this.overlay.project(this.camera, pos.x, h, pos.z);
      const d = segDist(m.x, m.y, a.x, a.y, b.x, b.y);
      if (d > r) return;
      const s = d / r - bias;
      if (s < bestS) { bestS = s; best = u; }
    };
    for (const v of this.views.values()) {
      const u = v.unit;
      if (!isTargetable(u) || u.team === this.playerTeam) continue;
      if (u.kind === 'champion') consider(u, v.root.position, v.height, 44 * px + 16, 0.6);
      else if (!champsOnly) consider(u, v.root.position, v.height, 24 * px + 8, 0);
    }
    if (!champsOnly) {
      for (const sv of this.structViews) {
        if (!isTargetable(sv.unit) || sv.unit.team === this.playerTeam) continue;
        consider(sv.unit, sv.model.root.position, sv.model.height || 4, 60 * px, -0.2);
      }
    }
    return best;
  }

  attackTarget(t) {
    this.cmd({ type: 'attack', target: t.id });
    if (this.rightTarget === t.id && this.realTime - this.lastConfirm < 0.25) return;
    this.rightTarget = t.id;
    this.lastConfirm = this.realTime;
    const pos = this.worldPosOf(t, new THREE.Vector3());
    const r = Math.max(0.5, t.radius * S);
    this.fx.ring(pos, { color: 0xff3a2a, from: r * 3.2, to: r * 1.25, duration: 0.22, opacity: 1 });
    this.fx.ring(pos, { color: 0xffd0a0, from: r * 1.25, to: r * 1.6, duration: 0.3, opacity: 0.6 });
    const view = t.kind === 'tower' || t.kind === 'nexus' ? null : this.views.get(t.id);
    if (view) view.model.flash(0xff2a1a, 0.9);
    this.sfx.ui();
  }

  shake(a) {
    this.shakeAmt = Math.min(0.6, this.shakeAmt + a);
  }

  volumeAt(u) {
    if (!u) return 1;
    const p = this.worldPosOf(u, new THREE.Vector3());
    const d = p.distanceTo(this.focus);
    return Math.max(0, 1 - d / 22);
  }

  // ---------------------------------------------------------- input ----

  inputHandlers() {
    return {
      onRightDown: () => {
        if (!this.canControl()) return;
        const t = this.pickUnit();
        this.hovered = t;
        if (t) {
          this.rightTarget = null;
          this.attackTarget(t);
        } else {
          this.rightTarget = null;
          const p = this.cursorSim();
          this.cmd({ type: 'move', x: p.x, y: p.y });
          const w = this.cursorWorld();
          if (w) this.clickMarker(w.clone(), 0x5dff7a);
        }
        this.lastHoldMove = this.realTime;
      },
      onAttackMove: () => {
        if (!this.canControl()) return;
        const p = this.cursorSim();
        this.cmd({ type: 'attackmove', x: p.x, y: p.y });
        const w = this.cursorWorld();
        if (w) this.clickMarker(w.clone(), 0xff4040);
      },
      onLeftDown: () => {},
      onWheel: (d) => { this.zoom = Math.min(24, Math.max(9, this.zoom + d * 1.2)); },
      onKeyDown: (k, e, repeat) => this.onKeyDown(k, e, repeat),
      onKeyUp: (k) => this.onKeyUp(k),
    };
  }

  canControl() {
    return (this.mode === 'play' || this.mode === 'practice') && !this.paused && !this.game.over;
  }

  cmd(c) {
    this.game.command(this.playerTeam, c);
  }

  onKeyDown(k, e, repeat) {
    if (k === 'Escape') {
      if (!this.hud.shop.classList.contains('hidden')) this.hud.toggleShop(false);
      else this.togglePause();
      return;
    }
    if (k === 'h') return this.hud.toggle('help');
    if (k === 'F9') { e.preventDefault(); return this.hud.toggle('debug'); }
    if (k === 'y') { this.cameraLocked = !this.cameraLocked; return; }
    if (k === 'Tab') return this.hud.toggle('help');
    if (this.mode === 'spectate' || this.mode === 'replay') {
      if (k === '1' || k === '2') { this.followTeam = Number(k) - 1; this.cameraLocked = true; }
      if (k === ']' || k === '=') this.speed = Math.min(16, this.speed * 2);
      if (k === '[' || k === '-') this.speed = Math.max(0.25, this.speed / 2);
      return;
    }
    if (k === 'p') return this.hud.toggleShop();
    if (!this.canControl() || repeat) return;
    const slot = k.toUpperCase();
    if (['Q', 'W', 'E', 'R'].includes(slot)) {
      if (e.ctrlKey || e.altKey) return this.levelUp(slot);
      this.heldKey = slot;
      const ab = this.me.def.abilities[slot];
      if (!this.settings.indicatorCast || ab.targeting !== 'point') this.castSlot(slot);
      return;
    }
    if (slot === 'D' || slot === 'F') return this.castSlot(slot);
    if (k === 's') this.cmd({ type: 'stop' });
  }

  onKeyUp(k) {
    const slot = k.toUpperCase();
    if (slot === this.heldKey) {
      const ab = this.me.def.abilities[slot];
      if (this.settings.indicatorCast && ab && ab.targeting === 'point' && this.canControl()) this.castSlot(slot);
      this.heldKey = null;
    }
  }

  enemyChampNearCursor() {
    const enemy = this.game.champions[1 - this.playerTeam];
    if (!isTargetable(enemy)) return null;
    if (this.hovered === enemy) return enemy;
    const p = this.cursorSim();
    return Math.hypot(enemy.x - p.x, enemy.y - p.y) < 420 ? enemy : null;
  }

  castSlot(slot) {
    const me = this.me;
    if (!me.alive) return;
    const p = this.cursorSim();
    const unitTargeted = slot === 'F' || (slot !== 'D' && me.def.abilities[slot].targeting === 'unit' && !this.game.abilityState(me, slot).recast);
    let target = null;
    if (unitTargeted) {
      target = this.enemyChampNearCursor();
      if (!target) return;
      if (slot === 'F' && Math.hypot(target.x - me.x, target.y - me.y) - target.radius > SUMMONERS.F.range) return;
    }
    this.cmd({ type: 'cast', slot, x: p.x, y: p.y, target: target ? target.id : undefined });
  }

  levelUp(slot) {
    this.cmd({ type: 'levelup', slot });
    this.sfx.ui();
  }

  buy(id) {
    this.cmd({ type: 'buy', item: id });
    this.sfx.ui();
  }

  sell(i) {
    this.cmd({ type: 'sell', index: i });
  }

  minimapMove(p) {
    if (this.canControl()) this.cmd({ type: 'move', x: p.x, y: p.y });
  }

  minimapLook(p) {
    this.cameraLocked = false;
    simToWorld(p.x, p.y, _w);
    this.focus.set(_w.x, 0, _w.z);
  }

  togglePause(v) {
    this.paused = v ?? !this.paused;
    this.hud.toggle('pause', this.paused);
  }

  clickMarker(pos, color) {
    this.fx.ring(pos, { color, from: 1.0, to: 0.15, duration: 0.35, opacity: 0.9 });
    this.fx.burst({ x: pos.x, y: 0.05, z: pos.z }, { count: 6, color, speed: 1.5, life: 0.3, size: 0.12, flat: true });
  }

  specText() {
    const g = this.game;
    const names = g.champions.map((c, i) => `<b class="${i ? 'red' : 'blue'}">${i + 1}</b> ${c.def.name} Lv${c.level} ${c.kills}/${c.deaths} CS ${c.cs}`).join(' &nbsp; ');
    return `${this.mode === 'replay' ? '回放' : '观战'} · 速度 ${this.speed}x（[ ] 调速）· 1/2 跟随 · Y 自由镜头 &nbsp; ${names}`;
  }

  downloadReplay() {
    const data = JSON.stringify(this.game.exportReplay({ mode: this.mode, savedAt: new Date().toISOString() }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `replay_${this.game.champions.map((c) => c.champ).join('-vs-')}_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  exit() {
    this.dispose();
    this.opts.onExit?.();
  }

  // ----------------------------------------------------------- loop ----

  frame(now) {
    if (this.disposed) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.realTime += dt;
    const g = this.game;

    if (!this.paused && !g.over) {
      if (this.input.rightHeld && this.canControl() && this.realTime - this.lastHoldMove > 0.12) {
        // holding right-click: sweeping over an enemy targets it; an existing target is kept while held
        const held = this.rightTarget != null ? this.game.byId.get(this.rightTarget) : null;
        if (held && !isTargetable(held)) this.rightTarget = null;
        const h = this.pickUnit();
        if (h && h.id !== this.rightTarget) this.attackTarget(h);
        else if (this.rightTarget == null) {
          const p = this.cursorSim();
          this.cmd({ type: 'move', x: p.x, y: p.y });
        }
        this.lastHoldMove = this.realTime;
      }
      this.acc += dt * this.speed;
      let n = 0;
      const maxSteps = Math.max(8, Math.ceil(this.speed * 3));
      while (this.acc >= DT && n < maxSteps) {
        this.simStep();
        this.acc -= DT;
        n++;
      }
      if (n >= maxSteps) this.acc = 0;
    }
    const alpha = this.paused || g.over ? 1 : Math.min(1, this.acc / DT);
    this.hovered = this.pickUnit();
    this.updateViews(dt, alpha);
    this.updateStructures(dt);
    this.updateProjectiles(alpha);
    this.updateIndicators();
    this.updateCamera(dt);
    this.fx.update(dt);
    this.rig.update(dt, this.realTime, this.focus);
    this.env.update(this.realTime);
    this.rig.render();
    this.drawOverlay(dt);
    this.hud.update(dt);
    const h = this.hovered;
    this.opts.container.style.cursor = h && h.team !== this.playerTeam && this.canControl() ? 'var(--cursor-attack)' : 'var(--cursor-default)';
  }

  simStep() {
    const g = this.game;
    for (const u of g.units) { u._px = u.x; u._py = u.y; }
    for (const p of g.projectiles) { p._px = p.x; p._py = p.y; }
    if (this.mode === 'replay') {
      g.replayStep();
      if (g.tick >= this.opts.replay.ticks && !g.over) {
        g.over = true;
        g.winner = this.opts.replay.winner;
        g.emit({ type: 'game_over', winner: g.winner });
      }
    } else {
      if (this.mode === 'practice' && g.tick % 60 === 0) {
        const d = g.champions[1];
        if (!d.dead && Math.abs(d.x - (MID - 500)) > 60) g.command(1, { type: 'move', x: MID - 500, y: 0 });
      }
      g.step();
    }
    for (const ev of g.drainEvents()) this.handleEvent(ev);
  }

  // ---------------------------------------------------------- views ----

  createView(u) {
    let model;
    if (u.kind === 'champion') model = createChampionModel(u.champ, u.team);
    else model = createMinionModel(u.mtype, u.team);
    const root = new THREE.Group();
    root.add(model.root);
    this.scene.add(root);
    const v = {
      unit: u, model, root, height: model.height, yaw: simAngleToYaw(u.facing), trail: u.hp, trailHold: 0,
      anim: { speed: 0, phase: Math.random() * 6, time: 0, action: null, dead: !u.alive, deadT: 0, spinning: false, spinAngle: 0, dashName: null, dashStart: 0, attackIndex: 0 },
      prev: null,
    };
    if (u.kind === 'champion') {
      const isMe = u.team === this.playerTeam && (this.mode === 'play' || this.mode === 'practice');
      const ringColor = isMe ? 0x6dff8a : u.team === this.playerTeam ? 0x4fb4ff : 0xff4848;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: this.ringTex, color: ringColor, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      root.add(ring);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
      shield.position.y = 1.05;
      shield.scale.set(0.85, 1.05, 0.85);
      shield.visible = false;
      root.add(shield);
      const aura = glowSprite(0xff2a1a, 3.2, 0.5);
      aura.position.y = 1.1;
      aura.visible = false;
      root.add(aura);
      const stars = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = glowSprite(0xffe66b, 0.35, 1);
        s.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.35, 0, Math.sin((i / 3) * Math.PI * 2) * 0.35);
        stars.add(s);
      }
      stars.position.y = model.height + 0.25;
      stars.visible = false;
      root.add(stars);
      Object.assign(v, { ring, shield, aura, stars });
    } else {
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(u.radius * S * 1.1, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      root.add(shadow);
    }
    this.views.set(u.id, v);
    return v;
  }

  removeView(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    v.root.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose();
        if (o.material && !o.material.map) o.material.dispose();
      }
    });
    this.views.delete(id);
  }

  updateViews(dt, alpha) {
    const g = this.game;
    const seen = new Set();
    for (const u of g.units) {
      if (u.kind !== 'champion' && u.kind !== 'minion') continue;
      let v = this.views.get(u.id);
      if (!v) {
        if (!u.alive) continue;
        v = this.createView(u);
      }
      seen.add(u.id);
      const px = u._px ?? u.x, py = u._py ?? u.y;
      const x = px + (u.x - px) * alpha, y = py + (u.y - py) * alpha;
      simToWorld(x, y, _w);
      const a = v.anim;
      const prevX = v.root.position.x, prevZ = v.root.position.z;
      v.root.position.x = _w.x;
      v.root.position.z = _w.z;
      // vertical offset: airborne hop / dashes
      let yOff = 0;
      if (u.alive && u.status.airborne) {
        const b = u.buffs.find((bb) => bb.airborne);
        if (b) yOff = Math.sin(Math.PI * Math.min(1, (g.time - b.start) / Math.max(0.05, b.duration))) * 0.7;
      }
      if (u.dash && u.dash.name === 'guillotine') yOff = Math.sin(Math.PI * Math.min(1, (g.time - (v.dashT0 ?? g.time)) / 0.45)) * 1.2;
      v.root.position.y += (yOff - v.root.position.y) * Math.min(1, dt * 20);
      const moved = Math.hypot(v.root.position.x - prevX, v.root.position.z - prevZ);
      const inst = v.prev && dt > 0 ? Math.min(12, moved / dt) : 0;
      v.prev = true;
      const dashing = !!u.dash;
      a.speed += ((dashing ? 0 : inst) - a.speed) * Math.min(1, dt * 12);
      a.phase += a.speed * dt * (u.kind === 'champion' ? 3.4 : 5.5);
      a.time = this.realTime;
      a.dead = !u.alive;
      a.deadT = u.alive ? 0 : a.deadT + dt;
      a.dashName = u.dash ? u.dash.name || 'dash' : null;
      if (u.dash && !v.wasDashing) { a.dashStart = this.realTime; v.dashT0 = g.time; }
      v.wasDashing = !!u.dash;
      a.dashStart = a.dashName ? a.dashStart : 0;
      if (a.dashName === 'camille_r') a.dashStart = a.dashStart || this.realTime;
      if (u.kind === 'champion') {
        a.spinning = !!(u.s && u.s.spin);
        if (a.spinning) a.spinAngle -= dt * 17;
        else a.spinAngle = 0;
      }
      if (a.action && this.realTime - a.action.start > a.action.dur) a.action = null;
      const targetYaw = simAngleToYaw(u.facing);
      v.yaw = angleLerp(v.yaw, targetYaw, Math.min(1, dt * (u.kind === 'champion' ? 22 : 10)));
      v.model.root.rotation.y = v.yaw;
      if (!u.alive) {
        if (a.deadT > 1.6) v.root.position.y = -Math.min(1.5, (a.deadT - 1.6) * 0.8);
        if (u.kind === 'minion' && a.deadT > 2.2) { this.removeView(u.id); continue; }
      }
      v.model.update(dt, a);
      // hp trail
      v.trailHold -= dt;
      if (v.trailHold <= 0) v.trail = Math.max(u.hp, v.trail - u.stats.maxHp * 0.9 * dt);
      if (v.trail < u.hp) v.trail = u.hp;
      if (u.kind === 'champion') this.updateChampionExtras(v, u, dt);
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.removeView(id);
  }

  updateChampionExtras(v, u, dt) {
    const g = this.game;
    v.ring.visible = u.alive;
    const sh = u.alive ? shieldTotal(u, g.time) : 0;
    v.shield.visible = sh > 1;
    if (sh > 1) v.shield.material.opacity = 0.1 + Math.min(0.2, sh / u.stats.maxHp) + Math.sin(this.realTime * 6) * 0.03;
    const might = u.champ === 'darius' && u.s.mightUntil > g.time;
    const garenW = u.champ === 'garen' && getBuff(u, 'garen_w');
    const camR = u.champ === 'camille' && u.status.untargetable;
    v.aura.visible = u.alive && (might || !!garenW || camR);
    if (v.aura.visible) {
      v.aura.material.color.set(might ? 0xff2a1a : garenW ? 0xffcc55 : 0x48e3ff);
      const s = 3 + Math.sin(this.realTime * 8) * 0.3;
      v.aura.scale.set(s, s, 1);
    }
    v.stars.visible = u.alive && u.status.stun;
    if (v.stars.visible) v.stars.rotation.y += dt * 6;
    if (!u.alive) return;
    const p = v.root.position;
    // bleed drops / ignite flames on any bleeding unit handled here for champions
    for (const d of u.dots) {
      if (d.name === 'bleed' && Math.random() < 0.12 * d.stacks) this.fx.burst({ x: p.x, y: 1.2, z: p.z }, { count: 1, color: 0xb00010, speed: 0.6, life: 0.6, size: 0.14, gravity: 6, radius: 0.3 });
      if (d.name === 'ignite' && Math.random() < 0.6) this.fx.burst({ x: p.x, y: 0.6, z: p.z }, { count: 1, color: 0xff6a10, color2: 0xffc040, speed: 0.4, life: 0.6, size: 0.3, up: 2, radius: 0.35 });
    }
    if (u.status.slow > 0.2 && Math.random() < 0.15) this.fx.burst({ x: p.x, y: 0.1, z: p.z }, { count: 1, color: 0x88aaff, speed: 0.3, life: 0.5, size: 0.15, radius: 0.5 });
    if (u.champ === 'garen' && u.s.qUntil > g.time && Math.random() < 0.5) {
      this.fx.burst({ x: p.x, y: 1.0, z: p.z }, { count: 1, color: 0xffd36b, speed: 0.5, life: 0.4, size: 0.18, radius: 0.5, up: 1 });
    }
    if (u.champ === 'camille' && u.s.q && Math.random() < 0.5) {
      this.fx.burst({ x: p.x, y: 0.5, z: p.z }, { count: 1, color: 0x48e3ff, speed: 0.4, life: 0.35, size: 0.16, radius: 0.35 });
    }
    // Camille hook beam
    if (u.champ === 'camille') {
      const wantBeam = u.s.hook || (u.s.e && u.s.e.stage === 1);
      if (wantBeam && !v.hookBeam) {
        v.hookBeam = this.fx.beam(() => {
          const s = u.s;
          let tx, ty;
          if (s.hook) { tx = s.hook.x; ty = s.hook.y; } else if (s.e && s.e.stage === 1 && v.hookPoint) { tx = v.hookPoint.x; ty = v.hookPoint.y; } else return null;
          simToWorld(tx, ty, _w);
          return [new THREE.Vector3(v.root.position.x, 1.3, v.root.position.z), new THREE.Vector3(_w.x, 1.1, _w.z)];
        }, { color: 0x6fe9ff, width: 0.035 });
      }
      if (!wantBeam && v.hookBeam) { v.hookBeam.kill(); v.hookBeam = null; }
      if (u.s.r && !v.zone) {
        simToWorld(u.s.r.x, u.s.r.y, _w);
        v.zone = this.fx.zone({ radius: u.s.r.r * S, segments: 6, color: 0x48e3ff, fill: 0.12, walls: 1.8 });
        v.zone.group.position.set(_w.x, 0.04, _w.z);
      }
      if (!u.s.r && v.zone) { v.zone.kill(); v.zone = null; }
    }
  }

  updateStructures(dt) {
    const g = this.game;
    for (const sv of this.structViews) {
      const u = sv.unit;
      if (u.kind === 'tower') {
        const tgt = u.target != null ? g.byId.get(u.target) : null;
        sv.model.update(dt, this.realTime, tgt && tgt.id === this.me.id && this.mode !== 'spectate', u.vulnerable);
        if (tgt && tgt.kind === 'champion' && u.alive) {
          const a = new THREE.Vector3(sv.model.root.position.x, 4.9, sv.model.root.position.z);
          const b = this.worldPosOf(tgt, new THREE.Vector3(), 1.2);
          sv.beam.visible = true;
          sv.beam.position.copy(a);
          sv.beam.scale.set(1, 1, a.distanceTo(b));
          sv.beam.lookAt(b);
          sv.beam.material.color.set(tgt.team === this.playerTeam ? 0xff3030 : GLOW[u.team]);
          sv.beam.material.opacity = 0.45 + Math.sin(this.realTime * 10) * 0.2;
        } else sv.beam.visible = false;
      } else sv.model.update(dt, this.realTime, u.vulnerable);
      if (sv.trail > u.hp) sv.trail = Math.max(u.hp, sv.trail - u.stats.maxHp * 0.25 * dt);
      else sv.trail = u.hp;
    }
    for (const rv of this.relicViews) rv.model.update(dt, this.realTime, g.time >= rv.relic.availableAt);
  }

  createProjView(p) {
    const g = this.game;
    const src = g.byId.get(p.src);
    const team = p.srcTeam ?? (src ? src.team : 0);
    const group = new THREE.Group();
    let size = 0.12, color = GLOW[team];
    if (p.kind === 'tower') { size = 0.32; }
    if (p.kind === 'cannon') { size = 0.16; color = 0xff8a2a; }
    const core = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), new THREE.MeshBasicMaterial({ color: p.kind === 'cannon' ? 0x222222 : 0xffffff }));
    group.add(core);
    group.add(glowSprite(color, size * (p.kind === 'tower' ? 9 : 7), 0.9));
    this.scene.add(group);
    const t = g.byId.get(p.target);
    const d0 = t ? Math.hypot(t.x - p.x, t.y - p.y) : 1;
    const v = { group, color, d0: Math.max(1, d0), h0: (p.z ?? 60) * S, kind: p.kind };
    this.projViews.set(p.id, v);
    return v;
  }

  updateProjectiles(alpha) {
    const g = this.game;
    const seen = new Set();
    for (const p of g.projectiles) {
      seen.add(p.id);
      const v = this.projViews.get(p.id) || this.createProjView(p);
      const px = p._px ?? p.x, py = p._py ?? p.y;
      const x = px + (p.x - px) * alpha, y = py + (p.y - py) * alpha;
      simToWorld(x, y, _w);
      const t = g.byId.get(p.target);
      const d = t ? Math.hypot(t.x - x, t.y - y) : 0;
      const th = t ? (t.kind === 'champion' ? 1.2 : t.kind === 'minion' ? 0.5 : 2) : 0.5;
      const k = Math.min(1, d / v.d0);
      const arc = v.kind === 'cannon' ? Math.sin(Math.PI * k) * 0.8 : 0;
      v.group.position.set(_w.x, th + (v.h0 - th) * k + arc, _w.z);
      if (Math.random() < (v.kind === 'tower' ? 1 : 0.5)) {
        this.fx.burst(v.group.position, { count: 1, color: v.color, speed: 0.2, life: v.kind === 'tower' ? 0.35 : 0.22, size: v.kind === 'tower' ? 0.4 : 0.16 });
      }
    }
    for (const [id, v] of this.projViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      v.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      this.projViews.delete(id);
    }
  }

  updateIndicators() {
    const me = this.me;
    const v = this.views.get(me.id);
    const showFor = this.canControl() && v && me.alive;
    const slot = this.heldKey;
    this.rangeRing.visible = false;
    this.aimCone.visible = false;
    this.aimLine.visible = false;
    if (showFor && (slot || this.input.attackMoveArmed)) {
      let range = me.stats.range + me.radius;
      let ab = null;
      if (slot) { ab = me.def.abilities[slot]; range = ab.range || 300; }
      const r = range * S;
      this.rangeRing.visible = true;
      this.rangeRing.position.set(v.root.position.x, 0.05, v.root.position.z);
      this.rangeRing.scale.set(r, r, r);
      if (ab && ab.targeting === 'point') {
        const c = this.cursorWorld();
        if (c) {
          const yaw = Math.atan2(c.x - v.root.position.x, c.z - v.root.position.z);
          this.aimHolder.position.set(v.root.position.x, 0.06, v.root.position.z);
          this.aimHolder.rotation.y = yaw;
          const key = `${me.champ}_${slot}`;
          if (key === 'darius_E' || key === 'camille_W') {
            const half = key === 'darius_E' ? 25 : 40;
            this.aimCone.geometry.dispose();
            this.aimCone.geometry = arcGeometry(0.3, r, -half * Math.PI / 180, 2 * half * Math.PI / 180, 24);
            this.aimCone.rotation.y = -Math.PI / 2;
            this.aimCone.visible = true;
          } else {
            this.aimLine.scale.set(0.7, 1, r);
            this.aimLine.visible = true;
          }
        }
      }
    }
    const posOf = (u) => (u.kind === 'tower' || u.kind === 'nexus'
      ? this.structViews.find((s) => s.unit === u)?.model.root.position
      : this.views.get(u.id)?.root.position);
    const h = this.hovered;
    this.hoverRing.visible = !!(h && h.team !== this.playerTeam && this.canControl());
    if (this.hoverRing.visible) {
      const p = posOf(h);
      if (p) {
        const r = Math.max(0.5, h.radius * S) * 1.5;
        this.hoverRing.position.set(p.x, 0.06, p.z);
        this.hoverRing.scale.set(r, r, r);
        const hv = this.views.get(h.id);
        if (hv) hv.model.flash(0xff3a2a, 0.22);
      } else this.hoverRing.visible = false;
    }
    // current attack target: pulsing red lock ring, so it's always clear who you're hitting
    const tid = !this.canControl() || !me.alive ? null
      : me.order && (me.order.type === 'attack' || me.order.type === 'attackmove') && me.order.target != null ? me.order.target
        : me.windup ? me.windup.target : null;
    const t = tid != null ? this.game.byId.get(tid) : null;
    this.targetRing.visible = false;
    if (t && isTargetable(t)) {
      const p = posOf(t);
      if (p) {
        const r = Math.max(0.5, t.radius * S) * (1.7 + Math.sin(this.realTime * 9) * 0.07);
        this.targetRing.position.set(p.x, 0.08, p.z);
        this.targetRing.rotation.z = this.realTime * 1.6;
        this.targetRing.scale.set(r, r, r);
        this.targetRing.visible = true;
        if (h === t) this.hoverRing.visible = false;
      }
    }
  }

  updateCamera(dt) {
    const g = this.game;
    const target = this.focus.clone();
    const follow = g.champions[this.followTeam];
    const space = this.input.keys.has(' ');
    if ((this.cameraLocked || space) && follow) {
      const v = this.views.get(follow.id);
      if (v) target.set(v.root.position.x, 0, v.root.position.z);
    } else {
      const m = this.input.mouse;
      const edge = 14, sp = 30 * (this.zoom / 15) * dt;
      if (m.inside) {
        if (m.x < edge) target.x -= sp;
        if (m.x > window.innerWidth - edge) target.x += sp;
        if (m.y < edge) target.z -= sp;
        if (m.y > window.innerHeight - edge) target.z += sp;
      }
    }
    const lim = (MAP_LENGTH / 2) * S * 0.75;
    target.x = Math.max(-lim, Math.min(lim, target.x));
    target.z = Math.max(-lim, Math.min(lim, target.z));
    const k = this.cameraLocked || space ? 1 - Math.exp(-dt * 14) : 1;
    this.focus.lerp(target, k);
    const pitch = THREE.MathUtils.degToRad(56);
    const d = this.zoom;
    this.shakeAmt *= Math.exp(-dt * 7);
    const sx = (Math.random() - 0.5) * this.shakeAmt, sy = (Math.random() - 0.5) * this.shakeAmt;
    this.camera.position.set(this.focus.x + sx, d * Math.sin(pitch) + sy, this.focus.z + d * Math.cos(pitch));
    this.camera.lookAt(this.focus.x + sx, 0.6, this.focus.z);
  }

  // -------------------------------------------------------- overlay ----

  drawOverlay(dt) {
    const o = this.overlay;
    const g = this.game;
    o.clear();
    for (const v of this.views.values()) {
      const u = v.unit;
      if (!u.alive) continue;
      const p = o.project(this.camera, v.root.position.x, v.root.position.y + v.height + 0.35, v.root.position.z);
      if (p.behind || p.x < -100 || p.x > o.w + 100 || p.y < -100 || p.y > o.h + 100) continue;
      if (u.kind === 'champion') {
        const isMe = u.team === this.playerTeam && this.mode !== 'spectate' && this.mode !== 'replay';
        const col = isMe ? ['#8ef07a', '#2f9a35'] : u.team === this.playerTeam ? ['#7cc4ff', '#2a6fc0'] : ['#ff6d6d', '#b02020'];
        const badges = [];
        if (u.status.stun) badges.push({ text: '眩晕', bg: '#b8860b' });
        if (u.status.silence) badges.push({ text: '沉默', bg: '#7a3fb0' });
        if (u.status.airborne) badges.push({ text: '击飞', bg: '#b05a10' });
        if (u.status.slow > 0.05) badges.push({ text: `减速${Math.round(u.status.slow * 100)}%`, bg: '#2a5aa8' });
        if (u.status.grievous) badges.push({ text: '重伤', bg: '#8a1a1a' });
        const bleed = u.dots.find((d) => d.name === 'bleed');
        if (bleed) badges.push({ text: `出血×${bleed.stacks}`, bg: '#6a0a0a' });
        o.championBar(p, u, { color: col, shield: shieldTotal(u, g.time), trail: v.trail, name: u.def.name, nameColor: isMe ? '#fff3b0' : '#fff', badges });
      } else {
        o.smallBar(p, u, u.team === this.playerTeam ? '#5aa8ff' : '#ff5050', u.mtype === 'cannon' ? 64 : 48, 5, v.trail);
      }
    }
    for (const sv of this.structViews) {
      const u = sv.unit;
      if (!u.alive) continue;
      const pos = sv.model.root.position;
      const p = o.project(this.camera, pos.x, sv.model.height + 0.8, pos.z);
      if (p.behind) continue;
      o.structureBar(p, u, u.team === this.playerTeam ? '#5aa8ff' : '#ff5050', sv.trail, u.vulnerable);
    }
    o.drawTexts(this.camera, dt);
  }

  // --------------------------------------------------------- events ----

  isMine(id) {
    return (this.mode === 'play' || this.mode === 'practice') && id === this.me.id;
  }

  handleEvent(ev) {
    const g = this.game;
    const u = ev.id != null ? g.byId.get(ev.id) : null;
    const view = u ? this.views.get(u.id) : null;
    switch (ev.type) {
      case 'attack_start': {
        if (!view) break;
        let label = null;
        if (u.kind === 'champion') {
          if (u.champ === 'garen' && u.s.qUntil > g.time) label = 'garen_q';
          if (u.champ === 'darius' && u.s.wUntil > g.time) label = 'darius_w';
          if (u.champ === 'camille' && u.s.q && u.s.q.armed && u.s.q.stage === 2) label = g.time - u.s.q.hitAt >= 1.5 ? 'camille_q2_charged' : 'camille_q2';
          view.anim.attackIndex++;
          this.sfx.swing(!!label, this.volumeAt(u));
        }
        view.anim.action = { name: 'attack', start: this.realTime, windup: ev.windup, dur: ev.windup + Math.min(0.45, ev.attackTime - ev.windup), label };
        break;
      }
      case 'attack_hit': {
        const t = g.byId.get(ev.target);
        if (!u || !t) break;
        const tp = this.worldPosOf(t, new THREE.Vector3(), t.kind === 'champion' ? 1.1 : 0.5);
        if (u.kind === 'champion') {
          const heavy = ev.label && ev.label !== 'camille_q';
          const fx = CHAMP_FX[u.champ];
          const ap = this.worldPosOf(u, new THREE.Vector3(), 1.1);
          const yaw = simAngleToYaw(u.facing);
          const range = (u.stats.range + 80) * S;
          if (u.champ === 'camille') {
            this.fx.slash(ap, yaw, { color: heavy ? fx.heavy : fx.slash, radius: range + 0.4, arc: Math.PI * (heavy ? 1.6 : 0.8), duration: heavy ? 0.4 : 0.25, tilt: (view.anim.attackIndex % 2 ? 0.6 : -0.6), width: 0.4 });
          } else {
            this.fx.slash(ap, yaw, { color: heavy ? fx.heavy : fx.slash, radius: range + (heavy ? 0.6 : 0.3), arc: Math.PI * (heavy ? 1.0 : 0.8), duration: heavy ? 0.36 : 0.26, tilt: 1.2, pitch: 0.2, width: heavy ? 0.5 : 0.35 });
          }
          this.fx.burst(tp, { count: heavy ? 26 : 12, color: fx.slash, color2: 0xffffff, speed: heavy ? 6 : 4, life: 0.35, size: heavy ? 0.3 : 0.2, drag: 5 });
          this.sfx.hit(heavy, this.volumeAt(u));
          const tv = this.views.get(t.id);
          if (tv) tv.model.flash(0xffffff, heavy ? 1 : 0.7);
          if (heavy && (this.isMine(u.id) || this.isMine(t.id))) this.shake(0.12);
          if (ev.label === 'garen_q' && t.kind === 'champion') this.fx.ring(tp, { color: 0xffd36b, to: 1.6, duration: 0.35 });
        } else {
          this.fx.burst(tp, { count: 4, color: 0xffe0b0, speed: 2.5, life: 0.2, size: 0.13 });
          const tv = this.views.get(t.id);
          if (tv) tv.model.flash(0xffffff, 0.4);
          if (this.volumeAt(u) > 0.3) this.sfx.minionHit(this.volumeAt(u) * 0.4);
        }
        break;
      }
      case 'damage': this.onDamage(ev); break;
      case 'heal': {
        const t = g.byId.get(ev.tgt);
        if (t && t.kind === 'champion' && ev.amount >= 5) {
          const p = this.worldPosOf(t, new THREE.Vector3(), (this.views.get(t.id)?.height ?? 2) + 0.2);
          this.overlay.floatText(p, `+${Math.round(ev.amount)}`, { color: '#6dff8a', size: 16 });
        }
        break;
      }
      case 'shield': {
        const t = g.byId.get(ev.tgt);
        if (t) this.sfx.spell('shield');
        break;
      }
      case 'cast': this.onCast(ev, u, view); break;
      case 'spin_tick': {
        if (!view) break;
        this.fx.burst(new THREE.Vector3(view.root.position.x, 0.9, view.root.position.z), { count: 6, color: 0xcfe6ff, speed: 6, life: 0.25, size: 0.18, flat: true, radius: 1.5 });
        this.sfx.spell('spin');
        break;
      }
      case 'garen_r': {
        const t = g.byId.get(ev.target);
        if (!t) break;
        this.fx.demacianSword(() => this.worldPosOf(t, new THREE.Vector3()), 0);
        this.sfx.spell('heavy');
        break;
      }
      case 'darius_q': {
        if (!view) break;
        const p = view.root.position;
        this.fx.slash(new THREE.Vector3(p.x, 1.0, p.z), view.yaw, { color: 0xff2a1a, radius: 4.4, arc: Math.PI * 2, width: 0.45, duration: 0.45, sweep: 0.35, flip: true });
        this.fx.ring(p, { color: 0xff3020, from: 1, to: 4.6, duration: 0.4 });
        this.fx.burst(new THREE.Vector3(p.x, 1, p.z), { count: 40, color: 0xaa0010, color2: 0xff3a2a, speed: 7, life: 0.5, size: 0.22, flat: true, radius: 2.5, gravity: 4 });
        this.sfx.swing(true);
        this.sfx.hit(true, this.volumeAt(u));
        if (this.isMine(u.id)) this.shake(0.15);
        break;
      }
      case 'darius_e': {
        if (!view) break;
        const p = view.root.position;
        this.fx.cone(p, simAngleToYaw(ev.angle), { half: 25 * Math.PI / 180, radius: 5.35, color: 0xff3020, opacity: 0.5, duration: 0.35 });
        this.sfx.spell('whoosh');
        break;
      }
      case 'darius_r_hit': {
        const t = g.byId.get(ev.target);
        if (!t) break;
        const p = this.worldPosOf(t, new THREE.Vector3(), 1.2);
        this.fx.slash(p, simAngleToYaw(u.facing), { color: 0xff1a10, radius: 2.4, arc: Math.PI * 1.1, width: 0.6, duration: 0.45, pitch: Math.PI / 2 });
        this.fx.ring(p, { color: 0xff2010, to: 3.5, duration: 0.45 });
        this.fx.burst(p, { count: 60, color: 0x9a0010, color2: 0xff4020, speed: 8, life: 0.6, size: 0.3, gravity: 7, up: 2 });
        this.sfx.boom();
        this.shake(0.4);
        break;
      }
      case 'darius_r_reset':
        if (view) this.overlay.floatText(this.worldPosOf(u, new THREE.Vector3(), 3), '断头台刷新!', { color: '#ff4a2a', size: 22, life: 1.4 });
        break;
      case 'noxian_might':
        if (view) { this.fx.ring(view.root.position, { color: 0xff2010, to: 3, duration: 0.6 }); this.sfx.spell('heavy'); }
        break;
      case 'camille_w': {
        if (!view) break;
        const p = view.root.position;
        const yaw = simAngleToYaw(ev.angle);
        this.fx.slash(new THREE.Vector3(p.x, 0.6, p.z), yaw, { color: 0x6fe9ff, radius: 6.1, arc: 80 * Math.PI / 180, width: 0.5, duration: 0.35 });
        this.fx.cone(p, yaw, { half: 40 * Math.PI / 180, radius: 6.1, inner: 3.05, color: 0x48e3ff, opacity: 0.4, duration: 0.3 });
        this.sfx.swing(true);
        break;
      }
      case 'camille_hook': this.sfx.spell('hex'); break;
      case 'camille_hook_attach': {
        if (view) view.hookPoint = { x: ev.x, y: ev.y };
        simToWorld(ev.x, ev.y, _w);
        this.fx.burst({ x: _w.x, y: 1.1, z: _w.z }, { count: 18, color: 0x6fe9ff, color2: 0xffffff, speed: 4, life: 0.3, size: 0.2 });
        break;
      }
      case 'camille_e2_land': {
        simToWorld(ev.x, ev.y, _w);
        this.fx.ring({ x: _w.x, z: _w.z }, { color: 0x6fe9ff, to: 2.2, duration: 0.35 });
        this.fx.burst({ x: _w.x, y: 0.8, z: _w.z }, { count: 30, color: 0x6fe9ff, color2: 0xffffff, speed: 6, life: 0.4, size: 0.22 });
        this.sfx.hit(true, this.volumeAt(u));
        if (ev.hit >= 0) this.shake(0.2);
        break;
      }
      case 'camille_r_land': {
        simToWorld(ev.x, ev.y, _w);
        this.fx.ring({ x: _w.x, z: _w.z }, { color: 0x48e3ff, to: 4.5, duration: 0.5 });
        this.fx.burst({ x: _w.x, y: 0.5, z: _w.z }, { count: 50, color: 0x48e3ff, color2: 0xffffff, speed: 7, life: 0.5, size: 0.25, flat: true });
        this.sfx.spell('hex');
        this.sfx.hit(true);
        this.shake(0.25);
        break;
      }
      case 'flash': {
        for (const pt of [ev.from, ev.to]) {
          simToWorld(pt.x, pt.y, _w);
          this.fx.burst({ x: _w.x, y: 1, z: _w.z }, { count: 22, color: 0xfff2a0, color2: 0xffffff, speed: 3.5, life: 0.35, size: 0.22 });
        }
        if (view) { view.root.position.set(_w.x, 0, _w.z); view.prev = null; }
        this.sfx.flash();
        break;
      }
      case 'ignite': {
        const t = g.byId.get(ev.target);
        if (t) this.fx.burst(this.worldPosOf(t, new THREE.Vector3(), 1), { count: 25, color: 0xff6a10, color2: 0xffd040, speed: 3, life: 0.5, size: 0.3, up: 2 });
        this.sfx.spell('whoosh');
        break;
      }
      case 'death': this.onDeath(ev, u, view); break;
      case 'respawn':
        if (view) { view.anim.deadT = 0; view.prev = null; view.root.position.y = 0; view.trail = u.hp; }
        if (u && this.isMine(u.id)) this.hud.pushAnnounce('你已复活', 'gold');
        break;
      case 'gold':
        if (this.isMine(ev.id)) {
          simToWorld(ev.x, ev.y, _w);
          this.overlay.floatText({ x: _w.x, y: 1.6, z: _w.z }, `+${ev.amount}`, { color: '#ffd84a', size: 16, rise: 50 });
          this.sfx.coin();
        }
        break;
      case 'level_up':
        if (view) {
          this.fx.ring(view.root.position, { color: 0xffd36b, to: 2.2, duration: 0.6 });
          this.fx.burst(new THREE.Vector3(view.root.position.x, 0.2, view.root.position.z), { count: 30, color: 0xffd36b, color2: 0xfff6d0, speed: 1.2, up: 3.5, life: 0.9, size: 0.18, radius: 0.8 });
          if (this.isMine(ev.id)) { this.sfx.levelUp(); if (ev.level === 6) this.hud.pushAnnounce('大招已解锁 — Ctrl+R 升级', 'gold'); }
        }
        break;
      case 'proj_hit': {
        simToWorld(ev.x, ev.y, _w);
        const big = ev.kind === 'tower';
        this.fx.burst({ x: _w.x, y: big ? 1.1 : 0.6, z: _w.z }, { count: big ? 20 : 6, color: big ? 0xffffff : 0xffe2a0, speed: big ? 5 : 2.5, life: 0.3, size: big ? 0.3 : 0.15 });
        if (big) { this.sfx.zap(); const t = g.byId.get(ev.target); if (t && this.isMine(t.id)) this.shake(0.15); }
        break;
      }
      case 'tower_aggro':
        if (this.isMine(ev.target)) this.hud.pushAnnounce('防御塔正在攻击你！', 'red');
        break;
      case 'relic': {
        simToWorld(ev.x, ev.y, _w);
        this.fx.burst({ x: _w.x, y: 0.8, z: _w.z }, { count: 30, color: 0x6dff8a, color2: 0xffffff, speed: 3, life: 0.6, size: 0.25, up: 1.5 });
        this.sfx.spell('shield');
        break;
      }
      case 'wave':
        if (ev.n === 1 && this.mode !== 'replay') this.hud.pushAnnounce('小兵已出击！', 'gold');
        break;
      case 'game_over': this.onGameOver(ev); break;
    }
  }

  onCast(ev, u, view) {
    if (!u || u.kind !== 'champion') return;
    const slot = ev.slot;
    if (view && !(u.champ === 'garen' && slot === 'E') && !(u.champ === 'camille' && slot === 'E' && ev.recast)) {
      const ct = ev.castTime || 0;
      view.anim.action = { name: 'cast_' + slot, start: this.realTime, windup: ct, dur: Math.max(0.45, ct + 0.4) };
    }
    if (!view) return;
    const p = view.root.position;
    const key = `${u.champ}_${slot}`;
    switch (key) {
      case 'garen_Q':
        this.fx.burst(new THREE.Vector3(p.x, 0.8, p.z), { count: 24, color: 0xffd36b, color2: 0xffffff, speed: 3, life: 0.4, size: 0.2 });
        this.sfx.spell('whoosh');
        break;
      case 'garen_W':
        this.fx.ring(p, { color: 0xffd36b, to: 2.0, duration: 0.5 });
        break;
      case 'garen_E':
        if (u.s.spin) {
          this.fx.whirl(() => (u.s.spin && u.alive ? this.views.get(u.id)?.root.position : null), { radius: 3.25, color: 0xcfe6ff });
          this.sfx.spell('whoosh');
        }
        break;
      case 'darius_Q': {
        const z = this.fx.zone({ radius: 4.25, color: 0xff2a1a, fill: 0.05, segments: 48 });
        z.group.position.set(p.x, 0.04, p.z);
        this.fx.add({
          update: () => {
            const vv = this.views.get(u.id);
            if (vv) z.group.position.set(vv.root.position.x, 0.04, vv.root.position.z);
            const going = !!(u.cast && u.cast.slot === 'Q');
            if (!going) z.kill();
            return going;
          },
          dispose: () => {},
        });
        this.sfx.spell('heavy');
        break;
      }
      case 'darius_W':
        this.fx.burst(new THREE.Vector3(p.x, 1.4, p.z), { count: 14, color: 0xff3a2a, speed: 2, life: 0.4, size: 0.2 });
        break;
      case 'darius_R':
        this.sfx.spell('heavy');
        break;
      case 'camille_W':
        this.fx.cone(p, simAngleToYaw(Math.atan2(ev.y - u.y, ev.x - u.x)), { half: 40 * Math.PI / 180, radius: 6.1, color: 0x48e3ff, opacity: 0.18, duration: 0.75, grow: true });
        this.sfx.spell('hex');
        break;
      case 'camille_Q':
        this.fx.burst(new THREE.Vector3(p.x, 0.5, p.z), { count: 16, color: 0x48e3ff, color2: 0xffffff, speed: 2.5, life: 0.35, size: 0.18 });
        this.sfx.spell('hex');
        break;
      case 'camille_R':
        this.sfx.spell('whoosh');
        break;
    }
  }

  onDamage(ev) {
    const g = this.game;
    const t = g.byId.get(ev.tgt);
    const s = ev.src >= 0 ? g.byId.get(ev.src) : null;
    if (!t || ev.amount + (ev.absorbed || 0) < 1) return;
    const tv = this.views.get(t.id);
    if (tv) { tv.trailHold = 0.35; if (tv.trail < t.hp + ev.amount) tv.trail = Math.min(t.stats.maxHp, t.hp + ev.amount); }
    const sv = this.structViews.find((x) => x.unit === t);
    if (sv) sv.trail = Math.max(sv.trail, t.hp + ev.amount);
    const playing = this.mode === 'play' || this.mode === 'practice';
    const mineSrc = playing ? s && s.id === this.me.id : s && s.kind === 'champion';
    const mineTgt = playing ? t.id === this.me.id : false;
    if (!mineSrc && !mineTgt) return;
    if (ev.label === 'sunfire' && !mineTgt) return;
    const h = tv ? tv.height : t.kind === 'tower' ? 5 : 3;
    const pos = this.worldPosOf(t, new THREE.Vector3(), h + 0.1);
    pos.x += (Math.random() - 0.5) * 0.6;
    const amt = Math.round(ev.amount + (ev.absorbed || 0));
    let color = ev.dmgType === 'magic' ? '#b48cff' : ev.dmgType === 'true' ? '#ffffff' : '#ffb347';
    if (mineTgt) color = '#ff4a4a';
    const big = ['garen_r', 'darius_r', 'camille_q2_true', 'darius_q_blade', 'camille_w_outer', 'garen_q'].includes(ev.label);
    this.overlay.floatText(pos, String(amt), { color, size: Math.min(30, 15 + amt / 30) * (big ? 1.2 : 1), crit: big, life: big ? 1.2 : 0.9 });
  }

  onDeath(ev, u, view) {
    const g = this.game;
    if (!u) return;
    if (u.kind === 'champion') {
      const p = this.worldPosOf(u, new THREE.Vector3(), 1);
      this.fx.burst(p, { count: 50, color: u.team === 0 ? 0x5ab0ff : 0xff5050, color2: 0xffffff, speed: 4, life: 0.8, size: 0.25, up: 1 });
      this.sfx.death();
      if (this.mode === 'play' || this.mode === 'practice') {
        if (u.id === this.me.id) this.hud.pushAnnounce('你已被击杀', 'red');
        else this.hud.pushAnnounce(g.totals[this.playerTeam].kills === 1 && g.totals[1 - this.playerTeam].kills === 0 ? '第一滴血！' : '你击杀了一名敌人！', 'gold');
      } else this.hud.pushAnnounce(`${u.def.name} 被击杀`, u.team === 0 ? 'blue' : 'red');
    } else if (u.kind === 'minion') {
      const p = this.worldPosOf(u, new THREE.Vector3(), 0.5);
      this.fx.burst(p, { count: 10, color: u.team === 0 ? 0x5ab0ff : 0xff6070, speed: 2, life: 0.5, size: 0.18, up: 1 });
    } else if (u.kind === 'tower' || u.kind === 'nexus') {
      const sv = this.structViews.find((x) => x.unit === u);
      if (sv) {
        sv.model.setDestroyed(true);
        const p = sv.model.root.position;
        const big = u.kind === 'nexus';
        for (let i = 0; i < (big ? 4 : 2); i++) {
          this.fx.burst(new THREE.Vector3(p.x, 2 + i, p.z), { count: big ? 140 : 70, color: GLOW[u.team], color2: 0xffffff, speed: big ? 12 : 8, life: 1.2, size: 0.45, gravity: 6, up: 4 });
        }
        this.fx.burst(new THREE.Vector3(p.x, 0.5, p.z), { count: 80, color: 0x8a8f99, speed: 6, life: 1.4, size: 0.4, gravity: 8, up: 4 });
        this.fx.ring(p, { color: GLOW[u.team], to: big ? 12 : 7, duration: 0.8 });
        this.sfx.boom(big);
        this.shake(big ? 0.6 : 0.35);
      }
      if (u.kind === 'tower') this.hud.pushAnnounce(u.team === this.playerTeam ? '我方防御塔已被摧毁' : '敌方防御塔已被摧毁', u.team === this.playerTeam ? 'red' : 'gold');
    }
  }

  onGameOver(ev) {
    const g = this.game;
    const won = ev.winner === this.playerTeam;
    const [a, b] = g.champions;
    const stats = `<table>
      <tr><th></th><th>${a.def.name}</th><th>${b.def.name}</th></tr>
      <tr><td>击杀/死亡</td><td>${a.kills}/${a.deaths}</td><td>${b.kills}/${b.deaths}</td></tr>
      <tr><td>补刀</td><td>${a.cs}</td><td>${b.cs}</td></tr>
      <tr><td>等级</td><td>${a.level}</td><td>${b.level}</td></tr>
      <tr><td>对英雄伤害</td><td>${Math.round(g.totals[0].dmgToChamp)}</td><td>${Math.round(g.totals[1].dmgToChamp)}</td></tr>
      <tr><td>时长</td><td colspan="2">${Math.floor(g.time / 60)}分${Math.floor(g.time % 60)}秒</td></tr></table>`;
    setTimeout(() => {
      if (this.disposed) return;
      if (this.mode === 'play' || this.mode === 'practice') this.hud.showEnd(won, stats);
      else this.hud.showEnd(true, `<div>${ev.winner === 0 ? '蓝方' : ev.winner === 1 ? '红方' : '平局'} 获胜</div>` + stats);
    }, 1800);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.input.dispose();
    this.hud.dispose();
    this.overlay.dispose();
    this.rig.dispose();
  }
}
