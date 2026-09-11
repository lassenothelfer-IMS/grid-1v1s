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

// Timers on a loaded machine are late, so never assume "after N ms the server
// has done X". Wait for the game state itself to say so.
async function waitFor(who, predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = who.latestState();
    if (state && predicate(state)) return state;
    await wait(15);
  }
  return null;
}

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
guest.send({ type: "join", code: joined.code, className: "tank" });
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

console.log("arena layout over the wire");
const COLS = 12, ROWS = 16;
const kindOf = (t) => (t === -1 ? "wall" : t > 0 ? "crate" : "floor");
check("the server deals walls and crates",
  Array.isArray(before.tiles) && before.tiles.length === COLS * ROWS &&
  before.tiles.some((t) => t === -1) && before.tiles.some((t) => t > 0));
check("both players see the same board",
  JSON.stringify(guest.latestState().tiles) === JSON.stringify(before.tiles));
check("the board is mirrored for fairness",
  before.tiles.every((t, i) => kindOf(t) === kindOf(before.tiles[COLS * ROWS - 1 - i])));
const firstLayout = JSON.stringify(before.tiles.map(kindOf));

console.log("the opening countdown");
check("the match opens with a countdown", before.phase === "countdown" && before.round === 1,
  "phase=" + before.phase);
host.send({ type: "move", dir: "down" });
host.send({ type: "hold", dir: null });
const goLive = await waitFor(host, (st) => st.phase === "live", 5000);
check("it goes live after about 3 seconds", !!goLive && goLive.elapsed >= 2950 && goLive.elapsed <= 3400,
  "live at " + (goLive && Math.round(goLive.elapsed)) + "ms");
check("a press during the countdown was ignored", goLive && goLive.players[0].y === 0);
// How many open squares lie straight below a square, before the first obstacle.
const openBelow = (tiles, x, y) => {
  let n = 0;
  while (y + n + 1 < ROWS && tiles[(y + n + 1) * COLS + x] === 0) n += 1;
  return n;
};

console.log("classes travel with the join");
const startMsg = await host.expect("start");
check("start announces both classes",
  JSON.stringify(startMsg.classes) === JSON.stringify(["sniper", "tank"]),
  JSON.stringify(startMsg.classes));
check("tank arrives with its armour", before.players[1].shields === 1 && before.players[1].selfShields === 1,
  JSON.stringify({ shields: before.players[1].shields, self: before.players[1].selfShields }));
check("server applied the chosen classes",
  before.players[0].className === "sniper" && before.players[1].className === "tank",
  JSON.stringify(before.players.map((p) => p.className)));

console.log("input is authoritative");
const startY = host.latestState().players[0].y;
host.send({ type: "move", dir: "down" });
await wait(60);
host.send({ type: "hold", dir: null });
await wait(250);
const onePress = host.latestState();
check("a tap advances exactly one square",
  onePress.players[0].y === startY + 1, "y=" + onePress.players[0].y);

console.log("holding over the wire");
const room = openBelow(onePress.tiles, onePress.players[0].x, onePress.players[0].y);
host.send({ type: "move", dir: "down" });
await wait(500);
host.send({ type: "hold", dir: null });
await wait(300);
const walked = host.latestState().players[0].y - onePress.players[0].y;
// ~4 squares in 0.5s on open floor, but never through whatever the board put in the way.
check("holding walks on until the board stops it",
  walked === Math.min(room, walked) && walked >= Math.min(3, room) && walked <= 5,
  "walked=" + walked + " open squares below=" + room);
