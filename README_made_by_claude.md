# Sunset Ridge GP

A 3D arcade kart racer that runs in the browser. Four circuits, eight racers,
items, speed boosts, drift turbos, launch ramps, gliders — and online rooms with
a four-character code.

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

Multiplayer talks to a relay server (see below). The client points at
`wss://co5-game-ws.epolite.net/` by default; append `?ws=ws://localhost:8787` to
the page URL to aim it somewhere else.

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

## The circuits

Every circuit is a data file in `src/tracks/` — a spline, some width keyframes,
ramps, boost pads, item box rows, an optional handling override and a theme that
repaints the sky, terrain, road, scenery and weather.

| Circuit | Format | Length | About |
| --- | --- | --- | --- |
| **Sunset Ridge GP** | 3 laps | 1.6 km/lap | The original. Canyon glide, viaduct over the back straight, hairpin, kicker. |
| **Glacier Rim** | 3 laps | 2.6 km/lap | Ice. Grip is cut from 7.0 to 5.0 and the brakes are weaker, so the kart rotates easily and refuses to stop sliding. Two crevasse glides, an ice bowl, an iceberg hairpin. |
| **Verdant Hollow** | 3 laps | 2.6 km/lap | Old-growth forest, narrower than the rest. River gorge glide, fern esses, a collapsed logging bridge, waterfall hairpin. |
| **Ember Descent** | point to point | 9.0 km | Not a loop: one continuous run down a volcano from the caldera rim to the black-sand coast, losing 430 m of altitude. Three lava crossings on the wing, a taller top gear, and a long run-off past the finish line. |

The three new ones are built to take about three minutes; a CPU field runs them
in 2:57–3:20.

### Point to point

`closed: false` in a track definition changes the geometry and the rules
together: `s` clamps instead of wrapping, the road mesh is not stitched end to
end, the grid forms up behind a start line part-way into the spline, there is one
"lap", the HUD counts percentage rather than laps, and a kart that takes the flag
brakes itself so it does not run out of road.

## Staying on the course

Karts used to be able to sail over the barriers on a big jump and drop back in
somewhere else entirely — with the circuits folding over themselves, that was
worth a third of a lap. Three things now prevent it:

- **An air corridor.** Barriers stop at head height; the course does not. A
  flight is confined to the barrier line plus 1.4 m (5 m while crossing a gap,
  where there are no barriers to speak of). Leaving sideways just cancels the
  outward drift — the flight itself is untouched.
- **A sticky projection.** `Track.project` searches a window around the previous
  answer and only sweeps the whole circuit when it has genuinely lost the road.
  A kart flying over a viaduct can no longer be handed the track position of the
  road underneath it.
- **Checkpoints and a progress ceiling.** Every ~150 m there is an ordered
  checkpoint; the start/finish line only counts a lap once all of them have been
  swept, and recorded distance can never exceed "laps genuinely completed plus
  where you are right now". Reversing over a checkpoint un-ticks it, so spinning
  back across the line puts you properly on the previous lap instead of costing
  you one.

## Multiplayer

Rooms are created by a host, joined with a four-character code, and the host
picks the circuit. Everyone readies up, everyone builds the track, and the server
hands out a single start time so the countdown runs together.

The server is a **relay, not an authority** — clients are trusted:

- Each client simulates its own kart and broadcasts it 20 times a second
  (position, heading, velocity, a flag bitfield, distance and lap).
- The host also simulates the CPUs; everyone else plays them back. If the host
  leaves, the new host adopts them mid-race.
- Remote karts are dead-reckoned from the last packet and chased with an
  exponential ease, so they stay smooth at any latency.
- Hazards and projectiles are replicated by event and simulated everywhere, but
  each client only ever applies damage to karts it owns. That means no hit
  messages, no arbitration, and no way for two clients to disagree about who got
  hit — the victim always decides.

```bash
bun run server        # server/server.ts, port 8787 (PORT= to change)
```

The server is one dependency-free TypeScript file. It also runs under Node 22.6+
(`node --experimental-strip-types server/server.ts`) if `ws` is installed. The
protocol is documented at the top of the file.

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
| `src/tracks/*.js` | Circuit definitions: spline, widths, ramps, pads, item boxes, handling, theme |
| `src/track.js` | A circuit as sampled track space: arc-length sampling, banking, gaps, checkpoints, the corridor limits, and the projection from world space |
| `src/trackmesh.js` | Road, kerbs, run-off, barriers, viaduct deck, boost pads, gantries |
| `src/world.js` | Terrain derived from the track, regional elevation, canyon carving, sky, water, lava/ice chasm floors, scenery, weather |
| `src/kart.js` | Arcade physics: grip, drift, mini-turbos, ramps, gliding, respawns, progress policing, network playback |
| `src/ai.js` | CPU drivers and rubber-banding |
| `src/items.js` | Pickups, hazards and projectiles |
| `src/models.js` | Every mesh, built from primitives, plus the particle system |
| `src/textures.js` | Canvas-generated textures, themed per circuit |
| `src/hud.js` | Readouts, minimap, standings, results |
| `src/input.js` | Keyboard, gamepad and touch, normalised to one input struct |
| `src/audio.js` | Web Audio synthesis — engine, tyres, wind, impacts |
| `src/net.js` | WebSocket client and clock sync |
| `src/lobby.js` | Track select, multiplayer entry, room lobby |
| `src/main.js` | Scene, race flow, track loading/teardown, network glue |
| `src/config.js` | Every tunable number |
| `server/server.ts` | The relay server |

Three ideas do most of the heavy lifting:

**Track space.** Karts move freely in 3D, but the track can answer "where am I?"
for any world position — distance along the centreline plus a lateral offset.
Surface height, banking, lap counting, off-road detection, boost pads, AI
targeting, rocket guidance and the anti-shortcut rules all fall out of that one
query.

**Terrain derived from the road.** A coarse field carries the large-scale
elevation of the course (a 430 m descent gets a mountain under it, not a road on
stilts); near the road the sheet hugs the *lowest* nearby road elevation, so a
section that flies over another becomes a viaduct instead of burying it. Gap
sections carve downward, which is what cuts the canyons.

**Owner-authoritative networking.** Nothing is simulated twice for the same
purpose. Whoever owns a kart decides everything about it, including what hits it,
and everyone else renders the answer.

Tuning lives in `src/config.js` — top speed, grip, drift charge rates, mini-turbo
thresholds, glide physics, corridor margins, item weights and CPU personalities.
Per-circuit handling overrides sit in the track files.
