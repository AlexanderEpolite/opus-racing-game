import { RACE, KART } from './config.js';
import { itemDisplayName } from './items.js';

/** Screen furniture: readouts, minimap, messaging and the results board. */

const SUFFIX = ['th', 'st', 'nd', 'rd'];

function ordinal(n) {
  const v = n % 100;
  return SUFFIX[(v - 20) % 10] || SUFFIX[v] || SUFFIX[0];
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Inline SVG glyphs, one per item. */
const ICONS = {
  boost: `<svg viewBox="0 0 64 64"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff2a8"/><stop offset="1" stop-color="#ff7a2f"/></linearGradient></defs>
    <path fill="url(#g1)" d="M36 4 14 36h13l-5 24 25-34H33z"/></svg>`,
  slick: `<svg viewBox="0 0 64 64">
    <ellipse cx="32" cy="42" rx="25" ry="13" fill="#15161d"/>
    <ellipse cx="25" cy="38" rx="9" ry="4.5" fill="#4a3a6b" opacity=".85"/>
    <path d="M40 8h10v18H40z" fill="#c9531f"/><path d="M38 24h14v6H38z" fill="#8d3714"/></svg>`,
  bomb: `<svg viewBox="0 0 64 64">
    <circle cx="30" cy="38" r="19" fill="#2b2f3c"/>
    <circle cx="24" cy="32" r="6" fill="#4a5162" opacity=".8"/>
    <path d="M40 22c4-8 10-9 14-5" stroke="#a5763f" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="55" cy="15" r="6" fill="#ffcf5e"/><circle cx="55" cy="15" r="3" fill="#fff4c8"/></svg>`,
  rocket: `<svg viewBox="0 0 64 64">
    <path d="M32 4c9 8 13 19 13 30v10H19V34C19 23 23 12 32 4z" fill="#ff5a3d"/>
    <path d="M32 4c4.5 8 6.5 19 6.5 30v10h-13V34C25.5 23 27.5 12 32 4z" fill="#ffd8cf" opacity=".55"/>
    <circle cx="32" cy="24" r="5.5" fill="#9fe8ff"/>
    <path d="M19 38 8 52h11zM45 38l11 14H45z" fill="#e6e8f0"/>
    <path d="M26 48h12l-6 13z" fill="#ffc45e"/></svg>`,
  shield: `<svg viewBox="0 0 64 64">
    <path d="M32 5 55 14v20c0 13-10 22-23 26C19 56 9 47 9 34V14z" fill="#35d1ff" opacity=".32"/>
    <path d="M32 5 55 14v20c0 13-10 22-23 26C19 56 9 47 9 34V14z" fill="none" stroke="#7fe8ff" stroke-width="3.5"/>
    <path d="M22 32l7 8 14-16" stroke="#eafcff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  emp: `<svg viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="24" fill="none" stroke="#b07cff" stroke-width="3" opacity=".55"/>
    <circle cx="32" cy="32" r="16" fill="none" stroke="#b07cff" stroke-width="3" opacity=".8"/>
    <path d="M36 8 18 36h11l-4 20 21-30H34z" fill="#e6d4ff"/></svg>`,
};

export class HUD {
  constructor(game, root = document) {
    this.game = game;
    this.root = root;
    this.el = {
      hud: root.getElementById('hud'),
      placeNum: root.getElementById('place-num'),
      placeSuffix: root.getElementById('place-suffix'),
      lapNum: root.getElementById('lap-num'),
      lapTotal: root.getElementById('lap-total'),
      lapBox: root.querySelector('.lap-box'),
      raceTime: root.getElementById('race-time'),
      itemSlot: root.getElementById('item-slot'),
      itemIcon: root.getElementById('item-icon'),
      itemName: root.getElementById('item-name'),
      speedNum: root.getElementById('speed-num'),
      speedoFill: root.getElementById('speedo-fill'),
      speedo: root.querySelector('.speedo'),
      gearBadge: root.getElementById('gear-badge'),
      minimap: root.getElementById('minimap'),
      standings: root.getElementById('standings'),
      centerMsg: root.getElementById('center-msg'),
      countdown: root.getElementById('countdown'),
      tint: root.getElementById('screen-tint'),
      speedLines: root.getElementById('speed-lines'),
      results: root.getElementById('results-screen'),
      resultsList: root.getElementById('results-list'),
      resultsTitle: root.getElementById('results-title'),
    };

    this.el.lapTotal.textContent = RACE.laps;
    this.ctx = this.el.minimap.getContext('2d');
    this.msgTimer = 0;
    this.hurtTimer = 0;
    this.shownItem = undefined;
    this.rouletteFace = 0;
    this.rows = [];

    this._prepareMinimap();
    this._buildStandings();
  }

  show() { this.el.hud.hidden = false; }
  hide() { this.el.hud.hidden = true; }

  // -------------------------------------------------------------- minimap

  _prepareMinimap() {
    const track = this.game.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.positions) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 22;
    const size = this.el.minimap.width;
    const scale = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxZ - minZ));
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    this.map = {
      scale, cx, cz, size,
      toX: (x) => size / 2 + (x - cx) * scale,
      toY: (z) => size / 2 + (z - cz) * scale,
    };

    // Pre-split the centreline into solid runs so gaps show as breaks.
    const runs = [];
    let run = [];
    for (let i = 0; i <= track.sampleCount; i++) {
      const idx = i % track.sampleCount;
      if (track.isGapSample[idx]) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      run.push(track.positions[idx]);
    }
    if (run.length > 1) runs.push(run);
    this.mapRuns = runs;
  }

  drawMinimap() {
    const ctx = this.ctx;
    const { size, toX, toY } = this.map;
    ctx.clearRect(0, 0, size, size);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Road ribbon.
    for (const pass of [
      { width: 13, color: 'rgba(0,0,0,0.45)' },
      { width: 9, color: 'rgba(190,200,225,0.5)' },
    ]) {
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = pass.color;
      for (const run of this.mapRuns) {
        ctx.beginPath();
        ctx.moveTo(toX(run[0].x), toY(run[0].z));
        for (let i = 1; i < run.length; i++) ctx.lineTo(toX(run[i].x), toY(run[i].z));
        ctx.stroke();
      }
    }

    // Start/finish tick.
    const track = this.game.track;
    const f = track.frameAt(0);
    const a = f.position.clone().addScaledVector(f.right, -f.halfWidth);
    const b = f.position.clone().addScaledVector(f.right, f.halfWidth);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(toX(a.x), toY(a.z));
    ctx.lineTo(toX(b.x), toY(b.z));
    ctx.stroke();

    // Racers, player last so it sits on top.
    const ordered = [...this.game.karts].sort((p, q) => (p.isPlayer ? 1 : 0) - (q.isPlayer ? 1 : 0));
    for (const kart of ordered) {
      const x = toX(kart.position.x);
      const y = toY(kart.position.z);
      ctx.beginPath();
      ctx.arc(x, y, kart.isPlayer ? 6 : 4.4, 0, Math.PI * 2);
      ctx.fillStyle = '#' + kart.color.getHexString();
      ctx.fill();
      ctx.lineWidth = kart.isPlayer ? 2.4 : 1.4;
      ctx.strokeStyle = kart.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.65)';
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ standings

  _buildStandings() {
    const wrap = this.el.standings;
    wrap.innerHTML = '';
    for (let i = 0; i < this.game.karts.length; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="n"></span><span class="dot"></span>
        <span class="name"></span><span class="gap"></span>`;
      wrap.appendChild(row);
      this.rows.push({
        row,
        n: row.querySelector('.n'),
        dot: row.querySelector('.dot'),
        name: row.querySelector('.name'),
        gap: row.querySelector('.gap'),
      });
    }
  }

  drawStandings(order) {
    for (let i = 0; i < order.length; i++) {
      const kart = order[i];
      const r = this.rows[i];
      r.n.textContent = i + 1;
      r.dot.style.background = '#' + kart.color.getHexString();
      r.name.textContent = kart.def.name;
      r.row.classList.toggle('me', kart.isPlayer);
      r.row.classList.toggle('done', kart.finished);
      if (kart.finished) {
        r.gap.textContent = formatTime(kart.finishTime);
      } else if (i === 0) {
        r.gap.textContent = '—';
      } else {
        const d = order[0].distance - kart.distance;
        r.gap.textContent = d > 999 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`;
      }
    }
  }

  // ----------------------------------------------------------------- item

  setItem(kart) {
    const slot = this.el.itemSlot;

    if (kart.itemRoulette > 0) {
      slot.classList.add('rolling', 'filled');
      slot.classList.remove('empty');
      this.rouletteFace += 1;
      const keys = Object.keys(ICONS);
      const face = keys[Math.floor(this.rouletteFace / 4) % keys.length];
      this.el.itemIcon.innerHTML = ICONS[face];
      this.el.itemName.textContent = '';
      this.shownItem = undefined;
      return;
    }

    slot.classList.remove('rolling');
    if (kart.item === this.shownItem) return;
    this.shownItem = kart.item;

    if (!kart.item) {
      slot.classList.add('empty');
      slot.classList.remove('filled');
      this.el.itemIcon.innerHTML = '';
      this.el.itemName.textContent = '';
      return;
    }

    slot.classList.remove('empty');
    slot.classList.add('filled', 'pop');
    setTimeout(() => slot.classList.remove('pop'), 150);
    this.el.itemIcon.innerHTML = ICONS[kart.item] || '';
    this.el.itemName.textContent = itemDisplayName(kart.item);
  }

  // -------------------------------------------------------------- messages

  message(text, kind = 'hot') {
    const el = this.el.centerMsg;
    el.textContent = text;
    el.className = `center-msg ${kind}`;
    // Restart the animation.
    void el.offsetWidth;
    el.classList.add('show');
  }

  countdown(text, isGo = false) {
    const el = this.el.countdown;
    el.textContent = text;
    el.className = 'countdown';
    void el.offsetWidth;
    el.classList.add(isGo ? 'go' : 'tick');
  }

  hurt() {
    this.hurtTimer = 0.22;
    this.el.tint.classList.add('hurt');
  }

  // ---------------------------------------------------------------- update

  update(dt, order) {
    const player = this.game.player;

    // Position + lap.
    const place = order.indexOf(player) + 1;
    this.el.placeNum.textContent = place;
    this.el.placeSuffix.textContent = ordinal(place);
    this.el.lapNum.textContent = player.lap;
    this.el.lapBox.classList.toggle('final', player.lap === RACE.laps && !player.finished);
    this.el.raceTime.textContent = formatTime(this.game.raceTime);

    // Speed.
    const kmh = Math.round(player.speedKmh);
    this.el.speedNum.textContent = kmh;
    const maxKmh = (KART.topSpeed + KART.boostTopSpeedBonus) * 3.6;
    const frac = Math.min(1, kmh / maxKmh);
    this.el.speedoFill.style.strokeDashoffset = String(245 - 245 * frac);
    const boosting = player.boostTimer > 0;
    this.el.speedo.classList.toggle('boosting', boosting);

    // Drift charge / boost badge.
    let badge = '';
    if (boosting) badge = 'BOOST';
    else if (player.driftActive) {
      const tier = player.driftTier();
      badge = tier < 0 ? 'DRIFT' : ['BLUE TURBO', 'ORANGE TURBO', 'VIOLET TURBO'][tier];
    } else if (player.gliding) badge = 'GLIDING';
    this.el.gearBadge.textContent = badge;
    this.el.gearBadge.classList.toggle('on', !!badge);

    // Speed lines when going quickly.
    this.el.speedLines.classList.toggle('on', boosting || frac > 0.86);

    this.setItem(player);
    this.drawStandings(order);
    this.drawMinimap();

    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.el.tint.classList.remove('hurt');
    }
  }

  // --------------------------------------------------------------- results

  showResults(order) {
    const list = this.el.resultsList;
    list.innerHTML = '';
    const playerPlace = order.indexOf(this.game.player) + 1;
    this.el.resultsTitle.textContent =
      playerPlace === 1 ? 'WINNER!' : `${playerPlace}${ordinal(playerPlace)} PLACE`;

    order.forEach((kart, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (kart.isPlayer ? ' me' : '') + (kart.finished ? '' : ' dnf');
      row.style.animationDelay = `${i * 60}ms`;
      row.innerHTML = `
        <span class="pos">${i + 1}${ordinal(i + 1)}</span>
        <span class="dot" style="background:#${kart.color.getHexString()}"></span>
        <span class="name">${kart.def.name}</span>
        <span class="time">${kart.finished ? formatTime(kart.finishTime) : 'DNF'}</span>`;
      list.appendChild(row);
    });
    this.el.results.hidden = false;
  }

  hideResults() {
    this.el.results.hidden = true;
  }
}
