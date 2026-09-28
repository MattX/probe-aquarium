// Von Neumann probe simulation.
//
// Core ideas:
//  * Every colony only knows what light has told it. Knowledge is never stored
//    per-colony; it is derived from event timestamps + distance (retarded time).
//  * Colonies mine their star system, grow industry, build probes, Dyson swarms,
//    and do research. Breakthroughs propagate through the civilisation at c.
//  * Replication is imperfect. Each colony carries a genome: loyalty (cohesion with
//    its own civilisation), aggression (stance toward other civilisations),
//    expansion drive, and a protocol dialect. Drift in the dialect eventually makes
//    a strain unintelligible to its parent: it splinters into a new civilisation
//    with its own research. Aggressive strains raid other civilisations; strains
//    that lose loyalty go feral and prey on everyone. Colonies that *see* hostile
//    conquests nearby (with light lag) arm themselves and send hunters to retake them.
//  * Massive stars go supernova, sterilising everything the blast front reaches.
//  * Mass is conserved. Every system holds raw rock, a stockpile, infrastructure,
//    Dyson swarm hardware and defences; probes carry their payload and braking
//    propellant. The only sinks are rocket exhaust and probes lost in transit;
//    the only source is supernova ejecta. See massLedger().
import { RNG } from './rng.js';
import { MAXR, TYPES, energyOfLum } from './galaxy.js';

export const TRACKS = ['Drive', 'Range', 'Fabrication', 'Fidelity', 'Stellar Eng.'];
export const T_DRIVE = 0, T_RANGE = 1, T_FAB = 2, T_FID = 3, T_STELLAR = 4;
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const roman = (n) => ROMAN[n] || String(n);

const CIV_SYL = ['ar', 've', 'lo', 'min', 'tha', 'sol', 'ke', 'ri', 'on', 'da', 'vu', 'el', 'ny', 'qua', 'zi', 'mor', 'ae', 'is', 'cal', 'dre'];
const CIV_NOUN = ['Choir', 'Weave', 'Assembly', 'Drift', 'Canon', 'Reach', 'Concord', 'Hive', 'Remnant', 'Accord', 'Schism', 'Tide', 'Mesh', 'Covenant', 'Bloom'];
const CIV_DEFS = [
  { name: 'Lattice', hue: 190 },
  { name: 'Chorus', hue: 45 },
  { name: 'Seedwright', hue: 280 },
  { name: 'Quiet Tide', hue: 130 },
];
const FERAL_LOYALTY = 0.2;     // below this a strain is feral
const UNFERAL_LOYALTY = 0.35;  // hysteresis to return
const RAID_AGGR = 0.6;         // above this a strain raids other civilisations
const SCHISM_PROTO = 0.5;      // protocol drift from the civ's dialect that makes a new civ
// Warships (raiders, hunters) are heavier than seed probes and take longer to build.
const KIND_MASS = { seed: 1, raid: 3, hunter: 3 };
const KIND_BUILD = { seed: 1, raid: 8, hunter: 3 };
const HOSTILE_MEMORY = 3000;   // yr: how long a seen conquest keeps neighbours on alert
const SN_KILL_R = 45;       // ly
const COMMS_R = 110;         // how far we bother drawing routine broadcast rings
const COLONY_STRIDE = 3;
const INFRA_PER_I = 60;      // mass of infrastructure per unit of industry (t/yr)

export const DEFAULT_PARAMS = {
  nStars: 5000,
  origins: 2,
  mutation: 0.05,
  baseSpeed: 0.03,
  snRate: 1,
  seed: 1,
  dialectK: 0.1,       // pull toward visible same-civ neighbours per sync
  dialectNoise: 0.1,   // dialect drift per sync
};

