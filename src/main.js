import * as THREE from 'three';
import { RACE, CAMERA, KART, NET, RACERS, AI_PROFILES, applyHandling } from './config.js';
import { TRACKS, DEFAULT_TRACK, trackById } from './tracks/index.js';
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
import { Menu } from './lobby.js';

const MAX_STEP = 1 / 30;   // never integrate a step bigger than this
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Items that put something into the world and therefore have to be replicated. */
const REPLICATED_ITEMS = new Set(['slick', 'bomb', 'rocket', 'emp']);

class Game {
  constructor() {
    this.state = 'loading';
    this.mode = 'solo';
    this.elapsed = 0;
    this.raceTime = 0;
    this.countdown = RACE.countdownSeconds;
    this.finishDelay = 0;
    this.cameraShake = 0;
    this.throttleHeld = 0;
    this.resultsShown = false;
    this.overlayPaused = false;
    this.netAccum = 0;
    this.net = null;
    this.trackId = null;

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
      CAMERA.fov, window.innerWidth / window.innerHeight, 0.4, 4000
    );
    this.camera.position.set(0, 20, -40);
    this.camYaw = 0;
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.lookTarget = new THREE.Vector3();
  }

  async boot() {
    this.input = new Input(window);
    this.input.bindTouch(document);
    this.audio = new Audio();
    this.menu = new Menu(this);
    this._wireInput();

    await this.loadTrack(DEFAULT_TRACK);

    this.state = 'menu';
    this.menu.onReady();
  }

  // ----------------------------------------------------------- track loading

  /**
   * Build (or rebuild) everything that belongs to a circuit. Yields between the
   * heavy steps so the loading text can actually paint.
   *
   * @param roster  optional array of {name, color, accent, remote, netId} in grid
   *                order -- multiplayer supplies real players plus CPU filler.
   */
  async loadTrack(trackId, { roster = null, localSlot = 0, note = null } = {}) {
    const def = trackById(trackId);
    const STEPS = 5;
    let done = 0;
    const say = (text) => {
      if (note) note(text);
      this.menu?.onLoadStep(text, done / STEPS);
    };
    const step = async (label, fn) => {
      say(label);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const result = fn();
      done++;
      return result;
    };

    // Nothing may tick while the world is being swapped out from under it.
    this.state = 'loading';
    this.unloadTrack();
    applyHandling(def.handling);

    this.trackId = def.id;
    this.track = await step('laying out the circuit…', () => {
      const track = new Track(def);
      track.theme = { ...def.theme, key: def.id };
      return track;
    });
    RACE.laps = this.track.laps;

    await step('paving…', () => {
      const built = buildTrackMesh(this.track);
      this.trackGroup = built.group;
      this.scene.add(built.group);
      this.boostPadMeshes = built.boostPads;
    });
    await step('raising the landscape…', () => {
      this.world = new World(this.scene, this.track);
    });
    await step('rolling out the grid…', () => {
      this.particles = new Particles(this.scene);
      this.buildField(roster, localSlot);
      this.items = new ItemSystem(this);
    });
    await step('ready', () => {
      if (this.hud) this.hud.bindTrack();
      else this.hud = new HUD(this);
      this.resetRace();
    });
    say('ready when you are');
  }

  unloadTrack() {
    if (this.karts) for (const kart of this.karts) kart.dispose();
    this.karts = null;
    this.items?.dispose();
    this.items = null;
    this.world?.dispose();
    this.world = null;
    if (this.trackGroup) {
      this.scene.remove(this.trackGroup);
      this.trackGroup.traverse((node) => {
        node.geometry?.dispose?.();
        const mat = node.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      this.trackGroup = null;
    }
    if (this.particles) {
      this.scene.remove(this.particles.points);
      this.particles.geo.dispose();
      this.particles.points.material.dispose();
      this.particles = null;
    }
    this.track?.dispose();
    this.track = null;
    this.boostPadMeshes = null;
  }

  /** Create the karts, their drivers and the grid order. */
  buildField(roster, localSlot) {
    const entries = roster || RACERS.map((r) => ({ ...r, remote: false }));
    this.karts = [];
    this.drivers = [];
    this.inputsByKart = [];
    this.localSlot = roster ? localSlot : 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const kart = new Kart(this, i, entry);
      kart.remote = !!entry.remote;
      kart.netId = entry.netId || null;
      kart.netSlot = i;
      kart.isPlayer = i === this.localSlot;
      kart.tag.visible = !kart.isPlayer;
      // Solo: the player starts at the back of the grid. Multiplayer: everyone
      // lines up in the order the server dealt out.
      kart.gridIndex = roster ? i : (i === 0 ? entries.length - 1 : i - 1);
      this.karts.push(kart);
      this.inputsByKart.push(EMPTY_INPUT);

      const wantsAI = !kart.remote && !kart.isPlayer;
      this.drivers.push(
        wantsAI ? new AIDriver(kart, AI_PROFILES[i] || AI_PROFILES[1], i) : null
      );
    }
    this.player = this.karts[this.localSlot];
    Object.assign(this, makeRubberBand(this));
  }

  _wireInput() {
    this.input.onAction = (action) => {
      if (action === 'pause') {
        if (this.state === 'racing' || this.state === 'countdown') this.setPaused(true);
        else if (this.overlayPaused || this.state === 'paused') this.setPaused(false);
      } else if (action === 'mute') {
        this.audio.setMuted(!this.audio.muted);
        this.hud?.message(this.audio.muted ? 'MUTED' : 'SOUND ON', 'cool');
      } else if (action === 'respawn') {
        if (this.state === 'racing' && !this.player.isStunned) this.player.startRespawn();
      } else if (action === 'confirm') {
        this.menu?.onConfirm();
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'racing' && this.mode === 'solo') this.setPaused(true);
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
    this.netAccum = 0;
    this.items?.reset();

    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      const slot = this.track.gridSlot(kart.gridIndex);
      kart.placeAt(slot.s, slot.lateral);
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
      kart.left = false;
      kart.net.valid = false;
      kart.model.visible = true;
      kart.place = i + 1;
    }

    this.updateStandings();
    this.snapCamera();
  }

  beginRace() {
    this.audio.start();
    this.resetRace();
    this.hud.show();
    this.state = 'countdown';
    this.countdownFace = -1;
  }

  setPaused(paused) {
    const el = document.getElementById('pause-screen');
    // In a multiplayer race the world keeps turning: the overlay is a menu, not
    // a freeze frame, or everybody else would drive off without you.
    if (this.mode === 'net') {
      if (paused && (this.state === 'racing' || this.state === 'countdown')) {
        this.overlayPaused = true;
        el.hidden = false;
      } else if (!paused) {
        this.overlayPaused = false;
        el.hidden = true;
      }
      return;
    }
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
    // Solo: give every unfinished kart a plausible time rather than a bare DNF
    // and call it a day. Networked: the race is genuinely still on for everyone
    // who has not crossed the line, so nothing gets a made-up time and the board
    // keeps updating as they come in.
    if (this.mode === 'solo') {
      for (const kart of this.karts) {
        if (kart.finished || kart.left) continue;
        const remaining = this.track.raceDistance - kart.distance;
        const pace = Math.max(18, kart.distance / Math.max(1, this.raceTime));
        kart.finished = true;
        kart.finishTime = this.raceTime + remaining / pace;
      }
    }
    this.updateStandings();
    this.resultsShown = true;
    this.resultsSignature = this.standingsSignature();
    this.hud.showResults(this.standings, this.mode === 'net');
  }

  standingsSignature() {
    return this.standings.map((k) => `${k.index}:${k.finished ? 1 : 0}`).join(',');
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
    if (this.state === 'loading' || !this.track || !this.karts) return;
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
      this.pumpNetwork(frameDt);
    } else if (this.state === 'menu') {
      this.orbitMenuCamera(frameDt);
    }

    this.particles?.update(frameDt);
    this.world?.update(frameDt, this.elapsed, this.camera);
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
      let input = EMPTY_INPUT;
      if (kart.remote) {
        kart.update(dt, input);
        continue;
      }
      if (kart.isPlayer) {
        input = frozen ? this.countdownInput(playerInput) : playerInput;
      } else if (this.drivers[i]) {
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
    } else if (this.state === 'results' && this.mode === 'net') {
      // Redraw the board as the rest of the grid takes the flag.
      const signature = this.standingsSignature();
      if (signature !== this.resultsSignature) {
        this.resultsSignature = signature;
        this.hud.showResults(this.standings, true);
      }
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
      for (const kart of this.karts) {
        if (kart.isPlayer || kart.remote) continue;
        if (Math.random() < 0.45) kart.applyBoost(0.6 + Math.random() * 0.7, 1);
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

  // ------------------------------------------------------------- multiplayer

  /** Hand the game a connected client; the menu owns the lobby side of it. */
  attachNet(net) {
    this.net = net;
    net.on('state', (msg) => this.onNetState(msg));
    net.on('event', (msg) => this.onNetEvent(msg));
    net.on('left', (msg) => this.onNetLeft(msg));
    net.on('room', (msg) => this.onNetRoom(msg));
    net.on('close', () => {
      if (this.mode === 'net' && this.state !== 'menu') {
        this.hud?.message('DISCONNECTED', 'bad');
      }
    });
  }

  pumpNetwork(dt) {
    if (this.mode !== 'net' || !this.net?.connected) return;
    this.netAccum += dt;
    if (this.netAccum < 1 / NET.sendHz) return;
    this.netAccum = 0;
    const states = [];
    for (const kart of this.karts) {
      if (!kart.remote && !kart.left) states.push(kart.toNetState());
    }
    this.net.sendStates(states);
  }

  onNetState(msg) {
    if (!this.karts || !Array.isArray(msg.k)) return;
    for (const a of msg.k) {
      const kart = this.karts[a[0]];
      if (!kart || !kart.remote) continue;
      kart.applyNetState(a);
    }
  }

  onNetEvent(msg) {
    if (!this.items || !this.karts) return;
    const kart = this.karts[msg.slot];
    switch (msg.ev) {
      case 'item':
        if (kart && kart.remote) this.items.useRemote(kart, msg.item);
        break;
      case 'box':
        this.items.takeBox(msg.i);
        break;
      default:
        break;
    }
  }

  onNetLeft(msg) {
    const kart = this.karts?.[msg.slot];
    if (!kart || !kart.remote) return;
    kart.left = true;
    kart.model.visible = false;
    kart.finished = true;
    if (!kart.finishTime) kart.finishTime = 0;
  }

  /**
   * The host simulates the CPUs. If the host walks out mid-race the server
   * promotes somebody else -- who has to pick the abandoned karts up, or six of
   * them would simply stop dead on the racing line.
   */
  onNetRoom(msg) {
    if (this.mode !== 'net' || !this.karts) return;
    if (msg.host !== this.net?.id) return;
    if (!['countdown', 'racing', 'results'].includes(this.state)) return;

    let adopted = 0;
    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      if (!kart.remote || kart.netId || kart.left) continue;
      kart.remote = false;
      kart.net.valid = false;
      kart.project();
      kart.syncProgressFromDistance();
      this.drivers[i] = new AIDriver(kart, AI_PROFILES[i] || AI_PROFILES[1], i);
      adopted++;
    }
    if (adopted) this.hud?.message('CPU HANDOVER', 'cool');
  }

  /** Load a circuit for a networked race and tell the server when we are set. */
  async startNetRace(trackId, players, localId) {
    this.mode = 'net';
    const roster = [];
    for (const p of players) {
      const livery = RACERS[p.slot % RACERS.length];
      roster.push({
        name: p.name,
        color: livery.color,
        accent: livery.accent,
        remote: p.id !== localId,
        netId: p.id,
      });
    }
    const isHost = this.net?.isHost;
    for (let i = roster.length; i < RACE.racerCount; i++) {
      const livery = RACERS[i % RACERS.length];
      // CPUs are simulated by the host and mirrored by everybody else.
      roster.push({ name: `CPU ${livery.name}`, color: livery.color, accent: livery.accent, remote: !isHost });
    }
    const localSlot = players.findIndex((p) => p.id === localId);
    await this.loadTrack(trackId, { roster, localSlot: Math.max(0, localSlot) });
    this.net.reportLoaded();
  }

  /** The server's shared start stamp; everyone drops the clutch together. */
  scheduleNetStart(atServerMs) {
    const delay = Math.max(0, atServerMs - this.net.serverNow());
    setTimeout(() => {
      if (this.mode !== 'net') return;
      this.beginRace();
    }, delay);
  }

  async startSolo(trackId) {
    const wasNetworked = this.mode === 'net';
    this.mode = 'solo';
    if (wasNetworked || trackId !== this.trackId) await this.loadTrack(trackId);
    this.beginRace();
  }

  /** Drop out of a race (or a results board) and back to the attract camera. */
  returnToMenu() {
    this.state = 'menu';
    this.overlayPaused = false;
    this.hud?.hide();
    this.hud?.hideResults();
    document.getElementById('pause-screen').hidden = true;
  }

  // ------------------------------------------------------------- standings

  updateStandings() {
    const order = this.karts.filter((k) => !k.left).sort((a, b) => {
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
      if (other === kart || other.left) continue;
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
      if (other === kart || other.left) continue;
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
        if (a.left || b.left) continue;
        // Two remote karts are somebody else's problem; pushing them apart here
        // would only fight the state stream.
        if (a.remote && b.remote) continue;

        _v.copy(b.position).sub(a.position);
        const distSq = _v.lengthSq();
        if (distSq > minDist * minDist || distSq < 1e-6) continue;

        const dist = Math.sqrt(distSq);
        _v.multiplyScalar(1 / dist);
        const overlap = minDist - dist;

        // Only shove the karts this client actually owns.
        const aFree = !a.remote;
        const bFree = !b.remote;
        const share = aFree && bFree ? 0.5 : 1;
        if (aFree) a.position.addScaledVector(_v, -overlap * share);
        if (bFree) b.position.addScaledVector(_v, overlap * share);

        // Exchange a slice of the closing velocity so bumps feel weighty.
        const closing = _v2.copy(b.velocity).sub(a.velocity).dot(_v);
        if (closing < 0) {
          const impulse = -closing * 0.55;
          if (aFree) a.velocity.addScaledVector(_v, -impulse);
          if (bFree) b.velocity.addScaledVector(_v, impulse);
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
    const frame = this.track.frameAt(this.track.startLineS + this.track.length * 0.02);
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
    if (lap === this.track.laps) this.hud.message('FINAL LAP!', 'bad');
    else this.hud.message(`LAP ${lap}`, 'cool');
    this.audio.lap();
  }

  onMissedCheckpoint(kart) {
    if (!kart.isPlayer) return;
    this.hud.message('MISSED A CHECKPOINT', 'bad');
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

  onBoxTaken(kart, index) {
    if (this.mode === 'net') this.net?.sendEvent('box', { i: index, slot: kart.netSlot });
  }

  onItemUsed(kart, item) {
    if (kart.isPlayer && item === 'boost') this.audio.boost();
    if (this.mode === 'net' && !kart.remote && REPLICATED_ITEMS.has(item)) {
      this.net?.sendEvent('item', { slot: kart.netSlot, item });
    }
  }

  onFall(kart) {
    if (!kart.isPlayer) return;
    this.hud.message('OFF TRACK', 'bad');
    this.audio.hit();
  }
}

// ---------------------------------------------------------------- bootstrap

const game = new Game();
game.tracks = TRACKS;
window.game = game;   // handy for poking at things from the console

game.boot().then(() => game.start()).catch((err) => {
  console.error(err);
  const note = document.getElementById('loading-note');
  if (note) note.textContent = `failed to start: ${err.message}`;
});
