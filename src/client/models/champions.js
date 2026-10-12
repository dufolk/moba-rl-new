import * as THREE from 'three';
import {
  Biped, RigModel, std, metal, cloth, glow, rbox, part, limb, locomotion, ease, clamp01, mix, mixPose,
} from './rig.js';

// ------------------------------------------------------------- helpers ----

function dome(r, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(sx, sy, sz);
  return g;
}

function shapeGeo(build, depth, bevel = 0.012) {
  const s = new THREE.Shape();
  build(s);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

const ChampionModel = RigModel;

/** Generic weapon-swing used by Garen/Darius basic attacks. p: 0..1 windup, >1 follow-through. */
function overheadSwing(p, heavy = 1) {
  if (p < 1) {
    const e = ease.out(p);
    return {
      shoulderR: [-2.3 * e * heavy, 0, -0.55 * e], elbowR: [-1.0 * e, 0, 0], torso: [-0.1 * e, 0.55 * e, 0],
      shoulderL: [-0.4 * e, 0, 0.35], elbowL: [-0.8, 0, 0], weapon: [Math.PI / 2 - 0.6 * e, 0, 0],
      hipL: [-0.35 * e, 0, 0.05], kneeL: [0.4 * e, 0, 0], hipR: [0.25 * e, 0, -0.05], kneeR: [0.3, 0, 0],
      bodyY: -0.05 * e, k: 22,
    };
  }
  const q = clamp01((p - 1) / 0.6);
  const e = ease.out(q);
  return {
    shoulderR: [mix(-2.3 * heavy, -0.35, e), 0, mix(-0.55, 0.45, e)], elbowR: [mix(-1.0, -0.15, e), 0, 0],
    torso: [mix(-0.1, 0.25, e), mix(0.55, -0.6, e), 0], shoulderL: [0.2, 0, 0.5], elbowL: [-0.6, 0, 0],
    weapon: [Math.PI / 2 + 0.2 * e, 0, 0], hipL: [-0.5, 0, 0.05], kneeL: [0.55, 0, 0], hipR: [0.35, 0, -0.05], kneeR: [0.35, 0, 0],
    bodyY: -0.12 * e, k: 30,
  };
}

function deathPose(st) {
  const t = clamp01(st.deadT / 0.7);
  return {
    tilt: -1.45 * ease.out(t), bodyY: -0.2 * t, shoulderL: [-0.6, 0, 1.0], shoulderR: [-0.6, 0, -1.0],
    hipL: [-0.4, 0, 0.1], hipR: [-0.2, 0, -0.1], kneeL: [0.5, 0, 0], kneeR: [0.7, 0, 0], neck: [0.4, 0, 0], k: 10,
  };
}

function actionProgress(st) {
  const a = st.action;
  if (!a) return null;
  const el = st.time - a.start;
  return { a, el, p: a.windup > 0 ? el / a.windup : el / Math.max(0.01, a.dur) };
}

function withAction(base, act, st) {
  // fade the action pose in/out so it blends with locomotion
  const a = act.a;
  const w = clamp01((a.dur - act.el) / 0.15);
  return w >= 1 ? act.pose : mixPose(base, act.pose, w);
}

// --------------------------------------------------------------- Garen ----

function buildGaren(team) {
  const rig = new Biped({ hipH: 1.0, torsoLen: 0.74, neckLen: 0.12, shoulderW: 0.4, upperArm: 0.38, foreArm: 0.36, thigh: 0.5, shin: 0.5, hipW: 0.15 });
  const j = rig.j;
  const steel = metal(0x8c97aa, { roughness: 0.42 });
  const blue = metal(0x2c4f96, { roughness: 0.38, metalness: 0.65 });
  const gold = metal(0xdcae4c, { roughness: 0.25 });
  const capeM = cloth(0x1d3a80, { side: THREE.DoubleSide });
  const skin = std(0xe0b08c, { roughness: 0.7 });
  const hair = std(0x4b3220, { roughness: 0.8 });
  const leather = cloth(0x4a3324);

  // torso
  part(j.torso, rbox(0.66, 0.5, 0.42, 0.1), blue, [0, 0.48, 0]);
  part(j.torso, rbox(0.52, 0.38, 0.1, 0.05), steel, [0, 0.52, 0.19]);
  part(j.torso, rbox(0.12, 0.3, 0.04, 0.02), gold, [0, 0.52, 0.25]);
  part(j.torso, rbox(0.5, 0.26, 0.34, 0.06), leather, [0, 0.14, 0]);
  part(j.torso, rbox(0.56, 0.07, 0.38, 0.03), gold, [0, 0.25, 0]);
  part(j.torso, new THREE.CylinderGeometry(0.17, 0.2, 0.12, 14), gold, [0, 0.74, 0]);
  for (const s of [1, -1]) {
    part(j.torso, dome(0.27, 1.25, 0.95, 1.15), steel, [s * 0.42, 0.66, 0], [0, 0, -s * 0.3]);
    part(j.torso, new THREE.TorusGeometry(0.27, 0.028, 8, 22), gold, [s * 0.42, 0.66, 0], [Math.PI / 2, -s * 0.3, 0], [1.25, 1.15, 1]);
    part(j.torso, dome(0.2, 1.2, 0.8, 1.1), blue, [s * 0.47, 0.55, 0], [0, 0, -s * 0.6]);
  }
  // cape
  const capeGeo = new THREE.PlaneGeometry(0.78, 1.35, 4, 10);
  capeGeo.translate(0, -0.675, 0);
  const cp = capeGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i), x = cp.getX(i);
    cp.setZ(i, -0.06 * y * y - 0.05 * Math.cos(x * 6));
    cp.setX(i, x * (1 + -y * 0.25));
  }
  capeGeo.computeVertexNormals();
  const capePivot = new THREE.Group();
  capePivot.position.set(0, 0.7, -0.22);
  j.torso.add(capePivot);
  part(capePivot, capeGeo, capeM);
  part(capePivot, rbox(0.8, 0.05, 0.05, 0.02), gold, [0, 0, 0.02]);

  // hips / tassets
  part(j.hips, rbox(0.46, 0.18, 0.32, 0.05), blue, [0, 0.02, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    part(j.hips, rbox(0.22, 0.3, 0.04, 0.02), i % 2 ? steel : blue, [Math.sin(a) * 0.22, -0.12, Math.cos(a) * 0.18], [0.2 * Math.cos(a), a, 0]);
  }
  // head
  part(j.neck, new THREE.CylinderGeometry(0.08, 0.09, 0.14, 10), skin, [0, 0.05, 0]);
  part(j.head, new THREE.SphereGeometry(0.15, 18, 14), skin, [0, 0.14, 0.01], null, [1, 1.08, 1]);
  part(j.head, rbox(0.2, 0.1, 0.16, 0.04), skin, [0, 0.05, 0.04]);
  part(j.head, new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, [0, 0.17, -0.015], [-0.25, 0, 0], [1.05, 1, 1.08]);
  for (let i = 0; i < 5; i++) part(j.head, new THREE.ConeGeometry(0.05, 0.16, 6), hair, [(i - 2) * 0.05, 0.27, -0.03 - Math.abs(i - 2) * 0.01], [-0.9, 0, (i - 2) * 0.3]);
  for (const s of [1, -1]) part(j.head, new THREE.SphereGeometry(0.018, 6, 6), std(0x1b2a4a), [s * 0.055, 0.15, 0.135]);
  // arms
  for (const S of ['L', 'R']) {
    limb(j['shoulder' + S], 0.38, 0.095, 0.085, blue);
    part(j['elbow' + S], new THREE.SphereGeometry(0.085, 10, 8), steel);
    limb(j['elbow' + S], 0.34, 0.09, 0.1, steel);
    part(j['elbow' + S], new THREE.TorusGeometry(0.1, 0.022, 6, 14), gold, [0, -0.28, 0], [Math.PI / 2, 0, 0]);
    part(j['hand' + S], rbox(0.11, 0.12, 0.11, 0.04), leather, [0, -0.04, 0]);
  }
  // legs
  for (const S of ['L', 'R']) {
    limb(j['hip' + S], 0.5, 0.12, 0.1, blue);
    part(j['knee' + S], new THREE.SphereGeometry(0.095, 10, 8), steel, [0, 0, 0.02]);
    limb(j['knee' + S], 0.46, 0.1, 0.085, steel);
    part(j['foot' + S], rbox(0.14, 0.1, 0.26, 0.04), steel, [0, 0.0, 0.06]);
  }
  // sword
  const w = j.weapon;
  w.rotation.x = Math.PI / 2;
  part(w, new THREE.CylinderGeometry(0.028, 0.03, 0.3, 8), leather, [0, 0, 0]);
  part(w, new THREE.SphereGeometry(0.05, 10, 8), gold, [0, -0.17, 0]);
  part(w, rbox(0.42, 0.06, 0.09, 0.025), gold, [0, 0.16, 0]);
  const blade = shapeGeo((s) => {
    s.moveTo(-0.085, 0); s.lineTo(0.085, 0); s.lineTo(0.075, 1.25); s.lineTo(0, 1.5); s.lineTo(-0.075, 1.25); s.lineTo(-0.085, 0);
  }, 0.03, 0.01);
  part(w, blade, steel, [0, 0.19, 0]);
  part(w, rbox(0.03, 1.1, 0.04, 0.01), std(0x4c5b75, { metalness: 0.8, roughness: 0.3 }), [0, 0.8, 0]);

  return new ChampionModel(rig, {
    height: 2.15,
    parts: { capePivot },
    pose: garenPose,
    update(model, st) {
      const run = Math.min(1, st.speed / 3.2);
      capePivot.rotation.x = 0.12 + run * 0.65 + Math.sin(st.time * 3.1) * 0.05 + (st.spinning ? 0.9 : 0);
    },
  });
}

