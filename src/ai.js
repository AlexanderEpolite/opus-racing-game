import * as THREE from 'three';
import { KART } from './config.js';

/**
 * CPU driver.
 *
 * Deliberately simple: aim at a point down the track, brake for whatever
 * curvature is coming, drift through the tight stuff, and detour a little for
 * pickups. It produces the same input struct the keyboard does, so the physics
 * has no idea who is driving.
 */

const _target = new THREE.Vector3();
const _to = new THREE.Vector3();

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AIDriver {
  constructor(kart, profile, seed) {
    this.kart = kart;
    this.profile = profile;
    this.phase = seed * 2.7;
    this.itemDelay = 1 + Math.random() * 2;
    this.stuckTimer = 0;
    this.stuckCount = 0;
    this.stuckCooldown = 0;
    this.reverseTimer = 0;
    this.driftHold = 0;
    this.driftTarget = 1.0;
    this.input = {
      throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, lookBack: false,
    };
  }

  update(dt, game) {
    const kart = this.kart;
    const track = game.track;
    const input = this.input;
    input.useItem = false;

    // The board comes up as soon as *you* take the flag, but the rest of the
    // field is still racing for the remaining places -- and in multiplayer they
    // are being watched by everyone who has not finished yet.
    const running = game.state === 'racing' || game.state === 'results';
    if (!running || kart.finished) {
      input.throttle = running ? 1 : 0;
      input.brake = 0;
      input.steer = 0;
      input.drift = false;
      if (kart.finished) input.throttle = 0.4;
      return input;
    }

    const speed = Math.max(0, kart.speed);
    const proj = kart.proj;

    // --- Where to aim ------------------------------------------------------
    const lookahead = 11 + speed * 0.62;
    const targetS = proj.s + lookahead;
    const targetLat = this.chooseLine(game, targetS, speed);
    track.surfacePoint(targetS, targetLat, _target);

    _to.copy(_target).sub(kart.position);
    _to.y = 0;
    const desiredYaw = Math.atan2(_to.x, _to.z);
    const dyaw = wrapAngle(desiredYaw - kart.yaw);
    let steer = THREE.MathUtils.clamp(-dyaw * 1.9, -1, 1);

    // --- How fast to take what is coming ----------------------------------
    const kappa = this.worstCurvature(track, proj.s + 4, 22 + speed * 1.5);
    const grip = 27 * (0.72 + this.profile.skill * 0.34) * game.aiAssist(kart);
    const safeSpeed = Math.min(KART.topSpeed, Math.sqrt(grip / Math.max(kappa, 1e-4)));

    let throttle = 1;
    let brake = 0;
    if (speed > safeSpeed * 1.28) {
      brake = 1;
      throttle = 0;
    } else if (speed > safeSpeed) {
      throttle = 0.35;
    }
    throttle *= game.aiThrottleCap(kart);

    // --- Flying ------------------------------------------------------------
    if (!kart.grounded) {
      if (kart.gliding && track.inGap(proj.s)) {
        // Hold the nose up until the far side is safely underneath.
        throttle = 0;
        brake = 1;
      } else if (kart.gliding) {
        throttle = 1;
        brake = 0;
      }
      input.drift = false;
    }

    // --- Drifting ----------------------------------------------------------
    // The hop lifts the kart off the ground, so the request has to be held
    // through it -- release early and the drift never engages on touchdown.
    let drift = false;
    if (kart.driftArmed) {
      drift = true;
    } else if (kart.grounded && !kart.offroad && speed > KART.driftMinSpeed + 3) {
      const room = proj.halfWidth - Math.abs(proj.lateral);
      if (kart.driftActive) {
        // Hold on for the turbo, but bail out before sliding off the road.
        drift = room > 2.5 && (Math.abs(steer) > 0.2 || kart.driftCharge < this.driftTarget);
        this.driftHold += dt;
      } else if (Math.abs(steer) > 0.28 && kappa > 0.008 && room > 4.5) {
        drift = true;
        this.driftHold = 0;
        // Better drivers hang on for the bigger turbo.
        this.driftTarget = this.profile.skill > 0.88 ? 1.9 : 0.95;
      }
    }
    if (kart.driftActive) {
      // A drift already rotates the kart hard; feeding in the full pursuit
      // correction on top of that just spins it.
      steer = THREE.MathUtils.clamp(steer * 0.7, -1, 1);
    }

    // --- Unsticking --------------------------------------------------------
    if (speed < 3 && !kart.isStunned && kart.grounded) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
      this.stuckCooldown = Math.max(0, (this.stuckCooldown || 0) - dt);
      if (this.stuckCooldown === 0) this.stuckCount = 0;
    }
    if (this.stuckTimer > 1.4) {
      this.reverseTimer = 1.0;
      this.stuckTimer = 0;
      this.stuckCount = (this.stuckCount || 0) + 1;
      this.stuckCooldown = 4;
      // Backing up twice and still going nowhere means it is properly wedged.
      if (this.stuckCount >= 3) {
        kart.startRespawn();
        this.stuckCount = 0;
        this.reverseTimer = 0;
      }
    }
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      throttle = 0;
      brake = 1;
      // Reverse back toward the middle of the road rather than into the wall.
      steer = THREE.MathUtils.clamp(kart.proj.lateral * 0.25, -1, 1);
      drift = false;
    }

    // --- Items -------------------------------------------------------------
    if (kart.item) {
      this.itemDelay -= dt;
      if (this.itemDelay <= 0 && this.wantsToUseItem(game)) {
        input.useItem = true;
        this.itemDelay = 0.8 + Math.random() * 2.2;
      }
    } else {
      this.itemDelay = 0.4 + Math.random() * 1.8;
    }

    input.throttle = throttle;
    input.brake = brake;
    input.steer = steer;
    input.drift = drift;
    return input;
  }

  /** Preferred lateral offset, nudged toward pickups and away from hazards. */
  chooseLine(game, targetS, speed) {
    const track = game.track;
    const p = this.profile;
    const frame = track.frameAt(targetS);
    const limit = Math.max(2, frame.halfWidth - 2.0);

    // A slow sine along the track gives each CPU its own wandering line.
    let lat = p.line + Math.sin(targetS * 0.011 + this.phase) * p.wander;

    // Apex the corners a little.
    lat += THREE.MathUtils.clamp(frame.curvature * 260, -4.5, 4.5);

    // Detour for a boost pad if one is roughly on our path.
    for (const pad of track.boostPads) {
      const ahead = track.wrapDelta(pad.s - this.kart.proj.s);
      if (ahead < 4 || ahead > 55) continue;
      if (Math.abs(pad.x - lat) > 8) continue;
      lat = THREE.MathUtils.lerp(lat, pad.x, 0.75);
      break;
    }

    // Detour for an item box when we are empty-handed.
    if (!this.kart.item) {
      for (const box of game.items.boxes) {
        if (!box.active) continue;
        const ahead = track.wrapDelta(box.def.s - this.kart.proj.s);
        if (ahead < 4 || ahead > 50) continue;
        if (box.def.y > 0 && this.kart.grounded) continue;
        if (Math.abs(box.def.x - lat) > 9) continue;
        lat = THREE.MathUtils.lerp(lat, box.def.x, 0.8);
        break;
      }
    }

    // Swerve around anything dropped on the road.
    for (const h of game.items.hazards) {
      const ahead = track.wrapDelta(h.s - this.kart.proj.s);
      if (ahead < 2 || ahead > 26) continue;
      if (Math.abs(h.lateral - lat) > 3.4) continue;
      lat += (lat > h.lateral ? 1 : -1) * 4.6;
      break;
    }

    return THREE.MathUtils.clamp(lat, -limit, limit);
  }

  /** Sharpest bend within `range` metres of `from`. */
  worstCurvature(track, from, range) {
    let worst = 0;
    const step = track.sampleSpacing * 4;
    for (let d = 0; d < range; d += step) {
      const i = track.indexAt(from + d);
      const k = Math.abs(track.curvature[i]);
      // Weight the near future more heavily than the far.
      const w = 1 - (d / range) * 0.45;
      if (k * w > worst) worst = k * w;
    }
    return worst;
  }

  wantsToUseItem(game) {
    const kart = this.kart;
    const item = kart.item;
    if (!item) return false;
    switch (item) {
      case 'boost':
        // Save it for somewhere it pays: a straight, or when trailing badly.
        return Math.abs(kart.proj.frame.curvature) < 0.006 || kart.place > 4;
      case 'rocket':
        return !!game.nextRacerAhead(kart, 190);
      case 'slick':
        return !!game.nextRacerBehind(kart, 70) || Math.random() < 0.35;
      case 'bomb':
        return !!game.nextRacerAhead(kart, 70) || Math.random() < 0.25;
      case 'shield':
        return kart.place > 1 || Math.random() < 0.5;
      case 'emp':
        return kart.place > 2;
      default:
        return true;
    }
  }
}

/**
 * Mild rubber-banding so the pack stays together without feeling rigged.
 * Returns multipliers the AI applies to its own cornering grip and throttle.
 */
export function makeRubberBand(game) {
  return {
    aiAssist(kart) {
      const lead = game.player.distance - kart.distance;
      // Behind the player: corner a little better. Ahead: a little worse.
      return THREE.MathUtils.clamp(1 + lead / 900, 0.9, 1.14);
    },
    aiThrottleCap(kart) {
      const lead = game.player.distance - kart.distance;
      if (lead > 120) return 1;
      if (lead < -260) return 0.9;
      return THREE.MathUtils.clamp(0.94 + lead / 2600, 0.9, 1);
    },
  };
}
