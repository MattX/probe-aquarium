// Procedural patch of a spiral galaxy: stars, nebulae, dust lanes, neighbor graph.
import { RNG, makeNoise } from './rng.js';

export const MAXR = 120; // ly — neighbor list radius; also the hard cap on probe range

// Spectral classes. lum is relative to Sol; metals is a multiplier on the
// mineable mass budget; sn = [probability of going supernova, max years until it does].
export const TYPES = {
  O:  { p: 0.0012, lum: 8000, color: [155, 176, 255], metals: 0.4, size: 2.6, sn: [0.85, 60000], label: 'O-type blue giant' },
  B:  { p: 0.008,  lum: 400,  color: [170, 191, 255], metals: 0.6, size: 2.1, sn: [0.18, 250000], label: 'B-type blue star' },
  A:  { p: 0.03,   lum: 20,   color: [202, 215, 255], metals: 1.0, size: 1.7, label: 'A-type white star' },
  F:  { p: 0.05,   lum: 3,    color: [248, 247, 255], metals: 1.1, size: 1.45, label: 'F-type star' },
  G:  { p: 0.08,   lum: 1,    color: [255, 240, 220], metals: 1.25, size: 1.3, label: 'G-type (Sun-like)' },
  K:  { p: 0.13,   lum: 0.4,  color: [255, 205, 150], metals: 1.2, size: 1.15, label: 'K-type orange dwarf' },
  M:  { p: 0.61,   lum: 0.04, color: [255, 150, 100], metals: 0.8, size: 0.9, label: 'M-type red dwarf' },
  W:  { p: 0.08,   lum: 0.01, color: [215, 225, 255], metals: 0.5, size: 0.8, label: 'White dwarf' },
  R:  { p: 0.0108, lum: 150,  color: [255, 170, 110], metals: 1.6, size: 1.9, label: 'Red giant' },
  N:  { p: 0,      lum: 0.002, color: [150, 120, 255], metals: 0.3, size: 1.0, label: 'Neutron star (SN remnant)' },
};
const TYPE_KEYS = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'W', 'R'];

export function energyOfLum(lum) {
  return 0.3 + Math.log10(1 + lum * 10) * 0.6;
}

const SYL = ['ka', 'ven', 'thar', 'is', 'lo', 'mir', 'sa', 'dun', 'el', 'ri', 'an', 'tor', 'quel', 'sy', 'ne', 'bra', 'os', 'u', 'zen', 'ca', 'phi', 'ar', 'mae', 'ol', 'rho', 'ix', 'ta', 'ven', 'gal', 'es'];
const CATALOG = { O: 'HD', B: 'HD', A: 'HR', F: 'HIP', G: 'HIP', K: 'Gl', M: 'LHS', W: 'WD', R: 'HR', N: 'PSR' };

function properName(rng) {
  const n = rng.int(2, 3);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(SYL);
  return s[0].toUpperCase() + s.slice(1);
}