function garenPose(model, st) {
  if (st.dead) return deathPose(st);
  const base = locomotion(st, st.time);
  base.weapon = [Math.PI / 2 + 0.35, 0, 0];
  base.shoulderR = [base.shoulderR[0] - 0.25, 0, -0.18];
  if (st.spinning) {
    return {
      ...base, spin: st.spinAngle, shoulderR: [-1.45, 0, -0.9], elbowR: [-0.1, 0, 0], weapon: [Math.PI / 2, 0, -0.2],
      shoulderL: [-0.6, 0, 1.0], elbowL: [-0.4, 0, 0], torso: [0.15, 0, 0], tilt: 0.12, k: 20,
    };
  }
  const act = actionProgress(st);
  if (act) {
    const { a, p } = act;
    if (a.name === 'attack') act.pose = overheadSwing(p, a.label === 'garen_q' ? 1.15 : 1);
    if (a.name === 'attack' && a.label === 'garen_q') {
      act.pose.bodyY = p < 1 ? 0.35 * Math.sin(Math.PI * clamp01(p)) : -0.1;
      act.pose.tilt = p < 1 ? -0.1 : 0.2;
    }
    if (a.name === 'cast_Q') act.pose = { ...base, shoulderR: [-0.9, 0, -0.3], weapon: [Math.PI / 2 - 0.9, 0, 0], torso: [0.25, 0, 0], tilt: 0.15, k: 20 };
    if (a.name === 'cast_W') act.pose = { ...base, shoulderL: [-1.3, 0.3, 0.6], elbowL: [-1.6, 0, 0], shoulderR: [-1.0, 0, -0.5], elbowR: [-1.4, 0, 0], weapon: [Math.PI / 2 + 1.0, 0, 0], torso: [0.25, 0, 0], kneeL: [0.6, 0, 0], kneeR: [0.6, 0, 0], hipL: [-0.4, 0, 0.1], hipR: [-0.3, 0, -0.1], bodyY: -0.15, k: 24 };
    if (a.name === 'cast_R') {
      const q = clamp01(p);
      act.pose = q < 0.8
        ? { ...base, shoulderR: [-3.0, 0, -0.1], elbowR: [-0.1, 0, 0], weapon: [0.2, 0, 0], shoulderL: [-0.3, 0, 0.6], torso: [-0.25, 0, 0], k: 18 }
        : { ...base, shoulderR: [-1.4, 0, -0.1], weapon: [Math.PI / 2 - 0.3, 0, 0], torso: [0.2, 0, 0], k: 30 };
    }
    if (act.pose) return withAction(base, act, st);
  }
  return base;
}

