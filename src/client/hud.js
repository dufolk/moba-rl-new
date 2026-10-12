import { ITEMS, ITEM_IDS, itemPrice, SUMMONERS } from '../sim/data.js';
import { MAP_LENGTH, LAYOUT, halfWidth, teamX } from '../sim/map.js';
import { CHAMPION_DEFS } from '../sim/champions/index.js';
import { rankValue } from '../sim/util.js';
import { encodeObs, ACTION_TYPES, OBS_DIM } from '../sim/obs.js';

export const CHAMP_THEME = {
  garen: { a: '#2a4f9c', b: '#0c1a3a', accent: '#f2c75c', glyph: '#ffe7a8' },
  darius: { a: '#7a1a1a', b: '#1a0808', accent: '#ff5a3a', glyph: '#ffd0c0' },
  camille: { a: '#1d5f7a', b: '#081822', accent: '#55e6ff', glyph: '#d9f8ff' },
};

export const ICONS = {
  garen: { P: 'heart', Q: 'sword', W: 'shield', E: 'spin', R: 'bigsword' },
  darius: { P: 'blood', Q: 'axering', W: 'axe', E: 'hand', R: 'guillotine' },
  camille: { P: 'hexshield', Q: 'kick', W: 'sweep', E: 'hook', R: 'hex' },
};

const SLOT_KEYS = ['Q', 'W', 'E', 'R'];

export function paintIcon(cv, kind, theme) {
  const s = cv.width;
  const g = cv.getContext('2d');
  const bg = g.createRadialGradient(s * 0.35, s * 0.3, s * 0.1, s / 2, s / 2, s * 0.75);
  bg.addColorStop(0, theme.a);
  bg.addColorStop(1, theme.b);
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);
  g.save();
  g.translate(s / 2, s / 2);
  g.scale(s / 64, s / 64);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = theme.glyph;
  g.fillStyle = theme.glyph;
  g.shadowColor = theme.accent;
  g.shadowBlur = 8;
  g.lineWidth = 3.5;
  const P = (pts, fill = true) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    fill ? g.fill() : g.stroke();
  };
  switch (kind) {
    case 'sword':
      g.rotate(-Math.PI / 4);
      P([[-3, 18], [3, 18], [3, -16], [0, -24], [-3, -16]]);
      g.fillRect(-11, 16, 22, 4); g.fillRect(-2, 20, 4, 8);
      break;
    case 'bigsword':
      P([[-5, 10], [5, 10], [5, -20], [0, -28], [-5, -20]]);
      g.fillRect(-15, 10, 30, 5); g.fillRect(-2.5, 15, 5, 10);
      g.globalAlpha = 0.6; g.beginPath(); g.arc(0, 24, 10, Math.PI, 0); g.stroke();
      break;
    case 'shield':
      P([[0, -24], [18, -16], [16, 6], [0, 24], [-16, 6], [-18, -16]], false);
      P([[0, -15], [10, -10], [9, 4], [0, 14], [-9, 4], [-10, -10]]);
      break;
    case 'spin':
      for (let i = 0; i < 3; i++) {
        g.rotate((Math.PI * 2) / 3);
        g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 0.6); g.stroke();
        P([[18, 0], [24, 6], [12, 6]]);
      }
      g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill();
      break;
    case 'heart':
      g.beginPath(); g.moveTo(0, 18); g.bezierCurveTo(-26, 0, -14, -22, 0, -8); g.bezierCurveTo(14, -22, 26, 0, 0, 18); g.fill();
      break;
    case 'blood':
      for (const [x, y, r] of [[-8, -4, 7], [9, 2, 9], [-2, 14, 5]]) {
        g.beginPath(); g.moveTo(x, y - r * 2); g.quadraticCurveTo(x + r, y, x, y + r); g.quadraticCurveTo(x - r, y, x, y - r * 2); g.fill();
      }
      break;
    case 'axe':
      g.fillRect(-2, -24, 4, 48);
      g.beginPath(); g.moveTo(2, -20); g.quadraticCurveTo(26, -18, 22, 4); g.quadraticCurveTo(12, -4, 2, -2); g.fill();
      break;
    case 'axering':
      g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
      g.beginPath(); g.moveTo(14, -16); g.quadraticCurveTo(30, -4, 18, 14); g.quadraticCurveTo(18, 0, 10, -8); g.fill();
      break;
    case 'hand':
      g.fillRect(-10, -2, 20, 18);
      for (let i = 0; i < 4; i++) g.fillRect(-10 + i * 5.5, -20, 4, 20);
      g.fillRect(10, 0, 8, 4);
      break;
    case 'guillotine':
      g.fillRect(-18, -24, 4, 44); g.fillRect(14, -24, 4, 44); g.fillRect(-18, -24, 36, 4);
      P([[-14, -6], [14, -14], [14, -2], [-14, 6]]);
      break;
    case 'kick':
      P([[-16, -18], [-6, -20], [4, 0], [22, 16], [16, 20], [-4, 6]]);
      break;
    case 'sweep':
      g.beginPath(); g.moveTo(-18, 16); g.arc(-18, 16, 34, -Math.PI / 2.2, -Math.PI / 10); g.closePath(); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
      g.beginPath(); g.arc(-18, 16, 34, -Math.PI / 2.2, -Math.PI / 10); g.stroke();
      break;
    case 'hook':
      g.beginPath(); g.moveTo(-20, 20); g.lineTo(12, -12); g.stroke();
      g.beginPath(); g.arc(14, -14, 7, Math.PI * 0.7, Math.PI * 2.1); g.stroke();
      g.fillRect(-24, 16, 10, 10);
      break;
    case 'hex':
    case 'hexshield': {
      const hex = (r) => P([...Array(6)].map((_, i) => [Math.cos((i / 6) * Math.PI * 2) * r, Math.sin((i / 6) * Math.PI * 2) * r]), false);
      hex(22); g.globalAlpha = 0.6; hex(13); g.globalAlpha = 1;
      if (kind === 'hex') { g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill(); } else P([[0, -9], [8, -5], [7, 4], [0, 10], [-7, 4], [-8, -5]]);
      break;
    }
    case 'flash':
      P([[-4, -24], [10, -24], [2, -4], [14, -4], [-8, 24], [-2, 2], [-14, 2]]);
      break;
    case 'ignite':
      g.beginPath(); g.moveTo(0, -24); g.bezierCurveTo(18, -6, 16, 20, 0, 22); g.bezierCurveTo(-16, 20, -18, -2, -6, -12); g.bezierCurveTo(-6, -2, 0, 2, 0, -24); g.fill();
      break;
    default:
      g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(kind[0], 0, 2);
  }
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
}

