import * as THREE from 'three';
import { MAP_LENGTH, MID, LAYOUT, halfWidth, isInside, teamX } from '../sim/map.js';
import { simToWorld, S } from './coords.js';
import { makeStoneTextures, fbm, radialTexture, ringTexture } from './textures.js';

export const TEAM_COLORS = [new THREE.Color(0x3aa8ff), new THREE.Color(0xff4646)];

const tmp = { x: 0, z: 0 };

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFloor(group) {
  const tex = makeStoneTextures(512);
  const xs = [];
  for (let x = 0; x <= MAP_LENGTH; x += 50) xs.push(x);
  const across = 22;
  const nV = xs.length * (across + 1);
  const pos = new Float32Array(nV * 3);
  const uv = new Float32Array(nV * 2);
  const snow = new Float32Array(nV);
  let k = 0;
  for (const x of xs) {
    const hw = Math.max(halfWidth(Math.min(Math.max(x, 40), MAP_LENGTH - 40)), 300);
    for (let j = 0; j <= across; j++) {
      const t = j / across * 2 - 1;
      const y = t * (hw + 160);
      simToWorld(x, y, tmp);
      pos[k * 3] = tmp.x;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = tmp.z;
      uv[k * 2] = x / 380;
      uv[k * 2 + 1] = y / 380;
      const edge = Math.abs(y) / hw;
      const patch = fbm(x / 600, y / 600, 4, 9);
      let sn = THREE.MathUtils.smoothstep(edge, 0.62, 1.0) * 0.95;
      sn = Math.max(sn, THREE.MathUtils.smoothstep(patch, 0.6, 0.75) * 0.8 * (1 - THREE.MathUtils.smoothstep(edge, 0, 0.25) * 0.0));
      sn *= 0.85 + 0.3 * fbm(x / 120, y / 120, 2, 3);
      // worn path through the middle of the lane
      sn *= THREE.MathUtils.smoothstep(edge, 0.12, 0.45) * 0.85 + 0.15;
      snow[k] = Math.min(1, sn);
      k++;
    }
  }
  const idx = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j, b = a + 1, c = a + across + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('snow', new THREE.BufferAttribute(snow, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0.02,
    normalScale: new THREE.Vector2(1.2, 1.2), color: 0xb8c4d8,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float snow;\nvarying float vSnow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSnow = snow;');
    sh.fragmentShader = 'varying float vSnow;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.86, 0.96), vSnow);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.55, vSnow);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  return tex;
}

// Closed loop around the walkable area (sim coords) with outward normals.
function edgeLoop() {
  const pts = [];
  const X0 = 40, X1 = MAP_LENGTH - 40;
  for (let x = X0; x <= X1; x += 60) pts.push([x, halfWidth(x)]);
  const hwR = halfWidth(X1);
  for (let i = 1; i < 8; i++) pts.push([X1, hwR - (2 * hwR * i) / 8]);
  for (let x = X1; x >= X0; x -= 60) pts.push([x, -halfWidth(x)]);
  const hwL = halfWidth(X0);
  for (let i = 1; i < 8; i++) pts.push([X0, -hwL + (2 * hwL * i) / 8]);
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    let nx = ty, ny = -tx;
    if (isInside(p[0] + nx * 30, p[1] + ny * 30, 0) && p[0] + nx * 30 > X0 && p[0] + nx * 30 < X1) { nx = -nx; ny = -ny; }
    return { x: p[0], y: p[1], nx, ny };
  });
}

const CLIFF_PROFILE = [
  [-30, -0.05], [25, 0.12], [70, 0.9], [120, 2.0], [180, 2.85], [250, 3.35], [400, 3.7], [650, 4.3],
  [1000, 5.6], [1500, 7.4], [2200, 7.9], [3100, 5.0], [4400, -3.0],
];

function cliffPoint(e, off, h, rnd = true) {
  let o = off, hh = h;
  if (rnd && off > 0) {
    const n1 = fbm(e.x / 260, e.y / 260 + off / 400, 3, 21);
    const n2 = fbm(e.x / 90 + off / 150, e.y / 90, 2, 33);
    o += (n1 - 0.5) * Math.min(off, 260) * 0.7;
    hh += (n2 - 0.5) * Math.min(1, off / 120) * 0.9 + (n1 - 0.5) * Math.min(2.5, off / 300);
  }
  simToWorld(e.x + e.nx * o, e.y + e.ny * o, tmp);
  return [tmp.x, hh, tmp.z];
}

