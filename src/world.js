import * as THREE from 'three';
import * as TX from './textures.js';

/**
 * The environment around the circuit.
 *
 * The terrain is a single heightfield that is *derived* from the track:
 *
 *   - a coarse "regional" field carries the large-scale elevation of the course,
 *     so a circuit that climbs 400 m gets a mountain under it rather than a road
 *     on stilts;
 *   - near the road the sheet hugs the road's own elevation, taking the LOWEST
 *     nearby road height so a section that flies over another becomes a viaduct
 *     rather than a landslide;
 *   - gap sections carve downward instead, which is what gouges the canyons under
 *     the glider jumps.
 *
 * Palette, scenery, sky and weather all come from the loaded track's theme.
 */

const ROAD_INFLUENCE = 110;   // radius over which the road shapes the terrain
const REGIONAL_RADIUS = 460;  // radius over which the course shapes the landscape
const AMBIENT_BOX = 150;      // half-size of the weather box that follows the camera

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function fbm(x, y) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Uniform grid over the track samples so terrain lookups stay cheap. */
class SampleGrid {
  constructor(track, cell = 55) {
    this.cell = cell;
    this.buckets = new Map();
    this.gapBuckets = new Map();
    this.solid = [];
    this.gap = [];
    const stride = Math.max(2, Math.round(2.5 / track.sampleSpacing));
    for (let i = 0; i < track.sampleCount; i += stride) {
      const p = track.positions[i];
      if (track.isGapSample[i]) {
        // Record how far this sample sits from the nearest end of its gap, so the
        // carve can taper out rather than slicing a cliff through the road deck.
        const s = i * track.sampleSpacing;
        const gap = track.gaps.find((g) => s > g.start && s < g.end);
        const fromEnd = gap ? Math.min(s - gap.start, gap.end - s) : 0;
        this.gap.push({ x: p.x, z: p.z, y: p.y, fromEnd });
      } else {
        this.solid.push({ x: p.x, z: p.z, y: p.y });
      }
    }
    for (const e of this.solid) this._insert(this.buckets, e);
    for (const e of this.gap) this._insert(this.gapBuckets, e);
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  _insert(map, e) {
    const cx = Math.floor(e.x / this.cell);
    const cz = Math.floor(e.z / this.cell);
    const k = this._key(cx, cz);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(e);
  }

  /** Nearest horizontal distance to solid road, and the lowest road height nearby. */
  querySolid(x, z, radius) {
    const cell = this.cell;
    const r = Math.ceil(radius / cell);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let nearest = Infinity;
    let lowest = Infinity;
    const r2 = radius * radius;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const list = this.buckets.get(this._key(cx + a, cz + b));
        if (!list) continue;
        for (const e of list) {
          const dx = e.x - x;
          const dz = e.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          if (d2 < nearest) nearest = d2;
          if (e.y < lowest) lowest = e.y;
        }
      }
    }
    return { dist: Math.sqrt(nearest), lowest };
  }

  /** Distance to the nearest gap centreline sample, plus that sample's end taper. */
  queryGap(x, z, radius) {
    const cell = this.cell;
    const r = Math.ceil(radius / cell);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = Infinity;
    let fromEnd = 0;
    let height = 0;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const list = this.gapBuckets.get(this._key(cx + a, cz + b));
        if (!list) continue;
        for (const e of list) {
          const dx = e.x - x;
          const dz = e.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            fromEnd = e.fromEnd;
            height = e.y;
          }
        }
      }
    }
    return { dist: Math.sqrt(best), fromEnd, height };
  }
}

export class World {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.theme = track.theme;
    this.grid = new SampleGrid(track);
    this.objects = [];