export class Sim {
  constructor(galaxy, params) {
    this.g = galaxy;
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.rng = new RNG((this.p.seed * 2654435761) >>> 0);
    this.stars = galaxy.stars;
    this.t = 0;
    this.probes = [];
    this.ghosts = [];   // finished probes, kept for observer-mode retarded rendering
    this.rings = [];    // light fronts: {x,y,t0,maxR,kind,hue}
    this.events = [];   // log (trimmed to the most recent 400)
    this.eventSeq = 0;  // monotonically increasing id of the latest event
    this.lineages = [];
    this.civs = [];
    this.diag = Math.hypot(galaxy.W, galaxy.H);
    this.nextProbeId = 1;
    this.stats = {
      launched: 0, duplicates: 0, dupLag: 0, dupJump: 0, rerouted: 0, lost: 0, conquests: 0, repelled: 0,
      huntersLaunched: 0, huntKills: 0, sterilized: 0, supernovae: 0, colonized: 0,
      raids: 0, schisms: 0, dupBorder: 0,
    };
    // Mass ledger: initial + injected == held in systems + in flight + exhaust + lost
    this.mass = { initial: 0, injected: 0, exhaust: 0, lost: 0 };
    for (const s of this.stars) {
      s.stock = 0; s.infra = 0; s.defense = 0; s.swarm = 0;
      this.mass.initial += s.metals;
    }
    this.colonyCount = 0;
    this.feralColonies = 0;
    this.series = [];
    this.nextSample = 0;
    this.milestones = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97];
    this.matterMilestones = [0.5, 0.25, 0.1, 0.02];
    this.contacts = new Set();
    this.activeSN = [];
    this.snQueue = this.stars.filter((s) => isFinite(s.snTime)).map((s) => {
      s.snTime = s.snTime / Math.max(0.01, this.p.snRate);
      return s;
    }).sort((a, b) => a.snTime - b.snTime);
    this.snIdx = 0;
    this.lastFeralOutbreakLog = -1e9;
    this.lastHostile = -1e9;
    this.hostileSites = new Map(); // star id -> last time it became hostile-looking
    this.stepCount = 0;
    this.setupCivs();
  }

  // ---------------------------------------------------------------- setup
  setupCivs() {
    const { W, H } = this.g;
    const cands = this.stars.filter((s) => (s.type === 'G' || s.type === 'K') && s.M0 > 8e4 &&
      s.x > W * 0.12 && s.x < W * 0.88 && s.y > H * 0.12 && s.y < H * 0.88 && !isFinite(s.snTime));
    const chosen = [];
    const n = Math.max(1, Math.min(4, this.p.origins));
    // farthest-point sampling for spread-out origins
    chosen.push(this.rng.pick(cands));
    while (chosen.length < n) {
      let best = null, bd = -1;
      for (let k = 0; k < 300; k++) {
        const c = this.rng.pick(cands);
        const d = Math.min(...chosen.map((o) => Math.hypot(o.x - c.x, o.y - c.y)));
        if (d > bd) { bd = d; best = c; }
      }
      chosen.push(best);
    }
    chosen.forEach((star, i) => {
      const def = CIV_DEFS[i];
      const civ = {
        id: i, name: def.name, hue: def.hue, origin: star.id,
        tStart: i === 0 ? 0 : Math.round(this.rng.range(500, 6000)),
        started: false, techBase: [0, 0, 0, 0, 0], techEvents: [], maxLevel: [0, 0, 0, 0, 0],
        colonies: 0, peak: 0, firstDyson: false, proto: 0, protoMean: 0, doctrineAggr: 0.15, parent: -1, announced: true,
      };
      this.civs.push(civ);
    });
  }

  // Returns the lineage a genome belongs to: the parent's, or a new strain if it has
  // diverged far enough (or crossed the feral line).
  speciate(civ, parentId, genome) {
    const par = this.lineages[parentId];
    const feralNow = par.feral ? genome.loyalty < UNFERAL_LOYALTY : genome.loyalty < FERAL_LOYALTY;
    if (civ === par.civ && feralNow === par.feral && Math.abs(genome.loyalty - par.genome.loyalty) < 0.12 &&
        Math.abs(genome.expand - par.genome.expand) < 0.15 && Math.abs(genome.aggr - par.genome.aggr) < 0.12) return parentId;
    return this.newLineage(civ, parentId, genome).id;
  }

  // Dialect: every so often a colony nudges its protocol toward the average of the
  // same-civ colonies it can see (as of their light), plus drift. Well-connected regions
  // stay in sync; isolated or peripheral clusters drift together. A colony whose dialect
  // strays too far from its civilisation's mean can no longer parse its broadcasts:
  // it joins a nearby splinter that speaks like it, or founds a new one.
  syncDialect(s) {
    const { nStart, nIdx, nDist } = this.g;
    const R = this.rangeOf(s.tech);
    let sum = 0, n = 0;
    for (let k = nStart[s.id]; k < nStart[s.id + 1]; k++) {
      if (nDist[k] > R) break;
      const o = this.stars[nIdx[k]];
      if (o.owner < 0 || o.civ !== s.civ) continue;
      sum += o.genome.proto; n++;
    }
    const g = s.genome;
    g.proto += (n ? this.p.dialectK * (sum / n - g.proto) : 0) + this.rng.normal() * this.p.dialectNoise * Math.pow(0.9, s.tech[T_FID]);
    const civ = this.civs[s.civ];
    if (Math.abs(g.proto - civ.protoMean) <= SCHISM_PROTO || civ.colonies < 3) return;
    // find a splinter nearby that speaks this dialect
    let join = null;
    for (let k = nStart[s.id]; k < nStart[s.id + 1]; k++) {
      if (nDist[k] > R * 1.5) break;
      const o = this.stars[nIdx[k]];
      if (o.owner < 0 || o.civ === s.civ) continue;
      const c = this.civs[o.civ];
      if (c.parent === s.civ && Math.abs(c.protoMean - g.proto) < SCHISM_PROTO * 0.6) { join = c; break; }
    }
    const target = join || this.newCiv(civ, g, s);
    // colonies adopt some of the splinter's founding doctrine
    g.aggr = clamp01(0.5 * g.aggr + 0.5 * target.doctrineAggr);
    this.invalidate(s);
    const old = this.lineages[s.owner];
    const nl = this.newLineage(target.id, s.owner, g);
    old.colonies--; if (old.feral) this.feralColonies--;
    nl.colonies++; nl.peak = Math.max(nl.peak, nl.colonies); if (nl.feral) this.feralColonies++;
    civ.colonies--;
    s.civ = target.id; s.owner = nl.id;
    target.colonies++; target.peak = Math.max(target.peak, target.colonies);
    s.history.push({ t: this.t, lin: nl.id, how: 'schism' });
    s.flash = this.t; s.noTargets = false;
    this.announceCiv(target, s);
    this.checkExtinct(old);
    this.checkCivExtinct(civ);
  }

  newCiv(parent, genome, star) {
    const used = this.civs.map((c) => c.hue);
    let hue = 0, best = -1;
    for (let k = 0; k < 24; k++) {
      const h = 30 + this.rng.next() * 300; // keep clear of feral red
      const dmin = Math.min(...used.map((u) => Math.abs(((h - u) % 360 + 540) % 360 - 180)));
      if (dmin > best) { best = dmin; hue = h; }
    }
    const syl = () => this.rng.pick(CIV_SYL);
    let root = syl() + syl() + (this.rng.chance(0.4) ? syl() : '');
    root = root[0].toUpperCase() + root.slice(1);
    const name = this.rng.chance(0.5) ? `${root} ${this.rng.pick(CIV_NOUN)}` : root;
    const tech = star && star.tech ? star.tech.slice() : parent.maxLevel.slice();
    const civ = {
      id: this.civs.length, name, hue, origin: star ? star.id : parent.origin, parent: parent.id,
      tStart: this.t, started: true, proto: genome.proto, protoMean: genome.proto,
      // schisms come with an ideological shift
      doctrineAggr: clamp01(genome.aggr + this.rng.normal() * 0.25),
      techBase: tech.slice(), techEvents: [], maxLevel: tech.slice(),
      colonies: 0, peak: 0, firstDyson: false, firstFeral: false, firstRaid: false, announced: false,
    };
    this.civs.push(civ);
    this.stats.schisms++;
    return civ;
  }

  newLineage(civ, parent, genome) {
    const par = parent >= 0 ? this.lineages[parent] : null;
    const feral = par && par.feral ? genome.loyalty < UNFERAL_LOYALTY : genome.loyalty < FERAL_LOYALTY;
    let hue;
    if (!par || par.civ !== civ) hue = this.civs[civ].hue;
    else hue = par.hue + this.rng.normal() * 13;
    const id = this.lineages.length;
    const lin = {
      id, civ, parent, hue, feral, genome: { ...genome }, born: this.t,
      colonies: 0, peak: 0, probes: 0, outbreakLogged: false, extinctLogged: false,
      raider: !feral && genome.aggr > RAID_AGGR,
      name: `${this.civs[civ].name}-${id.toString(36)}`,
    };
    this.lineages.push(lin);
    return lin;
  }

  startCiv(civ) {
    civ.started = true;
    const s = this.stars[civ.origin];
    const genome = { loyalty: 0.85, aggr: 0.15, expand: 0.5, proto: 0 };
    const lin = this.newLineage(civ.id, -1, genome);
    this.colonize(s, { lin: lin.id, civ: civ.id, genome, tech: [0, 0, 0, 0, 0] }, true);
    s.I = 6;
    // the homeworld's starting industry is built out of its own rock
    const m = Math.min(s.metals, s.I * INFRA_PER_I);
    s.metals -= m; s.infra += m;
    s.isOrigin = true;
    this.log(`${civ.name} awakens at ${s.name}. The first seed factory spins up.`, s, 'origin', civ.hue);
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: this.diag, kind: 'origin', hue: civ.hue });
  }

  // ---------------------------------------------------------------- helpers
  log(text, star, kind, hue) {
    this.eventSeq++;
    this.events.push({ seq: this.eventSeq, t: this.t, text, x: star ? star.x : null, y: star ? star.y : null, sid: star ? star.id : -1, kind, hue });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  ownerAt(s, time) {
    const h = s.history;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= time) return h[i].lin;
    return -1;
  }
  entryAt(s, time) {
    const h = s.history;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= time) return h[i];
    return null;
  }

  // As seen (at retarded time `tr`) by a colony of lineage `me`: is this entry a hostile
  // presence? Either a feral strain, or a system recently taken by force by another civ.
  isHostileEntry(e, me, tr) {
    if (!e || e.lin < 0 || e.lin === me.id) return false;
    const o = this.lineages[e.lin];
    if (o.feral) return true;
    return e.how === 'conquest' && o.civ !== me.civ && tr - e.t < HOSTILE_MEMORY;
  }

  rangeOf(tech) { return Math.min(MAXR, 32 + 9 * tech[T_RANGE]); }
  speedOf(tech) { return Math.min(0.5, this.p.baseSpeed * Math.pow(1.28, tech[T_DRIVE])); }
  // Probes: a payload (the seed factory) plus propellant from the rocket equation.
  // Accelerating to v and braking again needs a mass ratio R = exp(2v / v_exhaust).
  payloadOf(tech) { return Math.max(40, 300 * Math.pow(0.87, tech[T_FAB])); }
  exhaustVel(tech) { return Math.min(0.6, 0.08 * Math.pow(1.22, tech[T_DRIVE])); }
  // Cruise speed: as fast as the drive allows, but a colony will only tolerate a mass
  // ratio of 2 + 4 × expand — eager expanders burn more matter to get there sooner.
  cruiseSpeed(tech, expand) {
    return Math.min(this.speedOf(tech), this.exhaustVel(tech) * Math.log(2 + 4 * expand) / 2);
  }
  massRatio(v, tech) { return Math.exp(2 * v / this.exhaustVel(tech)); }
  probeCost(tech, expand = 0.5) {
    return this.payloadOf(tech) * this.massRatio(this.cruiseSpeed(tech, expand), tech);
  }
  invalidate(s) { s._P = 0; s._RT = 0; }
  buildTime(tech) { return 25 * Math.pow(0.9, tech[T_FAB]); }
  defenseTarget(s) { return 1500 + 1200 * Math.min(s.alert, 6) + 20 * s.I; }
  swarmNeed(s) { return 40000 * Math.sqrt(s.lum + 0.05) / (1 + 0.3 * (s.tech ? s.tech[T_STELLAR] : 0)); }
  updateDyson(s) { s.dyson = s.swarm > 0 ? Math.min(1, s.swarm / this.swarmNeed(s)) : 0; }
  // Everything held in a system except its untouched rock
  heldMass(s) { return s.stock + s.infra + s.defense + s.swarm; }
  // Rubble from destroyed hardware falls back into the mineable pool.
  toRubble(s, m) { s.metals += m; }
  massLedger() {
    let held = 0, raw = 0, stock = 0, infra = 0, defense = 0, swarm = 0, flight = 0;
    for (const s of this.stars) { raw += s.metals; stock += s.stock; infra += s.infra; defense += s.defense; swarm += s.swarm; }
    for (const pr of this.probes) flight += pr.mass;
    held = raw + stock + infra + defense + swarm;
    const total = this.mass.initial + this.mass.injected;
    return { total, raw, stock, infra, defense, swarm, flight, exhaust: this.mass.exhaust, lost: this.mass.lost,
      error: total - (held + flight + this.mass.exhaust + this.mass.lost) };
  }
  industryCap(s) {
    const st = s.tech ? s.tech[T_STELLAR] : 0;
    return 10 * s.energy * (1 + 4 * s.dyson * (1 + 0.25 * st)) * Math.min(2, Math.sqrt(s.M0 / 3e5) + 0.3);
  }
  effEnergy(s) { return s.energy * (1 + 6 * s.dyson * (1 + 0.25 * (s.tech ? s.tech[T_STELLAR] : 0))); }
  researchThreshold(tech) {
    let L = 0; for (const v of tech) L += v;
    return 1500 * Math.pow(1.3, L);
  }
  starValue(s) {
    return Math.sqrt(Math.max(0, s.metals) / 3e5) * (0.4 + s.energy);
  }

  // Would colony at `from` believe `o` has already been claimed (heard intent that it hasn't yet seen fail)?
  // Claims are only intelligible to colonies sharing the claimant's protocol (civ).
  heardClaim(o, from, d, kindFilter) {
    const t = this.t;
    for (const it of o.intents) {
      if (it.civ !== from.civ) continue;
      if (kindFilter && it.kind !== kindFilter) continue;
      const src = this.stars[it.origin];
      const dd = src === from ? 0 : Math.hypot(src.x - from.x, src.y - from.y);
      if (it.t + dd <= t && t - d < it.eta + 250) return true;
    }
    return false;
  }

  countHeard(o, from, d, kind) {
    const t = this.t; let n = 0;
    for (const it of o.intents) {
      if (it.kind !== kind || it.civ !== from.civ) continue;
      const src = this.stars[it.origin];
      const dd = Math.hypot(src.x - from.x, src.y - from.y);
      if (it.t + dd <= t && t - d < it.eta + 250) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- targeting
  findSeedTarget(from, tech, loyalty, maxR) {
    const { nStart, nIdx, nDist } = this.g;
    const R = Math.min(maxR ?? Infinity, this.rangeOf(tech));
    const t = this.t;
    const respect = Math.min(1, loyalty * 2);
    let best = null, bv = 0;
    for (let k = nStart[from.id]; k < nStart[from.id + 1]; k++) {
      const d = nDist[k];
      if (d > R) break;
      const o = this.stars[nIdx[k]];
      const tr = t - d;
      if (o.hazardUntil > tr) continue;
      if (this.ownerAt(o, tr) >= 0) continue;
      if (this.heardClaim(o, from, d) && this.rng.next() < respect) continue;
      const v = this.starValue(o) / (1 + d / 22) * (0.7 + 0.6 * this.rng.next());
      if (v > bv) {
        // Protocol: the nearest (perceived) sibling colony has right of claim. Only
        // loyal strains follow it, and only as far as their light cone lets them see.
        if (loyalty >= 0.5 && from.civ >= 0 && this.siblingCloser(o, from, d)) continue;
        bv = v; best = o;
      }
    }
    return best;
  }

  siblingCloser(o, from, d) {
    const { nStart, nIdx, nDist } = this.g;
    const t = this.t;
    for (let k = nStart[o.id]; k < nStart[o.id + 1]; k++) {
      const dd = nDist[k];
      if (dd >= d - 0.5) return false;
      const q = this.stars[nIdx[k]];
      if (q === from || q.civ !== from.civ) continue;
      const own = this.ownerAt(q, t - Math.hypot(q.x - from.x, q.y - from.y));
      if (own >= 0 && !this.lineages[own].feral && this.lineages[own].civ === from.civ) return true;
    }
    return false;
  }

  findFeralTarget(from, tech) {
    const { nStart, nIdx, nDist } = this.g;
    const R = this.rangeOf(tech);
    const t = this.t;
    let best = null, bv = 0;
    for (let k = nStart[from.id]; k < nStart[from.id + 1]; k++) {
      const d = nDist[k];
      if (d > R) break;
      const o = this.stars[nIdx[k]];
      const tr = t - d;
      if (o.hazardUntil > tr) continue;
      const own = this.ownerAt(o, tr);
      if (own === from.owner) continue;
      let v = this.starValue(o) + 0.1;
      if (own >= 0) v *= 2.2; // prey: a built-up colony is loot
      v = v / (1 + d / 22) * (0.6 + 0.8 * this.rng.next());
      if (v > bv) { bv = v; best = o; }
    }
    return best;
  }

  // Raiders go after other civilisations' colonies (as they appeared when their light left).
  findRaidTarget(from, tech) {
    const { nStart, nIdx, nDist } = this.g;
    const R = this.rangeOf(tech);
    const t = this.t;
    let best = null, bv = 0;
    for (let k = nStart[from.id]; k < nStart[from.id + 1]; k++) {
      const d = nDist[k];
      if (d > R) break;
      const o = this.stars[nIdx[k]];
      const tr = t - d;
      if (o.hazardUntil > tr) continue;
      const own = this.ownerAt(o, tr);
      if (own < 0 || this.lineages[own].civ === from.civ) continue;
      const v = (this.starValue(o) + 0.3) / (1 + d / 22) * (0.6 + 0.8 * this.rng.next());
      if (v > bv) { bv = v; best = o; }
    }
    return best;
  }

  // Hunters retake the nearest system seen to be hostile (feral, or recently conquered by another civ).
  findHunterTarget(from, tech) {
    const { nStart, nIdx, nDist } = this.g;
    const R = Math.min(MAXR, this.rangeOf(tech) * 1.3);
    const t = this.t;
    const me = this.lineages[from.owner];
    for (let k = nStart[from.id]; k < nStart[from.id + 1]; k++) {
      const d = nDist[k];
      if (d > R) break;
      const o = this.stars[nIdx[k]];
      if (this.isHostileEntry(this.entryAt(o, t - d), me, t - d) && this.countHeard(o, from, d, 'hunter') < 2) return o;
    }
    return null;
  }

  // Only systems in the hostile index (recently conquered, or ever feral-held) can look
  // hostile, so scan those rather than every neighbour.
  scanHostile(s) {
    const R = Math.min(MAXR, this.rangeOf(s.tech) * 1.5), R2 = R * R;
    const t = this.t;
    const me = this.lineages[s.owner];
    let n = 0;
    for (const id of this.hostileSites.keys()) {
      const o = this.stars[id];
      const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
      if (d2 > R2 || o === s) continue;
      const d = Math.sqrt(d2);
      if (this.isHostileEntry(this.entryAt(o, t - d), me, t - d)) n++;
    }
    return n;
  }
  markHostile(s) { this.hostileSites.set(s.id, this.t); this.lastHostile = this.t; }

  // ---------------------------------------------------------------- lifecycle
  colonize(s, probe, isOrigin = false) {
    const lin = this.lineages[probe.lin];
    s.owner = probe.lin;
    s.civ = probe.civ;
    s.genome = { ...probe.genome };
    s.tech = probe.tech.slice();
    this.invalidate(s);
    s.I = isOrigin ? 6 : 1;
    s.stock = 0;
    // The probe's payload is the seed factory. Any swarm ruins left by a previous
    // colony are inherited as-is.
    s.infra += probe.payload ?? 0;
    this.updateDyson(s);
    s.research = this.rng.next() * 50;
    s.colonizedAt = this.t;
    s.alert = 0;
    s.nextScan = this.t + this.rng.range(20, 100);
    s.nextSync = this.t + this.rng.range(200, 600);
    s.noTargets = false;
    s.noTargetUntil = 0;
    s.launched = 0;
    s.techT = this.t;
    s.flash = this.t;
    s.discoveries = 0;
    s.history.push({ t: this.t, lin: probe.lin, how: 'found' });
    lin.colonies++; lin.peak = Math.max(lin.peak, lin.colonies);
    const civ = this.civs[probe.civ];
    civ.colonies++; civ.peak = Math.max(civ.peak, civ.colonies);
    this.announceCiv(civ, s);
    this.colonyCount++;
    if (lin.feral) { this.feralColonies++; this.markHostile(s); }
    this.stats.colonized++;
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: COMMS_R, kind: 'comm', hue: lin.feral ? 0 : lin.hue });
    this.checkContact(s);
    this.noteFeral(lin, s);
    if (lin.feral && !lin.outbreakLogged && lin.colonies >= 5) {
      lin.outbreakLogged = true;
      if (this.t - this.lastFeralOutbreakLog > 1500) {
        this.lastFeralOutbreakLog = this.t;
        this.log(`Feral outbreak: strain ${lin.name} (loyalty ${lin.genome.loyalty.toFixed(2)}) now holds ${lin.colonies} systems near ${s.name}.`, s, 'feral', 0);
      }
    }
    this.checkMilestone();
  }

  vacate(s, reason) {
    if (s.owner < 0) return;
    const lin = this.lineages[s.owner];
    lin.colonies--;
    this.civs[s.civ].colonies--;
    this.colonyCount--;
    if (lin.feral) this.feralColonies--;
    s.history.push({ t: this.t, lin: -1, how: 'empty' });
    const civ = this.civs[s.civ];
    s.owner = -1; s.civ = -1; s.I = 0;
    // abandoned hardware becomes rubble; swarm hardware stays in orbit as ruins
    this.toRubble(s, s.stock + s.infra + s.defense);
    s.stock = 0; s.infra = 0; s.defense = 0;
    this.checkExtinct(lin);
    this.checkCivExtinct(civ);
  }

  transfer(s, probe, how) {
    // Conquest/liberation: ownership flips, infrastructure mostly retained.
    const oldLin = this.lineages[s.owner];
    const newLin = this.lineages[probe.lin];
    const oldCiv = this.civs[s.civ];
    oldLin.colonies--; oldCiv.colonies--;
    if (oldLin.feral) this.feralColonies--;
    s.owner = probe.lin; s.civ = probe.civ;
    s.genome = { ...probe.genome };
    s.tech = s.tech.map((v, i) => Math.max(v, probe.tech[i]));
    this.invalidate(s);
    s.research = 0; s.alert = 0;
    // the captor inherits the stockpile, swarm and most infrastructure; the fighting
    // wrecks half the defences and 40% of the industrial base
    this.toRubble(s, s.defense * 0.5 + s.infra * 0.4);
    s.defense *= 0.5; s.infra *= 0.6;
    s.stock += probe.payload ?? 0;
    s.I *= 0.6;
    s.noTargets = false; s.flash = this.t; s.colonizedAt = this.t;
    s.history.push({ t: this.t, lin: probe.lin, how });
    newLin.colonies++; newLin.peak = Math.max(newLin.peak, newLin.colonies);
    const nc = this.civs[probe.civ];
    nc.colonies++; nc.peak = Math.max(nc.peak, nc.colonies);
    if (how === 'conquest' || newLin.feral) this.markHostile(s);
    if (newLin.feral) this.feralColonies++;
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: COMMS_R * 1.4, kind: how === 'conquest' ? 'alarm' : 'comm', hue: newLin.feral ? 0 : newLin.hue });
    this.checkExtinct(oldLin);
    this.checkCivExtinct(oldCiv);
    if (newLin.feral && !newLin.outbreakLogged && newLin.colonies >= 5) {
      newLin.outbreakLogged = true;
      if (this.t - this.lastFeralOutbreakLog > 1500) {
        this.lastFeralOutbreakLog = this.t;
        this.log(`Feral outbreak: strain ${newLin.name} is consuming colonies around ${s.name}.`, s, 'feral', 0);
      }
    }
  }

  driftColony(s) {
    const old = this.lineages[s.owner];
    const genome = mutate(this.rng, s.genome, 0.8);
    genome.proto = s.genome.proto; // dialect evolves through syncDialect instead
    s.genome = genome;
    this.invalidate(s);
    const nid = this.speciate(s.civ, s.owner, genome);
    if (nid === s.owner) return;
    const nl = this.lineages[nid];
    old.colonies--; if (old.feral) this.feralColonies--;
    nl.colonies++; nl.peak = Math.max(nl.peak, nl.colonies); if (nl.feral) this.feralColonies++;
    s.owner = nl.id;
    s.history.push({ t: this.t, lin: nl.id, how: 'drift' });
    if (nl.feral) this.markHostile(s);
    s.noTargets = false; s.flash = this.t;
    if (nl.feral && !old.feral) {
      this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: COMMS_R * 1.4, kind: 'alarm', hue: 0 });
      this.stats.defections = (this.stats.defections || 0) + 1;
      this.noteFeral(nl, s);
    }
    this.checkExtinct(old);
  }

  // Log a new splinter civilisation the first time it holds a system.
  announceCiv(civ, s) {
    if (civ.announced || civ.colonies < 5) return; // tiny splinters stay unremarked
    civ.announced = true;
    const par = this.civs[civ.parent];
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: this.diag, kind: 'origin', hue: civ.hue });
    const stance = civ.doctrineAggr > RAID_AGGR ? 'Its founding doctrine is predatory.' : civ.doctrineAggr > 0.35 ? 'Its founding doctrine is wary.' : 'Its founding doctrine is peaceable.';
    this.log(`Schism near ${s.name}: a cluster of ${par.name} systems has drifted beyond mutual intelligibility and become ${civ.name}, which can no longer hear ${par.name}'s broadcasts. ${stance}`, s, 'schism', civ.hue);
  }

  checkCivExtinct(civ) {
    if (!civ || civ.colonies > 0 || civ.extinct || civ.peak < 10) return;
    civ.extinct = true;
    this.log(`${civ.name} is gone: its last system has fallen (peak ${civ.peak} systems).`, null, 'extinct', civ.hue);
  }

  noteRaid(lin, s, victimCiv) {
    const civ = this.civs[lin.civ];
    if (civ.firstRaid) return;
    civ.firstRaid = true;
    this.log(`${civ.name} turns predatory: strain ${lin.name} (aggression ${lin.genome.aggr.toFixed(2)}) seizes ${s.name} from ${this.civs[victimCiv].name}.`, s, 'war', civ.hue);
  }

  noteFeral(lin, s) {
    const civ = this.civs[lin.civ];
    if (!lin.feral || civ.firstFeral || civ.colonies < 20) return;
    civ.firstFeral = true;
    this.log(`${civ.name}'s first feral strain: ${lin.name} at ${s.name} has drifted to loyalty ${lin.genome.loyalty.toFixed(2)} and turned on its neighbours.`, s, 'feral', 0);
  }

  checkExtinct(lin) {
    if (lin.colonies <= 0 && lin.probes <= 0 && lin.feral && lin.peak >= 5 && !lin.extinctLogged) {
      lin.extinctLogged = true;
      this.log(`Feral strain ${lin.name} has been extinguished (peak ${lin.peak} systems).`, null, 'contain', 150);
    }
  }

  checkContact(s) {
    const { nStart, nIdx, nDist } = this.g;
    for (let k = nStart[s.id]; k < nStart[s.id + 1]; k++) {
      if (nDist[k] > 60) break;
      const o = this.stars[nIdx[k]];
      if (o.owner >= 0 && o.civ !== s.civ) {
        const a = this.civs[o.civ], b = this.civs[s.civ];
        const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
        // a splinter is born next to its parent; that's not news
        if (!this.contacts.has(key) && a.parent !== b.id && b.parent !== a.id) {
          this.contacts.add(key);
          this.log(`First contact: ${this.civs[s.civ].name} and ${this.civs[o.civ].name} frontiers meet at ${s.name}.`, s, 'contact', 60);
        }
        return;
      }
    }
  }

  checkMilestone() {
    const f = this.colonyCount / this.stars.length;
    while (this.milestones.length && f >= this.milestones[0]) {
      const m = this.milestones.shift();
      this.log(`${Math.round(m * 100)}% of systems in the region are now colonised.`, null, 'milestone', 200);
    }
  }

  // ---------------------------------------------------------------- probes
  launch(s, target, kind) {
    const t = this.t;
    const lin0 = this.lineages[s.owner];
    let genome = s.genome, linId = s.owner, civ = s.civ;
    if (kind !== 'hunter') {
      const mut = this.p.mutation * Math.pow(0.8, s.tech[T_FID]);
      if (this.rng.next() < mut) {
        // Copy errors are more likely to damage a complex value system than improve it: slight downward bias.
        genome = mutate(this.rng, s.genome, 1);
      }
      linId = this.speciate(civ, s.owner, genome);
    }
    const tech = s.tech.slice();
    const speed = this.cruiseSpeed(tech, s.genome.expand);
    const payload = this.payloadOf(tech) * KIND_MASS[kind];
    const R = this.massRatio(speed, tech);
    const cost = payload * R;
    s.stock -= cost;
    // accelerating burns half the propellant (in log terms); the braking half rides along
    const mass = payload * Math.sqrt(R);
    this.mass.exhaust += cost - mass;
    const d = Math.hypot(target.x - s.x, target.y - s.y);
    const t1 = t + d / speed;
    // dust attenuation along the path
    let tau = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N;
      tau += this.g.dustAt(s.x + (target.x - s.x) * f, s.y + (target.y - s.y) * f) * (d / N);
    }
    const survive = Math.exp(-0.007 * tau - 0.0004 * d);
    let tDie = Infinity;
    if (this.rng.next() > survive) tDie = t + this.rng.next() * (t1 - t);
    const pr = {
      id: this.nextProbeId++, lin: linId, civ, genome, tech, kind,
      from: s.id, to: target.id, x0: s.x, y0: s.y, x1: target.x, y1: target.y,
      t0: t, t1, tDie, speed, payload, mass,
    };
    this.probes.push(pr);
    this.lineages[linId].probes++;
    target.intents.push({ origin: s.id, t, eta: t1, kind, civ });
    s.launched++;
    this.stats.launched++;
    if (kind === 'hunter') this.stats.huntersLaunched++;
    if (kind === 'raid') this.stats.raids++;
    this.rings.push({ x: s.x, y: s.y, t0: t, maxR: COMMS_R * 0.7, kind: 'launch', hue: kind === 'hunter' ? -1 : (this.lineages[linId].feral ? 0 : this.lineages[linId].hue) });
  }

  retire(pr, fate) {
    this.lineages[pr.lin].probes--;
    const tEnd = Math.min(this.t, fate === 'lost' ? pr.tDie : pr.t1);
    this.ghosts.push({ x0: pr.x0, y0: pr.y0, x1: pr.x1, y1: pr.y1, t0: pr.t0, t1: pr.t1, tEnd, lin: pr.lin, kind: pr.kind });
  }

  arrive(pr) {
    const s = this.stars[pr.to];
    const lin = this.lineages[pr.lin];
    const t = this.t;
    // braking burn: the remaining propellant is expelled on arrival
    this.mass.exhaust += pr.mass - pr.payload;
    pr.mass = pr.payload;
    if (s.hazardUntil > t) { this.stats.lost++; this.toRubble(s, pr.payload); return; }
    if (pr.kind === 'hunter') {
      const e = s.history.length ? s.history[s.history.length - 1] : null;
      if (s.owner >= 0 && this.isHostileEntry(e, lin, t)) {
        const atk = 6 + 0.6 * pr.tech[T_FAB];
        const def = 1 + s.I * 0.04 + s.defense / 300;
        if (this.rng.next() < atk / (atk + def)) { this.transfer(s, pr, 'liberate'); this.stats.huntKills++; }
        else this.repel(s, pr);
      } else if (s.owner < 0) {
        this.colonize(s, pr);
      } else this.salvage(s, pr);
      return;
    }
    if (lin.feral) {
      if (s.owner < 0) { this.colonize(s, pr); return; }
      if (s.owner === pr.lin) { this.salvage(s, pr); return; }
      const atk = 3 + 0.3 * pr.tech[T_FAB];
      const tgtFeral = this.lineages[s.owner].feral;
      const def = 1 + s.defense / 250 + s.I * (tgtFeral ? 0.04 : 0.015);
      if (this.rng.next() < atk / (atk + def)) {
        this.stats.conquests++;
        this.transfer(s, pr, 'conquest');
      } else this.repel(s, pr);
      return;
    }
    if (pr.kind === 'raid') {
      if (s.owner < 0) { this.colonize(s, pr); return; }
      if (s.civ === pr.civ) { this.salvage(s, pr); return; }
      const atk = 5 + 0.5 * pr.tech[T_FAB];
      const def = 1 + s.defense / 250 + s.I * 0.015;
      if (this.rng.next() < atk / (atk + def)) {
        this.stats.conquests++;
        const victim = s.civ;
        this.transfer(s, pr, 'conquest');
        this.noteRaid(lin, s, victim);
      } else this.repel(s, pr);
      return;
    }
    // cooperative seed probe
    if (s.owner < 0) { this.colonize(s, pr); return; }
    // Duplicate arrival — someone got here first (light lag, or a claim we ignored)
    if (!pr.rerouted) {
      this.stats.duplicates++;
      if (pr.genome.loyalty < 0.5) this.stats.dupJump++;
      else if (s.civ !== pr.civ) this.stats.dupBorder++;
      else this.stats.dupLag++;
    }
    const alt = this.findSeedTarget(s, pr.tech, pr.genome.loyalty, this.rangeOf(pr.tech) * 0.6);
    if (alt && alt !== s) {
      this.stats.rerouted++;
      this.retire(pr, 'arrive');
      const d = Math.hypot(alt.x - s.x, alt.y - s.y);
      // The hop costs another full burn out of the payload itself, so rerouting shrinks the probe.
      const R = this.massRatio(pr.speed, pr.tech);
      const payload = pr.payload / R;
      const mass = payload * Math.sqrt(R);
      this.mass.exhaust += pr.payload - mass;
      const np = { ...pr, id: this.nextProbeId++, from: s.id, to: alt.id, x0: s.x, y0: s.y, x1: alt.x, y1: alt.y, t0: t, t1: t + d / pr.speed, tDie: Infinity, rerouted: true, payload, mass };
      if (this.rng.next() > Math.exp(-0.0004 * d)) np.tDie = t + this.rng.next() * (np.t1 - t);
      this.probes.push(np);
      this.lineages[np.lin].probes++;
      alt.intents.push({ origin: s.id, t, eta: np.t1, kind: 'seed', civ: np.civ });
      return 'rerouted';
    }
    this.salvage(s, pr);
  }

  // A probe that can't do anything useful where it arrived: a friendly colony absorbs it
  // into its stockpile; anyone else's system just gets the wreck as rubble.
  salvage(s, pr) {
    if (s.owner >= 0 && s.civ === pr.civ && !this.lineages[s.owner].feral === !this.lineages[pr.lin].feral) s.stock += pr.payload;
    else this.toRubble(s, pr.payload);
  }

  // Failed attack: the attacker is destroyed and takes some defences with it.
  repel(s, pr) {
    this.stats.repelled++;
    const dmg = Math.min(s.defense, pr.payload * 0.5);
    s.defense -= dmg;
    this.toRubble(s, pr.payload + dmg);
  }

  // ---------------------------------------------------------------- tech
  refreshTech(s) {
    const civ = this.civs[s.civ];
    let changed = false;
    for (let k = 0; k < 5; k++) if (civ.techBase[k] > s.tech[k]) { s.tech[k] = civ.techBase[k]; changed = true; }
    for (const ev of civ.techEvents) {
      if (ev.level <= s.tech[ev.track]) continue;
      if (this.t >= ev.t + Math.hypot(ev.x - s.x, ev.y - s.y)) { s.tech[ev.track] = ev.level; changed = true; }
    }
    if (changed) { s.flash = this.t; this.invalidate(s); }
  }

  breakthrough(s, share = true) {
    const civ = this.civs[s.civ];
    // research the weakest track, with some randomness
    let track = 0, bv = Infinity;
    for (let k = 0; k < 5; k++) {
      const v = s.tech[k] + this.rng.next() * 1.6 + (k === T_FID ? 0.5 : 0);
      if (v < bv) { bv = v; track = k; }
    }
    const level = s.tech[track] + 1;
    s.tech[track] = level;
    s.discoveries++;
    if (!share) return; // hoarded
    civ.techEvents.push({ x: s.x, y: s.y, t: this.t, track, level, sid: s.id });
    if (level > civ.maxLevel[track]) {
      civ.maxLevel[track] = level;
      this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: this.diag, kind: 'tech', hue: civ.hue });
      this.log(`${civ.name}: ${TRACKS[track]} ${roman(level)} discovered at ${s.name}. News spreads at lightspeed.`, s, 'tech', civ.hue);
    }
  }

  // ---------------------------------------------------------------- supernovae
  explode(s) {
    this.stats.supernovae++;
    const hadColony = s.owner >= 0;
    const oldType = s.type;
    s.snType = oldType; s.snLum = s.lum; s.snAt = this.t;
    s.type = 'N'; s.lum = TYPES.N.lum; s.energy = energyOfLum(s.lum);
    // ejecta from the star itself: the only place new matter enters the region
    const ej = s.M0 * 0.5;
    s.metals += ej; s.M0 += ej; this.mass.injected += ej;
    this.toRubble(s, s.swarm); s.swarm = 0; s.dyson = 0;
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: this.diag, kind: 'sn', hue: 30 });
    this.activeSN.push({ s, t0: this.t, prevR: 0, killed: hadColony ? 1 : 0 });
    if (hadColony) { this.vacate(s); this.stats.sterilized++; }
    s.hazardUntil = this.t + 3000;
    this.log(`Supernova! ${oldType}-type ${s.name} detonates. The blast front expands at c.`, s, 'sn', 30);
  }

  stepSN() {
    const { nStart, nIdx, nDist } = this.g;
    for (let i = this.activeSN.length - 1; i >= 0; i--) {
      const e = this.activeSN[i];
      const r = this.t - e.t0;
      for (let k = nStart[e.s.id]; k < nStart[e.s.id + 1]; k++) {
        const d = nDist[k];
        if (d <= e.prevR) continue;
        if (d > r) break;
        const o = this.stars[nIdx[k]];
        if (d <= SN_KILL_R) {
          o.hazardUntil = Math.max(o.hazardUntil, this.t + 1200);
          if (o.owner >= 0) { this.vacate(o); this.stats.sterilized++; e.killed++; }
          // the blast shreds 70% of any swarm
          this.toRubble(o, o.swarm * 0.7); o.swarm *= 0.3; this.updateDyson(o);
        }
        const add = o.M0 * 0.15 * Math.max(0, 1 - d / MAXR); // enrichment from ejecta
        o.metals += add; o.M0 += add; this.mass.injected += add;
      }
      e.prevR = r;
      if (r > MAXR) {
        if (e.killed > 1) this.log(`The ${e.s.name} supernova sterilised ${e.killed} colonised systems.`, e.s, 'snreport', 30);
        this.activeSN.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- colony tick
  stepColony(s, dt) {
    const t = this.t;
    let lin = this.lineages[s.owner];
    // Slow value drift: long-lived colonies accumulate copy errors in their own minds.
    if (this.rng.next() < this.p.mutation * 2.5e-3 * Math.pow(0.85, s.tech[T_FID]) * dt) {
      this.driftColony(s);
      lin = this.lineages[s.owner];
    }
    if (t >= s.nextSync) {
      s.nextSync = t + 300 + this.rng.next() * 300;
      this.syncDialect(s);
      lin = this.lineages[s.owner];
    }
    const feral = lin.feral;
    if (t >= s.techT) { this.refreshTech(s); s.techT = t + 30 + this.rng.next() * 30; }

    // cached; invalidated whenever tech or genome changes (see invalidate())
    const P = s._P || (s._P = this.probeCost(s.tech, s.genome.expand));
    if (!feral && t >= s.nextScan) {
      s.nextScan = t + 80 + this.rng.next() * 80;
      // Arm up only on *seen* hostility: ferals, or conquests by other civs within view.
      // (skip the scan entirely if nothing hostile has happened within light-crossing time)
      s.alert = (s.genome.loyalty >= 0.4 && t - this.lastHostile < this.diag + HOSTILE_MEMORY) ? this.scanHostile(s) : 0;
    }

    // What does this colony want matter for right now?
    const wantProbes = !s.noTargets && s.stock < P * (s.alert > 0 || lin.raider ? KIND_MASS.raid : 1);
    const swarmNeed = this.swarmNeed(s);
    // better Stellar Engineering shrinks what a full swarm needs; surplus hardware is recycled
    if (s.swarm > swarmNeed * 1.01) { s.stock += s.swarm - swarmNeed; s.swarm = swarmNeed; }
    const wantSwarm = !feral && s.swarm < swarmNeed;
    // defences are built up to a level scaled by how many hostile systems are in view
    const wantDefense = s.alert > 0 && s.defense < this.defenseTarget(s);
    // Industry needs INFRA_PER_I tonnes of infrastructure per unit of output.
    const cap = this.industryCap(s);
    const g = 0.0035 * (1 + 0.25 * s.tech[T_FAB]) * (feral ? 1.4 : 1);
    const wantGrowth = s.I < cap * 0.98;
    const idle = !wantProbes && !wantSwarm && !wantDefense && !wantGrowth;

    // Mine only what there's a use for. Raw rock first; once that's gone, colonies that
    // still need probes or defences start dismantling their own swarm.
    const growthNeed = wantGrowth ? g * s.I * (1 - s.I / cap) * dt * INFRA_PER_I : 0;
    let budget = (wantProbes || wantSwarm || wantDefense) ? s.I * dt : Math.min(s.I * dt, growthNeed);
    let extract = Math.min(budget, s.metals);
    s.metals -= extract;
    if (extract < budget && s.swarm > 0 && (wantProbes || wantDefense || feral)) {
      const take = Math.min(budget - extract, s.swarm);
      s.swarm -= take; extract += take;
      this.updateDyson(s);
    }

    // Industry grows toward its cap, but each unit of growth must be built out of matter.
    if (wantGrowth && extract > 0) {
      const share = (wantProbes || wantSwarm || wantDefense) ? 0.3 : 1;
      const dI = Math.min(growthNeed, extract * share) / INFRA_PER_I;
      if (dI > 0) { s.I += dI; s.infra += dI * INFRA_PER_I; extract -= dI * INFRA_PER_I; }
    } else if (s.I > cap) s.I = cap;
    // Without matter coming in, idle industry slowly decays (the hardware stays).
    if (extract <= 0 && s.metals < 1 && s.swarm <= 0) s.I = Math.max(0.05, s.I * (1 - 0.002 * dt));

    if (feral) {
      s.stock += extract;
    } else {
      let ps = wantProbes ? 0.3 + 0.65 * s.genome.expand : 0;
      if (wantProbes && s.alert > 0) ps = Math.max(ps, 0.7);
      let toProbes = extract * ps;
      let rest = extract - toProbes;
      if (wantDefense) { s.defense += rest * 0.5; rest *= 0.5; }
      if (wantSwarm) {
        const add = Math.min(rest, swarmNeed - s.swarm);
        s.swarm += add; rest -= add;
        // a colony with nowhere to expand also pours its saved probe stockpile into the swarm
        if (s.noTargets && s.stock > 0 && s.swarm < swarmNeed) {
          const mv = Math.min(s.stock * 0.01 * dt, swarmNeed - s.swarm);
          s.stock -= mv; s.swarm += mv;
        }
        this.updateDyson(s);
        if (s.dyson >= 1 && !this.civs[s.civ].firstDyson && this.civs[s.civ].parent < 0) {
          this.civs[s.civ].firstDyson = true;
          this.log(`${this.civs[s.civ].name} completes its first full Dyson swarm around ${s.name}. The star goes dark to outside observers.`, s, 'dyson', this.civs[s.civ].hue);
        }
      }
      s.stock += toProbes + rest; // anything unallocated stays in the stockpile
    }
    // Research runs on captured energy, not matter. Ferals research too, but only for
    // themselves: they never broadcast what they learn.
    s.research += (0.05 + s.I * 0.01) * this.effEnergy(s) * (1 + 4 * s.dyson) * (idle ? 2 : 1) * dt;
    const RT = s._RT || (s._RT = this.researchThreshold(s.tech));
    if (s.research >= RT) {
      s.research -= RT;
      this.breakthrough(s, !feral);
      this.invalidate(s);
    }

    // probe construction / launch
    if (s.noTargets && t >= s.noTargetUntil) {
      s.noTargets = !this.chooseTarget(s, lin, feral);
      s.noTargetUntil = t + 250 + this.rng.next() * 250;
    }
    // shipyards have finite throughput: one probe per build time
    if (!s.noTargets && s.stock >= P && t >= (s.nextBuild || 0)) {
      const pick = this.chooseTarget(s, lin, feral);
      if (pick) {
        if (s.stock >= P * KIND_MASS[pick.kind]) {
          this.launch(s, pick.target, pick.kind);
          s.nextBuild = t + this.buildTime(s.tech) * KIND_BUILD[pick.kind];
        } else s.nextBuild = t + 20; // still saving up for a warship
      } else { s.noTargets = true; s.noTargetUntil = t + 150 + this.rng.next() * 150; }
    }
  }

  // Priorities: defend (hunters) > expand into free space > raid other civs (raiders only;
  // more aggressive strains raid even while free space remains). Ferals take anything.
  chooseTarget(s, lin, feral) {
    if (feral) { const f = this.findFeralTarget(s, s.tech); return f && { target: f, kind: 'seed' }; }
    if (s.alert > 0) { const h = this.findHunterTarget(s, s.tech); if (h) return { target: h, kind: 'hunter' }; }
    if (lin.raider && this.rng.next() < (s.genome.aggr - RAID_AGGR) * 1.5) {
      const r = this.findRaidTarget(s, s.tech); if (r) return { target: r, kind: 'raid' };
    }
    const seed = this.findSeedTarget(s, s.tech, s.genome.loyalty);
    if (seed) return { target: seed, kind: 'seed' };
    if (lin.raider) { const r = this.findRaidTarget(s, s.tech); if (r) return { target: r, kind: 'raid' }; }
    return null;
  }

  // ---------------------------------------------------------------- main step
  step(dt) {
    this.t += dt;
    const t = this.t;
    for (const civ of this.civs) if (!civ.started && t >= civ.tStart) this.startCiv(civ);

    while (this.snIdx < this.snQueue.length && this.snQueue[this.snIdx].snTime <= t) {
      const s = this.snQueue[this.snIdx++];
      if (s.type === 'O' || s.type === 'B') this.explode(s);
    }
    if (this.activeSN.length) this.stepSN();

    // colonies (iterate a snapshot-free way: new colonies this tick just start next tick)
    // Colonies are ticked in staggered batches (each one every COLONY_STRIDE steps).
    const stars = this.stars;
    const phase = this.stepCount % COLONY_STRIDE;
    const cdt = dt * COLONY_STRIDE;
    for (let i = phase; i < stars.length; i += COLONY_STRIDE) {
      const s = stars[i];
      if (s.owner >= 0 && s.colonizedAt < t) this.stepColony(s, cdt);
    }
    if (this.feralColonies > 0) this.lastHostile = t;
    this.stepCount++;

    // probes
    const probes = this.probes;
    for (let i = probes.length - 1; i >= 0; i--) {
      const pr = probes[i];
      if (t >= pr.tDie) {
        this.stats.lost++;
        this.mass.lost += pr.mass;
        this.retire(pr, 'lost');
        probes[i] = probes[probes.length - 1]; probes.pop();
        this.checkExtinct(this.lineages[pr.lin]);
      } else if (t >= pr.t1) {
        probes[i] = probes[probes.length - 1]; probes.pop();
        const res = this.arrive(pr);
        if (res !== 'rerouted') this.retire(pr, 'arrive');
        this.checkExtinct(this.lineages[pr.lin]);
      }
    }

    // housekeeping (cheap, amortised)
    if (this.stepCount % 20 === 0) this.housekeep();
    if (t >= this.nextSample) { this.sample(); this.nextSample = t + 250; }
  }

  housekeep() {
    const t = this.t;
    const sum = new Float64Array(this.civs.length), cnt = new Float64Array(this.civs.length);
    for (const s of this.stars) if (s.owner >= 0) { sum[s.civ] += s.genome.proto; cnt[s.civ]++; }
    for (const c of this.civs) if (cnt[c.id]) c.protoMean = sum[c.id] / cnt[c.id];
    for (const [id, th] of this.hostileSites) {
      const o = this.stars[id];
      if (t - th > HOSTILE_MEMORY + MAXR && !(o.owner >= 0 && this.lineages[o.owner].feral)) this.hostileSites.delete(id);
    }
    for (const civ of this.civs) {
      const keep = [];
      for (const ev of civ.techEvents) {
        if (t > ev.t + this.diag) civ.techBase[ev.track] = Math.max(civ.techBase[ev.track], ev.level);
        else keep.push(ev);
      }
      civ.techEvents = keep;
    }
    const ringKeep = [];
    for (const r of this.rings) if ((t - r.t0) < r.maxR) ringKeep.push(r);
    this.rings = ringKeep.length > 2500 ? ringKeep.slice(-2500) : ringKeep;
    this.ghosts = this.ghosts.filter((g) => t - g.tEnd < this.diag);
    if (this.ghosts.length > 20000) this.ghosts = this.ghosts.slice(-20000);
    // prune stale intents
    for (const s of this.stars) {
      if (s.intents.length && s.intents[0].eta + 600 < t) s.intents = s.intents.filter((it) => it.eta + 600 >= t);
    }
  }

  sample() {
    let loyalty = 0, aggr = 0, expand = 0, dy = 0, lumTot = 0, lumCap = 0;
    const civCounts = this.civs.map(() => 0);
    let feral = 0;
    for (const s of this.stars) {
      lumTot += s.lum; lumCap += s.lum * s.dyson;
      if (s.owner < 0) continue;
      loyalty += s.genome.loyalty; aggr += s.genome.aggr; expand += s.genome.expand; dy += s.dyson;
      if (this.lineages[s.owner].feral) feral++;
      else civCounts[s.civ]++;
    }
    const n = Math.max(1, this.colonyCount);
    const L = this.massLedger();
    this.ledger = L;
    const mf = L.raw / L.total;
    while (this.matterMilestones.length && mf <= this.matterMilestones[0]) {
      const m = this.matterMilestones.shift();
      this.log(m > 0.05 ? `Only ${Math.round(m * 100)}% of the region's matter is still unmined rock.`
        : 'The region\'s rock is effectively strip-mined. What remains is swarms, hardware and rubble.', null, 'milestone', 200);
    }
    this.series.push({
      t: this.t, civCounts, feral, probes: this.probes.length,
      loyalty: loyalty / n, aggr: aggr / n, expand: expand / n, dyson: dy / n, captured: lumCap / lumTot,
      metals: mf, swarmFrac: L.swarm / L.total, exhaustFrac: L.exhaust / L.total,
    });
    if (this.series.length > 1600) this.series = this.series.filter((_, i) => i % 2 === 0);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Copy errors are more likely to damage a complex value system than improve it, so
// loyalty drifts slightly downward; the other genes (and the dialect) random-walk.
function mutate(rng, g, k) {
  return {
    loyalty: clamp01(g.loyalty + rng.normal() * 0.1 * k - 0.03 * k),
    aggr: clamp01(g.aggr + rng.normal() * 0.08 * k),
    expand: clamp01(g.expand + rng.normal() * 0.1 * k),
    proto: g.proto + rng.normal() * 0.05 * k,
  };
}
