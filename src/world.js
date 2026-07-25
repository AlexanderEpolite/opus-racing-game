import * as THREE from 'three';

/**
 * The environment around the circuit.
 *
 * The terrain is a single heightfield that is *derived* from the track: near the
 * road it hugs the road's own elevation (taking the LOWEST nearby road height, so
 * a section that flies over another becomes a viaduct rather than a landslide),
 * and far away it relaxes into rolling hills. Gap sections carve downward instead,
 * which is what gouges the canyon under the big glider jump.
 */

const TERRAIN_SIZE = 1500;
const TERRAIN_SEGMENTS = 190;
const CANYON_FLOOR = -34;
const WATER_LEVEL = -20;
const ROAD_CLEARANCE = 3.0;   // how far the ground sits below the road deck
const ROAD_INFLUENCE = 110;   // radius over which the road shapes the terrain

const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.36, -0.84).normalize();

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
    this.solid = [];
    this.gap = [];
    for (let i = 0; i < track.sampleCount; i += 2) {
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
    for (const e of this.solid) this._insert(e);
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  _insert(e) {
    const cx = Math.floor(e.x / this.cell);
    const cz = Math.floor(e.z / this.cell);
    const k = this._key(cx, cz);
    let list = this.buckets.get(k);
    if (!list) this.buckets.set(k, (list = []));
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
  queryGap(x, z) {
    let best = Infinity;
    let fromEnd = 0;
    for (const e of this.gap) {
      const dx = e.x - x;
      const dz = e.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        fromEnd = e.fromEnd;
      }
    }
    return { dist: Math.sqrt(best), fromEnd };
  }
}

