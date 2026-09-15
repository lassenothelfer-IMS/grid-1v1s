// Connection-loss tests. Starts its own server with short grace periods and a
// fast heartbeat, then drops, revives and abuses connections the way phones
// and flaky networks do.  Usage: node test/reconnect.test.mjs

import { spawn } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const PORT = 3998;
const WS_URL = `ws://localhost:${PORT}`;
const GRACE = 2000;
const LOBBY_GRACE = 3000;
const HEARTBEAT = 400;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log("  ok   " + name);
  else {
    failures += 1;
    console.log("  FAIL " + name + (detail ? "  -> " + detail : ""));
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a server of our own ------------------------------------------------------
const root = fileURLToPath(new URL("..", import.meta.url));
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    RECONNECT_GRACE_MS: String(GRACE),
    LOBBY_GRACE_MS: String(LOBBY_GRACE),
    HEARTBEAT_MS: String(HEARTBEAT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });
let serverExited = false;
server.on("exit", () => { serverExited = true; });
for (let i = 0; i < 50 && !serverLog.includes("running"); i += 1) await wait(100);

// --- clients --------------------------------------------------------------------
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
    closed: new Promise((resolve) => socket.on("close", resolve)),
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
    latest() {
      for (let i = inbox.length - 1; i >= 0; i -= 1) if (inbox[i].type === "state") return inbox[i].state;
      return null;
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

// A host and a guest in a live match.
async function liveMatch() {
  const host = client("host");
  await host.ready;
  host.send({ type: "create", className: "classic", mode: "blitz" });
  const hj = await host.expect("joined");
  const guest = client("guest");
  await guest.ready;
  guest.send({ type: "join", code: hj.code, className: "tank" });
  const gj = await guest.expect("joined");
  await waitFor(host, (st) => st.phase === "live");
  return { host, guest, code: hj.code, hostToken: hj.token, guestToken: gj.token };
}

// A raw TCP WebSocket that can send text frames but never answers pings —
// a phone whose connection died without saying goodbye.
async function deafClient(firstMessage) {
  const sock = net.connect(PORT, "127.0.0.1");
  await new Promise((r) => sock.once("connect", r));
  sock.write(
    "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  await new Promise((r) => sock.once("data", r));
  const text = Buffer.from(JSON.stringify(firstMessage));
  const mask = crypto.randomBytes(4);
  const body = text.map((b, i) => b ^ mask[i % 4]);
  sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | text.length]), mask, body]));
  sock.on("error", () => {});
  let closedByServer = false;
  sock.on("close", () => { closedByServer = true; });
  return { sock, isClosed: () => closedByServer };
}

