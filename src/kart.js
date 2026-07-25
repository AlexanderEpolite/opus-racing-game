import * as THREE from 'three';
import { KART } from './config.js';
import { makeKart, makeNameTag } from './models.js';

/**
 * A racing kart.
 *
 * Movement is arcade, not simulation: on the ground the velocity is rebuilt each
 * frame from a forward component (throttle/brake/boost) and a sideways component
 * that bleeds off according to grip -- lowering that grip is what makes a drift a
 * drift. In the air the kart keeps a true 3D velocity so ramps, gliding and
 * landings all fall out of the same integrator.
 *
 * The same `update(dt, input)` drives the player and the CPUs; only the source of
 * `input` differs.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const KERB_WIDTH = 1.2;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export const EMPTY_INPUT = {
  throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, lookBack: false,
};

export class Kart {
  constructor(game, index, def) {
    this.game = game;
    this.track = game.track;
    this.index = index;
    this.def = def;
    this.isPlayer = index === 0;
    this.color = new THREE.Color(def.color);

    // --- Transform ---
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.airTime = 0;
    this.surfaceNormal = WORLD_UP.clone();
    this.visualUp = WORLD_UP.clone();

    // --- Track space ---
    this.proj = { s: 0, index: 0, lateral: 0, height: 0, halfWidth: 10, frame: null };
    this.hint = 0;
    this.prevS = 0;
    this.distance = 0;
    this.lap = 1;
    this.place = index + 1;
    this.finished = false;
    this.finishTime = 0;

    // --- Progress policing ---
    // Every checkpoint has to be swept past in order before the line counts, and
    // recorded distance can never run ahead of "laps actually completed plus
    // where you are right now". Together these mean no amount of leaving the
    // course can buy a metre of progress.
    this.cpHit = new Uint8Array(this.track.checkpoints.length);
    this.crossings = 0;

    // --- Networking (remote karts are driven by their owner's client) ---
    this.remote = false;
    this.netSlot = index;
    this.net = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0,
      age: 0,
      valid: false,
    };

    // --- Drift / boost ---
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftActive = false;
    this.driftArmed = false;
    this.boostTimer = 0;
    this.boostTier = 0;
    this.lastMiniTurbo = 0;

    // --- Flight ---
    this.gliderArmed = false;
    this.gliding = false;
    this.gliderBlend = 0;
    this.launchSpeed = 0;

    // --- Status ---
    this.item = null;
    this.itemRoulette = 0;
    this.spinTimer = 0;
    this.squashTimer = 0;
    this.shieldTimer = 0;
    this.empTimer = 0;
    this.respawnTimer = 0;
    this.invulnTimer = 0;
    this.offroad = false;
    this.onKerb = false;
    this.hitFlash = 0;

    // --- Visuals ---
    const built = makeKart(def.color, def.accent);
    this.model = built.group;
    this.parts = built;
    this.model.position.copy(this.position);
    game.scene.add(this.model);

    this.tag = makeNameTag(def.name, def.color);
    this.model.add(this.tag);
    this.tag.visible = !this.isPlayer;

    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.bodyRoll = 0;
    this.squash = 1;
    this.exhaustAccum = 0;
  }

  // ------------------------------------------------------------------ setup

  /** Place the kart on the grid (or back on track after a fall). */
  placeAt(s, lateral, { keepDistance = false } = {}) {
    const frame = this.track.frameAt(s);
    this.position.copy(frame.position).addScaledVector(frame.right, lateral).addScaledVector(frame.normal, 0.02);
    this.yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.airTime = 0;
    this.gliding = false;
    this.gliderArmed = false;
    this.surfaceNormal.copy(frame.normal);
    this.visualUp.copy(frame.normal);
    this.hint = this.track.indexAt(s);
    this.prevS = s;
    if (!keepDistance) {
      // Grid slots sit behind the line, so lap 1 completes on the first crossing.
      this.distance = this.track.distanceAt(s);
      this.resetProgress(s);
    }
    this.cancelDrift();
    this.syncModel(0);
  }

  /**
   * Arm the checkpoint sequence for a kart sitting on the grid. Everything the
   * kart has already driven past counts as visited, so the first crossing of the
   * line is the start of lap 1 rather than a rejected lap.
   */
  resetProgress(s) {
    const cps = this.track.checkpoints;
    if (this.cpHit.length !== cps.length) this.cpHit = new Uint8Array(cps.length);
    this.cpHit.fill(0);
    this.crossings = 0;
    if (this.track.closed) {
      for (let i = 1; i < cps.length; i++) this.cpHit[i] = cps[i] <= s ? 1 : 0;
    }
  }

  // ----------------------------------------------------------------- update

  update(dt, input) {
    if (this.remote) {
      this.updateRemote(dt);
      return;
    }
    if (this.finished) input = this.finishedInput();

    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.empTimer = Math.max(0, this.empTimer - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.boostTimer === 0) this.boostTier = 0;

    if (this.respawnTimer > 0) {
      this.updateRespawn(dt);
      return;
    }

    // Spun-out karts keep sliding but ignore input.
    const stunned = this.spinTimer > 0 || this.squashTimer > 0;
    if (stunned) {
      this.spinTimer = Math.max(0, this.spinTimer - dt);
      this.squashTimer = Math.max(0, this.squashTimer - dt);
      input = EMPTY_INPUT;
      this.cancelDrift();
    }

    this.lastSteer = input.steer;
    this.project();
    this.updateSurfaceState();

    if (this.grounded) this.groundStep(dt, input, stunned);
    else this.airStep(dt, input);

    this.position.addScaledVector(this.velocity, dt);

    // Re-project first: the ramp check compares where we were at the end of the
    // last frame against where we are now, so a lip is never stepped over.
    this.project();
    this.checkRampLaunch();
    this.resolveGround(dt);
    this.resolveWalls(dt);
    this.checkFall();
    this.advanceDistance();
    this.syncModel(dt);
  }

  /**
   * A kart that has taken the flag coasts to a stop. On a sprint that matters:
   * there is only so much run-off past the line before the road runs out.
   */
  finishedInput() {
    if (this.track.closed) return EMPTY_INPUT;
    return { throttle: 0, brake: 1, steer: 0, drift: false, useItem: false, lookBack: false };
  }

  project() {
    this.track.project(this.position, this.hint, this.proj);
    this.hint = this.proj.index;
  }

  updateSurfaceState() {
    const hw = this.proj.halfWidth;
    const absLat = Math.abs(this.proj.lateral);
    this.onKerb = absLat > hw && absLat <= hw + KERB_WIDTH;
    this.offroad = absLat > hw + KERB_WIDTH;
    if (this.proj.frame) this.surfaceNormal.copy(this.proj.frame.normal);
  }

  get forward() {
    // Heading projected into the current surface plane.
    const up = this.grounded ? this.surfaceNormal : WORLD_UP;
    _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _v1.addScaledVector(up, -_v1.dot(up));
    if (_v1.lengthSq() < 1e-6) _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return _v1.normalize();
  }

  get speed() {
    return this.velocity.dot(this.forward);
  }

  get speedKmh() {
    return Math.max(0, this.velocity.length() * 3.6);
  }

  // ------------------------------------------------------------ ground step

  groundStep(dt, input, stunned) {
    const fwd = this.forward.clone();
    const up = this.surfaceNormal;
    const side = _v2.crossVectors(up, fwd).normalize().clone();

    let vFwd = this.velocity.dot(fwd);
    let vSide = this.velocity.dot(side);

    // --- Surface multipliers --------------------------------------------
    let surfaceMul = 1;
    if (this.offroad) surfaceMul = KART.offroadSpeedMul;
    else if (this.onKerb) surfaceMul = 0.95;

    let maxSpeed = KART.topSpeed * surfaceMul;
    if (this.boostTimer > 0) maxSpeed += KART.boostTopSpeedBonus;
    if (this.empTimer > 0) maxSpeed *= 0.5;
    if (stunned) maxSpeed *= KART.spinSpeedMul;

    // --- Longitudinal ----------------------------------------------------
    if (input.brake > 0 && vFwd > 0.6) {
      vFwd -= KART.brakeAccel * dt;
    } else {
      const target = input.throttle > 0
        ? maxSpeed * input.throttle
        : input.brake > 0 ? -KART.reverseSpeed : 0;
      const k = input.throttle > 0 ? KART.accelTau : 0.9;
      vFwd += (target - vFwd) * (1 - Math.exp(-k * dt));
      if (!input.throttle && !input.brake) {
        vFwd -= Math.sign(vFwd) * KART.coastDrag * dt * 0.4;
      }
    }
    if (this.boostTimer > 0) vFwd += KART.boostAccel * dt;
    vFwd = THREE.MathUtils.clamp(vFwd, -KART.reverseSpeed, maxSpeed);

    // --- Drift bookkeeping ----------------------------------------------
    this.updateDrift(dt, input, vFwd);

    // --- Steering ---------------------------------------------------------
    const absV = Math.abs(vFwd);
    const speedFrac = THREE.MathUtils.clamp(absV / KART.topSpeed, 0, 1);
    const authority =
      THREE.MathUtils.clamp(absV / KART.turnSpeedFloor, 0, 1) *
      (1 - KART.turnHighSpeedFalloff * speedFrac);

    let steerEff = input.steer;
    if (this.driftActive) {
      // Leaning into the drift tightens it; countersteering opens it out. The
      // kart keeps rotating even with the stick centred.
      const agree = THREE.MathUtils.clamp(input.steer * this.driftDir, -1, 1);
      const m = THREE.MathUtils.lerp(KART.driftSteerOuter, KART.driftSteerInner, (agree + 1) / 2);
      steerEff = this.driftDir * m;
    }

    let yawRate = -steerEff * KART.turnRate * authority;
    if (this.driftActive) yawRate += -this.driftDir * KART.driftYawBias;
    if (vFwd < -0.5) yawRate = -yawRate;
    if (stunned && this.spinTimer > 0) yawRate = 11 * (this.spinDir || 1);
    this.yaw += yawRate * dt;

    // --- Grip -------------------------------------------------------------
    let grip = KART.grip;
    if (this.driftActive) grip = KART.driftGrip;
    else if (this.offroad) grip = KART.offroadGrip;
    if (stunned) grip = 1.1;
    vSide *= Math.exp(-grip * dt);

    // Rebuild the velocity around the (possibly rotated) heading.
    const newFwd = this.forward;
    const newSide = _v2.crossVectors(this.surfaceNormal, newFwd).normalize();
    this.velocity.copy(newFwd).multiplyScalar(vFwd).addScaledVector(newSide, vSide);

    // Rumble when running wide.
    if (this.offroad && absV > 6) {
      this.velocity.addScaledVector(newSide, (Math.random() - 0.5) * KART.offroadShake);
    }

    // The hop is applied last so the velocity rebuild above cannot erase it.
    if (this.hopRequested) {
      this.hopRequested = false;
      this.velocity.addScaledVector(this.surfaceNormal, KART.hopVelocity);
      this.grounded = false;
      this.airTime = 0;
      this.launchSpeed = Math.abs(vFwd);
    }

    this.checkBoostPads();
  }

  updateDrift(dt, input, vFwd) {
    const canDrift = vFwd > KART.driftMinSpeed && !this.offroad;

    if (input.drift && !this.driftArmed && !this.driftActive && this.grounded && canDrift) {
      // Hop first; the drift only engages once the wheels are back down.
      this.driftArmed = true;
      this.driftDir = Math.abs(input.steer) > 0.15 ? Math.sign(input.steer) : 0;
      this.hopRequested = true;
      this.game.onHop?.(this);
    }

    if (this.driftActive) {
      if (!input.drift || !canDrift) {
        this.releaseDrift();
      } else {
        // Charges to a blue spark in a little over half a second, so a single
        // ordinary corner is enough to earn something.
        this.driftCharge += dt * (0.9 + 0.5 * Math.min(1, vFwd / KART.topSpeed));
        this.emitDriftSparks(dt);
      }
    }
  }

  /** Called on touchdown: turn an armed hop into an actual drift. */
  landDrift(input) {
    if (!this.driftArmed) return;
    this.driftArmed = false;
    if (!input.drift) return;
    const dir = Math.abs(input.steer) > 0.15 ? Math.sign(input.steer) : this.driftDir;
    if (!dir) return;
    this.driftDir = dir;
    this.driftActive = true;
    this.driftCharge = 0;
  }

  releaseDrift() {
    const tier = this.driftTier();
    if (tier >= 0) {
      const spec = KART.miniTurbo[tier];
      this.applyBoost(spec.duration, tier + 1);
      this.lastMiniTurbo = tier + 1;
      this.game.onMiniTurbo?.(this, tier);
    }
    this.cancelDrift();
  }

  cancelDrift() {
    this.driftActive = false;
    this.driftArmed = false;
    this.driftCharge = 0;
    this.driftDir = 0;
  }

  driftTier() {
    let tier = -1;
    for (let i = 0; i < KART.miniTurbo.length; i++) {
      if (this.driftCharge >= KART.miniTurbo[i].charge) tier = i;
    }
    return tier;
  }

  applyBoost(duration, tier = 1) {
    this.boostTimer = Math.max(this.boostTimer, duration);
    this.boostTier = Math.max(this.boostTier, tier);
  }

  // --------------------------------------------------------------- air step

  airStep(dt, input) {
    this.airTime += dt;

    const overGap = this.track.inGap(this.proj.s);
    const heightAboveRoad = this.proj.height;

    // Deploy the wing once we are clearly airborne and starting to come down.
    if (!this.gliding &&
        (this.gliderArmed || overGap) &&
        this.airTime > KART.glideMinAirtime &&
        this.velocity.y < 2 &&
        (overGap || heightAboveRoad > KART.glideMinHeight)) {
      this.gliding = true;
      this.game.onGliderOpen?.(this);
    }

    let steerRate = KART.airTurnRate;

    if (this.gliding) {
      // W dives, S floats -- push forward to go down, exactly like a wing.
      const pitch = THREE.MathUtils.clamp(input.brake - input.throttle, -1, 1);
      const terminal = KART.glideTerminal - pitch * KART.glidePitchRange;

      this.velocity.y -= KART.glideGravity * dt;
      if (this.velocity.y < -terminal) this.velocity.y = -terminal;

      // Diving trades altitude for speed.
      const fwd = this.forward;
      const along = this.velocity.dot(fwd);
      const push = KART.glideForward + (-pitch) * 7;
      if (along < KART.topSpeed + KART.boostTopSpeedBonus) {
        this.velocity.addScaledVector(fwd, push * dt);
      }
      steerRate = KART.airTurnRate * 1.5;
      this.gliderBlend = Math.min(1, this.gliderBlend + dt * 5);
      this.emitGlideTrail(dt);
    } else {
      this.velocity.y -= KART.gravity * dt;
      this.gliderBlend = Math.max(0, this.gliderBlend - dt * 6);
    }

    if (this.boostTimer > 0) {
      this.velocity.addScaledVector(this.forward, KART.boostAccel * 0.5 * dt);
    }

    // Air steering also swings the velocity, so you can adjust your landing.
    const yawDelta = -input.steer * steerRate * dt;
    this.yaw += yawDelta;
    const carry = this.gliding ? 0.92 : 0.55;
    _q1.setFromAxisAngle(WORLD_UP, yawDelta * carry);
    const vy = this.velocity.y;
    this.velocity.y = 0;
    this.velocity.applyQuaternion(_q1);
    this.velocity.y = vy;

    // The invisible safety line that guarantees a committed launch reaches the
    // far side of a gap.
    if (this.gliding && overGap && this.launchSpeed >= KART.glideAssistMinSpeed) {
      const floor = this.track.glideFloor(this.proj.s);
      if (this.position.y < floor) {
        this.position.y = floor;
        if (this.velocity.y < 0) this.velocity.y *= 0.35;
      }
    }
  }

  checkRampLaunch() {
    const vFwd = this.speed;
    if (!this.grounded || vFwd < 5) return;
    const ds = this.track.wrapDelta(this.proj.s - this.prevS);
    if (ds <= 0) return;
    for (const ramp of this.track.ramps) {
      const before = this.track.wrapDelta(ramp.end - this.prevS);
      const after = this.track.wrapDelta(ramp.end - this.proj.s);
      // Did the lip pass beneath us this frame?
      if (before > 0 && after <= 0 && before <= ds + 0.5) {
        this.launch(ramp, vFwd);
        return;
      }
    }
  }

  launch(ramp, vFwd) {
    this.grounded = false;
    this.airTime = 0;
    this.launchSpeed = vFwd;
    this.velocity.y = vFwd * ramp.slope * ramp.kick;
    this.gliderArmed = ramp.glider;
    this.cancelDrift();
    this.game.onLaunch?.(this, ramp);
  }

  checkBoostPads() {
    const s = this.proj.s;
    for (const pad of this.track.boostPads) {
      if (Math.abs(this.track.wrapDelta(s - pad.s)) > pad.halfLength) continue;
      if (Math.abs(this.proj.lateral - pad.x) > pad.halfWidth) continue;
      if (this.boostTimer < KART.padBoostDuration * 0.8) {
        this.applyBoost(KART.padBoostDuration, 2);
        this.game.onPadBoost?.(this, pad);
      }
      return;
    }
  }

  // ----------------------------------------------------- ground resolution

  resolveGround(dt) {
    const surf = this.track.surfaceAt(this.position, this.proj);
    if (!surf) {
      // Nothing underneath -- we are over a gap.
      if (this.grounded) {
        this.grounded = false;
        this.airTime = 0;
        this.launchSpeed = Math.abs(this.speed);
      }
      return;
    }

    const above = this.position.y - surf.y;

    if (this.grounded) {
      if (above > KART.groundSnap) {
        this.grounded = false;
        this.airTime = 0;
        this.launchSpeed = Math.abs(this.speed);
      } else {
        this.position.y = surf.y;
        this.velocity.addScaledVector(surf.normal, -this.velocity.dot(surf.normal));
      }
      return;
    }

    if (above <= 0.02 && this.velocity.y <= 0.5) this.land(surf);
  }

  land(surf) {
    const impact = -this.velocity.y;
    this.position.y = surf.y;
    this.grounded = true;
    this.velocity.y = 0;
    this.surfaceNormal.copy(surf.normal);

    const wasGliding = this.gliding;
    this.gliding = false;
    this.gliderArmed = false;

    // Realign the heading with where we were actually travelling, so a long
    // flight does not end sideways.
    const horiz = _v1.set(this.velocity.x, 0, this.velocity.z);
    if (horiz.lengthSq() > 4) {
      const travelYaw = Math.atan2(horiz.x, horiz.z);
      let d = travelYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * 0.5;
    }

    if (impact > 16 && !wasGliding) {
      // Heavy landings scrub a little speed.
      const fwd = this.forward;
      const vf = this.velocity.dot(fwd);
      this.velocity.copy(fwd).multiplyScalar(vf * 0.9);
      this.squash = 0.6;
    } else {
      this.squash = 0.82;
    }

    this.landDrift(this.game.lastInputFor(this));
    this.game.onLand?.(this, impact);
  }

  /**
   * Barriers on the ground, an invisible corridor in the air.
   *
   * Karts used to be allowed to sail straight over the barriers on a big jump.
   * That turned the glider into a shortcut tool: leave the course sideways, come
   * down on a section a third of a lap further on, and keep the distance. Now a
   * flight is confined to a slightly wider version of the same tube it launched
   * from -- you can still fly wherever the course goes, just not off it.
   */
  resolveWalls(dt) {
    const inGap = this.track.inGap(this.proj.s);
    const airborne = !this.grounded;
    const limit = airborne
      ? this.track.airLimit(this.proj.halfWidth, inGap)
      : this.track.wallLimit(this.proj.halfWidth);
    const lat = this.proj.lateral;
    if (Math.abs(lat) <= limit) return;

    const over = Math.abs(lat) - limit;
    const dir = Math.sign(lat);
    const frame = this.proj.frame;
    this.position.addScaledVector(frame.right, -dir * over);

    const vSide = this.velocity.dot(frame.right);
    if (vSide * dir > 0) {
      if (airborne) {
        // Nothing to bounce off up here: just kill the outward drift so the
        // flight continues down the course instead of away from it.
        this.velocity.addScaledVector(frame.right, -vSide);
      } else {
        this.velocity.addScaledVector(frame.right, -vSide * 1.25);
        const fwd = this.forward;
        const vf = this.velocity.dot(fwd);
        this.velocity.copy(fwd).multiplyScalar(vf * 0.86);
        if (Math.abs(vSide) > 6) this.game.onWallHit?.(this, Math.abs(vSide));
      }
    }
    if (!airborne) this.cancelDrift();
  }

  checkFall() {
    if (this.respawnTimer > 0) return;
    const roadY = this.proj.frame ? this.proj.frame.position.y : 0;
    if (this.position.y < roadY - 26 || this.position.y < -14) {
      this.startRespawn();
    }
  }

  startRespawn() {
    this.respawnTimer = KART.respawnDuration;
    this.respawnFromS = this.proj.s;
    this.respawnTarget = this.track.respawnPoint(this.proj.s);
    this.velocity.set(0, 0, 0);
    this.gliding = false;
    this.gliderArmed = false;
    this.cancelDrift();
    this.boostTimer = 0;
    this.game.onFall?.(this);
  }

  updateRespawn(dt) {
    this.respawnTimer -= dt;
    const t = 1 - this.respawnTimer / KART.respawnDuration;
    const frame = this.track.frameAt(this.respawnTarget);

    // Lower the kart back onto the road on a tow line.
    const drop = (1 - THREE.MathUtils.smoothstep(t, 0.25, 0.95)) * 14;
    this.position.copy(frame.position).addScaledVector(frame.normal, drop + 0.02);
    this.yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
    this.surfaceNormal.copy(frame.normal);
    this.velocity.set(0, 0, 0);
    this.hint = this.track.indexAt(this.respawnTarget);

    if (this.respawnTimer <= 0) {
      this.respawnTimer = 0;
      this.grounded = true;
      this.invulnTimer = 1.4;
      // The tow truck may have dropped the kart past a gap it fell into. Credit
      // the checkpoints it was carried over -- it already paid for them in time.
      this.sweepCheckpoints(this.respawnFromS ?? this.respawnTarget, this.respawnTarget);
      this.prevS = this.respawnTarget;
      this.project();
    }
    this.syncModel(dt);
  }

  // ---------------------------------------------------------------- effects

  /** Spun out by a rocket, a slick or a blast. */
  spinOut(force = 1) {
    if (this.invulnTimer > 0) return false;
    if (this.shieldTimer > 0) {
      this.shieldTimer = 0;
      this.game.onShieldBreak?.(this);
      return false;
    }
    this.spinTimer = KART.spinDuration * force;
    this.boostTimer = 0;
    this.hitFlash = 1;
    this.spinDir = Math.random() > 0.5 ? 1 : -1;
    this.cancelDrift();
    this.velocity.multiplyScalar(0.35);
    this.game.onSpin?.(this);
    return true;
  }

  squashed() {
    if (this.invulnTimer > 0) return false;
    if (this.shieldTimer > 0) {
      this.shieldTimer = 0;
      this.game.onShieldBreak?.(this);
      return false;
    }
    this.squashTimer = KART.squashDuration;
    this.boostTimer = 0;
    this.hitFlash = 1;
    this.velocity.multiplyScalar(0.12);
    this.game.onSquash?.(this);
    return true;
  }

  zap(duration) {
    if (this.invulnTimer > 0 || this.shieldTimer > 0) return false;
    this.empTimer = Math.max(this.empTimer, duration);
    this.boostTimer = 0;
    this.hitFlash = 0.6;
    this.cancelDrift();
    return true;
  }

  get isStunned() {
    return this.spinTimer > 0 || this.squashTimer > 0 || this.respawnTimer > 0;
  }

  // ------------------------------------------------------------------- laps

  advanceDistance() {
    const track = this.track;
    const ds = track.wrapDelta(this.proj.s - this.prevS);
    // Ignore teleport-sized jumps (respawns, projection snapping across a gap).
    if (Math.abs(ds) < track.length * 0.2) {
      this.distance += ds;
      this.sweepCheckpoints(this.prevS, this.proj.s);
    }
    this.prevS = this.proj.s;

    // Hard ceiling on progress: laps genuinely completed, plus however far
    // along the current lap the kart actually is. Anything that gets a kart
    // further down the road without driving it (a glide over the scenery, a
    // projection that snaps to a deck below) buys nothing.
    if (track.closed) {
      const ceiling = (this.crossings - 1) * track.length + this.proj.s + 6;
      if (this.distance > ceiling) this.distance = ceiling;
    } else if (this.distance > this.proj.s + 6) {
      this.distance = this.proj.s + 6;
    }

    const lap = THREE.MathUtils.clamp(
      Math.floor(this.distance / track.length) + 1, 1, track.laps
    );
    if (lap > this.lap) this.game.onLap?.(this, lap);
    this.lap = lap;

    if (!this.finished && this.distance >= track.raceDistance && this.progressComplete()) {
      this.finished = true;
      this.finishTime = this.game.raceTime;
      this.game.onFinish?.(this);
    }
  }

  /** Has this kart legitimately been everywhere the race requires? */
  progressComplete() {
    if (this.track.closed) return this.crossings >= this.track.laps + 1;
    for (let i = 0; i < this.cpHit.length; i++) if (!this.cpHit[i]) return false;
    return true;
  }

  /**
   * Tick off every checkpoint swept between two positions on the centreline.
   * Reversing back over one un-ticks it again, so spinning around and crossing
   * the line the wrong way puts a kart properly back on the previous lap rather
   * than costing it one.
   */
  sweepCheckpoints(fromS, toS) {
    const track = this.track;
    const cps = track.checkpoints;
    const delta = track.wrapDelta(toS - fromS);
    if (delta === 0 || Math.abs(delta) > track.length * 0.2) return;
    for (let i = 0; i < cps.length; i++) {
      const d = track.wrapDelta(cps[i] - fromS);
      const swept = delta > 0 ? d > 0 && d <= delta : d <= 0 && d > delta;
      if (!swept) continue;
      if (track.closed && i === 0) {
        if (delta > 0) this.crossLine();
        else this.uncrossLine();
      } else {
        this.cpHit[i] = delta > 0 ? 1 : 0;
      }
    }
  }

  /** Crossing the start/finish line only counts a lap if the lap was driven. */
  crossLine() {
    for (let i = 1; i < this.cpHit.length; i++) {
      if (!this.cpHit[i]) {
        this.game.onMissedCheckpoint?.(this);
        return;
      }
    }
    this.crossings++;
    this.cpHit.fill(0);
  }

  /** Backing over the line: hand the previous lap's checkpoints back. */
  uncrossLine() {
    if (this.crossings <= 0) return;
    this.crossings--;
    this.cpHit.fill(1);
  }

  // --------------------------------------------------------------- visuals

  syncModel(dt) {
    this.model.position.copy(this.position);

    // Blend the body's up vector toward the surface (or level out in the air).
    const targetUp = this.grounded ? this.surfaceNormal : WORLD_UP;
    this.visualUp.lerp(targetUp, 1 - Math.exp(-(this.grounded ? 12 : 4) * dt)).normalize();

    const fwd = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    fwd.addScaledVector(this.visualUp, -fwd.dot(this.visualUp)).normalize();
    const xAxis = _v2.crossVectors(this.visualUp, fwd).normalize();
    _m1.makeBasis(xAxis, this.visualUp, fwd);
    this.model.quaternion.setFromRotationMatrix(_m1);

    // Lean into corners and drifts.
    const lateralG = THREE.MathUtils.clamp(this.velocity.dot(xAxis) * 0.045, -0.45, 0.45);
    const targetRoll = this.driftActive ? this.driftDir * 0.3 + lateralG * 0.5 : lateralG;
    this.bodyRoll += (targetRoll - this.bodyRoll) * (1 - Math.exp(-9 * dt));
    this.model.rotateZ(this.bodyRoll);

    if (this.driftActive) this.model.rotateY(-this.driftDir * 0.38);

    // Squash and stretch.
    this.squash += (1 - this.squash) * (1 - Math.exp(-11 * dt));
    const squashY = this.squashTimer > 0 ? 0.32 : this.squash;
    const spread = 1 + (1 - squashY) * 0.35;
    this.model.scale.set(spread, squashY, spread);

    // Wheels.
    const speed = this.velocity.length() * Math.sign(this.speed || 1);
    this.wheelSpin += (speed / KART.wheelRadius) * dt;
    const steerTarget = this.driftActive ? this.driftDir * 0.55 : this.lastSteer || 0;
    this.steerVisual += (steerTarget - this.steerVisual) * (1 - Math.exp(-14 * dt));
    for (const w of this.parts.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      w.rim.rotation.x = this.wheelSpin;
      if (w.steered) w.pivot.rotation.y = -this.steerVisual * 0.5;
    }

    // Glider.
    const g = this.parts.glider;
    g.visible = this.gliderBlend > 0.01;
    if (g.visible) {
      const b = THREE.MathUtils.smoothstep(this.gliderBlend, 0, 1);
      g.scale.set(b, b, b);
      g.rotation.z = Math.sin(this.game.elapsed * 6) * 0.05 * b;
      g.position.y = 1.5 + b * 0.6;
    }

    // Shield.
    const sh = this.parts.shield;
    sh.visible = this.shieldTimer > 0;
    if (sh.visible) {
      const pulse = 1 + Math.sin(this.game.elapsed * 9) * 0.05;
      sh.scale.setScalar(pulse);
      sh.rotation.y += dt * 1.4;
      sh.material.opacity = this.shieldTimer < 1.2 ? 0.28 * (0.4 + 0.6 * Math.abs(Math.sin(this.game.elapsed * 14))) : 0.28;
    }

    // Damage flash.
    const flash = this.hitFlash;
    this.parts.bodyMat.emissive.setRGB(flash * 0.9, flash * 0.15, flash * 0.1);

    // Fade out while being fished back onto the track.
    if (this.respawnTimer > 0) {
      const blink = Math.sin(this.game.elapsed * 26) > -0.3;
      this.model.visible = blink;
    } else if (this.invulnTimer > 0) {
      this.model.visible = Math.sin(this.game.elapsed * 22) > -0.5;
    } else {
      this.model.visible = true;
    }

    if (this.tag.visible) {
      const d = this.model.position.distanceTo(this.game.camera.position);
      this.tag.material.opacity = THREE.MathUtils.clamp(1 - (d - 30) / 70, 0, 0.95);
      this.tag.visible = d < 110 && this.model.visible;
    }

    this.emitExhaust(dt);
  }

  worldPoint(local, out = new THREE.Vector3()) {
    return out.copy(local).applyQuaternion(this.model.quaternion).add(this.position);
  }

  emitDriftSparks(dt) {
    const p = this.game.particles;
    const tier = this.driftTier();
    const color = tier < 0
      ? this.game.colors.driftDust
      : this.game.colors.driftTier[tier];
    const rate = tier < 0 ? 22 : 70;
    this.sparkAccum = (this.sparkAccum || 0) + dt * rate;
    while (this.sparkAccum >= 1) {
      this.sparkAccum -= 1;
      for (const side of [-1, 1]) {
        const o = this.worldPoint(_v1.set(side * 0.95, 0.25, -1.05));
        p.spawn(
          o.x, o.y, o.z,
          (Math.random() - 0.5) * 5 - this.velocity.x * 0.12,
          1.5 + Math.random() * 3.5,
          (Math.random() - 0.5) * 5 - this.velocity.z * 0.12,
          color, tier < 0 ? 0.4 : 0.62, 0.34 + Math.random() * 0.2, 4, 2.6
        );
      }
    }
  }

  emitGlideTrail(dt) {
    const p = this.game.particles;
    this.glideAccum = (this.glideAccum || 0) + dt * 26;
    while (this.glideAccum >= 1) {
      this.glideAccum -= 1;
      for (const side of [-1, 1]) {
        const o = this.worldPoint(_v1.set(side * 3.0, 2.3, -0.9));
        p.spawn(o.x, o.y, o.z, 0, 0, 0, this.game.colors.glide, 0.5, 0.5, 0, 1.2);
      }
    }
  }

  emitExhaust(dt) {
    if (!this.grounded && !this.gliding) return;
    const p = this.game.particles;
    const boosting = this.boostTimer > 0;
    const rate = boosting ? 90 : this.velocity.length() > 3 ? 14 : 4;
    this.exhaustAccum += dt * rate;
    const color = boosting
      ? this.game.colors.boostFlame[Math.min(this.boostTier, this.game.colors.boostFlame.length - 1)]
      : this.game.colors.exhaust;
    while (this.exhaustAccum >= 1) {
      this.exhaustAccum -= 1;
      for (const side of [-1, 1]) {
        const o = this.worldPoint(_v1.set(side * 0.3, 0.86, -1.65));
        const back = this.forward;
        p.spawn(
          o.x, o.y, o.z,
          -back.x * (boosting ? 16 : 3) + (Math.random() - 0.5) * 2,
          (Math.random() - 0.2) * 1.6,
          -back.z * (boosting ? 16 : 3) + (Math.random() - 0.5) * 2,
          color, boosting ? 0.8 : 0.34, boosting ? 0.42 : 0.5, boosting ? -1.5 : -0.8, 3.2
        );
      }
    }

    if (this.offroad && this.velocity.length() > 8) {
      this.dustAccum = (this.dustAccum || 0) + dt * 34;
      while (this.dustAccum >= 1) {
        this.dustAccum -= 1;
        const o = this.worldPoint(_v1.set((Math.random() - 0.5) * 2, 0.15, -1.1));
        p.spawn(
          o.x, o.y, o.z,
          (Math.random() - 0.5) * 4, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 4,
          this.game.colors.dust, 0.9, 0.7, -0.6, 1.4
        );
      }
    }
  }

  // ------------------------------------------------------------ networking

  /**
   * Compact state for the wire. Clients are trusted, so a kart's owner is the
   * only authority on where it is -- everyone else just plays back what arrives.
   */
  toNetState() {
    const flags =
      (this.grounded ? 1 : 0) |
      (this.driftActive ? 2 : 0) |
      (this.gliding ? 4 : 0) |
      (this.offroad ? 8 : 0) |
      (this.finished ? 16 : 0) |
      (this.driftDir > 0 ? 32 : 0) |
      (this.driftDir < 0 ? 64 : 0);
    const r = (v) => Math.round(v * 100) / 100;
    return [
      this.netSlot,
      r(this.position.x), r(this.position.y), r(this.position.z),
      r(this.yaw),
      r(this.velocity.x), r(this.velocity.y), r(this.velocity.z),
      flags,
      Math.round(this.distance * 10) / 10,
      this.lap,
      r(this.boostTimer), r(this.shieldTimer), r(this.spinTimer), r(this.squashTimer),
      r(this.finishTime),
    ];
  }

  applyNetState(a) {
    const n = this.net;
    n.position.set(a[1], a[2], a[3]);
    n.yaw = a[4];
    n.velocity.set(a[5], a[6], a[7]);
    n.age = 0;
    if (!n.valid) {
      // First packet: snap rather than sliding in from wherever we started.
      n.valid = true;
      this.position.copy(n.position);
      this.yaw = n.yaw;
      this.velocity.copy(n.velocity);
      this.hint = this.track.indexAt(0);
      this.project();
    }
    const flags = a[8];
    this.grounded = !!(flags & 1);
    this.driftActive = !!(flags & 2);
    this.gliding = !!(flags & 4);
    this.offroad = !!(flags & 8);
    this.driftDir = flags & 32 ? 1 : flags & 64 ? -1 : 0;
    this.distance = a[9];
    this.lap = a[10];
    this.boostTimer = a[11];
    this.shieldTimer = a[12];
    this.spinTimer = a[13];
    this.squashTimer = a[14];
    this.finishTime = a[15];
    if (flags & 16) this.finished = true;
  }

  /**
   * Rebuild the checkpoint bookkeeping from a distance that arrived over the
   * wire. Used when a client inherits a kart somebody else was simulating: the
   * previous owner already policed its progress, so we trust the number and
   * carry on from wherever it says the kart is.
   */
  syncProgressFromDistance() {
    const track = this.track;
    const cps = track.checkpoints;
    if (track.closed) {
      this.crossings = Math.max(0, Math.floor(this.distance / track.length) + 1);
      this.cpHit[0] = 1;
      for (let i = 1; i < cps.length; i++) this.cpHit[i] = cps[i] <= this.proj.s ? 1 : 0;
    } else {
      for (let i = 0; i < cps.length; i++) this.cpHit[i] = cps[i] <= this.proj.s ? 1 : 0;
    }
    this.prevS = this.proj.s;
  }

  updateRemote(dt) {
    const n = this.net;
    if (n.valid) {
      n.age += dt;
      // Extrapolate from the last packet, then chase the result. 20 Hz of
      // updates plus a little dead reckoning is plenty for karts you are only
      // ever looking at from the outside.
      _v3.copy(n.position).addScaledVector(n.velocity, Math.min(n.age, 0.4));
      const k = 1 - Math.exp(-14 * dt);
      this.position.lerp(_v3, k);
      this.velocity.lerp(n.velocity, k);
      let d = n.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * k;
    }

    this.boostTimer = Math.max(0, this.boostTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.spinTimer = Math.max(0, this.spinTimer - dt);
    this.squashTimer = Math.max(0, this.squashTimer - dt);
    this.empTimer = Math.max(0, this.empTimer - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);

    this.project();
    if (this.proj.frame) this.surfaceNormal.copy(this.proj.frame.normal);
    this.gliderBlend = this.gliding
      ? Math.min(1, this.gliderBlend + dt * 5)
      : Math.max(0, this.gliderBlend - dt * 6);
    this.syncModel(dt);
  }

  dispose() {
    this.game.scene.remove(this.model);
    this.model.traverse((node) => {
      node.geometry?.dispose?.();
      const mat = node.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
    this.tag.material.map?.dispose();
  }
}
