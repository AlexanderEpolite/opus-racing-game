/**
 * Sunset Ridge GP -- multiplayer relay server.
 *
 * One file, no dependencies under Bun. It is deliberately a *relay*, not an
 * authority: clients are assumed honest, so each one simulates its own kart
 * (and the host also simulates the CPUs) and this process only has to shuttle
 * state around, keep the lobby consistent, and hand everyone the same start
 * time. That keeps latency invisible during a race and the code small.
 *
 * Run it:
 *   bun run server/server.ts                      # port 8787
 *   PORT=9000 bun run server/server.ts
 *   node --experimental-strip-types server/server.ts   # Node 22.6+, needs `ws`
 *
 * The client connects to wss://co5-game-ws.epolite.net/ (see src/config.js),
 * which is expected to be a TLS reverse proxy in front of this process. For
 * local testing, load the game with ?ws=ws://localhost:8787.
 *
 * Wire protocol -- JSON objects tagged with `t`:
 *
 *   in   hello {name}                out  welcome {id, time}
 *   in   create {track}              out  room {code, host, track, state, players[]}
 *   in   join {code}                 out  room | error {msg, code}
 *   in   leave
 *   in   track {track}   (host)      out  room
 *   in   ready {v}                   out  room
 *   in   start           (host)      out  loading {track, players[]}
 *   in   loaded                      out  go {at}          (server clock, ms)
 *   in   s {k:[[slot,...],...]}      out  s {k, from}      (relayed)
 *   in   e {ev, ...}                 out  e {ev, ..., from} (relayed)
 *   in   done                        out  room             (back to the lobby)
 *   in   ping {c}                    out  pong {c, time}
 *                                    out  left {id, slot}
 */

const PORT = Number(process.env.PORT || 8787);
const MAX_PLAYERS = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const ROOM_IDLE_MS = 30 * 60 * 1000;
const LOAD_TIMEOUT_MS = 25000;
const HEARTBEAT_MS = 25000;

/** Kart livery, handed out by grid slot so every client agrees on colours. */
const COLORS = [0x35d1ff, 0xffd23f, 0xff4d6d, 0x7cf07c, 0xb07cff, 0xff8b3d, 0xffffff, 0x2f6bff];

type Json = Record<string, unknown>;

interface Socket {
  send(data: string): void;
  close(): void;
}

interface Player {
  id: string;
  name: string;
  socket: Socket;
  room: Room | null;
  ready: boolean;
  loaded: boolean;
  done: boolean;
  slot: number;
  alive: boolean;
}

interface Room {
  code: string;
  hostId: string;
  track: string;
  state: 'lobby' | 'loading' | 'racing';
  players: Player[];
  touched: number;
  loadTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();
const players = new Map<Socket, Player>();
let nextId = 1;

// ------------------------------------------------------------------ helpers

function send(socket: Socket, msg: Json): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* the socket is on its way out; the close handler will tidy up */
  }
}

function broadcast(room: Room, msg: Json, except?: Player): void {
  const data = JSON.stringify(msg);
  for (const p of room.players) {
    if (p === except) continue;
    try {
      p.socket.send(data);
    } catch {
      /* ignore */
    }
  }
}

function makeCode(): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `R${Date.now().toString(36).toUpperCase().slice(-3)}`;
}

function roster(room: Room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    ready: p.ready,
    slot: p.slot,
    color: COLORS[p.slot % COLORS.length],
    host: p.id === room.hostId,
  }));
}

function sendRoom(room: Room): void {
  room.touched = Date.now();
  broadcast(room, {
    t: 'room',
    code: room.code,
    host: room.hostId,
    track: room.track,
    state: room.state,
    players: roster(room),
  });
}

function reslot(room: Room): void {
  room.players.forEach((p, i) => {
    p.slot = i;
  });
}

