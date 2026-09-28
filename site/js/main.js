import { generateGalaxy, TYPES } from './galaxy.js';
import { Sim, DEFAULT_PARAMS, TRACKS, roman } from './sim.js';
import { Renderer, VIEW_MODES, hslToRgb, rgb, ramp } from './render.js';
import { TIPS, TECH_TIPS, VIEW_TIPS, LEGEND, EVENT_KINDS, DEFAULT_PAUSE_KINDS } from './glossary.js';
import { initTips, refreshTip } from './tips.js';

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
let viewMode = 'civ';
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
  document.documentElement.style.setProperty('--topbar-bottom', tb.bottom + 'px');
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
const fmtRate = (y) => y >= 1000 ? (y / 1000).toFixed(y >= 10000 ? 0 : 1) + 'k' : String(Math.round(y));
function updateSpeedLabel() {
  const y = yearsPerSec();
  const lagging = playing && effRate > 0 && effRate < y * 0.8;
  const el = $('speedLabel');
  el.textContent = lagging ? `${fmtRate(y)} → ${fmtRate(effRate)} yr/s` : `${fmtRate(y)} yr/s`;
  el.classList.toggle('lagging', lagging);
  el.dataset.tip = lagging
    ? `Requested ${fmt(y)} yr/s, but this machine is only managing about ${fmt(effRate)} yr/s.`
    : TIPS.speed;
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
      const seq = sim.eventSeq;
      sim.step(DT); acc -= DT; steps++;
      rateWindow.years += DT;
      if (sim.eventSeq !== seq && checkAutoPause(seq)) { acc = 0; break; }
      if (performance.now() - t0 > 14) { acc = Math.min(acc, DT); break; }
    }
  }
  if (camAnim) stepCamAnim(dtReal);
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
  $('year').textContent = `Year ${fmt(sim.t)}`;
  updateSpeedLabel();

  const st = sim.stats;
  const N = sim.stars.length;
  const last = sim.series[sim.series.length - 1];
  let linAlive = 0, feralLin = 0;
  for (const l of sim.lineages) if (l.colonies > 0) { linAlive++; if (l.feral) feralLin++; }
  const rows = [
    ['Colonised systems', `${fmt(sim.colonyCount)} / ${fmt(N)} (${pct(sim.colonyCount / N)})`, 'colonised'],
    ['Probes in flight', fmt(sim.probes.length), 'inFlight'],
    ['Probes launched', fmt(st.launched), 'launched'],
    ['Duplicate arrivals', `${fmt(st.duplicates)} <span class="muted">(${fmt(st.rerouted)} rerouted)</span>`, 'duplicates'],
    ['&nbsp;· from light lag', fmt(st.dupLag), 'dupLag'],
    ['&nbsp;· from claim-jumping', fmt(st.dupJump), 'dupJump'],
    ['&nbsp;· at borders', fmt(st.dupBorder), 'dupBorder'],
    ['Lost in transit', fmt(st.lost), 'lost'],
    ['Civilisations', `${fmt(sim.civs.filter((c) => c.colonies > 0).length)} <span class="muted">(${fmt(st.schisms)} schisms)</span>`, 'civsStat'],
    ['Living strains', `${fmt(linAlive)}`, 'strains'],
    ['Feral systems', `${fmt(sim.feralColonies)} <span class="muted">(${feralLin} strains)</span>`, 'feral', sim.feralColonies > 0 ? 'feral' : ''],
    ['Raids launched', fmt(st.raids), 'raids'],
    ['Conquests / repelled', `${fmt(st.conquests)} / ${fmt(st.repelled)}`, 'conquests'],
    ['Hunters sent / kills', `${fmt(st.huntersLaunched)} / ${fmt(st.huntKills)}`, 'hunters'],
    ['Supernovae / sterilised', `${fmt(st.supernovae)} / ${fmt(st.sterilized)}`, 'supernovae'],
    ['Starlight captured', last ? pct(last.captured, 1) : '0%', 'captured'],
    ['Unmined rock', last ? pct(last.metals, 1) : '100%', 'matter'],
  ];
  const L = sim.ledger || sim.massLedger();
  const segs = [
    ['raw', L.raw, '#5f8f66', 'Unmined rock and rubble'],
    ['hardware', L.infra + L.stock + L.defense, '#6cb4ff', 'Colony hardware: infrastructure, stockpiles and defences'],
    ['swarms', L.swarm, '#ff7a59', 'Dyson swarm hardware (including ruins)'],
    ['in flight', L.flight, '#e8ecff', 'Probes in transit (payload + braking propellant)'],
    ['exhaust', L.exhaust, '#8a8fa3', 'Expelled as rocket exhaust — gone from the region'],
    ['lost', L.lost, '#4a4f63', 'Probes destroyed in transit'],
  ];
  const massBar = `<div class="massbar" data-tip="${attr(TIPS.massBar)}">${segs.map(([n, v, c]) =>
    `<div style="width:${(100 * v / L.total).toFixed(2)}%;background:${c}"></div>`).join('')}</div>
    <div class="masslegend">${segs.map(([n, v, c, tip]) => `<span data-tip="${attr(tip)}"><i style="background:${c}"></i>${n} ${pct(v / L.total, v / L.total < 0.1 ? 1 : 0)}</span>`).join('')}</div>`;
  $('stats').innerHTML = rows.map(([k, v, tip, cls]) => `<div class="k"${tip ? ` data-tip="${attr(TIPS[tip])}"` : ''}>${k}</div><div class="v ${cls || ''}">${v}</div>`).join('') + `<div class="full">${massBar}</div>`;

  // civs: the originals plus the largest splinters
  const civN = sim.civs.map(() => ({ ok: 0, feral: 0 }));
  for (const s of sim.stars) if (s.owner >= 0) {
    if (sim.lineages[s.owner].feral) civN[s.civ].feral++; else civN[s.civ].ok++;
  }
  const alive = sim.civs.filter((c) => !c.started || c.colonies > 0);
  alive.sort((a, b) => (civN[b.id].ok + civN[b.id].feral) - (civN[a.id].ok + civN[a.id].feral) || a.id - b.id);
  const shown = alive.slice(0, 8);
  const rest = alive.slice(8);
  $('civs').innerHTML = shown.map((c) => {
    const i = c.id;
    const col = rgb(hslToRgb(c.hue, 0.8, 0.58));
    const status = !c.started ? `<span class="muted">awakens in ${fmt(c.tStart - sim.t)} yr</span>` :
      `${fmt(civN[i].ok)}${civN[i].feral ? ` <span style="color:var(--feral)">+${fmt(civN[i].feral)} feral</span>` : ''}`;
    const tech = TRACKS.map((tn, k) => `<span data-tip="${attr(TECH_TIPS[k] + '<br><br>' + TIPS.civTech)}">${tn.split(' ')[0].slice(0, 5)} ${roman(c.maxLevel[k])}</span>`).join(' · ');
    const origin = c.parent >= 0
      ? `<span class="muted" data-tip="${attr(TIPS.splinter)}">splinter of ${sim.civs[c.parent].name}, yr ${fmt(c.tStart)} · ${doctrine(c.doctrineAggr)}</span>`
      : `<span class="muted">origin civilisation</span>`;
    return `<div class="civ"><div class="sw" style="background:${col}"></div><div class="nm">${c.name}</div><div class="n">${status}</div>
      <div class="tech">${origin}</div><div class="tech">${tech}</div></div>`;
  }).join('') + (rest.length ? `<p class="muted small" data-tip="${attr(TIPS.minorCivs)}">+ ${rest.length} minor civilisations holding ${fmt(rest.reduce((n, c) => n + c.colonies, 0))} systems</p>` : '');
  chartCivs = alive.filter((c) => c.started).slice(0, 6);
  $('chartLegend').innerHTML = chartCivs.map((c) => `<span style="color:${rgb(hslToRgb(c.hue, 0.8, 0.6))}">${c.name}</span>`).join('') +
    (alive.length > chartCivs.length ? `<span class="muted">others</span>` : '') + `<span style="color:var(--feral)">feral</span>`;

  drawCharts();
  renderLog(force);
  if (selected) renderInspector();
  refreshTip();
}