function itemIcon(id) {
  const it = ITEMS[id];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const hue = it.ad ? 20 : it.hp && it.armor ? 140 : it.hp ? 0 : it.armor ? 45 : it.mr ? 270 : it.as ? 55 : it.ms ? 200 : 210;
  const tier = it.cost >= 2500 ? 3 : it.cost >= 1000 ? 2 : 1;
  const grd = g.createLinearGradient(0, 0, 64, 64);
  grd.addColorStop(0, `hsl(${hue},55%,${28 + tier * 6}%)`);
  grd.addColorStop(1, `hsl(${hue},60%,10%)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = tier === 3 ? '#f4d37a' : '#e8edf5';
  g.font = `bold ${tier === 3 ? 26 : 22}px "Microsoft YaHei", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(it.name.slice(0, tier === 3 ? 2 : 1), 32, 34);
  g.strokeStyle = tier === 3 ? '#c9a24c' : '#56607a';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 61, 61);
  return cv.toDataURL();
}

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function statLine(it) {
  const parts = [];
  if (it.ad) parts.push(`+${it.ad} 攻击力`);
  if (it.adBasePct) parts.push(`+${Math.round(it.adBasePct * 100)}% 基础攻击力`);
  if (it.hp) parts.push(`+${it.hp} 生命值`);
  if (it.armor) parts.push(`+${it.armor} 护甲`);
  if (it.mr) parts.push(`+${it.mr} 魔抗`);
  if (it.as) parts.push(`+${Math.round(it.as * 100)}% 攻速`);
  if (it.ms) parts.push(`+${it.ms} 移速`);
  if (it.haste) parts.push(`+${it.haste} 技能急速`);
  if (it.attackDr) parts.push(`普攻伤害 -${Math.round(it.attackDr * 100)}%`);
  if (it.healAmp) parts.push(`治疗效果 +${Math.round(it.healAmp * 100)}%`);
  if (it.sheen) parts.push('咒刃：施法后下次普攻 +200% 基础攻击力');
  if (it.cleave) parts.push('普攻英雄叠加护甲削减（最多30%）');
  if (it.immolate) parts.push('献祭：持续灼烧周围敌人');
  return parts.join('<br>');
}

