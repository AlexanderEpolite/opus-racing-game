/**
 * Sunset Ridge GP -- the original circuit.
 *
 * A closed 3-lap loop through a canyon at golden hour. Two glider gaps, a
 * viaduct section that flies over the back straight, and a long hairpin.
 */

export default {
  id: 'sunset',
  name: 'SUNSET RIDGE GP',
  short: 'SUNSET RIDGE',
  blurb: 'Climb the ridge, launch the canyon, glide for the landing.',
  kind: 'circuit',
  closed: true,
  laps: 3,
  scale: 1,
  tension: 0.5,

  points: [
    [0, 0, 0],        // start / finish line
    [0, 0, 85],
    [14, 2, 170],
    [58, 6, 238],     // fast right-hander
    [132, 12, 272],
    [205, 20, 258],
    [252, 28, 200],
    [262, 36, 128],   // the climb
    [244, 41, 62],    // crest -> launch ramp
    [200, 30, -2],    // (airborne over the canyon)
    [138, 18, -44],   // landing
    [62, 16, -60],
    [-18, 16, -46],   // esses -- this stretch flies over the back straight
    [-82, 11, -2],
    [-118, 7, 58],
    [-158, 5, 112],   // hairpin entry
    [-206, 4, 96],    // hairpin apex
    [-214, 3, 36],
    [-182, 2, -22],   // hairpin exit
    [-124, 1, -62],
    [-56, 0, -70],    // back straight
    [-14, 0, -42],
  ],

  widthKeys: [
    [0.0, 12.0],
    [0.1, 11.0],
    [0.22, 10.0],
    [0.36, 11.5],  // generous run-up to the ramp
    [0.41, 11.5],
    [0.49, 13.0],  // generous landing zone
    [0.55, 10.0],
    [0.6, 10.5],   // the ridge kicker
    [0.68, 9.0],
    [0.74, 8.0],   // hairpin pinches in
    [0.8, 8.5],
    [0.88, 10.5],
    [1.0, 12.0],
  ],

  ramps: [
    { s: 0.395, length: 30, height: 4.2, kick: 1.0, gap: 118, tail: 0, glider: true, name: 'canyon' },
    { s: 0.6, length: 24, height: 3.0, kick: 1.2, gap: 52, tail: 0, glider: true, name: 'ridge' },
    { s: 0.875, length: 18, height: 1.9, kick: 1.1, gap: 0, tail: 9, glider: false, name: 'kicker' },
  ],

  boostPads: [
    { s: 0.035, x: -4.5 }, { s: 0.035, x: 4.5 },
    { s: 0.065, x: 0 },
    { s: 0.2, x: -3.0 },
    { s: 0.24, x: 3.4 },
    { s: 0.52, x: 0 },                              // rewards a clean canyon landing
    { s: 0.537, x: -5.5 },
    { s: 0.665, x: 4.0 },
    { s: 0.8, x: 3.4 },                             // hairpin exit
    { s: 0.845, x: -4.0 }, { s: 0.845, x: 4.0 },
    { s: 0.935, x: 0 },
    { s: 0.972, x: -5.5 }, { s: 0.972, x: 5.5 },
  ],

  itemBoxRows: [
    { s: 0.115, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.3, xs: [-6, -2, 2, 6] },
    { s: 0.44, xs: [-6, -2, 2, 6], y: 9 },   // mid-canyon: only reachable on the wing
    { s: 0.545, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.71, xs: [-5, 0, 5] },
    { s: 0.9, xs: [-7, -3.5, 0, 3.5, 7] },
  ],

  theme: {
    sky: {
      zenith: 0x1a2352, mid: 0xc9578a, horizon: 0xffb277, ground: 0x2a2233,
      glowColor: [1.0, 0.72, 0.42], glow: 0.42, discColor: [1.0, 0.93, 0.78],
      band: [0.06, 0.03, 0.05], bandFreq: 44,
    },
    sun: { dir: [-0.42, 0.36, -0.84], color: 0xffd7ab, intensity: 2.5 },
    hemi: { sky: 0xffc9a0, ground: 0x3d3350, intensity: 1.05 },
    fill: { color: 0x8fb4ff, intensity: 0.45 },
    fog: { color: 0xd88f74, near: 340, far: 1150 },

    terrain: {
      low: 0x4b7a3a, high: 0x8a8f45, rock: 0x6b5a4c, cliff: 0x7d4f3c, shore: 0xc8b184,
      hills: 46, clearance: 3.0, canyonDepth: 62, lowBand: [4, 34],
    },
    water: { level: -20, color: 0x2a6f8f, roughness: 0.18, metalness: 0.55, opacity: 0.9 },
    chasm: null,

    road: { asphalt: '#3a3a42', noise: 34, line: '#e8e8ee', centre: 'rgba(232,232,238,0.75)' },
    kerb: { a: '#d8354a', b: '#e5e5ea' },
    shoulder: { base: '#6b5638', noise: 46, speckA: '#8a7350', speckB: '#4e3d26' },
    rail: { color: 0xd7dbe4, roughness: 0.35, metalness: 0.75 },
    deck: { color: 0x4a4a55 },
    dust: 0x9c8560,

    scenery: {
      density: 0.42,
      trunk: { color: 0x5a3f2b, top: 0.32, bottom: 0.52, height: 3.4 },
      foliage: [{ kind: 'cone', color: 0x2f6b34, radius: 2.5, height: 7.2, y: 2.8 }],
      rock: { color: 0x6e6257, radius: 1.9 },
      rockChance: 0.24,
    },
    ambient: null,

    banner: {
      words: ['SUNSET RIDGE', 'TURBO CELL', 'APEX TYRES', 'NITRO CO'],
      colors: ['#1d2b53', '#7b2d5e', '#0d5c63', '#8a3324'],
    },
    gantry: { title: 'SUNSET RIDGE GP', tint: ['#ff6b3d', '#ffd23f', '#35d1ff'] },
  },
};