let chartCivs = [];
const doctrine = (a) => a > 0.6 ? 'predatory doctrine' : a > 0.35 ? 'wary doctrine' : 'peaceable doctrine';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tipAttr = (key) => ` data-tip="${attr(TIPS[key])}"`;

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
  // the biggest civs individually, everyone else as one grey band, ferals on top
  const ids = chartCivs.map((c) => c.id);
  const idSet = new Set(ids);
  const layers = chartCivs.map((c) => rgb(hslToRgb(c.hue, 0.75, 0.55), 0.85)).concat(['rgba(150,160,190,0.55)', 'rgba(255,70,55,0.9)']);
  const base = new Float32Array(s.length);
  for (let L = 0; L < layers.length; L++) {
    const vals = s.map((p) => {
      if (L < ids.length) return p.civCounts[ids[L]] || 0;
      if (L === ids.length) { let o = 0; p.civCounts.forEach((v, j) => { if (!idSet.has(j)) o += v; }); return o; }
      return p.feral;
    });
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
  line('aggr', '#d27cff');
  line('loyalty', '#6cb4ff');
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
    <div class="k"${tipAttr('iMatter')}>Unmined rock</div><div class="v">${fmt(s.metals)} <span class="muted">/ ${fmt(s.M0)}</span></div></div>${bar(s.metals / s.M0, '#9ad0a0')}`;
  if (s.infra + s.stock + s.defense + s.swarm > 0) {
    h += `<div class="stats">
      <div class="k"${tipAttr('iInfra')}>Infrastructure</div><div class="v">${fmt(s.infra)}</div>
      <div class="k"${tipAttr('iStock')}>Stockpile</div><div class="v">${fmt(s.stock)}</div>
      ${s.defense > 0 ? `<div class="k"${tipAttr('iDefense')}>Defences</div><div class="v">${fmt(s.defense)}</div>` : ''}
      <div class="k"${tipAttr('iSwarm')}>Swarm hardware</div><div class="v">${fmt(s.swarm)} <span class="muted">/ ${fmt(sim.swarmNeed(s))}</span></div>
      </div>`;
  }
  h += `<div class="stats"><div class="k"${tipAttr('iZ')}>Metallicity</div><div class="v">${s.Z.toFixed(2)}</div>
    <div class="k"${tipAttr('iEnergy')}>Energy factor</div><div class="v">${s.energy.toFixed(2)}${s.owner >= 0 ? ` → ${sim.effEnergy(s).toFixed(1)} with swarm` : ''}</div>`;
  if (s.hazardUntil > t) h += `<div class="k"${tipAttr('iIrradiated')}>Irradiated</div><div class="v feral">${fmt(s.hazardUntil - t)} yr left</div>`;
  if ((s.type === 'O' || s.type === 'B')) h += `<div class="k"${tipAttr('iLifetime')}>Lifetime</div><div class="v">short — massive star</div>`;
  h += `</div>`;
  const incoming = sim.probes.filter((p) => p.to === s.id);
  if (s.owner >= 0) {
    const lin = sim.lineages[s.owner];
    const civ = sim.civs[s.civ];
    const col = lin.feral ? 'var(--feral)' : rgb(hslToRgb(lin.hue, 0.75, 0.6));
    const origin = sim.stars[civ.origin];
    const dOrigin = Math.hypot(origin.x - s.x, origin.y - s.y);
    const thr = sim.researchThreshold(s.tech);
    h += `<div class="row"><b style="color:${col}">${lin.feral ? 'FERAL ' : ''}strain ${lin.name}</b> <span class="muted">· ${civ.name}${civ.parent >= 0 ? ` (splinter of ${sim.civs[civ.parent].name})` : ''}</span></div>
      <div class="row"><span class="gene"${tipAttr('iLoyalty')}>loyalty ${s.genome.loyalty.toFixed(2)}</span><span class="gene"${tipAttr('iAggr')}>aggression ${s.genome.aggr.toFixed(2)}</span><span class="gene"${tipAttr('iExpand')}>expand ${s.genome.expand.toFixed(2)}</span><span class="gene"${tipAttr('iDialect')}>dialect ${(s.genome.proto - civ.protoMean >= 0 ? '+' : '')}${(s.genome.proto - civ.protoMean).toFixed(2)}</span></div>
      <div class="stats" style="margin-top:6px">
      <div class="k"${tipAttr('iFounded')}>Founded</div><div class="v">year ${fmt(s.colonizedAt)} <span class="muted">(${fmt(t - s.colonizedAt)} yr ago)</span></div>
      <div class="k"${tipAttr('iIndustry')}>Industry</div><div class="v">${s.I.toFixed(1)} <span class="muted">/ ${sim.industryCap(s).toFixed(0)} u/yr</span></div>
      <div class="k"${tipAttr('iLaunched')}>Probes launched</div><div class="v">${fmt(s.launched)}</div>
      <div class="k"${tipAttr('iStatus')}>Status</div><div class="v">${lin.feral ? '<span style="color:var(--feral)">feral — preys on everyone</span>' : s.metals < 1 && s.swarm < 1 ? '<span class="muted">exhausted — no matter left</span>' : s.alert > 0 ? `<span style="color:#ffb46a">on alert — sees ${s.alert} feral system${s.alert > 1 ? 's' : ''}</span>` : s.noTargets ? (s.dyson >= 1 ? 'computing (idle)' : 'building swarm') : lin.raider ? '<span style="color:#d27cff">predatory — raids other civs</span>' : 'expanding'}</div>
      <div class="k"${tipAttr('iRange')}>Probe range / speed</div><div class="v">${sim.rangeOf(s.tech).toFixed(0)} ly / ${sim.cruiseSpeed(s.tech, s.genome.expand).toFixed(3)} c</div>
      <div class="k"${tipAttr('iProbeCost')}>Probe cost</div><div class="v">${fmt(sim.probeCost(s.tech, s.genome.expand))} <span class="muted">(${fmt(sim.payloadOf(s.tech))} payload, ratio ${sim.massRatio(sim.cruiseSpeed(s.tech, s.genome.expand), s.tech).toFixed(1)})</span></div>
      <div class="k"${tipAttr('iOrigin')}>Origin (${origin.name})</div><div class="v">${fmt(dOrigin)} ly — news ${fmt(dOrigin)} yr old</div>
      </div>
      <div class="k muted small"${tipAttr('iDyson')} style="margin-top:6px">Dyson swarm ${pct(s.dyson)}</div>${bar(s.dyson, '#ff7a59')}`;
    if (!lin.feral) h += `<div class="k muted small"${tipAttr('iResearch')}>Research toward next breakthrough (${s.discoveries} made here)</div>${bar(s.research / thr, '#6cb4ff')}`;
    h += `<div class="muted small"><span${tipAttr('iTech')}>Known tech:</span> ${TRACKS.map((n, k) => `<span data-tip="${attr(TECH_TIPS[k])}">${n} ${roman(s.tech[k])}</span>`).join(', ')}</div>`;
  } else {
    const ownerNow = s.history.length ? s.history[s.history.length - 1] : null;
    h += `<div class="row muted">Unclaimed${ownerNow && ownerNow.lin === -1 ? ' (previously colonised)' : ''}.</div>`;
  }
  if (incoming.length) {
    h += `<div class="row small"><span${tipAttr('iIncoming')}>Incoming:</span> ${incoming.slice(0, 6).map((p) => {
      const l = sim.lineages[p.lin];
      const c = p.kind === 'hunter' ? '#eef' : l.feral ? 'var(--feral)' : rgb(hslToRgb(l.hue, 0.75, 0.6));
      return `<span style="color:${c}">${p.kind === 'hunter' ? 'hunter' : l.feral ? 'feral' : 'seed'} (${fmt(p.t1 - t)} yr)</span>`;
    }).join(', ')}${incoming.length > 6 ? '…' : ''}</div>`;
  }
  if (s.history.length) {
    h += `<div class="row small muted"><span${tipAttr('iHistory')}>History:</span> ${s.history.slice(-5).map((e) => `${fmt(e.t)}: ${e.lin < 0 ? 'emptied' : (sim.lineages[e.lin].feral ? 'feral ' : '') + sim.lineages[e.lin].name}`).join(' → ')}</div>`;
  }
  h += `<div class="row"><button class="btn primary" id="obsBtn"${tipAttr('iObserve')}>${observer === s ? 'Exit light-cone view' : 'View from its light cone'}</button>
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
  camAnim = null;
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
  camAnim = null;
  renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
}, { passive: false });

