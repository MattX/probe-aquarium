import { generateGalaxy, TYPES } from './galaxy.js';
import { Sim, DEFAULT_PARAMS, TRACKS, roman } from './sim.js';
import { Renderer, VIEW_MODES, hslToRgb, rgb } from './render.js';

const DT = 10; // simulation years per step
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';

const canvas = $('view');
const renderer = new Renderer(canvas);
let sim = null;
let playing = true;
let acc = 0;
let selected = null, hover = null, observer = null;
let viewMode = 'lineage';
let lastLogKey = '';
let effRate = 0, rateWindow = { t: performance.now(), years: 0 };

// ------------------------------------------------------------ params / URL
function readParams() {
  const p = { ...DEFAULT_PARAMS };
  const h = new URLSearchParams(location.hash.slice(1));
  const num = (k, def, lo, hi) => {
    const v = parseFloat(h.get(k));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  };
  p.seed = Math.round(num('seed', Math.floor(Math.random() * 99999) + 1, 1, 1e9));
  p.nStars = Math.round(num('stars', p.nStars, 1000, 14000));
  p.origins = Math.round(num('origins', p.origins, 1, 4));
  p.mutation = num('mut', p.mutation, 0, 0.5);
  p.baseSpeed = num('speed', p.baseSpeed, 0.005, 0.3);
  p.snRate = num('sn', p.snRate, 0, 5);
  return p;
}
function writeParams(p) {
  const h = new URLSearchParams({ seed: p.seed, stars: p.nStars, origins: p.origins, mut: p.mutation, speed: p.baseSpeed, sn: p.snRate });
  history.replaceState(null, '', '#' + h.toString());
}
function fillSettings(p) {
  $('sSeed').value = p.seed; $('sStars').value = p.nStars; $('sOrigins').value = p.origins;
  $('sMut').value = p.mutation; $('sSpeed').value = p.baseSpeed; $('sSN').value = p.snRate;
}
function settingsParams() {
  const n = (id, def) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
  return {
    seed: Math.max(1, Math.round(n('sSeed', 1))),
    nStars: Math.max(1000, Math.min(14000, Math.round(n('sStars', 5000)))),
    origins: Math.max(1, Math.min(4, Math.round(n('sOrigins', 2)))),
    mutation: Math.max(0, Math.min(0.5, n('sMut', DEFAULT_PARAMS.mutation))),
    baseSpeed: Math.max(0.005, Math.min(0.3, n('sSpeed', DEFAULT_PARAMS.baseSpeed))),
    snRate: Math.max(0, Math.min(5, n('sSN', 1))),
  };
}

function updateInsets() {
  const hidden = document.body.classList.contains('panel-hidden');
  const narrow = window.innerWidth <= 820;
  const tb = $('topbar').getBoundingClientRect();
  const pr = $('panel').getBoundingClientRect();
  renderer.inset = {
    top: tb.bottom,
    right: !hidden && !narrow ? window.innerWidth - pr.left : 0,
    bottom: !hidden && narrow ? window.innerHeight - pr.top : 0,
    left: 0,
  };
}

function start(p) {
  updateInsets();
  writeParams(p);
  fillSettings(p);
  const g = generateGalaxy({ nStars: p.nStars, seed: p.seed });
  sim = new Sim(g, p);
  renderer.setSim(sim);
  selected = hover = observer = null;
  acc = 0; lastLogKey = '';
  setObserver(null);
  renderInspector();
  updateUI(true);
}

// ------------------------------------------------------------ speed
const speedFromSlider = (v) => Math.round(10 * Math.pow(2000, v / 100));
function yearsPerSec() { return speedFromSlider(+$('speed').value); }
function updateSpeedLabel() {
  const y = yearsPerSec();
  $('speedLabel').textContent = `${y >= 1000 ? (y / 1000).toFixed(y >= 10000 ? 0 : 1) + 'k' : y} yr/s`;
}

