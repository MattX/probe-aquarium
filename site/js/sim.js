// Von Neumann probe simulation.
//
// Core ideas:
//  * Every colony only knows what light has told it. Knowledge is never stored
//    per-colony; it is derived from event timestamps + distance (retarded time).
//  * Colonies mine their star system, grow industry, build probes, Dyson swarms,
//    and do research. Breakthroughs propagate through the civilisation at c.
//  * Replication is imperfect. Genomes drift; strains that lose the "cooperation"
//    drive go feral and prey on other colonies. Cooperative colonies that see
//    feral activity (with light lag) arm themselves and send hunter probes.
//  * Massive stars go supernova, sterilising everything the blast front reaches.
import { RNG } from './rng.js';
import { MAXR, TYPES, energyOfLum } from './galaxy.js';

export const TRACKS = ['Drive', 'Range', 'Fabrication', 'Fidelity', 'Stellar Eng.'];
export const T_DRIVE = 0, T_RANGE = 1, T_FAB = 2, T_FID = 3, T_STELLAR = 4;
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const roman = (n) => ROMAN[n] || String(n);

const CIV_DEFS = [
  { name: 'Lattice', hue: 190 },
  { name: 'Chorus', hue: 45 },
  { name: 'Seedwright', hue: 280 },
  { name: 'Quiet Tide', hue: 130 },
];
const FERAL_COOP = 0.2;     // below this a strain is feral
const UNFERAL_COOP = 0.35;  // hysteresis to return
const SN_KILL_R = 45;       // ly
const COMMS_R = 110;
const COLONY_STRIDE = 3;        // how far we bother drawing routine broadcast rings

