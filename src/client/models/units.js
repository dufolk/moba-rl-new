import * as THREE from 'three';
import { Biped, RigModel, std, metal, cloth, glow, rbox, part, limb, locomotion, ease, clamp01, mix } from './rig.js';
import { radialTexture } from '../textures.js';

const PALETTE = [
  { armor: 0x2f63c8, trim: 0xd9b45a, cloth: 0x1c3570, glow: 0x55c8ff },
  { armor: 0xa3283a, trim: 0x3a2a2a, cloth: 0x5a1630, glow: 0xff5a7a },
];

let glowTex = null;
function getGlowTex() {
  if (!glowTex) glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  return glowTex;
}

export function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.set(size, size, 1);
  return s;
}

function minionDeath(st) {
  const t = clamp01(st.deadT / 0.5);
  return { tilt: -1.4 * ease.out(t), bodyY: -0.1 * t, k: 12 };
}

function minionAttack(st, base) {
  const a = st.action;
  if (!a || a.name !== 'attack') return null;
  const p = (st.time - a.start) / Math.max(0.05, a.windup);
  if (p > 2.2) return null;
  if (p < 1) {
    const e = ease.out(p);
    return { ...base, shoulderR: [-2.0 * e, 0, -0.3], elbowR: [-0.8 * e, 0, 0], torso: [0, 0.4 * e, 0], k: 22 };
  }
  const q = ease.out(clamp01((p - 1) / 0.5));
  return { ...base, shoulderR: [mix(-2.0, -0.3, q), 0, 0.2], torso: [0.15, mix(0.4, -0.4, q), 0], k: 30 };
}

function buildMelee(team) {
  const P = PALETTE[team];
  const rig = new Biped({ hipH: 0.5, torsoLen: 0.38, neckLen: 0.06, shoulderW: 0.21, upperArm: 0.2, foreArm: 0.19, thigh: 0.25, shin: 0.25, hipW: 0.08 });
  const j = rig.j;
  const armor = metal(P.armor, { roughness: 0.35, metalness: 0.6 });
  const trim = metal(P.trim, { roughness: 0.3 });
  const dark = std(0x23262e, { roughness: 0.6 });
  part(j.torso, rbox(0.36, 0.32, 0.26, 0.07), armor, [0, 0.22, 0]);
  part(j.torso, rbox(0.38, 0.05, 0.28, 0.02), trim, [0, 0.07, 0]);
  part(j.head, new THREE.SphereGeometry(0.13, 14, 10), armor, [0, 0.1, 0]);
  part(j.head, rbox(0.16, 0.04, 0.05, 0.015), dark, [0, 0.1, 0.11]);
  part(j.head, new THREE.ConeGeometry(0.035, 0.22, 6), trim, [0, 0.26, -0.03], [-0.4, 0, 0]);
  for (const s of [1, -1]) part(j.torso, new THREE.SphereGeometry(0.09, 10, 8), trim, [s * 0.22, 0.33, 0], null, [1.2, 0.8, 1.1]);
  for (const S of ['L', 'R']) {
    limb(j['shoulder' + S], 0.2, 0.05, 0.045, armor);
    limb(j['elbow' + S], 0.18, 0.045, 0.05, dark);
    limb(j['hip' + S], 0.25, 0.06, 0.05, dark);
    limb(j['knee' + S], 0.24, 0.05, 0.045, armor);
    part(j['foot' + S], rbox(0.08, 0.05, 0.14, 0.02), dark, [0, 0, 0.03]);
  }
  part(j.handL, rbox(0.04, 0.3, 0.24, 0.02), armor, [0.04, -0.02, 0.05]);
  part(j.handL, rbox(0.045, 0.12, 0.1, 0.01), trim, [0.045, -0.02, 0.05]);
  const w = j.weapon;
  part(w, new THREE.BoxGeometry(0.04, 0.45, 0.012), metal(0xd0d6e0, { roughness: 0.2 }), [0, 0.28, 0]);
  part(w, rbox(0.14, 0.03, 0.04, 0.01), trim, [0, 0.05, 0]);
  return new RigModel(rig, {
    height: 1.0,
    pose(model, st) {
      if (st.dead) return minionDeath(st);
      const base = locomotion(st, st.time, { swing: 0.7 });
      base.weapon = [Math.PI / 2 - 0.3, 0, 0];
      base.shoulderL = [-0.5, 0, 0.2];
      base.elbowL = [-1.0, 0, 0];
      return minionAttack(st, base) || base;
    },
  });
}

