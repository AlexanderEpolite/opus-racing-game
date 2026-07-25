import * as THREE from 'three';
import { RACE, CAMERA, KART, RACERS, AI_PROFILES } from './config.js';
import { Track } from './track.js';
import { buildTrackMesh } from './trackmesh.js';
import { World } from './world.js';
import { Kart, EMPTY_INPUT } from './kart.js';
import { AIDriver, makeRubberBand } from './ai.js';
import { ItemSystem } from './items.js';
import { Particles } from './models.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';

const MAX_STEP = 1 / 30;   // never integrate a step bigger than this
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class Game {
  constructor() {
    this.state = 'loading';
    this.elapsed = 0;
    this.raceTime = 0;
    this.countdown = RACE.countdownSeconds;
    this.finishDelay = 0;
    this.cameraShake = 0;
    this.throttleHeld = 0;
    this.resultsShown = false;

    this.colors = {
      driftDust: new THREE.Color(0xbfb49a),
      driftTier: [
        new THREE.Color(0x5fc8ff),
        new THREE.Color(0xffa63d),
        new THREE.Color(0xc48aff),
      ],
      boostFlame: [
        new THREE.Color(0xffb347),
        new THREE.Color(0x8fd8ff),
        new THREE.Color(0xffc45e),
        new THREE.Color(0xffe9a8),
      ],
      exhaust: new THREE.Color(0x53586b),
      dust: new THREE.Color(0x9c8560),
      smoke: new THREE.Color(0x4a4a55),
      glide: new THREE.Color(0xa8e4ff),
      pickup: new THREE.Color(0xffd75e),
      rocketTrail: new THREE.Color(0xff9a4d),
      blastCore: new THREE.Color(0xffd07a),
      emp: new THREE.Color(0xb07cff),
      landing: new THREE.Color(0xcfc3a8),
    };

    this._initRenderer();
    this._initScene();
  }

  // ------------------------------------------------------------------ boot

  _initRenderer() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    window.addEventListener('resize', () => this.onResize());
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov, window.innerWidth / window.innerHeight, 0.4, 3000
    );
    this.camera.position.set(0, 20, -40);
    this.camYaw = 0;
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.lookTarget = new THREE.Vector3();
  }

  /** Heavy construction, yielded between steps so the loading text can paint. */
  async build() {
    const note = document.getElementById('loading-note');
    const step = async (label, fn) => {
      note.textContent = label;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return fn();
    };

    this.track = await step('laying out the circuit…', () => new Track());
    await step('paving…', () => {
      const built = buildTrackMesh(this.track);
      this.scene.add(built.group);
      this.boostPadMeshes = built.boostPads;
    });
    await step('raising the ridge…', () => {
      this.world = new World(this.scene, this.track);
    });
    await step('rolling out the grid…', () => {
      this.particles = new Particles(this.scene);
      this.karts = [];
      this.drivers = [];
      this.inputsByKart = [];
      for (let i = 0; i < RACE.racerCount; i++) {
        const kart = new Kart(this, i, RACERS[i % RACERS.length]);
        this.karts.push(kart);
        this.inputsByKart.push(EMPTY_INPUT);
        this.drivers.push(i === 0 ? null : new AIDriver(kart, AI_PROFILES[i] || AI_PROFILES[1], i));
      }
      this.player = this.karts[0];
      Object.assign(this, makeRubberBand(this));
      this.items = new ItemSystem(this);
    });
    await step('ready', () => {
      this.hud = new HUD(this);
      this.input = new Input(window);
      this.input.bindTouch(document);
      this.audio = new Audio();
      this._wireUI();
      this.resetRace();
    });

    note.textContent = 'ready when you are';
    document.getElementById('start-btn').disabled = false;
    this.state = 'menu';
  }

  _wireUI() {
    const start = document.getElementById('start-btn');
    const again = document.getElementById('again-btn');
    const resume = document.getElementById('resume-btn');
    const restart = document.getElementById('restart-btn');

    start.addEventListener('click', () => this.beginRace());
    again.addEventListener('click', () => {
      this.hud.hideResults();
      this.beginRace();
    });
    resume.addEventListener('click', () => this.setPaused(false));
    restart.addEventListener('click', () => {
      this.setPaused(false);
      this.hud.hideResults();
      this.beginRace();
    });

    this.input.onAction = (action) => {
      if (action === 'pause') {
        if (this.state === 'racing' || this.state === 'countdown') this.setPaused(true);
        else if (this.state === 'paused') this.setPaused(false);
      } else if (action === 'mute') {
        this.audio.setMuted(!this.audio.muted);
        this.hud.message(this.audio.muted ? 'MUTED' : 'SOUND ON', 'cool');
      } else if (action === 'respawn') {
        if (this.state === 'racing' && !this.player.isStunned) this.player.startRespawn();
      } else if (action === 'confirm') {
        if (this.state === 'menu') this.beginRace();
        else if (this.state === 'results') {
          this.hud.hideResults();
          this.beginRace();
        }
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'racing') this.setPaused(true);
    });

    // Touch controls only appear on devices that actually have a touchscreen.
    if (matchMedia('(pointer: coarse)').matches) {
      document.getElementById('touch-controls').hidden = false;
    }
  }

  // ------------------------------------------------------------ race flow

  resetRace() {
    this.raceTime = 0;
    this.countdown = RACE.countdownSeconds;
    this.finishDelay = 0;
    this.resultsShown = false;
    this.throttleHeld = 0;
    this.items?.reset();

    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      // The player lines up at the back of the grid.
      const slot = kart.isPlayer ? this.karts.length - 1 : i - 1;
      const row = Math.floor(slot / 2);
      const s = this.track.wrap(-(9 + row * 8.5));
      const lateral = slot % 2 === 0 ? -4.6 : 4.6;
      kart.placeAt(s, lateral);
      kart.item = null;
      kart.itemRoulette = 0;
      kart.lap = 1;
      kart.finished = false;
      kart.finishTime = 0;
      kart.spinTimer = 0;
      kart.squashTimer = 0;
      kart.shieldTimer = 0;
      kart.empTimer = 0;
      kart.respawnTimer = 0;
      kart.boostTimer = 0;
      kart.place = i + 1;
    }

    this.updateStandings();
    this.snapCamera();
  }

  beginRace() {
    document.getElementById('start-screen').hidden = true;
    this.audio.start();
    this.resetRace();
    this.hud.show();
    this.state = 'countdown';
    this.countdownFace = -1;
  }

  setPaused(paused) {
    const el = document.getElementById('pause-screen');
    if (paused && (this.state === 'racing' || this.state === 'countdown')) {
      this.pausedFrom = this.state;
      this.state = 'paused';
      el.hidden = false;
    } else if (!paused && this.state === 'paused') {
      this.state = this.pausedFrom || 'racing';
      el.hidden = true;
    }
  }

  finalize() {
    // Give every unfinished kart a plausible time rather than a bare DNF.
    for (const kart of this.karts) {
      if (kart.finished) continue;
      const remaining = this.track.length * RACE.laps - kart.distance;
      const pace = Math.max(18, kart.distance / Math.max(1, this.raceTime));
      kart.finished = true;
      kart.finishTime = this.raceTime + remaining / pace;
    }
    this.updateStandings();
    this.resultsShown = true;
    this.hud.showResults(this.standings);
  }

  // -------------------------------------------------------------- the loop

  start() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (!Number.isFinite(dt)) dt = 0;
      dt = Math.min(dt, 0.1);
      this.tick(dt);
    };
    requestAnimationFrame(frame);
  }

  tick(frameDt) {
    if (this.state === 'loading') return;
    this.elapsed += frameDt;

    const playing = this.state === 'countdown' || this.state === 'racing' || this.state === 'results';

    if (playing) {
      // Sub-step so a hitching frame cannot tunnel a kart through the world.
      let remaining = frameDt;
      while (remaining > 0) {
        const dt = Math.min(remaining, MAX_STEP);
        this.step(dt);
        remaining -= dt;
      }
    } else if (this.state === 'menu') {
      this.orbitMenuCamera(frameDt);
    }

    this.particles?.update(frameDt);
    this.world?.update(frameDt, this.elapsed);
    if (this.boostPadMeshes) this.animateBoostPads();

    if (this.hud && this.state !== 'menu' && this.state !== 'loading') {
      this.hud.update(frameDt, this.standings);
    }

    this.renderer.render(this.scene, this.camera);
  }

  step(dt) {
    if (this.state === 'countdown') this.stepCountdown(dt);
    if (this.state === 'racing' || this.state === 'results') this.raceTime += dt;

    const racing = this.state === 'racing' || this.state === 'results';

    // --- Gather input -----------------------------------------------------
    const playerInput = this.input.update(dt);
    const frozen = this.state === 'countdown';

    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      let input;
      if (kart.isPlayer) {
        input = frozen ? this.countdownInput(playerInput) : playerInput;
      } else {
        input = frozen ? EMPTY_INPUT : this.drivers[i].update(dt, this);
      }
      this.inputsByKart[i] = input;

      if (racing && input.useItem && kart.item) this.items.use(kart);
      if (kart.itemRoulette > 0) kart.itemRoulette = Math.max(0, kart.itemRoulette - dt);

      kart.update(dt, input);
    }

    this.resolveKartCollisions();
    if (racing) this.items.update(dt);
    this.updateStandings();
    this.updateCamera(dt);
    this.updateAudio();

    this.world.focusShadows(this.player.position);

    // Let the pack race on for a beat before the board comes up. Driven off the
    // race clock rather than a timer so pausing does not skip past it.
    if (this.state === 'results' && !this.resultsShown) {
      this.finishDelay -= dt;
      if (this.finishDelay <= 0) this.finalize();
    }
  }

  stepCountdown(dt) {
    this.countdown -= dt;

    // "Rocket start": squeeze the throttle just before the lights go out.
    if (this.input.state.throttle > 0.4) this.throttleHeld += dt;
    else this.throttleHeld = 0;

    const n = Math.ceil(this.countdown);
    if (n !== this.countdownFace) {
      this.countdownFace = n;
      if (n > 0 && n <= 3) {
        this.hud.countdown(String(n));
        this.audio.countdownBeep(false);
      }
    }

    if (this.countdown <= 0) {
      this.state = 'racing';
      this.raceTime = 0;
      this.hud.countdown('GO!', true);
      this.audio.countdownBeep(true);
      if (this.throttleHeld > 0.12 && this.throttleHeld < 0.85) {
        this.player.applyBoost(1.5, 2);
        this.hud.message('ROCKET START!', 'hot');
        this.audio.boost();
      }
      // CPUs get a small, varied jump off the line too.
      for (let i = 1; i < this.karts.length; i++) {
        if (Math.random() < 0.45) this.karts[i].applyBoost(0.6 + Math.random() * 0.7, 1);
      }
    }
  }

  countdownInput(playerInput) {
    // Steering is live on the grid, but the throttle is not.
    return {
      throttle: 0, brake: 0, steer: playerInput.steer * 0.35,
      drift: false, useItem: false, lookBack: playerInput.lookBack,
    };
  }

  // ------------------------------------------------------------- standings

  updateStandings() {
    const order = this.karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.distance - a.distance;
    });
    for (let i = 0; i < order.length; i++) order[i].place = i + 1;
    this.standings = order;
  }

  /** Nearest racer in front of `kart` along the track, within `range` metres. */
  nextRacerAhead(kart, range) {
    let best = null;
    let bestGap = Infinity;
    for (const other of this.karts) {
      if (other === kart) continue;
      const gap = other.distance - kart.distance;
      if (gap <= 2 || gap > range) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best;
  }

  nextRacerBehind(kart, range) {
    let best = null;
    let bestGap = Infinity;
    for (const other of this.karts) {
      if (other === kart) continue;
      const gap = kart.distance - other.distance;
      if (gap <= 2 || gap > range) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best;
  }

  lastInputFor(kart) {
    return this.inputsByKart[kart.index] || EMPTY_INPUT;
  }

  // ------------------------------------------------------------ collisions

  resolveKartCollisions() {
    const karts = this.karts;
    const minDist = KART.radius * 2;
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i];
        const b = karts[j];
        if (a.respawnTimer > 0 || b.respawnTimer > 0) continue;

        _v.copy(b.position).sub(a.position);
        const distSq = _v.lengthSq();
        if (distSq > minDist * minDist || distSq < 1e-6) continue;

        const dist = Math.sqrt(distSq);
        _v.multiplyScalar(1 / dist);
        const overlap = minDist - dist;

        a.position.addScaledVector(_v, -overlap * 0.5);
        b.position.addScaledVector(_v, overlap * 0.5);

        // Exchange a slice of the closing velocity so bumps feel weighty.
        const closing = _v2.copy(b.velocity).sub(a.velocity).dot(_v);
        if (closing < 0) {
          const impulse = -closing * 0.55;
          a.velocity.addScaledVector(_v, -impulse);
          b.velocity.addScaledVector(_v, impulse);
          if (Math.abs(closing) > 9) {
            const point = _v2.copy(a.position).add(b.position).multiplyScalar(0.5);
            this.particles.burst(point, 8, this.colors.driftDust, {
              speed: 5, size: 0.5, life: 0.35, up: 1.5,
            });
            if (a.isPlayer || b.isPlayer) {
              this.cameraShake = Math.max(this.cameraShake, 0.25);
              this.audio.wall();
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- camera

  snapCamera() {
    this.camYaw = this.player.yaw;
    this.updateCamera(1);
    const desired = this.desiredCameraPosition(this.player);
    this.camera.position.copy(desired);
  }

  desiredCameraPosition(kart, out = new THREE.Vector3()) {
    const back = this.lookingBack ? -1 : 1;
    const dir = _v.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).multiplyScalar(back);
    // Climb with the kart on a jump so the road does not fill the screen.
    const airLift = kart.grounded ? 0 : Math.min(9, Math.max(0, kart.proj.height) * 0.55);
    out.copy(kart.position)
      .addScaledVector(dir, -CAMERA.distance)
      .addScaledVector(this.camUp, CAMERA.height + airLift);
    return out;
  }

  updateCamera(dt) {
    const kart = this.player;
    this.lookingBack = !!this.lastInputFor(kart).lookBack;

    // Ease the camera yaw toward the kart's heading, wrapping cleanly.
    let d = kart.yaw - this.camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const yawRate = kart.grounded ? 7.5 : 3.4;
    this.camYaw += d * (1 - Math.exp(-yawRate * dt));

    // Bank the camera slightly with the road, but stay mostly world-up.
    _v2.copy(kart.visualUp).lerp(new THREE.Vector3(0, 1, 0), 0.62).normalize();
    this.camUp.lerp(_v2, 1 - Math.exp(-4 * dt)).normalize();

    const desired = this.desiredCameraPosition(kart, _v2.clone());
    const stiffness = kart.grounded ? CAMERA.stiffness : CAMERA.airStiffness;
    this.camera.position.lerp(desired, 1 - Math.exp(-stiffness * dt));

    // Never let the camera sink into the scenery...
    const ground = this.world.heightAt(this.camera.position.x, this.camera.position.z);
    if (ground !== null && this.camera.position.y < ground + 1.6) {
      this.camera.position.y = ground + 1.6;
    }
    // ...nor through the road deck, which floats well above the ground on the
    // viaduct and the mountain.
    if (!this._camProj) this._camProj = {};
    const camProj = this.track.project(this.camera.position, this._camHint ?? 0, this._camProj);
    this._camHint = camProj.index;
    const camSurf = this.track.surfaceAt(this.camera.position, camProj);
    if (camSurf && this.camera.position.y < camSurf.y + 1.9) {
      this.camera.position.y = camSurf.y + 1.9;
    }

    // Look a little ahead of the kart.
    const fwd = _v.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw))
      .multiplyScalar(this.lookingBack ? -1 : 1);
    this.lookTarget.lerp(
      _v.multiplyScalar(CAMERA.lookAhead).add(kart.position).addScaledVector(this.camUp, 1.5),
      1 - Math.exp(-9 * dt)
    );
    this.camera.lookAt(this.lookTarget);

    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6);
      const s = this.cameraShake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    // Widen the lens under boost -- cheap, effective speed cue.
    const speedFrac = Math.min(1, kart.velocity.length() / KART.topSpeed);
    const targetFov = kart.boostTimer > 0
      ? CAMERA.boostFov
      : CAMERA.fov + speedFrac * 5;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();
  }

  orbitMenuCamera(dt) {
    // Slow fly-around of the start straight while the menu is up.
    const t = this.elapsed * 0.13;
    const frame = this.track.frameAt(this.track.length * 0.05);
    const radius = 46;
    this.camera.position.set(
      frame.position.x + Math.cos(t) * radius,
      frame.position.y + 20,
      frame.position.z + Math.sin(t) * radius
    );
    this.camera.lookAt(frame.position.x, frame.position.y + 2, frame.position.z);
    this.world?.focusShadows(frame.position);
  }

  animateBoostPads() {
    const scroll = (this.elapsed * 1.6) % 1;
    for (const pad of this.boostPadMeshes) {
      pad.mat.map.offset.y = -scroll;
      pad.mat.opacity = 0.7 + Math.sin(this.elapsed * 5 + pad.def.s) * 0.22;
    }
  }

  updateAudio() {
    const p = this.player;
    const speedFrac = Math.min(1, p.velocity.length() / KART.topSpeed);
    const charge = p.driftActive ? Math.min(1, p.driftCharge / 3) : 0;
    this.audio.updateEngine(
      speedFrac, this.lastInputFor(p).throttle, charge, !p.grounded
    );
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------- event callbacks

  onLap(kart, lap) {
    if (!kart.isPlayer) return;
    if (lap === RACE.laps) this.hud.message('FINAL LAP!', 'bad');
    else this.hud.message(`LAP ${lap}`, 'cool');
    this.audio.lap();
  }

  onFinish(kart) {
    if (!kart.isPlayer) return;
    this.state = 'results';
    this.finishDelay = 2.4;
    this.resultsShown = false;
    this.audio.finish();
    this.hud.message('FINISH!', 'hot');
  }

  onMiniTurbo(kart, tier) {
    if (kart.isPlayer) {
      this.audio.miniTurbo(tier);
      this.cameraShake = Math.max(this.cameraShake, 0.12 + tier * 0.05);
    }
    this.particles.burst(kart.position, 16 + tier * 8, this.colors.driftTier[tier], {
      speed: 8, size: 0.7, life: 0.45, up: 2,
    });
  }

  onPadBoost(kart) {
    if (kart.isPlayer) this.audio.boost();
  }

  onLaunch(kart, ramp) {
    if (!kart.isPlayer) return;
    this.audio.launch();
    if (ramp.glider) this.hud.message('GLIDER!', 'cool');
  }

  onGliderOpen(kart) {
    if (kart.isPlayer) this.audio.glider();
  }

  onLand(kart, impact) {
    if (impact < 4) return;
    _v.copy(kart.position);
    this.particles.burst(_v, Math.min(24, 6 + impact), this.colors.landing, {
      speed: 5, size: 0.7, life: 0.5, up: 1.5,
    });
    if (kart.isPlayer && impact > 12) {
      this.cameraShake = Math.max(this.cameraShake, Math.min(0.5, impact * 0.02));
    }
  }

  onHop(kart) {
    if (kart.isPlayer) this.audio.hop();
  }

  onWallHit(kart, force) {
    if (!kart.isPlayer) return;
    this.audio.wall();
    this.cameraShake = Math.max(this.cameraShake, Math.min(0.4, force * 0.02));
  }

  onSpin(kart) {
    this.particles.burst(kart.position, 22, this.colors.smoke, {
      speed: 6, size: 0.9, life: 0.75, up: 2.5,
    });
    if (kart.isPlayer) {
      this.audio.hit();
      this.hud.hurt();
      this.cameraShake = Math.max(this.cameraShake, 0.45);
    }
  }

  onSquash(kart) {
    this.particles.burst(kart.position, 26, this.colors.blastCore, {
      speed: 9, size: 1.0, life: 0.7, up: 3,
    });
    if (kart.isPlayer) {
      this.audio.explosion();
      this.hud.hurt();
      this.cameraShake = Math.max(this.cameraShake, 0.6);
    }
  }

  onShieldBreak(kart) {
    this.particles.burst(kart.position, 30, new THREE.Color(0x7fe8ff), {
      speed: 11, size: 0.8, life: 0.6, up: 2,
    });
    if (kart.isPlayer) {
      this.audio.zap();
      this.hud.message('SHIELD DOWN', 'cool');
    }
  }

  onPulse(kart, hits) {
    this.audio.zap();
    if (kart.isPlayer && hits > 0) this.hud.message(`ZAPPED ${hits}`, 'hot');
  }

  onExplosion(position) {
    const d = position.distanceTo(this.player.position);
    if (d < 40) this.cameraShake = Math.max(this.cameraShake, (1 - d / 40) * 0.5);
    this.audio.explosion();
  }

  onPickup(kart) {
    if (kart.isPlayer) this.audio.pickup();
  }

  onItemUsed(kart, item) {
    if (kart.isPlayer && item === 'boost') this.audio.boost();
  }

  onFall(kart) {
    if (!kart.isPlayer) return;
    this.hud.message('OFF TRACK', 'bad');
    this.audio.hit();
  }
}

// ---------------------------------------------------------------- bootstrap

const game = new Game();
window.game = game;   // handy for poking at things from the console

document.getElementById('start-btn').disabled = true;
game.build().then(() => game.start()).catch((err) => {
  console.error(err);
  const note = document.getElementById('loading-note');
  if (note) note.textContent = `failed to start: ${err.message}`;
});