export const DEFAULT_PARAMS = {
  nStars: 5000,
  origins: 2,
  mutation: 0.05,
  baseSpeed: 0.03,
  snRate: 1,
  seed: 1,
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
    this.events = [];   // log
    this.lineages = [];
    this.civs = [];
    this.diag = Math.hypot(galaxy.W, galaxy.H);
    this.nextProbeId = 1;
    this.stats = {
      launched: 0, duplicates: 0, dupLag: 0, dupJump: 0, rerouted: 0, lost: 0, conquests: 0, repelled: 0,
      huntersLaunched: 0, huntKills: 0, sterilized: 0, supernovae: 0, colonized: 0,
    };
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
    this.lastFeralSeen = -1e9;
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
        colonies: 0, firstDyson: false,
      };
      this.civs.push(civ);
    });
  }

  // Returns the lineage a genome belongs to: the parent's, or a new strain if it has
  // diverged far enough (or crossed the feral line).
  speciate(civ, parentId, genome) {
    const par = this.lineages[parentId];
    const feralNow = par.feral ? genome.coop < UNFERAL_COOP : genome.coop < FERAL_COOP;
    if (feralNow === par.feral && Math.abs(genome.coop - par.genome.coop) < 0.12 &&
        Math.abs(genome.expand - par.genome.expand) < 0.15) return parentId;
    return this.newLineage(civ, parentId, genome).id;
  }

  newLineage(civ, parent, genome) {
    const par = parent >= 0 ? this.lineages[parent] : null;
    const feral = par && par.feral ? genome.coop < UNFERAL_COOP : genome.coop < FERAL_COOP;
    let hue;
    if (!par) hue = this.civs[civ].hue;
    else hue = par.hue + this.rng.normal() * 13;
    const id = this.lineages.length;
    const lin = {
      id, civ, parent, hue, feral, genome: { ...genome }, born: this.t,
      colonies: 0, peak: 0, probes: 0, outbreakLogged: false, extinctLogged: false,
      name: `${this.civs[civ].name}-${id.toString(36)}`,
    };
    this.lineages.push(lin);
    return lin;
  }

  startCiv(civ) {
    civ.started = true;
    const s = this.stars[civ.origin];
    const genome = { coop: 0.85, expand: 0.5 };
    const lin = this.newLineage(civ.id, -1, genome);
    this.colonize(s, { lin: lin.id, civ: civ.id, genome, tech: [0, 0, 0, 0, 0] }, true);
    s.I = 6;
    s.isOrigin = true;
    this.log(`${civ.name} awakens at ${s.name}. The first seed factory spins up.`, s, 'origin', civ.hue);
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: this.diag, kind: 'origin', hue: civ.hue });
  }

  // ---------------------------------------------------------------- helpers
  log(text, star, kind, hue) {
    this.events.push({ t: this.t, text, x: star ? star.x : null, y: star ? star.y : null, sid: star ? star.id : -1, kind, hue });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  ownerAt(s, time) {
    const h = s.history;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= time) return h[i].lin;
    return -1;
  }

  rangeOf(tech) { return Math.min(MAXR, 32 + 9 * tech[T_RANGE]); }
  speedOf(tech) { return Math.min(0.5, this.p.baseSpeed * Math.pow(1.28, tech[T_DRIVE])); }
  probeCost(tech) { return Math.max(80, 600 * Math.pow(0.87, tech[T_FAB])); }
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
  heardClaim(o, from, d, kindFilter) {
    const t = this.t;
    for (const it of o.intents) {
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
      if (it.kind !== kind) continue;
      const src = this.stars[it.origin];
      const dd = Math.hypot(src.x - from.x, src.y - from.y);
      if (it.t + dd <= t && t - d < it.eta + 250) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- targeting
  findSeedTarget(from, tech, coop, maxR) {
    const { nStart, nIdx, nDist } = this.g;
    const R = Math.min(maxR ?? Infinity, this.rangeOf(tech));
    const t = this.t;
    const respect = Math.min(1, coop * 2);
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
        // cooperative strains follow it, and only as far as their light cone lets them see.
        if (coop >= 0.5 && from.civ >= 0 && this.siblingCloser(o, from, d)) continue;
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

  findHunterTarget(from, tech) {
    const { nStart, nIdx, nDist } = this.g;
    const R = Math.min(MAXR, this.rangeOf(tech) * 1.3);
    const t = this.t;
    for (let k = nStart[from.id]; k < nStart[from.id + 1]; k++) {
      const d = nDist[k];
      if (d > R) break;
      const o = this.stars[nIdx[k]];
      const own = this.ownerAt(o, t - d);
      if (own >= 0 && this.lineages[own].feral) {
        if (this.countHeard(o, from, d, 'hunter') < 2) return o;
      }
    }
    return null;
  }

  scanFeral(s) {
    const { nStart, nIdx, nDist } = this.g;
    const R = Math.min(MAXR, this.rangeOf(s.tech) * 1.5);
    const t = this.t;
    let n = 0;
    for (let k = nStart[s.id]; k < nStart[s.id + 1]; k++) {
      const d = nDist[k];
      if (d > R) break;
      const own = this.ownerAt(this.stars[nIdx[k]], t - d);
      if (own >= 0 && this.lineages[own].feral) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- lifecycle
  colonize(s, probe, isOrigin = false) {
    const lin = this.lineages[probe.lin];
    s.owner = probe.lin;
    s.civ = probe.civ;
    s.genome = { ...probe.genome };
    s.tech = probe.tech.slice();
    s.I = isOrigin ? 6 : 1;
    s.probeFund = 0;
    s.defense = 0;
    s.research = this.rng.next() * 50;
    s.colonizedAt = this.t;
    s.alert = 0;
    s.nextScan = this.t + this.rng.range(20, 100);
    s.noTargets = false;
    s.noTargetUntil = 0;
    s.launched = 0;
    s.techT = this.t;
    s.flash = this.t;
    s.discoveries = 0;
    s.history.push({ t: this.t, lin: probe.lin });
    lin.colonies++; lin.peak = Math.max(lin.peak, lin.colonies);
    this.civs[probe.civ].colonies++;
    this.colonyCount++;
    if (lin.feral) this.feralColonies++;
    this.stats.colonized++;
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: COMMS_R, kind: 'comm', hue: lin.feral ? 0 : lin.hue });
    this.checkContact(s);
    if (lin.feral && !lin.outbreakLogged && lin.colonies >= 5) {
      lin.outbreakLogged = true;
      if (this.t - this.lastFeralOutbreakLog > 1500) {
        this.lastFeralOutbreakLog = this.t;
        this.log(`Feral outbreak: strain ${lin.name} (coop ${lin.genome.coop.toFixed(2)}) now holds ${lin.colonies} systems near ${s.name}.`, s, 'feral', 0);
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
    s.history.push({ t: this.t, lin: -1 });
    s.owner = -1; s.civ = -1; s.I = 0; s.probeFund = 0;
    this.checkExtinct(lin);
  }

  transfer(s, probe) {
    // Conquest/liberation: ownership flips, infrastructure mostly retained.
    const oldLin = this.lineages[s.owner];
    const newLin = this.lineages[probe.lin];
    oldLin.colonies--; this.civs[s.civ].colonies--;
    if (oldLin.feral) this.feralColonies--;
    s.owner = probe.lin; s.civ = probe.civ;
    s.genome = { ...probe.genome };
    s.tech = s.tech.map((v, i) => Math.max(v, probe.tech[i]));
    s.research = 0; s.probeFund = 0; s.defense = 0; s.alert = 0;
    s.I *= 0.6;
    s.noTargets = false; s.flash = this.t; s.colonizedAt = this.t;
    s.history.push({ t: this.t, lin: probe.lin });
    newLin.colonies++; newLin.peak = Math.max(newLin.peak, newLin.colonies);
    this.civs[probe.civ].colonies++;
    if (newLin.feral) this.feralColonies++;
    this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: COMMS_R * 1.4, kind: newLin.feral ? 'alarm' : 'comm', hue: newLin.feral ? 0 : newLin.hue });
    this.checkExtinct(oldLin);
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
    const genome = {
      coop: clamp01(s.genome.coop + this.rng.normal() * 0.1 - 0.03),
      expand: clamp01(s.genome.expand + this.rng.normal() * 0.06),
    };
    s.genome = genome;
    const nid = this.speciate(s.civ, s.owner, genome);
    if (nid === s.owner) return;
    const nl = this.lineages[nid];
    old.colonies--; if (old.feral) this.feralColonies--;
    nl.colonies++; nl.peak = Math.max(nl.peak, nl.colonies); if (nl.feral) this.feralColonies++;
    s.owner = nl.id;
    s.history.push({ t: this.t, lin: nl.id });
    s.noTargets = false; s.flash = this.t;
    if (nl.feral && !old.feral) {
      this.rings.push({ x: s.x, y: s.y, t0: this.t, maxR: COMMS_R * 1.4, kind: 'alarm', hue: 0 });
      this.stats.defections = (this.stats.defections || 0) + 1;
    }
    this.checkExtinct(old);
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
        const key = Math.min(o.civ, s.civ) * 10 + Math.max(o.civ, s.civ);
        if (!this.contacts.has(key)) {
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
        genome = {
          coop: clamp01(s.genome.coop + this.rng.normal() * 0.1 - 0.03),
          expand: clamp01(s.genome.expand + this.rng.normal() * 0.1),
        };
      }
      linId = this.speciate(civ, s.owner, genome);
    }
    const tech = s.tech.slice();
    const speed = this.speedOf(tech);
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
      t0: t, t1, tDie, speed,
    };
    this.probes.push(pr);
    this.lineages[linId].probes++;
    target.intents.push({ origin: s.id, t, eta: t1, kind });
    s.launched++;
    this.stats.launched++;
    if (kind === 'hunter') this.stats.huntersLaunched++;
    this.rings.push({ x: s.x, y: s.y, t0: t, maxR: COMMS_R * 0.7, kind: 'launch', hue: kind === 'hunter' ? -1 : (this.lineages[linId].feral ? 0 : lin0.hue) });
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
    if (s.hazardUntil > t) { this.stats.lost++; return; }
    if (pr.kind === 'hunter') {
      if (s.owner >= 0 && this.lineages[s.owner].feral) {
        const atk = 4 + 0.6 * pr.tech[T_FAB];
        const def = 1 + s.I * 0.04 + s.defense / 300;
        if (this.rng.next() < atk / (atk + def)) { this.transfer(s, pr); this.stats.huntKills++; }
        else this.stats.repelled++;
      } else if (s.owner < 0) {
        this.colonize(s, pr);
      } else if (s.civ === pr.civ) {
        s.probeFund += this.probeCost(pr.tech) * 0.5;
      }
      return;
    }
    if (lin.feral) {
      if (s.owner < 0) { this.colonize(s, pr); return; }
      if (s.owner === pr.lin) { s.probeFund += this.probeCost(pr.tech) * 0.5; return; }
      const atk = 3 + 0.3 * pr.tech[T_FAB];
      const tgtFeral = this.lineages[s.owner].feral;
      const def = 1 + s.defense / 250 + s.I * (tgtFeral ? 0.04 : 0.015);
      if (this.rng.next() < atk / (atk + def)) {
        this.stats.conquests++;
        this.transfer(s, pr);
      } else this.stats.repelled++;
      return;
    }
    // cooperative seed probe
    if (s.owner < 0) { this.colonize(s, pr); return; }
    // Duplicate arrival — someone got here first (light lag, or a claim we ignored)
    if (!pr.rerouted) {
      this.stats.duplicates++;
      if (pr.genome.coop < 0.5) this.stats.dupJump++; else this.stats.dupLag++;
    }
    const alt = this.findSeedTarget(s, pr.tech, pr.genome.coop, this.rangeOf(pr.tech) * 0.6);
    if (alt && alt !== s) {
      this.stats.rerouted++;
      this.retire(pr, 'arrive');
      const d = Math.hypot(alt.x - s.x, alt.y - s.y);
      const np = { ...pr, id: this.nextProbeId++, from: s.id, to: alt.id, x0: s.x, y0: s.y, x1: alt.x, y1: alt.y, t0: t, t1: t + d / pr.speed, tDie: Infinity, rerouted: true };
      if (this.rng.next() > Math.exp(-0.0004 * d)) np.tDie = t + this.rng.next() * (np.t1 - t);
      this.probes.push(np);
      this.lineages[np.lin].probes++;
      alt.intents.push({ origin: s.id, t, eta: np.t1, kind: 'seed' });
      return 'rerouted';
    }
    if (s.civ === pr.civ && !this.lineages[s.owner].feral) s.probeFund += this.probeCost(pr.tech) * 0.5;
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
    if (changed) s.flash = this.t;
  }

  breakthrough(s) {
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
    s.metals += s.M0 * 0.5; s.M0 *= 1.5; // remnant debris
    s.dyson = 0;
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
          o.dyson *= 0.3;
        }
        const add = o.M0 * 0.15 * Math.max(0, 1 - d / MAXR); // enrichment from ejecta
        o.metals += add; o.M0 += add;
      }
      e.prevR = r;
      if (r > MAXR) {
        if (e.killed > 1) this.log(`The ${e.s.name} supernova sterilised ${e.killed} colonised systems.`, e.s, 'sn', 30);
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
    const feral = lin.feral;
    if (t >= s.techT) { this.refreshTech(s); s.techT = t + 30 + this.rng.next() * 30; }

    // Idle colonies (swarm finished, nowhere to expand, no threat) throttle down to maintenance
    // and put their energy into computation instead.
    const idle = !feral && s.noTargets && s.dyson >= 1 && s.alert === 0;
    const extract = Math.min(s.I * dt * (idle ? 0.02 : 1), s.metals);
    s.metals -= extract;
    const cap = this.industryCap(s);
    const g = 0.0035 * (1 + 0.25 * s.tech[T_FAB]) * (feral ? 1.4 : 1);
    if (s.metals > 1) s.I += g * s.I * (1 - s.I / cap) * dt;
    else s.I *= Math.max(0, 1 - 0.002 * dt);
    if (s.I < 0.05) s.I = 0.05;

    const P = this.probeCost(s.tech);

    if (feral) {
      s.probeFund += extract;
    } else {
      if (t >= s.nextScan) {
        s.nextScan = t + 80 + this.rng.next() * 80;
        // (skip the scan entirely if no feral has existed within light-crossing time)
        s.alert = (s.genome.coop >= 0.4 && t - this.lastFeralSeen < this.diag) ? this.scanFeral(s) : 0;
      }
      let ps = s.noTargets ? 0 : 0.3 + 0.65 * s.genome.expand;
      if (s.alert > 0) ps = Math.max(ps, 0.7);
      s.probeFund += extract * ps;
      let rest = extract * (1 - ps);
      if (s.alert > 0) { s.defense += rest * 0.5; rest *= 0.5; }
      if (s.noTargets && s.probeFund > 0) { const leak = s.probeFund * 0.01 * dt; s.probeFund -= leak; rest += leak; }
      if (s.dyson < 1) {
        const cost = 40000 * Math.sqrt(s.lum + 0.05) / (1 + 0.3 * s.tech[T_STELLAR]);
        s.dyson = Math.min(1, s.dyson + rest / cost);
        if (s.dyson >= 1 && !this.civs[s.civ].firstDyson) {
          this.civs[s.civ].firstDyson = true;
          this.log(`${this.civs[s.civ].name} completes its first full Dyson swarm around ${s.name}. The star goes dark to outside observers.`, s, 'dyson', this.civs[s.civ].hue);
        }
      }
      // research runs on captured energy
      s.research += (0.05 + s.I * 0.01) * this.effEnergy(s) * (1 + 4 * s.dyson) * (idle ? 2 : 1) * dt;
      if (s.research >= this.researchThreshold(s.tech)) {
        s.research -= this.researchThreshold(s.tech);
        this.breakthrough(s);
      }
    }

    // probe construction / launch
    if (s.noTargets && t >= s.noTargetUntil) {
      const probeT = feral ? this.findFeralTarget(s, s.tech) : (s.alert > 0 && this.findHunterTarget(s, s.tech)) || this.findSeedTarget(s, s.tech, s.genome.coop);
      s.noTargets = !probeT;
      s.noTargetUntil = t + 250 + this.rng.next() * 250;
    }
    if (!s.noTargets && s.probeFund >= P) {
      let target = null, kind = 'seed';
      if (!feral && s.alert > 0) { target = this.findHunterTarget(s, s.tech); if (target) kind = 'hunter'; }
      if (!target) target = feral ? this.findFeralTarget(s, s.tech) : this.findSeedTarget(s, s.tech, s.genome.coop);
      if (target) { s.probeFund -= P; this.launch(s, target, kind); }
      else { s.noTargets = true; s.noTargetUntil = t + 150 + this.rng.next() * 150; }
    }
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
    if (this.feralColonies > 0) this.lastFeralSeen = t;
    this.stepCount++;

    // probes
    const probes = this.probes;
    for (let i = probes.length - 1; i >= 0; i--) {
      const pr = probes[i];
      if (t >= pr.tDie) {
        this.stats.lost++;
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
    let coop = 0, expand = 0, dy = 0, lumTot = 0, lumCap = 0, metals = 0, metals0 = 0;
    const civCounts = this.civs.map(() => 0);
    let feral = 0;
    for (const s of this.stars) {
      lumTot += s.lum; lumCap += s.lum * s.dyson;
      metals += s.metals; metals0 += s.M0;
      if (s.owner < 0) continue;
      coop += s.genome.coop; expand += s.genome.expand; dy += s.dyson;
      if (this.lineages[s.owner].feral) feral++;
      else civCounts[s.civ]++;
    }
    const n = Math.max(1, this.colonyCount);
    const mf = metals / metals0;
    while (this.matterMilestones.length && mf <= this.matterMilestones[0]) {
      const m = this.matterMilestones.shift();
      this.log(m > 0.05 ? `Only ${Math.round(m * 100)}% of the region's mineable matter remains.`
        : 'The region is effectively strip-mined. Industry is winding down; only starlight remains.', null, 'milestone', 200);
    }
    this.series.push({
      t: this.t, civCounts, feral, probes: this.probes.length,
      coop: coop / n, expand: expand / n, dyson: dy / n, captured: lumCap / lumTot,
      metals: metals / metals0,
    });
    if (this.series.length > 1600) this.series = this.series.filter((_, i) => i % 2 === 0);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
