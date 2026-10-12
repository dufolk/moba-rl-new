import * as THREE from 'three';
import { nightEnvironment } from './scene.js';
import { CHAMPION_DEFS, CHAMPION_KEYS } from '../sim/champions/index.js';
import { createChampionModel } from './models/champions.js';
import { GameView } from './gameview.js';
import { Sfx } from './audio.js';
import { paintIcon, CHAMP_THEME, ICONS } from './hud.js';
import { radialTexture } from './textures.js';

const $ = (sel) => document.querySelector(sel);
const sfx = new Sfx();
const state = {
  me: localStorage.getItem('moba.me') || 'garen',
  enemy: localStorage.getItem('moba.enemy') || 'darius',
  mode: 'play',
  difficulty: Number(localStorage.getItem('moba.diff') || 1),
  quality: localStorage.getItem('moba.quality') || 'high',
  replay: null,
};
let view = null;
let preview = null;

class MenuPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.environment = nightEnvironment(this.renderer);
    this.scene.environmentIntensity = 1.0;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 2.2, 8.5);
    this.camera.lookAt(0, 1.1, 0);
    this.scene.add(new THREE.HemisphereLight(0xb0c8ff, 0x202030, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rimB = new THREE.PointLight(0x3aa8ff, 30, 10);
    rimB.position.set(-3, 2.5, -2);
    const rimR = new THREE.PointLight(0xff4646, 30, 10);
    rimR.position.set(3, 2.5, -2);
    this.scene.add(rimB, rimR);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 64), new THREE.MeshStandardMaterial({
      color: 0x1a2436, roughness: 0.5, metalness: 0.4, transparent: true, depthWrite: false,
      alphaMap: radialTexture('rgba(255,255,255,1)', 'rgba(0,0,0,0)', 256),
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.models = [null, null];
    this.t = 0;
    this.last = performance.now();
    this.anim = [0, 1].map(() => ({ speed: 0, phase: 0, time: 0, action: null, dead: false, deadT: 0, attackIndex: 0 }));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  set(i, key) {
    if (this.models[i]) this.scene.remove(this.models[i].root);
    const m = createChampionModel(key, i);
    m.root.position.set(i === 0 ? -1.6 : 1.6, 0, 0);
    m.root.rotation.y = i === 0 ? 0.6 : -0.6;
    this.scene.add(m.root);
    this.models[i] = m;
    this.anim[i].action = { name: 'attack', start: this.t, windup: 0.45, dur: 1.0, label: null };
  }

  loop(now) {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.models.forEach((m, i) => {
      if (!m) return;
      const a = this.anim[i];
      a.time = this.t;
      if (a.action && this.t - a.action.start > a.action.dur) a.action = null;
      if (!a.action && Math.random() < dt * 0.25) a.action = { name: 'attack', start: this.t, windup: 0.45, dur: 1.0, label: null };
      m.update(dt, a);
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
  }
}

function champCard(key, group, selected, onPick) {
  const d = CHAMPION_DEFS[key];
  const card = document.createElement('div');
  card.className = 'champ-card' + (selected ? ' sel' : '');
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  paintIcon(cv, ICONS[key].P, CHAMP_THEME[key]);
  card.appendChild(cv);
  const t = document.createElement('div');
  t.innerHTML = `<b>${d.title}</b><span>${d.name}</span>`;
  card.appendChild(t);
  card.addEventListener('click', () => { sfx.ui(); onPick(key); });
  group.appendChild(card);
}

function renderMenu() {
  const m = $('#menu');
  m.classList.remove('hidden');
  m.innerHTML = `
    <div class="menu-bg"></div>
    <div class="menu-inner">
      <div class="title"><h1>嚎哭深渊</h1><div class="sub">HOWLING ABYSS · 1v1 SOLO LANE</div></div>
      <div class="menu-body">
        <div class="col">
          <div class="label">你的英雄</div><div class="cards" id="cards-me"></div>
          <div class="label">对手</div><div class="cards" id="cards-enemy"></div>
          <div class="label">模式</div>
          <div class="modes">
            <button data-mode="play">对战电脑</button>
            <button data-mode="practice">训练模式（木桩）</button>
            <button data-mode="spectate">观战 AI 对战</button>
            <button data-mode="replay">观看回放</button>
          </div>
          <div class="opts">
            <label>AI 强度 <input id="diff" type="range" min="0.3" max="1" step="0.05"></label>
            <label>画质 <select id="quality"><option value="high">高</option><option value="low">流畅</option></select></label>
          </div>
          <div id="replay-box" class="replay-box hidden">
            <div class="replay-list" id="replay-list">加载中…</div>
            <label class="upload">或选择本地回放文件 <input type="file" id="replay-file" accept=".json"></label>
          </div>
          <button id="start" class="start">开始游戏</button>
          <div class="tip">右键移动 · QWER 施法 · Ctrl+QWER 升级 · D 闪现 · F 引燃 · P 商店 · H 帮助</div>
        </div>
        <div class="col preview-col"><canvas id="preview"></canvas><div class="vs">VS</div></div>
      </div>
    </div>`;
  const draw = () => {
    for (const [id, keyName] of [['#cards-me', 'me'], ['#cards-enemy', 'enemy']]) {
      const g = $(id);
      g.innerHTML = '';
      for (const k of CHAMPION_KEYS) champCard(k, g, state[keyName] === k, (pick) => {
        state[keyName] = pick;
        localStorage.setItem('moba.' + keyName, pick);
        preview.set(keyName === 'me' ? 0 : 1, pick);
        draw();
      });
    }
    m.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('sel', b.dataset.mode === state.mode));
    $('#replay-box').classList.toggle('hidden', state.mode !== 'replay');
    $('#start').textContent = { play: '开始对战', practice: '进入训练', spectate: '开始观战', replay: state.replay ? '播放回放' : '请选择回放' }[state.mode];
  };
  preview = new MenuPreview($('#preview'));
  preview.set(0, state.me);
  preview.set(1, state.enemy);
  draw();
  m.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
    sfx.ui();
    state.mode = b.dataset.mode;
    if (state.mode === 'replay') loadReplayList();
    draw();
  }));
  const diff = $('#diff');
  diff.value = state.difficulty;
  diff.addEventListener('input', () => { state.difficulty = Number(diff.value); localStorage.setItem('moba.diff', diff.value); });
  const q = $('#quality');
  q.value = state.quality;
  q.addEventListener('change', () => { state.quality = q.value; localStorage.setItem('moba.quality', q.value); });
  $('#replay-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.replay = JSON.parse(await f.text());
    draw();
  });
  $('#start').addEventListener('click', () => start());

  async function loadReplayList() {
    const list = $('#replay-list');
    try {
      const items = await (await fetch('/api/replays')).json();
      if (!items.length) { list.textContent = '暂无回放（训练脚本会写入 replays/ 或 runs/）'; return; }
      list.innerHTML = '';
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'replay-row';
        row.textContent = `${it.path}  ·  ${(it.size / 1024).toFixed(0)}KB  ·  ${new Date(it.mtime).toLocaleString()}`;
        row.addEventListener('click', async () => {
          list.querySelectorAll('.replay-row').forEach((r) => r.classList.remove('sel'));
          row.classList.add('sel');
          state.replay = await (await fetch('/' + it.path)).json();
          draw();
        });
        list.appendChild(row);
      }
    } catch {
      list.textContent = '无法获取回放列表';
    }
  }
}

function start() {
  if (state.mode === 'replay' && !state.replay) return;
  sfx.ensure();
  preview.dispose();
  $('#menu').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  setTimeout(() => {
    try {
      view = new GameView({
        mode: state.mode,
        champions: [state.me, state.enemy],
        botDifficulty: state.difficulty,
        quality: state.quality,
        replay: state.replay,
        container: $('#viewport'),
        overlayCanvas: $('#overlay'),
        hudRoot: $('#hud'),
        sfx,
        onExit: () => { view = null; renderMenu(); },
      });
      window.__view = view;
    } catch (err) {
      console.error(err);
      alert('启动失败: ' + err.message);
      renderMenu();
    } finally {
      $('#loading').classList.add('hidden');
    }
  }, 30);
}

renderMenu();
