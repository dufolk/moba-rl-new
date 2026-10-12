// Procedural sound effects with Web Audio — no asset files needed.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.5;
    this.last = {};
  }

  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  throttle(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now;
    return true;
  }

  env(node, t0, a, peak, dur) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  noise(dur, f0, f1, q = 1, peak = 0.5, type = 'bandpass', vol = 1) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, peak * vol, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(type, f0, f1, dur, peak = 0.3, delay = 0) {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.004, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  swing(heavy = false, vol = 1) {
    if (!this.throttle('swing', 40)) return;
    this.noise(heavy ? 0.28 : 0.18, heavy ? 500 : 900, heavy ? 2200 : 3600, 1.2, 0.35, 'bandpass', vol);
  }

  hit(heavy = false, vol = 1) {
    if (!this.throttle('hit' + heavy, 35)) return;
    this.tone('sine', heavy ? 140 : 190, heavy ? 45 : 70, heavy ? 0.22 : 0.12, 0.45 * vol);
    this.noise(0.08, 2500, 600, 0.8, 0.35 * vol, 'lowpass');
    if (heavy) this.tone('triangle', 900, 500, 0.12, 0.12 * vol);
  }

  minionHit(vol = 0.35) {
    if (!this.throttle('mh', 60)) return;
    this.noise(0.06, 1800, 700, 1, 0.2 * vol, 'bandpass');
  }

  zap() {
    if (!this.throttle('zap', 80)) return;
    this.tone('sawtooth', 700, 180, 0.25, 0.12);
    this.noise(0.25, 4000, 800, 2, 0.12, 'bandpass');
  }

  boom(big = false) {
    this.noise(big ? 1.2 : 0.6, 900, 60, 0.7, big ? 0.9 : 0.6, 'lowpass');
    this.tone('sine', 90, 30, big ? 1.0 : 0.5, 0.6);
  }

  coin() {
    if (!this.throttle('coin', 50)) return;
    this.tone('square', 1320, 1320, 0.07, 0.05);
    this.tone('square', 1760, 1760, 0.12, 0.05, 0.06);
  }

  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.12, i * 0.07));
  }

  spell(kind = 'whoosh') {
    if (kind === 'whoosh') this.noise(0.4, 300, 3000, 1.5, 0.3);
    else if (kind === 'heavy') { this.noise(0.5, 200, 1200, 1, 0.4); this.tone('sawtooth', 110, 55, 0.4, 0.15); }
    else if (kind === 'shield') { this.tone('sine', 400, 900, 0.35, 0.15); this.tone('triangle', 800, 1200, 0.3, 0.08, 0.05); }
    else if (kind === 'hex') { this.tone('sine', 1200, 300, 0.25, 0.12); this.noise(0.2, 6000, 2000, 3, 0.12); }
    else if (kind === 'spin') this.noise(0.22, 600, 1800, 2, 0.18);
  }

  flash() {
    this.tone('sine', 1500, 3000, 0.15, 0.12);
    this.noise(0.15, 8000, 3000, 2, 0.12, 'highpass');
  }

  death() {
    this.tone('sawtooth', 220, 55, 0.9, 0.18);
  }

  ui() {
    this.tone('triangle', 900, 1100, 0.05, 0.06);
  }
}
