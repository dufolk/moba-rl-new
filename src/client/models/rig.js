import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const JOINTS = [
  'hips', 'torso', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR', 'weapon',
];

export function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...opts });
}
export const metal = (color, opts = {}) => std(color, { roughness: 0.28, metalness: 0.9, ...opts });
export const cloth = (color, opts = {}) => std(color, { roughness: 0.85, metalness: 0.0, ...opts });
export const glow = (color, intensity = 2.5, opts = {}) => std(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.2, ...opts });

export function rbox(w, h, d, r = 0.04, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
}

export function lathe(profile, segs = 16, phiStart = 0, phiLen = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segs, phiStart, phiLen);
}

export function extrude(points, depth, bevel = 0.015) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Add a mesh to parent. */
export function part(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = null) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scale) m.scale.set(...(Array.isArray(scale) ? scale : [scale, scale, scale]));
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Limb segment hanging down from a joint (cylinder from y=0 to y=-len). */
export function limb(parent, len, r0, r1, mat, segs = 10) {
  const g = new THREE.CylinderGeometry(r0, r1, len, segs);
  g.translate(0, -len / 2, 0);
  return part(parent, g, mat);
}

const _e = new THREE.Euler();

/**
 * Procedural humanoid rig. Forward is +Z, right side is -X.
 * Poses are dictionaries { joint: [rx, ry, rz], bodyY, bodyRotY, tilt } blended per frame.
 */
export class Biped {
  constructor(p) {
    this.p = p;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const j = {};
    j.hips = new THREE.Group();
    j.hips.position.y = p.hipH;
    this.body.add(j.hips);
    j.torso = new THREE.Group();
    j.hips.add(j.torso);
    j.neck = new THREE.Group();
    j.neck.position.y = p.torsoLen;
    j.torso.add(j.neck);
    j.head = new THREE.Group();
    j.head.position.y = p.neckLen;
    j.neck.add(j.head);
    for (const [s, sign] of [['L', 1], ['R', -1]]) {
      const sh = new THREE.Group();
      sh.position.set(sign * p.shoulderW, p.torsoLen * 0.86, 0);
      j.torso.add(sh);
      const el = new THREE.Group();
      el.position.y = -p.upperArm;
      sh.add(el);
      const ha = new THREE.Group();
      ha.position.y = -p.foreArm;
      el.add(ha);
      const hp = new THREE.Group();
      hp.position.set(sign * p.hipW, 0, 0);
      j.hips.add(hp);
      const kn = new THREE.Group();
      kn.position.y = -p.thigh;
      hp.add(kn);
      const ft = new THREE.Group();
      ft.position.y = -p.shin;
      kn.add(ft);
      j['shoulder' + s] = sh; j['elbow' + s] = el; j['hand' + s] = ha;
      j['hip' + s] = hp; j['knee' + s] = kn; j['foot' + s] = ft;
    }
    j.weapon = new THREE.Group();
    j.handR.add(j.weapon);
    this.j = j;
    this.cur = {};
    for (const k of JOINTS) this.cur[k] = [0, 0, 0];
    this.cur.bodyY = 0;
    this.cur.bodyRotY = 0;
    this.cur.tilt = 0;
  }

  /** Blend toward the target pose; stiffness k (1/s). Joints absent in target go to 0. */
  apply(target, dt, k = 16) {
    const a = 1 - Math.exp(-dt * k);
    for (const name of JOINTS) {
      const t = target[name] || ZERO;
      const c = this.cur[name];
      c[0] += (t[0] - c[0]) * a;
      c[1] += (t[1] - c[1]) * a;
      c[2] += (t[2] - c[2]) * a;
      this.j[name].rotation.set(c[0], c[1], c[2]);
    }
    this.cur.bodyY += ((target.bodyY || 0) - this.cur.bodyY) * a;
    this.cur.tilt += ((target.tilt || 0) - this.cur.tilt) * a;
    this.body.position.y = this.cur.bodyY;
    this.body.rotation.x = this.cur.tilt;
    if (target.spin != null) this.body.rotation.y = target.spin;
    else {
      this.cur.bodyRotY += ((target.bodyRotY || 0) - this.cur.bodyRotY) * a;
      this.body.rotation.y = this.cur.bodyRotY;
    }
  }
}

