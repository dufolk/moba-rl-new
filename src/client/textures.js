import * as THREE from 'three';

function hash(x, y, s = 0) {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function vnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(x, y, oct = 4, s = 0) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x * f, y * f, s + i * 13);
    f *= 2;
    a *= 0.5;
  }
  return v;
}

/**
 * Irregular flagstone pavement. Returns { map, normalMap, roughnessMap }.
 * Height field: stones raised, mortar grooves low, plus surface noise.
 */
export function makeStoneTextures(size = 512) {
  const H = new Float32Array(size * size);
  const col = new Uint8ClampedArray(size * size * 4);
  const cells = 7;
  // jittered voronoi cells -> stones
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    pts.push([(i + 0.15 + 0.7 * hash(i, j, 1)) / cells, (j + 0.15 + 0.7 * hash(i, j, 2)) / cells, hash(i, j, 3)]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let d1 = 9, d2 = 9, id = 0;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
        const ii = ci + oi, jj = cj + oj;
        const wi = (ii + cells) % cells, wj = (jj + cells) % cells;
        const k = wj * cells + wi;
        const dx = pts[k][0] + (ii - wi) / cells - u, dy = pts[k][1] + (jj - wj) / cells - v;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; id = k; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const groove = Math.min(1, edge * cells * 6);
      const n = fbm(u * 24, v * 24, 4, 5);
      const h = groove * (0.75 + 0.25 * n);
      H[y * size + x] = h;
      const tone = pts[id][2];
      const base = 0.36 + tone * 0.16 + (n - 0.5) * 0.12;
      const r = base * (0.86 + 0.06 * tone), g = base * 0.95, b = base * 1.08 + 0.02;
      const m = groove < 0.6 ? 0.45 + 0.55 * (groove / 0.6) : 1;
      const i4 = (y * size + x) * 4;
      col[i4] = 255 * r * m;
      col[i4 + 1] = 255 * g * m;
      col[i4 + 2] = 255 * b * m;
      col[i4 + 3] = 255;
    }
  }
  const nrm = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
      const t = H[((y - 1 + size) % size) * size + x], b = H[((y + 1) % size) * size + x];
      const nx = (l - r) * 3, ny = (t - b) * 3, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i4 = (y * size + x) * 4;
      nrm[i4] = (nx / len * 0.5 + 0.5) * 255;
      nrm[i4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      nrm[i4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nrm[i4 + 3] = 255;
      const ro = 0.65 + 0.3 * (1 - H[y * size + x]);
      rough[i4] = rough[i4 + 1] = rough[i4 + 2] = ro * 255;
      rough[i4 + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(col, true), normalMap: mk(nrm, false), roughnessMap: mk(rough, false) };
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function ringTexture(size = 256, width = 0.08) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const r = Math.hypot(dx, dy);
    const ring = Math.exp(-Math.pow((r - (1 - width)) / width, 2) * 2.5);
    const fill = r < 1 ? 0.12 * r * r : 0;
    const a = Math.min(1, ring + fill) * (r <= 1 ? 1 : 0);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft slash arc: alpha gradient along U (fade tail) and V (thin bright edge). */
export function slashTexture() {
  const w = 256, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1);
    const edge = Math.pow(v, 3.0);
    const tail = Math.pow(u, 1.6);
    const a = edge * tail;
    const i = (y * w + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
