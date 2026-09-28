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
- **Economy (mass-conserving)** — each system holds raw rock, a stockpile, infrastructure, Dyson swarm hardware and
  defences. Colonies mine only what they need, industry growth is built from mined matter, and probes obey the rocket
  equation (mass ratio e^(2v/v_exhaust)), so speed costs propellant. Wreckage falls back as rubble; the only losses are
  exhaust and probes destroyed in transit, the only source is supernova ejecta. `Sim.massLedger()` balances to ~1e-13.
- **Research** — five tech tracks (Drive, Range, Fabrication, Fidelity, Stellar Engineering). Each colony researches
  alone; breakthroughs spread as lightspeed wavefronts through the civilisation.
- **Evolution, schisms and war** — every colony carries loyalty (cohesion with its civ), aggression (stance toward
  other civs), expansion drive and a protocol dialect. Dialects are kept in sync with visible same-civ neighbours, so
  isolated regions drift together until they can no longer parse the parent's broadcasts and **splinter** into a new
  civilisation with its own research and founding doctrine. Claims are only intelligible within a civ. Aggressive
  strains raid other civs with heavy warships; low-loyalty strains go **feral** and prey on everyone. Colonies that
  *see* hostility (with light lag) arm up and send hunters to retake conquered systems.
- **Hazards** — dust destroys probes in transit; O/B stars go supernova, and the blast front sterilises everything
  within ~45 ly as it expands at *c*, leaving enriched debris to be recolonised.

Every stat, inspector field, tech track and map glyph has a tooltip with the rule and constants behind it
(`site/js/glossary.js`). **Auto-pause** can stop the clock and fly the camera to chosen kinds of event.

The simulation core (`site/js/sim.js`, `site/js/galaxy.js`) has no DOM dependencies and runs under Node for headless
experiments. In the browser console, `probeAquarium.sim` exposes the live state and `probeAquarium.advance(years)`
fast-forwards.

## Deploying

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on every push to `main`
(set **Settings → Pages → Source** to **GitHub Actions**).
