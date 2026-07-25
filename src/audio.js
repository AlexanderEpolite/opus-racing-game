/**
 * All sound is synthesised with the Web Audio API -- no audio files.
 * The context is created lazily on the first user gesture, as browsers require.
 */

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    const master = this.ctx.createGain();
    master.gain.value = 0.55;
    master.connect(this.ctx.destination);
    this.master = master;

    this._buildEngine();
    this._buildDrift();
    this._buildWind();
    this.ready = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  _noiseBuffer(seconds = 2) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildEngine() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 3;

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 70;
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 35;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.4;

    oscA.connect(filter);
    oscB.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.master);
    oscA.start();
    oscB.start();

    this.engine = { gain, filter, oscA, oscB };
  }

  _buildDrift() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.drift = { gain, filter };
  }

  _buildWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.wind = { gain, filter };
  }

  /** Continuous engine / tyre / wind layer, called every frame. */
  updateEngine(speedFrac, throttle, driftCharge, airborne) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rpm = 62 + speedFrac * 190 + throttle * 14;
    this.engine.oscA.frequency.setTargetAtTime(rpm, t, 0.06);
    this.engine.oscB.frequency.setTargetAtTime(rpm * 0.5, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(500 + speedFrac * 2100, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(airborne ? 0.05 : 0.075 + throttle * 0.05, t, 0.09);

    this.drift.gain.gain.setTargetAtTime(driftCharge > 0 ? 0.06 + driftCharge * 0.05 : 0, t, 0.06);
    this.drift.filter.frequency.setTargetAtTime(1800 + driftCharge * 2600, t, 0.1);

    this.wind.gain.gain.setTargetAtTime(speedFrac * speedFrac * 0.05, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(400 + speedFrac * 1400, t, 0.15);
  }

  // -------------------------------------------------------------- one-shots

  _blip(freq, duration, type = 'square', volume = 0.16, sweep = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  _noiseHit(duration, startFreq, endFreq, volume = 0.3, type = 'lowpass') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(duration + 0.1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(startFreq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  countdownBeep(final = false) {
    this._blip(final ? 880 : 440, final ? 0.5 : 0.18, 'square', 0.22);
  }

  boost() {
    this._noiseHit(0.55, 400, 4200, 0.28, 'bandpass');
    this._blip(180, 0.4, 'sawtooth', 0.14, 700);
  }

  miniTurbo(tier) {
    this._blip(320 + tier * 140, 0.28, 'triangle', 0.2, 500);
    this._noiseHit(0.3, 900, 5000, 0.18, 'bandpass');
  }

  hop() {
    this._blip(520, 0.09, 'sine', 0.11, 180);
  }

  pickup() {
    this._blip(660, 0.09, 'square', 0.14);
    setTimeout(() => this._blip(990, 0.13, 'square', 0.14), 80);
  }

  hit() {
    this._noiseHit(0.42, 1400, 90, 0.34);
    this._blip(90, 0.3, 'sawtooth', 0.2, -50);
  }

  explosion() {
    this._noiseHit(0.85, 2600, 60, 0.42);
    this._blip(64, 0.6, 'sine', 0.26, -30);
  }

  lap() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this._blip(f, 0.2, 'triangle', 0.17), i * 90));
  }

  finish() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._blip(f, 0.32, 'triangle', 0.2), i * 130));
  }

  glider() {
    this._noiseHit(0.7, 300, 1600, 0.16, 'bandpass');
  }

  wall() {
    this._noiseHit(0.16, 900, 220, 0.2);
  }

  launch() {
    this._blip(220, 0.32, 'triangle', 0.16, 420);
  }

  zap() {
    this._noiseHit(0.4, 3000, 600, 0.24, 'bandpass');
    this._blip(1200, 0.25, 'sawtooth', 0.12, -900);
  }
}
