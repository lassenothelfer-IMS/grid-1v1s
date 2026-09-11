import { createGame, step, requestMove, requestBomb, sniperTargets } from "../shared/engine.js";
import {
  COLS,
  ROWS,
  SPAWNS,
  START_LIVES,
  BOMB_FUSE_MS,
  MOVE_COOLDOWN_MS,
  MOVE_BUFFER_MS,
  CLASSES,
} from "../shared/constants.js";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log("  ok   " + name);
  } else {
    failures += 1;
    console.log("  FAIL " + name + (detail ? "  -> " + detail : ""));
  }
}

// Advance the sim in 16ms slices, like a real clock would.
function run(state, ms) {
  for (let t = 0; t < ms; t += 16) step(state, 16);
}

console.log("board");
let g = createGame();
check("board is 12x16", COLS === 12 && ROWS === 16);
check("player 0 at top spawn", g.players[0].x === SPAWNS[0].x && g.players[0].y === 0);
check("player 1 at bottom spawn", g.players[1].x === SPAWNS[1].x && g.players[1].y === ROWS - 1);
check("spawns sit inside the wider grid", SPAWNS.every((s) => s.x >= 0 && s.x < COLS));
check("both start with " + START_LIVES + " lives", g.players.every((p) => p.lives === START_LIVES));
check("default class is classic", g.players.every((p) => p.className === "classic"));

console.log("movement is one square per press");
g = createGame();
requestMove(g, 0, "down");
run(g, 32);
check("a press moves exactly one square", g.players[0].y === 1, "y=" + g.players[0].y);
run(g, 2000);
check("holding the key does nothing more", g.players[0].y === 1, "y=" + g.players[0].y);

requestMove(g, 0, "down");
run(g, MOVE_COOLDOWN_MS + 32);
requestMove(g, 0, "down");
run(g, MOVE_COOLDOWN_MS + 32);
check("each new press moves again", g.players[0].y === 3, "y=" + g.players[0].y);

console.log("press buffering");
g = createGame();
requestMove(g, 0, "down");
step(g, 16);
requestMove(g, 0, "down"); // arrives while the cooldown is still running
step(g, 16);
check("second press is held, not dropped", g.players[0].y === 1, "y=" + g.players[0].y);
run(g, MOVE_COOLDOWN_MS + 32);
check("buffered press lands once the cooldown ends", g.players[0].y === 2, "y=" + g.players[0].y);

g = createGame();
requestMove(g, 0, "down");
step(g, 16);
requestMove(g, 0, "up");
run(g, MOVE_BUFFER_MS + 200);
check("a stale buffered press expires", g.players[0].y <= 1, "y=" + g.players[0].y);

console.log("responsiveness");
check("cooldown is short enough to feel instant", MOVE_COOLDOWN_MS <= 100, MOVE_COOLDOWN_MS + "ms");
g = createGame();
requestMove(g, 0, "down");
step(g, 16);
check("the step happens on the very next tick", g.players[0].y === 1);

console.log("walls");
g = createGame();
for (let i = 0; i < 5; i += 1) {
  requestMove(g, 0, "up");
  run(g, MOVE_COOLDOWN_MS + 32);
}
check("cannot leave the top edge", g.players[0].y === 0);
for (let i = 0; i < COLS + 3; i += 1) {
  requestMove(g, 0, "left");
  run(g, MOVE_COOLDOWN_MS + 32);
}
check("cannot leave the left edge", g.players[0].x === 0, "x=" + g.players[0].x);
for (let i = 0; i < COLS + 6; i += 1) {
  requestMove(g, 0, "right");
  run(g, MOVE_COOLDOWN_MS + 32);
}
check("cannot leave the right edge of the 12-wide grid", g.players[0].x === COLS - 1, "x=" + g.players[0].x);

console.log("classic bombs");
g = createGame({ classes: ["classic", "classic"] });
requestBomb(g, 0);
step(g, 16);
check("bomb lands on the player's own tile", g.bombs.length === 1 && g.bombs[0].y === 0);
check("bomb carries the class radius", g.bombs[0].radius === CLASSES.classic.blastRadius);
requestBomb(g, 0);
step(g, 16);
check("no second bomb on the same tile", g.bombs.length === 1);
run(g, BOMB_FUSE_MS - 200);
check("still ticking before 1.5s", g.bombs.length === 1 && g.blasts.length === 0);
run(g, 300);
check("detonates at 1.5s", g.bombs.length === 0 && g.blasts.length > 0);

console.log("classic limits");
g = createGame({ classes: ["classic", "classic"] });
for (let i = 0; i < 4; i += 1) {
  requestBomb(g, 0);
  step(g, 16);
  requestMove(g, 0, "down");
  run(g, MOVE_COOLDOWN_MS + 32);
}
check("classic is capped at 2 live bombs", g.bombs.length === 2, "n=" + g.bombs.length);

console.log("speedy");
g = createGame({ classes: ["speedy", "classic"] });
for (let i = 0; i < 7; i += 1) {
  requestBomb(g, 0);
  step(g, 16);
  requestMove(g, 0, "down");
  run(g, MOVE_COOLDOWN_MS + 32);
}
check("speedy may hold 5 bombs at once", g.bombs.length === 5, "n=" + g.bombs.length);
check("speedy bombs use the small radius", g.bombs.every((b) => b.radius === 1));