// -------------------------------------------------------------- Darius ----

function buildDarius(team) {
  const rig = new Biped({ hipH: 1.02, torsoLen: 0.8, neckLen: 0.12, shoulderW: 0.46, upperArm: 0.4, foreArm: 0.38, thigh: 0.5, shin: 0.52, hipW: 0.17 });
  const j = rig.j;
  const iron = metal(0x2c2f37, { roughness: 0.38, metalness: 0.85 });
  const ironHi = metal(0x4a4f5a, { roughness: 0.3 });
  const red = cloth(0x7a1218, { side: THREE.DoubleSide });
  const gold = metal(0xb98a33, { roughness: 0.3 });
  const skin = std(0xc69474, { roughness: 0.7 });
  const fur = cloth(0x3a2c25, { roughness: 1 });
  const beard = std(0x1c1512, { roughness: 0.9 });
  const ember = glow(0xff3b1a, 2.2);

  part(j.torso, rbox(0.78, 0.6, 0.46, 0.1), iron, [0, 0.48, 0]);
  part(j.torso, rbox(0.6, 0.42, 0.08, 0.04), ironHi, [0, 0.52, 0.21]);
  part(j.torso, new THREE.BoxGeometry(0.1, 0.6, 0.02), red, [0.05, 0.42, 0.26], [0, 0, 0.65]);
  part(j.torso, rbox(0.6, 0.26, 0.38, 0.06), iron, [0, 0.12, 0]);
  part(j.torso, rbox(0.66, 0.08, 0.42, 0.03), gold, [0, 0.23, 0]);
  part(j.torso, new THREE.TorusGeometry(0.22, 0.1, 10, 18), fur, [0, 0.8, -0.02], [Math.PI / 2, 0, 0], [1.2, 1, 0.9]);
  for (const s of [1, -1]) {
    const pa = new THREE.Group();
    pa.position.set(s * 0.5, 0.72, 0);
    pa.rotation.z = -s * 0.35;
    j.torso.add(pa);
    part(pa, dome(0.3, 1.25, 0.9, 1.15), iron);
    part(pa, dome(0.24, 1.2, 0.7, 1.1), ironHi, [s * 0.05, -0.12, 0], [0, 0, -s * 0.3]);
    for (let i = 0; i < 3; i++) part(pa, new THREE.ConeGeometry(0.06, 0.38 - i * 0.06, 6), ironHi, [s * (0.05 + i * 0.1), 0.2 - i * 0.04, -0.05 + i * 0.03], [-0.2, 0, -s * (0.2 + i * 0.35)]);
    part(pa, new THREE.TorusGeometry(0.3, 0.025, 6, 20), gold, [0, 0.01, 0], [Math.PI / 2, 0, 0], [1.25, 1.15, 1]);
  }
  // tabard + skirt
  part(j.hips, rbox(0.56, 0.2, 0.38, 0.05), iron, [0, 0.02, 0]);
  const tab = new THREE.PlaneGeometry(0.34, 0.78, 1, 4);
  tab.translate(0, -0.39, 0);
  part(j.hips, tab, red, [0, 0.0, 0.2], [0.08, 0, 0]);
  part(j.hips, tab, red, [0, 0.0, -0.2], [-0.08, 0, 0]);
  for (const s of [1, -1]) part(j.hips, rbox(0.2, 0.36, 0.3, 0.04), ironHi, [s * 0.26, -0.14, 0], [0, 0, s * 0.15]);
  // head
  part(j.neck, new THREE.CylinderGeometry(0.1, 0.11, 0.14, 10), skin, [0, 0.05, 0]);
  part(j.head, new THREE.SphereGeometry(0.155, 18, 14), skin, [0, 0.15, 0], null, [1, 1.05, 1.02]);
  part(j.head, rbox(0.22, 0.1, 0.17, 0.04), skin, [0, 0.06, 0.03]);
  part(j.head, new THREE.ConeGeometry(0.06, 0.16, 8), beard, [0, -0.02, 0.12], [Math.PI, 0, 0]);
  part(j.head, rbox(0.16, 0.025, 0.04, 0.01), beard, [0, 0.19, 0.135]);
  part(j.head, new THREE.SphereGeometry(0.157, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.35), beard, [0, 0.16, -0.02], [-0.6, 0, 0]);
  for (const s of [1, -1]) part(j.head, new THREE.SphereGeometry(0.016, 6, 6), ember, [s * 0.055, 0.155, 0.14]);
  // arms
  for (const S of ['L', 'R']) {
    limb(j['shoulder' + S], 0.4, 0.11, 0.1, skin);
    part(j['shoulder' + S], new THREE.TorusGeometry(0.105, 0.03, 6, 12), gold, [0, -0.14, 0], [Math.PI / 2, 0, 0]);
    part(j['elbow' + S], new THREE.SphereGeometry(0.1, 10, 8), iron);
    limb(j['elbow' + S], 0.36, 0.11, 0.12, iron);
    for (let i = 0; i < 2; i++) part(j['elbow' + S], new THREE.ConeGeometry(0.03, 0.14, 5), ironHi, [S === 'L' ? 0.1 : -0.1, -0.1 - i * 0.13, -0.02], [0, 0, S === 'L' ? -1.3 : 1.3]);
    part(j['hand' + S], rbox(0.13, 0.13, 0.13, 0.04), iron, [0, -0.04, 0]);
  }
  for (const S of ['L', 'R']) {
    limb(j['hip' + S], 0.5, 0.13, 0.11, iron);
    part(j['knee' + S], new THREE.SphereGeometry(0.1, 10, 8), ironHi, [0, 0, 0.03]);
    part(j['knee' + S], new THREE.ConeGeometry(0.04, 0.16, 5), ironHi, [0, 0.02, 0.1], [Math.PI / 2, 0, 0]);
    limb(j['knee' + S], 0.48, 0.11, 0.095, iron);
    part(j['foot' + S], rbox(0.16, 0.11, 0.28, 0.04), iron, [0, 0, 0.06]);
  }
  // axe (handle runs along +Y from the hand)
  const w = j.weapon;
  part(w, new THREE.CylinderGeometry(0.035, 0.04, 2.0, 8), std(0x2b1e18, { roughness: 0.7 }), [0, 0.55, 0]);
  part(w, new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), gold, [0, -0.42, 0]);
  part(w, new THREE.ConeGeometry(0.05, 0.18, 6), ironHi, [0, 1.62, 0]);
  const head = shapeGeo((s) => {
    s.moveTo(0, 0.0);
    s.lineTo(0.18, 0.06);
    s.quadraticCurveTo(0.42, -0.12, 0.62, -0.28);
    s.quadraticCurveTo(0.78, 0.18, 0.66, 0.66);
    s.quadraticCurveTo(0.42, 0.42, 0.18, 0.46);
    s.lineTo(0, 0.52);
    s.lineTo(-0.2, 0.36);
    s.lineTo(-0.32, 0.26);
    s.lineTo(-0.2, 0.16);
    s.lineTo(0, 0.0);
  }, 0.06, 0.015);
  head.rotateY(-Math.PI / 2);
  part(w, head, iron, [0, 1.05, 0]);
  const edge = shapeGeo((s) => {
    s.moveTo(0.62, -0.28);
    s.quadraticCurveTo(0.78, 0.18, 0.66, 0.66);
    s.quadraticCurveTo(0.72, 0.18, 0.58, -0.2);
    s.lineTo(0.62, -0.28);
  }, 0.07, 0.005);
  edge.rotateY(-Math.PI / 2);
  part(w, edge, ember, [0, 1.05, 0]);

  return new ChampionModel(rig, { height: 2.25, pose: dariusPose });
}