// ------------------------------------------------------------ main loop
let last = performance.now(), lastUI = 0;
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && sim) {
    acc += yearsPerSec() * dtReal;
    const t0 = performance.now();
    let steps = 0;
    while (acc >= DT) {
      sim.step(DT); acc -= DT; steps++;
      rateWindow.years += DT;
      if (performance.now() - t0 > 14) { acc = Math.min(acc, DT); break; }
    }
  }
  if (now - rateWindow.t > 1000) { effRate = rateWindow.years / ((now - rateWindow.t) / 1000); rateWindow = { t: now, years: 0 }; }
  renderer.draw({
    viewMode, observer, selected, hover,
    showTerritory: $('tTerr').checked, showProbes: $('tProbes').checked, showComms: $('tComms').checked,
    yearsPerSec: yearsPerSec(), renderT: sim.t + (playing ? acc : 0),
  });
  if (now - lastUI > 250) { lastUI = now; updateUI(); }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ UI
function updateUI(force) {
  if (!sim) return;
  const lagging = playing && effRate > 0 && effRate < yearsPerSec() * 0.8;
  $('year').textContent = `Year ${fmt(sim.t)}` + (lagging ? ` · ${fmt(effRate)} yr/s` : '');
  $('year').title = lagging ? 'Your machine is running the simulation slower than requested' : '';

  const st = sim.stats;
  const N = sim.stars.length;
  const last = sim.series[sim.series.length - 1];
  let linAlive = 0, feralLin = 0;
  for (const l of sim.lineages) if (l.colonies > 0) { linAlive++; if (l.feral) feralLin++; }
  const rows = [
    ['Colonised systems', `${fmt(sim.colonyCount)} / ${fmt(N)} (${pct(sim.colonyCount / N)})`],
    ['Probes in flight', fmt(sim.probes.length)],
    ['Probes launched', fmt(st.launched)],
    ['Duplicate arrivals', `${fmt(st.duplicates)} <span class="muted">(${fmt(st.rerouted)} rerouted)</span>`, 'Probes that arrived to find their target already taken. Most try to reroute to a nearby free star.'],
    ['&nbsp;· from light lag', fmt(st.dupLag), 'Cooperative probes whose builder had not yet heard (at lightspeed) that someone else claimed the star.'],
    ['&nbsp;· from claim-jumping', fmt(st.dupJump), 'Low-cooperation strains (coop < 0.5) that ignore heard claims and the nearest-colony protocol.'],
    ['Lost in transit', fmt(st.lost), 'Destroyed by dust and interstellar debris'],
    ['Living strains', `${fmt(linAlive)}`],
    ['Feral systems', `${fmt(sim.feralColonies)} <span class="muted">(${feralLin} strains)</span>`, null, sim.feralColonies > 0 ? 'feral' : ''],
    ['Conquests / repelled', `${fmt(st.conquests)} / ${fmt(st.repelled)}`],
    ['Hunters sent / kills', `${fmt(st.huntersLaunched)} / ${fmt(st.huntKills)}`],
    ['Supernovae / sterilised', `${fmt(st.supernovae)} / ${fmt(st.sterilized)}`],
    ['Starlight captured', last ? pct(last.captured, 1) : '0%', 'Fraction of the region\'s total luminosity enclosed by Dyson swarms'],
    ['Matter remaining', last ? pct(last.metals, 1) : '100%'],
  ];
  $('stats').innerHTML = rows.map(([k, v, tip, cls]) => `<div class="k"${tip ? ` title="${tip}"` : ''}>${k}</div><div class="v ${cls || ''}">${v}</div>`).join('');

  // civs
  const civN = sim.civs.map(() => ({ ok: 0, feral: 0 }));
  for (const s of sim.stars) if (s.owner >= 0) {
    if (sim.lineages[s.owner].feral) civN[s.civ].feral++; else civN[s.civ].ok++;
  }
  $('civs').innerHTML = sim.civs.map((c, i) => {
    const col = rgb(hslToRgb(c.hue, 0.8, 0.58));
    const status = !c.started ? `<span class="muted">awakens in ${fmt(c.tStart - sim.t)} yr</span>` :
      `${fmt(civN[i].ok)}${civN[i].feral ? ` <span style="color:var(--feral)">+${fmt(civN[i].feral)} feral</span>` : ''}`;
    const tech = TRACKS.map((tn, k) => `${tn.split(' ')[0].slice(0, 5)} ${roman(c.maxLevel[k])}`).join(' · ');
    return `<div class="civ"><div class="sw" style="background:${col}"></div><div class="nm">${c.name}</div><div class="n">${status}</div>
      <div class="tech" title="Best tech discovered anywhere in this civilisation (not all colonies know it yet)">${tech}</div></div>`;
  }).join('');
  $('chartLegend').innerHTML = sim.civs.map((c) => `<span style="color:${rgb(hslToRgb(c.hue, 0.8, 0.6))}">${c.name}</span>`).join('') +
    `<span style="color:var(--feral)">feral</span>`;

  drawCharts();
  renderLog(force);
  if (selected) renderInspector();
}