function setPlaying(p) {
  playing = p;
  $('play').textContent = playing ? '❚❚' : '▶';
  if (playing) $('eventBar').hidden = true;
}
function togglePlay() { setPlaying(!playing); }

// ------------------------------------------------------------ auto-pause on events
const PREFS_KEY = 'probe-aquarium-autopause';
let pausePrefs = { on: false, kinds: [...DEFAULT_PAUSE_KINDS], fly: true };
try { Object.assign(pausePrefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* storage unavailable */ }
function savePausePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(pausePrefs)); } catch { /* storage unavailable */ }
  $('autoPauseState').textContent = pausePrefs.on ? 'on' : 'off';
  $('autoPauseBtn').classList.toggle('on', pausePrefs.on);
}
function buildPauseMenu() {
  $('apKinds').innerHTML = Object.entries(EVENT_KINDS).map(([k, label]) =>
    `<label><input type="checkbox" data-kind="${k}"${pausePrefs.kinds.includes(k) ? ' checked' : ''}> ${label}</label>`).join('');
  $('apOn').checked = pausePrefs.on;
  $('apFly').checked = pausePrefs.fly;
  savePausePrefs();
}
$('autoPauseBtn').onclick = (e) => { e.stopPropagation(); $('pauseMenu').hidden = !$('pauseMenu').hidden; };
$('pauseMenu').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { $('pauseMenu').hidden = true; });
$('pauseMenu').addEventListener('change', (e) => {
  const k = e.target.dataset.kind;
  if (k) {
    pausePrefs.kinds = pausePrefs.kinds.filter((x) => x !== k);
    if (e.target.checked) { pausePrefs.kinds.push(k); pausePrefs.on = true; $('apOn').checked = true; }
  } else if (e.target.id === 'apOn') pausePrefs.on = e.target.checked;
  else if (e.target.id === 'apFly') pausePrefs.fly = e.target.checked;
  savePausePrefs();
});

