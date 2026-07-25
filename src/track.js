import * as THREE from 'three';
import { CORRIDOR } from './config.js';

/**
 * A circuit, built from a plain data definition (see src/tracks/).
 *
 * The centreline is a Catmull-Rom spline resampled at uniform arc length.
 * Everything else (road mesh, AI targets, lap counting, surface height, item
 * placement) is expressed in "track space": a distance `s` along the centreline
 * plus a lateral offset `x`. Karts still move freely in world space -- they just
 * ask the track where the ground is.
 *
 * Tracks come in two shapes:
 *   closed: true   a lap circuit; `s` wraps and distance accumulates over laps.
 *   closed: false  a point-to-point sprint; `s` is clamped, there is exactly one
 *                  "lap", and the start/finish lines sit at fixed distances into
 *                  the spline so there is road either side of them.
 */

const UP = new THREE.Vector3(0, 1, 0);
const TARGET_SPACING = 1.25;   // metres between centreline samples
const MIN_SAMPLES = 500;
const MAX_SAMPLES = 7000;
const LOST_DISTANCE = 70;      // beyond this we assume the projection hint is stale

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
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.theme = def.theme;
    this.closed = def.closed !== false;
    this.laps = this.closed ? def.laps || 3 : 1;

    const scale = def.scale ?? 1;
    const pts = def.points.map(([x, y, z]) => new THREE.Vector3(x * scale, y, z * scale));
    this.curve = new THREE.CatmullRomCurve3(pts, this.closed, 'catmullrom', def.tension ?? 0.5);

    this._buildSamples();
    this._buildFeatures();
  }

  // ---------------------------------------------------------------- sampling

  _buildSamples() {
    // Dense pass in curve parameter space, then resample by arc length so that
    // sample index maps linearly to distance travelled.
    const probe = this.curve.getLength();
    const count = THREE.MathUtils.clamp(
      Math.round(probe / TARGET_SPACING), MIN_SAMPLES, MAX_SAMPLES
    );
    const DENSE = count * 6;
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
    this.sampleCount = count;
    // A closed track's last sample wraps back onto the first; an open one has to
    // put a sample *on* each end, so the spacing denominator differs.
    this.sampleSpacing = total / (this.closed ? count : count - 1);
    this.searchWindow = Math.ceil(70 / this.sampleSpacing);

    const positions = new Array(count);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      const target = i * this.sampleSpacing;
      while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor++;
      const seg = cum[cursor + 1] - cum[cursor] || 1e-6;
      const t = (target - cum[cursor]) / seg;
      positions[i] = dense[cursor].clone().lerp(dense[cursor + 1], t);
    }

    this.positions = positions;
    this.tangents = new Array(count);
    this.rights = new Array(count);
    this.normals = new Array(count);
    this.halfWidth = new Float32Array(count);
    this.bank = new Float32Array(count);
    this.curvature = new Float32Array(count);

    const widthKeys = this.def.widthKeys;
    for (let i = 0; i < count; i++) {
      const a = positions[this.clampIndex(i - 1)];
      const b = positions[this.clampIndex(i + 1)];
      this.tangents[i] = b.clone().sub(a).normalize();
      this.halfWidth[i] = sampleKeys(widthKeys, i / (count - (this.closed ? 0 : 1)));
    }

    // Signed curvature from the turn rate of the (horizontal) tangent.
    for (let i = 0; i < count; i++) {
      const t0 = this.tangents[this.clampIndex(i - 1)];
      const t1 = this.tangents[this.clampIndex(i + 1)];
      const a0 = Math.atan2(t0.x, t0.z);
      const a1 = Math.atan2(t1.x, t1.z);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curvature[i] = d / (2 * this.sampleSpacing);
    }
    this._smooth(this.curvature, 6, 3);

    // Bank into the corner, proportional to curvature.
    for (let i = 0; i < count; i++) {
      this.bank[i] = THREE.MathUtils.clamp(this.curvature[i] * 22, -0.3, 0.3);
    }
    this._smooth(this.bank, 14, 4);

    // Build banked frames.
    for (let i = 0; i < count; i++) {
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
    this.coarseStride = Math.max(8, Math.round(18 / this.sampleSpacing));
  }

  /** Neighbour lookup: wraps on a circuit, clamps at the ends of a sprint. */
  clampIndex(i) {
    const n = this.sampleCount;
    if (this.closed) return ((i % n) + n) % n;
    return Math.min(n - 1, Math.max(0, i));
  }

  _smooth(arr, radius, passes) {
    const n = arr.length;
    for (let p = 0; p < passes; p++) {
      const copy = arr.slice();
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          sum += copy[this.clampIndex(i + k)];
          count++;
        }
        arr[i] = sum / count;
      }
    }
  }

  // ---------------------------------------------------------------- features

  _buildFeatures() {
    const L = this.length;
    const def = this.def;

    this.startLineS = this.closed ? 0 : (def.startLine ?? 0.02) * L;
    this.finishS = this.closed ? 0 : (def.finish ?? 0.96) * L;
    this.raceDistance = this.closed ? L * this.laps : this.finishS;

    this.ramps = def.ramps.map((r) => {
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

    this.boostPads = def.boostPads.map((p) => ({
      s: p.s * L,
      x: p.x,
      halfWidth: 2.6,
      halfLength: 3.2,
    }));

    this.itemBoxes = [];
    for (const row of def.itemBoxRows) {
      for (const x of row.xs) {
        this.itemBoxes.push({ s: row.s * L, x, y: row.y || 0 });
      }
    }

    // Ordered checkpoints. A lap only counts once a kart has been past every
    // one of them in sequence, which is what stops anybody from re-joining the
    // circuit further along and claiming the distance.
    const cpCount = Math.max(10, Math.round(L / 150));
    this.checkpoints = new Float64Array(cpCount);
    for (let i = 0; i < cpCount; i++) {
      this.checkpoints[i] = this.closed
        ? (i / cpCount) * L
        : this.startLineS + (i / cpCount) * (this.finishS - this.startLineS);
    }
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
    if (!this.closed) return THREE.MathUtils.clamp(s, 0, L - 1e-4);
    return ((s % L) + L) % L;
  }

  /** Shortest signed distance from 0, i.e. maps into [-L/2, L/2) on a circuit. */
  wrapDelta(d) {
    if (!this.closed) return d;
    const L = this.length;
    d = ((d % L) + L) % L;
    return d > L / 2 ? d - L : d;
  }

  indexAt(s) {
    const i = Math.floor(this.wrap(s) / this.sampleSpacing);
    return Math.min(this.sampleCount - 1, Math.max(0, i));
  }

  /** Distance credited to a kart sitting at `s` at the start of the race. */
  distanceAt(s) {
    if (!this.closed) return s;
    // Grid slots sit behind the line, so lap 1 completes on the first crossing.
    return s > this.length * 0.5 ? s - this.length : s;
  }

  /** Grid position for the given slot (0 = pole). */
  gridSlot(slot) {
    const row = Math.floor(slot / 2);
    const s = this.wrap(this.startLineS - (9 + row * 8.5));
    return { s, lateral: slot % 2 === 0 ? -4.6 : 4.6 };
  }

  /**
   * Interpolated centreline frame at distance `s`.
   * Reuses `out` to avoid churning allocations in the hot loop.
   */
  frameAt(s, out = null) {
    const n = this.sampleCount;
    const f = this.wrap(s) / this.sampleSpacing;
    let i0 = Math.floor(f);
    let i1;
    if (this.closed) {
      i0 = ((i0 % n) + n) % n;
      i1 = (i0 + 1) % n;
    } else {
      i0 = Math.min(n - 2, Math.max(0, i0));
      i1 = i0 + 1;
    }
    const t = THREE.MathUtils.clamp(f - Math.floor(f), 0, 1);

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
   *
   * `hint` is the previous sample index; a local window search around it keeps
   * this O(1) per frame *and* keeps the answer continuous. That continuity
   * matters as much as the speed: several circuits fly over themselves, and a
   * projection that snapped to whatever deck happened to be nearest in 3D would
   * hand a kart in mid-air the track position of the road underneath it. The
   * global sweep is therefore only consulted when the local window has clearly
   * lost the road (a teleport, a respawn, or a very long fall).
   */
  project(worldPos, hint = -1, out = {}) {
    const n = this.sampleCount;
    let best = -1;
    let bestDist = Infinity;

    if (hint >= 0) {
      const W = this.searchWindow;
      for (let k = -W; k <= W; k++) {
        const i = this.clampIndex(hint + k);
        const d = this.positions[i].distanceToSquared(worldPos);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }

    if (best < 0 || bestDist > LOST_DISTANCE * LOST_DISTANCE) {
      let gBest = -1;
      let gDist = Infinity;
      for (let i = 0; i < n; i += this.coarseStride) {
        const d = this.positions[i].distanceToSquared(worldPos);
        if (d < gDist) {
          gDist = d;
          gBest = i;
        }
      }
      // Refine around the coarse winner.
      for (let k = -this.coarseStride; k <= this.coarseStride; k++) {
        const i = this.clampIndex(gBest + k);
        const d = this.positions[i].distanceToSquared(worldPos);
        if (d < gDist) {
          gDist = d;
          gBest = i;
        }
      }
      if (best < 0 || gDist < bestDist * 0.7) {
        best = gBest;
        bestDist = gDist;
      }
    }

    // Sub-sample refinement: project onto the segment straddling `best`.
    const prev = this.positions[this.clampIndex(best - 1)];
    const next = this.positions[this.clampIndex(best + 1)];
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
    // out there should fall and be recovered rather than slide along an
    // imaginary extension of the banked surface.
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

  /**
   * The lateral limit that applies to a *flying* kart. Barriers stop at head
   * height, but the course itself does not: a glider that leaves the corridor
   * would come down on some other part of the circuit and skip half a lap, so
   * flights are held inside a slightly wider version of the same tube.
   */
  airLimit(halfWidth, inGap) {
    return this.wallLimit(halfWidth) + (inGap ? CORRIDOR.gapMargin : CORRIDOR.airMargin);
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
    if (!this.closed) target = THREE.MathUtils.clamp(target, 12, this.length - 12);
    return target;
  }

  dispose() {
    this.positions = null;
    this.tangents = null;
    this.rights = null;
    this.normals = null;
  }
}