function leaveRoom(player: Player): void {
  const room = player.room;
  if (!room) return;
  player.room = null;
  const slot = player.slot;
  const i = room.players.indexOf(player);
  if (i >= 0) room.players.splice(i, 1);

  if (!room.players.length) {
    if (room.loadTimer) clearTimeout(room.loadTimer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === player.id) room.hostId = room.players[0].id;
  // Grid slots are fixed for the duration of a race: renumbering mid-race would
  // rename everybody's kart. Out of a race it keeps the lobby tidy.
  if (room.state === 'lobby') reslot(room);
  broadcast(room, { t: 'left', id: player.id, slot });
  sendRoom(room);
  maybeStart(room);
  maybeFinish(room);
}

/** Everyone has built the circuit -- hand out a shared start time. */
function maybeStart(room: Room): void {
  if (room.state !== 'loading') return;
  if (!room.players.every((p) => p.loaded)) return;
  if (room.loadTimer) {
    clearTimeout(room.loadTimer);
    room.loadTimer = null;
  }
  room.state = 'racing';
  for (const p of room.players) p.done = false;
  broadcast(room, { t: 'go', at: Date.now() + 1200 });
}

/** Everyone has seen the results -- drop back to the lobby. */
function maybeFinish(room: Room): void {
  if (room.state !== 'racing') return;
  if (!room.players.every((p) => p.done)) return;
  room.state = 'lobby';
  for (const p of room.players) {
    p.ready = false;
    p.loaded = false;
    p.done = false;
  }
  sendRoom(room);
}

// ------------------------------------------------------------ message loop

function handle(player: Player, msg: Json): void {
  const room = player.room;
  switch (msg.t) {
    case 'hello': {
      player.name = String(msg.name || 'PLAYER').slice(0, 12).toUpperCase() || 'PLAYER';
      send(player.socket, { t: 'welcome', id: player.id, time: Date.now() });
      if (room) sendRoom(room);
      break;
    }

    case 'ping':
      send(player.socket, { t: 'pong', c: msg.c, time: Date.now() });
      break;

    case 'create': {
      if (room) leaveRoom(player);
      const created: Room = {
        code: makeCode(),
        hostId: player.id,
        track: String(msg.track || 'sunset'),
        state: 'lobby',
        players: [player],
        touched: Date.now(),
        loadTimer: null,
      };
      player.room = created;
      player.slot = 0;
      player.ready = false;
      rooms.set(created.code, created);
      sendRoom(created);
      break;
    }

    case 'join': {
      const code = String(msg.code || '').toUpperCase();
      const target = rooms.get(code);
      if (!target) {
        send(player.socket, { t: 'error', code: 'noroom', msg: `no room called ${code}` });
        break;
      }
      if (target.players.length >= MAX_PLAYERS) {
        send(player.socket, { t: 'error', code: 'full', msg: 'that room is full' });
        break;
      }
      if (target.state !== 'lobby') {
        send(player.socket, { t: 'error', code: 'racing', msg: 'that race has already started' });
        break;
      }
      if (room) leaveRoom(player);
      player.room = target;
      player.ready = false;
      player.loaded = false;
      player.done = false;
      target.players.push(player);
      reslot(target);
      sendRoom(target);
      break;
    }

    case 'leave':
      leaveRoom(player);
      break;

    case 'track':
      if (!room || room.hostId !== player.id || room.state !== 'lobby') break;
      room.track = String(msg.track || 'sunset');
      for (const p of room.players) p.ready = false;
      sendRoom(room);
      break;

    case 'ready':
      if (!room) break;
      player.ready = !!msg.v;
      sendRoom(room);
      break;

    case 'start': {
      if (!room || room.hostId !== player.id || room.state !== 'lobby') break;
      room.state = 'loading';
      reslot(room);
      for (const p of room.players) {
        p.loaded = false;
        p.done = false;
      }
      broadcast(room, {
        t: 'loading',
        track: room.track,
        players: roster(room),
      });
      // Nobody waits forever for a client that cannot build the circuit.
      room.loadTimer = setTimeout(() => {
        room.loadTimer = null;
        if (room.state !== 'loading') return;
        for (const p of room.players) p.loaded = true;
        maybeStart(room);
      }, LOAD_TIMEOUT_MS);
      break;
    }

    case 'loaded':
      if (!room) break;
      player.loaded = true;
      maybeStart(room);
      break;

    case 'done':
      if (!room) break;
      player.done = true;
      maybeFinish(room);
      break;

    case 's':
      if (!room || room.state !== 'racing') break;
      broadcast(room, { t: 's', k: msg.k, from: player.id }, player);
      break;

    case 'e':
      if (!room) break;
      broadcast(room, { ...msg, t: 'e', from: player.id, slot: msg.slot ?? player.slot }, player);
      break;

    default:
      break;
  }
}

function connect(socket: Socket): Player {
  const player: Player = {
    id: `p${nextId++}`,
    name: 'PLAYER',
    socket,
    room: null,
    ready: false,
    loaded: false,
    done: false,
    slot: 0,
    alive: true,
  };
  players.set(socket, player);
  send(socket, { t: 'welcome', id: player.id, time: Date.now() });
  return player;
}

function disconnect(socket: Socket): void {
  const player = players.get(socket);
  if (!player) return;
  leaveRoom(player);
  players.delete(socket);
}

function message(socket: Socket, raw: string | ArrayBuffer | Uint8Array): void {
  const player = players.get(socket);
  if (!player) return;
  player.alive = true;
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array) text = new TextDecoder().decode(raw);
  else text = new TextDecoder().decode(new Uint8Array(raw));
  let msg: Json;
  try {
    msg = JSON.parse(text) as Json;
  } catch {
    return;
  }
  try {
    handle(player, msg);
  } catch (err) {
    console.error('handler failed', err);
  }
}

