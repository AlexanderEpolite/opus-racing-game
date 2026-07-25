import * as THREE from 'three';

/**
 * Sunset Ridge GP.
 *
 * The circuit is a closed Catmull-Rom spline resampled at uniform arc length.
 * Everything else (road mesh, AI targets, lap counting, surface height, item
 * placement) is expressed in "track space": a distance `s` along the centreline
 * plus a lateral offset `x`. Karts still move freely in world space -- they just
 * ask the track where the ground is.
 */

const CONTROL_POINTS = [
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
];

/** Half-width keyframes: [fraction of lap, half width in metres]. */
const WIDTH_KEYS = [
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
];

/**
 * Launch ramps. `s` is the fraction of the lap where the ramp begins; `gap` is
 * how many metres of missing road that follow the lip. A ramp with `glider: true`
 * pops the wing open on the way up. `tail` is how quickly the road drops back to
 * grade after the lip when there is no gap.
 */
const RAMPS = [
  // The headline jump: launch off the summit and glide the canyon.
  { s: 0.395, length: 30, height: 4.2, kick: 1.0, gap: 118, tail: 0, glider: true, name: 'canyon' },
  // A shorter glide across a ravine in the fast esses.
  { s: 0.6, length: 24, height: 3.0, kick: 1.2, gap: 52, tail: 0, glider: true, name: 'ridge' },
  // Pure kicker on the run home -- no gap, just air.
  { s: 0.875, length: 18, height: 1.9, kick: 1.1, gap: 0, tail: 9, glider: false, name: 'kicker' },
];

/** Boost pads: `s` fraction and lateral offset. */
const BOOST_PADS = [
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
];

/** Item boxes, laid out in rows across the road. `y` floats a row above grade. */
const ITEM_BOX_ROWS = [
  { s: 0.115, xs: [-7, -3.5, 0, 3.5, 7] },
  { s: 0.3, xs: [-6, -2, 2, 6] },
  { s: 0.44, xs: [-6, -2, 2, 6], y: 9 },   // mid-canyon: only reachable on the wing
  { s: 0.545, xs: [-7, -3.5, 0, 3.5, 7] },
  { s: 0.71, xs: [-5, 0, 5] },
  { s: 0.9, xs: [-7, -3.5, 0, 3.5, 7] },
];

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_COUNT = 1400;

function smoothstep(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function sampleKeys(keys, f) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, va] = keys[i];
    const [b, vb] = keys[i + 1];
    if (f >= a && f <= b) return va + (vb - va) * smoothstep((f - a) / (b - a));
  }
  return keys[keys.length - 1][1];
}

export class Track {
  constructor() {
    const pts = CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    this._buildSamples();
    this._buildFeatures();
  }

  // ---------------------------------------------------------------- sampling

  _buildSamples() {
    // Dense pass in curve parameter space, then resample by arc length so that
    // sample index maps linearly to distance travelled.
    const DENSE = SAMPLE_COUNT * 6;
    const dense = [];
    const cum = [0];
    let total = 0;
    let prev = this.curve.getPoint(0);
    dense.push(prev.clone());
    for (let i = 1; i <= DENSE; i++) {
      const p = this.curve.getPoint(i / DENSE);
      total += p.distanceTo(prev);
      dense.push(p.clone());
      cum.push(total);
      prev = p;
    }

    this.length = total;
    this.sampleCount = SAMPLE_COUNT;
    this.sampleSpacing = total / SAMPLE_COUNT;

    const positions = new Array(SAMPLE_COUNT);
    let cursor = 0;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const target = (i / SAMPLE_COUNT) * total;
      while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor++;
      const seg = cum[cursor + 1] - cum[cursor] || 1e-6;
      const t = (target - cum[cursor]) / seg;
      positions[i] = dense[cursor].clone().lerp(dense[cursor + 1], t);
    }

