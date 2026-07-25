/**
 * Central tuning table. Units are metres and seconds unless noted.
 * Anything a designer would want to tweak lives here rather than inline.
 */

export const RACE = {
  laps: 3,                // overwritten per track when a circuit is loaded
  racerCount: 8,
  countdownSeconds: 3.6,
};

/** Multiplayer transport. */
export const NET = {
  url: 'wss://co5-game-ws.epolite.net/',
  sendHz: 20,             // kart state broadcasts per second
  timeout: 12000,         // give up on a silent socket after this long
};

export const KART = {
  // Longitudinal
  topSpeed: 52,           // m/s on tarmac (~187 km/h on the HUD)
  reverseSpeed: 13,
  accelTau: 0.55,         // how briskly speed approaches its target (1/s)
  brakeAccel: 46,
  coastDrag: 5.5,
  // Steering
  turnRate: 2.05,         // rad/s at the sweet spot
  turnSpeedFloor: 11,     // below this speed steering authority ramps in
  turnHighSpeedFalloff: 0.34,
  airTurnRate: 1.1,
  // Grip: how quickly sideways velocity bleeds off (1/s).
  // driftGrip has to stay reasonably high: too low and the kart simply washes
  // wide instead of rotating, which makes drifting slower than not drifting.
  grip: 7.0,
  driftGrip: 4.8,
  // Drift
  driftYawBias: 0.6,      // extra rad/s pulled toward the drift direction
  driftSteerInner: 1.2,   // steering multiplier when leaning into the drift
  driftSteerOuter: 0.45,
  driftMinSpeed: 16,
  hopVelocity: 5.2,
  miniTurbo: [
    { charge: 0.75, duration: 0.75, name: 'blue' },
    { charge: 1.7, duration: 1.2, name: 'orange' },
    { charge: 2.9, duration: 1.75, name: 'violet' },
  ],
  // Boost
  boostTopSpeedBonus: 21,
  boostAccel: 34,
  padBoostDuration: 1.35,
  itemBoostDuration: 1.9,
  // Vertical
  gravity: 27,
  groundSnap: 0.65,       // how far below the surface we still count as grounded
  glideGravity: 13,
  glideTerminal: 12.5,
  glideForward: 4,        // gentle forward thrust while the wing is out
  glidePitchAuthority: 4.5,
  glidePitchRange: 4.5,   // how much the pitch input shifts terminal fall speed
  glideMinAirtime: 0.26,
  glideMinHeight: 4.5,
  glideAssistMinSpeed: 28, // below this you are not owed a safe landing
  // Surfaces
  offroadSpeedMul: 0.56,
  offroadGrip: 4.0,
  offroadShake: 0.5,
  // Body
  radius: 1.35,
  length: 2.7,
  width: 1.75,
  wheelRadius: 0.44,
  // Getting hit
  spinDuration: 1.25,
  spinSpeedMul: 0.28,
  squashDuration: 1.5,
  respawnDuration: 1.6,
};

/**
 * Circuits may reshape the handling model -- ice is slithery, a long descent
 * wants a taller top gear. `applyHandling` is called once per track load and
 * always starts from the untouched baseline above.
 */
const KART_BASE = { ...KART };

export function applyHandling(overrides = {}) {
  for (const key of Object.keys(KART)) {
    if (!(key in KART_BASE)) delete KART[key];
  }
  Object.assign(KART, KART_BASE, overrides);
}

/**
 * How far a kart may stray sideways from the centreline while airborne, on top
 * of the barrier line. Karts used to be able to sail clean over the barriers on
 * a big jump and drop onto a completely different part of the circuit; the
 * corridor keeps a flight inside the course it was launched from.
 */
export const CORRIDOR = {
  airMargin: 1.4,         // extra metres beyond the barriers while flying
  gapMargin: 5.0,         // ...and while crossing a gap, where there are none
};

export const CAMERA = {
  distance: 8.2,
  height: 3.5,
  lookAhead: 7.0,
  fov: 64,
  boostFov: 78,
  stiffness: 6.5,
  airStiffness: 3.2,
};

export const ITEMS = {
  boxRespawn: 3.5,
  rocketSpeed: 78,
  rocketLife: 7,
  bombSpeed: 46,
  bombFuse: 3.2,
  bombBlastRadius: 9,
  shieldDuration: 7,
  slickLife: 22,
  empSlowDuration: 2.4,
};

/** Item pool. `weights` are indexed by normalised race position (0 = leader, 1 = last). */
export const ITEM_TABLE = [
  { id: 'boost', name: 'Turbo Cell', lead: 0.18, tail: 0.16 },
  { id: 'slick', name: 'Oil Slick', lead: 0.34, tail: 0.06 },
  { id: 'bomb', name: 'Scatter Bomb', lead: 0.26, tail: 0.16 },
  { id: 'rocket', name: 'Seeker Rocket', lead: 0.14, tail: 0.28 },
  { id: 'shield', name: 'Ion Shield', lead: 0.08, tail: 0.16 },
  { id: 'emp', name: 'Static Pulse', lead: 0.0, tail: 0.18 },
];

export const RACERS = [
  { name: 'YOU', color: 0x35d1ff, accent: 0xffffff },
  { name: 'VOLT', color: 0xffd23f, accent: 0x2b2b3a },
  { name: 'NOVA', color: 0xff4d6d, accent: 0xffe3e9 },
  { name: 'ORBIT', color: 0x7cf07c, accent: 0x134d13 },
  { name: 'HEX', color: 0xb07cff, accent: 0xf0e6ff },
  { name: 'RUST', color: 0xff8b3d, accent: 0x3a2410 },
  { name: 'ZEN', color: 0xffffff, accent: 0x3b3b4d },
  { name: 'DUSK', color: 0x2f6bff, accent: 0xcfe0ff },
];

/** Per-CPU driving personality, index 0 is unused (the player). */
export const AI_PROFILES = [
  null,
  { skill: 0.96, line: 0.0, wander: 0.9, aggression: 0.85 },
  { skill: 0.93, line: -2.4, wander: 1.5, aggression: 0.7 },
  { skill: 0.9, line: 2.6, wander: 1.3, aggression: 0.6 },
  { skill: 0.88, line: -1.2, wander: 2.1, aggression: 0.75 },
  { skill: 0.86, line: 1.8, wander: 2.4, aggression: 0.5 },
  { skill: 0.84, line: -3.0, wander: 2.0, aggression: 0.55 },
  { skill: 0.82, line: 3.2, wander: 2.6, aggression: 0.45 },
];
