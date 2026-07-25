/**
 * Glacier Rim -- the ice circuit.
 *
 * A long, slippery 3-lap loop that starts on a frozen lake, climbs onto the
 * glacier, jumps two crevasses on the wing and swings around a stranded iceberg
 * on the way home. Grip is deliberately low: the kart rotates easily but takes
 * far longer to stop washing wide, so smooth lines beat stabbing at the wheel.
 */

export default {
  id: 'glacier',
  name: 'GLACIER RIM',
  short: 'GLACIER RIM',
  blurb: 'Low grip, high walls of ice. Two crevasses, one long lake straight.',
  kind: 'circuit',
  closed: true,
  laps: 3,
  scale: 1.15,
  tension: 0.5,

  points: [
    [0, 0, 0],          // start / finish, out on the frozen lake
    [0, 0, 140],
    [8, 1, 260],
    [46, 3, 350],       // lake sweeper
    [130, 6, 410],
    [230, 9, 420],
    [318, 14, 380],     // onto the glacier shelf
    [372, 22, 300],
    [392, 32, 210],     // the climb
    [378, 44, 120],     // crest -> crevasse launch
    [330, 42, 40],      // (airborne)
    [262, 36, -20],     // landing shelf
    [176, 32, -52],
    [86, 30, -40],      // the ice bowl
    [20, 28, 20],
    [-56, 24, 60],
    [-150, 20, 58],     // collapsed ice bridge
    [-238, 16, 20],
    [-282, 12, -60],    // iceberg hairpin
    [-248, 9, -140],
    [-160, 6, -176],
    [-70, 3, -160],
    [-16, 1, -92],
  ],

  widthKeys: [
    [0.0, 12.5],
    [0.1, 11.5],
    [0.2, 10.5],
    [0.3, 11.0],
    [0.38, 12.0],   // run-up to the crevasse
    [0.42, 12.0],
    [0.47, 13.5],   // landing shelf
    [0.55, 12.0],
    [0.62, 13.0],   // the bowl opens out
    [0.7, 11.0],
    [0.75, 12.0],
    [0.79, 9.5],    // iceberg hairpin pinches in
    [0.85, 10.5],
    [0.93, 11.5],
    [1.0, 12.5],
  ],

  ramps: [
    { s: 0.405, length: 32, height: 4.6, kick: 1.0, gap: 120, tail: 0, glider: true, name: 'crevasse' },
    { s: 0.712, length: 26, height: 3.2, kick: 1.15, gap: 62, tail: 0, glider: true, name: 'ice bridge' },
    { s: 0.925, length: 18, height: 2.0, kick: 1.1, gap: 0, tail: 9, glider: false, name: 'moraine kicker' },
  ],

  boostPads: [
    { s: 0.03, x: -4.5 }, { s: 0.03, x: 4.5 },
    { s: 0.06, x: 0 },
    { s: 0.15, x: -3.0 },
    { s: 0.22, x: 3.5 },
    { s: 0.31, x: 0 },
    { s: 0.48, x: 0 },                    // reward for a clean crevasse landing
    { s: 0.5, x: -5.0 },
    { s: 0.6, x: 4.0 },
    { s: 0.66, x: -3.5 },
    { s: 0.757, x: 0 },
    { s: 0.82, x: 3.4 },                  // hairpin exit
    { s: 0.86, x: -4.0 }, { s: 0.86, x: 4.0 },
    { s: 0.955, x: 0 },
    { s: 0.985, x: -5.5 }, { s: 0.985, x: 5.5 },
  ],

  itemBoxRows: [
    { s: 0.1, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.26, xs: [-6, -2, 2, 6] },
    { s: 0.44, xs: [-6, -2, 2, 6], y: 9 },   // strung across the crevasse
    { s: 0.52, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.64, xs: [-6, 0, 6] },
    { s: 0.732, xs: [-4, 0, 4], y: 7 },      // over the broken bridge
    { s: 0.86, xs: [-7, -3.5, 0, 3.5, 7] },
    { s: 0.97, xs: [-5, 0, 5] },
  ],

  // Ice: the kart still turns, it just refuses to stop sliding.
  handling: {
    grip: 5.0,
    driftGrip: 3.7,
    turnRate: 1.95,
    offroadSpeedMul: 0.5,     // deep snow
    offroadGrip: 3.2,
    brakeAccel: 34,
  },

  theme: {
    sky: {
      zenith: 0x061431, mid: 0x2f6f9e, horizon: 0xcfe9f5, ground: 0x16283a,
      glowColor: [0.62, 0.86, 1.0], glow: 0.3, discColor: [0.9, 0.97, 1.0],
      band: [0.05, 0.14, 0.1], bandFreq: 26,
    },
    sun: { dir: [0.38, 0.24, -0.89], color: 0xeaf6ff, intensity: 2.15 },
    hemi: { sky: 0xdff2ff, ground: 0x3a5670, intensity: 1.2 },
    fill: { color: 0x7fb0ff, intensity: 0.5 },
    fog: { color: 0xbcd8e8, near: 280, far: 980 },

    terrain: {
      low: 0xe4eff8, high: 0xf2f8ff, rock: 0x5d6b78, cliff: 0x46545f, shore: 0xa9cbe0,
      hills: 54, clearance: 2.8, canyonDepth: 56, lowBand: [6, 40],
    },
    water: { level: -16, color: 0x9fd4ef, roughness: 0.3, metalness: 0.3, opacity: 1 },
    chasm: { color: 0x74b8de, emissive: 0x2a6f9e, emissiveIntensity: 0.35, drop: 0.55 },

    road: { asphalt: '#4b5866', noise: 26, line: '#f2f8ff', centre: 'rgba(200,230,255,0.7)', frost: true },
    kerb: { a: '#2f6f9e', b: '#eef7ff' },
    shoulder: { base: '#d3e3ef', noise: 22, speckA: '#ffffff', speckB: '#a8c4d6' },
    rail: { color: 0xbcd8e8, roughness: 0.25, metalness: 0.5 },
    deck: { color: 0x5c6b7a },
    dust: 0xdff0ff,

    scenery: {
      density: 0.5,
      trunk: { color: 0x4a3b32, top: 0.3, bottom: 0.46, height: 3.0 },
      foliage: [
        { kind: 'cone', color: 0x1f4a3c, radius: 2.4, height: 7.0, y: 2.6 },
        { kind: 'cone', color: 0xeaf6ff, radius: 1.9, height: 4.4, y: 5.6 },
      ],
      rock: { color: 0xa8cade, radius: 2.1 },
      rockChance: 0.3,
    },
    ambient: { kind: 'snow', color: 0xffffff, count: 900, size: 0.5, fall: 5.5, drift: 2.4 },

    banner: {
      words: ['GLACIER RIM', 'POLAR TREAD', 'ION SHIELD', 'CRYO FUEL'],
      colors: ['#123a5e', '#2b6f7b', '#3d4f7a', '#1b4f4f'],
    },
    gantry: { title: 'GLACIER RIM', tint: ['#9fe8ff', '#ffffff', '#5fa8ff'] },
  },
};