function dariusPose(model, st) {
  if (st.dead) return deathPose(st);
  const base = locomotion(st, st.time, { swing: 0.65 });
  base.shoulderR = [base.shoulderR[0] - 0.15, 0, -0.25];
  base.elbowR = [-0.9, 0, 0];
  base.weapon = [0.9, 0, 0];
  const act = actionProgress(st);
  if (act) {
    const { a, p, el } = act;
    if (a.name === 'attack') {
      const s = overheadSwing(p, a.label === 'darius_w' ? 1.2 : 1);
      s.weapon = [p < 1 ? 0.9 + 0.6 * clamp01(p) : 1.5, 0, 0];
      act.pose = s;
    }
    if (a.name === 'cast_Q') {
      const wind = clamp01(el / 0.75);
      if (el < 0.75) {
        act.pose = { ...base, torso: [0.05, 1.3 * ease.out(wind), 0], shoulderR: [-1.3, 0, -1.2 * wind], elbowR: [-0.3, 0, 0], weapon: [1.4, 0, 0], shoulderL: [-0.8, 0, 0.6], k: 14 };
      } else {
        const q = clamp01((el - 0.75) / 0.3);
        act.pose = { ...base, spin: -Math.PI * 2 * ease.out(q), torso: [0.15, mix(1.3, -0.3, q), 0], shoulderR: [-1.5, 0, -1.3], elbowR: [-0.1, 0, 0], weapon: [1.55, 0, 0], shoulderL: [-0.5, 0, 0.9], tilt: 0.1, k: 40 };
      }
    }
    if (a.name === 'cast_E') {
      const q = clamp01(el / 0.4);
      act.pose = { ...base, shoulderL: [q < 0.6 ? -1.6 : -0.6, 0, 0.1], elbowL: [q < 0.6 ? -0.05 : -1.6, 0, 0], torso: [0.1, q < 0.6 ? -0.4 : 0.3, 0], k: 26 };
    }
    if (a.name === 'cast_R') {
      const q = clamp01(el / 0.45);
      act.pose = { ...base, shoulderR: [q < 0.7 ? -2.9 : -0.4, 0, -0.2], elbowR: [-0.3, 0, 0], shoulderL: [q < 0.7 ? -2.6 : -0.6, 0, 0.3], weapon: [q < 0.7 ? 0.8 : 1.7, 0, 0], bodyY: Math.sin(Math.PI * q) * 1.1, tilt: q < 0.7 ? -0.2 : 0.35, hipL: [-0.8, 0, 0], kneeL: [1.2, 0, 0], hipR: [-0.5, 0, 0], kneeR: [1.0, 0, 0], k: 22 };
    }
    if (act.pose) return withAction(base, act, st);
  }
  return base;
}

