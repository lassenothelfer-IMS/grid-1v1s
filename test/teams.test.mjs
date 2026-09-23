// 2v2 over the wire, plus names, colours and the newer classes' online bits.
// Starts its own server, so it needs nothing running.
// Usage: node test/teams.test.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { PROTOCOL } from "../shared/constants.js";

const PORT = 3997;
const WS_URL = `ws://localhost:${PORT}`;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log("  ok   " + name);
  else {
    failures += 1;
    console.log("  FAIL " + name + (detail ? "  -> " + detail : ""));
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const root = fileURLToPath(new URL("..", import.meta.url));
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), RECONNECT_GRACE_MS: "3000", LOBBY_GRACE_MS: "3000" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });
for (let i = 0; i < 50 && !serverLog.includes("running"); i += 1) await wait(100);

function client(label) {
  const socket = new WebSocket(WS_URL);
  const inbox = [];
  socket.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  socket.on("error", () => {});
  return {
    label,
    socket,
    inbox,
    ready: new Promise((resolve) => socket.on("open", resolve)),
    send: (msg) => socket.send(JSON.stringify(msg)),
    async expect(type, timeout = 4000, from = 0) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const found = inbox.slice(from).find((m) => m.type === type);
        if (found) return found;
        await wait(20);
      }
      return null;
    },
    lastOf(type) {
      for (let i = inbox.length - 1; i >= 0; i -= 1) if (inbox[i].type === type) return inbox[i];
      return null;
    },
    latest() {
      const m = this.lastOf("state");
      return m ? m.state : null;
    },
  };
}

async function waitFor(who, predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const st = who.latest();
    if (st && predicate(st)) return st;
    await wait(20);
  }
  return null;
}

async function waitLobby(who, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lobby = who.lastOf("lobby");
    if (lobby && predicate(lobby)) return lobby;
    await wait(20);
  }
  return who.lastOf("lobby");
}

console.log("the 2v2 lobby");
const ana = client("ana");
await ana.ready;
ana.send({ type: "create", format: "teams", mode: "blitz", className: "shade", name: "  Ana  ", color: "jade" });
const anaJoined = await ana.expect("joined");
check("the host gets a 2v2 room", anaJoined?.format === "teams" && anaJoined.slot === 0, JSON.stringify(anaJoined));
check("…with the name and colour asked for", anaJoined?.name === "Ana" && anaJoined.color === "jade");
check("…and which version of the game the server speaks", anaJoined?.protocol === PROTOCOL);
const firstLobby = await ana.expect("lobby");
check("…and a lobby with four seats, one taken",
  firstLobby?.seats.length === 4 && firstLobby.seats.filter(Boolean).length === 1 && firstLobby.host === 0);
check("a 2v2 host is not told to wait for one opponent", !ana.inbox.some((m) => m.type === "waiting"));

const ben = client("ben");
await ben.ready;
ben.send({ type: "join", code: anaJoined.code, className: "decoy", name: "Ben", color: "jade" });
const benJoined = await ben.expect("joined");
check("the next player takes seat 2 — the other side", benJoined?.slot === 1);
check("a colour that is taken goes to a free one", benJoined?.color && benJoined.color !== "jade", benJoined?.color);

ben.send({ type: "seat", to: 2 });
const moved = await waitLobby(ben, (l) => l.slot === 2);
check("an open seat can be taken — here, on the host's side",
  moved?.slot === 2 && moved.seats[1] === null && moved.seats[2]?.name === "Ben");
const anaSees = await waitLobby(ana, (l) => l.seats[2]?.name === "Ben");
check("everyone sees the move", !!anaSees && anaSees.seats[1] === null);

const cleo = client("cleo");
const dev = client("dev");
await Promise.all([cleo.ready, dev.ready]);
cleo.send({ type: "join", code: anaJoined.code, className: "line", name: "Cleo" });
await cleo.expect("joined");
dev.send({ type: "join", code: anaJoined.code, className: "quickfuse", name: "" });
const devJoined = await dev.expect("joined");
check("an empty name becomes the seat's default", devJoined?.name === "Player " + (devJoined.slot + 1), devJoined?.name);
const fullLobby = await waitLobby(ana, (l) => l.seats.every(Boolean));
check("four players fill the lobby", fullLobby?.seats.every((s) => s && s.connected));
check("four colours, no two alike", new Set(fullLobby?.seats.map((s) => s.color)).size === 4,
  JSON.stringify(fullLobby?.seats.map((s) => s.color)));
await wait(300);
check("a full 2v2 room waits for the host", !ana.inbox.some((m) => m.type === "start"));

const late = client("late");
await late.ready;
late.send({ type: "join", code: anaJoined.code, className: "classic" });
check("a fifth player is turned away", !!(await late.expect("error")));
late.socket.close();

ben.send({ type: "start" });
await wait(300);
check("only the host can start it", !ana.inbox.some((m) => m.type === "start"));
ana.send({ type: "start" });
const started = await Promise.all([ana, ben, cleo, dev].map((c) => c.expect("start")));
check("the host starts it for all four", started.every((m) => m && m.format === "teams"));