// --- 1. a malformed frame no longer takes the server down ---------------------
console.log("robustness");
{
  const bystanders = await liveMatch();
  const sock = net.connect(PORT, "127.0.0.1");
  await new Promise((r) => sock.once("connect", r));
  sock.write(
    "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  await new Promise((r) => sock.once("data", r));
  const mask = crypto.randomBytes(4);
  sock.write(Buffer.concat([Buffer.from([0x81, 0x82]), mask, Buffer.from([0xff ^ mask[0], 0xfe ^ mask[1]])]));
  sock.on("error", () => {});
  await wait(500);
  check("one bad frame does not crash the server", !serverExited);
  const t0 = bystanders.host.latest().elapsed;
  await wait(300);
  check("…and matches already running carry on", bystanders.host.latest().elapsed > t0);
  bystanders.host.send({ type: "leave" });
  await wait(100);
  bystanders.host.socket.close();
  bystanders.guest.socket.close();
}

// --- 2. a player drops mid-match and comes back ----------------------------------
console.log("dropping out and coming back mid-match");
{
  const { host, guest, code, guestToken } = await liveMatch();
  const mark = host.inbox.length;
  guest.socket.terminate(); // no "leave": the phone just lost signal
  const lost = await host.expect("opponent-lost", 3000, mark);
  check("the other player hears the seat is empty", lost?.slot === 1 && lost?.grace === GRACE, JSON.stringify(lost));
  const frozenAt = host.latest().elapsed;
  await wait(500);
  check("the match pauses while they are gone", host.latest().elapsed === frozenAt);

  const back = client("guest again");
  await back.ready;
  back.send({ type: "resume", code, token: guestToken });
  const resumed = await back.expect("resumed");
  check("the token takes the same seat back", resumed?.slot === 1 && resumed?.inMatch === true, JSON.stringify(resumed));
  check("…with the match state at once", !!(await back.expect("state")));
  check("the other player hears they are back", !!(await host.expect("opponent-back", 3000, mark)));
  const recount = await waitFor(host, (st) => st.phase === "countdown");
  check("the round resumes with a 3-2-1", !!recount && recount.elapsed >= frozenAt);
  const live = await waitFor(back, (st) => st.phase === "live");
  check("…then goes live again", !!live);

  const y0 = back.latest().players[1].y;
  back.send({ type: "move", dir: "up" });
  await wait(60);
  back.send({ type: "hold", dir: null });
  const moved = await waitFor(host, (st) => st.players[1].y === y0 - 1, 1500);
  check("the returning player's input works", !!moved);
  host.send({ type: "leave" });
  await wait(100);
  host.socket.close();
  back.socket.close();
}

// --- 3. the new connection wins over a stale one --------------------------------
console.log("a stale connection that has not noticed it is dead");
{
  const { host, guest, code, guestToken } = await liveMatch();
  const replacement = client("guest on new network");
  await replacement.ready;
  replacement.send({ type: "resume", code, token: guestToken });
  check("resuming while the old socket is still open is allowed", !!(await replacement.expect("resumed")));
  await Promise.race([guest.closed, wait(2000)]);
  check("the stale socket is cut off", guest.socket.readyState === WebSocket.CLOSED);
  await wait(300);
  check("…without pausing the match for the other player",
    !host.inbox.some((m) => m.type === "opponent-lost"));
  host.send({ type: "leave" });
  await wait(100);
  host.socket.close();
  replacement.socket.close();
}

// --- 4. nobody comes back -----------------------------------------------------------
console.log("a seat that is never taken back");
{
  const { host, guest } = await liveMatch();
  guest.socket.terminate();
  const t0 = Date.now();
  const ended = await host.expect("ended", GRACE + 2000);
  check("the room closes once the grace period runs out",
    !!ended && Date.now() - t0 >= GRACE - 100, ended ? `after ${Date.now() - t0}ms` : "never");
  host.socket.close();
}

// --- 5. leaving on purpose is instant -------------------------------------------------
console.log("leaving on purpose");
{
  const { host, guest } = await liveMatch();
  const t0 = Date.now();
  guest.send({ type: "leave" });
  const ended = await host.expect("ended", 1000);
  check("an explicit leave closes the room straight away", !!ended && Date.now() - t0 < 500);
  host.socket.close();
  guest.socket.close();
}

// --- 6. the lobby: the host steps away to share the code ------------------------------
console.log("the host steps away from the lobby");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", className: "classic", mode: "siege" });
  const hj = await host.expect("joined");
  host.socket.terminate(); // off to a messaging app
  await wait(500);
  const guest = client("guest");
  await guest.ready;
  guest.send({ type: "join", code: hj.code, className: "speedy" });
  check("the room is still there for the guest", !!(await guest.expect("joined")));
  const waiting = await guest.expect("opponent-lost");
  check("…who is told the host stepped away", waiting?.slot === 0, JSON.stringify(waiting));
  const hostBack = client("host again");
  await hostBack.ready;
  hostBack.send({ type: "resume", code: hj.code, token: hj.token });
  check("the host takes their seat back", (await hostBack.expect("resumed"))?.slot === 0);
  const started = await guest.expect("start");
  check("…and the match starts for both", !!started && !!(await hostBack.expect("start")) && started.mode === "siege");
  hostBack.send({ type: "leave" });
  await wait(100);
  hostBack.socket.close();
  guest.socket.close();
}

// --- 7. a wrong or old token ----------------------------------------------------------
console.log("a token that does not fit");
{
  const { host, code } = await liveMatch();
  const intruder = client("intruder");
  await intruder.ready;
  intruder.send({ type: "resume", code, token: "not-the-token" });
  const refused = await intruder.expect("error");
  check("a wrong token gets no seat", refused?.reason === "gone", JSON.stringify(refused));
  host.send({ type: "leave" });
  await wait(100);
  host.socket.close();
  intruder.socket.close();
}

// --- 8. the heartbeat finds connections that died silently -----------------------------
console.log("heartbeat");
{
  const host = client("host");
  await host.ready;
  host.send({ type: "create", className: "classic", mode: "blitz" });
  const hj = await host.expect("joined");
  const deaf = await deafClient({ type: "join", code: hj.code, className: "tank" });
  check("a match starts with a peer that will go silent", !!(await host.expect("start")));
  const t0 = Date.now();
  const lost = await host.expect("opponent-lost", HEARTBEAT * 5);
  check("the server notices a peer that stopped answering pings",
    !!lost && deaf.isClosed(), lost ? `after ${Date.now() - t0}ms` : "never");
  let pongs = 0;
  host.socket.on("ping", () => { pongs += 1; });
  await wait(HEARTBEAT * 3);
  check("a healthy client keeps being pinged (and answers)", pongs >= 2 && host.socket.readyState === WebSocket.OPEN,
    "pings seen: " + pongs);
  host.send({ type: "leave" });
  await wait(100);
  host.socket.close();
  deaf.sock.destroy();
}

check("the server stayed up through all of it", !serverExited);
server.kill();
console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
