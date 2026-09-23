// Grid 1v1 server: serves the client and runs online matches authoritatively.
// The browser never simulates in online mode — it sends intent, renders snapshots.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

import {
  createGame,
  step,
  requestMove,
  setHeld,
  requestBomb,
  requestAbility,
  requestFatality,
  resumeWithCountdown,
  viewFor,
} from "./shared/engine.js";
import {
  PROTOCOL,
  TICK_MS,
  SNAPSHOT_MS,
  CLASSES,
  DEFAULT_CLASS,
  MODES,
  DEFAULT_MODE,
  FORMATS,
  DEFAULT_FORMAT,
  COLOR_IDS,
  DEFAULT_COLORS,
  cleanName,
  defaultName,
} from "./shared/constants.js";
import { createBot, handsFor, botNames, randomClass, safeBotLevel } from "./shared/bot.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const SHARED_DIR = join(ROOT, "shared");
const PORT = parseInt(process.env.PORT || "3000", 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

// --- static files -----------------------------------------------------------

// Resolves a URL path to a file inside one of the two served directories,
// or null if it would escape them.
function resolveFile(urlPath) {
  const segments = decodeURIComponent(urlPath.split("?")[0])
    .split("/")
    .filter((part) => part !== "" && part !== ".");

  if (segments.some((part) => part === "..")) return null;
  if (segments.length === 0) return join(PUBLIC_DIR, "index.html");

  // /shared/* is the engine the client shares with this server; everything else is /public.
  const fromShared = segments[0] === "shared";
  const base = fromShared ? SHARED_DIR : PUBLIC_DIR;
  const rest = fromShared ? segments.slice(1) : segments;
  if (rest.length === 0) return null;

  const target = join(base, ...rest);
  return target.startsWith(base) ? target : null;
}

const httpServer = createServer(async (req, res) => {
  let target;
  try {
    target = resolveFile(req.url || "/");
  } catch {
    target = null; // a malformed %-escape
  }
  if (!target) {
    res.writeHead(400).end("Bad request");
    return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

// --- rooms ------------------------------------------------------------------
//
// A room has one seat per player: two for 1v1, four for 2v2. A seat outlives
// its connection. Phones drop sockets all the time — switching apps to send
// the room code, a locked screen, Wi-Fi handing over to mobile data — so a
// dropped player keeps their seat for a grace period and can take it back with
// the secret token they got on joining. A match pauses while a seat is empty
// and resumes with a 3-2-1. Only an explicit "leave", or a grace period running
// out, closes the room.
//
// 1v1 starts as soon as both seats are filled. 2v2 and the free-for-all wait
// in a lobby, where players can move to an empty seat (and so pick their side)
// until the host starts the match — 2v2 with all four seats taken, the
// free-for-all with at least three. Before a match the host can also put a bot
// in any empty seat; bots play inside the match loop and never disconnect.

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 30000); // in a match
const LOBBY_GRACE_MS = Number(process.env.LOBBY_GRACE_MS || 180000);        // before it starts
// Pings keep proxies from cutting quiet sockets (lobby, result screen) and
// find dead peers: a socket that misses a whole interval is dropped.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 20000);

const rooms = new Map();

// Never trust anything off the wire.
const safeClass = (value) => (CLASSES[value] ? value : DEFAULT_CLASS);
const safeMode = (value) => (MODES[value] ? value : DEFAULT_MODE);
const safeFormat = (value) => (FORMATS[value] ? value : DEFAULT_FORMAT);

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(socket, message) {
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message, except = null) {
  for (const seat of room.seats) if (seat && seat !== except) send(seat.socket, message);
}

// Each seat gets its own view of the match: a hidden Shade has no position
// in the other team's copy.
function broadcastState(room) {
  room.seats.forEach((seat, index) => {
    if (seat) send(seat.socket, { type: "state", state: viewFor(room.game, index) });
  });
}

function createRoom(format) {
  const room = {
    code: makeCode(),
    format,
    seats: new Array(FORMATS[format].players).fill(null), // { token, socket, name, color, className, dropTimer, bot }
    host: null,           // the creator's seat
    mode: DEFAULT_MODE,   // chosen by the host; everyone plays the host's mode
    killCam: true,
    game: null,
    bots: [],             // { index, bot, hands } for the seats bots play, while a match runs
    loop: null,
    lastTick: 0,
    backlog: 0,
    sinceSnapshot: 0,
  };
  rooms.set(room.code, room);
  return room;
}

const nameAt = (room, index) => (room.seats[index] && room.seats[index].name) || defaultName(index);
const taken = (seat) => Boolean(seat && (seat.socket || seat.bot));
const allSeated = (room) => room.seats.every(taken);
// Enough to play: every seat in 1v1 and 2v2, three or more in a free-for-all.
const readyToStart = (room) => room.seats.filter(taken).length >= FORMATS[room.format].min;
const isLobby = (room) => room.format !== "duel";

// A colour nobody else in the room has: the one asked for, else the seat's
// default, else the first free one.
function freeColor(room, wanted, index, self = null) {
  const taken = new Set(room.seats.filter((s) => s && s !== self).map((s) => s.color));
  if (COLOR_IDS.includes(wanted) && !taken.has(wanted)) return wanted;
  if (!taken.has(DEFAULT_COLORS[index])) return DEFAULT_COLORS[index];
  return COLOR_IDS.find((c) => !taken.has(c));
}

function sitDown(room, index, socket, msg) {
  const seat = {
    token: randomUUID(),
    socket,
    name: cleanName(msg.name),
    color: null,
    className: safeClass(msg.className),
    dropTimer: null,
  };
  room.seats[index] = seat;
  seat.color = freeColor(room, msg.color, index, seat);
  return seat;
}

// A bot for an empty seat: a name nobody has, a free colour, a random class.
function seatBot(room, index, level) {
  const taken = room.seats.filter(Boolean).map((s) => s.name);
  const seat = {
    token: null,
    socket: null,
    bot: safeBotLevel(level),
    name: botNames(1, taken)[0] || "Bot",
    color: null,
    className: randomClass(),
    dropTimer: null,
  };
  room.seats[index] = seat;
  seat.color = freeColor(room, null, index, seat);
  return seat;
}

function joinedMessage(room, seat) {
  const slot = room.seats.indexOf(seat);
  return {
    type: "joined",
    protocol: PROTOCOL,
    code: room.code,
    slot,
    mode: room.mode,
    format: room.format,
    killCam: room.killCam,
    token: seat.token,
    name: nameAt(room, slot),
    color: seat.color,
  };
}

// The 2v2 lobby as each seat should see it.
function sendLobby(room) {
  const seats = room.seats.map((seat, index) => seat && {
    name: nameAt(room, index),
    color: seat.color,
    className: seat.className,
    connected: Boolean(seat.socket || seat.bot),
    bot: seat.bot || null,
  });
  room.seats.forEach((seat, index) => {
    if (!seat) return;
    send(seat.socket, {
      type: "lobby",
      code: room.code,
      format: room.format,
      min: FORMATS[room.format].min,
      ready: readyToStart(room),
      mode: room.mode,
      killCam: room.killCam,
      slot: index,
      host: room.seats.indexOf(room.host),
      seats,
    });
  });
}

// Timers are late under load. Rather than dropping the lost time (the match
// would slide into slow motion) or taking one huge step (fuses, fire and grace
// timers would skip past each other), catch up in exact TICK_MS steps. Only a
// genuine freeze longer than this is given up on.
const MAX_CATCH_UP_MS = 250;

function runLoop(room) {
  stopLoop(room);
  room.lastTick = Date.now();
  room.backlog = 0;
  room.sinceSnapshot = 0;
  room.loop = setInterval(() => {
    const now = Date.now();
    room.backlog += Math.min(now - room.lastTick, MAX_CATCH_UP_MS);
    room.lastTick = now;

    while (room.backlog >= TICK_MS && room.game.status !== "over") {
      for (const { index, bot, hands } of room.bots) bot.update(viewFor(room.game, index), TICK_MS, hands);
      step(room.game, TICK_MS);
      room.backlog -= TICK_MS;
      room.sinceSnapshot += TICK_MS;
    }

    if (room.sinceSnapshot >= SNAPSHOT_MS || room.game.status === "over") {
      room.sinceSnapshot = 0;
      broadcastState(room);
    }
    if (room.game.status === "over") stopLoop(room);
  }, TICK_MS);
}

function stopLoop(room) {
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
}

function startMatch(room) {
  // A free-for-all can start with empty seats; close the gaps first, so a seat
  // number is a player number for the rest of the match.
  if (room.seats.some((seat) => !taken(seat))) {
    room.seats = [...room.seats.filter(taken), ...room.seats.filter((seat) => !taken(seat))];
    sendLobby(room);
  }
  const players = room.seats.filter(taken);
  room.game = createGame({
    format: room.format,
    mode: room.mode,
    killCam: room.killCam,
    players: players.map((seat) => ({ className: seat.className, name: seat.name, color: seat.color })),
  });
  room.bots = room.seats
    .map((seat, index) => seat && seat.bot && index < players.length &&
      { index, bot: createBot(index, seat.bot), hands: handsFor(room.game, index) })
    .filter(Boolean);
  broadcast(room, {
    type: "start",
    classes: players.map((seat) => seat.className),
    mode: room.mode,
    format: room.format,
    killCam: room.killCam,
  });
  runLoop(room);
}

function closeRoom(room, reason) {
  stopLoop(room);
  for (const seat of room.seats) if (seat) clearTimeout(seat.dropTimer);
  broadcast(room, { type: "ended", reason });
  rooms.delete(room.code);
}

// A seat just emptied without a "leave": hold it, and pause a running match.
// If nobody comes back, a match ends; a lobby frees the seat (or closes, if
// it was the host's).
function seatDropped(room, seat) {
  const index = room.seats.indexOf(seat);
  const grace = room.game ? RECONNECT_GRACE_MS : LOBBY_GRACE_MS;
  stopLoop(room); // the game state stays exactly as it was
  broadcast(room, { type: "opponent-lost", slot: index, grace }, seat);
  if (!room.game && isLobby(room)) sendLobby(room);
  clearTimeout(seat.dropTimer);
  seat.dropTimer = setTimeout(() => {
    if (seat.socket || !rooms.has(room.code) || !room.seats.includes(seat)) return;
    if (!room.game && seat !== room.host) {
      room.seats[room.seats.indexOf(seat)] = null;
      sendLobby(room);
      return;
    }
    closeRoom(room, room.game ? nameAt(room, index) + " lost connection." : "The room closed.");
  }, grace);
}

// Every seat is filled again: carry on from wherever the room was.
function carryOn(room) {
  if (!room.game) {
    if (room.format === "duel") startMatch(room);
    else sendLobby(room);
    return;
  }
  // A match that really stopped picks up with a 3-2-1; one where a fresh
  // socket just replaced a stale one never paused, and simply goes on.
  if (room.game.status === "playing" && !room.loop) {
    resumeWithCountdown(room.game);
    broadcastState(room);
    runLoop(room);
  }
}

// --- socket wiring ----------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });

wss.on("connection", (socket) => {
  let room = null;
  let seat = null;
  const slot = () => (room && seat ? room.seats.indexOf(seat) : -1);
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  // A malformed frame arrives here as an error. Unhandled, it would take the
  // whole process down; handled, ws closes just this socket and "close" follows.
  socket.on("error", (error) => console.warn(`socket error (${room ? room.code : "no room"}):`, error.message));

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "create" && !room) {
      room = createRoom(safeFormat(msg.format));
      room.mode = safeMode(msg.mode);
      room.killCam = msg.killCam !== false;
      seat = sitDown(room, 0, socket, msg);
      room.host = seat;
      send(socket, joinedMessage(room, seat));
      if (room.format === "duel") send(socket, { type: "waiting" });
      else sendLobby(room);
      return;
    }

    if (msg.type === "join" && !room) {
      const found = rooms.get(String(msg.code || "").toUpperCase().trim());
      if (!found) {
        send(socket, { type: "error", message: "No room with that code." });
        return;
      }
      const free = found.game ? -1 : found.seats.indexOf(null);
      if (free === -1) {
        send(socket, { type: "error", message: found.game ? "That match has already started." : "That room is full." });
        return;
      }
      room = found;
      seat = sitDown(room, free, socket, msg);
      send(socket, joinedMessage(room, seat));
      if (isLobby(room)) {
        sendLobby(room);
      } else if (allSeated(room)) {
        startMatch(room);
      } else {
        send(socket, { type: "opponent-lost", slot: 0, grace: LOBBY_GRACE_MS }); // the host stepped away
      }
      return;
    }

    // Taking a seat back after a drop — or after the page was reloaded.
    if (msg.type === "resume" && !room) {
      const found = rooms.get(String(msg.code || "").toUpperCase().trim());
      const mine = found && typeof msg.token === "string"
        ? found.seats.find((s) => s && s.token === msg.token)
        : null;
      if (!mine) {
        send(socket, { type: "error", reason: "gone", message: "That match is over." });
        return;
      }
      // On a flaky connection the old socket may not be known dead yet; the
      // token says who this is, so the new connection wins.
      const stale = mine.socket;
      if (stale && stale !== socket) {
        stale.replaced = true;
        stale.terminate();
      }
      room = found;
      seat = mine;
      seat.socket = socket;
      clearTimeout(seat.dropTimer);
      seat.dropTimer = null;
      const index = slot();
      send(socket, {
        type: "resumed",
        protocol: PROTOCOL,
        code: room.code,
        slot: index,
        mode: room.mode,
        format: room.format,
        killCam: room.killCam,
        classes: room.seats.map((s) => (s ? s.className : null)),
        token: seat.token,
        name: nameAt(room, index),
        color: seat.color,
        inMatch: Boolean(room.game),
      });
      if (room.game) send(socket, { type: "state", state: viewFor(room.game, index) });
      broadcast(room, { type: "opponent-back", slot: index }, seat);
      if (allSeated(room)) {
        carryOn(room);
        return;
      }
      if (isLobby(room) && !room.game) {
        sendLobby(room);
        return;
      }
      // Still missing someone: say who.
      room.seats.forEach((other, i) => {
        if (other && !other.socket) send(socket, { type: "opponent-lost", slot: i, grace: RECONNECT_GRACE_MS });
      });
      if (!room.game && room.seats.some((s) => s === null)) send(socket, { type: "waiting" });
      return;
    }

    // Leaving on purpose: nobody is coming back. A match cannot go on without
    // them, so the room closes; in a 2v2 lobby a guest just frees the seat.
    if (msg.type === "leave") {
      if (room && seat && rooms.has(room.code) && room.seats.includes(seat)) {
        const index = slot();
        clearTimeout(seat.dropTimer);
        if (!room.game && isLobby(room) && seat !== room.host) {
          room.seats[index] = null;
          sendLobby(room);
        } else {
          seat.socket = null;
          closeRoom(room, nameAt(room, index) + " left the room.");
        }
      }
      room = null;
      seat = null;
      return;
    }

    if (!room || !seat) return;

    // --- bots, before a match: the host fills or empties seats ---
    if (!room.game && seat === room.host && (msg.type === "addBot" || msg.type === "removeBot")) {
      const to = Number.isInteger(msg.to) ? msg.to : room.seats.indexOf(null);
      if (to < 0 || to >= room.seats.length) return;
      if (msg.type === "addBot" && room.seats[to] === null) seatBot(room, to, msg.level);
      else if (msg.type === "removeBot" && room.seats[to] && room.seats[to].bot) room.seats[to] = null;
      else return;
      if (room.format === "duel" && allSeated(room)) startMatch(room);
      else if (isLobby(room)) sendLobby(room);
      return;
    }

    // --- the lobby (2v2 and free-for-all) ---
    if (!room.game && isLobby(room)) {
      if (msg.type === "seat") {
        const to = Number(msg.to);
        if (Number.isInteger(to) && to >= 0 && to < room.seats.length && room.seats[to] === null) {
          room.seats[slot()] = null;
          room.seats[to] = seat;
          sendLobby(room);
        }
      } else if (msg.type === "start" && seat === room.host && readyToStart(room)) {
        startMatch(room);
      }
      return;
    }

    if (!room.game) return;
    const index = slot();

    if (msg.type === "move") {
      requestMove(room.game, index, msg.dir);
    } else if (msg.type === "hold") {
      setHeld(room.game, index, msg.dir);
    } else if (msg.type === "bomb") {
      requestBomb(room.game, index, msg.aim);
    } else if (msg.type === "ability") {
      requestAbility(room.game, index, msg.aim);
    } else if (msg.type === "fatality") {
      requestFatality(room.game, index);
    } else if (msg.type === "rematch" && room.game.status === "over") {
      if (readyToStart(room) && room.seats.filter(taken).length >= room.game.players.length) startMatch(room);
    }
  });

  socket.on("close", () => {
    if (!room || !seat || socket.replaced || seat.socket !== socket) return;
    seat.socket = null;
    if (rooms.has(room.code) && room.seats.includes(seat)) seatDropped(room, seat);
  });
});

// A taken port must end the process: otherwise it keeps running without
// listening, and the old server that holds the port goes on answering.
httpServer.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — probably an older Grid 1v1 server that is still running.`);
    console.error(`Stop that one first, or start this one on another port (PORT=3001 npm start).`);
    process.exit(1);
  }
  console.error("http server error:", error.message);
});
wss.on("error", (error) => {
  if (error.code !== "EADDRINUSE") console.error("websocket server error:", error.message);
});
httpServer.on("clientError", (error, sock) => sock.destroy());

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate(); // missed a whole interval: treat as dropped
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch {
      /* already closing */
    }
  }
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`> Grid 1v1 running at http://localhost:${PORT}`);
});
