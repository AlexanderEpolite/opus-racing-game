import * as THREE from 'three';

/**
 * Every texture in the game is drawn procedurally into a canvas at load time --
 * that keeps the project to zero binary assets and zero network requests.
 */

const cache = new Map();

function make(key, w, h, draw, options = {}) {
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = options.wrapS || THREE.RepeatWrapping;
  tex.wrapT = options.wrapT || THREE.RepeatWrapping;
  tex.anisotropy = options.anisotropy ?? 8;
  tex.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

function noise(ctx, w, h, amount, alpha) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    if (alpha !== undefined) d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

/** Asphalt with painted edge lines and a dashed centre stripe. */
export function roadTexture() {
  return make('road', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a3a42';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 34);

    // Subtle darker wheel tracks where karts actually drive.
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.16)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Solid edge lines.
    ctx.fillStyle = '#e8e8ee';
    ctx.fillRect(w * 0.035, 0, w * 0.022, h);
    ctx.fillRect(w * 0.943, 0, w * 0.022, h);

    // Dashed centre line (the texture's vertical axis runs along the track).
    ctx.fillStyle = 'rgba(232,232,238,0.75)';
    ctx.fillRect(w * 0.492, h * 0.08, w * 0.016, h * 0.42);
  });
}

/** Red/white kerbing. */
export function kerbTexture() {
  return make('kerb', 32, 64, (ctx, w, h) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#e5e5ea' : '#d8354a';
      ctx.fillRect(0, (i * h) / 4, w, h / 4);
    }
    noise(ctx, w, h, 16);
  });
}

/** Packed dirt run-off. */
export function shoulderTexture() {
  return make('shoulder', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#6b5638';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 46);
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#8a7350' : '#4e3d26';
      const r = 2 + Math.random() * 7;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/** Glowing chevrons for the boost strips. */
export function boostTexture() {
  return make('boost', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#04202c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const y = h - (i + 1) * (h / 3.2);
      const g = ctx.createLinearGradient(0, y, 0, y + h / 4);
      g.addColorStop(0, '#8ffbff');
      g.addColorStop(1, '#12a8e8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w * 0.08, y + h * 0.2);
      ctx.lineTo(w * 0.5, y);
      ctx.lineTo(w * 0.92, y + h * 0.2);
      ctx.lineTo(w * 0.92, y + h * 0.31);
      ctx.lineTo(w * 0.5, y + h * 0.11);
      ctx.lineTo(w * 0.08, y + h * 0.31);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Start/finish chequer. */
export function checkerTexture() {
  return make('checker', 64, 64, (ctx, w, h) => {
    const n = 8;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#141419' : '#f2f2f6';
        ctx.fillRect((x * w) / n, (y * h) / n, w / n, h / n);
      }
    }
  });
}

/** The floating item crate. */
export function itemBoxTexture() {
  return make('itembox', 128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ffd75e');
    g.addColorStop(0.5, '#ff9d3d');
    g.addColorStop(1, '#ff6b9d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(9, 9, w - 18, h - 18);
    // Centre diamond.
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.24);
    ctx.lineTo(w * 0.76, h / 2);
    ctx.lineTo(w / 2, h * 0.76);
    ctx.lineTo(w * 0.24, h / 2);
    ctx.closePath();
    ctx.fill();
  });
}

/** Soft radial blob used for shadows, sparks and explosion puffs. */
export function sparkTexture() {
  return make('spark', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/** Advertising hoardings that line the circuit. */
export function bannerTexture() {
  return make('banner', 1024, 128, (ctx, w, h) => {
    const words = ['SUNSET RIDGE', 'TURBO CELL', 'APEX TYRES', 'NITRO CO'];
    const colors = ['#1d2b53', '#7b2d5e', '#0d5c63', '#8a3324'];
    const slice = w / words.length;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < words.length; i++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * slice, 0, slice, h);
      ctx.clip();

      ctx.fillStyle = colors[i];
      ctx.fillRect(i * slice, 0, slice, h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(i * slice, 0, slice, h * 0.42);

      // Shrink the type until it comfortably fits its panel.
      let size = 56;
      do {
        ctx.font = `bold ${size}px sans-serif`;
        size -= 2;
      } while (ctx.measureText(words[i]).width > slice * 0.86 && size > 12);

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(words[i], i * slice + slice / 2, h / 2);
      ctx.restore();
    }
  });
}