export class Hud {
  constructor(root, view) {
    this.root = root;
    this.view = view;
    this.cache = new Map();
    root.innerHTML = '';
    root.classList.remove('hidden');
    this.itemIcons = Object.fromEntries(ITEM_IDS.map((id) => [id, itemIcon(id)]));
    this.build();
  }

  set(e, key, v) {
    const c = this.cache.get(e) || {};
    if (c[key] === v) return;
    c[key] = v;
    this.cache.set(e, c);
    if (key === 'text') e.textContent = v;
    else if (key === 'html') e.innerHTML = v;
    else if (key === 'cls') e.className = v;
    else if (key.startsWith('style.')) e.style[key.slice(6)] = v;
    else e[key] = v;
  }

  build() {
    const r = this.root;
    const g = this.view.game;
    const team = this.view.playerTeam;
    const me = g.champions[team];
    const enemy = g.champions[1 - team];
    this.me = me;
    this.enemy = enemy;
    const theme = CHAMP_THEME[me.champ];

    // top scoreboard
    const top = el('div', 'topbar', r);
    this.kB = el('span', 'k blue', top, '0');
    el('span', 'sword', top, '⚔');
    this.kR = el('span', 'k red', top, '0');
    this.clock = el('span', 'clock', top, '00:00');
    this.csEl = el('span', 'cs', top, 'CS 0');
    this.towerEl = el('span', 'towers', top, '');

    // enemy frame
    const ef = el('div', 'enemy-frame', r);
    const ec = el('canvas', 'portrait-sm', ef);
    ec.width = ec.height = 64;
    paintIcon(ec, ICONS[enemy.champ].P, CHAMP_THEME[enemy.champ]);
    const einfo = el('div', 'einfo', ef);
    this.eName = el('div', 'ename', einfo, `${enemy.def.title} · ${enemy.def.name}`);
    const ebar = el('div', 'ebar', einfo);
    this.eHp = el('div', 'fill hp-red', ebar);
    this.eLvl = el('div', 'elvl', ef, '1');
    this.eItems = el('div', 'eitems', einfo);

    this.announce = el('div', 'announce', r);

    // bottom panel
    const bottom = el('div', 'bottom', r);
    const portrait = el('div', 'portrait', bottom);
    const pc = el('canvas', '', portrait);
    pc.width = pc.height = 96;
    paintIcon(pc, ICONS[me.champ].P, theme);
    this.lvl = el('div', 'lvl', portrait, '1');
    this.xpRing = el('div', 'xp', portrait);
    this.passiveName = el('div', 'pname', portrait, me.def.name);

    const stats = el('div', 'stats', bottom);
    this.statEls = {};
    for (const [k, label] of [['ad', '攻击'], ['as', '攻速'], ['armor', '护甲'], ['mr', '魔抗'], ['ms', '移速'], ['haste', '急速']]) {
      const row = el('div', 'stat', stats);
      el('span', 'sl', row, label);
      this.statEls[k] = el('span', 'sv', row, '0');
    }

    const center = el('div', 'center', bottom);
    const abil = el('div', 'abilities', center);
    this.slots = {};
    for (const s of [...SLOT_KEYS, 'D', 'F']) {
      const isSum = s === 'D' || s === 'F';
      const slot = el('div', 'slot' + (isSum ? ' summ' : ''), abil);
      const cv = el('canvas', '', slot);
      cv.width = cv.height = 72;
      paintIcon(cv, isSum ? (s === 'D' ? 'flash' : 'ignite') : ICONS[me.champ][s], isSum ? { a: s === 'D' ? '#c9a84a' : '#a8401a', b: '#1a1208', accent: '#ffd36b', glyph: '#fff8e0' } : theme);
      const cd = el('div', 'cd', slot);
      const cdt = el('div', 'cdt', slot);
      el('div', 'key', slot, s);
      const pips = isSum ? null : el('div', 'pips', slot);
      if (pips) for (let i = 0; i < (s === 'R' ? 3 : 5); i++) el('i', '', pips);
      const up = isSum ? null : el('div', 'lvlup', slot, '+');
      const cost = isSum ? null : el('div', 'cost', slot);
      if (up) up.addEventListener('mousedown', (e) => { e.stopPropagation(); this.view.levelUp(s); });
      slot.addEventListener('mouseenter', () => this.showTooltip(slot, s));
      slot.addEventListener('mouseleave', () => this.hideTooltip());
      this.slots[s] = { slot, cd, cdt, pips, up, cost };
    }
    const bars = el('div', 'bars', center);
    const hpb = el('div', 'bar hpbar', bars);
    this.hpFill = el('div', 'fill hp-green', hpb);
    this.shFill = el('div', 'fill shield', hpb);
    this.hpText = el('div', 'txt', hpb);
    this.hpRegen = el('div', 'regen', hpb);
    const mpb = el('div', 'bar mpbar', bars);
    this.mpFill = el('div', 'fill ' + (me.stats.maxMana ? 'mp' : 'nores'), mpb);
    this.mpText = el('div', 'txt', mpb);

    const inv = el('div', 'inventory', bottom);
    const grid = el('div', 'items', inv);
    this.itemSlots = [];
    for (let i = 0; i < 6; i++) {
      const it = el('div', 'item', grid);
      it.addEventListener('contextmenu', (e) => { e.preventDefault(); this.view.sell(i); });
      it.addEventListener('mouseenter', () => this.showItemTip(it, this.me.items[i]));
      it.addEventListener('mouseleave', () => this.hideTooltip());
      this.itemSlots.push(it);
    }
    const goldRow = el('div', 'goldrow', inv);
    this.goldEl = el('div', 'gold', goldRow, '0');
    const shopBtn = el('button', 'shopbtn', goldRow, '商店 (P)');
    shopBtn.addEventListener('click', () => this.toggleShop());

    // minimap
    this.mini = el('canvas', 'minimap', r);
    this.mini.width = this.mini.height = 440;
    this.mini.addEventListener('mousedown', (e) => this.onMinimap(e));
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());

