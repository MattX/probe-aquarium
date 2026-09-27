// Tooltip text explaining what the simulation models. Numbers mirror sim.js — keep in sync.

export const TECH_TIPS = [
  '<b>Drive</b> — probe cruise speed = base speed × 1.28<sup>level</sup>, capped at 0.5 c.',
  '<b>Range</b> — longest hop a probe can make = 32 + 9 × level ly (hard cap 120 ly). Sparse inter-arm gaps can stall expansion until Range improves.',
  '<b>Fabrication</b> — probe cost 600 t × 0.87<sup>level</sup> (min 80 t); industry grows 25% faster per level; hunters and feral raiders hit harder.',
  '<b>Fidelity</b> — error correction. Replication copy-error rate × 0.8<sup>level</sup>; slow value drift inside colonies × 0.85<sup>level</sup>.',
  '<b>Stellar Engineering</b> — Dyson swarm cost ÷ (1 + 0.3 × level); each level adds 25% to the energy a swarm yields.',
];

export const TIPS = {
  // top bar
  play: 'Play / pause <kbd>Space</kbd>',
  speed: 'Simulated years per real second. If your machine can\'t keep up, the label turns orange and shows the rate actually achieved.',
  viewMode: 'What colonies and territory are coloured by <kbd>V</kbd>. Hover the legend in the panel for details of the current mode.',
  tTerr: 'Soft fields showing which colony is nearest each point of space <kbd>T</kbd>',
  tProbes: 'Probes in flight, with a faint trail back to where they launched <kbd>P</kbd>',
  tComms: 'Routine lightspeed broadcasts: every launch and every new colony announces itself at c <kbd>C</kbd>. Tech, supernova and alarm fronts are always shown.',
  fit: 'Fit the whole region in view <kbd>F</kbd>',
  help: 'Overview of the model <kbd>H</kbd>',
  panel: 'Show / hide the side panel',
  autoPause: 'Automatically pause (and fly the camera there) when chosen kinds of event happen.',

  // region stats
  colonised: 'Star systems with an active colony of any strain, feral included.',
  inFlight: 'Probes currently in transit. Seed probes found colonies; white hunters attack feral systems; red probes are feral raiders.',
  launched: 'Every probe ever built. Each costs 600 t of matter, less with Fabrication tech.',
  duplicates: 'Probes that arrived to find their target already taken. Most then try to reroute to a free star within 60% of their range; the rest are salvaged for half their mass.',
  dupLag: 'Cooperative probes whose builder had not yet heard (at lightspeed) that someone else had claimed or taken the star. The nearest-visible-colony protocol keeps this small.',
  dupJump: 'Probes from low-cooperation strains (coop < 0.5), which ignore heard claims with probability 1 − 2×coop and skip the nearest-colony protocol.',
  lost: 'Probes destroyed in transit. Survival = exp(−0.007 × dust column − 0.0004 × distance), so long hops through dark lanes are risky.',
  strains: 'Distinct lineages with at least one colony. A new strain forks when a genome drifts ≥ 0.12 in cooperation or ≥ 0.15 in expansion from its founder, or crosses the feral line.',
  feral: 'Colonies whose cooperation gene fell below 0.20. They spend all output on probes, never build swarms or research, ignore claims and attack other colonies. A descendant only recovers above 0.35.',
  conquests: 'Feral attacks that captured a colony / that failed. Success chance = attack ÷ (attack + defence); defence grows with industry and with defences built while on alert.',
  hunters: 'Cooperative colonies that can see feral systems within 1.5× their probe range (by the light that has reached them) go on alert: they divert half their spare output to defences and build hunter probes. A successful hunt hands the system to the hunter\'s strain.',
  supernovae: 'Massive O-type (and some B-type) stars explode. The blast front travels at c, sterilises colonies within 45 ly and leaves systems irradiated for ~1,200 yr. Ejecta enrich matter up to 120 ly away.',
  captured: 'Fraction of the region\'s total starlight enclosed by Dyson swarms.',
  matter: 'Mineable matter left across all systems, relative to everything that existed (including supernova enrichment).',

  civTech: 'Best level discovered anywhere in this civilisation. Individual colonies only learn of it when the light carrying the news reaches them.',
  chart1: 'Colonised systems over time, stacked by civilisation, with feral systems in red on top.',
  chart2: 'Colony averages over time: cooperation and expansion genes, fraction of starlight captured, and fraction of matter left.',

  // inspector
  iMatter: 'Mineable mass in tonnes. The initial budget scales with spectral type, metallicity and nearby nebulae. Colonies extract at their industry rate; idle ones throttle to 2%.',
  iZ: 'Heavy-element abundance, relative to typical. Higher toward the galactic core (left edge) and near nebulae.',
  iEnergy: 'Usable power from the star, from its luminosity on a log scale. A full Dyson swarm multiplies it by 1 + 6 × (1 + 0.25 × Stellar level).',
  iIrradiated: 'Recently hit by a supernova blast. Probes arriving now are destroyed.',
  iLifetime: 'Massive stars burn out fast; most O-type and some B-type stars will go supernova during the simulation.',
  iCoop: 'Cooperation gene (0–1). Probability of respecting a heard claim = min(1, 2 × coop). At ≥ 0.5 it follows the nearest-colony protocol; at ≥ 0.4 it watches for ferals; below 0.2 the strain is feral.',
  iExpand: 'Expansion gene (0–1). While targets exist, the share of output spent on probes is 0.30 + 0.65 × expand; the rest builds the Dyson swarm.',
  iFounded: 'When this colony was founded (or last changed hands).',
  iIndustry: 'Extraction rate in tonnes per year. Grows logistically (0.35%/yr base, faster with Fabrication) toward a cap set by energy, swarm coverage and the system\'s mass.',
  iLaunched: 'Probes this colony has built and launched.',
  iStatus: '<b>expanding</b>: saving up for probes · <b>building swarm</b>: no targets left, all output to the Dyson swarm · <b>computing (idle)</b>: swarm done, mining throttled to 2%, research doubled · <b>on alert</b>: sees ferals nearby · <b>raiding</b>: feral · <b>exhausted</b>: no matter left.',
  iRange: 'Longest hop and cruise speed of the probes this colony builds, from the tech it has heard of.',
  iOrigin: 'Light-travel distance to the civilisation\'s homeworld. Anything this colony knows about home is at least this many years out of date.',
  iDyson: 'Fraction of the star enclosed. Cost 40,000 t × √(luminosity + 0.05), reduced by Stellar Engineering. Swarms dim the star (it re-radiates as infrared) and boost energy.',
  iResearch: 'Accumulates from captured energy. At 1,500 × 1.3<sup>(total tech levels)</sup> the colony makes a breakthrough in its weakest track and broadcasts it at c. Big swarm-wrapped stars become research hubs.',
  iTech: 'Tech this colony knows about. Newer breakthroughs may still be on their way at lightspeed.',
  iHistory: 'Changes of ownership: founding, conquest, liberation by hunters, value drift into a new strain, or sterilisation.',
  iIncoming: 'Probes currently heading here, with time to arrival.',
  iObserve: 'Show the whole galaxy as this star sees it right now: every star as it was when its light left, and probes at their delayed ("retarded") positions. <kbd>O</kbd>',

  // settings
  sSeed: 'Random seed. Same seed and settings reproduce the same galaxy and history.',
  sStars: 'Number of star systems. The region grows so density stays constant. Large values are slower.',
  sOrigins: 'Number of civilisations. After the first, each awakens at a random time within the first 6,000 years.',
  sMut: 'Probability that a replication introduces a copy error (reduced by Fidelity tech). Also sets the rate of slow value drift inside long-lived colonies. Higher means ferals sooner.',
  sSpeed: 'Starting probe cruise speed as a fraction of c. Drive tech multiplies it.',
  sSN: 'Multiplier on how often massive stars go supernova. 0 disables them.',
};

