/**
 * Player input from keyboard, gamepad or touch, normalised into the same struct
 * the AI produces. Keyboard steering is ramped rather than binary so it feels
 * closer to an analogue stick.
 */

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'drift', ShiftLeft: 'drift', ShiftRight: 'drift',
  KeyE: 'item', ControlLeft: 'item', ControlRight: 'item', Enter: 'item',
  KeyC: 'look',
};

const STEER_ATTACK = 4.6;   // how fast the wheel turns (1/s)
const STEER_RELEASE = 7.5;  // how fast it self-centres

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.steer = 0;
    this.itemPressed = false;
    this.itemEdge = false;
    this.touch = { left: false, right: false, accel: false, brake: false, drift: false };
    this.lastSource = 'keyboard';

    this.state = {
      throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, lookBack: false,
    };

    this.onAction = null;   // pause / restart / mute hooks

    // Menus have text fields in them; a driving control scheme that eats every
    // W and S would make the name box unusable.
    const typing = (e) => {
      const el = e.target;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };

    target.addEventListener('keydown', (e) => {
      if (e.repeat || typing(e)) return;
      const name = KEY_MAP[e.code];
      if (name) {
        this.keys.add(name);
        this.lastSource = 'keyboard';
        e.preventDefault();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') this.onAction?.('pause');
      if (e.code === 'KeyR') this.onAction?.('respawn');
      if (e.code === 'KeyM') this.onAction?.('mute');
      if (e.code === 'Enter') this.onAction?.('confirm');
      if (e.code === 'Space') this.onAction?.('confirm');
    });

    target.addEventListener('keyup', (e) => {
      if (typing(e)) return;
      const name = KEY_MAP[e.code];
      if (name) {
        this.keys.delete(name);
        e.preventDefault();
      }
    });

    target.addEventListener('blur', () => this.keys.clear());
  }

  /** Wire up the on-screen buttons for touch devices. */
  bindTouch(root) {
    const bind = (id, prop) => {
      const el = root.querySelector(id);
      if (!el) return;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[prop] = v;
        this.lastSource = 'touch';
      };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false), { passive: false });
      el.addEventListener('touchcancel', set(false), { passive: false });
      el.addEventListener('mousedown', set(true));
      el.addEventListener('mouseup', set(false));
      el.addEventListener('mouseleave', set(false));
    };
    bind('#touch-left', 'left');
    bind('#touch-right', 'right');
    bind('#touch-accel', 'accel');
    bind('#touch-brake', 'brake');
    bind('#touch-drift', 'drift');

    const item = root.querySelector('#touch-item');
    if (item) {
      const fire = (e) => {
        e.preventDefault();
        this.itemEdge = true;
        this.lastSource = 'touch';
      };
      item.addEventListener('touchstart', fire, { passive: false });
      item.addEventListener('mousedown', fire);
    }
  }

  readGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const anyInput =
        pad.buttons.some((b) => b.pressed) ||
        pad.axes.some((a) => Math.abs(a) > 0.2);
      if (anyInput) this.lastSource = 'gamepad';
      return pad;
    }
    return null;
  }

  update(dt) {
    const s = this.state;
    const k = this.keys;
    const t = this.touch;
    const pad = this.readGamepad();

    // --- Steering ---------------------------------------------------------
    let steerTarget = 0;
    if (k.has('left') || t.left) steerTarget -= 1;
    if (k.has('right') || t.right) steerTarget += 1;
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.14) steerTarget = ax;
      // D-pad.
      if (pad.buttons[14]?.pressed) steerTarget = -1;
      if (pad.buttons[15]?.pressed) steerTarget = 1;
    }
    const rate = steerTarget === 0 ? STEER_RELEASE : STEER_ATTACK;
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-rate * dt));
    if (Math.abs(this.steer) < 0.002) this.steer = 0;
    s.steer = Math.max(-1, Math.min(1, this.steer));

    // --- Pedals -----------------------------------------------------------
    s.throttle = k.has('up') || t.accel ? 1 : 0;
    s.brake = k.has('down') || t.brake ? 1 : 0;
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) s.throttle = rt;
      if (lt > 0.05) s.brake = lt;
      if (pad.buttons[0]?.pressed) s.throttle = 1;   // A also accelerates
    }

    // --- Drift ------------------------------------------------------------
    s.drift = k.has('drift') || t.drift ||
      !!(pad && (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed));

    // --- Item (edge triggered) --------------------------------------------
    const itemDown = k.has('item') ||
      !!(pad && (pad.buttons[2]?.pressed || pad.buttons[4]?.pressed));
    if (itemDown && !this.itemPressed) this.itemEdge = true;
    this.itemPressed = itemDown;
    s.useItem = this.itemEdge;
    this.itemEdge = false;

    s.lookBack = k.has('look') || !!(pad && pad.buttons[3]?.pressed);

    return s;
  }
}
