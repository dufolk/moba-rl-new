import * as THREE from 'three';
import { slashTexture, ringTexture, radialTexture } from './textures.js';

const MAX_PARTICLES = 6000;

export function arcGeometry(r0, r1, start, len, n = 32) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + len * t;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, 0, s * r0, c * r1, 0, s * r1);
    uv.push(t, 0, t, 1);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const ARC_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ARC_FRAG = `
  uniform sampler2D map; uniform vec3 color; uniform float progress; uniform float opacity; varying vec2 vUv;
  void main(){
    float u = vUv.x / max(progress, 0.001);
    if (u > 1.0) discard;
    float a = texture2D(map, vec2(u, vUv.y)).a * opacity;
    vec3 c = mix(color, vec3(1.0), pow(vUv.y, 6.0) * u * 0.8);
    gl_FragColor = vec4(c * a * 2.0, a);
  }`;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.effects = [];
    this.time = 0;
    this.slashTex = slashTexture();
    this.ringTex = ringTexture(256, 0.06);
    this.softTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.initParticles();
  }

  initParticles() {
    const n = MAX_PARTICLES;
    this.p = {
      pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), col: new Float32Array(n * 3),
      life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), grav: new Float32Array(n),
      drag: new Float32Array(n), alpha: new Float32Array(n), size0: new Float32Array(n),
    };
    this.pNext = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.p.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.p.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.p.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 420 } },
      vertexShader: `
        attribute vec3 color; attribute float alpha; attribute float size; uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main(){ vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha; gl_FragColor = vec4(vColor * a, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.scene.add(this.points);
  }

  /** Emit particles. pos: Vector3-like. */
  burst(pos, o = {}) {
    const n = o.count ?? 20;
    const col = new THREE.Color(o.color ?? 0xffffff);
    const col2 = o.color2 != null ? new THREE.Color(o.color2) : null;
    const p = this.p;
    for (let i = 0; i < n; i++) {
      const k = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.8);
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      if (o.dir) {
        dx = o.dir.x + dx * (o.spread ?? 0.5);
        dy = o.dir.y + dy * (o.spread ?? 0.5);
        dz = o.dir.z + dz * (o.spread ?? 0.5);
      }
      if (o.flat) dy = Math.abs(dy) * 0.3;
      const l = Math.hypot(dx, dy, dz) || 1;
      const r = o.radius ? Math.random() * o.radius : 0;
      const ra = Math.random() * Math.PI * 2;
      p.pos[k * 3] = pos.x + Math.cos(ra) * r;
      p.pos[k * 3 + 1] = pos.y + (o.yJitter ? Math.random() * o.yJitter : 0);
      p.pos[k * 3 + 2] = pos.z + Math.sin(ra) * r;
      p.vel[k * 3] = (dx / l) * sp;
      p.vel[k * 3 + 1] = (dy / l) * sp + (o.up ?? 0);
      p.vel[k * 3 + 2] = (dz / l) * sp;
      const c = col2 ? col.clone().lerp(col2, Math.random()) : col;
      p.col[k * 3] = c.r; p.col[k * 3 + 1] = c.g; p.col[k * 3 + 2] = c.b;
      p.max[k] = p.life[k] = (o.life ?? 0.6) * (0.6 + Math.random() * 0.7);
      p.size0[k] = (o.size ?? 0.25) * (0.6 + Math.random() * 0.8);
      p.grav[k] = o.gravity ?? 0;
      p.drag[k] = o.drag ?? 2;
    }
  }

  updateParticles(dt) {
    const p = this.p;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (p.life[k] <= 0) { if (p.alpha[k] !== 0) { p.alpha[k] = 0; p.size[k] = 0; } continue; }
      p.life[k] -= dt;
      const t = Math.max(0, p.life[k] / p.max[k]);
      const d = Math.exp(-p.drag[k] * dt);
      p.vel[k * 3] *= d; p.vel[k * 3 + 1] = p.vel[k * 3 + 1] * d - p.grav[k] * dt; p.vel[k * 3 + 2] *= d;
      p.pos[k * 3] += p.vel[k * 3] * dt;
      p.pos[k * 3 + 1] += p.vel[k * 3 + 1] * dt;
      p.pos[k * 3 + 2] += p.vel[k * 3 + 2] * dt;
      if (p.pos[k * 3 + 1] < 0.02 && p.grav[k] > 0) { p.pos[k * 3 + 1] = 0.02; p.vel[k * 3 + 1] *= -0.3; }
      p.alpha[k] = t < 0.7 ? t / 0.7 : 1;
      p.size[k] = p.size0[k] * (0.4 + 0.6 * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  add(effect) {
    this.effects.push(effect);
    return effect;
  }

  /** Sweeping slash arc on a (possibly tilted) plane. */
  slash(pos, yaw, o = {}) {
    const r = o.radius ?? 1.6;
    const len = o.arc ?? Math.PI * 0.9;
    const geo = arcGeometry(r * (1 - (o.width ?? 0.35)), r, -len / 2, len, 40);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.slashTex }, color: { value: new THREE.Color(o.color ?? 0xffffff) }, progress: { value: 0 }, opacity: { value: 1 } },
      vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const holder = new THREE.Group();
    holder.position.set(pos.x, pos.y ?? 1, pos.z);
    holder.rotation.y = yaw;
    const inner = new THREE.Group();
    inner.rotation.z = o.tilt ?? 0;
    inner.rotation.x = o.pitch ?? 0;
    holder.add(inner);
    // arc is built around +X; rotate so its middle faces model-forward (+Z)
    mesh.rotation.y = -Math.PI / 2 * (o.flip ? -1 : 1);
    if (o.flip) mesh.scale.x = -1;
    inner.add(mesh);
    this.scene.add(holder);
    const dur = o.duration ?? 0.28;
    const sweep = o.sweep ?? 0.45;
    let t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        mat.uniforms.progress.value = Math.min(1, t / (dur * sweep));
        mat.uniforms.opacity.value = 1 - Math.max(0, (t - dur * sweep) / (dur * (1 - sweep)));
        if (o.spin) mesh.rotation.y += o.spin * dt;
        return t < dur;
      },
      dispose: () => { this.scene.remove(holder); geo.dispose(); mat.dispose(); },
    });
  }

  /** Expanding ground ring. */
  ring(pos, o = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: this.ringTex, color: o.color ?? 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: o.opacity ?? 1 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, (pos.y ?? 0) + 0.05, pos.z);
    this.scene.add(mesh);
    const dur = o.duration ?? 0.5;
    const from = o.from ?? 0.2, to = o.to ?? 3;
    let t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        const q = Math.min(1, t / dur);
        const s = from + (to - from) * (1 - Math.pow(1 - q, 3));
        mesh.scale.set(s, s, s);
        mat.opacity = (o.opacity ?? 1) * (1 - q);
        return t < dur;
      },
      dispose: () => { this.scene.remove(mesh); mesh.geometry.dispose(); mat.dispose(); },
    });
  }

  /** Filled cone / sector on the ground (telegraph or flash). */
  cone(pos, yaw, o = {}) {
    const half = o.half ?? 0.5;
    const geo = arcGeometry(o.inner ?? 0.3, o.radius ?? 5, -half, half * 2, 32);
    const mat = new THREE.MeshBasicMaterial({ color: o.color ?? 0xff3030, transparent: true, opacity: o.opacity ?? 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    const holder = new THREE.Group();
    holder.position.set(pos.x, 0.06, pos.z);
    holder.rotation.y = yaw;
    mesh.rotation.y = -Math.PI / 2;
    holder.add(mesh);
    this.scene.add(holder);
    const dur = o.duration ?? 0.4;
    let t = 0;
    const handle = this.add({
      holder,
      update: (dt) => {
        t += dt;
        const q = Math.min(1, t / dur);
        mat.opacity = (o.opacity ?? 0.35) * (o.grow ? Math.min(1, q * 3) : 1 - q);
        if (o.grow) mesh.scale.setScalar(0.3 + 0.7 * q);
        return t < dur && !handle.killed;
      },
      dispose: () => { this.scene.remove(holder); geo.dispose(); mat.dispose(); },
    });
    return handle;
  }

  /** Persistent ground decal; call handle.kill() to fade out. */
  zone(o = {}) {
    const group = new THREE.Group();
    const segs = o.segments ?? 64;
    const r = o.radius ?? 4;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, segs), new THREE.MeshBasicMaterial({ color: o.color ?? 0x48e3ff, transparent: true, opacity: o.fill ?? 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    const edgeGeo = new THREE.RingGeometry(r * 0.96, r, segs, 1);
    const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: o.color ?? 0x48e3ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = -Math.PI / 2;
    group.add(fill, edge);
    if (o.walls) {
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, o.walls, segs, 1, true),
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { color: { value: new THREE.Color(o.color ?? 0x48e3ff) }, t: { value: 0 } },
          vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
          fragmentShader: `uniform vec3 color; uniform float t; varying vec2 vUv;
            void main(){ float a = pow(1.0 - vUv.y, 2.0) * (0.55 + 0.25 * sin(vUv.x * 60.0 + t * 4.0)); gl_FragColor = vec4(color * a, a); }`,
        }),
      );
      wall.position.y = o.walls / 2;
      group.add(wall);
      group.userData.wall = wall;
    }
    group.position.y = 0.04;
    if (o.rotation) group.rotation.y = o.rotation;
    this.scene.add(group);
    let fade = 1, killed = false, t = 0;
    const handle = this.add({
      group,
      kill: () => { killed = true; },
      update: (dt) => {
        t += dt;
        if (killed) fade -= dt * 4;
        const k = Math.max(0, fade) * Math.min(1, t * 6);
        fill.material.opacity = (o.fill ?? 0.1) * k;
        edge.material.opacity = 0.9 * k * (0.8 + 0.2 * Math.sin(t * 6));
        if (group.userData.wall) {
          group.userData.wall.material.uniforms.t.value = t;
          group.userData.wall.scale.y = k;
        }
        if (o.spin) group.rotation.y += o.spin * dt;
        return fade > 0;
      },
      dispose: () => {
        this.scene.remove(group);
        group.traverse((x) => { if (x.isMesh) { x.geometry.dispose(); x.material.dispose(); } });
      },
    });
    handle.kill = () => { killed = true; };
    return handle;
  }

  /** Thin glowing line between two points updated by getter each frame. */
  beam(getPoints, o = {}) {
    const mat = new THREE.MeshBasicMaterial({ color: o.color ?? 0x48e3ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.CylinderGeometry(o.width ?? 0.03, o.width ?? 0.03, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    let killed = false;
    const handle = this.add({
      update: () => {
        const pts = getPoints();
        if (!pts || killed) return false;
        const [a, b] = pts;
        mesh.position.copy(a);
        const d = a.distanceTo(b);
        mesh.scale.set(1, 1, Math.max(0.01, d));
        mesh.lookAt(b);
        return true;
      },
      dispose: () => { this.scene.remove(mesh); geo.dispose(); mat.dispose(); },
    });
    handle.kill = () => { killed = true; };
    return handle;
  }

  /** Giant golden sword falling from the sky (Demacian Justice). */
  demacianSword(getTarget, delay = 0.0) {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb326, emissiveIntensity: 2.4, metalness: 1, roughness: 0.2, transparent: true });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 0.08), gold);
    blade.position.y = 2.25;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.8, 4), gold);
    tip.position.y = -0.38;
    tip.rotation.set(Math.PI, Math.PI / 4, 0);
    tip.scale.z = 0.25;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 0.25), gold);
    guard.position.y = 4.5;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), gold);
    grip.position.y = 5.1;
    g.add(blade, tip, guard, grip);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xffc040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(5, 9, 1);
    glow.position.y = 2.5;
    g.add(glow);
    this.scene.add(g);
    let t = -delay, landed = false;
    return this.add({
      update: (dt) => {
        t += dt;
        const p = getTarget();
        if (p) g.position.set(p.x, 0, p.z);
        const fall = 0.32;
        if (t < 0) { g.visible = false; return true; }
        g.visible = true;
        if (t < fall) g.position.y = 12 * (1 - t / fall) * (1 - t / fall) + 0.6;
        else {
          g.position.y = 0.6 - Math.min(0.6, (t - fall) * 2);
          if (!landed) {
            landed = true;
            this.ring(g.position, { color: 0xffc94d, from: 0.3, to: 5, duration: 0.5 });
            this.burst({ x: g.position.x, y: 0.4, z: g.position.z }, { count: 80, color: 0xffd36b, color2: 0xffffff, speed: 8, life: 0.7, size: 0.35, gravity: 6, up: 3 });
            if (this.onShake) this.onShake(0.35);
          }
          const f = 1 - (t - fall) / 0.6;
          gold.opacity = Math.max(0, f);
          glow.material.opacity = Math.max(0, f);
        }
        return t < fall + 0.6;
      },
      dispose: () => { this.scene.remove(g); g.traverse((x) => { if (x.isMesh) { x.geometry.dispose(); } }); gold.dispose(); glow.material.dispose(); },
    });
  }

  /** Spinning blade aura around a unit (Garen E). getPos returns world pos or null to stop. */
  whirl(getPos, o = {}) {
    const group = new THREE.Group();
    const mats = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.slashTex }, color: { value: new THREE.Color(o.color ?? 0xbfe3ff) }, progress: { value: 1 }, opacity: { value: 0.0 } },
        vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      mats.push(mat);
      const m = new THREE.Mesh(arcGeometry((o.radius ?? 3) * (0.62 + i * 0.08), (o.radius ?? 3) * (0.92 - i * 0.05), 0, Math.PI * 0.7, 32), mat);
      m.rotation.y = (i / 3) * Math.PI * 2;
      m.position.y = 0.7 + i * 0.25;
      group.add(m);
    }
    this.scene.add(group);
    let fade = 0, t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        const p = getPos();
        if (p) { group.position.set(p.x, 0, p.z); fade = Math.min(1, fade + dt * 6); } else fade -= dt * 5;
        group.rotation.y -= dt * 16;
        for (const m of mats) m.uniforms.opacity.value = Math.max(0, fade) * 0.38;
        return fade > 0 || t < 0.1;
      },
      dispose: () => { this.scene.remove(group); group.traverse((x) => { if (x.isMesh) { x.geometry.dispose(); x.material.dispose(); } }); },
    });
  }

  update(dt) {
    this.time += dt;
    const keep = [];
    for (const e of this.effects) {
      if (e.update(dt)) keep.push(e);
      else e.dispose();
    }
    this.effects = keep;
    this.updateParticles(dt);
  }
}
