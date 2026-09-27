# Probe Aquarium

A simulation of self-replicating von Neumann probes spreading through a patch of a spiral galaxy.
Plain HTML + canvas + ES modules, no build step. Everything lives in `site/`.

**Run locally:** `cd site && python3 -m http.server` and open http://localhost:8000.

## What's simulated

- **Galaxy patch** — a few thousand stars placed along log-spiral arms, with open clusters, emission/reflection
  nebulae (star-forming regions rich in massive stars), dust lanes, and a metallicity gradient toward the galactic core.
- **Light-speed knowledge** — colonies never share state instantly. Whether a colony "knows" something is computed
  from the event's time and the distance to it (retarded time), so every decision is made on an out-of-date picture.
  Launch intents and foundings are broadcast at *c*; cooperative strains follow a "nearest visible colony has the
  right of claim" protocol. The **light-cone view** renders the galaxy exactly as one colony sees it, including
  probes at their retarded positions.
- **Economy** — each colony mines finite matter, grows industry toward a starlight-limited cap, and splits output between
  probes and a Dyson swarm. Swarms dim the star (it glows infrared), boost energy, and power research. Colonies with
  nowhere left to expand throttle mining and compute. The region can be strip-mined.
- **Research** — five tech tracks (Drive, Range, Fabrication, Fidelity, Stellar Engineering). Each colony researches
  alone; breakthroughs spread as lightspeed wavefronts through the civilisation.
- **Evolution** — replication copy errors and slow value drift change each colony's *cooperation* and *expansion*
  genes. Low-cooperation strains jump claims; below a threshold they go **feral**, pouring everything into probes and
  conquering other colonies. Cooperative colonies that *see* feral activity arm up and send hunter probes.
- **Hazards** — dust destroys probes in transit; O/B stars go supernova, and the blast front sterilises everything
  within ~45 ly as it expands at *c*, leaving enriched debris to be recolonised.

The simulation core (`site/js/sim.js`, `site/js/galaxy.js`) has no DOM dependencies and runs under Node for headless
experiments. In the browser console, `probeAquarium.sim` exposes the live state and `probeAquarium.advance(years)`
fast-forwards.

## Deploying

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on every push to `main`
(set **Settings → Pages → Source** to **GitHub Actions**).
