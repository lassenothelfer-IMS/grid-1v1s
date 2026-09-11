// Grid 1v1 server: serves the client and runs online matches authoritatively.
// The browser never simulates in online mode — it sends intent, renders snapshots.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { createGame, step, requestMove, requestBomb } from "./shared/engine.js";
import { TICK_MS, SNAPSHOT_MS, CLASSES, DEFAULT_CLASS } from "./shared/constants.js";

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
    game: null,
    loop: null,
    lastTick: 0,
    sinceSnapshot: 0,
  };
  rooms.set(room.code, room);
  return room;
}

function startMatch(room) {
  room.game = createGame({ classes: room.classes });
  room.lastTick = Date.now();
  room.sinceSnapshot = 0;
  broadcast(room, { type: "start", classes: room.classes });

  if (room.loop) clearInterval(room.loop);
  room.loop = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(now - room.lastTick, 100); // don't fast-forward after a stall
    room.lastTick = now;

    step(room.game, dt);

    room.sinceSnapshot += dt;
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
      send(socket, { type: "joined", code: room.code, slot });
      send(socket, { type: "waiting" });
      return;
    }

    if (msg.type === "join" && !room) {
      const found = rooms.get(String(msg.code || "").toUpperCase().trim());
      if (!found) {
        send(socket, { type: "error", message: "Kein Raum mit diesem Code." });
        return;
      }
      if (found.sockets[1]) {
        send(socket, { type: "error", message: "Dieser Raum ist voll." });
        return;
      }
      room = found;
      slot = 1;
      room.sockets[1] = socket;
      room.classes[1] = safeClass(msg.className);
      send(socket, { type: "joined", code: room.code, slot });
      startMatch(room);
      return;
    }

    if (!room || !room.game) return;

    if (msg.type === "move") {
      requestMove(room.game, slot, msg.dir);
    } else if (msg.type === "bomb") {
      requestBomb(room.game, slot);
    } else if (msg.type === "rematch" && room.game.status === "over") {
      if (room.sockets[0] && room.sockets[1]) startMatch(room);
    }
  });

  socket.on("close", () => {
    if (!room) return;
    room.sockets[slot] = null;
    if (rooms.has(room.code)) closeRoom(room, "Der andere Spieler hat den Raum verlassen.");
  });
});

httpServer.listen(PORT, () => {
  console.log(`> Grid 1v1 läuft auf http://localhost:${PORT}`);
});