console.log("a 2v2 match");
const st = await waitFor(ana, (s) => s.players.length === 4);
check("four players in the match", !!st);
check("teams by seat: top, bottom, top, bottom", st && st.players.map((p) => p.team).join() === "0,1,0,1");
check("names and colours carried into the match",
  st && st.players[0].name === "Ana" && st.players[0].color === "jade" && st.players[2].name === "Ben" &&
  st.players[2].className === "decoy" && new Set(st.players.map((p) => p.color)).size === 4);

console.log("a hidden shade stays hidden from the other side only");
const live = await waitFor(ana, (s) => s.phase === "live", 6000);
check("the match goes live", !!live);
const hiddenForAna = await waitFor(ana, (s) => s.players[0].hidden, 3000);
check("standing still, the shade vanishes", !!hiddenForAna && hiddenForAna.players[0].x !== null);
const benView = await waitFor(ben, (s) => s.players[0].hidden, 2000);
check("its teammate still sees where it is", !!benView && Number.isInteger(benView.players[0].x));
const cleoView = await waitFor(cleo, (s) => s.players[0].hidden, 2000);
check("the other side gets no position at all", !!cleoView && cleoView.players[0].x === null && cleoView.players[0].y === null);
check("…not even inside the event list",
  !cleo.inbox.some((m) => m.type === "state" && m.state.players[0].hidden &&
    m.state.events.some((e) => e.type === "move" && e.index === 0)));

console.log("a decoy over the wire");
ben.send({ type: "ability" });
const decoyed = await waitFor(ana, (s) => (s.decoys || []).length === 1, 2000);
check("the ability message drops a decoy", !!decoyed && decoyed.decoys[0].owner === 2);

console.log("someone drops out mid-match");
const mark = ana.inbox.length;
dev.socket.terminate();
const lost = await ana.expect("opponent-lost", 3000, mark);
check("everyone hears which seat is empty", lost?.slot === devJoined.slot);
check("…the others too", !!(await cleo.expect("opponent-lost", 3000)));
const dev2 = client("dev again");
await dev2.ready;
dev2.send({ type: "resume", code: anaJoined.code, token: devJoined.token });
check("they take the seat back", (await dev2.expect("resumed"))?.slot === devJoined.slot);
check("…and the others hear it", !!(await ana.expect("opponent-back", 3000, mark)));
check("…and the match picks up again", !!(await waitFor(ana, (s) => s.phase === "countdown" || s.phase === "live", 3000)));

ana.send({ type: "leave" });
const ended = await cleo.expect("ended", 2000);
check("the host leaving ends it for everyone", !!ended && /Ana/.test(ended.reason || ""), ended?.reason);
for (const c of [ana, ben, cleo, dev2]) c.socket.close();

console.log("a free-for-all room");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", format: "royale", className: "classic", name: "Ana" });
  const joined = await host.expect("joined");
  check("the host gets a six-seat room", joined?.format === "royale");
  const lobby = await host.expect("lobby");
  check("…with a lobby of six seats, and three needed", lobby?.seats.length === 6 && lobby.min === 3,
    JSON.stringify({ seats: lobby?.seats.length, min: lobby?.min }));
  check("…which is not ready with one player", lobby?.ready === false);
  host.send({ type: "start" });
  await wait(250);
  check("it will not start with one", !host.inbox.some((m) => m.type === "start"));

  const guest = client("guest");
  await guest.ready;
  guest.send({ type: "join", code: joined.code, className: "sniper", name: "Ben" });
  await guest.expect("joined");
  host.send({ type: "addBot", to: 4, level: "hard" }); // a gap on purpose: seat 4, not 2
  const three = await waitLobby(host, (l) => l.seats.filter(Boolean).length === 3);
  check("three in the room — bots included — and it is ready", three?.ready === true);

  host.send({ type: "start" });
  check("the host starts it", !!(await host.expect("start")));
  const st = await waitFor(guest, (s) => s.players.length === 3 && s.phase === "live", 8000);
  check("three players on the big board", !!st && st.cols === 25 && st.rows === 25,
    st ? st.players.length + " on " + st.cols + "x" + st.rows : "no state");
  check("…everyone their own side, one life, points to play for",
    st && st.ffa === true && st.sides === 3 && st.maxLives === 1 && st.target === 6);
  check("…and the seats closed their gaps, so a seat is a player",
    st && st.players.map((p) => p.name).join() === "Ana,Ben," + (three.seats[4] && three.seats[4].name),
    st && st.players.map((p) => p.name).join());
  const moved = await waitFor(guest, (s) => s.bombs.length > 0 || s.players[2].x !== st.players[2].x, 6000);
  check("the bot plays in it", !!moved);

  host.send({ type: "leave" });
  host.socket.close();
  guest.socket.close();
}

