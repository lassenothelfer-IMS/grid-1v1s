// Grid 1v1 server: serves the client and runs online matches authoritatively.
// The browser never simulates in online mode — it sends intent, renders snapshots.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { createGame, step, requestMove, setHeld, requestBomb, requestFatality } from "./shared/engine.js";
import { TICK_MS, SNAPSHOT_MS, CLASSES, DEFAULT_CLASS, MODES, DEFAULT_MODE } from "./shared/constants.js";

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
  const target = resolveFile(req.url || "/");
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

const rooms = new Map();

// Never trust a class name off the wire.
function safeClass(value) {
  return CLASSES[value] ? value : DEFAULT_CLASS;
}

function safeMode(value) {
  return MODES[value] ? value : DEFAULT_MODE;
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const socket of room.sockets) if (socket) send(socket, message);
}

function createRoom() {
  const room = {
    code: makeCode(),
    sockets: [null, null],
    classes: [DEFAULT_CLASS, DEFAULT_CLASS],
    mode: DEFAULT_MODE,  // chosen by the host; the guest plays the host's mode
    game: null,
    loop: null,
    lastTick: 0,
    sinceSnapshot: 0,
  };
  rooms.set(room.code, room);
  return room;
}

// Timers are late under load. Rather than dropping the lost time (the match
// would slide into slow motion) or taking one huge step (fuses, fire and grace
// timers would skip past each other), catch up in exact TICK_MS steps. Only a
// genuine freeze longer than this is given up on.
const MAX_CATCH_UP_MS = 250;

function startMatch(room) {
  room.game = createGame({ classes: room.classes, mode: room.mode });
  room.lastTick = Date.now();
  room.backlog = 0;
  room.sinceSnapshot = 0;
  broadcast(room, { type: "start", classes: room.classes, mode: room.mode });

  if (room.loop) clearInterval(room.loop);
  room.loop = setInterval(() => {
    const now = Date.now();
    room.backlog += Math.min(now - room.lastTick, MAX_CATCH_UP_MS);
    room.lastTick = now;

    while (room.backlog >= TICK_MS && room.game.status !== "over") {
      step(room.game, TICK_MS);
      room.backlog -= TICK_MS;
      room.sinceSnapshot += TICK_MS;
    }

    if (room.sinceSnapshot >= SNAPSHOT_MS || room.game.status === "over") {
      room.sinceSnapshot = 0;
      broadcast(room, { type: "state", state: room.game });
    }
    if (room.game.status === "over") stopLoop(room);
  }, TICK_MS);
}

function stopLoop(room) {
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
}

function closeRoom(room, reason) {
  stopLoop(room);
  broadcast(room, { type: "ended", reason });
  rooms.delete(room.code);
}

// --- socket wiring ----------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  let room = null;
  let slot = -1;

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "create" && !room) {
      room = createRoom();
      slot = 0;
      room.sockets[0] = socket;
      room.classes[0] = safeClass(msg.className);
      room.mode = safeMode(msg.mode);
      send(socket, { type: "joined", code: room.code, slot, mode: room.mode });
      send(socket, { type: "waiting" });
      return;
    }

    if (msg.type === "join" && !room) {
      const found = rooms.get(String(msg.code || "").toUpperCase().trim());
      if (!found) {
        send(socket, { type: "error", message: "No room with that code." });
        return;
      }
      if (found.sockets[1]) {
        send(socket, { type: "error", message: "That room is full." });
        return;
      }
      room = found;
      slot = 1;
      room.sockets[1] = socket;
      room.classes[1] = safeClass(msg.className);
      send(socket, { type: "joined", code: room.code, slot, mode: room.mode });
      startMatch(room);
      return;
    }

    if (!room || !room.game) return;

    if (msg.type === "move") {
      requestMove(room.game, slot, msg.dir);
    } else if (msg.type === "hold") {
      setHeld(room.game, slot, msg.dir);
    } else if (msg.type === "bomb") {
      requestBomb(room.game, slot);
    } else if (msg.type === "fatality") {
      requestFatality(room.game, slot);
    } else if (msg.type === "rematch" && room.game.status === "over") {
      if (room.sockets[0] && room.sockets[1]) startMatch(room);
    }
  });

  socket.on("close", () => {
    if (!room) return;
    room.sockets[slot] = null;
    if (rooms.has(room.code)) closeRoom(room, "The other player left the room.");
  });
});

httpServer.listen(PORT, () => {
  console.log(`> Grid 1v1 running at http://localhost:${PORT}`);
});