const parked = host.latestState().players[0].y;
await wait(400);
check("releasing stops the walk", host.latestState().players[0].y === parked);
const moved = host.latestState();
check("host input moves only slot 0", moved.players[0].y > startY && moved.players[1].y === 15,
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
await wait(60);
host.send({ type: "hold", dir: null });
// Measured in game time: when was it placed, and when was it first gone?
const placedAt = withBomb.elapsed - (1500 - withBomb.bombs[0].fuse);
const afterBoom = await waitFor(host, (st) => st.bombs.length === 0, 5000);
const fuseTook = afterBoom ? afterBoom.elapsed - placedAt : NaN;
check("bomb detonated on schedule (1.5s of game time)", fuseTook >= 1500 && fuseTook <= 1600,
  "fuse took " + Math.round(fuseTook) + "ms");

console.log("match end and rematch (takes ~30s)");
// The guest (tank) throws the match by standing on its own bombs. Every hit is
// checked on its own: the self shield goes first, then the armour, then the
// life — and both shields refill when the next round starts.
const tankKey = (p) => ({ lives: p.lives, self: p.selfShields, armour: p.shields });
const shieldLog = [];
let wrongOrder = null;
let roundChecked = false;
let roundFlow = null;
for (let n = 0; n < 12; n += 1) {
  const ready = await waitFor(host, (st) => st.status === "over" ||
    (st.phase === "live" && st.players[1].alive && st.players[1].invulnIn === 0 &&
      !st.bombs.some((b) => b.owner === 1)), 8000);
  if (!ready || ready.status === "over") break;
  const before = tankKey(ready.players[1]);
  guest.send({ type: "bomb" });
  const hitState = await waitFor(host, (st) => st.status === "over" ||
    JSON.stringify(tankKey(st.players[1])) !== JSON.stringify(before), 5000);
  if (!hitState) {
    wrongOrder = "own bomb never registered a hit";
    break;
  }
  const after = tankKey(hitState.players[1]);
  const expected =
    before.self > 0 ? { ...before, self: before.self - 1 } :
    before.armour > 0 ? { ...before, armour: before.armour - 1 } :
    { ...before, lives: before.lives - 1 };
  shieldLog.push(before.lives + "/" + before.self + "/" + before.armour + " -> " +
    after.lives + "/" + after.self + "/" + after.armour);
  if (JSON.stringify(after) !== JSON.stringify(expected) && !wrongOrder) {
    wrongOrder = "expected " + JSON.stringify(expected) + " got " + JSON.stringify(after);
  }
  if (hitState.status === "over") break;
  if (after.lives < before.lives && !roundChecked) {
    roundChecked = true;
    const frozen = await waitFor(host, (st) => st.phase === "roundEnd" || st.round > hitState.round, 2000);
    const next = await waitFor(host, (st) => st.phase === "live" && st.round === hitState.round + 1, 4000);
    roundFlow = {
      froze: !!frozen,
      next: !!next,
      atSpawns: !!next && next.players[0].x === 5 && next.players[0].y === 0 &&
        next.players[1].x === 6 && next.players[1].y === 15,
      boardRestored: !!next && JSON.stringify(next.tiles) === JSON.stringify(next.layout),
    };
  }
}
console.log("    tank lives/self/armour per own hit:");
for (const line of shieldLog) console.log("      " + line);
check("every own hit spends self shield, then armour, then a life", !wrongOrder, wrongOrder || "");
check("a lost life freezes the round", roundFlow && roundFlow.froze, JSON.stringify(roundFlow));
check("…then the next round goes live", roundFlow && roundFlow.next);
check("…with both players back on their spawns", roundFlow && roundFlow.atSpawns);
check("…and the board as it was dealt", roundFlow && roundFlow.boardRestored);
const fullLives = shieldLog.filter((line) => line.startsWith("3/1/1") || line.startsWith("2/1/1") || line.startsWith("1/1/1")).length;
check("a fresh tank life takes 3 own hits", shieldLog.length >= 7 && fullLives >= 2, shieldLog.length + " hits");

const over = await waitFor(host, (st) => st.status === "over", 3000) || host.latestState();
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
check("a rematch opens with the countdown again", fresh && fresh.phase === "countdown" && fresh.round === 1);
check("rematch deals a new board", fresh && JSON.stringify(fresh.tiles.map(kindOf)) !== firstLayout);
check("rematch keeps the chosen classes",
  fresh && fresh.players[0].className === "sniper" && fresh.players[1].className === "tank",
  JSON.stringify(fresh?.players.map((p) => p.className)));

console.log("disconnect");
guest.socket.close();
const ended = await host.expect("ended");
check("remaining player is told the room closed", !!ended, JSON.stringify(ended));

host.socket.close();
await wait(100);

console.log("siege, kill streaks and a fatality over the wire (takes ~40s)");
{
  const hunter = client("hunter");
  await hunter.ready;
  hunter.send({ type: "create", className: "classic", mode: "siege" });
  const room = await hunter.expect("joined");
  check("the host's mode is confirmed", room?.mode === "siege", JSON.stringify(room));

  const prey = client("prey");
  await prey.ready;
  prey.send({ type: "join", code: room.code, className: "classic", mode: "blitz" });
  const preyJoined = await prey.expect("joined");
  const begin = await prey.expect("start");
  check("the guest plays the host's mode, whatever it asked for",
    preyJoined?.mode === "siege" && begin?.mode === "siege");
  const first = await waitFor(hunter, (st) => st.phase === "live", 6000);
  check("Siege starts both players on 7 lives",
    !!first && first.maxLives === 7 && first.players.every((pl) => pl.lives === 7));

  // The prey throws rounds by bombing itself: the hunter's streak grows anyway,
  // because any death of the opponent counts.
  async function preyFalls() {
    const lives = hunter.latestState().players[1].lives;
    for (let n = 0; n < 3; n += 1) {
      const ready = await waitFor(hunter, (st) => st.phase === "live" && st.players[1].alive &&
        st.players[1].invulnIn === 0 && !st.bombs.some((b) => b.owner === 1), 8000);
      if (!ready) return false;
      prey.send({ type: "bomb" });
      const after = await waitFor(hunter, (st) => st.players[1].lives < lives ||
        st.players[1].selfShields === 0 && n === 0, 5000);
      if (!after) return false;
      if (after.players[1].lives < lives) break;
    }
    return !!(await waitFor(hunter, (st) => st.phase === "live" && st.players[1].lives < lives, 5000));
  }

  let fell = 0;
  for (let i = 0; i < 4; i += 1) if (await preyFalls()) fell += 1;
  const at4 = hunter.latestState();
  check("four rounds in a row give a 4 streak", fell === 4 && at4.players[0].streak === 4,
    "fell=" + fell + " streak=" + at4.players[0].streak);

  hunter.send({ type: "fatality" });
  await wait(300);
  check("X from across the board does nothing at 4", hunter.latestState().status === "playing");

  await preyFalls();
  const at5 = hunter.latestState();
  check("a fifth in a row makes it 5", at5.players[0].streak === 5, "streak=" + at5.players[0].streak);

  hunter.send({ type: "fatality" });
  const done = await waitFor(hunter, (st) => st.status === "over", 3000);
  check("X at 5 ends the match from the spawn", !!done && done.winner === 0);
  check("…as a fatality, seen by both players",
    done?.finish?.type === "fatality" && done.finish.by === 0 && done.finish.streak === 5 &&
    (await waitFor(prey, (st) => st.status === "over", 2000))?.finish?.type === "fatality");

  hunter.socket.close();
  prey.socket.close();
  await wait(100);
}

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