function checkAutoPause(prevSeq) {
  if (!pausePrefs.on) return false;
  const ev = sim.events.find((e) => e.seq > prevSeq && pausePrefs.kinds.includes(e.kind));
  if (!ev) return false;
  setPlaying(false);
  $('evKind').textContent = EVENT_KINDS[ev.kind] || ev.kind;
  $('evText').textContent = `Year ${fmt(ev.t)} — ${ev.text}`;
  $('eventBar').hidden = false;
  if (ev.sid >= 0) { selected = sim.stars[ev.sid]; renderInspector(); $('panel').scrollTop = 0; }
  if (pausePrefs.fly && ev.x != null) {
    const vis = Math.min(renderer.w - renderer.inset.right, renderer.h - renderer.inset.top - renderer.inset.bottom);
    flyTo(ev.x, ev.y, Math.max(renderer.cam.scale, Math.min(3, vis / (ev.kind === 'sn' ? 260 : 360))));
  }
  updateUI(true);
  return true;
}
$('evGo').onclick = () => setPlaying(true);
$('evOff').onclick = () => { pausePrefs.on = false; $('apOn').checked = false; savePausePrefs(); setPlaying(true); };

// Smooth camera flights. The target point is placed in the middle of the uncovered view.
let camAnim = null;
function flyTo(x, y, scale) {
  const I = renderer.inset;
  const cx = (I.left + renderer.w - I.right) / 2, cy = (I.top + renderer.h - I.bottom) / 2;
  camAnim = { x: x + (renderer.w / 2 - cx) / scale, y: y + (renderer.h / 2 - cy) / scale, scale };
}
function stepCamAnim(dt) {
  const c = renderer.cam, a = camAnim;
  const k = 1 - Math.exp(-dt * 5);
  c.x += (a.x - c.x) * k; c.y += (a.y - c.y) * k;
  c.scale *= Math.pow(a.scale / c.scale, k);
  if (Math.abs(a.x - c.x) * c.scale < 0.5 && Math.abs(a.y - c.y) * c.scale < 0.5 && Math.abs(a.scale / c.scale - 1) < 0.002) camAnim = null;
}

