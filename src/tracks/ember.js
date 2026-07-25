/**
 * Ember Descent -- the point-to-point sprint.
 *
 * Not a circuit: one continuous 7.9 km run from the caldera rim down to the
 * black-sand coast, dropping the better part of 400 m on the way. No laps, no
 * second chances -- whatever you lose on the upper switchbacks you have to take
 * back on the lava crossings.
 *
 * `closed: false` changes how the whole track behaves: distance never wraps, the
 * grid lines up behind a start line part-way into the spline, and the run past
 * the finish line is deliberately long so a kart at 200 km/h has somewhere to go.
 */

export default {
  id: 'ember',
  name: 'EMBER DESCENT',
  short: 'EMBER DESCENT',
  blurb: 'One run, top to bottom. 7.9 km of volcano and three lava crossings.',
  kind: 'sprint',
  closed: false,
  laps: 1,
  scale: 1.02,
  tension: 0.5,

  /** Fractions of the spline: where the grid forms up and where the flag falls. */
  startLine: 0.014,
  finish: 0.967,

  points: [
    [0, 430, -1000],      // caldera rim -- the grid
    [340, 424, -960],
    [640, 410, -830],
    [860, 392, -600],     // first switchback, east face
    [900, 372, -320],
    [830, 352, -40],
    [640, 336, 190],
    [360, 322, 330],      // ash plateau
    [40, 310, 350],       // lava river #1
    [-280, 296, 270],
    [-540, 280, 90],
    [-690, 262, -170],    // west face
    [-700, 244, -460],
    [-580, 226, -720],
    [-330, 210, -880],
    [-30, 196, -910],     // obsidian flats
    [270, 180, -830],
    [520, 164, -650],
    [640, 146, -400],     // lava river #2
    [630, 128, -140],
    [500, 112, 90],
    [280, 96, 250],
    [10, 82, 310],
    [-260, 68, 250],
    [-460, 54, 90],
    [-560, 42, -140],     // lava river #3
    [-540, 30, -390],
    [-400, 20, -590],
    [-180, 12, -700],
    [70, 6, -720],        // out onto the black sand
    [300, 2, -640],
    [470, 0, -480],
    [540, 0, -280],       // finish line, then a long run-off
  ],

  widthKeys: [
    [0.0, 13.0],
    [0.05, 12.0],
    [0.15, 11.0],
    [0.22, 12.0],   // run-up to lava river #1
    [0.27, 13.5],   // landing
    [0.35, 11.5],
    [0.45, 12.0],
    [0.53, 13.5],   // landing #2
    [0.6, 11.0],
    [0.68, 10.5],
    [0.73, 12.0],
    [0.79, 14.0],   // landing #3
    [0.85, 11.5],
    [0.92, 12.0],
    [0.97, 13.0],
    [1.0, 14.0],    // run-off
  ],

  ramps: [
    { s: 0.24, length: 34, height: 4.4, kick: 1.0, gap: 130, tail: 0, glider: true, name: 'lava river' },
    { s: 0.5, length: 34, height: 4.0, kick: 1.05, gap: 120, tail: 0, glider: true, name: 'fissure' },
    { s: 0.755, length: 36, height: 4.8, kick: 1.0, gap: 150, tail: 0, glider: true, name: 'the caldera drain' },
    { s: 0.365, length: 18, height: 2.0, kick: 1.15, gap: 0, tail: 9, glider: false, name: 'ash kicker' },
    { s: 0.63, length: 18, height: 2.2, kick: 1.15, gap: 0, tail: 9, glider: false, name: 'basalt kicker' },
    { s: 0.92, length: 20, height: 2.4, kick: 1.1, gap: 0, tail: 10, glider: false, name: 'shore kicker' },
  ],

  boostPads: [
    { s: 0.02, x: -4.5 }, { s: 0.02, x: 4.5 },
    { s: 0.05, x: 0 },
    { s: 0.11, x: -3.5 },
    { s: 0.16, x: 3.5 },
    { s: 0.21, x: 0 },
    { s: 0.28, x: 0 },
    { s: 0.33, x: -4.0 },
    { s: 0.4, x: 4.0 },
    { s: 0.45, x: 0 },
    { s: 0.535, x: 0 },
    { s: 0.58, x: -4.0 },
    { s: 0.62, x: 3.5 },
    { s: 0.68, x: 0 },
    { s: 0.72, x: -4.5 },
    { s: 0.79, x: 0 },
    { s: 0.83, x: 4.0 },
    { s: 0.87, x: -4.0 },
    { s: 0.9, x: 0 },
    { s: 0.94, x: -5.0 }, { s: 0.94, x: 5.0 },
  ],

  itemBoxRows: [
    { s: 0.06, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.13, xs: [-6, -2, 2, 6] },
    { s: 0.19, xs: [-5, 0, 5] },
    { s: 0.252, xs: [-6, -2, 2, 6], y: 9 },   // strung across lava river #1
    { s: 0.31, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.38, xs: [-6, -2, 2, 6] },
    { s: 0.44, xs: [-5, 0, 5] },
    { s: 0.512, xs: [-6, -2, 2, 6], y: 8 },   // over the fissure
    { s: 0.57, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.65, xs: [-6, -2, 2, 6] },
    { s: 0.71, xs: [-5, 0, 5] },
    { s: 0.769, xs: [-6, -2, 2, 6], y: 9 },   // over the drain
    { s: 0.83, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.89, xs: [-6, -2, 2, 6] },
    { s: 0.945, xs: [-5, 0, 5] },
  ],

  // A descent wants a taller top gear; everything else is stock.
  handling: {
    topSpeed: 55,
    boostTopSpeedBonus: 22,
  },

  theme: {
    sky: {
      zenith: 0x120a16, mid: 0x5a1f28, horizon: 0xff7a3d, ground: 0x0d0709,
      glowColor: [1.0, 0.42, 0.16], glow: 0.55, discColor: [1.0, 0.74, 0.5],
      band: [0.09, 0.03, 0.02], bandFreq: 18,
    },
    sun: { dir: [0.24, 0.14, 0.96], color: 0xffb27a, intensity: 1.9 },
    hemi: { sky: 0xff9a5e, ground: 0x2a1418, intensity: 0.95 },
    fill: { color: 0xff5a2f, intensity: 0.55 },
    fog: { color: 0x53232a, near: 300, far: 1500 },

    terrain: {
      low: 0x3a3238, high: 0x4a3f42, rock: 0x2f2a2f, cliff: 0x221d22, shore: 0x6b4a3a,
      hills: 68, clearance: 3.2, canyonDepth: 72, lowBand: [10, 220],
    },
    water: {
      level: -34, color: 0xff5a1e, roughness: 0.6, metalness: 0.0, opacity: 1,
      emissive: 0xff3d0a, emissiveIntensity: 1.3,
    },
    chasm: { color: 0xff5a1e, emissive: 0xff3d0a, emissiveIntensity: 1.5, drop: 0.62 },

    road: { asphalt: '#2e2b31', noise: 28, line: '#ffb27a', centre: 'rgba(255,140,60,0.6)', cracks: '#ff5a1e' },
    kerb: { a: '#ff6a2f', b: '#1b1720' },
    shoulder: { base: '#453d44', noise: 40, speckA: '#5e535a', speckB: '#241f24' },
    rail: { color: 0x8a5a3a, roughness: 0.6, metalness: 0.45 },
    deck: { color: 0x2b262b },
    dust: 0x6b5a52,

    scenery: {
      density: 0.3,
      trunk: { color: 0x241d1f, top: 0.22, bottom: 0.5, height: 5.2 },
      foliage: [{ kind: 'cone', color: 0x1a1416, radius: 1.5, height: 3.4, y: 4.4 }],
      rock: { color: 0x2a252b, radius: 2.4 },
      rockChance: 0.55,
    },
    ambient: { kind: 'ember', color: 0xff9a4d, count: 700, size: 0.45, fall: -2.6, drift: 2.0 },

    banner: {
      words: ['EMBER DESCENT', 'MAGMA GRIP', 'ASH FILTER', 'CINDER CO'],
      colors: ['#5a1f14', '#7a3a12', '#3a1a20', '#6b2a10'],
    },
    gantry: { title: 'EMBER DESCENT', tint: ['#ff5a1e', '#ffd23f', '#ff8b3d'] },
  },
};
