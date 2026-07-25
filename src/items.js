import * as THREE from 'three';
import { ITEMS, ITEM_TABLE, KART } from './config.js';
import { makeItemBox, makeRocket, makeBomb, makeSlick, makePulseRing } from './models.js';

/**
 * Pickups, hazards and projectiles.
 *
 * Guided rockets travel in *track space* rather than world space -- they advance
 * along the centreline and slide sideways toward their target. That is both far
 * cheaper than real pursuit steering and much more reliable, since it follows the
 * road through corners, over crests and straight across the glider gaps.
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class ItemSystem {
  constructor(game) {
    this.game = game;
    this.track = game.track;
    this.boxes = [];
    this.hazards = [];
    this.projectiles = [];
    this.effects = [];

    for (const def of this.track.itemBoxes) {
      const mesh = makeItemBox();
      this.track.surfacePoint(def.s, def.x, mesh.position);
      mesh.position.y += 1.6 + def.y;
      game.scene.add(mesh);
      this.boxes.push({ def, mesh, active: true, respawn: 0, home: mesh.position.clone() });
    }
  }

  /** Tear everything down when the circuit changes. */
  dispose() {
    this.reset();
    for (const box of this.boxes) {
      this.game.scene.remove(box.mesh);
      box.mesh.traverse((node) => {
        node.geometry?.dispose?.();
        node.material?.dispose?.();
      });
    }
    this.boxes.length = 0;
  }

  reset() {
    for (const box of this.boxes) {
      box.active = true;
      box.respawn = 0;
      box.mesh.visible = true;
    }
    for (const h of this.hazards) this.game.scene.remove(h.mesh);
    for (const p of this.projectiles) this.game.scene.remove(p.mesh);
    for (const e of this.effects) this.game.scene.remove(e.mesh);
    this.hazards.length = 0;
    this.projectiles.length = 0;
    this.effects.length = 0;
  }

  // ------------------------------------------------------------------ boxes

  update(dt) {
    const elapsed = this.game.elapsed;

    for (const box of this.boxes) {
      if (box.active) {
        box.mesh.rotation.y += dt * 1.5;
        box.mesh.rotation.x += dt * 0.9;
        box.mesh.position.y = box.home.y + Math.sin(elapsed * 2 + box.def.s) * 0.28;
        box.mesh.userData.core.rotation.y -= dt * 3.2;
      } else {
        box.respawn -= dt;
        if (box.respawn <= 0) {
          box.active = true;
          box.mesh.visible = true;
          box.mesh.scale.setScalar(0.01);
        }
      }
      if (box.active && box.mesh.scale.x < 1) {
        box.mesh.scale.setScalar(Math.min(1, box.mesh.scale.x + dt * 3));
      }
    }

    this.checkPickups();
    this.updateHazards(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
  }

  checkPickups() {
    for (const kart of this.game.karts) {
      // Remote karts take their crates on their own client and tell us about
      // it; picking up on their behalf here would empty the road twice over.
      if (kart.remote) continue;
      if (kart.item || kart.itemRoulette > 0 || kart.isStunned) continue;
      for (let i = 0; i < this.boxes.length; i++) {
        const box = this.boxes[i];
        if (!box.active) continue;
        if (kart.position.distanceToSquared(box.mesh.position) > 9) continue;
        box.active = false;
        box.mesh.visible = false;
        box.respawn = ITEMS.boxRespawn;
        this.grant(kart);
        this.game.onBoxTaken?.(kart, i);
        this.game.particles.burst(box.mesh.position, 22, this.game.colors.pickup, {
          speed: 9, size: 0.55, life: 0.55, gravity: 4,
        });
        this.game.onPickup?.(kart);
        break;
      }
    }
  }

  /** Roll an item, weighted by how badly the kart is doing. */
  grant(kart) {
    const n = Math.max(1, this.game.karts.length - 1);
    const t = THREE.MathUtils.clamp((kart.place - 1) / n, 0, 1);
    let total = 0;
    const weights = ITEM_TABLE.map((entry) => {
      const w = entry.lead + (entry.tail - entry.lead) * t;
      total += w;
      return w;
    });
    let r = Math.random() * total;
    let chosen = ITEM_TABLE[0].id;
    for (let i = 0; i < ITEM_TABLE.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosen = ITEM_TABLE[i].id;
        break;
      }
    }
    kart.item = chosen;
    kart.itemRoulette = kart.isPlayer ? 0.85 : 0;
  }

  // ------------------------------------------------------------------- use

  use(kart) {
    if (!kart.item || kart.itemRoulette > 0 || kart.isStunned) return;
    const item = kart.item;
    kart.item = null;

    switch (item) {
      case 'boost':
        kart.applyBoost(KART.itemBoostDuration, 3);
        break;
      case 'shield':
        kart.shieldTimer = ITEMS.shieldDuration;
        break;
      case 'slick':
        this.dropSlick(kart);
        break;
      case 'bomb':
        this.fireBomb(kart);
        break;
      case 'rocket':
        this.fireRocket(kart);
        break;
      case 'emp':
        this.firePulse(kart);
        break;
      default:
        break;
    }
    this.game.onItemUsed?.(kart, item);
  }

  /**
   * Replay an item another player used. Every client simulates every hazard and
   * projectile, but only ever applies damage to the karts it owns -- see
   * `updateHazards` and `stepRocket` -- so no hit messages are needed.
   */
  useRemote(kart, item) {
    switch (item) {
      case 'slick':
        this.dropSlick(kart);
        break;
      case 'bomb':
        this.fireBomb(kart);
        break;
      case 'rocket':
        this.fireRocket(kart);
        break;
      case 'emp':
        this.firePulse(kart);
        break;
      default:
        // Boosts and shields show up in the owner's broadcast state.
        break;
    }
  }

  /** A crate somebody else drove through. */
  takeBox(index) {
    const box = this.boxes[index];
    if (!box || !box.active) return;
    box.active = false;
    box.mesh.visible = false;
    box.respawn = ITEMS.boxRespawn;
    this.game.particles.burst(box.mesh.position, 22, this.game.colors.pickup, {
      speed: 9, size: 0.55, life: 0.55, gravity: 4,
    });
  }

  dropSlick(kart) {
    const mesh = makeSlick();
    const s = this.track.wrap(kart.proj.s - 5);
    const lateral = kart.proj.lateral;
    this.track.surfacePoint(s, lateral, mesh.position);
    mesh.position.y += 0.08;
    this.game.scene.add(mesh);
    this.hazards.push({
      mesh, s, lateral, owner: kart, life: ITEMS.slickLife, arm: 0.35,
    });
  }

  fireBomb(kart) {
    const mesh = makeBomb();
    const fwd = kart.forward.clone();
    mesh.position.copy(kart.position).addScaledVector(fwd, 2.4).add(_v.set(0, 1.1, 0));
    this.game.scene.add(mesh);
    const vel = fwd.clone().multiplyScalar(ITEMS.bombSpeed).add(_v2.set(0, 7, 0));
    vel.addScaledVector(kart.velocity, 0.35);
    this.projectiles.push({
      kind: 'bomb', mesh, owner: kart, velocity: vel, life: ITEMS.bombFuse, hint: kart.hint,
    });
  }

  fireRocket(kart) {
    const target = this.game.nextRacerAhead(kart, 260);
    const mesh = makeRocket();
    const s = this.track.wrap(kart.proj.s + 3);
    this.track.surfacePoint(s, kart.proj.lateral, mesh.position);
    mesh.position.y += 1.4;
    this.game.scene.add(mesh);
    this.projectiles.push({
      kind: 'rocket', mesh, owner: kart, target,
      s, lateral: kart.proj.lateral, life: ITEMS.rocketLife,
    });
  }

  firePulse(kart) {
    // Zaps everyone currently ahead of the user.
    const ring = makePulseRing();
    ring.position.copy(kart.position);
    ring.position.y += 0.5;
    this.game.scene.add(ring);
    this.effects.push({ mesh: ring, kind: 'pulse', life: 0.9, maxLife: 0.9 });

    let hits = 0;
    for (const other of this.game.karts) {
      if (other === kart) continue;
      if (other.distance <= kart.distance) continue;
      // Remote karts get zapped by their own client, which is running this same
      // pulse; here we just draw the sparks.
      if (other.remote || other.zap(ITEMS.empSlowDuration)) {
        hits++;
        this.game.particles.burst(other.position, 18, this.game.colors.emp, {
          speed: 7, size: 0.6, life: 0.7, up: 3,
        });
      }
    }
    this.game.onPulse?.(kart, hits);
  }

  // -------------------------------------------------------------- hazards

  updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      h.arm -= dt;
      if (h.life <= 0) {
        this.game.scene.remove(h.mesh);
        this.hazards.splice(i, 1);
        continue;
      }
      // Fade out in the last second.
      if (h.life < 1) {
        for (const child of h.mesh.children) child.material.opacity = h.life * 0.9;
      }
      for (const kart of this.game.karts) {
        if (kart === h.owner && h.arm > 0) continue;
        if (kart.isStunned) continue;
        if (kart.position.distanceToSquared(h.mesh.position) > 6.5) continue;
        if (!kart.grounded && kart.proj.height > 2) continue;
        if (!kart.remote && kart.spinOut(1)) {
          this.game.particles.burst(kart.position, 20, this.game.colors.smoke, {
            speed: 6, size: 0.8, life: 0.8, up: 2,
          });
        }
        this.game.scene.remove(h.mesh);
        this.hazards.splice(i, 1);
        break;
      }
    }
  }

  // ----------------------------------------------------------- projectiles

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let dead = p.life <= 0;

      if (p.kind === 'rocket') {
        dead = this.stepRocket(p, dt) || dead;
        if (dead && p.life <= 0) this.explode(p.mesh.position, 6, false);
      } else if (p.kind === 'bomb') {
        dead = this.stepBomb(p, dt) || dead;
        if (dead) this.explode(p.mesh.position, ITEMS.bombBlastRadius, true, p.owner);
      }

      if (dead) {
        this.game.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  stepRocket(p, dt) {
    const track = this.track;
    p.s = track.wrap(p.s + ITEMS.rocketSpeed * dt);

    // Slide toward the target's line; without one, just hold the centre.
    const targetLat = p.target && !p.target.finished ? p.target.proj.lateral : 0;
    p.lateral += (targetLat - p.lateral) * Math.min(1, dt * 2.6);

    track.surfacePoint(p.s, p.lateral, p.mesh.position);
    p.mesh.position.y += 1.4;

    const frame = track.frameAt(p.s);
    p.mesh.lookAt(_v.copy(p.mesh.position).add(frame.tangent));
    const flame = p.mesh.userData.flame;
    flame.scale.setScalar(0.8 + Math.random() * 0.5);

    this.game.particles.spawn(
      p.mesh.position.x, p.mesh.position.y, p.mesh.position.z,
      (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
      this.game.colors.rocketTrail, 0.7, 0.35, -1, 2.4
    );

    // Anyone it runs into gets hit, not just the intended victim.
    for (const kart of this.game.karts) {
      if (kart === p.owner) continue;
      if (kart.position.distanceToSquared(p.mesh.position) > 12) continue;
      if (kart.remote) return true;   // their client is running this rocket too
      if (kart.spinOut(1.2)) {
        this.explode(kart.position, 5, false);
        return true;
      }
      // Blocked by a shield: the rocket still dies.
      return true;
    }
    return false;
  }

  stepBomb(p, dt) {
    p.velocity.y -= 24 * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.mesh.rotation.x += dt * 6;
    p.mesh.rotation.z += dt * 4;

    const fuse = p.mesh.userData.fuse;
    fuse.visible = Math.sin(this.game.elapsed * 30) > 0;

    this.game.particles.spawn(
      p.mesh.position.x, p.mesh.position.y, p.mesh.position.z,
      0, 0, 0, this.game.colors.smoke, 0.5, 0.4, -0.8, 2
    );

    // Ground contact.
    if (!p.proj) p.proj = {};
    const proj = this.track.project(p.mesh.position, p.hint, p.proj);
    p.hint = proj.index;
    const surf = this.track.surfaceAt(p.mesh.position, proj);
    if (surf && p.mesh.position.y <= surf.y + 0.4) return true;
    if (p.mesh.position.y < -30) return true;

    for (const kart of this.game.karts) {
      if (kart === p.owner) continue;
      if (kart.position.distanceToSquared(p.mesh.position) < 9) return true;
    }
    return false;
  }

  explode(position, radius, damaging, owner = null) {
    const g = this.game;
    g.particles.burst(position, 46, g.colors.blastCore, {
      speed: 16, size: 1.5, life: 0.62, gravity: -3, drag: 2.6,
    });
    g.particles.burst(position, 30, g.colors.smoke, {
      speed: 8, size: 2.1, life: 1.1, gravity: -1.5, drag: 1.4,
    });

    const ring = makePulseRing();
    ring.material.color.set(0xffb45e);
    ring.position.copy(position);
    ring.position.y += 0.4;
    g.scene.add(ring);
    this.effects.push({ mesh: ring, kind: 'blast', life: 0.55, maxLife: 0.55, radius });

    if (!damaging) return;
    const r2 = radius * radius;
    for (const kart of g.karts) {
      if (kart === owner || kart.remote) continue;
      if (kart.position.distanceToSquared(position) > r2) continue;
      kart.squashed();
    }
    g.onExplosion?.(position);
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.game.scene.remove(e.mesh);
        this.effects.splice(i, 1);
        continue;
      }
      const t = 1 - e.life / e.maxLife;
      const scale = e.kind === 'blast' ? (e.radius || 8) * t : 34 * t;
      e.mesh.scale.setScalar(Math.max(0.01, scale));
      e.mesh.material.opacity = (1 - t) * 0.85;
    }
  }
}

export function itemDisplayName(id) {
  const entry = ITEM_TABLE.find((e) => e.id === id);
  return entry ? entry.name : '';
}