g = createGame({ classes: ["speedy", "classic"] });
g.players[0].invulnIn = 0;
requestMove(g, 0, "down");
run(g, MOVE_COOLDOWN_MS + 32);
requestMove(g, 0, "down");
run(g, MOVE_COOLDOWN_MS + 32);
const speedyY = g.players[0].y;
requestBomb(g, 0);
run(g, BOMB_FUSE_MS + 50);
const speedyReach = g.blasts.filter((b) => b.x === SPAWNS[0].x).map((b) => b.y);
check("speedy fire reaches 1 square", speedyReach.includes(speedyY + 1));
check("speedy fire stops short of 2 squares", !speedyReach.includes(speedyY + 2));

console.log("classic blast radius");
g = createGame({ classes: ["classic", "classic"] });
g.players[0].invulnIn = 0;
for (let i = 0; i < 4; i += 1) {
  requestMove(g, 0, "down");
  run(g, MOVE_COOLDOWN_MS + 32);
}
const classicY = g.players[0].y;
requestBomb(g, 0);
run(g, BOMB_FUSE_MS + 50);
const classicReach = g.blasts.filter((b) => b.x === SPAWNS[0].x).map((b) => b.y);
check("classic fire reaches 2 squares", classicReach.includes(classicY + 2));
check("classic fire stops short of 3", !classicReach.includes(classicY + 3));

console.log("sniper");
g = createGame({ classes: ["sniper", "classic"] });
// Spawns are 15 rows apart, so the shot is available immediately.
const armed = sniperTargets(g, 0);
check("sniper is armed at long range", Array.isArray(armed) && armed.length > 0, JSON.stringify(armed));
requestBomb(g, 0);
step(g, 16);
check("sniper bomb is not on the shooter's tile", g.bombs.length === 1 && g.bombs[0].y !== 0);
const foe = g.players[1];
const shot = g.bombs[0];
check("sniper bomb lands in one of the 8 squares around the target",
  Math.max(Math.abs(shot.x - foe.x), Math.abs(shot.y - foe.y)) === 1,
  JSON.stringify({ shot: { x: shot.x, y: shot.y }, foe: { x: foe.x, y: foe.y } }));
check("sniper bomb uses the classic radius", shot.radius === CLASSES.classic.blastRadius);

g = createGame({ classes: ["sniper", "classic"] });
requestBomb(g, 0);
step(g, 16);
requestBomb(g, 0);
step(g, 16);
requestBomb(g, 0);
step(g, 16);
check("sniper is capped at 2 live bombs", g.bombs.length === 2, "n=" + g.bombs.length);

console.log("sniper minimum range");
g = createGame({ classes: ["sniper", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
g.players[1].x = 7; g.players[1].y = 6;   // 2 squares apart
check("no firing solution when too close", sniperTargets(g, 0) === null);
requestBomb(g, 0);
step(g, 16);
check("close-range shot is refused", g.bombs.length === 0, "n=" + g.bombs.length);
check("the refusal is reported", g.events.some((e) => e.type === "bombRefused"));

g.players[1].x = 9; g.players[1].y = 5;   // exactly 4 apart
check("armed again at exactly 4 squares", Array.isArray(sniperTargets(g, 0)));
requestBomb(g, 0);
step(g, 16);
check("shot lands at minimum range", g.bombs.length === 1);

console.log("classes do not leak into each other");
g = createGame({ classes: ["speedy", "classic"] });
requestBomb(g, 0);
requestBomb(g, 1);
step(g, 16);
const mine = g.bombs.find((b) => b.owner === 0);
const theirs = g.bombs.find((b) => b.owner === 1);
check("each bomb keeps its owner's radius", mine.radius === 1 && theirs.radius === 2,
  JSON.stringify([mine.radius, theirs.radius]));

console.log("chain reaction respects each bomb's own radius");
g = createGame({ classes: ["classic", "speedy"] });
g.players.forEach((p) => { p.invulnIn = 999999; });
g.bombs.push({ x: 2, y: 5, owner: 0, fuse: 50, radius: 2 });
g.bombs.push({ x: 4, y: 5, owner: 1, fuse: BOMB_FUSE_MS, radius: 1 });
run(g, 120);
check("neighbouring bomb is set off early", g.bombs.length === 0, "left=" + g.bombs.length);
const chained = g.blasts.map((b) => b.x + "," + b.y);
check("the small bomb's fire stays small", !chained.includes("6,5"), JSON.stringify(chained));

console.log("damage and respawn");
g = createGame();
g.players[0].invulnIn = 0;
requestBomb(g, 0);
run(g, BOMB_FUSE_MS + 100);
check("standing on your own bomb costs a life", g.players[0].lives === START_LIVES - 1, "lives=" + g.players[0].lives);
check("player is downed and respawning", g.players[0].alive === false);
run(g, 1000);
check("respawns at own spawn", g.players[0].alive && g.players[0].y === SPAWNS[0].y);
check("respawn grants grace", g.players[0].invulnIn > 0);

console.log("win condition");
g = createGame();
g.players[1].lives = 1;
g.players[1].invulnIn = 0;
g.bombs.push({ x: g.players[1].x, y: g.players[1].y, owner: 0, fuse: 30, radius: 2 });
run(g, 200);
check("match ends when a player runs out", g.status === "over");
check("the survivor wins", g.winner === 0, "winner=" + g.winner);

console.log("draw");
g = createGame();
g.players.forEach((p) => { p.lives = 1; p.invulnIn = 0; });
g.players[0].x = 3; g.players[0].y = 8;
g.players[1].x = 3; g.players[1].y = 9;
g.bombs.push({ x: 3, y: 8, owner: 0, fuse: 30, radius: 2 });
run(g, 200);
check("simultaneous knockout is a draw", g.status === "over" && g.winner === null, "winner=" + g.winner);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
