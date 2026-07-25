import * as THREE from 'three';
import * as TX from './textures.js';
import { KART } from './config.js';

/** Every mesh in the game is assembled from primitives -- no external assets. */

const FLAT = { flatShading: true };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...FLAT, ...opts });
}

/**
 * A kart: chassis, pods, driver, four wheels, spoiler, a stowable glider and a
 * shield bubble. Returns the group plus handles to the parts that animate.
 */
export function makeKart(color, accent) {
  const group = new THREE.Group();

  const bodyMat = mat(color, { roughness: 0.35, metalness: 0.25 });
  const accentMat = mat(accent, { roughness: 0.5 });
  const darkMat = mat(0x22242e, { roughness: 0.7, metalness: 0.3 });
  const tyreMat = mat(0x1b1b20, { roughness: 0.95, metalness: 0 });
  const rimMat = mat(0xcfd4e0, { roughness: 0.3, metalness: 0.85 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fe8ff, roughness: 0.1, metalness: 0.1,
    transparent: true, opacity: 0.55, ...FLAT,
  });

  // --- Chassis ------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.22, 2.5), darkMat);
  floor.position.y = 0.34;
  group.add(floor);

  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.46, 1.65), bodyMat);
  tub.position.set(0, 0.62, -0.12);
  group.add(tub);

  // Tapered nose.
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.55, 1.15, 4), bodyMat);
  nose.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  nose.position.set(0, 0.5, 1.42);
  group.add(nose);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.42), accentMat);
  splitter.position.set(0, 0.28, 1.72);
  group.add(splitter);

  // Side pods.
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 1.5), bodyMat);
    pod.position.set(side * 0.78, 0.56, -0.18);
    group.add(pod);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 1.2), accentMat);
    stripe.position.set(side * 1.0, 0.6, -0.18);
    group.add(stripe);
  }

  // Engine block + exhausts.
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.52, 0.72), darkMat);
  engine.position.set(0, 0.68, -1.12);
  group.add(engine);

  const exhausts = [];
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 6), rimMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.3, 0.86, -1.5);
    group.add(pipe);
    exhausts.push(pipe.position.clone());
  }

  // Rear wing.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.42), accentMat);
  wing.position.set(0, 1.16, -1.34);
  wing.rotation.x = -0.14;
  group.add(wing);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.24), darkMat);
    strut.position.set(side * 0.62, 0.99, -1.34);
    group.add(strut);
  }

  // --- Driver -------------------------------------------------------------
  const driver = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.32, 3, 8), accentMat);
  torso.position.y = 1.06;
  torso.rotation.x = 0.22;
  driver.add(torso);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), bodyMat);
  helmet.position.set(0, 1.5, -0.04);
  driver.add(helmet);

  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10, 0, Math.PI, 0.9, 0.9), glassMat);
  visor.position.copy(helmet.position);
  visor.rotation.y = Math.PI;
  driver.add(visor);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 3, 6), accentMat);
    arm.position.set(side * 0.3, 1.02, 0.32);
    arm.rotation.set(1.15, 0, side * -0.25);
    driver.add(arm);
  }
  driver.position.z = -0.18;
  group.add(driver);

  // Steering wheel.
  const steer = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 6, 12), darkMat);
  steer.position.set(0, 1.0, 0.42);
  steer.rotation.x = 1.15;
  group.add(steer);

  // --- Wheels -------------------------------------------------------------
  const wheels = [];
  const makeWheel = (x, z, radius, width) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, radius, z);

    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 12), tyreMat);
    tyre.rotation.z = Math.PI / 2;
    pivot.add(tyre);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.03, 8), rimMat);
    rim.rotation.z = Math.PI / 2;
    pivot.add(rim);

    group.add(pivot);
    wheels.push({ pivot, spin: tyre, rim, radius, steered: z > 0 });
    return pivot;
  };
  const R = KART.wheelRadius;
  makeWheel(-0.92, 1.02, R * 0.86, 0.3);
  makeWheel(0.92, 1.02, R * 0.86, 0.3);
  makeWheel(-0.95, -1.05, R, 0.42);
  makeWheel(0.95, -1.05, R, 0.42);

  // --- Glider -------------------------------------------------------------
  const glider = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide,
    transparent: true, opacity: 0.88, ...FLAT,
  });
  const sail = new THREE.Mesh(new THREE.BufferGeometry(), wingMat);
  {
    // A simple swept delta wing.
    const v = new Float32Array([
      0, 0, 0.9, -3.1, 0.42, -0.7, 0, 0, -0.55,
      0, 0, 0.9, 0, 0, -0.55, 3.1, 0.42, -0.7,
    ]);
    sail.geometry.setAttribute('position', new THREE.BufferAttribute(v, 3));
    sail.geometry.computeVertexNormals();
  }
  glider.add(sail);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.52, 0.5), accentMat);
    tip.position.set(side * 3.0, 0.66, -0.7);
    glider.add(tip);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5), rimMat);
  mast.position.y = -0.45;
  glider.add(mast);

  glider.position.set(0, 1.95, -0.35);
  glider.scale.setScalar(0.001);
  glider.visible = false;
  group.add(glider);

  // --- Shield bubble ------------------------------------------------------
  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.05, 2),
    new THREE.MeshBasicMaterial({
      color: 0x7fe8ff, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      wireframe: true,
    })
  );
  shield.position.y = 0.95;
  shield.visible = false;
  group.add(shield);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  shield.castShadow = false;
  glider.traverse((o) => { if (o.isMesh) o.castShadow = false; });

  return { group, wheels, glider, shield, driver, exhausts, bodyMat, accentMat };
}

