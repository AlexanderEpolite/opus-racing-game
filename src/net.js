import { NET } from './config.js';

/**
 * Thin WebSocket client for the lobby/relay server (see server/server.ts).
 *
 * The server is a relay, not a simulation: every client owns its own kart (and
 * the host additionally owns the CPUs), broadcasts that state ~20 times a second
 * and replays what everybody else sends. Clients are trusted, so there is no
 * reconciliation to do -- only interpolation, which lives in Kart.updateRemote.
 *
 * Messages are small JSON objects with a one-or-two letter `t` tag:
 *   hello/welcome   handshake, hands back this connection's id
 *   create/join     room management; rooms are 4-character codes
 *   room            authoritative lobby snapshot, broadcast on every change
 *   track/ready     lobby settings (track is host-only)
 *   loading/loaded  everybody builds the circuit, then reports in
 *   go              race start, stamped on the server clock
 *   s               batched kart state
 *   e               game events (item used, box taken)
 *   ping/pong       clock sync
 */

const WS_URL = new URLSearchParams(location.search).get('ws') || NET.url;

export class NetClient {
  constructor(url = WS_URL) {
    this.url = url;
    this.socket = null;
    this.id = null;
    this.room = null;
    this.listeners = new Map();
    this.latency = 0;
    this.clockOffset = 0;   // serverNow() = Date.now() + clockOffset
    this.connected = false;
    this.name = 'PLAYER';
    this._pingTimer = null;
    this._pingSent = 0;
  }

  // ------------------------------------------------------------- plumbing

  on(type, fn) {
    let list = this.listeners.get(type);
    if (!list) this.listeners.set(type, (list = []));
    list.push(fn);
    return this;
  }

  emit(type, payload) {
    const list = this.listeners.get(type);
    if (list) for (const fn of list) fn(payload);
  }

  connect(name) {
    if (name) this.name = name;
    if (this.connected) {
      this.send({ t: 'hello', name: this.name });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }
      this.socket = socket;
      const failed = (why) => {
        clearTimeout(timer);
        reject(new Error(why));
      };
      const timer = setTimeout(() => {
        socket.close();
        failed('no answer');
      }, NET.timeout);

      socket.addEventListener('open', () => {
        clearTimeout(timer);
        this.connected = true;
        this.send({ t: 'hello', name: this.name });
        this._startPings();
        this.emit('open');
        resolve();
      });
      socket.addEventListener('error', () => failed('connection refused'));
      socket.addEventListener('close', () => {
        clearTimeout(timer);
        const wasConnected = this.connected;
        this.connected = false;
        this.id = null;
        this.room = null;
        this._stopPings();
        if (wasConnected) this.emit('close');
        else failed('connection refused');
      });
      socket.addEventListener('message', (ev) => this._receive(ev.data));
    });
  }

  disconnect() {
    this._stopPings();
    if (this.socket && this.connected) {
      try {
        this.send({ t: 'leave' });
      } catch { /* the socket is going away anyway */ }
      this.socket.close();
    }
    this.connected = false;
    this.room = null;
  }

  send(obj) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(obj));
    return true;
  }

  _receive(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.clockOffset = msg.time - Date.now();
        this.emit('welcome', msg);
        break;
      case 'pong': {
        const rtt = Date.now() - msg.c;
        this.latency = rtt / 2;
        // Server time at the moment the reply was written, plus the trip home.
        this.clockOffset = msg.time + rtt / 2 - Date.now();
        break;
      }
      case 'room':
        this.room = msg;
        this.emit('room', msg);
        break;
      case 'loading':
        this.emit('loading', msg);
        break;
      case 'go':
        this.emit('go', msg);
        break;
      case 's':
        this.emit('state', msg);
        break;
      case 'e':
        this.emit('event', msg);
        break;
      case 'left':
        this.emit('left', msg);
        break;
      case 'error':
        this.emit('error', msg);
        break;
      default:
        break;
    }
  }

  _startPings() {
    this._stopPings();
    const ping = () => this.send({ t: 'ping', c: Date.now() });
    ping();
    this._pingTimer = setInterval(ping, 3000);
  }

  _stopPings() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  /** Best estimate of the server's clock, used to line up the countdown. */
  serverNow() {
    return Date.now() + this.clockOffset;
  }

  get isHost() {
    return !!this.room && this.room.host === this.id;
  }

  // ------------------------------------------------------------- lobby ops

  createRoom(track) { this.send({ t: 'create', track }); }
  joinRoom(code) { this.send({ t: 'join', code: String(code || '').toUpperCase().trim() }); }
  leaveRoom() { this.send({ t: 'leave' }); }
  setTrack(track) { this.send({ t: 'track', track }); }
  setReady(v) { this.send({ t: 'ready', v: !!v }); }
  startRace() { this.send({ t: 'start' }); }
  reportLoaded() { this.send({ t: 'loaded' }); }
  returnToLobby() { this.send({ t: 'done' }); }

  // -------------------------------------------------------------- in race

  sendStates(states) {
    if (!states.length) return;
    this.send({ t: 's', k: states });
  }

  sendEvent(ev, data = {}) {
    this.send({ t: 'e', ev, ...data });
  }
}