function drawCharts() {
  const s = sim.series;
  const c1 = $('chart1'), c2 = $('chart2');
  for (const c of [c1, c2]) {
    const w = c.clientWidth;
    if (c.width !== w * 2) { c.width = w * 2; c.height = c.clientHeight * 2; }
  }
  const x1 = c1.getContext('2d'), x2 = c2.getContext('2d');
  const W = c1.width, H1 = c1.height, H2 = c2.height;
  x1.clearRect(0, 0, W, H1); x2.clearRect(0, 0, W, H2);
  x1.fillStyle = x2.fillStyle = '#0b1020';
  x1.fillRect(0, 0, W, H1); x2.fillRect(0, 0, W, H2);
  if (s.length < 2) return;
  const tMax = s[s.length - 1].t, tMin = s[0].t;
  const X = (t) => (t - tMin) / Math.max(1, tMax - tMin) * W;
  const N = sim.stars.length;
  // stacked area
  const layers = sim.civs.map((c) => rgb(hslToRgb(c.hue, 0.75, 0.55), 0.85)).concat(['rgba(255,70,55,0.9)']);
  const base = new Float32Array(s.length);
  for (let L = 0; L < layers.length; L++) {
    const vals = s.map((p) => L < sim.civs.length ? p.civCounts[L] : p.feral);
    x1.beginPath();
    for (let i = 0; i < s.length; i++) x1.lineTo(X(s[i].t), H1 - (base[i] + vals[i]) / N * H1);
    for (let i = s.length - 1; i >= 0; i--) x1.lineTo(X(s[i].t), H1 - base[i] / N * H1);
    x1.closePath();
    x1.fillStyle = layers[L];
    x1.fill();
    for (let i = 0; i < s.length; i++) base[i] += vals[i];
  }
  // lines
  const line = (key, col) => {
    x2.beginPath();
    for (let i = 0; i < s.length; i++) x2.lineTo(X(s[i].t), H2 - 4 - s[i][key] * (H2 - 8));
    x2.strokeStyle = col; x2.lineWidth = 2.5; x2.stroke();
  };
  x2.strokeStyle = 'rgba(255,255,255,0.08)'; x2.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) { x2.beginPath(); x2.moveTo(0, H2 - 4 - f * (H2 - 8)); x2.lineTo(W, H2 - 4 - f * (H2 - 8)); x2.stroke(); }
  line('metals', '#9ad0a0');
  line('captured', '#ff7a59');
  line('expand', '#ffc857');
  line('coop', '#6cb4ff');
  x1.fillStyle = x2.fillStyle = 'rgba(200,210,240,0.6)';
  x1.font = x2.font = '20px ui-monospace, monospace';
  x1.fillText(`${fmt(tMax)} yr`, W - 150, 22);
}

