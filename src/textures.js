import * as THREE from 'three';

/**
 * Every texture in the game is drawn procedurally into a canvas at load time --
 * that keeps the project to zero binary assets and zero network requests.
 *
 * The surface textures take their palette from the loaded track's theme, so the
 * same drawing code produces sun-baked asphalt, packed snow or cracked basalt.
 * Results are cached per theme key: switching back to a circuit you have already
 * visited costs nothing.
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

/** Road surface with painted edge lines, a dashed centre stripe and theme grime. */
export function roadTexture(theme) {
  const r = theme.road;
  return make(`road:${theme.key}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = r.asphalt;
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, r.noise ?? 34);

    // Subtle darker wheel tracks where karts actually drive.
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.16)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Per-theme surface character.
    if (r.frost) {
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(226,242,255,0.55)' : 'rgba(160,196,220,0.45)';
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + Math.random() * 26, 3 + Math.random() * 9, Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (r.moss) {
      ctx.globalAlpha = 0.32;
      for (let i = 0; i < 34; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#4c6b3f' : '#3d5a30';
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (r.cracks) {
      ctx.strokeStyle = r.cracks;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 9; i++) {
        ctx.lineWidth = 0.7 + Math.random() * 1.6;
        ctx.beginPath();
        let x = Math.random() * w;
        let y = Math.random() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (Math.random() - 0.5) * 40;
          y += (Math.random() - 0.5) * 60;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Solid edge lines.
    ctx.fillStyle = r.line;
    ctx.fillRect(w * 0.035, 0, w * 0.022, h);
    ctx.fillRect(w * 0.943, 0, w * 0.022, h);

    // Dashed centre line (the texture's vertical axis runs along the track).
    ctx.fillStyle = r.centre;
    ctx.fillRect(w * 0.492, h * 0.08, w * 0.016, h * 0.42);
  });
}

/** Two-tone kerbing. */
export function kerbTexture(theme) {
  const k = theme.kerb;
  return make(`kerb:${theme.key}`, 32, 64, (ctx, w, h) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? k.b : k.a;
      ctx.fillRect(0, (i * h) / 4, w, h / 4);
    }
    noise(ctx, w, h, 16);
  });
}

/** Run-off beside the road: dirt, snow or ash depending on the theme. */
export function shoulderTexture(theme) {
  const s = theme.shoulder;
  return make(`shoulder:${theme.key}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = s.base;
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, s.noise ?? 46);
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? s.speckA : s.speckB;
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
export function bannerTexture(theme) {
  const b = theme.banner;
  return make(`banner:${theme.key}`, 1024, 128, (ctx, w, h) => {
    const words = b.words;
    const colors = b.colors;
    const slice = w / words.length;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < words.length; i++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * slice, 0, slice, h);
      ctx.clip();

      ctx.fillStyle = colors[i % colors.length];
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
