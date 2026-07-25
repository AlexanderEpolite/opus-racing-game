/**
 * Verdant Hollow -- the forest circuit.
 *
 * Three laps through an old-growth valley: a redwood straight, a climb onto the
 * ridge, a glider crossing of the river gorge, and a mossy descent back through
 * the trees. Narrower than the other circuits, so the tight stuff rewards a
 * driver who can chain drifts rather than lean on the boost pads.
 */

export default {
  id: 'verdant',
  name: 'VERDANT HOLLOW',
  short: 'VERDANT HOLLOW',
  blurb: 'Tight, green and blind. Chain the drifts, glide the gorge.',
  kind: 'circuit',
  closed: true,
  laps: 3,
  scale: 1.17,
  tension: 0.5,

  points: [
    [0, 0, 0],          // start / finish under the canopy
    [0, 1, 120],
    [-16, 3, 230],
    [-70, 6, 320],      // river straight
    [-160, 9, 366],
    [-260, 12, 350],
    [-330, 18, 280],
    [-352, 26, 190],    // the climb to the ridge
    [-330, 34, 100],
    [-262, 40, 40],     // gorge launch
    [-176, 44, 30],     // (airborne)
    [-96, 46, 70],      // ridge landing
    [-40, 44, 140],
    [30, 40, 180],
    [110, 34, 170],     // fern esses
    [170, 28, 110],
    [196, 22, 20],      // washed-out logging bridge
    [190, 16, -70],
    [140, 12, -140],
    [56, 9, -170],      // waterfall hairpin
    [-30, 7, -160],
    [-96, 5, -110],
    [-120, 3, -40],
  ],

  widthKeys: [
    [0.0, 11.0],
    [0.08, 10.0],
    [0.18, 9.0],
    [0.28, 9.5],
    [0.4, 11.0],    // run-up to the gorge
    [0.44, 11.0],
    [0.5, 12.5],    // landing clearing
    [0.56, 10.0],
    [0.62, 8.5],    // fern esses
    [0.68, 9.0],
    [0.74, 11.5],   // bridge landing
    [0.8, 8.5],     // waterfall hairpin
    [0.86, 9.5],
    [0.94, 10.5],
    [1.0, 11.0],
  ],

  ramps: [
    { s: 0.428, length: 28, height: 3.8, kick: 1.05, gap: 105, tail: 0, glider: true, name: 'river gorge' },
    { s: 0.702, length: 24, height: 2.6, kick: 1.2, gap: 58, tail: 0, glider: true, name: 'broken bridge' },
    { s: 0.9, length: 18, height: 2.1, kick: 1.15, gap: 0, tail: 10, glider: false, name: 'root kicker' },
  ],

  boostPads: [
    { s: 0.04, x: -4.0 }, { s: 0.04, x: 4.0 },
    { s: 0.09, x: 0 },
    { s: 0.17, x: -3.0 },
    { s: 0.25, x: 3.2 },
    { s: 0.34, x: 0 },
    { s: 0.5, x: 0 },                     // clean gorge landing
    { s: 0.53, x: -5.0 },
    { s: 0.6, x: 4.0 },
    { s: 0.655, x: -3.5 },
    { s: 0.745, x: 0 },
    { s: 0.83, x: 3.2 },                  // waterfall exit
    { s: 0.87, x: -4.0 }, { s: 0.87, x: 4.0 },
    { s: 0.945, x: 0 },
    { s: 0.98, x: -5.0 }, { s: 0.98, x: 5.0 },
  ],

  itemBoxRows: [
    { s: 0.12, xs: [-6.5, -3, 0, 3, 6.5] },
    { s: 0.29, xs: [-6, -2, 2, 6] },
    { s: 0.46, xs: [-6, -2, 2, 6], y: 8 },   // hanging over the gorge
    { s: 0.54, xs: [-6.5, -3, 0, 3, 6.5] },
    { s: 0.65, xs: [-5, 0, 5] },
    { s: 0.72, xs: [-4, 0, 4], y: 6 },       // over the broken bridge
    { s: 0.84, xs: [-6.5, -3, 0, 3, 6.5] },
    { s: 0.96, xs: [-5, 0, 5] },
  ],

  theme: {
    sky: {
      zenith: 0x24406b, mid: 0x86b6d6, horizon: 0xe4ecc6, ground: 0x1d2a1c,
      glowColor: [1.0, 0.94, 0.68], glow: 0.34, discColor: [1.0, 0.99, 0.9],
      band: [0.04, 0.05, 0.03], bandFreq: 30,
    },
    sun: { dir: [0.58, 0.42, 0.7], color: 0xfff2cf, intensity: 2.35 },
    hemi: { sky: 0xcfe8b8, ground: 0x2b3a22, intensity: 1.1 },
    fill: { color: 0x9fd0ff, intensity: 0.4 },
    fog: { color: 0xb9cf9f, near: 240, far: 860 },

    terrain: {
      low: 0x3f6b30, high: 0x5d7f35, rock: 0x6a6152, cliff: 0x574a3c, shore: 0x9c9560,
      hills: 44, clearance: 3.0, canyonDepth: 52, lowBand: [4, 30],
    },
    water: { level: -14, color: 0x2f6f5a, roughness: 0.22, metalness: 0.4, opacity: 0.92 },
    chasm: { color: 0x2f6f5f, emissive: 0x0d3a2f, emissiveIntensity: 0.15, drop: 0.7 },

    road: { asphalt: '#393f39', noise: 30, line: '#e6ecd8', centre: 'rgba(230,236,216,0.7)', moss: true },
    kerb: { a: '#3f8c46', b: '#eef2e2' },
    shoulder: { base: '#4a3b23', noise: 44, speckA: '#6b5a34', speckB: '#33291a' },
    rail: { color: 0x7a5334, roughness: 0.85, metalness: 0.05 },
    deck: { color: 0x4c4436 },
    dust: 0x7a6a44,

    scenery: {
      density: 0.72,
      trunk: { color: 0x6b4429, top: 0.42, bottom: 0.85, height: 8.5 },
      foliage: [
        { kind: 'cone', color: 0x2f6b2c, radius: 3.6, height: 11.0, y: 6.5 },
        { kind: 'cone', color: 0x3f8438, radius: 2.6, height: 7.5, y: 12.5 },
      ],
      rock: { color: 0x5f6a4a, radius: 1.7 },
      rockChance: 0.18,
      scale: 1.25,
    },
    ambient: { kind: 'leaf', color: 0xc7d86a, count: 500, size: 0.55, fall: 2.4, drift: 3.2 },

    banner: {
      words: ['VERDANT HOLLOW', 'CANOPY RUN', 'MOSS TREAD', 'TIMBER CO'],
      colors: ['#1f4023', '#3d5a1e', '#14484a', '#5a3a1c'],
    },
    gantry: { title: 'VERDANT HOLLOW', tint: ['#7cf07c', '#ffe98a', '#35d1ff'] },
  },
};