function renderLog(force) {
  const ev = sim.events;
  const key = ev.length + ':' + (ev.length ? ev[ev.length - 1].t : 0);
  if (!force && key === lastLogKey) return;
  lastLogKey = key;
  const items = ev.slice(-150).reverse();
  $('log').innerHTML = items.map((e, i) =>
    `<div class="ev ${e.kind}" data-i="${ev.length - 1 - i}"><div class="t">${fmt(e.t)}</div><div class="m">${escapeHtml(e.text)}</div></div>`).join('') ||
    '<p class="muted">Nothing yet.</p>';
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('log').addEventListener('click', (e) => {
  const el = e.target.closest('.ev');
  if (!el) return;
  const ev = sim.events[+el.dataset.i];
  if (!ev || ev.x == null) return;
  renderer.cam.x = ev.x; renderer.cam.y = ev.y;
  renderer.cam.scale = Math.max(renderer.cam.scale, 1.6);
  if (ev.sid >= 0) { selected = sim.stars[ev.sid]; renderInspector(); }
});

function bar(frac, color) {
  return `<div class="bar"><div style="width:${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%;${color ? `background:${color}` : ''}"></div></div>`;
}

function renderInspector() {
  const el = $('inspector');
  const s = selected;
  $('inspectorSec').hidden = !s;
  if (!s || !sim) { el.innerHTML = ''; return; }
  const T = TYPES[s.type];
  const t = sim.t;
  let h = `<div class="title">${s.name}</div>
    <div class="sub">${T.label}${s.snType ? ` (was ${TYPES[s.snType].label}, exploded year ${fmt(s.snAt)})` : ''} · L ${s.lum < 0.1 ? s.lum.toFixed(3) : s.lum.toFixed(s.lum < 10 ? 2 : 0)} L☉</div>`;
  h += `<div class="stats">
    <div class="k">Matter remaining</div><div class="v">${fmt(s.metals)} <span class="muted">/ ${fmt(s.M0)}</span></div></div>${bar(s.metals / s.M0, '#9ad0a0')}`;
  h += `<div class="stats"><div class="k">Metallicity</div><div class="v">${s.Z.toFixed(2)}</div>
    <div class="k">Energy factor</div><div class="v">${s.energy.toFixed(2)}${s.owner >= 0 ? ` → ${sim.effEnergy(s).toFixed(1)} with swarm` : ''}</div>`;
  if (s.hazardUntil > t) h += `<div class="k">Irradiated</div><div class="v feral">${fmt(s.hazardUntil - t)} yr left</div>`;
  if ((s.type === 'O' || s.type === 'B')) h += `<div class="k">Lifetime</div><div class="v">short — massive star</div>`;
  h += `</div>`;
  const incoming = sim.probes.filter((p) => p.to === s.id);
  if (s.owner >= 0) {
    const lin = sim.lineages[s.owner];
    const civ = sim.civs[s.civ];
    const col = lin.feral ? 'var(--feral)' : rgb(hslToRgb(lin.hue, 0.75, 0.6));
    const origin = sim.stars[civ.origin];
    const dOrigin = Math.hypot(origin.x - s.x, origin.y - s.y);
    const thr = sim.researchThreshold(s.tech);
    h += `<div class="row"><b style="color:${col}">${lin.feral ? 'FERAL ' : ''}strain ${lin.name}</b> <span class="muted">· ${civ.name}</span></div>
      <div class="row"><span class="gene" title="Cooperation: respects claims, shares, defends. Below ${0.2} = feral.">coop ${s.genome.coop.toFixed(2)}</span><span class="gene" title="Share of output devoted to probes when targets exist">expand ${s.genome.expand.toFixed(2)}</span></div>
      <div class="stats" style="margin-top:6px">
      <div class="k">Founded</div><div class="v">year ${fmt(s.colonizedAt)} <span class="muted">(${fmt(t - s.colonizedAt)} yr ago)</span></div>
      <div class="k">Industry</div><div class="v">${s.I.toFixed(1)} <span class="muted">/ ${sim.industryCap(s).toFixed(0)} t·yr⁻¹</span></div>
      <div class="k">Probes launched</div><div class="v">${fmt(s.launched)}</div>
      <div class="k">Status</div><div class="v">${lin.feral ? '<span style="color:var(--feral)">raiding</span>' : s.metals < 1 ? '<span class="muted">exhausted — no matter left</span>' : s.alert > 0 ? `<span style="color:#ffb46a">on alert — sees ${s.alert} feral system${s.alert > 1 ? 's' : ''}</span>` : s.noTargets ? (s.dyson >= 1 ? 'computing (idle)' : 'building swarm') : 'expanding'}</div>
      <div class="k">Probe range / speed</div><div class="v">${sim.rangeOf(s.tech).toFixed(0)} ly / ${sim.speedOf(s.tech).toFixed(3)} c</div>
      <div class="k">Origin (${origin.name})</div><div class="v">${fmt(dOrigin)} ly — news ${fmt(dOrigin)} yr old</div>
      </div>
      <div class="k muted small" style="margin-top:6px">Dyson swarm ${pct(s.dyson)}</div>${bar(s.dyson, '#ff7a59')}`;
    if (!lin.feral) h += `<div class="k muted small">Research toward next breakthrough (${s.discoveries} made here)</div>${bar(s.research / thr, '#6cb4ff')}`;
    h += `<div class="muted small">Known tech: ${TRACKS.map((n, k) => `${n} ${roman(s.tech[k])}`).join(', ')}</div>`;
  } else {
    const ownerNow = s.history.length ? s.history[s.history.length - 1] : null;
    h += `<div class="row muted">Unclaimed${ownerNow && ownerNow.lin === -1 ? ' (previously colonised)' : ''}.</div>`;
  }
  if (incoming.length) {
    h += `<div class="row small">Incoming: ${incoming.slice(0, 6).map((p) => {
      const l = sim.lineages[p.lin];
      const c = p.kind === 'hunter' ? '#eef' : l.feral ? 'var(--feral)' : rgb(hslToRgb(l.hue, 0.75, 0.6));
      return `<span style="color:${c}">${p.kind === 'hunter' ? 'hunter' : l.feral ? 'feral' : 'seed'} (${fmt(p.t1 - t)} yr)</span>`;
    }).join(', ')}${incoming.length > 6 ? '…' : ''}</div>`;
  }
  if (s.history.length) {
    h += `<div class="row small muted">History: ${s.history.slice(-5).map((e) => `${fmt(e.t)}: ${e.lin < 0 ? 'emptied' : (sim.lineages[e.lin].feral ? 'feral ' : '') + sim.lineages[e.lin].name}`).join(' → ')}</div>`;
  }
  h += `<div class="row"><button class="btn primary" id="obsBtn">${observer === s ? 'Exit light-cone view' : 'View from its light cone'}</button>
    <button class="btn" id="centerBtn">Center</button></div>`;
  el.innerHTML = h;
  $('obsBtn').onclick = () => setObserver(observer === s ? null : s);
  $('centerBtn').onclick = () => { renderer.cam.x = s.x; renderer.cam.y = s.y; };
}

function setObserver(s) {
  observer = s;
  $('observerBar').hidden = !s;
  if (s) $('obsName').textContent = s.name;
  renderer.terrT = -1;
  if (selected) renderInspector();
}

// ------------------------------------------------------------ input
const pointers = new Map();
let dragStart = null, pinchDist = 0, moved = false;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { dragStart = { x: e.clientX, y: e.clientY, cx: renderer.cam.x, cy: renderer.cam.y }; moved = false; }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y); moved = true;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
    pinchDist = d;
    return;
  }
  if (dragStart && pointers.size === 1) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; canvas.classList.add('dragging'); }
    if (moved) {
      renderer.cam.x = dragStart.cx - dx / renderer.cam.scale;
      renderer.cam.y = dragStart.cy - dy / renderer.cam.scale;
    }
    return;
  }
  if (e.pointerType === 'mouse') {
    hover = renderer.pick(e.clientX, e.clientY);
    const tip = $('tooltip');
    if (hover) {
      const lin = hover.owner >= 0 ? sim.lineages[hover.owner] : null;
      tip.innerHTML = `<b>${hover.name}</b> <span class="muted">${hover.type === 'N' ? 'neutron star' : hover.type + '-type'}</span>` +
        (lin ? ` · <span style="color:${lin.feral ? 'var(--feral)' : rgb(hslToRgb(lin.hue, 0.75, 0.6))}">${lin.feral ? 'feral ' : ''}${lin.name}</span>` : '');
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top = (e.clientY + 12) + 'px';
      tip.hidden = false;
    } else tip.hidden = true;
  }
});
function endPointer(e) {
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (wasSingle && !moved && e.type === 'pointerup') {
    selected = renderer.pick(e.clientX, e.clientY, 16);
    renderInspector();
    if (selected) $('panel').scrollTop = 0;
    if (selected && document.body.classList.contains('panel-hidden') && window.innerWidth > 820) { /* keep hidden */ }
  }
  if (pointers.size === 0) { dragStart = null; canvas.classList.remove('dragging'); }
  else if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    dragStart = { x: p.x, y: p.y, cx: renderer.cam.x, cy: renderer.cam.y };
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { hover = null; $('tooltip').hidden = true; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
}, { passive: false });