console.log("aiming over the wire");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", className: "classic", name: "Thrower" });
  const joined = await host.expect("joined");
  host.send({ type: "addBot", level: "easy" });
  await host.expect("start");
  const live = await waitFor(host, (s) => s.phase === "live", 6000);
  const me = live.players[0];
  host.send({ type: "bomb", aim: { x: me.x, y: me.y + 3 } });
  const thrown = await waitFor(host, (s) => s.bombs.length > 0, 2000);
  const bomb = thrown && thrown.bombs.find((b) => b.owner === 0);
  check("a bomb aimed three squares away lands there",
    bomb && bomb.x === me.x && bomb.y === me.y + 3, JSON.stringify(bomb));
  host.send({ type: "leave" });
  host.socket.close();
}

console.log("leaving a lobby");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", format: "teams", className: "classic" });
  const joined = await host.expect("joined");
  const guest = client("guest");
  await guest.ready;
  guest.send({ type: "join", code: joined.code, className: "classic" });
  await guest.expect("joined");
  await waitLobby(host, (l) => l.seats.filter(Boolean).length === 2);
  guest.send({ type: "leave" });
  const after = await waitLobby(host, (l) => l.seats.filter(Boolean).length === 1);
  check("a guest leaving a lobby just frees the seat", after?.seats.filter(Boolean).length === 1 &&
    !host.inbox.some((m) => m.type === "ended"));
  host.send({ type: "leave" });
  host.socket.close();
  guest.socket.close();
}

console.log("1v1 rooms carry names and colours too");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", className: "diagonal", name: "Lasse", color: "crimson" });
  const joined = await host.expect("joined");
  check("a 1v1 host still waits the old way", joined?.format === "duel" && !!(await host.expect("waiting")));
  const guest = client("guest");
  await guest.ready;
  guest.send({ type: "join", code: joined.code, className: "line", name: "Max", color: "crimson" });
  await guest.expect("start");
  const duel = await waitFor(host, (s) => s.players.length === 2);
  check("both names arrive in the match", duel?.players[0].name === "Lasse" && duel.players[1].name === "Max");
  check("…the guest's colour moved off the host's", duel?.players[0].color === "crimson" && duel.players[1].color !== "crimson");
  check("the kill cam is on unless the host turns it off", duel?.killCam === true);
  host.send({ type: "leave" });
  host.socket.close();
  guest.socket.close();
}

console.log("bots in online rooms");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", className: "classic", name: "Solo" });
  await host.expect("joined");
  await host.expect("waiting");
  host.send({ type: "addBot", level: "hard" });
  const start = await host.expect("start");
  check("a 1v1 host can fill the empty seat with a bot — the match starts", !!start);
  const live = await waitFor(host, (s) => s.phase === "live", 6000);
  const botName = live?.players[1].name;
  check("the bot gets its own name and colour", !!botName && botName !== "Player 2" &&
    live.players[1].color !== live.players[0].color, botName);
  const from = live && { x: live.players[1].x, y: live.players[1].y };
  const moved = await waitFor(host, (s) => s.players[1].x !== from.x || s.players[1].y !== from.y || s.bombs.length > 0, 5000);
  check("…and it plays: it moves or bombs on its own", !!moved);
  host.send({ type: "leave" });
  host.socket.close();
}
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", format: "teams", className: "classic" });
  const joined = await host.expect("joined");
  const guest = client("guest");
  await guest.ready;
  guest.send({ type: "join", code: joined.code, className: "tank" });
  await guest.expect("joined");
  await waitLobby(host, (l) => l.seats.filter(Boolean).length === 2);
  guest.send({ type: "addBot", to: 2, level: "easy" });
  await wait(300);
  check("only the host can add bots", host.lastOf("lobby").seats[2] === null);
  host.send({ type: "addBot", to: 2, level: "easy" });
  host.send({ type: "addBot", to: 3, level: "hard" });
  const withBots = await waitLobby(host, (l) => l.seats.every(Boolean));
  check("the host fills the 2v2 seats with bots", withBots?.seats[2]?.bot === "easy" && withBots.seats[3]?.bot === "hard");
  check("…and a full lobby of people and bots is ready to start", withBots?.seats.every((s) => s.connected));
  host.send({ type: "removeBot", to: 3 });
  const removed = await waitLobby(host, (l) => l.seats[3] === null);
  check("…and can take a bot out again", removed?.seats[3] === null);
  host.send({ type: "removeBot", to: 1 });
  await wait(200);
  check("a person can't be removed as if they were a bot", host.lastOf("lobby").seats[1]?.name === "Player 2");
  host.send({ type: "addBot", to: 3, level: "medium" });
  await waitLobby(host, (l) => l.seats.every(Boolean));
  host.send({ type: "start" });
  const st = await waitFor(guest, (s) => s.players.length === 4 && s.phase === "live", 8000);
  check("a 2v2 with two bots starts and goes live", !!st);
  host.send({ type: "leave" });
  host.socket.close();
  guest.socket.close();
}

server.kill();
console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
