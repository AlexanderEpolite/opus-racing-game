import { TRACKS, DEFAULT_TRACK, trackById } from './tracks/index.js';
import { NetClient } from './net.js';

/**
 * Everything outside the race itself: circuit selection, the multiplayer entry
 * screen, and the room lobby.
 *
 * The menu owns the NetClient and drives the lobby half of the protocol; the
 * game is handed the same client (`attachNet`) and deals with the in-race half.
 * Room state always comes from the server's `room` broadcast, so the UI is a
 * pure render of whatever the server last said.
 */

const STORE_NAME = 'srgp.name';
const STORE_TRACK = 'srgp.track';

function read(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* private browsing, never mind */ }
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.room = null;
    this.ready = false;
    this.selected = trackById(read(STORE_TRACK, DEFAULT_TRACK)).id;
    this.name = read(STORE_NAME, 'PLAYER');

    const $ = (id) => document.getElementById(id);
    this.el = {
      start: $('start-screen'),
      startBtn: $('start-btn'),
      mpBtn: $('mp-btn'),
      blurb: $('track-blurb'),
      trackGrid: $('track-grid'),
      loadingNote: $('loading-note'),

      mp: $('mp-screen'),
      mpName: $('mp-name'),
      mpHost: $('mp-host'),
      mpCode: $('mp-code'),
      mpJoin: $('mp-join'),
      mpBack: $('mp-back'),
      mpStatus: $('mp-status'),

      lobby: $('lobby-screen'),
      lobbyCode: $('lobby-code'),
      lobbyPlayers: $('lobby-players'),
      lobbyCount: $('lobby-count'),
      lobbyTracks: $('lobby-tracks'),
      lobbyTrackNote: $('lobby-track-note'),
      lobbyReady: $('lobby-ready'),
      lobbyStart: $('lobby-start'),
      lobbyLeave: $('lobby-leave'),
      lobbyStatus: $('lobby-status'),

      loading: $('loading-screen'),
      loadingTitle: $('loading-title'),
      loadingKind: $('loading-kind'),
      loadingText: $('loading-text'),
      loadingFill: $('loading-fill'),

      pause: $('pause-screen'),
      resumeBtn: $('resume-btn'),
      restartBtn: $('restart-btn'),
      quitBtn: $('quit-btn'),

      results: $('results-screen'),
      againBtn: $('again-btn'),
      resultsMenuBtn: $('results-menu-btn'),
    };

    this.el.mpName.value = this.name;
    this.el.startBtn.disabled = true;

    this.cards = this._renderCards(this.el.trackGrid, (id) => this.selectTrack(id));
    this.lobbyCards = this._renderCards(this.el.lobbyTracks, (id) => this.pickRoomTrack(id));
    this.selectTrack(this.selected);
    this._wire();
  }

  /** Called once the first circuit has finished building. */
  onReady() {
    this.el.startBtn.disabled = false;
    this.el.loadingNote.textContent = 'ready when you are';
    this.show('start');
  }

  // ------------------------------------------------------------- rendering

  _renderCards(host, onPick) {
    host.innerHTML = '';
    const cards = new Map();
    for (const def of TRACKS) {
      const card = document.createElement('button');
      card.className = 'track-card';
      card.type = 'button';
      card.dataset.track = def.id;
      card.innerHTML = `
        <span class="tc-name">${def.short}</span>
        <span class="tc-meta">${def.kind === 'sprint' ? 'POINT&nbsp;TO&nbsp;POINT' : `${def.laps} LAPS`}</span>
        <span class="tc-blurb">${def.blurb}</span>`;
      card.style.setProperty('--tc-tint', `#${(def.theme.gantry.tint[0] || '#ffffff').replace('#', '')}`);
      card.addEventListener('click', () => onPick(def.id));
      host.appendChild(card);
      cards.set(def.id, card);
    }
    return cards;
  }

  _mark(cards, id) {
    for (const [key, card] of cards) card.classList.toggle('on', key === id);
  }

  selectTrack(id) {
    this.selected = id;
    write(STORE_TRACK, id);
    this._mark(this.cards, id);
    const def = trackById(id);
    this.el.blurb.textContent = def.blurb;
  }

  pickRoomTrack(id) {
    if (!this.net?.isHost) return;
    this.net.setTrack(id);
  }

  show(screen) {
    const map = {
      start: this.el.start,
      mp: this.el.mp,
      lobby: this.el.lobby,
      loading: this.el.loading,
    };
    for (const [key, el] of Object.entries(map)) el.hidden = key !== screen;
  }

  // ---------------------------------------------------------------- wiring

  _wire() {
    this.el.startBtn.addEventListener('click', () => this.startSolo());
    this.el.mpBtn.addEventListener('click', () => {
      this.el.mpStatus.textContent = '';
      this.show('mp');
    });
    this.el.mpBack.addEventListener('click', () => this.show('start'));

    this.el.mpName.addEventListener('change', () => {
      this.name = (this.el.mpName.value || 'PLAYER').toUpperCase().slice(0, 12);
      this.el.mpName.value = this.name;
      write(STORE_NAME, this.name);
    });
    this.el.mpCode.addEventListener('input', () => {
      this.el.mpCode.value = this.el.mpCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    this.el.mpCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join();
    });

    this.el.mpHost.addEventListener('click', () => this.host());
    this.el.mpJoin.addEventListener('click', () => this.join());

    this.el.lobbyReady.addEventListener('click', () => {
      this.ready = !this.ready;
      this.net?.setReady(this.ready);
    });
    this.el.lobbyStart.addEventListener('click', () => this.net?.startRace());
    this.el.lobbyLeave.addEventListener('click', () => this.leaveRoom());

    this.el.resumeBtn.addEventListener('click', () => this.game.setPaused(false));
    this.el.restartBtn.addEventListener('click', () => {
      this.game.setPaused(false);
      this.game.hud.hideResults();
      this.game.beginRace();
    });
    this.el.quitBtn.addEventListener('click', () => this.quitToMenu());

    this.el.againBtn.addEventListener('click', () => {
      this.game.hud.hideResults();
      this.game.beginRace();
    });
    this.el.resultsMenuBtn.addEventListener('click', () => {
      this.game.hud.hideResults();
      if (this.game.mode === 'net') this.backToLobby();
      else this.quitToMenu();
    });
  }

  /** Enter / Space on the start screen drops the clutch. */
  onConfirm() {
    if (!this.el.start.hidden && !this.el.startBtn.disabled) this.startSolo();
    else if (!this.el.results.hidden && this.game.mode === 'solo') {
      this.game.hud.hideResults();
      this.game.beginRace();
    }
  }

  // ----------------------------------------------------------- solo racing

  async startSolo() {
    if (this.busy) return;
    this.busy = true;
    this.el.startBtn.disabled = true;
    try {
      const needsBuild = this.selected !== this.game.trackId || this.game.mode === 'net';
      if (needsBuild) this.beginLoading(this.selected);
      this.show(needsBuild ? 'loading' : null);
      await this.game.startSolo(this.selected);
      this.show(null);
    } catch (err) {
      console.error(err);
      this.el.loadingText.textContent = `could not build that circuit: ${err.message}`;
    } finally {
      this.busy = false;
      this.el.startBtn.disabled = false;
    }
  }

  beginLoading(trackId) {
    const def = trackById(trackId);
    this.el.loadingTitle.textContent = def.name;
    this.el.loadingKind.textContent =
      def.kind === 'sprint' ? 'POINT TO POINT' : `${def.laps} LAPS`;
    this.el.loadingText.textContent = 'building…';
    this.el.loadingFill.style.width = '4%';
  }

  /** Progress hook handed to Game.loadTrack. */
  onLoadStep(text, fraction) {
    this.el.loadingText.textContent = text;
    this.el.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
    this.el.loadingNote.textContent = text;
  }

  quitToMenu() {
    if (this.game.mode === 'net') this.leaveRoom();
    this.game.returnToMenu();
    this.show('start');
  }

  // ---------------------------------------------------------- multiplayer

  async connect() {
    if (!this.net) {
      this.net = new NetClient();
      this.game.attachNet(this.net);
      this._wireNet();
    }
    this.name = (this.el.mpName.value || 'PLAYER').toUpperCase().slice(0, 12);
    write(STORE_NAME, this.name);
    await this.net.connect(this.name);
  }

  _wireNet() {
    const net = this.net;
    net.on('room', (msg) => this.onRoom(msg));
    net.on('error', (msg) => {
      this.el.mpStatus.textContent = msg.msg || 'the server said no';
      this.el.lobbyStatus.textContent = msg.msg || '';
    });
    net.on('close', () => {
      this.room = null;
      this.el.mpStatus.textContent = 'lost the connection';
      if (!this.el.lobby.hidden) this.show('mp');
    });
    net.on('loading', (msg) => this.onNetLoading(msg));
    net.on('go', (msg) => {
      this.show(null);
      this.game.scheduleNetStart(msg.at);
    });
  }

  async host() {
    if (this.busy) return;
    this.busy = true;
    this.el.mpStatus.textContent = 'connecting…';
    try {
      await this.connect();
      this.net.createRoom(this.selected);
      this.el.mpStatus.textContent = '';
    } catch (err) {
      this.el.mpStatus.textContent = `could not reach the server (${err.message})`;
    } finally {
      this.busy = false;
    }
  }

  async join() {
    const code = this.el.mpCode.value.trim().toUpperCase();
    if (code.length < 4) {
      this.el.mpStatus.textContent = 'room codes are four characters';
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.el.mpStatus.textContent = 'connecting…';
    try {
      await this.connect();
      this.net.joinRoom(code);
      this.el.mpStatus.textContent = '';
    } catch (err) {
      this.el.mpStatus.textContent = `could not reach the server (${err.message})`;
    } finally {
      this.busy = false;
    }
  }

  leaveRoom() {
    this.net?.leaveRoom();
    this.room = null;
    this.ready = false;
    this.game.mode = 'solo';
    this.show('mp');
  }

  backToLobby() {
    this.game.returnToMenu();
    this.net?.returnToLobby();
    this.ready = false;
    this.show(this.room ? 'lobby' : 'start');
  }

  onRoom(msg) {
    this.room = msg;
    const me = msg.players.find((p) => p.id === this.net.id);
    this.ready = !!me?.ready;
    this.el.lobbyCode.textContent = msg.code;
    this.el.lobbyCount.textContent = `${msg.players.length}/8`;
    this._mark(this.lobbyCards, msg.track);

    const isHost = this.net.isHost;
    for (const [, card] of this.lobbyCards) card.classList.toggle('locked', !isHost);
    this.el.lobbyTrackNote.textContent = isHost
      ? 'You are the host — pick the circuit, then start when everyone is ready.'
      : `The host is choosing. Circuit: ${trackById(msg.track).name}.`;

    this.el.lobbyPlayers.innerHTML = '';
    for (const p of msg.players) {
      const row = document.createElement('div');
      row.className = 'lobby-row' + (p.id === this.net.id ? ' me' : '');
      row.innerHTML = `
        <span class="dot" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>
        <span class="lp-name">${p.name}</span>
        ${p.host ? '<span class="tag host">HOST</span>' : ''}
        ${p.ready ? '<span class="tag ready">READY</span>' : '<span class="tag">…</span>'}`;
      this.el.lobbyPlayers.appendChild(row);
    }

    this.el.lobbyReady.textContent = this.ready ? 'NOT READY' : 'READY';
    this.el.lobbyReady.classList.toggle('ghost', this.ready);
    this.el.lobbyStart.hidden = !isHost;
    const others = msg.players.filter((p) => p.id !== msg.host);
    const allReady = others.every((p) => p.ready);
    this.el.lobbyStart.disabled = !allReady;
    this.el.lobbyStatus.textContent = isHost && !allReady
      ? 'Waiting for everyone to ready up…'
      : `Circuit: ${trackById(msg.track).name}`;

    if (msg.state === 'lobby') this.show('lobby');
  }

  async onNetLoading(msg) {
    this.beginLoading(msg.track);
    this.show('loading');
    this.el.loadingKind.textContent = 'MULTIPLAYER';
    try {
      await this.game.startNetRace(msg.track, msg.players, this.net.id);
      this.el.loadingText.textContent = 'waiting for the rest of the grid…';
      this.el.loadingFill.style.width = '100%';
    } catch (err) {
      console.error(err);
      this.el.loadingText.textContent = `could not build that circuit: ${err.message}`;
    }
  }
}
