// Canvas renderer: background, territories, stars, colonies, probes, light fronts.
import { TYPES } from './galaxy.js';

const TAU = Math.PI * 2;

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
const rgb = (c, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const FERAL_RGB = [255, 60, 50];
const HUNTER_RGB = [235, 245, 255];

// A small perceptual-ish ramp (dark violet → teal → yellow)
const RAMP = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
function ramp(x) {
  x = Math.max(0, Math.min(1, x)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f | 0, a[1] + (b[1] - a[1]) * f | 0, a[2] + (b[2] - a[2]) * f | 0];
}

export const VIEW_MODES = {
  lineage: 'Strain (lineage)',
  civ: 'Civilisation',
  coop: 'Cooperation gene',
  expand: 'Expansion drive',
  tech: 'Tech level',
  age: 'Colony age',
  dyson: 'Dyson coverage',
  matter: 'Matter remaining',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, scale: 0.5 };
    this.inset = { top: 0, right: 0, bottom: 0, left: 0 }; // screen area covered by UI
    this.dpr = 1;
    this.sprites = {};
    this.terrCanvas = document.createElement('canvas');
    this.terrT = -1;
    this.terrKey = '';
    this.makeSprites();
  }

  setSim(sim) {
    this.sim = sim;
    this.g = sim.g;
    this.buildBackground();
    this.fit();
    this.terrT = -1;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w; this.h = h;
  }

  fit() {
    if (!this.g) return;
    const pad = 16, I = this.inset;
    const vw = this.w - I.left - I.right - pad * 2, vh = this.h - I.top - I.bottom - pad * 2;
    this.cam.scale = Math.min(vw / this.g.W, vh / this.g.H);
    // centre the map within the visible (uncovered) area
    const cx = I.left + pad + vw / 2, cy = I.top + pad + vh / 2;
    this.cam.x = this.g.W / 2 + (this.w / 2 - cx) / this.cam.scale;
    this.cam.y = this.g.H / 2 + (this.h / 2 - cy) / this.cam.scale;
  }

  toScreen(x, y) {
    return [(x - this.cam.x) * this.cam.scale + this.w / 2, (y - this.cam.y) * this.cam.scale + this.h / 2];
  }
  toWorld(sx, sy) {
    return [(sx - this.w / 2) / this.cam.scale + this.cam.x, (sy - this.h / 2) / this.cam.scale + this.cam.y];
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    const minS = Math.min(this.w / this.g.W, this.h / this.g.H) * 0.5;
    this.cam.scale = Math.max(minS, Math.min(40, this.cam.scale * factor));
    const [wx2, wy2] = this.toWorld(sx, sy);
    this.cam.x += wx - wx2;
    this.cam.y += wy - wy2;
  }

  pick(sx, sy, maxPx = 12) {
    const [wx, wy] = this.toWorld(sx, sy);
    const r = maxPx / this.cam.scale;
    const g = this.g;
    const cs = g.gridCell;
    let best = null, bd = r * r;
    const x0 = Math.max(0, Math.floor((wx - r) / cs)), x1 = Math.min(g.gw - 1, Math.floor((wx + r) / cs));
    const y0 = Math.max(0, Math.floor((wy - r) / cs)), y1 = Math.min(g.gh - 1, Math.floor((wy + r) / cs));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      for (const id of g.grid[y * g.gw + x]) {
        const s = g.stars[id];
        const d2 = (s.x - wx) ** 2 + (s.y - wy) ** 2;
        if (d2 < bd) { bd = d2; best = s; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- assets
  makeSprites() {
    const mk = (col, size = 64) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gr.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},1)`);
      gr.addColorStop(0.15, `rgba(${col[0]},${col[1]},${col[2]},0.45)`);
      gr.addColorStop(0.45, `rgba(${col[0]},${col[1]},${col[2]},0.08)`);
      gr.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      x.fillStyle = gr;
      x.fillRect(0, 0, size, size);
      return c;
    };
    for (const k of Object.keys(TYPES)) this.sprites[k] = mk(TYPES[k].color);
    this.sprites.ir = mk([255, 90, 50]);
    this.sprites.sn = mk([255, 170, 90]);
    this.sprites.remnant = mk([170, 110, 255]);
  }

  buildBackground() {
    const g = this.g;
    const bs = Math.min(1, 2600 / g.W);
    const c = document.createElement('canvas');
    c.width = Math.ceil(g.W * bs); c.height = Math.ceil(g.H * bs);
    const x = c.getContext('2d');
    x.fillStyle = '#020309';
    x.fillRect(0, 0, c.width, c.height);

    // Arm glow via a coarse density field, upscaled smoothly.
    const lw = Math.ceil(g.W / 12), lh = Math.ceil(g.H / 12);
    const low = document.createElement('canvas');
    low.width = lw; low.height = lh;
    const lx = low.getContext('2d');
    const img = lx.createImageData(lw, lh);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const wx = i * 12, wy = j * 12;
      const { a, r } = g.armTerm(wx, wy);
      const core = Math.exp(-(r - g.W * 1.15) / (g.W * 0.7));
      const v = 0.55 * a + 0.35 * core;
      const p = (j * lw + i) * 4;
      img.data[p] = 60 * v + 20 * core;
      img.data[p + 1] = 62 * v + 12 * core;
      img.data[p + 2] = 95 * v;
      img.data[p + 3] = 255;
    }
    lx.putImageData(img, 0, 0);
    x.imageSmoothingEnabled = true;
    x.globalCompositeOperation = 'lighter';
    x.drawImage(low, 0, 0, c.width, c.height);

    // unresolved background stars
    let seed = g.seed * 9973 + 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < c.width * c.height / 700; i++) {
      const px = rnd() * c.width, py = rnd() * c.height;
      const a = 0.08 + 0.25 * rnd() * (0.4 + g.armTerm(px / bs, py / bs).a);
      x.fillStyle = `rgba(200,210,255,${a})`;
      x.fillRect(px, py, 1, 1);
    }

    for (const n of g.nebulae) {
      const [r0, g0, b0] = hslToRgb(n.hue, 0.8, 0.5);
      for (let k = 0; k < 3; k++) {
        const ox = (rnd() - 0.5) * n.r * 0.8, oy = (rnd() - 0.5) * n.r * 0.8;
        const rr = n.r * (0.6 + rnd() * 0.9) * bs;
        const cx = (n.x + ox) * bs, cy = (n.y + oy) * bs;
        const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.5);
        gr.addColorStop(0, `rgba(${r0},${g0},${b0},${0.16 * n.strength})`);
        gr.addColorStop(0.5, `rgba(${r0},${g0},${b0},${0.06 * n.strength})`);
        gr.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
        x.fillStyle = gr;
        x.beginPath(); x.arc(cx, cy, rr * 1.5, 0, TAU); x.fill();
      }
    }
    x.globalCompositeOperation = 'source-over';
    for (const d of g.dust) {
      const cx = d.x * bs, cy = d.y * bs, rr = d.r * 1.6 * bs;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, `rgba(8,5,4,${0.55 * Math.min(1, d.strength)})`);
      gr.addColorStop(0.6, `rgba(8,5,4,${0.25 * Math.min(1, d.strength)})`);
      gr.addColorStop(1, 'rgba(8,5,4,0)');
      x.fillStyle = gr;
      x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill();
    }
    this.bg = c;
    this.bgScale = bs;
  }

  // ---------------------------------------------------------------- colours
  linColor(linId) {
    const lin = this.sim.lineages[linId];
    if (lin.feral) return FERAL_RGB;
    if (!lin._rgb) lin._rgb = hslToRgb(lin.hue, 0.75, 0.6);
    return lin._rgb;
  }

  colonyColor(s, mode, ownerOverride) {
    const sim = this.sim;
    const owner = ownerOverride ?? s.owner;
    const lin = sim.lineages[owner];
    switch (mode) {
      case 'civ': {
        if (lin.feral) return FERAL_RGB;
        const civ = sim.civs[lin.civ];
        if (!civ._rgb) civ._rgb = hslToRgb(civ.hue, 0.8, 0.58);
        return civ._rgb;
      }
      case 'coop': {
        const c = (ownerOverride != null ? lin.genome.coop : s.genome.coop);
        return hslToRgb(c * 215, 0.85, 0.55);
      }
      case 'expand': return ramp(ownerOverride != null ? lin.genome.expand : s.genome.expand);
      case 'tech': {
        if (!s.tech) return ramp(0);
        let L = 0; for (const v of s.tech) L += v;
        return ramp(L / 50);
      }
      case 'age': {
        const age = sim.t - (s.colonizedAt ?? sim.t);
        return ramp(1 - Math.min(1, age / Math.max(20000, sim.t * 0.8)));
      }
      case 'dyson': return ramp(s.dyson);
      case 'matter': return ramp(s.metals / s.M0);
      default: return this.linColor(owner);
    }
  }

  // ---------------------------------------------------------------- territory
  buildTerritory(mode, observer) {
    const sim = this.sim, g = this.g;
    const cellLy = Math.max(6, g.W / 300);
    const tw = Math.ceil(g.W / cellLy), th = Math.ceil(g.H / cellLy);
    const c = this.terrCanvas;
    if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; }
    const x = c.getContext('2d');
    const img = x.createImageData(tw, th);
    const data = img.data;
    const R = 38, R2 = R * R;
    const cs = g.gridCell;
    const t = sim.t;
    // resolve each colony's (perceived) owner once
    const own = new Int32Array(g.stars.length);
    for (const s of g.stars) {
      if (observer) own[s.id] = sim.ownerAt(s, t - Math.hypot(s.x - observer.x, s.y - observer.y));
      else own[s.id] = s.owner;
    }
    // Splat: every colony writes its distance into nearby cells; nearest wins.
    const n = tw * th;
    if (!this._tDist || this._tDist.length !== n) { this._tDist = new Float32Array(n); this._tOwn = new Int32Array(n); }
    const dist = this._tDist, near = this._tOwn;
    dist.fill(R2); near.fill(-1);
    const rc = Math.ceil(R / cellLy);
    for (const s of g.stars) {
      if (own[s.id] < 0) continue;
      const ci = Math.floor(s.x / cellLy), cj = Math.floor(s.y / cellLy);
      for (let j = Math.max(0, cj - rc); j <= Math.min(th - 1, cj + rc); j++) {
        const dy = (j + 0.5) * cellLy - s.y, dy2 = dy * dy;
        if (dy2 >= R2) continue;
        const row = j * tw;
        for (let i = Math.max(0, ci - rc); i <= Math.min(tw - 1, ci + rc); i++) {
          const dx = (i + 0.5) * cellLy - s.x;
          const d2 = dx * dx + dy2;
          if (d2 < dist[row + i]) { dist[row + i] = d2; near[row + i] = s.id; }
        }
      }
    }
    const colCache = new Map();
    const starCol = new Map();
    const byOwner = observer || mode === 'lineage' || mode === 'civ';
    const cm = observer && mode !== 'civ' ? 'lineage' : mode;
    for (let q = 0; q < n; q++) {
      const best = near[q];
      if (best < 0) continue;
      const s = g.stars[best];
      let col;
      if (byOwner) {
        const key = own[best];
        col = colCache.get(key);
        if (!col) { col = this.colonyColor(s, cm, own[best]); colCache.set(key, col); }
      } else {
        col = starCol.get(best);
        if (!col) { col = this.colonyColor(s, mode); starCol.set(best, col); }
      }
      const a = Math.pow(1 - Math.sqrt(dist[q]) / R, 0.35);
      const p = q * 4;
      data[p] = col[0]; data[p + 1] = col[1]; data[p + 2] = col[2]; data[p + 3] = 255 * a;
    }
    x.putImageData(img, 0, 0);
    this.terrCell = cellLy;
  }

  // ---------------------------------------------------------------- draw
  draw(o) {
    const { ctx, cam, sim, g } = this;
    if (!sim) return;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#010207';
    ctx.fillRect(0, 0, this.w, this.h);

    const sc = cam.scale;
    const ox = this.w / 2 - cam.x * sc, oy = this.h / 2 - cam.y * sc;
    const t = o.renderT ?? sim.t;
    const observer = o.observer;

    // background
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, ox, oy, g.W * sc, g.H * sc);

    // territory
    if (o.showTerritory) {
      const key = o.viewMode + '|' + (observer ? observer.id : -1);
      const now = performance.now();
      if (key !== this.terrKey || now - this.terrT > 600) {
        this.buildTerritory(o.viewMode, observer);
        this.terrKey = key; this.terrT = now;
      }
      ctx.globalAlpha = 0.22;
      ctx.drawImage(this.terrCanvas, ox, oy, this.terrCanvas.width * this.terrCell * sc, this.terrCanvas.height * this.terrCell * sc);
      ctx.globalAlpha = 1;
    }

    // SN remnants glow
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sim.snQueue) {
      if (s.snAt === undefined) continue;
      if (observer && t - Math.hypot(s.x - observer.x, s.y - observer.y) < s.snAt) continue;
      const age = t - s.snAt;
      const fade = Math.max(0, 1 - age / 40000);
      if (fade <= 0) continue;
      const rr = Math.min(60, 8 + age * 0.02) * sc * 2;
      const [sx, sy] = [s.x * sc + ox, s.y * sc + oy];
      if (sx < -rr || sy < -rr || sx > this.w + rr || sy > this.h + rr) continue;
      ctx.globalAlpha = 0.35 * fade;
      ctx.drawImage(this.sprites.remnant, sx - rr, sy - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;

    // stars — batched: glows (additive), then dots bucketed by colour, then colony rings
    const zf = Math.max(0.55, Math.min(3, Math.sqrt(sc / 0.6)));
    const glowK = Math.min(1.6, 0.6 + sc * 0.4);
    const showRings = sc > 0.9;
    const flashDur = Math.max(30, o.yearsPerSec * 0.18);
    const margin = 30;
    const cmode = observer ? (o.viewMode === 'civ' ? 'civ' : 'lineage') : o.viewMode;
    const dots = new Map();   // colour string -> flat [x,y,size,...]
    const rings = new Map();  // colour string -> flat [x,y,r,feral,...]
    const flashes = [];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < g.stars.length; i++) {
      const s = g.stars[i];
      const sx = s.x * sc + ox, sy = s.y * sc + oy;
      if (sx < -margin || sy < -margin || sx > this.w + margin || sy > this.h + margin) continue;
      let type = s.type, lum = s.lum, dyson = s.dyson, owner = s.owner;
      if (observer) {
        const tr = t - Math.hypot(s.x - observer.x, s.y - observer.y);
        owner = sim.ownerAt(s, tr);
        if (s.snAt !== undefined && tr < s.snAt) { type = s.snType; lum = s.snLum; }
        if (owner < 0) dyson = 0;
      }
      const T = TYPES[type];
      const bright = Math.max(0.12, 1 - 0.88 * dyson);
      const size = T.size * zf * (0.85 + 0.3 * s.twinkle);
      // glow for luminous stars (dimmed by Dyson swarms, which re-radiate as infrared)
      if (lum > 2) {
        const gs = Math.min(40, (3 + Math.log10(lum) * 4) * zf * glowK) * bright;
        ctx.globalAlpha = Math.min(0.9, 0.25 + Math.log10(lum) * 0.15) * bright;
        ctx.drawImage(this.sprites[type], sx - gs, sy - gs, gs * 2, gs * 2);
      }
      if (dyson > 0.3 && sc > 1.2) {
        const gs = size * 3.5;
        ctx.globalAlpha = 0.35 * dyson;
        ctx.drawImage(this.sprites.ir, sx - gs, sy - gs, gs * 2, gs * 2);
      }
      let c = T.color;
      if (owner >= 0 && !showRings) c = this.colonyColor(s, cmode, observer ? owner : undefined);
      else if (dyson > 0) c = [c[0] * bright + 150 * (1 - bright), c[1] * bright + 40 * (1 - bright), c[2] * bright + 30 * (1 - bright)];
      const key = `rgb(${c[0] & 0xf8},${c[1] & 0xf8},${c[2] & 0xf8})`;
      let arr = dots.get(key); if (!arr) dots.set(key, arr = []);
      arr.push(sx, sy, size);
      if (owner >= 0 && showRings) {
        const cc = this.colonyColor(s, cmode, observer ? owner : undefined);
        const rk = `rgba(${cc[0] & 0xf8},${cc[1] & 0xf8},${cc[2] & 0xf8},0.9)`;
        let ra = rings.get(rk); if (!ra) rings.set(rk, ra = []);
        ra.push(sx, sy, size / 2 + 2.5 + Math.min(4, Math.log10(1 + (s.I || 0)) * 1.5) * Math.min(1, sc), sim.lineages[owner].feral ? 1 : 0);
      }
      if (!observer && owner >= 0 && s.flash !== undefined && t - s.flash < flashDur) flashes.push(sx, sy, size, 1 - (t - s.flash) / flashDur);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (const [col, a] of dots) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let k = 0; k < a.length; k += 3) {
        const sz = a[k + 2];
        if (sz < 1.6) ctx.rect(a[k] - sz / 2, a[k + 1] - sz / 2, sz, sz);
        else { ctx.moveTo(a[k] + sz / 2, a[k + 1]); ctx.arc(a[k], a[k + 1], sz / 2, 0, TAU); }
      }
      ctx.fill();
    }
    for (const [col, a] of rings) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < a.length; k += 4) {
        const sx = a[k], sy = a[k + 1], rr = a[k + 2];
        ctx.moveTo(sx + rr, sy); ctx.arc(sx, sy, rr, 0, TAU);
        if (a[k + 3]) { // feral: crosshair spikes
          const q = rr + 3;
          ctx.moveTo(sx - q, sy); ctx.lineTo(sx - rr, sy); ctx.moveTo(sx + rr, sy); ctx.lineTo(sx + q, sy);
          ctx.moveTo(sx, sy - q); ctx.lineTo(sx, sy - rr); ctx.moveTo(sx, sy + rr); ctx.lineTo(sx, sy + q);
        }
      }
      ctx.stroke();
    }
    // Flashes: a colony just founded, or just received news of a breakthrough. A tech
    // wave shows up as a band of sparkles sweeping outward at lightspeed.
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < flashes.length; k += 4) {
      const f = flashes[k + 3];
      if (showRings) {
        ctx.strokeStyle = `rgba(255,255,255,${(0.5 * f).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(flashes[k], flashes[k + 1], flashes[k + 2] / 2 + 3 + (1 - f) * 6, 0, TAU); ctx.stroke();
      } else {
        const sz = flashes[k + 2] + 1.5;
        ctx.fillStyle = `rgba(255,255,255,${(0.6 * f).toFixed(3)})`;
        ctx.fillRect(flashes[k] - sz / 2, flashes[k + 1] - sz / 2, sz, sz);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // probes
    if (o.showProbes) this.drawProbes(o, ox, oy, sc);

    // light fronts
    if (!observer) this.drawRings(o, ox, oy, sc);
    else this.drawLightCone(observer, ox, oy, sc);

    // selection
    if (o.selected) {
      const s = o.selected;
      const sx = s.x * sc + ox, sy = s.y * sc + oy;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, TAU); ctx.stroke();
      if (s.owner >= 0 && s.tech) {
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(sx, sy, sim.rangeOf(s.tech) * sc, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (o.hover && o.hover !== o.selected) {
      const s = o.hover;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.x * sc + ox, s.y * sc + oy, 7, 0, TAU); ctx.stroke();
    }
  }

  drawProbes(o, ox, oy, sc) {
    const { ctx, sim } = this;
    const t = o.renderT ?? sim.t;
    const observer = o.observer;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    const drawOne = (pr, px, py) => {
      const col = pr.kind === 'hunter' ? HUNTER_RGB : this.linColor(pr.lin);
      const sx0 = pr.x0 * sc + ox, sy0 = pr.y0 * sc + oy;
      const sx = px * sc + ox, sy = py * sc + oy;
      if ((sx < 0 && sx0 < 0) || (sy < 0 && sy0 < 0) || (sx > this.w && sx0 > this.w) || (sy > this.h && sy0 > this.h)) return;
      const sel = o.selected && (pr.from === o.selected.id || pr.to === o.selected.id);
      ctx.strokeStyle = rgb(col, sel ? 0.55 : 0.16);
      ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx, sy); ctx.stroke();
      if (sel) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = rgb(col, 0.3);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(pr.x1 * sc + ox, pr.y1 * sc + oy); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = rgb(col, 0.95);
      const r = pr.kind === 'hunter' ? 2.2 : 1.6;
      ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
    };
    if (!observer) {
      for (const pr of sim.probes) {
        const f = Math.min(1, (t - pr.t0) / (pr.t1 - pr.t0));
        drawOne(pr, pr.x0 + (pr.x1 - pr.x0) * f, pr.y0 + (pr.y1 - pr.y0) * f);
      }
      return;
    }
    // Observer mode: show each probe where the observer currently *sees* it — its retarded position.
    const seen = (pr, tEnd) => {
      const f = (tt) => {
        const q = Math.min(1, Math.max(0, (tt - pr.t0) / (pr.t1 - pr.t0)));
        const x = pr.x0 + (pr.x1 - pr.x0) * q, y = pr.y0 + (pr.y1 - pr.y0) * q;
        return [t - tt - Math.hypot(x - observer.x, y - observer.y), x, y];
      };
      if (f(pr.t0)[0] < 0) return; // launch not yet visible
      if (f(tEnd)[0] >= 0) return; // already saw it end
      let lo = pr.t0, hi = tEnd;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid)[0] >= 0) lo = mid; else hi = mid;
      }
      const [, x, y] = f(lo);
      drawOne(pr, x, y);
    };
    for (const pr of sim.probes) seen(pr, Math.min(t, pr.tDie));
    for (const gh of sim.ghosts) seen(gh, gh.tEnd);
  }

  drawRings(o, ox, oy, sc) {
    const { ctx, sim } = this;
    const t = o.renderT ?? sim.t;
    ctx.globalCompositeOperation = 'lighter';
    for (const r of sim.rings) {
      const R = t - r.t0;
      if (R <= 0 || R > r.maxR) continue;
      const rs = R * sc;
      if (rs < 1.5) continue;
      const sx = r.x * sc + ox, sy = r.y * sc + oy;
      if (sx + rs < 0 || sy + rs < 0 || sx - rs > this.w || sy - rs > this.h) continue;
      const f = 1 - R / r.maxR;
      let a, w, col;
      switch (r.kind) {
        case 'comm':
          if (!o.showComms) continue;
          a = 0.22 * f; w = 1; col = hslToRgb(r.hue, 0.6, 0.65); break;
        case 'launch':
          if (!o.showComms) continue;
          a = 0.12 * f; w = 1; col = r.hue < 0 ? HUNTER_RGB : hslToRgb(r.hue, 0.6, 0.65); break;
        case 'alarm': a = 0.45 * f; w = 1.3; col = FERAL_RGB; break;
        case 'tech': a = 0.38 * Math.sqrt(f); w = 1.6; col = hslToRgb(r.hue, 0.9, 0.75); break;
        case 'origin': a = 0.7 * Math.sqrt(f); w = 2; col = hslToRgb(r.hue, 0.9, 0.75); break;
        case 'sn': {
          a = 0.85 * f; w = 2.5; col = [255, 180, 100];
          if (R < 400) {
            const fs = Math.max(4, Math.min(R, 45) * sc * 2);
            ctx.globalAlpha = 0.9 * (1 - R / 400);
            ctx.drawImage(this.sprites.sn, sx - fs, sy - fs, fs * 2, fs * 2);
          }
          break;
        }
        default: continue;
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgb(col, a);
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(sx, sy, rs, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawLightCone(obs, ox, oy, sc) {
    const { ctx } = this;
    const sx = obs.x * sc + ox, sy = obs.y * sc + oy;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const R of [50, 100, 250, 500, 1000, 2000, 4000]) {
      const rs = R * sc;
      if (rs < 20) continue;
      ctx.strokeStyle = 'rgba(160,220,255,0.28)';
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, rs, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(170,225,255,0.7)';
      ctx.fillText(`${R} yr ago`, sx, sy - rs - 4);
    }
    ctx.strokeStyle = 'rgba(160,220,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, TAU); ctx.stroke();
  }
}

export { rgb, ramp, FERAL_RGB };
