import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.texts = [];
    this.dpr = 1;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  project(camera, x, y, z) {
    _v.set(x, y, z).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, behind: _v.z > 1 };
  }

  floatText(pos, text, o = {}) {
    this.texts.push({
      x: pos.x, y: pos.y, z: pos.z, text, color: o.color || '#fff', size: o.size || 18, life: o.life || 0.9, t: 0,
      vx: (Math.random() - 0.5) * 30, rise: o.rise ?? 70, outline: o.outline || 'rgba(0,0,0,0.85)', crit: !!o.crit,
    });
    if (this.texts.length > 120) this.texts.shift();
  }

  clear() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
  }

  championBar(p, u, o) {
    const c = this.ctx;
    const w = 118, h = 11, mh = 4;
    const x = Math.round(p.x - w / 2 + 10), y = Math.round(p.y - 26);
    const maxHp = u.stats.maxHp;
    const shield = o.shield || 0;
    const total = Math.max(maxHp, u.hp + shield);
    // frame
    c.fillStyle = 'rgba(8,10,14,0.85)';
    c.fillRect(x - 22, y - 2, w + 24, h + mh + 5);
    c.strokeStyle = 'rgba(190,160,90,0.9)';
    c.lineWidth = 1;
    c.strokeRect(x - 22 + 0.5, y - 2 + 0.5, w + 23, h + mh + 4);
    // level box
    c.fillStyle = '#141820';
    c.fillRect(x - 20, y, 18, h + mh + 1);
    c.fillStyle = '#e8d9a8';
    c.font = 'bold 11px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(u.level), x - 11, y + (h + mh) / 2 + 1);
    // hp
    c.fillStyle = '#2a0d0d';
    c.fillRect(x, y, w, h);
    const hpW = (u.hp / total) * w;
    const grd = c.createLinearGradient(0, y, 0, y + h);
    const col = o.color;
    grd.addColorStop(0, col[0]);
    grd.addColorStop(1, col[1]);
    // damage trail
    if (o.trail > u.hp) {
      c.fillStyle = 'rgba(255,230,180,0.85)';
      c.fillRect(x + hpW, y, ((o.trail - u.hp) / total) * w, h);
    }
    c.fillStyle = grd;
    c.fillRect(x, y, hpW, h);
    if (shield > 0) {
      c.fillStyle = 'rgba(240,240,240,0.92)';
      c.fillRect(x + hpW, y, (shield / total) * w, h);
    }
    // ticks every 100 hp, thick per 1000
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (let v = 100; v < total; v += 100) {
      const tx = x + (v / total) * w;
      const big = v % 1000 === 0;
      c.fillRect(Math.round(tx), y, big ? 2 : 1, big ? h : h * 0.55);
    }
    // mana / resource
    c.fillStyle = '#0b1530';
    c.fillRect(x, y + h + 1, w, mh);
    if (u.stats.maxMana) {
      c.fillStyle = '#3d7bff';
      c.fillRect(x, y + h + 1, (u.mana / u.stats.maxMana) * w, mh);
    } else {
      c.fillStyle = '#5a6070';
      c.fillRect(x, y + h + 1, w, mh);
    }
    if (o.name) {
      c.font = '600 12px "Segoe UI", "Microsoft YaHei", sans-serif';
      c.fillStyle = o.nameColor || '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.9)';
      c.lineWidth = 3;
      c.strokeText(o.name, p.x + 10, y - 10);
      c.fillText(o.name, p.x + 10, y - 10);
    }
    if (o.badges && o.badges.length) {
      c.font = 'bold 11px "Microsoft YaHei", sans-serif';
      let bx = x;
      for (const b of o.badges) {
        const tw = c.measureText(b.text).width + 10;
        c.fillStyle = b.bg;
        c.fillRect(bx, y + h + mh + 5, tw, 15);
        c.fillStyle = '#fff';
        c.textAlign = 'left';
        c.fillText(b.text, bx + 5, y + h + mh + 13);
        c.textAlign = 'center';
        bx += tw + 3;
      }
    }
  }

  smallBar(p, u, color, w = 52, h = 5, trail = 0) {
    const c = this.ctx;
    const x = Math.round(p.x - w / 2), y = Math.round(p.y - 8);
    c.fillStyle = 'rgba(5,6,8,0.85)';
    c.fillRect(x - 1, y - 1, w + 2, h + 2);
    const r = Math.max(0, u.hp / u.stats.maxHp);
    if (trail > u.hp) {
      c.fillStyle = 'rgba(255,230,180,0.8)';
      c.fillRect(x, y, (trail / u.stats.maxHp) * w, h);
    }
    c.fillStyle = color;
    c.fillRect(x, y, r * w, h);
  }

  structureBar(p, u, color, trail, vulnerable) {
    const c = this.ctx;
    const w = 130, h = 9;
    const x = Math.round(p.x - w / 2), y = Math.round(p.y - 10);
    c.fillStyle = 'rgba(5,6,8,0.85)';
    c.fillRect(x - 2, y - 2, w + 4, h + 4);
    c.strokeStyle = vulnerable ? 'rgba(220,190,110,0.9)' : 'rgba(120,120,130,0.7)';
    c.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    const r = u.hp / u.stats.maxHp;
    if (trail > u.hp) {
      c.fillStyle = 'rgba(255,230,180,0.8)';
      c.fillRect(x, y, (trail / u.stats.maxHp) * w, h);
    }
    c.fillStyle = color;
    c.fillRect(x, y, r * w, h);
    if (!vulnerable) {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(x, y, w, h);
    }
  }

  drawTexts(camera, dt) {
    const c = this.ctx;
    const keep = [];
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const t of this.texts) {
      t.t += dt;
      if (t.t >= t.life) continue;
      keep.push(t);
      const p = this.project(camera, t.x, t.y, t.z);
      if (p.behind) continue;
      const q = t.t / t.life;
      const pop = q < 0.12 ? 1 + (1 - q / 0.12) * (t.crit ? 0.9 : 0.5) : 1;
      const size = t.size * pop;
      const a = q > 0.65 ? 1 - (q - 0.65) / 0.35 : 1;
      c.globalAlpha = a;
      c.font = `900 ${size.toFixed(1)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      c.lineWidth = 4;
      c.strokeStyle = t.outline;
      const x = p.x + t.vx * q, y = p.y - t.rise * (1 - Math.pow(1 - q, 2));
      c.strokeText(t.text, x, y);
      c.fillStyle = t.color;
      c.fillText(t.text, x, y);
    }
    c.globalAlpha = 1;
    this.texts = keep;
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.clear();
  }
}