export function generateGalaxy(opts) {
  const { nStars = 5000, seed = 1 } = opts;
  const rng = new RNG(seed);
  const noise = makeNoise(seed * 7 + 3);
  // Keep average density roughly constant as star count changes: area scales with N.
  const area = nStars * 720; // ly^2 per star
  const aspect = 1.6;
  const H = Math.round(Math.sqrt(area / aspect));
  const W = Math.round(H * aspect);

  // Galactic centre sits off the left edge. Arms are log spirals.
  const gc = { x: -W * 1.15, y: H * 0.5 + rng.range(-0.3, 0.3) * H };
  const armM = 3;
  const armK = 5.2; // spiral tightness
  const armPhase0 = rng.range(0, Math.PI * 2);
  const rRef = W * 1.15;

  function armTerm(x, y) {
    const dx = x - gc.x, dy = y - gc.y;
    const r = Math.hypot(dx, dy);
    const th = Math.atan2(dy, dx);
    const ph = armM * (th - armK * Math.log(r / rRef)) + armPhase0;
    return { a: Math.exp(-(1 - Math.cos(ph)) * 2.2), ph, r };
  }
  function density(x, y) {
    const { a, r } = armTerm(x, y);
    const n = noise(x / 260, y / 260, 4);
    const radial = Math.exp(-(r - rRef) / (W * 2.2));
    return (0.18 + 1.0 * a) * (0.35 + 1.3 * n) * radial;
  }
  function metallicity(x, y) {
    const { r } = armTerm(x, y);
    return Math.exp(-(r - rRef) / (W * 1.4)) * (0.8 + 0.4 * noise(x / 400 + 50, y / 400 + 50, 3));
  }

  // Nebulae — star-forming regions in the arms. Denser, bluer, volatile-rich, with more massive stars.
  const nebulae = [];
  let tries = 0;
  const nNeb = Math.round(6 + nStars / 700);
  while (nebulae.length < nNeb && tries++ < 5000) {
    const x = rng.range(0, W), y = rng.range(0, H);
    if (armTerm(x, y).a < 0.6) continue;
    const r = rng.range(50, 150);
    const hue = rng.chance(0.7) ? rng.range(330, 360) : rng.range(190, 225);
    nebulae.push({ x, y, r, hue, strength: rng.range(0.5, 1) });
  }
  // Dust — dark lanes along the inner edges of arms. Attenuates probes in transit.
  const dust = [];
  tries = 0;
  const nDust = Math.round(14 + nStars / 250);
  while (dust.length < nDust && tries++ < 10000) {
    const x = rng.range(-50, W + 50), y = rng.range(-50, H + 50);
    const { ph, a } = armTerm(x, y);
    const s = Math.sin(ph);
    if (a < 0.25 || s > -0.2) continue; // inner edge
    dust.push({ x, y, r: rng.range(40, 120), strength: rng.range(0.4, 1.2) });
  }

  function nebulaAt(x, y) {
    let v = 0;
    for (const n of nebulae) {
      const d2 = (x - n.x) ** 2 + (y - n.y) ** 2;
      v += n.strength * Math.exp(-d2 / (n.r * n.r));
    }
    return v;
  }
  function dustAt(x, y) {
    let v = 0;
    for (const d of dust) {
      const d2 = (x - d.x) ** 2 + (y - d.y) ** 2;
      if (d2 < 9 * d.r * d.r) v += d.strength * Math.exp(-d2 / (d.r * d.r));
    }
    return v;
  }

  // Place stars: rejection sampling on density, plus a few tight open clusters.
  let maxD = 0;
  for (let i = 0; i < 4000; i++) maxD = Math.max(maxD, density(rng.range(0, W), rng.range(0, H)) + 0.6);
  const pts = [];
  const nClusters = Math.round(nStars / 900) + 2;
  const clusterStars = Math.round(nStars * 0.06);
  for (let c = 0; c < nClusters; c++) {
    let cx, cy;
    do { cx = rng.range(60, W - 60); cy = rng.range(60, H - 60); } while (armTerm(cx, cy).a < 0.4);
    const cr = rng.range(10, 25);
    const n = Math.round(clusterStars / nClusters);
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2), rr = Math.abs(rng.normal()) * cr;
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, cluster: true });
    }
  }
  while (pts.length < nStars) {
    const x = rng.range(0, W), y = rng.range(0, H);
    const d = density(x, y) + 0.6 * nebulaAt(x, y);
    if (rng.next() * maxD < d) pts.push({ x, y, cluster: false });
  }

  const stars = pts.map((p, id) => {
    const neb = nebulaAt(p.x, p.y);
    // Young regions have more massive stars
    const boost = 1 + 7 * Math.min(1, neb) + (p.cluster ? 3 : 0);
    let tot = 0;
    const w = TYPE_KEYS.map((k) => {
      const q = TYPES[k].p * ((k === 'O' || k === 'B') ? boost : 1);
      tot += q; return q;
    });
    let r = rng.next() * tot, type = 'M';
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { type = TYPE_KEYS[i]; break; } }
    const T = TYPES[type];
    const lum = T.lum * Math.exp(rng.normal() * 0.35);
    const Z = metallicity(p.x, p.y);
    const M0 = 3e5 * T.metals * Z * Math.exp(rng.normal() * 0.45) * (1 + 0.5 * Math.min(1, neb));
    let snTime = Infinity;
    if (T.sn && rng.chance(T.sn[0])) snTime = rng.range(1500, T.sn[1]);
    const bright = type === 'O' || type === 'B' || type === 'R' || (type === 'A' && rng.chance(0.3));
    const name = bright || rng.chance(0.03) ? properName(rng) : `${CATALOG[type]} ${1000 + ((id * 7919) % 90000)}`;
    return {
      id, x: p.x, y: p.y, type, lum, energy: energyOfLum(lum), Z, M0, metals: M0, snTime, name,
      twinkle: rng.next(),
      // colony state (filled in by sim)
      owner: -1, civ: -1, history: [], intents: [], dyson: 0, hazardUntil: -Infinity,
    };
  });

  // Neighbor graph (CSR), sorted by distance.
  const cell = 40;
  const gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
  const grid = Array.from({ length: gw * gh }, () => []);
  const gx = (x) => Math.max(0, Math.min(gw - 1, Math.floor(x / cell)));
  const gy = (y) => Math.max(0, Math.min(gh - 1, Math.floor(y / cell)));
  for (const s of stars) grid[gy(s.y) * gw + gx(s.x)].push(s.id);

  const nStart = new Int32Array(stars.length + 1);
  const idxList = [], distList = [];
  const span = Math.ceil(MAXR / cell);
  const tmp = [];
  for (const s of stars) {
    nStart[s.id] = idxList.length;
    tmp.length = 0;
    const cx = gx(s.x), cy = gy(s.y);
    for (let yy = Math.max(0, cy - span); yy <= Math.min(gh - 1, cy + span); yy++) {
      for (let xx = Math.max(0, cx - span); xx <= Math.min(gw - 1, cx + span); xx++) {
        for (const j of grid[yy * gw + xx]) {
          if (j === s.id) continue;
          const o = stars[j];
          const d = Math.hypot(o.x - s.x, o.y - s.y);
          if (d <= MAXR) tmp.push([d, j]);
        }
      }
    }
    tmp.sort((a, b) => a[0] - b[0]);
    for (const [d, j] of tmp) { idxList.push(j); distList.push(d); }
  }
  nStart[stars.length] = idxList.length;

  return {
    W, H, gc, stars, nebulae, dust, grid, gridCell: cell, gw, gh,
    nStart, nIdx: Int32Array.from(idxList), nDist: Float32Array.from(distList),
    dustAt, nebulaAt, armTerm, seed,
  };
}