export class World {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.grid = new SampleGrid(track);

    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildWater();
    this._buildScenery();
    this._buildPylons();
  }

  // ------------------------------------------------------------------- sky

  _buildSky() {
    const geo = new THREE.SphereGeometry(2600, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSun: { value: SUN_DIRECTION.clone() },
        uZenith: { value: new THREE.Color(0x1a2352) },
        uMid: { value: new THREE.Color(0xc9578a) },
        uHorizon: { value: new THREE.Color(0xffb277) },
        uGround: { value: new THREE.Color(0x2a2233) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun, uZenith, uMid, uHorizon, uGround;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
          col = mix(col, uZenith, smoothstep(0.16, 0.62, h));
          col = mix(uGround, col, smoothstep(-0.22, 0.005, h));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.72, 0.42) * pow(sd, 6.0) * 0.42;
          col += vec3(1.0, 0.93, 0.78) * pow(sd, 900.0) * 6.0;
          // Faint banding to suggest high cloud.
          float band = sin(d.y * 44.0 + d.x * 3.0) * 0.5 + 0.5;
          col += vec3(0.06, 0.03, 0.05) * band * smoothstep(0.02, 0.3, h) * (1.0 - smoothstep(0.3, 0.7, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);

    this.scene.fog = new THREE.Fog(0xd88f74, 340, 1150);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xffc9a0, 0x3d3350, 1.05);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd7ab, 2.5);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(260);
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
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // Cool bounce from the opposite side keeps shadowed bodywork readable.
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.45);
    fill.position.set(120, 90, 180);
    this.scene.add(fill);
  }

  /** Keeps the shadow frustum wrapped around the player. */
  focusShadows(target) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(SUN_DIRECTION, 260);
    this.sun.target.updateMatrixWorld();
  }

  // --------------------------------------------------------------- terrain

  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS
    );
    geo.rotateX(-Math.PI / 2);

    // Centre the sheet on the circuit.
    const box = new THREE.Box3();
    for (const p of this.track.positions) box.expandByPoint(p);
    const centre = box.getCenter(new THREE.Vector3());
    geo.translate(centre.x, 0, centre.z);

    const pos = geo.attributes.position;
    const heights = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      heights[i] = this._terrainHeight(x, z);
      pos.setY(i, heights[i]);
    }

    // Colour by height and slope.
    const cols = TERRAIN_SEGMENTS + 1;
    const step = TERRAIN_SIZE / TERRAIN_SEGMENTS;
    const grass = new THREE.Color(0x4b7a3a);
    const dryGrass = new THREE.Color(0x8a8f45);
    const rock = new THREE.Color(0x6b5a4c);
    const cliff = new THREE.Color(0x7d4f3c);
    const sand = new THREE.Color(0xc8b184);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const hL = heights[row * cols + Math.max(0, col - 1)];
      const hR = heights[row * cols + Math.min(cols - 1, col + 1)];
      const hU = heights[Math.max(0, row - 1) * cols + col];
      const hD = heights[Math.min(cols - 1, row + 1) * cols + col];
      const slope = Math.min(1, ((Math.abs(hR - hL) + Math.abs(hD - hU)) / (4 * step)) * 1.5);
      const h = heights[i];

      tmp.copy(grass).lerp(dryGrass, smoothstep(4, 34, h));
      tmp.lerp(rock, smoothstep(0.32, 0.75, slope));
      tmp.lerp(cliff, smoothstep(0.62, 0.95, slope) * smoothstep(-24, 6, h));
      tmp.lerp(sand, smoothstep(-13, WATER_LEVEL + 1.5, h));
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
    this.scene.add(mesh);

    this.terrain = mesh;
    this.terrainHeights = heights;
    this.terrainCentre = centre;
    this.terrainCols = cols;
    this.terrainStep = step;
  }

  _terrainHeight(x, z) {
    const { dist, lowest } = this.grid.querySolid(x, z, ROAD_INFLUENCE);

    // Rolling hills that own everything far from the circuit.
    const base =
      fbm(x * 0.0022, z * 0.0022) * 46 +
      fbm(x * 0.0085, z * 0.0085) * 11 +
      fbm(x * 0.03, z * 0.03) * 2.4 +
      2;

    let h = base;
    if (Number.isFinite(lowest)) {
      // 1 right beside the road, easing out to nothing at ROAD_INFLUENCE metres.
      const w = 1 - smoothstep(22, ROAD_INFLUENCE, dist);
      const roadside = lowest - ROAD_CLEARANCE - smoothstep(0, 60, dist) * 5;
      h = base + (roadside - base) * w;
    }

    // Gouge the canyon beneath the glider gaps. The carve tapers off over the
    // last 30 m at each end of a gap so it never slices through the road deck.
    const gap = this.grid.queryGap(x, z);
    if (gap.dist < 130) {
      const carve =
        smoothstep(130, 28, gap.dist) *
        smoothstep(0, 30, gap.fromEnd) *
        (1 - smoothstep(38, 18, dist));
      if (carve > 0.001) {
        const floor = CANYON_FLOOR + fbm(x * 0.012, z * 0.012) * 6;
        h += (Math.min(h, floor) - h) * carve;
      }
    }
    return h;
  }

  /** Bilinear sample of the generated heightfield -- used to plant scenery. */
  heightAt(x, z) {
    const half = TERRAIN_SIZE / 2;
    const fx = (x - this.terrainCentre.x + half) / this.terrainStep;
    const fz = (z - this.terrainCentre.z + half) / this.terrainStep;
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
    const geo = new THREE.PlaneGeometry(5000, 5000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const ripple = this._rippleTexture();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a6f8f,
      roughness: 0.18,
      metalness: 0.55,
      transparent: true,
      opacity: 0.9,
      map: ripple,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.terrainCentre.x, WATER_LEVEL, this.terrainCentre.z);
    mesh.name = 'water';
    this.scene.add(mesh);
    this.water = mesh;
    this.waterTex = ripple;
  }

  _rippleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = fbm(x * 0.05, y * 0.05) * 0.5 + 0.5;
        const v = 120 + n * 90;
        const i = (y * 256 + x) * 4;
        img.data[i] = v * 0.35;
        img.data[i + 1] = v * 0.75;
        img.data[i + 2] = v;
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

  // --------------------------------------------------------------- scenery

  _buildScenery() {
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.52, 3.4, 5);
    trunkGeo.translate(0, 1.7, 0);
    const leafGeo = new THREE.ConeGeometry(2.5, 7.2, 7);
    leafGeo.translate(0, 6.4, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1.9, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2b, roughness: 1, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.95, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6257, roughness: 1, flatShading: true });

    const trees = [];
    const rocks = [];
    const dummy = new THREE.Object3D();
    const track = this.track;

    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let s = 0; s < track.length; s += 5) {
      const frame = track.frameAt(s);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          if (rnd() > 0.42) continue;
          const lateral = side * (frame.halfWidth + 14 + rnd() * 62);
          const jitter = (rnd() - 0.5) * 8;
          const px = frame.position.x + frame.right.x * lateral + frame.tangent.x * jitter;
          const pz = frame.position.z + frame.right.z * lateral + frame.tangent.z * jitter;

          // Never let scenery grow through another part of the circuit.
          const near = this.grid.querySolid(px, pz, 30);
          if (near.dist < 19) continue;

          const gy = this.heightAt(px, pz);
          if (gy === null || gy < WATER_LEVEL + 1.5) continue;

          const slope = this._slopeAt(px, pz);
          if (rnd() < 0.24 || slope > 0.55) {
            const scale = 0.5 + rnd() * 1.5;
            dummy.position.set(px, gy - 0.5 * scale, pz);
            dummy.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            rocks.push(dummy.matrix.clone());
          } else {
            const scale = 0.7 + rnd() * 0.85;
            dummy.position.set(px, gy - 0.3, pz);
            dummy.rotation.set(0, rnd() * 6.28, 0);
            dummy.scale.set(scale, scale * (0.8 + rnd() * 0.55), scale);
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
      this.scene.add(mesh);
    };
    addInstanced(trunkGeo, trunkMat, trees, 'treeTrunks');
    addInstanced(leafGeo, leafMat, trees, 'treeLeaves');
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
    const group = new THREE.Group();
    group.name = 'pylons';
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8d96, roughness: 0.9 });
    const track = this.track;

    for (let s = 0; s < track.length; s += 16) {
      if (track.inGap(s)) continue;
      const frame = track.frameAt(s);
      const deckY = frame.position.y - 1.3;
      const gy = this.heightAt(frame.position.x, frame.position.z);
      if (gy === null) continue;
      const drop = deckY - gy;
      if (drop < 5) continue;

      for (const side of [-0.55, 0.55]) {
        const geo = new THREE.CylinderGeometry(1.15, 1.7, drop, 8);
        const pylon = new THREE.Mesh(geo, mat);
        pylon.position
          .copy(frame.position)
          .addScaledVector(frame.right, side * frame.halfWidth)
          .setY(gy + drop / 2);
        pylon.castShadow = true;
        pylon.receiveShadow = true;
        group.add(pylon);
      }
    }
    this.scene.add(group);
    this.pylons = group;
  }

  update(dt, elapsed) {
    this.waterTex.offset.x = elapsed * 0.004;
    this.waterTex.offset.y = elapsed * 0.0026;
  }
}