// ------------------------------------------------------------- Camille ----

function buildCamille(team) {
  const rig = new Biped({ hipH: 1.12, torsoLen: 0.62, neckLen: 0.1, shoulderW: 0.26, upperArm: 0.33, foreArm: 0.31, thigh: 0.46, shin: 0.66, hipW: 0.11 });
  const j = rig.j;
  const navy = cloth(0x1b2747, { roughness: 0.6, side: THREE.DoubleSide });
  const gold = metal(0xd8b25e, { roughness: 0.25 });
  const steel = metal(0xbcc4d2, { roughness: 0.3 });
  const skin = std(0xf1ceb2, { roughness: 0.65 });
  const hair = std(0xd8dce6, { roughness: 0.45, metalness: 0.2 });
  const hex = glow(0x48e3ff, 3.0);

  part(j.torso, rbox(0.34, 0.36, 0.22, 0.08), navy, [0, 0.38, 0]);
  part(j.torso, rbox(0.28, 0.2, 0.2, 0.06), navy, [0, 0.1, 0]);
  part(j.torso, rbox(0.3, 0.05, 0.23, 0.02), gold, [0, 0.2, 0]);
  part(j.torso, rbox(0.22, 0.18, 0.04, 0.02), gold, [0, 0.42, 0.11]);
  part(j.torso, new THREE.SphereGeometry(0.045, 12, 10), hex, [0, 0.42, 0.14]);
  part(j.torso, new THREE.CylinderGeometry(0.1, 0.13, 0.14, 12, 1, true), gold, [0, 0.6, 0]);
  for (const s of [1, -1]) part(j.torso, dome(0.11, 1.2, 0.8, 1.1), gold, [s * 0.27, 0.54, 0], [0, 0, -s * 0.4]);
  // coat tails
  const tail = new THREE.PlaneGeometry(0.2, 0.85, 1, 6);
  tail.translate(0, -0.42, 0);
  const tp = tail.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setZ(i, -0.08 * tp.getY(i) * tp.getY(i));
  tail.computeVertexNormals();
  const tails = [];
  for (const s of [1, -1]) {
    const pv = new THREE.Group();
    pv.position.set(s * 0.09, 0.02, -0.12);
    j.hips.add(pv);
    part(pv, tail, navy);
    tails.push(pv);
  }
  part(j.hips, rbox(0.3, 0.16, 0.22, 0.05), navy, [0, 0.0, 0]);
  part(j.hips, rbox(0.32, 0.04, 0.24, 0.02), gold, [0, 0.07, 0]);
  // head
  part(j.neck, new THREE.CylinderGeometry(0.05, 0.06, 0.12, 10), skin, [0, 0.04, 0]);
  part(j.head, new THREE.SphereGeometry(0.125, 18, 14), skin, [0, 0.13, 0.01], null, [0.95, 1.08, 1]);
  part(j.head, new THREE.SphereGeometry(0.14, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, [0, 0.15, -0.01], [-0.15, 0, 0], [1.05, 1, 1.08]);
  for (const s of [1, -1]) part(j.head, rbox(0.06, 0.18, 0.12, 0.03), hair, [s * 0.11, 0.08, 0.0], [0, 0, s * 0.1]);
  part(j.head, rbox(0.2, 0.05, 0.08, 0.02), hair, [0, 0.21, 0.09], [0.4, 0, 0]);
  for (const s of [1, -1]) part(j.head, new THREE.SphereGeometry(0.014, 6, 6), std(0x1f3550), [s * 0.045, 0.14, 0.115]);
  // arms
  for (const S of ['L', 'R']) {
    limb(j['shoulder' + S], 0.33, 0.06, 0.05, navy);
    part(j['elbow' + S], new THREE.SphereGeometry(0.052, 8, 8), gold);
    limb(j['elbow' + S], 0.3, 0.05, 0.055, gold);
    part(j['hand' + S], rbox(0.07, 0.09, 0.07, 0.03), steel, [0, -0.03, 0]);
  }
  const hook = part(j.elbowL, rbox(0.1, 0.18, 0.12, 0.03), steel, [0.03, -0.18, 0]);
  part(hook, new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), hex, [0, -0.05, 0.07], [Math.PI / 2, 0, 0]);
  // legs: thighs + hextech blades for shins
  const blade = shapeGeo((s) => {
    s.moveTo(-0.05, 0.02);
    s.lineTo(0.05, 0.02);
    s.quadraticCurveTo(0.09, -0.3, 0.05, -0.68);
    s.lineTo(0.0, -0.72);
    s.quadraticCurveTo(-0.02, -0.4, -0.05, 0.02);
  }, 0.035, 0.008);
  blade.rotateY(-Math.PI / 2);
  const bladeEdge = shapeGeo((s) => {
    s.moveTo(0.04, -0.05);
    s.quadraticCurveTo(0.085, -0.32, 0.048, -0.66);
    s.lineTo(0.035, -0.62);
    s.quadraticCurveTo(0.065, -0.32, 0.03, -0.06);
  }, 0.04, 0.0);
  bladeEdge.rotateY(-Math.PI / 2);
  for (const S of ['L', 'R']) {
    limb(j['hip' + S], 0.46, 0.085, 0.07, navy);
    part(j['hip' + S], new THREE.TorusGeometry(0.075, 0.018, 6, 12), gold, [0, -0.3, 0], [Math.PI / 2, 0, 0]);
    part(j['knee' + S], new THREE.SphereGeometry(0.065, 12, 10), gold);
    part(j['knee' + S], new THREE.SphereGeometry(0.035, 10, 8), hex, [0, 0, 0.05]);
    part(j['knee' + S], blade, steel);
    part(j['knee' + S], bladeEdge, hex);
  }
  return new ChampionModel(rig, {
    height: 2.1,
    pose: camillePose,
    update(model, st) {
      const run = Math.min(1, st.speed / 3.2);
      for (const t of tails) t.rotation.x = 0.1 + run * 0.7 + Math.sin(st.time * 3.4) * 0.05;
    },
  });
}