export const VIEW_TIPS = {
  lineage: 'Each strain has its own hue, drifting slightly from its parent\'s whenever a new strain forks. Feral strains are red.',
  civ: 'Colour by civilisation. Feral strains are red regardless of origin.',
  coop: 'Cooperation gene: red (0, feral) → yellow → green → blue (1). Watch for reddening pockets before outbreaks.',
  expand: 'Expansion drive: dark violet (0, prefers building swarms) → yellow (1, spends almost everything on probes).',
  tech: 'Total tech levels this colony knows of. Breakthroughs sweep across as bright bands at lightspeed.',
  age: 'Time since founding: yellow = recent, dark violet = old. Shows expansion waves and recolonisation.',
  dyson: 'Dyson swarm coverage: dark violet (none) → yellow (star fully enclosed).',
  matter: 'Matter remaining in the system: yellow (untouched) → dark violet (strip-mined).',
};

// Map legend: [glyph kind, label, tip]
export const LEGEND = [
  ['star', 'Stars', 'Colour is spectral type: blue-white O/B/A giants → yellow G (Sun-like) → orange K → red M dwarfs. Glow size shows luminosity. Violet points are neutron stars left by supernovae.'],
  ['colony', 'Colony', 'Zoomed out: the star is tinted by the colour mode. Zoomed in: a ring in that colour, bigger for more industry.'],
  ['feral', 'Feral colony', 'Red ring with crosshair spikes: a strain whose cooperation fell below 0.20.'],
  ['probe', 'Probe', 'Dot with a faint trail back to its launch point. Coloured by strain; white = hunter; red = feral raider.'],
  ['comm', 'Broadcast', 'Faint rings: news of a launch or founding spreading at c. Neighbours only learn of a claim once its ring reaches them.'],
  ['tech', 'Tech front', 'Bright ring in a civilisation\'s colour: a breakthrough spreading at lightspeed. Colonies sparkle as it reaches them.'],
  ['alarm', 'Alarm', 'Red ring: a colony just fell to (or drifted into) a feral strain.'],
  ['sn', 'Supernova', 'Orange front expanding at c. Lethal within 45 ly; leaves a violet remnant nebula.'],
  ['ir', 'Dyson swarm', 'Enclosed stars dim and turn deep red: the swarm re-radiates the captured light as infrared.'],
  ['dust', 'Dust / nebulae', 'Dark patches are dust lanes that destroy probes in transit. Pink and blue clouds are star-forming nebulae: rich in matter, but full of short-lived massive stars.'],
];

export const EVENT_KINDS = {
  sn: 'Supernova',
  feral: 'Feral outbreak',
  contain: 'Feral strain wiped out',
  contact: 'First contact',
  milestone: 'Milestone',
  dyson: 'First full Dyson swarm',
  origin: 'Civilisation awakens',
  tech: 'Tech breakthrough',
};
export const DEFAULT_PAUSE_KINDS = ['feral', 'contact', 'sn'];
