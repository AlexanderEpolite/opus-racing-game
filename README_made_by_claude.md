# Sunset Ridge GP

A 3D arcade kart racer that runs in the browser. Three laps, eight racers, items,
speed boosts, drift turbos, launch ramps and a glider across a canyon.

Built with [Three.js](https://threejs.org) and plain ES modules — no build step,
no bundler, no framework, and no binary assets. Every texture, mesh and sound is
generated procedurally at load time.

## Running it

ES modules can't be loaded over `file://`, so serve the directory:

```bash
npm start          # python3 -m http.server 8080
# or
npx serve -l 8080 .
```

Then open <http://localhost:8080>.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | `W` / `↑` | Right trigger or `A` |
| Brake / reverse | `S` / `↓` | Left trigger |
| Steer | `A` `D` / `←` `→` | Left stick / D-pad |
| Hop & drift | `Space` or `Shift` | `B` / right bumper |
| Use item | `E`, `Ctrl` or `Enter` | `X` / left bumper |
| Look behind | `C` | `Y` |
| Respawn | `R` | — |
| Pause · Mute | `P` · `M` | — |

On-screen buttons appear automatically on touch devices.

**Drifting** is where the speed is. Hold the drift key through a corner while
steering; the sparks go blue → orange → violet, and releasing gives you a boost
sized to how long you held it. Leaning into the drift tightens it, countersteering
opens it out.

**Gliding** happens automatically after a ramp marked with a glider. While the
wing is out, `S` pulls the nose up to stay airborne longer and `W` dives to trade
altitude for speed.

**Rocket start**: squeeze the throttle just as the countdown hits GO. Too early
and you get nothing.

## The circuit

1,582 m, climbing from sea level to 41 m and back.

- A long start straight lined with boost pads
- A fast right-hander climbing the ridge
- **The canyon** — launch off the summit, the wing opens, and you glide 118 m of
  missing road with the sea a long way below. There is a row of item boxes
  floating out there that can only be collected on the wing.
- A second, shorter glide across a ravine in the fast esses
- A viaduct where the esses fly 16 m over the back straight
- A tight hairpin, then a kicker ramp on the run home

## Items

Weighted by race position, so trailing badly gets you better weapons.

| Item | Effect |
| --- | --- |
| Turbo Cell | Instant speed burst |
| Oil Slick | Dropped behind you; spins out whoever hits it |
| Scatter Bomb | Lobbed forward, explodes on contact with a blast radius |
| Seeker Rocket | Guided along the track toward the racer ahead |
| Ion Shield | Absorbs one hit, then breaks |
| Static Pulse | Slows every racer currently ahead of you |

## How it's put together

| File | Role |
| --- | --- |
| `src/track.js` | The circuit as a closed spline: arc-length sampling, banking, ramps, gaps, and the projection that maps world positions into track space |
| `src/trackmesh.js` | Road, kerbs, run-off, barriers, viaduct deck, boost pads, gantry |
| `src/world.js` | Terrain derived from the track, canyon carving, sky, water, scenery |
| `src/kart.js` | Arcade physics: grip, drift, mini-turbos, ramps, gliding, respawns |
| `src/ai.js` | CPU drivers and rubber-banding |
| `src/items.js` | Pickups, hazards and projectiles |
| `src/models.js` | Every mesh, built from primitives, plus the particle system |
| `src/textures.js` | Canvas-generated textures |
| `src/hud.js` | Readouts, minimap, standings, results |
| `src/input.js` | Keyboard, gamepad and touch, normalised to one input struct |
| `src/audio.js` | Web Audio synthesis — engine, tyres, wind, impacts |
| `src/config.js` | Every tunable number |

Two ideas do most of the heavy lifting:

**Track space.** Karts move freely in 3D, but the track can answer "where am I?"
for any world position — distance along the centreline plus a lateral offset.
Surface height, banking, lap counting, off-road detection, boost pads, AI
targeting and rocket guidance all fall out of that one query.

**Terrain derived from the road.** The heightfield hugs the *lowest* nearby road
elevation and relaxes into hills further out, so a section that flies over another
becomes a viaduct instead of burying it. Gap sections carve downward instead,
which is what cuts the canyon.

Tuning lives in `src/config.js` — top speed, grip, drift charge rates, mini-turbo
thresholds, glide physics, item weights and CPU personalities.