const ZERO = [0, 0, 0];

function collectMaterials(root) {
  const set = new Set();
  root.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial) set.add(o.material);
  });
  return [...set].map((m) => ({ m, e: m.emissive.clone(), i: m.emissiveIntensity }));
}

/** A rigged model: pose function + blending + hit flash. */
export class RigModel {
  constructor(rig, opts) {
    this.rig = rig;
    this.root = rig.root;
    this.height = opts.height;
    this.poseFn = opts.pose;
    this.extraUpdate = opts.update || null;
    this.parts = opts.parts || {};
    this.mats = collectMaterials(this.root);
    this.flashV = 0;
    this._flashing = false;
    this.flashColor = new THREE.Color(1, 1, 1);
  }

  flash(color = 0xffffff, v = 1) {
    this.flashColor.set(color);
    this.flashV = Math.max(this.flashV, v);
  }

  update(dt, st) {
    const target = this.poseFn(this, st);
    this.rig.apply(target, dt, target.k || 16);
    if (this.extraUpdate) this.extraUpdate(this, st, dt);
    if (this.flashV > 0.001 || this._flashing) {
      this.flashV *= Math.exp(-dt * 12);
      const v = this.flashV > 0.001 ? this.flashV : 0;
      for (const { m, e, i } of this.mats) {
        m.emissive.copy(e).lerp(this.flashColor, v);
        m.emissiveIntensity = i + (1.6 - i) * v;
      }
      this._flashing = v > 0;
    }
  }
}

export const ease = {
  out: (t) => 1 - (1 - t) * (1 - t),
  in: (t) => t * t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a, b, t) => a + (b - a) * t;
export function mixPose(a, b, t) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (Array.isArray(va) || Array.isArray(vb)) {
      const x = va || ZERO, y = vb || ZERO;
      out[k] = [mix(x[0], y[0], t), mix(x[1], y[1], t), mix(x[2], y[2], t)];
    } else out[k] = mix(va || 0, vb || 0, t);
  }
  return out;
}

/** Standard locomotion layer: idle breathing or run cycle. */
export function locomotion(state, time, opts = {}) {
  const s = Math.min(1, state.speed / 3.2);
  const ph = state.phase;
  const sw = opts.swing ?? 0.75;
  const breathe = Math.sin(time * 2.2) * 0.03;
  const pose = {
    hipL: [-Math.sin(ph) * sw * s, 0, 0.03],
    hipR: [Math.sin(ph) * sw * s, 0, -0.03],
    kneeL: [Math.max(0, Math.sin(ph + 1.4)) * 1.1 * s + 0.08, 0, 0],
    kneeR: [Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 1.1 * s + 0.08, 0, 0],
    footL: [-0.1 * s, 0, 0],
    footR: [-0.1 * s, 0, 0],
    shoulderL: [Math.sin(ph) * 0.6 * s + breathe, 0, 0.12],
    shoulderR: [-Math.sin(ph) * 0.5 * s - breathe, 0, -0.12],
    elbowL: [-0.35 - 0.3 * s, 0, 0],
    elbowR: [-0.45 - 0.3 * s, 0, 0],
    torso: [0.1 * s + breathe * 0.5, Math.sin(ph) * 0.12 * s, 0],
    neck: [-0.06 * s, -Math.sin(ph) * 0.08 * s, 0],
    bodyY: Math.abs(Math.cos(ph)) * 0.07 * s + breathe * 0.4 - 0.04 * s,
    tilt: 0.06 * s,
  };
  return pose;
}