function buildCaster(team) {
  const P = PALETTE[team];
  const rig = new Biped({ hipH: 0.48, torsoLen: 0.36, neckLen: 0.06, shoulderW: 0.17, upperArm: 0.2, foreArm: 0.19, thigh: 0.24, shin: 0.24, hipW: 0.07 });
  const j = rig.j;
  const robe = cloth(P.cloth, { side: THREE.DoubleSide });
  const trim = metal(P.trim, { roughness: 0.3 });
  const orbM = glow(P.glow, 3);
  part(j.hips, new THREE.ConeGeometry(0.26, 0.55, 12, 1, true), robe, [0, -0.2, 0]);
  part(j.torso, rbox(0.28, 0.32, 0.22, 0.08), robe, [0, 0.18, 0]);
  part(j.torso, rbox(0.3, 0.04, 0.24, 0.02), trim, [0, 0.03, 0]);
  part(j.head, new THREE.ConeGeometry(0.15, 0.32, 10), robe, [0, 0.15, -0.02]);
  part(j.head, new THREE.SphereGeometry(0.075, 10, 8), std(0x111111), [0, 0.07, 0.03]);
  for (const s of [1, -1]) part(j.head, new THREE.SphereGeometry(0.014, 6, 6), orbM, [s * 0.03, 0.08, 0.1]);
  for (const S of ['L', 'R']) {
    limb(j['shoulder' + S], 0.2, 0.05, 0.06, robe);
    limb(j['elbow' + S], 0.18, 0.06, 0.04, robe);
  }
  const w = j.weapon;
  part(w, new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), std(0x3b2a1e), [0, 0.15, 0]);
  const orb = part(w, new THREE.SphereGeometry(0.055, 12, 10), orbM, [0, 0.52, 0]);
  orb.add(glowSprite(P.glow, 0.45, 0.7));
  return new RigModel(rig, {
    height: 0.95,
    pose(model, st) {
      if (st.dead) return minionDeath(st);
      const base = locomotion(st, st.time, { swing: 0.25 });
      base.weapon = [0.2, 0, 0];
      base.elbowR = [-1.1, 0, 0];
      const a = st.action;
      if (a && a.name === 'attack') {
        const p = (st.time - a.start) / Math.max(0.05, a.windup);
        if (p < 1.6) return { ...base, shoulderR: [-1.6 * ease.out(clamp01(p)), 0, -0.1], elbowR: [-0.3, 0, 0], weapon: [1.2, 0, 0], k: 20 };
      }
      return base;
    },
  });
}

function buildCannon(team) {
  const P = PALETTE[team];
  const rig = new Biped({ hipH: 0.0, torsoLen: 0.3, neckLen: 0.0, shoulderW: 0.2, upperArm: 0.1, foreArm: 0.1, thigh: 0.01, shin: 0.01, hipW: 0.1 });
  const j = rig.j;
  const wood = std(0x5a3d26, { roughness: 0.8 });
  const armor = metal(P.armor, { roughness: 0.35 });
  const iron = metal(0x2c2f36, { roughness: 0.4 });
  part(j.torso, rbox(0.8, 0.32, 1.0, 0.06), wood, [0, 0.42, 0]);
  part(j.torso, rbox(0.84, 0.08, 1.04, 0.03), armor, [0, 0.6, 0]);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.72, 0.1);
  j.torso.add(barrel);
  part(barrel, new THREE.CylinderGeometry(0.13, 0.17, 0.9, 14), iron, [0, 0, 0.3], [Math.PI / 2 - 0.15, 0, 0]);
  part(barrel, new THREE.TorusGeometry(0.15, 0.03, 8, 14), armor, [0, 0.07, 0.72], [-0.15, 0, 0]);
  part(barrel, new THREE.SphereGeometry(0.2, 12, 10), iron, [0, 0, -0.15]);
  const wheels = [];
  for (const sx of [1, -1]) for (const sz of [0.32, -0.32]) {
    const wgrp = new THREE.Group();
    wgrp.position.set(sx * 0.45, 0.26, sz);
    j.torso.add(wgrp);
    part(wgrp, new THREE.CylinderGeometry(0.26, 0.26, 0.08, 14), wood, [0, 0, 0], [0, 0, Math.PI / 2]);
    part(wgrp, new THREE.TorusGeometry(0.26, 0.03, 6, 16), iron, [0, 0, 0], [0, Math.PI / 2, 0]);
    wheels.push(wgrp);
  }
  let roll = 0;
  return new RigModel(rig, {
    height: 1.1,
    pose(model, st) {
      if (st.dead) return { tilt: -0.4 * clamp01(st.deadT / 0.5), bodyY: -0.3 * clamp01(st.deadT), k: 8 };
      const a = st.action;
      let recoil = 0;
      if (a && a.name === 'attack') {
        const p = (st.time - a.start) / Math.max(0.05, a.windup);
        if (p >= 1 && p < 2) recoil = 1 - (p - 1);
      }
      return { torso: [-0.08 * recoil, 0, 0], bodyY: Math.abs(Math.sin(st.phase)) * 0.02 * Math.min(1, st.speed), k: 25 };
    },
    update(model, st, dt) {
      roll += st.speed * dt / 0.26;
      for (const w of wheels) w.rotation.x = roll;
    },
  });
}