function togglePlay() {
  playing = !playing;
  $('play').textContent = playing ? '❚❚' : '▶';
}
$('play').onclick = togglePlay;
$('speed').oninput = updateSpeedLabel;
$('fitBtn').onclick = () => { updateInsets(); renderer.fit(); };
$('helpBtn').onclick = () => { $('help').hidden = false; };
$('helpClose').onclick = () => { $('help').hidden = true; };
$('help').onclick = (e) => { if (e.target === $('help')) $('help').hidden = true; };
$('panelBtn').onclick = () => { document.body.classList.toggle('panel-hidden'); updateInsets(); };
$('obsExit').onclick = () => setObserver(null);
$('inspClose').onclick = () => { selected = null; renderInspector(); };
$('regen').onclick = () => start(settingsParams());
$('randomSeed').onclick = () => { $('sSeed').value = Math.floor(Math.random() * 99999) + 1; start(settingsParams()); };
for (const [k, v] of Object.entries(VIEW_MODES)) {
  const o = document.createElement('option'); o.value = k; o.textContent = v; $('viewMode').appendChild(o);
}
$('viewMode').onchange = () => { viewMode = $('viewMode').value; renderer.terrT = -1; };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'v') {
    const keys = Object.keys(VIEW_MODES);
    viewMode = keys[(keys.indexOf(viewMode) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
    $('viewMode').value = viewMode; renderer.terrT = -1;
  }
  else if (k === 't') $('tTerr').click();
  else if (k === 'p') $('tProbes').click();
  else if (k === 'c') $('tComms').click();
  else if (k === 'f') { updateInsets(); renderer.fit(); }
  else if (k === 'h' || k === '?') $('help').hidden = !$('help').hidden;
  else if (k === 'o' && selected) setObserver(observer === selected ? null : selected);
  else if (k === 'escape') { if (!$('help').hidden) $('help').hidden = true; else if (observer) setObserver(null); else { selected = null; renderInspector(); } }
});

