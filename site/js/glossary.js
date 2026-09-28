// Tooltip text explaining what the simulation models. Numbers mirror sim.js — keep in sync.

export const TECH_TIPS = [
  '<b>Drive</b> — top speed = base speed × 1.28<sup>level</sup> (cap 0.5 c) and exhaust velocity = 0.08 c × 1.22<sup>level</sup> (cap 0.6 c). Faster exhaust means less propellant per probe.',
  '<b>Range</b> — longest hop a probe can make = 32 + 9 × level ly (hard cap 120 ly). Sparse inter-arm gaps can stall expansion until Range improves.',
  '<b>Fabrication</b> — probe payload 300 u × 0.87<sup>level</sup> (min 40 u); industry grows 25% faster per level; hunters and feral raiders hit harder.',
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
  launched: 'Every probe ever built. Each is a payload (the seed factory, 300 u, less with Fabrication) plus propellant from the rocket equation.',
  duplicates: 'Probes that arrived to find their target already taken. Most then try to reroute to a free star within 60% of their range; the rest are salvaged for half their mass.',
  dupLag: 'Cooperative probes whose builder had not yet heard (at lightspeed) that someone else had claimed or taken the star. The nearest-visible-colony protocol keeps this small.',
  dupJump: 'Probes from low-loyalty strains (loyalty < 0.5), which ignore their own civ\'s heard claims with probability 1 − 2×loyalty and skip the nearest-colony protocol.',
  dupBorder: 'Probes that arrived to find the star taken by a different civilisation. Claims are only intelligible within a civ (they\'re in its protocol), so neighbours of different civs can\'t coordinate.',
  civsStat: 'Civilisations currently holding at least one system, and how many schisms have split off new ones.',
  raids: 'Warships launched by predatory strains (aggression > 0.6) against other civilisations\' systems. Warships carry 3× a seed probe\'s payload and take 8× as long to build.',
  splinter: 'This civilisation split off when a cluster of its parent\'s colonies drifted too far in dialect to understand the parent\'s broadcasts. Schisms come with an ideological shift: the founding doctrine sets where members\' aggression is pulled.',
  minorCivs: 'Smaller splinters, each holding a handful of systems. Colour mode “Civilisation” shows them all.',
  lost: 'Probes destroyed in transit. Survival = exp(−0.007 × dust column − 0.0004 × distance), so long hops through dark lanes are risky.',
  strains: 'Distinct lineages with at least one colony. A new strain forks when a genome drifts ≥ 0.12 in loyalty or aggression or ≥ 0.15 in expansion from its founder, crosses the feral line, or joins a new civilisation.',
  feral: 'Colonies whose loyalty fell below 0.20: no longer part of any civilisation in practice. They spend all output on probes, never build swarms, research only for themselves (never sharing), ignore claims and attack everything outside their own strain. A descendant only recovers above 0.35.',
  conquests: 'Systems captured by force (feral probes or raiders) / attacks that failed. Success chance = attack ÷ (attack + defence); defence grows with industry and with defences built while on alert. The captor inherits the stockpile, swarm and 60% of the infrastructure.',
  hunters: 'Colonies (loyalty ≥ 0.4) that can see, by the light that has reached them, a feral system or a system recently conquered by another civ within 1.5× their probe range go on alert: they build defences and hunter warships to retake exactly those systems. Tolerant civs arm too — it is behaviour, not identity, that triggers it.',
  supernovae: 'Massive O-type (and some B-type) stars explode. The blast front travels at c, sterilises colonies within 45 ly and leaves systems irradiated for ~1,200 yr. Ejecta enrich matter up to 120 ly away.',
  captured: 'Fraction of the region\'s total starlight enclosed by Dyson swarms.',
  matter: 'Share of all matter still sitting as unmined rock or rubble. Mass is conserved: see the bar below for where the rest is.',
  massBar: 'Where every unit of matter in the region is right now. Mass is conserved: mining moves rock into hardware and swarms; destroyed hardware falls back as rubble; the only losses are rocket exhaust and probes destroyed in transit, and the only source is supernova ejecta. Units are abstract "u".',

  civTech: 'Best level discovered anywhere in this civilisation. Individual colonies only learn of it when the light carrying the news reaches them.',
  chart1: 'Colonised systems over time, stacked by civilisation, with feral systems in red on top.',
  chart2: 'Colony averages over time: loyalty and aggression genes, expansion drive, fraction of starlight captured, and share of matter still unmined.',

  // inspector
  iMatter: 'Unmined rock plus rubble, in mass units. The initial amount scales with spectral type, metallicity and nearby nebulae. Colonies only mine what they have a use for (growth, probes, swarm, defences), up to their industry rate.',
  iInfra: 'Mass locked into the colony\'s industrial base: 60 u per unit of industry, plus the seed factory it arrived as. Captured by conquerors (40% wrecked); becomes rubble if the colony dies.',
  iStock: 'Refined matter waiting to become probes. Probes that arrive at a friendly system are absorbed here.',
  iDefense: 'Defensive hardware, built while the colony can see hostile systems. Raises the odds of repelling attacks; each failed attack wrecks some of it.',
  iSwarm: 'Mass of Dyson swarm hardware vs. what a complete swarm needs. Once the rock runs out, colonies that still need probes or defences dismantle their swarm for material.',
  iProbeCost: 'Payload × mass ratio. Reaching cruise speed v and braking again needs R = e^(2v / v_exhaust) (the rocket equation). Drive tech raises both top speed and exhaust velocity; eager expanders accept a mass ratio up to 2 + 4 × expand to go faster.',
  iZ: 'Heavy-element abundance, relative to typical. Higher toward the galactic core (left edge) and near nebulae.',
  iEnergy: 'Usable power from the star, from its luminosity on a log scale. A full Dyson swarm multiplies it by 1 + 6 × (1 + 0.25 × Stellar level).',
  iIrradiated: 'Recently hit by a supernova blast. Probes arriving now are destroyed.',
  iLifetime: 'Massive stars burn out fast; most O-type and some B-type stars will go supernova during the simulation.',
  iLoyalty: 'Loyalty gene (0–1): cohesion with its own civilisation. Probability of respecting a sibling\'s heard claim = min(1, 2 × loyalty). At ≥ 0.5 it follows the nearest-colony protocol; at ≥ 0.4 it arms up against visible hostility; below 0.2 the strain is feral. Copy errors bias it slowly downward.',
  iAggr: 'Aggression gene (0–1): stance toward other civilisations. Above 0.6 the strain raids other civs\' systems — sometimes even while free space remains, more often the higher it is. Selection can favour it: conquests spread the conqueror\'s genes.',
  iDialect: 'This colony\'s protocol dialect relative to its civilisation\'s average. Every few centuries it drifts and is pulled toward the same-civ neighbours it can see. Past ±0.5 it can no longer understand its civ and splinters off (joining a nearby splinter that speaks like it, if there is one).',
  iExpand: 'Expansion gene (0–1). While targets exist, the share of output spent on probes is 0.30 + 0.65 × expand; the rest builds the Dyson swarm.',
  iFounded: 'When this colony was founded (or last changed hands).',
  iIndustry: 'Maximum extraction rate in mass units per year. Grows logistically (0.35%/yr base, faster with Fabrication) toward a cap set by energy, swarm coverage and the system\'s mass — and every unit of growth must be built from 60 u of mined matter.',
  iLaunched: 'Probes this colony has built and launched.',
  iStatus: '<b>predatory</b>: raids other civilisations · <b>expanding</b>: saving up for probes · <b>building swarm</b>: no targets left, all output to the Dyson swarm · <b>computing (idle)</b>: swarm done and nothing to build, so no mining; research doubled · <b>on alert</b>: sees ferals nearby · <b>feral</b>: preys on everyone · <b>exhausted</b>: no matter left.',
  iRange: 'Longest hop and cruise speed of the probes this colony builds, from the tech it has heard of.',
  iOrigin: 'Light-travel distance to the civilisation\'s homeworld. Anything this colony knows about home is at least this many years out of date.',
  iDyson: 'Fraction of the star enclosed. A full swarm needs 40,000 u × √(luminosity + 0.05) of hardware, less with Stellar Engineering. Swarms dim the star (it re-radiates as infrared) and boost energy.',
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
  lineage: 'Each strain has its own hue, drifting slightly from its parent\'s whenever a new strain forks; strains that found a new civilisation take its colour. Feral strains are red.',
  civ: 'Colour by civilisation, including splinters born from schisms. Feral strains are red regardless of origin.',
  loyalty: 'Loyalty gene: red (0, feral) → yellow → green → blue (1). Reddening pockets precede feral outbreaks.',
  aggr: 'Aggression gene: teal (peaceable) → violet/pink (predatory; above 0.6 it raids other civilisations). Feral strains are red.',
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
  ['feral', 'Feral colony', 'Red ring with crosshair spikes: a strain whose loyalty fell below 0.20. It preys on everyone outside its own strain.'],
  ['probe', 'Probe', 'Dot with a faint trail back to its launch point. Coloured by strain; white = hunter warship; red = feral. Raiders\' warships are in their strain colour.'],
  ['comm', 'Broadcast', 'Faint rings: news of a launch or founding spreading at c. Neighbours only learn of a claim once its ring reaches them.'],
  ['tech', 'Tech front', 'Bright ring in a civilisation\'s colour: a breakthrough spreading at lightspeed. Colonies sparkle as it reaches them.'],
  ['alarm', 'Alarm', 'Red ring: a system was just taken by force, or drifted into a feral strain.'],
  ['sn', 'Supernova', 'Orange front expanding at c. Lethal within 45 ly; leaves a violet remnant nebula.'],
  ['ir', 'Dyson swarm', 'Enclosed stars dim and turn deep red: the swarm re-radiates the captured light as infrared.'],
  ['dust', 'Dust / nebulae', 'Dark patches are dust lanes that destroy probes in transit. Pink and blue clouds are star-forming nebulae: rich in matter, but full of short-lived massive stars.'],
];

export const EVENT_KINDS = {
  sn: 'Supernova',
  schism: 'Schism (new civilisation)',
  war: 'Civilisation turns predatory',
  feral: 'Feral outbreak',
  extinct: 'Civilisation wiped out',
  contain: 'Feral strain wiped out',
  contact: 'First contact',
  milestone: 'Milestone',
  dyson: 'First full Dyson swarm',
  origin: 'Civilisation awakens',
  tech: 'Tech breakthrough',
};
export const DEFAULT_PAUSE_KINDS = ['schism', 'war', 'feral', 'contact', 'sn'];
