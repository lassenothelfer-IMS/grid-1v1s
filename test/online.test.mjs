// End-to-end check of the online path against a running server.
// Usage: node server.js  (in another shell), then: node test/online.test.mjs

import WebSocket from "ws";

const URL = process.env.URL || "ws://localhost:3000";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log("  ok   " + name);
  else {
    failures += 1;
    console.log("  FAIL " + name + (detail ? "  -> " + detail : ""));
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A client that records everything the server sends it.
function client(label) {
  const socket = new WebSocket(URL);
  const inbox = [];
  socket.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  return {
    label,
    socket,
    inbox,
    ready: new Promise((resolve) => socket.on("open", resolve)),
    send: (msg) => socket.send(JSON.stringify(msg)),
    // Waits for the first message of a type, or gives up.
    async expect(type, timeout = 3000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const found = inbox.find((m) => m.type === type);
        if (found) return found;
        await wait(20);
      }
      return null;
    },
    latestState() {
      for (let i = inbox.length - 1; i >= 0; i -= 1) {
        if (inbox[i].type === "state") return inbox[i].state;
      }
      return null;
    },
  };
}

console.log("handshake");
const host = client("host");
await host.ready;
host.send({ type: "create", className: "sniper" });

const joined = await host.expect("joined");
check("host is given a room code", !!joined && /^[A-Z0-9]{4}$/.test(joined.code || ""), JSON.stringify(joined));
check("host takes slot 0", joined?.slot === 0);
check("host is told to wait", !!(await host.expect("waiting")));

console.log("bad code");
const stray = client("stray");
await stray.ready;
stray.send({ type: "join", code: "ZZZZ" });
const rejected = await stray.expect("error");
check("unknown room is rejected", !!rejected, JSON.stringify(rejected));
stray.socket.close();

console.log("match start");
const guest = client("guest");
await guest.ready;
guest.send({ type: "join", code: joined.code, className: "speedy" });
const guestJoined = await guest.expect("joined");
check("guest takes slot 1", guestJoined?.slot === 1);
check("host is told the match started", !!(await host.expect("start")));
check("guest is told the match started", !!(await guest.expect("start")));

console.log("snapshots");
check("host receives state", !!(await host.expect("state")));
check("guest receives state", !!(await guest.expect("state")));

const before = host.latestState();
check("server placed both players at spawns", before.players[0].y === 0 && before.players[1].y === 15);
check("board is 12 wide on the server", before.players.every((p) => p.x >= 0 && p.x < 12));

console.log("classes travel with the join");
const startMsg = await host.expect("start");
check("start announces both classes",
  JSON.stringify(startMsg.classes) === JSON.stringify(["sniper", "speedy"]),
  JSON.stringify(startMsg.classes));
check("server applied the chosen classes",
  before.players[0].className === "sniper" && before.players[1].className === "speedy",
  JSON.stringify(before.players.map((p) => p.className)));

console.log("input is authoritative");
const startY = host.latestState().players[0].y;
host.send({ type: "move", dir: "down" });
await wait(250);
const onePress = host.latestState();
check("one move message advances exactly one square",
  onePress.players[0].y === startY + 1, "y=" + onePress.players[0].y);

for (let i = 0; i < 3; i += 1) {
  host.send({ type: "move", dir: "down" });
  await wait(150);
}
const moved = host.latestState();
check("host input moves only slot 0", moved.players[0].y === startY + 4 && moved.players[1].y === 15,
  "p0.y=" + moved.players[0].y + " p1.y=" + moved.players[1].y);

const guestView = guest.latestState();
check("guest sees the same board", guestView.players[0].y === moved.players[0].y,
  "guest=" + guestView.players[0].y + " host=" + moved.players[0].y);

console.log("bombs over the wire");
host.send({ type: "bomb" });
await wait(200);
const withBomb = host.latestState();
check("bomb appears in snapshots", (withBomb.bombs || []).length === 1);
const sniped = withBomb.bombs[0];
const victim = withBomb.players[1];
check("sniper shot landed beside the opponent, not the shooter",
  Math.max(Math.abs(sniped.x - victim.x), Math.abs(sniped.y - victim.y)) === 1,
  JSON.stringify({ bomb: { x: sniped.x, y: sniped.y }, foe: { x: victim.x, y: victim.y } }));
host.send({ type: "move", dir: "right" });
await wait(1600);
const afterBoom = host.latestState();
check("bomb detonated on schedule", afterBoom.bombs.length === 0, "left=" + afterBoom.bombs.length);

console.log("match end and rematch (takes ~15s)");
// The guest (speedy) throws the match by standing on its own bombs until it
// runs out of lives — the only way to reach "over" through the real server.
for (let life = 0; life < 3; life += 1) {
  await wait(1700); // let spawn grace lapse
  guest.send({ type: "bomb" });
  await wait(1700); // fuse + the hit
  await wait(1000); // respawn
}
const over = host.latestState();
check("match reaches game over", over.status === "over", "status=" + over.status);
check("the other player is the winner", over.winner === 0, "winner=" + over.winner);
check("loser is out of lives", over.players[1].lives <= 0, "lives=" + over.players[1].lives);

host.inbox.length = 0;
guest.inbox.length = 0;
host.send({ type: "rematch" });
check("rematch restarts the match", !!(await host.expect("start")));
await wait(200);
const fresh = host.latestState();
check("rematch resets lives", fresh && fresh.players.every((p) => p.lives === 3),
  JSON.stringify(fresh?.players.map((p) => p.lives)));
check("rematch resets the clock", fresh && fresh.elapsed < 2000, "elapsed=" + fresh?.elapsed);
check("rematch keeps the chosen classes",
  fresh && fresh.players[0].className === "sniper" && fresh.players[1].className === "speedy",
  JSON.stringify(fresh?.players.map((p) => p.className)));

console.log("disconnect");
guest.socket.close();
const ended = await host.expect("ended");
check("remaining player is told the room closed", !!ended, JSON.stringify(ended));

host.socket.close();
await wait(100);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