function buildCliffs(group, loop) {
  const rows = CLIFF_PROFILE.length;
  const n = loop.length;
  const pos = [];
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < rows; r++) pos.push(...cliffPoint(loop[i], CLIFF_PROFILE[r][0], CLIFF_PROFILE[r][1]));
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r, b = i * rows + r + 1, c = i2 * rows + r, d = i2 * rows + r + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const p = geo.attributes.position.array;
  const col = new Float32Array(p.length);
  const c = new THREE.Color();
  for (let t = 0; t < p.length / 9; t++) {
    // flip faces that point down (winding differs on some loop sections)
    let ny = nrm[t * 9 + 1];
    if (ny < 0) {
      for (let v = 0; v < 3; v++) for (let q = 0; q < 3; q++) nrm[t * 9 + v * 3 + q] *= -1;
      ny = -ny;
    }
    const h = (p[t * 9 + 1] + p[t * 9 + 4] + p[t * 9 + 7]) / 3;
    const jitter = fbm(p[t * 9] * 0.7, p[t * 9 + 2] * 0.7, 2, 4);
    if (ny > 0.86 && h > 0.6) c.setRGB(0.6 + jitter * 0.1, 0.66 + jitter * 0.08, 0.78);
    else if (ny > 0.7) c.setRGB(0.3 + jitter * 0.14, 0.35 + jitter * 0.14, 0.45 + jitter * 0.12);
    else c.setRGB(0.12 + jitter * 0.1, 0.15 + jitter * 0.1, 0.22 + jitter * 0.12);
    for (let v = 0; v < 3; v++) c.toArray(col, t * 9 + v * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
}

function surfaceAt(e, off) {
  for (let r = 0; r < CLIFF_PROFILE.length - 1; r++) {
    const [o0, h0] = CLIFF_PROFILE[r], [o1, h1] = CLIFF_PROFILE[r + 1];
    if (off >= o0 && off <= o1) return cliffPoint(e, off, h0 + ((off - o0) / (o1 - o0)) * (h1 - h0));
  }
  return cliffPoint(e, off, 0);
}

function buildDecor(group, loop, quality) {
  const rnd = seeded(1234);
  const dummy = new THREE.Object3D();
  // ice crystals
  const nIce = quality === 'high' ? 220 : 110;
  const iceGeo = new THREE.OctahedronGeometry(0.5, 0);
  iceGeo.scale(0.45, 1.7, 0.45);
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0x9fdcff, emissive: 0x1e7bc4, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92, flatShading: true,
  });
  const ice = new THREE.InstancedMesh(iceGeo, iceMat, nIce);
  for (let i = 0; i < nIce; i++) {
    const e = loop[Math.floor(rnd() * loop.length)];
    const off = 60 + rnd() * 900;
    const [x, y, z] = surfaceAt(e, off);
    const s = 0.5 + rnd() * 1.6;
    dummy.position.set(x, y - 0.15, z);
    dummy.rotation.set((rnd() - 0.5) * 0.7, rnd() * Math.PI, (rnd() - 0.5) * 0.7);
    dummy.scale.set(s, s * (0.8 + rnd()), s);
    dummy.updateMatrix();
    ice.setMatrixAt(i, dummy.matrix);
  }
  ice.castShadow = true;
  group.add(ice);

  // rocks at the foot of the cliffs
  const nRock = quality === 'high' ? 260 : 120;
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x55657c, roughness: 0.95, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, nRock);
  const rc = new THREE.Color();
  for (let i = 0; i < nRock; i++) {
    const e = loop[Math.floor(rnd() * loop.length)];
    const off = -10 + rnd() * 160;
    const [x, y, z] = surfaceAt(e, off);
    const s = 0.25 + rnd() * 0.8;
    dummy.position.set(x, Math.max(0, y) + s * 0.15, z);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.5), s * (0.8 + rnd() * 0.6));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rc.setHSL(0.6, 0.12, 0.3 + rnd() * 0.2);
    rocks.setColorAt(i, rc);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);

  // distant mountains
  const mGeo = new THREE.ConeGeometry(1, 1, 7, 4);
  const mp = mGeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    if (y > -0.49 && y < 0.49) {
      mp.setX(i, mp.getX(i) * (0.85 + Math.sin(i * 12.9) * 0.15));
      mp.setZ(i, mp.getZ(i) * (0.85 + Math.cos(i * 7.3) * 0.15));
    }
  }
  const mGeoNI = mGeo.toNonIndexed();
  mGeoNI.computeVertexNormals();
  const mc = new Float32Array(mGeoNI.attributes.position.count * 3);
  for (let i = 0; i < mGeoNI.attributes.position.count; i++) {
    const y = mGeoNI.attributes.position.getY(i);
    const snow = y > 0.05;
    mc.set(snow ? [0.85, 0.9, 1] : [0.18, 0.22, 0.3], i * 3);
  }
  mGeoNI.setAttribute('color', new THREE.BufferAttribute(mc, 3));
  const mMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const nM = 46;
  const mountains = new THREE.InstancedMesh(mGeoNI, mMat, nM);
  for (let i = 0; i < nM; i++) {
    const a = (i / nM) * Math.PI * 2 + rnd() * 0.1;
    const r = 85 + rnd() * 50;
    const h = 22 + rnd() * 38;
    dummy.position.set(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r);
    dummy.rotation.set(0, rnd() * 6, 0);
    dummy.scale.set(10 + rnd() * 16, h, 10 + rnd() * 16);
    dummy.updateMatrix();
    mountains.setMatrixAt(i, dummy.matrix);
  }
  group.add(mountains);

  // braziers along the lane edges
  const braziers = [];
  const stone = new THREE.MeshStandardMaterial({ color: 0x6b7385, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.8 });
  const flameTex = radialTexture('rgba(255,220,150,1)', 'rgba(255,90,10,0)');
  for (let x = 2600; x <= MAP_LENGTH - 2600; x += 1300) {
    for (const side of [-1, 1]) {
      const y = side * (halfWidth(x) - 40);
      const b = new THREE.Group();
      simToWorld(x, y, tmp);
      b.position.set(tmp.x, 0, tmp.z);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.1, 8), stone);
      pillar.position.y = 0.55;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.18, 0.28, 10, 1, true), iron);
      bowl.position.y = 1.2;
      pillar.castShadow = bowl.castShadow = true;
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      flame.position.y = 1.55;
      flame.scale.set(0.9, 1.3, 1);
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a }));
      core.position.y = 1.5;
      b.add(pillar, bowl, flame, core);
      group.add(b);
      braziers.push({ flame, core, phase: rnd() * 10 });
    }
  }
  return braziers;
}