export function createMinionModel(mtype, team) {
  const m = mtype === 'melee' ? buildMelee(team) : mtype === 'caster' ? buildCaster(team) : buildCannon(team);
  m.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return m;
}

// ------------------------------------------------------------ structures ----

export class TowerModel {
  constructor(team) {
    const P = PALETTE[team];
    this.team = team;
    this.root = new THREE.Group();
    const stone = std(0x98a2b2, { roughness: 0.7, metalness: 0.05 });
    const stoneDark = std(0x5a6272, { roughness: 0.8 });
    const trim = metal(team === 0 ? 0xd8b25a : 0x8a8f99, { roughness: 0.3 });
    const accent = metal(P.armor, { roughness: 0.35, metalness: 0.6 });
    this.crystalMat = glow(P.glow, 2.6, { transparent: true, opacity: 0.95 });
    const alive = new THREE.Group();
    this.alive = alive;
    this.root.add(alive);
    part(alive, new THREE.CylinderGeometry(1.05, 1.25, 0.5, 8), stoneDark, [0, 0.25, 0]);
    part(alive, new THREE.CylinderGeometry(0.85, 1.0, 0.4, 8), stone, [0, 0.7, 0]);
    part(alive, new THREE.CylinderGeometry(0.55, 0.72, 2.6, 8), stone, [0, 2.2, 0]);
    for (const y of [1.2, 2.3, 3.4]) part(alive, new THREE.CylinderGeometry(0.66 - (y - 1.2) * 0.05, 0.68 - (y - 1.2) * 0.05, 0.12, 8), trim, [0, y, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part(alive, rbox(0.22, 1.9, 0.18, 0.04), accent, [Math.cos(a) * 0.62, 2.0, Math.sin(a) * 0.62], [0, -a, 0]);
    }
    part(alive, new THREE.CylinderGeometry(0.85, 0.6, 0.35, 8), stone, [0, 3.7, 0]);
    this.claws = new THREE.Group();
    this.claws.position.y = 3.9;
    alive.add(this.claws);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const c = part(this.claws, new THREE.ConeGeometry(0.1, 1.2, 6), trim, [Math.cos(a) * 0.62, 0.5, Math.sin(a) * 0.62]);
      c.rotation.set(Math.sin(a) * -0.45, 0, Math.cos(a) * 0.45);
    }
    this.crystal = part(alive, new THREE.OctahedronGeometry(0.42, 0), this.crystalMat, [0, 4.9, 0], null, [1, 1.7, 1]);
    this.glow = glowSprite(P.glow, 2.2, 0.4);
    this.glow.position.y = 4.9;
    alive.add(this.glow);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.02, 6, 40), glow(P.glow, 0.6));
    this.ring.position.y = 4.9;
    alive.add(this.ring);

    const rubble = new THREE.Group();
    this.rubble = rubble;
    rubble.visible = false;
    this.root.add(rubble);
    part(rubble, new THREE.CylinderGeometry(1.05, 1.25, 0.5, 8), stoneDark, [0, 0.25, 0]);
    part(rubble, new THREE.CylinderGeometry(0.6, 0.75, 0.9, 8), stoneDark, [0, 0.9, 0], [0.1, 0, 0.08]);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      part(rubble, new THREE.DodecahedronGeometry(0.2 + (i % 3) * 0.1, 0), stoneDark, [Math.cos(a) * (0.9 + (i % 2) * 0.5), 0.15, Math.sin(a) * (0.9 + (i % 2) * 0.5)], [a, a * 2, 0]);
    }
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.shotPulse = 0;
    this.height = 5.3;
  }

  setDestroyed(d) {
    this.alive.visible = !d;
    this.rubble.visible = d;
  }

  pulse() {
    this.shotPulse = 1;
  }

  update(dt, t, aggroOnPlayer, vulnerable) {
    this.shotPulse *= Math.exp(-dt * 6);
    this.crystal.rotation.y = t * 0.9;
    this.crystal.position.y = 4.9 + Math.sin(t * 1.7) * 0.12;
    this.glow.position.y = this.crystal.position.y;
    this.ring.position.y = this.crystal.position.y;
    this.ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.8) * 0.4;
    this.ring.rotation.y = t * 1.3;
    const s = 2.2 + this.shotPulse * 1.6 + (aggroOnPlayer ? 0.6 + Math.sin(t * 12) * 0.3 : 0);
    this.glow.scale.set(s, s, 1);
    this.crystalMat.emissiveIntensity = (vulnerable ? 1.1 : 0.65) + this.shotPulse * 1.5;
  }
}

