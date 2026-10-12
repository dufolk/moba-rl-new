import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
/** Night-time reflection environment: navy gradient dome with a soft moon panel and warm/cool accents. */
export function nightEnvironment(renderer) {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    c.setRGB(0.05, 0.08, 0.14).lerp(new THREE.Color(0.32, 0.42, 0.6), THREE.MathUtils.smoothstep(y, -0.3, 0.9));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (color, pos, size) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(new THREE.Color(1.6, 1.75, 2.0), [-5, 7, 4], 3.5);
  panel(new THREE.Color(1.4, 0.8, 0.45), [7, 3, -5], 3);
  panel(new THREE.Color(0.35, 0.6, 1.2), [-6, 2, -6], 4);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

export class SceneRig {
  constructor(container, quality = 'high') {
    this.container = container;
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.75 : 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d1f36, 0.0125);
    this.scene = scene;

    scene.environment = nightEnvironment(r);
    scene.environmentIntensity = 0.8;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);

    const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x1b2638, 0.85);
    scene.add(hemi);
    const moon = new THREE.DirectionalLight(0xdfe9ff, 2.1);
    moon.castShadow = true;
    moon.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = moon.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    moon.shadow.radius = 3;
    scene.add(moon, moon.target);
    this.moon = moon;
    this.moonOffset = new THREE.Vector3(-14, 30, 10);
    const rim = new THREE.DirectionalLight(0xffb27a, 0.55);
    rim.position.set(20, 12, -18);
    scene.add(rim);

    this.buildSky();
    this.buildSnow();

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(300, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 top = vec3(0.012, 0.03, 0.08);
          vec3 hor = vec3(0.08, 0.2, 0.32);
          vec3 col = mix(hor, top, smoothstep(0.0, 0.55, h));
          // aurora
          vec2 uv = vDir.xz / (vDir.y + 0.35);
          float band = noise(uv * 1.3 + vec2(uTime * 0.03, 0.0)) * noise(uv * 3.1 - vec2(0.0, uTime * 0.05));
          float a = smoothstep(0.25, 0.65, band) * smoothstep(0.05, 0.35, h) * (1.0 - smoothstep(0.55, 0.9, h));
          col += a * mix(vec3(0.1, 0.9, 0.7), vec3(0.4, 0.3, 1.0), noise(uv * 0.7)) * 0.55;
          // stars
          vec2 sp = vDir.xz / (abs(vDir.y) + 0.2) * 90.0;
          float st = step(0.996, hash(floor(sp))) * smoothstep(0.15, 0.5, h);
          col += st * (0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 30.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  buildSnow() {
    const n = this.quality === 'high' ? 2600 : 1000;
    const pos = new Float32Array(n * 3);
    this.snowVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 1] = Math.random() * 22;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
      this.snowVel[i] = 0.6 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(230,240,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.PointsMaterial({ size: 0.13, map: tex, transparent: true, depthWrite: false, opacity: 0.85, color: 0xdde8ff });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  update(dt, time, focus) {
    this.sky.material.uniforms.uTime.value = time;
    this.sky.position.copy(this.camera.position);
    const p = this.snow.geometry.attributes.position.array;
    const n = this.snowVel.length;
    for (let i = 0; i < n; i++) {
      p[i * 3 + 1] -= this.snowVel[i] * dt;
      p[i * 3] += Math.sin(time * 0.7 + i) * 0.25 * dt;
      if (p[i * 3 + 1] < 0) {
        p[i * 3 + 1] = 22;
        p[i * 3] = (Math.random() - 0.5) * 50;
        p[i * 3 + 2] = (Math.random() - 0.5) * 50;
      }
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
    this.snow.position.set(focus.x, 0, focus.z);
    // keep crisp shadows around the camera focus, snapped to texels to avoid shimmering
    const snap = 44 / this.moon.shadow.mapSize.x;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.moon.target.position.set(fx, 0, fz);
    this.moon.position.set(fx + this.moonOffset.x, this.moonOffset.y, fz + this.moonOffset.z);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