    this._measure();
    this._buildElevationField();
    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildWater();
    this._buildChasms();
    this._buildScenery();
    this._buildPylons();
    this._buildAmbient();
  }

  /** Everything is sized off the circuit's footprint, not a fixed sheet. */
  _measure() {
    const box = new THREE.Box3();
    for (const p of this.track.positions) box.expandByPoint(p);
    const size = box.getSize(new THREE.Vector3());
    this.centre = box.getCenter(new THREE.Vector3());
    this.terrainSize = Math.max(size.x, size.z) + 640;
    this.terrainSegments = THREE.MathUtils.clamp(Math.round(this.terrainSize / 11), 150, 260);
    this.terrainStep = this.terrainSize / this.terrainSegments;
    this.terrainCols = this.terrainSegments + 1;
  }

  _add(object) {
    this.scene.add(object);
    this.objects.push(object);
    return object;
  }

  // ------------------------------------------------- regional elevation field

  /**
   * A blurred map of how high the *course* is in each part of the world. Road
   * samples are splatted into a coarse grid with a falloff, then holes are
   * filled by dilation. Without this the hills would sit at sea level under a
   * circuit that spends its life 400 m up.
   */
  _buildElevationField() {
    const cell = 52;
    const cols = Math.ceil(this.terrainSize / cell) + 3;
    const origin = new THREE.Vector2(
      this.centre.x - this.terrainSize / 2 - cell,
      this.centre.z - this.terrainSize / 2 - cell
    );
    const sum = new Float32Array(cols * cols);
    const weight = new Float32Array(cols * cols);

    const R = REGIONAL_RADIUS;
    const span = Math.ceil(R / cell);
    const samples = this.grid.solid.concat(this.grid.gap);
    for (const e of samples) {
      const cx = Math.floor((e.x - origin.x) / cell);
      const cz = Math.floor((e.z - origin.y) / cell);
      for (let a = -span; a <= span; a++) {
        for (let b = -span; b <= span; b++) {
          const ix = cx + a;
          const iz = cz + b;
          if (ix < 0 || iz < 0 || ix >= cols || iz >= cols) continue;
          const px = origin.x + (ix + 0.5) * cell;
          const pz = origin.y + (iz + 0.5) * cell;
          const d = Math.hypot(px - e.x, pz - e.z);
          if (d > R) continue;
          const w = (1 - d / R) ** 2;
          const k = iz * cols + ix;
          sum[k] += e.y * w;
          weight[k] += w;
        }
      }
    }

    const field = new Float32Array(cols * cols);
    const known = new Uint8Array(cols * cols);
    let mean = 0;
    let meanCount = 0;
    for (let i = 0; i < field.length; i++) {
      if (weight[i] > 1e-5) {
        field[i] = sum[i] / weight[i];
        known[i] = 1;
        mean += field[i];
        meanCount++;
      }
    }
    mean = meanCount ? mean / meanCount : 0;

    // Dilate outward until the whole sheet has a value.
    for (let pass = 0; pass < 60; pass++) {
      let filled = 0;
      const next = known.slice();
      for (let z = 0; z < cols; z++) {
        for (let x = 0; x < cols; x++) {
          const k = z * cols + x;
          if (known[k]) continue;
          let acc = 0;
          let n = 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= cols) continue;
            const nk = nz * cols + nx;
            if (!known[nk]) continue;
            acc += field[nk];
            n++;
          }
          if (n) {
            field[k] = acc / n;
            next[k] = 1;
            filled++;
          }
        }
      }
      known.set(next);
      if (!filled) break;
    }
    for (let i = 0; i < field.length; i++) if (!known[i]) field[i] = mean;

    this.field = { data: field, cols, cell, origin };
  }

  _regionalHeight(x, z) {
    const f = this.field;
    const fx = THREE.MathUtils.clamp((x - f.origin.x) / f.cell - 0.5, 0, f.cols - 1.001);
    const fz = THREE.MathUtils.clamp((z - f.origin.y) / f.cell - 0.5, 0, f.cols - 1.001);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const d = f.data;
    const c = f.cols;
    const h00 = d[z0 * c + x0];
    const h10 = d[z0 * c + x0 + 1];
    const h01 = d[(z0 + 1) * c + x0];
    const h11 = d[(z0 + 1) * c + x0 + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  // ------------------------------------------------------------------- sky

  _buildSky() {
    const t = this.theme.sky;
    const geo = new THREE.SphereGeometry(3200, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(...this.theme.sun.dir).normalize() },
        uZenith: { value: new THREE.Color(t.zenith) },
        uMid: { value: new THREE.Color(t.mid) },
        uHorizon: { value: new THREE.Color(t.horizon) },
        uGround: { value: new THREE.Color(t.ground) },
        uGlowColor: { value: new THREE.Vector3(...t.glowColor) },
        uGlow: { value: t.glow },
        uDisc: { value: new THREE.Vector3(...t.discColor) },
        uBand: { value: new THREE.Vector3(...t.band) },
        uBandFreq: { value: t.bandFreq },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun, uZenith, uMid, uHorizon, uGround, uGlowColor, uDisc, uBand;
        uniform float uGlow, uBandFreq;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
          col = mix(col, uZenith, smoothstep(0.16, 0.62, h));
          col = mix(uGround, col, smoothstep(-0.22, 0.005, h));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          col += uGlowColor * pow(sd, 6.0) * uGlow;
          col += uDisc * pow(sd, 900.0) * 6.0;
          // Faint banding to suggest high cloud (or an aurora).
          float band = sin(d.y * uBandFreq + d.x * 3.0) * 0.5 + 0.5;
          col += uBand * band * smoothstep(0.02, 0.3, h) * (1.0 - smoothstep(0.3, 0.7, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this._add(this.sky);

    const fog = this.theme.fog;
    this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
  }

  _buildLights() {
    const t = this.theme;
    this.sunDir = new THREE.Vector3(...t.sun.dir).normalize();

    const hemi = new THREE.HemisphereLight(t.hemi.sky, t.hemi.ground, t.hemi.intensity);
    this._add(hemi);

    const sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity);
    sun.position.copy(this.sunDir).multiplyScalar(260);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 105;
    sun.shadow.camera.left = -S;
    sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;
    sun.shadow.camera.bottom = -S;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 620;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.045;
    this._add(sun);
    this._add(sun.target);
    this.sun = sun;

    // Bounce from the opposite side keeps shadowed bodywork readable.
    const fill = new THREE.DirectionalLight(t.fill.color, t.fill.intensity);
    fill.position.set(120, 90, 180);
    this._add(fill);
  }

  /** Keeps the shadow frustum wrapped around the player. */
  focusShadows(target) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 260);
    this.sun.target.updateMatrixWorld();
  }

  // --------------------------------------------------------------- terrain

  _buildTerrain() {
    const size = this.terrainSize;
    const segments = this.terrainSegments;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.centre.x, 0, this.centre.z);

    const pos = geo.attributes.position;
    const heights = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      heights[i] = this._terrainHeight(pos.getX(i), pos.getZ(i));
      pos.setY(i, heights[i]);
    }

    // Colour by height above the local landscape, and by slope.
    const cols = this.terrainCols;
    const step = this.terrainStep;
    const t = this.theme.terrain;
    const low = new THREE.Color(t.low);
    const high = new THREE.Color(t.high);
    const rock = new THREE.Color(t.rock);
    const cliff = new THREE.Color(t.cliff);
    const shore = new THREE.Color(t.shore);
    const waterLevel = this.theme.water.level;
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const hL = heights[row * cols + Math.max(0, col - 1)];
      const hR = heights[row * cols + Math.min(cols - 1, col + 1)];
      const hU = heights[Math.max(0, row - 1) * cols + col];
      const hD = heights[Math.min(cols - 1, row + 1) * cols + col];
      const slope = Math.min(1, ((Math.abs(hR - hL) + Math.abs(hD - hU)) / (4 * step)) * 1.5);
      // Relative height reads the same whether the course is at sea level or
      // half way up a volcano.
      const rel = heights[i] - this._regionalHeight(pos.getX(i), pos.getZ(i));

      tmp.copy(low).lerp(high, smoothstep(t.lowBand[0], t.lowBand[1], rel));
      tmp.lerp(rock, smoothstep(0.32, 0.75, slope));
      tmp.lerp(cliff, smoothstep(0.62, 0.95, slope) * smoothstep(-24, 6, rel));
      tmp.lerp(shore, smoothstep(waterLevel + 7, waterLevel + 1.5, heights[i]));
      // Break up the flatness a little.
      const tint = 1 + valueNoise(pos.getX(i) * 0.06, pos.getZ(i) * 0.06) * 0.1;
      colors[i * 3] = tmp.r * tint;
      colors[i * 3 + 1] = tmp.g * tint;
      colors[i * 3 + 2] = tmp.b * tint;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this._add(mesh);

    this.terrain = mesh;
    this.terrainHeights = heights;
  }

  _terrainHeight(x, z) {
    const t = this.theme.terrain;
    const { dist, lowest } = this.grid.querySolid(x, z, ROAD_INFLUENCE);
    const regional = this._regionalHeight(x, z);

    // Rolling hills that own everything far from the circuit.
    const base =
      regional +
      fbm(x * 0.0022, z * 0.0022) * t.hills +
      fbm(x * 0.0085, z * 0.0085) * t.hills * 0.24 +
      fbm(x * 0.03, z * 0.03) * 2.4;

    let h = base;
    if (Number.isFinite(lowest)) {
      // 1 right beside the road, easing out to nothing at ROAD_INFLUENCE metres.
      const w = 1 - smoothstep(22, ROAD_INFLUENCE, dist);
      const roadside = lowest - t.clearance - smoothstep(0, 60, dist) * 5;
      h = base + (roadside - base) * w;
    }

    // Gouge the canyon beneath the glider gaps. The carve tapers off over the
    // last 30 m at each end of a gap so it never slices through the road deck.
    const gap = this.grid.queryGap(x, z, 150);
    if (gap.dist < 130) {
      const carve =
        smoothstep(130, 28, gap.dist) *
        smoothstep(0, 30, gap.fromEnd) *
        (1 - smoothstep(38, 18, dist));
      if (carve > 0.001) {
        const floor = gap.height - t.canyonDepth + fbm(x * 0.012, z * 0.012) * 6;
        h += (Math.min(h, floor) - h) * carve;
      }
    }
    return h;
  }

  /** Bilinear sample of the generated heightfield -- used to plant scenery. */
  heightAt(x, z) {
    const half = this.terrainSize / 2;
    const fx = (x - this.centre.x + half) / this.terrainStep;
    const fz = (z - this.centre.z + half) / this.terrainStep;
    const cols = this.terrainCols;
    if (fx < 0 || fz < 0 || fx >= cols - 1 || fz >= cols - 1) return null;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const H = this.terrainHeights;
    const h00 = H[z0 * cols + x0];
    const h10 = H[z0 * cols + x0 + 1];
    const h01 = H[(z0 + 1) * cols + x0];
    const h11 = H[(z0 + 1) * cols + x0 + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  // ----------------------------------------------------------------- water

  _buildWater() {
    const w = this.theme.water;
    const geo = new THREE.PlaneGeometry(this.terrainSize * 3, this.terrainSize * 3, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const ripple = this._rippleTexture(w.color);
    const mat = new THREE.MeshStandardMaterial({
      color: w.color,
      roughness: w.roughness,
      metalness: w.metalness,
      transparent: w.opacity < 1,
      opacity: w.opacity,
      map: ripple,
      emissive: new THREE.Color(w.emissive ?? 0x000000),
      emissiveIntensity: w.emissiveIntensity ?? 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.centre.x, w.level, this.centre.z);
    mesh.name = 'water';
    this._add(mesh);
    this.water = mesh;
    this.waterTex = ripple;
  }

  _rippleTexture(tint) {
    const c = new THREE.Color(tint);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = fbm(x * 0.05, y * 0.05) * 0.5 + 0.5;
        const v = 140 + n * 115;
        const i = (y * 256 + x) * 4;
        img.data[i] = v * (0.45 + c.r * 0.6);
        img.data[i + 1] = v * (0.45 + c.g * 0.6);
        img.data[i + 2] = v * (0.45 + c.b * 0.6);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * A river / lava flow / frozen floor sitting in the bottom of each carved gap,
   * so a glider crossing has something to fly over besides a hole.
   */
  _buildChasms() {
    const spec = this.theme.chasm;
    if (!spec) return;
    const group = new THREE.Group();
    group.name = 'chasms';
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: new THREE.Color(spec.emissive ?? 0x000000),
      emissiveIntensity: spec.emissiveIntensity ?? 0,
      roughness: 0.5,
      metalness: 0.1,
    });

    for (const gap of this.track.gaps) {
      const a = this.track.frameAt(gap.start);
      const start = a.position.clone();
      const b = this.track.frameAt(gap.end);
      const end = b.position.clone();
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const len = start.distanceTo(end) + 60;
      const geo = new THREE.PlaneGeometry(110, len, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const plate = new THREE.Mesh(geo, mat);
      const drop = this.theme.terrain.canyonDepth * (spec.drop ?? 0.6);
      plate.position.set(mid.x, Math.min(start.y, end.y) - drop, mid.z);
      plate.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
      group.add(plate);
    }
    this._add(group);
  }

  // --------------------------------------------------------------- scenery

  _buildScenery() {
    const spec = this.theme.scenery;
    const scale = spec.scale ?? 1;
    const trunkGeo = new THREE.CylinderGeometry(
      spec.trunk.top, spec.trunk.bottom, spec.trunk.height, 5
    );
    trunkGeo.translate(0, spec.trunk.height / 2, 0);
    const foliageGeos = spec.foliage.map((f) =>
      f.kind === 'sphere'
        ? new THREE.IcosahedronGeometry(f.radius, 0).translate(0, f.y + f.radius, 0)
        : new THREE.ConeGeometry(f.radius, f.height, 7).translate(0, f.y + f.height / 2, 0)
    );
    const rockGeo = new THREE.DodecahedronGeometry(spec.rock.radius, 0);

    const trunkMat = new THREE.MeshStandardMaterial({
      color: spec.trunk.color, roughness: 1, flatShading: true,
    });
    const foliageMats = spec.foliage.map((f) => new THREE.MeshStandardMaterial({
      color: f.color, roughness: 0.95, flatShading: true,
    }));
    const rockMat = new THREE.MeshStandardMaterial({
      color: spec.rock.color, roughness: 1, flatShading: true,
    });

    const trees = [];
    const rocks = [];
    const dummy = new THREE.Object3D();
    const track = this.track;
    const waterLevel = this.theme.water.level;

    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let s = 0; s < track.length; s += 5) {
      const frame = track.frameAt(s);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          if (rnd() > spec.density) continue;
          const lateral = side * (frame.halfWidth + 14 + rnd() * 62);
          const jitter = (rnd() - 0.5) * 8;
          const px = frame.position.x + frame.right.x * lateral + frame.tangent.x * jitter;
          const pz = frame.position.z + frame.right.z * lateral + frame.tangent.z * jitter;

          // Never let scenery grow through another part of the circuit.
          const near = this.grid.querySolid(px, pz, 30);
          if (near.dist < 19) continue;

          const gy = this.heightAt(px, pz);
          if (gy === null || gy < waterLevel + 1.5) continue;

          const slope = this._slopeAt(px, pz);
          if (rnd() < spec.rockChance || slope > 0.55) {
            const size = 0.5 + rnd() * 1.5;
            dummy.position.set(px, gy - 0.5 * size, pz);
            dummy.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
            dummy.scale.setScalar(size);
            dummy.updateMatrix();
            rocks.push(dummy.matrix.clone());
          } else {
            const size = (0.7 + rnd() * 0.85) * scale;
            dummy.position.set(px, gy - 0.3, pz);
            dummy.rotation.set(0, rnd() * 6.28, 0);
            dummy.scale.set(size, size * (0.8 + rnd() * 0.55), size);
            dummy.updateMatrix();
            trees.push(dummy.matrix.clone());
          }
        }
      }
    }

    const addInstanced = (geo, mat, mats, name, shadow = true) => {
      if (!mats.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.name = name;
      this._add(mesh);
    };
    addInstanced(trunkGeo, trunkMat, trees, 'treeTrunks');
    foliageGeos.forEach((geo, i) => addInstanced(geo, foliageMats[i], trees, `treeFoliage${i}`));
    addInstanced(rockGeo, rockMat, rocks, 'rocks');

    this.sceneryCounts = { trees: trees.length, rocks: rocks.length };
  }

  _slopeAt(x, z) {
    const d = 6;
    const h = this.heightAt(x, z);
    if (h === null) return 0;
    const hx = this.heightAt(x + d, z);
    const hz = this.heightAt(x, z + d);
    if (hx === null || hz === null) return 0;
    return (Math.abs(hx - h) + Math.abs(hz - h)) / (2 * d);
  }

  // --------------------------------------------------------------- pylons

  /** Concrete columns wherever the deck floats well above the ground. */
  _buildPylons() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8d96, roughness: 0.9 });
    const geo = new THREE.CylinderGeometry(1.15, 1.7, 1, 8);
    const track = this.track;
    const dummy = new THREE.Object3D();
    const slots = [];

    for (let s = 0; s < track.length; s += 16) {
      if (track.inGap(s)) continue;
      const frame = track.frameAt(s);
      const deckY = frame.position.y - 1.3;
      const gy = this.heightAt(frame.position.x, frame.position.z);
      if (gy === null) continue;
      const drop = deckY - gy;
      if (drop < 5) continue;

      for (const side of [-0.55, 0.55]) {
        dummy.position
          .copy(frame.position)
          .addScaledVector(frame.right, side * frame.halfWidth)
          .setY(gy + drop / 2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, drop, 1);
        dummy.updateMatrix();
        slots.push(dummy.matrix.clone());
      }
    }
    if (!slots.length) return;

    const mesh = new THREE.InstancedMesh(geo, mat, slots.length);
    slots.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'pylons';
    this._add(mesh);
  }

  // -------------------------------------------------------------- weather

  /**
   * Snow, drifting leaves or rising embers. The particles live in world space
   * and are wrapped into a box around the camera, so they stream past properly
   * instead of hanging off the windscreen.
   */
  _buildAmbient() {
    const spec = this.theme.ambient;
    if (!spec) return;
    const count = spec.count;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * AMBIENT_BOX * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * AMBIENT_BOX * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * AMBIENT_BOX * 2;
      speeds[i] = 0.6 + Math.random() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: spec.color,
      size: spec.size,
      map: TX.sparkTexture(),
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: spec.kind === 'ember' ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: spec.kind === 'ember' ? 0.9 : 0.75,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.name = 'weather';
    this._add(points);
    this.ambient = { points, positions, speeds, spec, geo };
  }

  _updateAmbient(dt, elapsed, camera) {
    const a = this.ambient;
    if (!a || !camera) return;
    const { positions, speeds, spec } = a;
    const cam = camera.position;
    const B = AMBIENT_BOX;
    for (let i = 0; i < speeds.length; i++) {
      const i3 = i * 3;
      positions[i3 + 1] -= spec.fall * speeds[i] * dt;
      positions[i3] += Math.sin(elapsed * 0.7 + i) * spec.drift * dt;
      positions[i3 + 2] += Math.cos(elapsed * 0.6 + i * 1.3) * spec.drift * dt;
      // Wrap into the box that follows the camera.
      for (let axis = 0; axis < 3; axis++) {
        const centre = axis === 0 ? cam.x : axis === 1 ? cam.y : cam.z;
        let d = positions[i3 + axis] - centre;
        if (d > B) positions[i3 + axis] -= B * 2;
        else if (d < -B) positions[i3 + axis] += B * 2;
      }
    }
    a.geo.attributes.position.needsUpdate = true;
  }

  update(dt, elapsed, camera) {
    this.waterTex.offset.x = elapsed * 0.004;
    this.waterTex.offset.y = elapsed * 0.0026;
    this._updateAmbient(dt, elapsed, camera);
  }

  dispose() {
    for (const object of this.objects) {
      this.scene.remove(object);
      object.traverse?.((node) => {
        node.geometry?.dispose?.();
        const mat = node.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
    }
    this.objects.length = 0;
    // The ripple map is generated per world; the shared texture cache owns
    // everything else, so this is the only one we are allowed to release.
    this.waterTex?.dispose();
    this.scene.fog = null;
  }
}