/** Floating, spinning item crate. */
export function makeItemBox() {
  const group = new THREE.Group();
  const tex = TX.itemBoxTexture();
  const outer = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 2.1, 2.1),
    new THREE.MeshStandardMaterial({
      map: tex, transparent: true, opacity: 0.78, roughness: 0.25,
      metalness: 0.1, emissive: 0xff8a3d, emissiveIntensity: 0.35,
    })
  );
  group.add(outer);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.62, 0),
    new THREE.MeshBasicMaterial({ color: 0xfff2c4 })
  );
  group.add(core);
  group.userData.core = core;
  group.userData.outer = outer;
  return group;
}

export function makeRocket(color = 0xff5a3d) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.7, 4, 8),
    mat(color, { emissive: color, emissiveIntensity: 0.5 })
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 8), mat(0xffe9a8));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.9;
  group.add(tip);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.4), mat(0xf0f0f5));
    fin.position.z = -0.6;
    fin.rotation.z = (i / 3) * Math.PI * 2;
    fin.position.x = Math.sin((i / 3) * Math.PI * 2) * 0.26;
    fin.position.y = Math.cos((i / 3) * Math.PI * 2) * 0.26;
    group.add(fin);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 1.1, 7),
    new THREE.MeshBasicMaterial({ color: 0xffc45e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -1.1;
  group.add(flame);
  group.userData.flame = flame;
  return group;
}

export function makeBomb() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), mat(0x2b2f3c, { metalness: 0.6, roughness: 0.4 }));
  group.add(body);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.07, 6, 14), mat(0xff5a3d, { emissive: 0xff3a1d, emissiveIntensity: 0.6 }));
  band.rotation.x = Math.PI / 2;
  group.add(band);
  const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  fuse.position.y = 0.62;
  group.add(fuse);
  group.userData.fuse = fuse;
  return group;
}

export function makeSlick() {
  const group = new THREE.Group();
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 16),
    new THREE.MeshStandardMaterial({
      color: 0x14161c, roughness: 0.08, metalness: 0.85,
      transparent: true, opacity: 0.92,
    })
  );
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.05;
  group.add(puddle);
  const sheen = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 16),
    new THREE.MeshBasicMaterial({ color: 0x5a3f7a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = 0.07;
  group.add(sheen);
  return group;
}

/** Expanding shockwave ring for the static pulse. */
export function makePulseRing() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 48),
    new THREE.MeshBasicMaterial({
      color: 0xbba0ff, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Billboarded name tag that floats over a kart. */
export function makeNameTag(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const plate = () => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(6, 10, 244, 44, 12);
    else ctx.rect(6, 10, 244, 44);
  };
  ctx.fillStyle = 'rgba(10,12,20,0.62)';
  plate();
  ctx.fill();
  ctx.strokeStyle = '#' + new THREE.Color(color).getHexString();
  ctx.lineWidth = 3;
  plate();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
  }));
  sprite.scale.set(3.4, 0.85, 1);
  sprite.position.y = 2.9;
  return sprite;
}

/**
 * Pooled additive particle system. One draw call handles drift sparks, exhaust,
 * boost trails, dust and explosions.
 */
export class Particles {
  constructor(scene, capacity = 1400) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.baseColors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.baseSizes = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TX.sparkTexture() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 320.0 / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(vColor, 1.0) * t.a;
        }
      `,
      vertexColors: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);

    // Park everything far away until it is used.
    for (let i = 0; i < capacity; i++) this.positions[i * 3 + 1] = -9999;
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, gravity = 0, drag = 1.6) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocities[i3] = vx;
    this.velocities[i3 + 1] = vy;
    this.velocities[i3 + 2] = vz;
    this.baseColors[i3] = color.r;
    this.baseColors[i3 + 1] = color.g;
    this.baseColors[i3 + 2] = color.b;
    this.colors[i3] = color.r;
    this.colors[i3 + 1] = color.g;
    this.colors[i3 + 2] = color.b;
    this.baseSizes[i] = size;
    this.sizes[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  burst(origin, count, color, opts = {}) {
    const { speed = 6, size = 0.5, life = 0.6, spread = 1, gravity = 0, up = 0, drag = 1.6 } = opts;
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(
        origin.x, origin.y, origin.z,
        Math.sin(phi) * Math.cos(theta) * s * spread,
        Math.cos(phi) * s * spread + up,
        Math.sin(phi) * Math.sin(theta) * s * spread,
        color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7),
        gravity, drag
      );
    }
  }

  update(dt) {
    const { positions, velocities, colors, baseColors, life, maxLife,
      sizes, baseSizes, gravity, drag, capacity } = this;
    for (let i = 0; i < capacity; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const i3 = i * 3;
      if (life[i] <= 0) {
        positions[i3 + 1] = -9999;
        sizes[i] = 0;
        continue;
      }
      const damp = Math.max(0, 1 - drag[i] * dt);
      velocities[i3] *= damp;
      velocities[i3 + 1] = velocities[i3 + 1] * damp - gravity[i] * dt;
      velocities[i3 + 2] *= damp;
      positions[i3] += velocities[i3] * dt;
      positions[i3 + 1] += velocities[i3 + 1] * dt;
      positions[i3 + 2] += velocities[i3 + 2] * dt;

      // Fade out over the back half of the lifetime; additive blending turns
      // a dimmed colour into a clean dissolve.
      const t = life[i] / maxLife[i];
      const fade = t < 0.5 ? t * 2 : 1;
      colors[i3] = baseColors[i3] * fade;
      colors[i3 + 1] = baseColors[i3 + 1] * fade;
      colors[i3 + 2] = baseColors[i3 + 2] * fade;
      sizes[i] = baseSizes[i] * (0.55 + (1 - t) * 0.7);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