function camillePose(model, st) {
  if (st.dead) return deathPose(st);
  const base = locomotion(st, st.time, { swing: 0.6 });
  base.shoulderL = [base.shoulderL[0], 0, 0.2];
  base.shoulderR = [base.shoulderR[0], 0, -0.2];
  if (st.dashName === 'camille_pull' || st.dashName === 'camille_e2') {
    return { ...base, shoulderL: [-2.4, 0, 0.1], elbowL: [0, 0, 0], hipR: [-1.4, 0, 0], kneeR: [0.1, 0, 0], hipL: [0.2, 0, 0], kneeL: [0.9, 0, 0], tilt: 0.35, k: 24 };
  }
  if (st.dashName === 'camille_r') {
    const q = clamp01((st.time - st.dashStart) / 0.5);
    return { ...base, tilt: -Math.PI * 2 * ease.inOut(q), hipL: [-1.4, 0, 0], kneeL: [1.8, 0, 0], hipR: [-1.2, 0, 0], kneeR: [1.6, 0, 0], shoulderL: [-1.2, 0, 0.4], shoulderR: [-1.2, 0, -0.4], bodyY: Math.sin(Math.PI * q) * 1.2, k: 40 };
  }
  const act = actionProgress(st);
  if (act) {
    const { a, p, el } = act;
    if (a.name === 'attack') {
      const right = st.attackIndex % 2 === 0;
      const H = right ? 'hipR' : 'hipL', K = right ? 'kneeR' : 'kneeL';
      const big = a.label && a.label.startsWith('camille_q2');
      if (p < 1) {
        const e = ease.out(p);
        act.pose = { ...base, [H]: [0.6 * e, 0, 0], [K]: [1.4 * e, 0, 0], torso: [-0.1, (right ? 0.4 : -0.4) * e, 0], k: 22 };
      } else {
        const q = ease.out(clamp01((p - 1) / 0.5));
        act.pose = { ...base, [H]: [mix(0.6, -1.7, q), 0, 0], [K]: [mix(1.4, 0.05, q), 0, 0], torso: [-0.25 * q, (right ? -0.3 : 0.3) * q, 0], tilt: -0.15 * q, spin: big ? Math.PI * 2 * q * (right ? 1 : -1) : undefined, k: 34 };
      }
    }
    if (a.name === 'cast_W') {
      if (el < 0.75) {
        const e = ease.out(clamp01(el / 0.75));
        act.pose = { ...base, hipR: [0.8 * e, 0, -0.3 * e], kneeR: [0.9 * e, 0, 0], hipL: [-0.4 * e, 0, 0], kneeL: [0.8 * e, 0, 0], torso: [0.2, 0.6 * e, 0], bodyY: -0.2 * e, k: 18 };
      } else {
        const q = ease.out(clamp01((el - 0.75) / 0.25));
        act.pose = { ...base, hipR: [-1.4, 0, mix(-0.3, 1.2, q)], kneeR: [0.1, 0, 0], spin: -1.4 * q, torso: [0.1, -0.4, 0], k: 40 };
      }
    }
    if (a.name === 'cast_E') act.pose = { ...base, shoulderL: [-1.65, 0, 0.05], elbowL: [-0.05, 0, 0], torso: [0, -0.3, 0], k: 30 };
    if (a.name === 'cast_Q') act.pose = { ...base, shoulderR: [-0.6, 0, -0.5], elbowR: [-1.4, 0, 0], k: 20 };
    if (act.pose) return withAction(base, act, st);
  }
  return base;
}

const BUILDERS = { garen: buildGaren, darius: buildDarius, camille: buildCamille };

export function createChampionModel(key, team) {
  const m = BUILDERS[key](team);
  m.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return m;
}