window.addEventListener('resize', () => { renderer.resize(); updateInsets(); });
window.addEventListener('hashchange', () => {
  const p = readParams();
  if (!sim || p.seed !== sim.p.seed || p.nStars !== sim.p.nStars || p.origins !== sim.p.origins ||
      p.mutation !== sim.p.mutation || p.baseSpeed !== sim.p.baseSpeed || p.snRate !== sim.p.snRate) start(p);
});

// ------------------------------------------------------------ boot
renderer.resize();
if (window.innerWidth <= 820) document.body.classList.add('panel-hidden');
updateSpeedLabel();
start(readParams());
try {
  if (!localStorage.getItem('probe-aquarium-seen')) { $('help').hidden = false; localStorage.setItem('probe-aquarium-seen', '1'); }
} catch { /* storage unavailable */ }
requestAnimationFrame(frame);

// Console handle for tinkering: probeAquarium.sim, probeAquarium.advance(years)
window.probeAquarium = {
  get sim() { return sim; },
  renderer,
  advance(years) { const n = Math.ceil(years / DT); for (let i = 0; i < n; i++) sim.step(DT); updateUI(true); },
  select(id) { selected = sim.stars[id]; renderInspector(); },
  observe(id) { selected = sim.stars[id]; setObserver(selected); },
};