function tiled(tex, n) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(n, n);
  t.needsUpdate = true;
  return t;
}

function buildBases(group, stone) {
  const ringTex = ringTexture(512, 0.035);
  const glowTex = radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const animated = [];
  for (const team of [0, 1]) {
    const col = TEAM_COLORS[team];
    // fountain heal circle
    simToWorld(teamX(team, LAYOUT.fountainX), 0, tmp);
    const r = LAYOUT.fountainHealRadius * S;
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2, r * 2),
      new THREE.MeshBasicMaterial({ map: ringTex, color: col, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(tmp.x, 0.03, tmp.z);
    group.add(ring);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.98, r * 1.02, 0.04, 64),
      new THREE.MeshStandardMaterial({
        map: tiled(stone.map, r * 2 / 2.2), normalMap: tiled(stone.normalMap, r * 2 / 2.2), color: team === 0 ? 0x8290a8 : 0xa08c96, roughness: 0.5, metalness: 0.15,
        normalScale: new THREE.Vector2(0.6, 0.6),
      }),
    );
    platform.position.set(tmp.x, 0.0, tmp.z);
    platform.receiveShadow = true;
    group.add(platform);
    // fountain obelisk + light pillar
    const ob = new THREE.Group();
    ob.position.set(tmp.x, 0, tmp.z);
    const baseM = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.35, metalness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd6a648, roughness: 0.3, metalness: 1 });
    const crystalM = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.3, roughness: 0.1 });
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.5, 8), baseM);
    b1.position.y = 0.25;
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 0.35, 8), gold);
    b2.position.y = 0.67;
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalM);
    cr.position.y = 1.9;
    cr.scale.set(1, 1.8, 1);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.8, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    pillar.position.y = 7;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45 }));
    glow.position.y = 1.9;
    glow.scale.set(2.6, 2.6, 1);
    b1.castShadow = b2.castShadow = true;
    ob.add(b1, b2, cr, pillar, glow);
    group.add(ob);
    const light = new THREE.PointLight(col, 7, 14, 1.8);
    light.position.set(tmp.x, 2.5, tmp.z);
    group.add(light);
    animated.push({ crystal: cr, ring, pillar });

    // banners near the nexus
    for (const side of [-1, 1]) {
      const bx = teamX(team, LAYOUT.nexusX + 250), by = side * 900;
      simToWorld(bx, by, tmp);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 6), gold);
      pole.position.set(tmp.x, 2.5, tmp.z);
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 2.6, 1, 6),
        new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.7), roughness: 0.8, side: THREE.DoubleSide, emissive: col, emissiveIntensity: 0.12 }),
      );
      cloth.position.set(tmp.x + 0.58, 3.6, tmp.z);
      pole.castShadow = cloth.castShadow = true;
      group.add(pole, cloth);
      animated.push({ cloth, phase: side + team * 3 });
    }
  }
  return animated;
}

export function buildEnvironment(scene, quality = 'high') {
  const group = new THREE.Group();
  const loop = edgeLoop();
  const stone = buildFloor(group);
  buildCliffs(group, loop);
  const braziers = buildDecor(group, loop, quality);
  const bases = buildBases(group, stone);
  scene.add(group);
  return {
    group,
    update(t) {
      for (const b of braziers) {
        const f = 1 + Math.sin(t * 13 + b.phase) * 0.08 + Math.sin(t * 7.1 + b.phase * 2) * 0.06;
        b.flame.scale.set(0.9 * f, 1.3 * f * (1 + Math.sin(t * 9 + b.phase) * 0.05), 1);
        b.core.scale.set(1, f, 1);
      }
      for (const a of bases) {
        if (a.crystal) {
          a.crystal.rotation.y = t * 0.8;
          a.crystal.position.y = 1.9 + Math.sin(t * 1.6) * 0.15;
          a.ring.material.opacity = 0.65 + Math.sin(t * 2) * 0.2;
          a.pillar.material.opacity = 0.045 + Math.sin(t * 1.3) * 0.015;
        }
        if (a.cloth) a.cloth.rotation.y = Math.sin(t * 1.4 + a.phase) * 0.25;
      }
    },
  };
}

export { MID };