// ------------------------------------------------------------ legend + static tips
const GLYPHS = {
  star: '<circle cx="8" cy="8" r="6" fill="url(#gg)"/><circle cx="8" cy="8" r="2" fill="#fff4e0"/>',
  colony: '<circle cx="8" cy="8" r="5" fill="none" stroke="#5fd0ea" stroke-width="1.3"/><circle cx="8" cy="8" r="1.4" fill="#ffb07a"/>',
  feral: '<circle cx="8" cy="8" r="4" fill="none" stroke="#ff3c32" stroke-width="1.4"/><path d="M1 8h3M12 8h3M8 1v3M8 12v3" stroke="#ff3c32" stroke-width="1.4"/>',
  probe: '<path d="M1 13L12 4" stroke="#5fd0ea" stroke-opacity=".35"/><rect x="11" y="3" width="2.5" height="2.5" fill="#bff"/>',
  comm: '<circle cx="8" cy="8" r="6" fill="none" stroke="#9ec9e8" stroke-opacity=".45"/>',
  tech: '<circle cx="8" cy="8" r="6" fill="none" stroke="#8ae8ff" stroke-width="1.8"/>',
  alarm: '<circle cx="8" cy="8" r="6" fill="none" stroke="#ff3c32" stroke-width="1.4"/>',
  sn: '<circle cx="8" cy="8" r="6" fill="none" stroke="#ffb464" stroke-width="2.2"/><circle cx="8" cy="8" r="2.5" fill="#ffc890"/>',
  ir: '<circle cx="8" cy="8" r="6" fill="url(#gi)"/><circle cx="8" cy="8" r="1.6" fill="#8a3a2a"/>',
  dust: '<circle cx="6" cy="9" r="6" fill="#d0507a" fill-opacity=".35"/><ellipse cx="10" cy="7" rx="5" ry="3" fill="#050302"/>',
};
const GLYPH_DEFS = '<defs><radialGradient id="gg"><stop offset="0" stop-color="#cfe0ff"/><stop offset="1" stop-color="#cfe0ff" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="gi"><stop offset="0" stop-color="#ff5a32" stop-opacity=".8"/><stop offset="1" stop-color="#ff5a32" stop-opacity="0"/></radialGradient></defs>';
function buildLegend() {
  $('legend').innerHTML = LEGEND.map(([g, label, tip]) =>
    `<div class="li" data-tip="${attr(tip)}"><svg width="16" height="16" viewBox="0 0 16 16">${GLYPH_DEFS}${GLYPHS[g]}</svg>${label}</div>`).join('');
}
function renderModeLegend() {
  const el = $('modeLegend');
  const tip = VIEW_TIPS[viewMode];
  let bar = '';
  if (viewMode === 'aggr') {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((a) => rgb(hslToRgb(170 + a * 140, 0.8, 0.35 + a * 0.3))).join(',');
    bar = `<div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="ends"><span>0 peaceable</span><span>raids above 0.6</span><span>1</span></div>`;
  } else if (viewMode === 'loyalty') {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((c) => rgb(hslToRgb(c * 215, 0.85, 0.55))).join(',');
    bar = `<div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="ends"><span>0 (feral &lt; 0.2)</span><span>1</span></div>`;
  } else if (viewMode !== 'lineage' && viewMode !== 'civ' && viewMode !== 'aggr') {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((c) => rgb(ramp(c))).join(',');
    const ends = { expand: ['0', '1'], tech: ['0 levels', '50'], age: ['old', 'new'], dyson: ['0%', '100%'], matter: ['mined out', 'untouched'] }[viewMode];
    bar = `<div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
  }
  el.innerHTML = `<div data-tip="${attr(tip)}"><b style="color:#c4cbe0">Colour mode: ${VIEW_MODES[viewMode]}</b> — ${tip}</div>${bar}`;
  $('viewMode').dataset.tip = TIPS.viewMode + '<br><br>' + tip;
}
function applyStaticTips() {
  const byId = {
    play: 'play', speedWrap: 'speed', tTerr: 'tTerr', tProbes: 'tProbes', tComms: 'tComms', fitBtn: 'fit',
    helpBtn: 'help', panelBtn: 'panel', autoPauseBtn: 'autoPause', chart1Label: 'chart1', chart2Label: 'chart2',
    chart1: 'chart1', chart2: 'chart2',
  };
  for (const [id, key] of Object.entries(byId)) {
    const el = $(id);
    const target = el.tagName === 'INPUT' && el.type === 'checkbox' ? el.closest('label') : el;
    target.dataset.tip = TIPS[key];
  }
  for (const id of ['sSeed', 'sStars', 'sOrigins', 'sMut', 'sSpeed', 'sSN']) $(id).closest('label').dataset.tip = TIPS[id];
  $('inspClose').dataset.tip = 'Deselect <kbd>Esc</kbd>';
  $('obsExit').dataset.tip = 'Back to the omniscient view <kbd>Esc</kbd>';
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
$('viewMode').onchange = () => { viewMode = $('viewMode').value; renderer.terrT = -1; renderModeLegend(); };

window.addEventListener('keydown', (e) => {
  // text fields keep their keys; sliders, checkboxes and buttons still get shortcuts
  const tg = e.target;
  if ((tg.tagName === 'INPUT' && tg.type !== 'range' && tg.type !== 'checkbox') || tg.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (tg.tagName === 'BUTTON' || tg.tagName === 'INPUT') tg.blur(); togglePlay(); }
  else if (k === 'v') {
    const keys = Object.keys(VIEW_MODES);
    viewMode = keys[(keys.indexOf(viewMode) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
    $('viewMode').value = viewMode; renderer.terrT = -1; renderModeLegend();
  }
  else if (k === 't') $('tTerr').click();
  else if (k === 'p') $('tProbes').click();
  else if (k === 'c') $('tComms').click();
  else if (k === 'f') { updateInsets(); renderer.fit(); }
  else if (k === 'h' || k === '?') $('help').hidden = !$('help').hidden;
  else if (k === 'o' && selected) setObserver(observer === selected ? null : selected);
  else if (k === 'escape') { if (!$('pauseMenu').hidden) $('pauseMenu').hidden = true; else if (!$('help').hidden) $('help').hidden = true; else if (observer) setObserver(null); else { selected = null; renderInspector(); } }
});

window.addEventListener('resize', () => { renderer.resize(); updateInsets(); });
new ResizeObserver(() => updateInsets()).observe($('topbar'));
window.addEventListener('hashchange', () => {
  const p = readParams();
  if (!sim || p.seed !== sim.p.seed || p.nStars !== sim.p.nStars || p.origins !== sim.p.origins ||
      p.mutation !== sim.p.mutation || p.baseSpeed !== sim.p.baseSpeed || p.snRate !== sim.p.snRate) start(p);
});

// ------------------------------------------------------------ boot
initTips();
applyStaticTips();
buildLegend();
renderModeLegend();
buildPauseMenu();
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