    this.positions = positions;
    this.tangents = new Array(SAMPLE_COUNT);
    this.rights = new Array(SAMPLE_COUNT);
    this.normals = new Array(SAMPLE_COUNT);
    this.halfWidth = new Float32Array(SAMPLE_COUNT);
    this.bank = new Float32Array(SAMPLE_COUNT);
    this.curvature = new Float32Array(SAMPLE_COUNT);

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const a = positions[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
      const b = positions[(i + 1) % SAMPLE_COUNT];
      this.tangents[i] = b.clone().sub(a).normalize();
      this.halfWidth[i] = sampleKeys(WIDTH_KEYS, i / SAMPLE_COUNT);
    }

    // Signed curvature from the turn rate of the (horizontal) tangent.
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const t0 = this.tangents[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
      const t1 = this.tangents[(i + 1) % SAMPLE_COUNT];
      const a0 = Math.atan2(t0.x, t0.z);
      const a1 = Math.atan2(t1.x, t1.z);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curvature[i] = d / (2 * this.sampleSpacing);
    }
    this._smooth(this.curvature, 6, 3);

    // Bank into the corner, proportional to curvature.
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      this.bank[i] = THREE.MathUtils.clamp(this.curvature[i] * 22, -0.3, 0.3);
    }
    this._smooth(this.bank, 14, 4);

    // Build banked frames.
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const t = this.tangents[i];
      const r = new THREE.Vector3().crossVectors(t, UP).normalize();
      const n = new THREE.Vector3().crossVectors(r, t).normalize();
      const b = this.bank[i];
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      this.rights[i] = r.clone().multiplyScalar(cb).addScaledVector(n, sb).normalize();
      this.normals[i] = n.clone().multiplyScalar(cb).addScaledVector(r, -sb).normalize();
    }

    // Coarse index for the global fallback in project().
    this.coarseStride = 14;
  }

  _smooth(arr, radius, passes) {
    const n = arr.length;
    for (let p = 0; p < passes; p++) {
      const copy = arr.slice();
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          sum += copy[(i + k + n * 4) % n];
          count++;
        }
        arr[i] = sum / count;
      }
    }
  }

  // ---------------------------------------------------------------- features

  _buildFeatures() {
    const L = this.length;

    this.ramps = RAMPS.map((r) => {
      const start = r.s * L;
      const end = start + r.length;
      return {
        ...r,
        start,
        end,
        gapStart: end,
        gapEnd: end + r.gap,
        slope: (2 * r.height) / r.length, // d/dt of h*t^2 at the lip
      };
    });

    this.gaps = this.ramps
      .filter((r) => r.gap > 0)
      .map((r) => ({ start: r.gapStart, end: r.gapEnd, ramp: r }));

    // Per-sample ramp height, precomputed so surface queries stay cheap.
    this.rampHeight = new Float32Array(this.sampleCount);
    this.isGapSample = new Uint8Array(this.sampleCount);
    for (let i = 0; i < this.sampleCount; i++) {
      const s = i * this.sampleSpacing;
      this.rampHeight[i] = this.rampHeightAt(s);
      this.isGapSample[i] = this.inGap(s) ? 1 : 0;
    }

    this.boostPads = BOOST_PADS.map((p) => ({
      s: p.s * L,
      x: p.x,
      halfWidth: 2.6,
      halfLength: 3.2,
    }));

    this.itemBoxes = [];
    for (const row of ITEM_BOX_ROWS) {
      for (const x of row.xs) {
        this.itemBoxes.push({ s: row.s * L, x, y: row.y || 0 });
      }
    }

    // Where a kart that falls off should reappear: the last on-road point.
    this.finishLineS = 0;
  }

  rampHeightAt(s) {
    for (const r of this.ramps) {
      if (s >= r.start && s <= r.end) {
        // h * t^2 so the slope is steepest right at the lip.
        const t = (s - r.start) / r.length;
        return r.height * t * t;
      }
      if (r.tail > 0 && s > r.end && s < r.end + r.tail) {
        return r.height * (1 - smoothstep((s - r.end) / r.tail));
      }
    }
    return 0;
  }

  /**
   * Invisible floor that keeps a committed launch from dropping into a gap.
   * Karts that hit the lip fast enough are guaranteed to reach the far side;
   * anyone crawling over it (below `minLaunchSpeed`) still takes the plunge.
   */
  glideFloor(s) {
    const g = this.gapAt(s);
    if (!g) return -Infinity;
    const t = THREE.MathUtils.clamp((s - g.start) / (g.end - g.start), 0, 1);
    const lipY = this.frameAt(g.start).position.y;
    const landY = this.frameAt(g.end).position.y;
    // Sag slightly in the middle so the assist reads as a glide, not a rail.
    const sag = Math.sin(t * Math.PI) * 2.5;
    return lipY + (landY - lipY) * t - sag + 1.6;
  }

  inGap(s) {
    for (const g of this.gaps) {
      if (s > g.start && s < g.end) return true;
    }
    return false;
  }

  /** The gap a kart is currently flying over, if any. */
  gapAt(s) {
    for (const g of this.gaps) {
      if (s > g.start - 4 && s < g.end + 4) return g;
    }
    return null;
  }

  /** The ramp whose lip sits just ahead of `s`, within `range` metres. */
  rampAhead(s, range) {
    for (const r of this.ramps) {
      const d = this.wrapDelta(r.end - s);
      if (d >= -1 && d <= range) return r;
    }
    return null;
  }

  // ------------------------------------------------------------- track space

  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Shortest signed distance from 0, i.e. maps into [-L/2, L/2). */
  wrapDelta(d) {
    const L = this.length;
    d = ((d % L) + L) % L;
    return d > L / 2 ? d - L : d;
  }

  indexAt(s) {
    const i = Math.floor(this.wrap(s) / this.sampleSpacing);
    return Math.min(this.sampleCount - 1, Math.max(0, i));
  }

  /**
   * Interpolated centreline frame at distance `s`.
   * Reuses `out` to avoid churning allocations in the hot loop.
   */
  frameAt(s, out = null) {
    const f = this.wrap(s) / this.sampleSpacing;
    const i0 = Math.floor(f) % this.sampleCount;
    const i1 = (i0 + 1) % this.sampleCount;
    const t = f - Math.floor(f);

    const o = out || {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      halfWidth: 0,
      curvature: 0,
    };
    o.position.copy(this.positions[i0]).lerp(this.positions[i1], t);
    o.position.y += this.rampHeight[i0] + (this.rampHeight[i1] - this.rampHeight[i0]) * t;
    o.tangent.copy(this.tangents[i0]).lerp(this.tangents[i1], t).normalize();
    o.right.copy(this.rights[i0]).lerp(this.rights[i1], t).normalize();
    o.normal.copy(this.normals[i0]).lerp(this.normals[i1], t).normalize();
    o.halfWidth = this.halfWidth[i0] + (this.halfWidth[i1] - this.halfWidth[i0]) * t;
    o.curvature = this.curvature[i0] + (this.curvature[i1] - this.curvature[i0]) * t;
    return o;
  }

  /** World position of the road surface at (s, lateral). */
  surfacePoint(s, x, out = new THREE.Vector3()) {
    const f = this._scratchFrame || (this._scratchFrame = this.frameAt(0));
    this.frameAt(s, f);
    return out.copy(f.position).addScaledVector(f.right, x);
  }

  /**
   * Closest point on the centreline to `worldPos`.
   * `hint` is the previous sample index; a local window search around it keeps
   * this O(1) per frame. A coarse global sweep guards against teleports and
   * against sections of track that fold back near each other.
   */
  project(worldPos, hint = -1, out = {}) {
    const n = this.sampleCount;
    let best = -1;
    let bestDist = Infinity;

    if (hint >= 0) {
      const W = 46;
      for (let k = -W; k <= W; k++) {
        const i = (hint + k + n * 2) % n;
        const d = this.positions[i].distanceToSquared(worldPos);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }

    // Coarse global pass; only overrides the local result if it is clearly better.
    let gBest = -1;
    let gDist = Infinity;
    for (let i = 0; i < n; i += this.coarseStride) {
      const d = this.positions[i].distanceToSquared(worldPos);
      if (d < gDist) {
        gDist = d;
        gBest = i;
      }
    }
    if (best < 0 || gDist < bestDist * 0.6) {
      // Refine around the coarse winner.
      for (let k = -this.coarseStride; k <= this.coarseStride; k++) {
        const i = (gBest + k + n * 2) % n;
        const d = this.positions[i].distanceToSquared(worldPos);
        if (d < gDist) {
          gDist = d;
          gBest = i;
        }
      }
      if (gDist < bestDist) {
        best = gBest;
        bestDist = gDist;
      }
    }

    // Sub-sample refinement: project onto the segment straddling `best`.
    const prev = this.positions[(best - 1 + n) % n];
    const next = this.positions[(best + 1) % n];
    const here = this.positions[best];
    let offset = 0;
    const segA = here.clone().sub(prev);
    const segB = next.clone().sub(here);
    const relA = worldPos.clone().sub(prev);
    const relB = worldPos.clone().sub(here);
    const tA = THREE.MathUtils.clamp(relA.dot(segA) / (segA.lengthSq() || 1), 0, 1);
    const tB = THREE.MathUtils.clamp(relB.dot(segB) / (segB.lengthSq() || 1), 0, 1);
    const pA = prev.clone().addScaledVector(segA, tA);
    const pB = here.clone().addScaledVector(segB, tB);
    if (pA.distanceToSquared(worldPos) < pB.distanceToSquared(worldPos)) {
      offset = tA - 1;
    } else {
      offset = tB;
    }

    // Each caller keeps its own frame: handing out a shared one would mean a
    // kart's `proj.frame` silently changed the moment anything else projected.
    const s = this.wrap((best + offset) * this.sampleSpacing);
    if (!out.frame) out.frame = this.frameAt(0);
    const frame = this.frameAt(s, out.frame);
    const rel = worldPos.clone().sub(frame.position);
    out.s = s;
    out.index = best;
    out.lateral = rel.dot(frame.right);
    out.height = rel.dot(frame.normal);
    out.halfWidth = frame.halfWidth;
    out.frame = frame;
    return out;
  }

  /**
   * Ground height (and normal) beneath a world position.
   * Returns null when the position is over a gap -- there is nothing to stand on.
   */
  surfaceAt(worldPos, proj) {
    if (this.inGap(proj.s)) return null;
    // Well past the barriers there is no road to stand on -- anything that got
    // out there (over a barrier on a big jump) should fall and be recovered
    // rather than slide along an imaginary extension of the banked surface.
    if (Math.abs(proj.lateral) > this.wallLimit(proj.halfWidth) + 6) return null;
    const frame = proj.frame;
    const p = frame.position.clone().addScaledVector(frame.right, proj.lateral);
    return { y: p.y, normal: frame.normal };
  }

  shoulderWidth() {
    return 3.6;
  }

  /** Widest lateral offset before hitting the barrier. */
  wallLimit(halfWidth) {
    return halfWidth + this.shoulderWidth();
  }

  /** A safe respawn point for a kart that fell: back up to solid road. */
  respawnPoint(s) {
    let target = this.wrap(s);
    for (const g of this.gaps) {
      if (target > g.start - 6 && target < g.end + 12) {
        target = this.wrap(g.end + 16);
      }
    }
    // Never respawn on a ramp face.
    for (const r of this.ramps) {
      if (target > r.start - 6 && target < r.end + 2) target = this.wrap(r.start - 24);
    }
    return target;
  }
}