    this.death = el('div', 'death hidden', r);
    this.end = el('div', 'endscreen hidden', r);
    this.tooltip = el('div', 'tooltip hidden', r);
    this.buildShop();
    this.buildHelp();
    this.buildPause();
    this.debug = el('div', 'debug hidden', r);
    this.debugCanvas = el('canvas', '', this.debug);
    this.debugCanvas.width = 400;
    this.debugCanvas.height = 160;
    this.debugText = el('pre', '', this.debug);
    this.cameraHint = el('div', 'camhint', r, '');
    this.playing = this.view.mode === 'play' || this.view.mode === 'practice';
    if (!this.playing) {
      bottom.classList.add('hidden');
      this.specBar = el('div', 'specbar', r);
    }
  }

  buildShop() {
    const s = el('div', 'shop hidden', this.root);
    this.shop = s;
    const head = el('div', 'shop-head', s, '<b>商店</b><span class="hint">在泉水内或阵亡时可购买 · 右键物品栏出售</span>');
    const close = el('button', 'close', head, '×');
    close.addEventListener('click', () => this.toggleShop(false));
    const grid = el('div', 'shop-grid', s);
    this.shopItems = {};
    const order = [...ITEM_IDS].sort((a, b) => ITEMS[a].cost - ITEMS[b].cost);
    for (const id of order) {
      const it = ITEMS[id];
      const card = el('div', 'shop-item', grid);
      const img = el('img', '', card);
      img.src = this.itemIcons[id];
      const info = el('div', 'si-info', card);
      el('div', 'si-name', info, it.name);
      el('div', 'si-stats', info, statLine(it));
      if (it.from) el('div', 'si-from', info, '合成: ' + it.from.map((f) => ITEMS[f].name).join(' + '));
      const price = el('div', 'si-price', card, String(it.cost));
      card.addEventListener('click', () => this.view.buy(id));
      this.shopItems[id] = { card, price };
    }
  }

  buildHelp() {
    const h = el('div', 'help hidden', this.root);
    this.help = h;
    h.innerHTML = `
      <h3>操作说明（与英雄联盟一致）</h3>
      <table>
        <tr><td>右键地面 / 按住右键</td><td>移动</td></tr>
        <tr><td>右键敌人</td><td>普攻 / 追击</td></tr>
        <tr><td>A + 左键</td><td>攻击移动（自动攻击最近敌人）</td></tr>
        <tr><td>S</td><td>停止</td></tr>
        <tr><td>Q W E R</td><td>技能（快捷施法，朝鼠标方向；R 对鼠标附近的敌方英雄）</td></tr>
        <tr><td>Ctrl/Alt + Q W E R</td><td>升级技能（或点击技能上方 +）</td></tr>
        <tr><td>D / F</td><td>闪现 / 引燃</td></tr>
        <tr><td>P</td><td>商店（泉水内）</td></tr>
        <tr><td>Y / 空格</td><td>锁定镜头 / 镜头回到英雄</td></tr>
        <tr><td>滚轮</td><td>缩放</td></tr>
        <tr><td>Tab</td><td>数据面板</td></tr>
        <tr><td>F9</td><td>RL 观测调试面板</td></tr>
        <tr><td>Esc</td><td>暂停菜单</td></tr>
        <tr><td>H</td><td>显示/隐藏帮助</td></tr>
      </table>`;
  }

  buildPause() {
    const p = el('div', 'pause hidden', this.root);
    this.pause = p;
    const box = el('div', 'pause-box', p);
    el('h2', '', box, '暂停');
    const mk = (label, fn) => { const b = el('button', '', box, label); b.addEventListener('click', fn); return b; };
    mk('继续游戏', () => this.view.togglePause(false));
    mk('下载本局回放', () => this.view.downloadReplay());
    const vol = el('label', 'vol', box, '音量 ');
    const slider = el('input', '', vol);
    slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.05; slider.value = this.view.sfx.volume;
    slider.addEventListener('input', () => this.view.sfx.setVolume(Number(slider.value)));
    const ind = el('label', 'vol', box, '');
    const cb = el('input', '', ind);
    cb.type = 'checkbox';
    cb.checked = this.view.settings.indicatorCast;
    ind.append(' 带指示器施法（按住显示，松开施放）');
    cb.addEventListener('change', () => { this.view.settings.indicatorCast = cb.checked; });
    const al = el('label', 'vol', box, '');
    const cb2 = el('input', '', al);
    cb2.type = 'checkbox';
    cb2.checked = this.view.game.cfg.autoLevel[this.view.playerTeam];
    al.append(' 自动加点');
    cb2.addEventListener('change', () => {
      this.view.game.cfg.autoLevel[this.view.playerTeam] = cb2.checked;
      if (cb2.checked) this.view.game.autoLevel(this.me);
    });
    mk('退出到主菜单', () => this.view.exit());
  }

  toggleShop(v) {
    const show = v ?? this.shop.classList.contains('hidden');
    this.shop.classList.toggle('hidden', !show);
  }

  showTooltip(anchor, slot) {
    const me = this.me;
    let html;
    if (slot === 'D' || slot === 'F') {
      const sp = SUMMONERS[slot];
      html = `<b>${slot === 'D' ? '闪现' : '引燃'}</b><div class="tt-meta">冷却 ${sp.cd}s · 距离 ${sp.range}</div>` +
        (slot === 'D' ? '向鼠标方向瞬移一段短距离。' : '使敌方英雄燃烧，5秒内造成真实伤害并施加重伤。');
    } else {
      const ab = me.def.abilities[slot];
      const rank = Math.max(1, me.ranks[slot]);
      const cost = ab.cost ? rankValue(ab.cost, rank) : 0;
      html = `<b>${ab.name}</b> <span class="tt-rank">等级 ${me.ranks[slot]}</span>` +
        `<div class="tt-meta">冷却 ${ab.cd.join('/')}s${cost ? ` · 消耗 ${cost} 法力` : ''}${ab.range ? ` · 范围 ${ab.range}` : ''}</div>${ab.desc}`;
    }
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    this.tooltip.style.left = `${r.left + r.width / 2}px`;
    this.tooltip.style.top = `${r.top - 10}px`;
  }

  showItemTip(anchor, id) {
    if (!id) return;
    this.tooltip.innerHTML = `<b>${ITEMS[id].name}</b><div class="tt-meta">出售价 ${Math.floor(ITEMS[id].cost * 0.7)}</div>${statLine(ITEMS[id])}`;
    this.tooltip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    this.tooltip.style.left = `${r.left + r.width / 2}px`;
    this.tooltip.style.top = `${r.top - 10}px`;
  }

  hideTooltip() {
    this.tooltip.classList.add('hidden');
  }

  pushAnnounce(text, cls = '') {
    const a = el('div', 'msg ' + cls, this.announce, text);
    setTimeout(() => a.classList.add('out'), 2600);
    setTimeout(() => a.remove(), 3300);
    while (this.announce.children.length > 3) this.announce.firstChild.remove();
  }

  showEnd(won, stats) {
    this.end.classList.remove('hidden');
    this.end.innerHTML = `<div class="end-title ${won ? 'win' : 'lose'}">${won ? '胜利' : '失败'}</div>
      <div class="end-stats">${stats}</div>`;
    const row = el('div', 'end-buttons', this.end);
    const b1 = el('button', '', row, '下载回放');
    b1.addEventListener('click', () => this.view.downloadReplay());
    const b2 = el('button', '', row, '返回主菜单');
    b2.addEventListener('click', () => this.view.exit());
  }

  onMinimap(e) {
    e.preventDefault();
    const r = this.mini.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const p = this.miniToSim(u, v);
    if (e.button === 2) this.view.minimapMove(p);
    else this.view.minimapLook(p);
  }

  // minimap: lane drawn diagonally like the 3D view
  simToMini(x, y) {
    const t = x / MAP_LENGTH;
    const cx = 0.08 + t * 0.84, cy = 0.92 - t * 0.84;
    const k = 0.84 / MAP_LENGTH;
    return [cx + y * k, cy + y * k];
  }

  miniToSim(u, v) {
    const k = 0.84 / MAP_LENGTH;
    const a = u - 0.08, b = v - 0.92;
    const yk = (a + b) / 2;
    const t = (a - yk) / 0.84;
    return { x: t * MAP_LENGTH, y: yk / k };
  }

  drawMinimap(game, camFocusSim) {
    const cv = this.mini, g = cv.getContext('2d');
    const W = cv.width;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(6,12,22,0.92)';
    g.fillRect(0, 0, W, W);
    g.save();
    g.scale(W, W);
    g.beginPath();
    for (let x = 40; x <= MAP_LENGTH - 40; x += 200) { const [u, v] = this.simToMini(x, halfWidth(x)); x === 40 ? g.moveTo(u, v) : g.lineTo(u, v); }
    for (let x = MAP_LENGTH - 40; x >= 40; x -= 200) { const [u, v] = this.simToMini(x, -halfWidth(x)); g.lineTo(u, v); }
    g.closePath();
    const grd = g.createLinearGradient(0, 1, 1, 0);
    grd.addColorStop(0, '#2b3d5c');
    grd.addColorStop(0.5, '#4a5a72');
    grd.addColorStop(1, '#5a3442');
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 0.004;
    g.strokeStyle = '#9fb7d8';
    g.stroke();
    const dot = (x, y, r, col, stroke) => {
      const [u, v] = this.simToMini(x, y);
      g.beginPath(); g.arc(u, v, r, 0, Math.PI * 2);
      g.fillStyle = col; g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.004; g.stroke(); }
    };
    const tc = ['#4fb4ff', '#ff5a5a'];
    for (const team of [0, 1]) {
      for (const tw of game.towers[team]) {
        const [u, v] = this.simToMini(tw.x, tw.y);
        g.fillStyle = tw.alive ? tc[team] : '#555';
        g.fillRect(u - 0.014, v - 0.014, 0.028, 0.028);
        if (tw.alive) { g.strokeStyle = '#000'; g.lineWidth = 0.003; g.strokeRect(u - 0.014, v - 0.014, 0.028, 0.028); }
      }
      const nx = game.nexus[team];
      dot(nx.x, nx.y, 0.022, nx.alive ? tc[team] : '#555', '#000');
    }
    for (const r of game.relics) if (game.time >= r.availableAt) dot(r.x, r.y, 0.008, '#5dff8f');
    for (const u of game.units) {
      if (u.kind !== 'minion' || !u.alive) continue;
      dot(u.x, u.y, 0.008, tc[u.team]);
    }
    for (const c of game.champions) {
      if (!c.alive) continue;
      const th = CHAMP_THEME[c.champ];
      dot(c.x, c.y, 0.03, th.a, c.team === this.view.playerTeam ? '#ffd76a' : tc[c.team]);
      const [u, v] = this.simToMini(c.x, c.y);
      g.fillStyle = '#fff';
      g.font = 'bold 0.034px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c.def.name[0], u, v + 0.002);
    }
    if (camFocusSim) {
      const [u, v] = this.simToMini(camFocusSim.x, camFocusSim.y);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 0.004;
      g.strokeRect(u - 0.09, v - 0.06, 0.18, 0.12);
    }
    g.restore();
  }

  update(dt) {
    const v = this.view;
    const g = v.game;
    const me = this.me, en = this.enemy;
    this.set(this.kB, 'text', String(g.champions[0].kills));
    this.set(this.kR, 'text', String(g.champions[1].kills));
    this.set(this.clock, 'text', fmtTime(g.time));
    this.set(this.csEl, 'text', `CS ${me.cs}`);
    const tw = (t) => g.towers[t].filter((x) => x.alive).length;
    this.set(this.towerEl, 'html', `<i class="tb"></i>${tw(0)} <i class="tr"></i>${tw(1)}`);

    this.set(this.eLvl, 'text', String(en.level));
    this.set(this.eHp, 'style.width', `${(en.alive ? en.hp / en.stats.maxHp : 0) * 100}%`);
    this.set(this.eItems, 'html', en.items.map((id) => `<img src="${this.itemIcons[id]}">`).join(''));

    if (this.playing) this.updatePlayerPanel(g, me);
    else this.set(this.specBar, 'html', v.specText());

    const deadTime = me.alive ? 0 : Math.ceil(me.respawnAt - g.time);
    this.death.classList.toggle('hidden', me.alive || !this.playing || g.over);
    if (!me.alive) this.set(this.death, 'html', `<div>你已阵亡</div><div class="t">${deadTime}</div><div class="s">按 P 打开商店</div>`);
    this.drawMinimap(g, v.cameraFocusSim());
    if (!this.debug.classList.contains('hidden')) this.drawDebug(g);
    this.set(this.cameraHint, 'text', v.cameraLocked ? '' : '镜头未锁定（Y 锁定）');
  }

  updatePlayerPanel(g, me) {
    const st = me.stats;
    this.set(this.lvl, 'text', String(me.level));
    const XP = [0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120, 7300, 8580, 9960, 11440, 13020, 14700, 16480, 18360];
    const lo = XP[me.level - 1], hi = XP[me.level] ?? lo + 1;
    const xpPct = me.level >= 18 ? 100 : ((me.xp - lo) / (hi - lo)) * 100;
    this.set(this.xpRing, 'style.background', `conic-gradient(#b48cff ${xpPct}%, rgba(0,0,0,0.5) 0)`);
    this.set(this.statEls.ad, 'text', String(Math.round(st.ad)));
    this.set(this.statEls.as, 'text', st.as.toFixed(2));
    this.set(this.statEls.armor, 'text', String(Math.round(st.armor)));
    this.set(this.statEls.mr, 'text', String(Math.round(st.mr)));
    this.set(this.statEls.ms, 'text', String(Math.round(st.ms)));
    this.set(this.statEls.haste, 'text', String(Math.round(st.haste)));
    const shield = me.shields.reduce((s, x) => s + (x.end > g.time ? x.amount : 0), 0);
    const total = Math.max(st.maxHp, me.hp + shield);
    this.set(this.hpFill, 'style.width', `${(me.hp / total) * 100}%`);
    this.set(this.shFill, 'style.left', `${(me.hp / total) * 100}%`);
    this.set(this.shFill, 'style.width', `${(shield / total) * 100}%`);
    this.set(this.hpText, 'text', `${Math.ceil(me.hp)} / ${Math.round(st.maxHp)}`);
    this.set(this.hpRegen, 'text', `+${st.hpRegen.toFixed(1)}`);
    if (st.maxMana) {
      this.set(this.mpFill, 'style.width', `${(me.mana / st.maxMana) * 100}%`);
      this.set(this.mpText, 'text', `${Math.floor(me.mana)} / ${Math.round(st.maxMana)}`);
    } else this.set(this.mpText, 'text', '无消耗');
    for (const s of [...SLOT_KEYS, 'D', 'F']) {
      const ui = this.slots[s];
      const a = g.abilityState(me, s);
      const ab = s === 'D' || s === 'F' ? null : me.def.abilities[s];
      const total = ab ? (ab.cd ? rankValue(ab.cd, Math.max(1, a.rank)) * 100 / (100 + (st.haste || 0)) : 1) : SUMMONERS[s].cd;
      const locked = a.rank === 0;
      const noMana = !locked && !a.recast && a.cdLeft <= 0 && me.mana < a.cost;
      const pct = a.recast ? 0 : Math.min(100, (a.cdLeft / total) * 100);
      this.set(ui.cd, 'style.background', pct > 0 ? `conic-gradient(transparent ${100 - pct}%, rgba(4,8,14,0.78) 0)` : 'none');
      this.set(ui.cdt, 'text', a.cdLeft > 0 && !a.recast ? (a.cdLeft < 1 ? a.cdLeft.toFixed(1) : String(Math.ceil(a.cdLeft))) : '');
      const cls = 'slot' + (s === 'D' || s === 'F' ? ' summ' : '') + (locked ? ' locked' : '') + (noMana ? ' nomana' : '') + (a.recast ? ' recast' : '') + (a.ready && !a.recast ? ' ready' : '');
      this.set(ui.slot, 'className', cls);
      if (ui.pips) {
        const html = Array.from({ length: s === 'R' ? 3 : 5 }, (_, i) => `<i class="${i < a.rank ? 'on' : ''}"></i>`).join('');
        this.set(ui.pips, 'html', html);
        this.set(ui.up, 'style.display', g.canLevelSkill(me, s) ? 'flex' : 'none');
        this.set(ui.cost, 'text', a.cost ? String(a.cost) : '');
      }
    }
    for (let i = 0; i < 6; i++) {
      const id = me.items[i];
      this.set(this.itemSlots[i], 'style.backgroundImage', id ? `url(${this.itemIcons[id]})` : 'none');
    }
    this.set(this.goldEl, 'text', String(Math.floor(me.gold)));
    if (!this.shop.classList.contains('hidden')) {
      const can = g.canShop(me);
      for (const [id, ui] of Object.entries(this.shopItems)) {
        const { price } = itemPrice(me.items, id);
        this.set(ui.price, 'text', String(price));
        this.set(ui.card, 'className', 'shop-item' + (can && me.gold >= price ? ' afford' : '') + (can ? '' : ' disabled'));
      }
    }
  }

  drawDebug(g) {
    const team = this.view.playerTeam;
    const { obs, mask } = encodeObs(g, team);
    const cv = this.debugCanvas, c = cv.getContext('2d');
    const cols = 40, cell = 10;
    c.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < OBS_DIM; i++) {
      const v = Math.max(-1, Math.min(1, obs[i]));
      c.fillStyle = v >= 0 ? `rgba(80,200,255,${v})` : `rgba(255,90,90,${-v})`;
      c.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, cell - 1, cell - 1);
    }
    const tot = g.totals[team];
    const maskStr = ACTION_TYPES.map((a, i) => `${mask[i] ? '■' : '□'}${a}`).join(' ');
    this.set(this.debugText, 'text',
      `obs_dim=${OBS_DIM}  tick=${g.tick}\nmask: ${maskStr}\n` +
      Object.entries(tot).map(([k, v]) => `${k}=${Math.round(v)}`).join('  '));
  }

  toggle(name, v) {
    const e = this[name];
    if (!e) return;
    const show = v ?? e.classList.contains('hidden');
    e.classList.toggle('hidden', !show);
  }

  dispose() {
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }
}