export class NexusModel {
  constructor(team) {
    const P = PALETTE[team];
    this.root = new THREE.Group();
    const stone = std(0xc4cbd6, { roughness: 0.6 });
    const trim = metal(team === 0 ? 0xd8b25a : 0x9da3ad, { roughness: 0.3 });
    const accent = metal(P.armor, { roughness: 0.35, metalness: 0.6 });
    this.crystalMat = glow(P.glow, 2.4, { transparent: true, opacity: 0.92 });
    part(this.root, new THREE.CylinderGeometry(2.4, 2.7, 0.4, 12), std(0x6d7686, { roughness: 0.8 }), [0, 0.2, 0]);
    part(this.root, new THREE.CylinderGeometry(1.9, 2.2, 0.5, 12), stone, [0, 0.62, 0]);
    part(this.root, new THREE.TorusGeometry(2.05, 0.08, 8, 48), trim, [0, 0.9, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(this.root, rbox(0.35, 2.0, 0.35, 0.06), stone, [Math.cos(a) * 1.75, 1.8, Math.sin(a) * 1.75]);
      part(this.root, new THREE.ConeGeometry(0.22, 0.5, 6), accent, [Math.cos(a) * 1.75, 3.05, Math.sin(a) * 1.75]);
    }
    this.crystal = part(this.root, new THREE.OctahedronGeometry(1.0, 0), this.crystalMat, [0, 3.2, 0], null, [1, 1.6, 1]);
    this.shards = new THREE.Group();
    this.shards.position.y = 3.2;
    this.root.add(this.shards);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(this.shards, new THREE.OctahedronGeometry(0.28, 0), this.crystalMat, [Math.cos(a) * 1.8, Math.sin(i * 2) * 0.3, Math.sin(a) * 1.8], null, [0.7, 1.5, 0.7]);
    }
    this.glow = glowSprite(P.glow, 7, 0.65);
    this.glow.position.y = 3.2;
    this.root.add(this.glow);
    this.light = new THREE.PointLight(P.glow, 25, 14, 1.6);
    this.light.position.y = 3.5;
    this.root.add(this.light);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.height = 5.2;
  }

  setDestroyed(d) {
    this.crystal.visible = !d;
    this.shards.visible = !d;
    this.glow.visible = !d;
    this.light.intensity = d ? 0 : 25;
  }

  update(dt, t, vulnerable) {
    this.crystal.rotation.y = t * 0.4;
    this.crystal.position.y = 3.2 + Math.sin(t * 1.1) * 0.15;
    this.shards.rotation.y = -t * 0.6;
    this.crystalMat.emissiveIntensity = vulnerable ? 2.4 + Math.sin(t * 5) * 0.6 : 1.8;
  }
}

export class RelicModel {
  constructor() {
    this.root = new THREE.Group();
    const m = glow(0x6dff9a, 2.2, { transparent: true, opacity: 0.9 });
    this.orb = part(this.root, new THREE.IcosahedronGeometry(0.28, 1), m, [0, 0.8, 0]);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 6, 32), glow(0xb8ffcf, 2));
    this.ring.position.y = 0.8;
    this.root.add(this.ring);
    this.glow = glowSprite(0x5dff8f, 2.0, 0.6);
    this.glow.position.y = 0.8;
    this.root.add(this.glow);
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({ color: 0x4dff88, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.03;
    this.root.add(base);
  }

  update(dt, t, available) {
    this.root.visible = available;
    this.orb.position.y = 0.8 + Math.sin(t * 2.4) * 0.1;
    this.orb.rotation.y = t;
    this.ring.rotation.x = Math.PI / 2 + Math.sin(t) * 0.3;
    this.ring.rotation.z = t * 1.5;
  }
}