// Sweep out rooms nobody has touched in half an hour.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.players.length || now - room.touched > ROOM_IDLE_MS) {
      if (!room.players.length) {
        if (room.loadTimer) clearTimeout(room.loadTimer);
        rooms.delete(code);
      }
    }
  }
}, 60000);

// ---------------------------------------------------------------- runtimes

declare const Bun: {
  serve(options: unknown): { port: number };
} | undefined;

const STATUS = () => JSON.stringify({
  ok: true,
  service: 'opus-racing-ws',
  rooms: rooms.size,
  players: players.size,
});

if (typeof Bun !== 'undefined') {
  // --- Bun ---------------------------------------------------------------
  Bun.serve({
    port: PORT,
    idleTimeout: 120,
    fetch(req: Request, server: { upgrade(req: Request): boolean }) {
      if (server.upgrade(req)) return undefined;
      return new Response(STATUS(), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    },
    websocket: {
      open(ws: Socket) {
        connect(ws);
      },
      message(ws: Socket, data: string | Uint8Array) {
        message(ws, data);
      },
      close(ws: Socket) {
        disconnect(ws);
      },
    },
  });
  console.log(`racing relay listening on :${PORT} (bun)`);
} else {
  // --- Node (22.6+ for native TypeScript, plus `npm i ws`) ----------------
  const http = await import('node:http');
  const { WebSocketServer } = await import('ws');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(STATUS());
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws: Socket & { on(ev: string, fn: (...args: never[]) => void): void }) => {
    connect(ws);
    ws.on('message', ((data: Buffer) => message(ws, new Uint8Array(data))) as never);
    ws.on('close', (() => disconnect(ws)) as never);
    ws.on('error', (() => disconnect(ws)) as never);
  });
  setInterval(() => {
    for (const [socket, player] of players) {
      const ws = socket as unknown as { ping?: () => void; terminate?: () => void };
      if (!player.alive) {
        ws.terminate?.();
        disconnect(socket);
        continue;
      }
      player.alive = false;
      ws.ping?.();
    }
  }, HEARTBEAT_MS);
  server.listen(PORT, () => console.log(`racing relay listening on :${PORT} (node)`));
}
