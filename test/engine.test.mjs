import {
  createGame as dealGame,
  generateLayout,
  tileAt,
  step,
  requestMove,
  setHeld,
  requestBomb,
  requestFatality,
  fatalityReady,
  sniperTargets,
} from "../shared/engine.js";
import {
  COLS,
  ROWS,
  SPAWNS,
  MODES,
  FATALITY_STREAK,
  FATALITY_RANGE,
  FATALITY_ANYWHERE_STREAK,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  HOLD_DELAY_MS,
  HOLD_REPEAT_MS,
  MOVE_COOLDOWN_MS,
  MOVE_BUFFER_MS,
  COUNTDOWN_MS,
  ROUND_END_MS,
  ABSORB_GRACE_MS,
  CLASSES,
  TILE_FLOOR,
  TILE_WALL,
  SPAWN_CLEAR_RADIUS,
} from "../shared/constants.js";

// The rule tests below were written for an open board that is live from the
// first tick; they keep one so walls, crates and the opening countdown cannot
// get in their way. Layout and rounds have their own sections.
const createGame = (options = {}) => dealGame({ obstacles: false, countdownMs: 0, ...options });
const START_LIVES = MODES.blitz.lives; // the default mode

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

// A real tap: key down, released ~50ms later, then wait out the cooldown.
function tap(state, index, dir) {
  requestMove(state, index, dir);
  run(state, 48);
  setHeld(state, index, null);
  run(state, MOVE_COOLDOWN_MS);
}

// Drops a bomb with a nearly spent fuse right on a tile.
function boomAt(state, x, y, owner, radius = 1) {
  state.bombs.push({ x, y, owner, fuse: 16, radius });
}

console.log("board");
let g = createGame();
check("board is 12x16", COLS === 12 && ROWS === 16);
check("player 0 at top spawn", g.players[0].x === SPAWNS[0].x && g.players[0].y === 0);
check("player 1 at bottom spawn", g.players[1].x === SPAWNS[1].x && g.players[1].y === ROWS - 1);
check("both start with " + START_LIVES + " lives", g.players.every((p) => p.lives === START_LIVES));
check("default class is classic", g.players.every((p) => p.className === "classic"));

console.log("tapping");
g = createGame();
requestMove(g, 0, "down");
step(g, 16);
check("a press steps on the very next tick", g.players[0].y === 1, "y=" + g.players[0].y);
run(g, 32);
setHeld(g, 0, null);
run(g, 1000);
check("a quick tap is exactly one square", g.players[0].y === 1, "y=" + g.players[0].y);
tap(g, 0, "down");
tap(g, 0, "down");
check("each new tap moves again", g.players[0].y === 3, "y=" + g.players[0].y);

g = createGame();
requestMove(g, 0, "down");
run(g, HOLD_DELAY_MS - 20);
setHeld(g, 0, null);
run(g, 500);
check("releasing just before the hold delay is still one step", g.players[0].y === 1, "y=" + g.players[0].y);

console.log("holding");
g = createGame();
requestMove(g, 0, "down");
run(g, 1000);
const expected = 1 + Math.floor((1000 - HOLD_DELAY_MS) / HOLD_REPEAT_MS) + 1;
check("holding keeps walking", g.players[0].y >= expected - 1 && g.players[0].y <= expected,
  "y=" + g.players[0].y + " expected~" + expected);
const heldTo = g.players[0].y;
setHeld(g, 0, null);
run(g, 800);
check("releasing stops the walk", g.players[0].y === heldTo, "y=" + g.players[0].y);

g = createGame();
requestMove(g, 0, "down");
run(g, 400);
requestMove(g, 0, "right");       // second key goes down on top
run(g, 400);
const xAfterRight = g.players[0].x;
const yAfterRight = g.players[0].y;
check("the newest held key wins", xAfterRight > SPAWNS[0].x, "x=" + xAfterRight);
setHeld(g, 0, "down");            // release right, down is still held
run(g, 400);
check("releasing it falls back to the key still held",
  g.players[0].y > yAfterRight && g.players[0].x === xAfterRight,
  "x=" + g.players[0].x + " y=" + g.players[0].y);

console.log("press buffering");
g = createGame();
requestMove(g, 0, "down");
step(g, 16);
requestMove(g, 0, "down"); // arrives while the cooldown is still running
step(g, 16);
check("second press is held, not dropped", g.players[0].y === 1, "y=" + g.players[0].y);
run(g, MOVE_COOLDOWN_MS);
check("buffered press lands once the cooldown ends", g.players[0].y === 2, "y=" + g.players[0].y);

g = createGame();
g.players[0].moveCd = MOVE_BUFFER_MS + 200; // longer than the buffer lives
requestMove(g, 0, "down");
setHeld(g, 0, null);
run(g, MOVE_BUFFER_MS + 300);
check("a stale buffered press expires", g.players[0].y === 0, "y=" + g.players[0].y);

console.log("walls");
g = createGame();
requestMove(g, 0, "up");
run(g, 800);
check("cannot leave the top edge", g.players[0].y === 0);
requestMove(g, 0, "left");
run(g, 2000);
check("cannot leave the left edge", g.players[0].x === 0, "x=" + g.players[0].x);
requestMove(g, 0, "right");
run(g, 2500);
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

console.log("bomb limits per class");
function bombsAfterSpam(className) {
  const s = createGame({ classes: [className, "classic"] });
  for (let i = 0; i < 7; i += 1) {
    requestBomb(s, 0);
    step(s, 16);
    tap(s, 0, "down");
  }
  return s.bombs.filter((b) => b.owner === 0);
}
const classicBombs = bombsAfterSpam("classic");
const speedyBombs = bombsAfterSpam("speedy");
const tankBombs = bombsAfterSpam("tank");
check("classic: 3 bombs, radius 2", classicBombs.length === 3 && classicBombs.every((b) => b.radius === 2),
  classicBombs.length + " bombs");
check("speedy: 5 bombs, radius 1", speedyBombs.length === 5 && speedyBombs.every((b) => b.radius === 1),
  speedyBombs.length + " bombs");
check("tank: 2 bombs, radius 1 — same size as speedy",
  tankBombs.length === 2 && tankBombs.every((b) => b.radius === CLASSES.speedy.blastRadius),
  tankBombs.length + " bombs, radius " + tankBombs[0]?.radius);

console.log("blast radius");
function reachOf(className) {
  const s = createGame({ classes: [className, "classic"] });
  s.players[0].invulnIn = 999999;
  for (let i = 0; i < 4; i += 1) tap(s, 0, "down");
  const y = s.players[0].y;
  requestBomb(s, 0);
  step(s, 16);
  tap(s, 0, "right");
  run(s, BOMB_FUSE_MS);
  const column = s.blasts.filter((b) => b.x === SPAWNS[0].x).map((b) => b.y - y);
  return Math.max(...column);
}
check("classic fire reaches 2 squares", reachOf("classic") === 2, "reach=" + reachOf("classic"));
check("speedy fire reaches 1 square", reachOf("speedy") === 1, "reach=" + reachOf("speedy"));
check("tank fire reaches 1 square", reachOf("tank") === 1, "reach=" + reachOf("tank"));

console.log("sniper");
g = createGame({ classes: ["sniper", "classic"] });
const armed = sniperTargets(g, 0);
check("sniper is armed at long range", Array.isArray(armed) && armed.length > 0);
requestBomb(g, 0);
step(g, 16);
const shot = g.bombs[0];
const foe = g.players[1];
check("sniper bomb lands in one of the 8 squares around the target",
  !!shot && Math.max(Math.abs(shot.x - foe.x), Math.abs(shot.y - foe.y)) === 1);

g = createGame({ classes: ["sniper", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
g.players[1].x = 7; g.players[1].y = 6;
check("no firing solution when too close", sniperTargets(g, 0) === null);
requestBomb(g, 0);
step(g, 16);
check("close-range shot is refused", g.bombs.length === 0);
g.players[1].x = 9; g.players[1].y = 5;
check("armed again at exactly 4 squares", Array.isArray(sniperTargets(g, 0)));

console.log("own bomb: two hits per life");
g = createGame();
g.players[0].invulnIn = 0;
requestBomb(g, 0);
run(g, BOMB_FUSE_MS + 50);
check("first own-bomb hit is absorbed", g.players[0].lives === START_LIVES && g.players[0].alive,
  "lives=" + g.players[0].lives);
check("the self shield is spent", g.players[0].selfShields === 0);
check("absorbing grants a short grace", g.players[0].invulnIn > 0);
run(g, ABSORB_GRACE_MS);
check("the same fire does not hit twice", g.players[0].lives === START_LIVES && g.players[0].alive);
requestBomb(g, 0);
run(g, BOMB_FUSE_MS + 50);
check("second own-bomb hit costs the life", g.players[0].lives === START_LIVES - 1 && !g.players[0].alive,
  "lives=" + g.players[0].lives);
run(g, ROUND_END_MS + 50);
check("the self shield refills next round", g.players[0].alive && g.players[0].selfShields === 1);

console.log("self shield only works on your own fire");
g = createGame();
g.players[0].invulnIn = 0;
boomAt(g, g.players[0].x, g.players[0].y, 1);
run(g, 48);
check("an enemy hit costs a life straight away", g.players[0].lives === START_LIVES - 1,
  "lives=" + g.players[0].lives);

g = createGame();
g.players[0].invulnIn = 0;
g.players[0].x = 5; g.players[0].y = 5;
boomAt(g, 5, 5, 0);   // own fire...
boomAt(g, 6, 5, 1);   // ...and enemy fire reaching the same tile
run(g, 48);
check("a tile burning with both players' fire counts as enemy fire",
  g.players[0].lives === START_LIVES - 1, "lives=" + g.players[0].lives);

g = createGame();
g.players[0].invulnIn = 0;
g.players[0].x = 5; g.players[0].y = 5;
g.bombs.push({ x: 5, y: 6, owner: 0, fuse: BOMB_FUSE_MS, radius: 1 }); // mine, far fuse
boomAt(g, 5, 8, 1, 2);  // enemy bomb reaches mine at (5,6) but not me at (5,5)
run(g, 48);
check("my bomb set off by the enemy still burns as my fire",
  g.players[0].lives === START_LIVES && g.players[0].selfShields === 0,
  "lives=" + g.players[0].lives + " selfShields=" + g.players[0].selfShields);

console.log("tank");
g = createGame({ classes: ["tank", "classic"] });
check("tank starts with armour and a self shield",
  g.players[0].shields === 1 && g.players[0].selfShields === 1);
g.players[0].invulnIn = 0;
g.players[0].x = 5; g.players[0].y = 5;
boomAt(g, 5, 5, 1);
run(g, 48);
check("first enemy hit is absorbed by armour", g.players[0].lives === START_LIVES && g.players[0].shields === 0);
check("the self shield is untouched by enemy fire", g.players[0].selfShields === 1);
run(g, ABSORB_GRACE_MS);
boomAt(g, 5, 5, 1);
run(g, 48);
check("second enemy hit costs the life", g.players[0].lives === START_LIVES - 1, "lives=" + g.players[0].lives);
run(g, ROUND_END_MS + 50);
check("armour refills next round", g.players[0].shields === 1 && g.players[0].selfShields === 1);

console.log("tank vs its own bombs — shields stack");
g = createGame({ classes: ["tank", "classic"] });
g.players[0].invulnIn = 0;
g.players[0].x = 5; g.players[0].y = 5;
const hits = [];
for (let i = 0; i < 3; i += 1) {
  boomAt(g, 5, 5, 0);
  run(g, 48);
  hits.push(g.players[0].lives + "/" + g.players[0].selfShields + "/" + g.players[0].shields);
  run(g, ABSORB_GRACE_MS);
}
check("hit 1 spends the self shield first", hits[0] === "3/0/1", hits[0]);
check("hit 2 spends the armour", hits[1] === "3/0/0", hits[1]);
check("hit 3 costs the life", hits[2].startsWith("2/"), hits[2]);
check("other classes have no armour", createGame().players.every((p) => p.shields === 0));

console.log("absorb grace outlasts the fire");
check("grace is longer than a blast lasts", ABSORB_GRACE_MS > BLAST_DURATION_MS);

console.log("chain reaction respects each bomb's own radius");
g = createGame({ classes: ["classic", "speedy"] });
g.players.forEach((p) => { p.invulnIn = 999999; });
g.bombs.push({ x: 2, y: 5, owner: 0, fuse: 50, radius: 2 });
g.bombs.push({ x: 4, y: 5, owner: 1, fuse: BOMB_FUSE_MS, radius: 1 });
run(g, 120);
check("neighbouring bomb is set off early", g.bombs.length === 0);
check("the small bomb's fire stays small", !g.blasts.some((b) => b.x === 6 && b.y === 5));

console.log("win condition");
g = createGame();
g.players[1].lives = 1;
g.players[1].invulnIn = 0;
boomAt(g, g.players[1].x, g.players[1].y, 0, 2);
run(g, 200);
check("match ends when a player runs out", g.status === "over");
check("the survivor wins", g.winner === 0, "winner=" + g.winner);

console.log("draw");
g = createGame();
g.players.forEach((p) => { p.lives = 1; p.invulnIn = 0; });
g.players[0].x = 3; g.players[0].y = 8;
g.players[1].x = 3; g.players[1].y = 9;
boomAt(g, 3, 8, 1, 2);   // p1's bomb: enemy fire for p0 ...
boomAt(g, 3, 9, 0, 2);   // ... p0's bomb: enemy fire for p1
run(g, 200);
check("simultaneous knockout is a draw", g.status === "over" && g.winner === null, "winner=" + g.winner);

console.log("rounds — the opening countdown");
g = dealGame({ obstacles: false });
check("a real match opens with a countdown", g.phase === "countdown" && g.phaseLeft === COUNTDOWN_MS && g.round === 1);
requestMove(g, 0, "down");
setHeld(g, 0, null);
requestBomb(g, 0);
run(g, 1000);
check("presses during the countdown do nothing", g.players[0].y === SPAWNS[0].y && g.bombs.length === 0);
run(g, COUNTDOWN_MS - 1000 + 16);
check("it goes live when the countdown ends", g.phase === "live");
tap(g, 0, "down");
check("…and then moves work", g.players[0].y === SPAWNS[0].y + 1, "y=" + g.players[0].y);

g = dealGame({ obstacles: false });
run(g, COUNTDOWN_MS - 500);
requestMove(g, 0, "down");          // pressed during the countdown and kept held
run(g, 500 + HOLD_DELAY_MS + 100);
check("a key held through GO starts walking", g.players[0].y > SPAWNS[0].y, "y=" + g.players[0].y);

console.log("rounds — a lost life ends the round");
g = createGame({ classes: ["classic", "classic"] });
g.players[0].x = 4; g.players[0].y = 6;
g.players[1].x = 7; g.players[1].y = 9;
boomAt(g, 7, 9, 0, 1);
run(g, 32);
check("the round ends for both players", g.phase === "roundEnd" && g.phaseLeft > 0);
check("it records who fell and who survived", JSON.stringify(g.fallen) === "[1]" && JSON.stringify(g.history) === "[0]");
check("the match goes on while lives remain", g.status === "playing" && g.players[1].lives === START_LIVES - 1);

g.bombs.push({ x: 2, y: 2, owner: 0, fuse: 600, radius: 1 });
requestMove(g, 0, "left");
setHeld(g, 0, null);
requestBomb(g, 0);
run(g, ROUND_END_MS - 200);
check("during the freeze nobody moves", g.players[0].x === 4 && g.players[0].y === 6);
check("during the freeze fuses stop and no bomb is placed",
  g.bombs.length === 1 && g.bombs[0].fuse === 600);

run(g, 250);
check("then the next round starts", g.phase === "live" && g.round === 2);
check("the next round has no countdown", g.liveFor < 100);
check("both players are back on their spawns",
  g.players.every((p) => p.x === SPAWNS[p.index].x && p.y === SPAWNS[p.index].y && p.alive));
check("bombs and fire are cleared", g.bombs.length === 0 && g.blasts.length === 0);
check("lives carry over", g.players[0].lives === START_LIVES && g.players[1].lives === START_LIVES - 1);

console.log("rounds — the board resets");
{
  const real = dealGame({ seed: 7, countdownMs: 0 });
  const crateSquare = real.tiles.findIndex((t) => t > 0);
  const cx = crateSquare % COLS, cy = Math.floor(crateSquare / COLS);
  // Blow the crate up from whichever side is open, well away from both players.
  real.players.forEach((p) => { p.invulnIn = 999999; });
  const side = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [cx + dx, cy + dy])
    .find(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS && real.tiles[y * COLS + x] === TILE_FLOOR);
  boomAt(real, side[0], side[1], 0, 1);
  run(real, 32);
  const brokeOne = real.tiles[crateSquare] === TILE_FLOOR;
  real.players.forEach((p) => { p.invulnIn = 0; });
  boomAt(real, real.players[1].x, real.players[1].y, 0, 1);
  run(real, 32 + ROUND_END_MS + 50);
  check("a crate broken in a round…", brokeOne);
  check("…is back when the next round starts", real.round === 2 &&
    JSON.stringify(real.tiles) === JSON.stringify(real.layout));
  check("the layout itself stays the same all match", real.seed === 7 &&
    JSON.stringify(real.layout) === JSON.stringify(generateLayout(7)));
}

console.log("rounds — draws and the end");
g = createGame();
g.players[0].x = 3; g.players[0].y = 8;
g.players[1].x = 3; g.players[1].y = 9;
boomAt(g, 3, 8, 1, 2);
boomAt(g, 3, 9, 0, 2);
run(g, 32);
check("both falling on the same tick is a drawn round",
  g.phase === "roundEnd" && g.history[0] === null && g.players.every((p) => p.lives === START_LIVES - 1));

g = createGame();
g.players[1].lives = 1;
boomAt(g, g.players[1].x, g.players[1].y, 0, 2);
run(g, 32);
check("losing the last life ends the match at once", g.status === "over" && g.phase === "live" && g.winner === 0);

console.log("game modes");
{
  const blitz = dealGame({ obstacles: false });
  const siege = dealGame({ mode: "siege", obstacles: false });
  check("the default mode is Blitz with 3 lives",
    blitz.mode === "blitz" && blitz.maxLives === 3 && blitz.players.every((p) => p.lives === 3));
  check("Siege starts both players on 7 lives",
    siege.mode === "siege" && siege.maxLives === 7 && siege.players.every((p) => p.lives === 7));
  check("an unknown mode falls back to Blitz", dealGame({ mode: "nope", obstacles: false }).mode === "blitz");
}

// Ends the current round by setting a blast off on `loser`, then waits for the
// next round to go live. Works for self-kills too (owner = loser).
function loseRound(state, loser, owner = loser === 0 ? 1 : 0) {
  const victim = state.players[loser];
  victim.invulnIn = 0;
  victim.selfShields = 0;
  victim.shields = 0;
  boomAt(state, victim.x, victim.y, owner, 1);
  run(state, 32);
  if (state.status === "playing") run(state, ROUND_END_MS + 50);
}

console.log("kill streaks");
g = createGame({ mode: "siege" });
loseRound(g, 1);
check("winning a round starts a streak", g.players[0].streak === 1 && g.players[1].streak === 0);
loseRound(g, 1);
loseRound(g, 1);
check("each round won in a row adds one", g.players[0].streak === 3, "streak=" + g.players[0].streak);
loseRound(g, 1, 1);
check("the opponent blowing themselves up still counts", g.players[0].streak === 4, "streak=" + g.players[0].streak);
loseRound(g, 0);
check("losing a life resets your streak", g.players[0].streak === 0 && g.players[1].streak === 1);
g.players[0].x = 3; g.players[0].y = 8;
g.players[1].x = 3; g.players[1].y = 9;
boomAt(g, 3, 8, 1, 2);
boomAt(g, 3, 9, 0, 2);
run(g, 32);
check("a drawn round resets both streaks", g.players.every((p) => p.streak === 0));
{
  const shield = createGame({ classes: ["classic", "tank"], mode: "siege" });
  shield.players[1].x = 6; shield.players[1].y = 9;
  boomAt(shield, 6, 9, 0, 1);  // the tank's armour takes it — no life lost, no round won
  run(shield, 32);
  check("a hit a shield absorbs is not a kill", shield.players[0].streak === 0 && shield.phase === "live");
}

console.log("fatality — finishing move at 4");
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) loseRound(g, 1);
check("4 in a row puts the fatality on offer", g.players[0].streak === FATALITY_STREAK && g.status === "playing");
check("…but only when close: from the spawns it is out of reach", fatalityReady(g, 0) === "far");
requestFatality(g, 0);
run(g, 32);
check("pressing X out of range does nothing", g.status === "playing" && g.finish === null);
check("the opponent has no fatality at all", fatalityReady(g, 1) === null);
g.players[0].x = 5; g.players[0].y = 7;
g.players[1].x = 5 + FATALITY_RANGE; g.players[1].y = 7 + FATALITY_RANGE;
check("within 2 squares (diagonals too) it is ready", fatalityReady(g, 0) === "near");
requestFatality(g, 0);
step(g, 16);
check("pressing X then ends the match at once", g.status === "over" && g.winner === 0);
check("it is recorded as a fatality",
  g.finish && g.finish.type === "fatality" && g.finish.by === 0 && g.finish.victim === 1 &&
  g.finish.streak === FATALITY_STREAK);
check("the victim is out, whatever lives they had left", g.players[1].lives === 0 && !g.players[1].alive);

console.log("fatality — from anywhere at 5");
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_ANYWHERE_STREAK; i += 1) loseRound(g, 1);
check("5 in a row reaches across the board",
  g.players[0].streak === FATALITY_ANYWHERE_STREAK && fatalityReady(g, 0) === "anywhere");
requestFatality(g, 0);
step(g, 16);
check("X wins from the spawn", g.status === "over" && g.winner === 0 && g.finish.streak === 5);

console.log("fatality — timing");
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_ANYWHERE_STREAK - 1; i += 1) loseRound(g, 1);
g.players[1].invulnIn = 0; g.players[1].selfShields = 0;
boomAt(g, g.players[1].x, g.players[1].y, 0, 1);
run(g, 32);
check("the round-end freeze offers nothing", g.phase === "roundEnd" && fatalityReady(g, 0) === null);
requestFatality(g, 0);
run(g, ROUND_END_MS + 50);
check("a press during the freeze is not saved for later", g.status === "playing" && g.phase === "live");
check("Blitz can never get there — 3 kills already win",
  MODES.blitz.lives < FATALITY_STREAK);

console.log("arena layout — 500 random boards");
{
  const kind = (t) => (t === TILE_WALL ? "wall" : t > 0 ? "crate" : "floor");
  let mirrored = true, spawnsClear = true, connected = true, hasWalls = true, hasCrates = true;
  const crateSizes = new Set();
  const wallPieceSizes = new Set();
  for (let seed = 1; seed <= 500; seed += 1) {
    const tiles = generateLayout(seed);
    const at = (x, y) => tiles[y * COLS + x];
    if (!tiles.some((t) => t === TILE_WALL)) hasWalls = false;
    if (!tiles.some((t) => t > 0)) hasCrates = false;
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (kind(at(x, y)) !== kind(at(COLS - 1 - x, ROWS - 1 - y))) mirrored = false;
        const nearSpawn = SPAWNS.some((sp) => Math.abs(sp.x - x) + Math.abs(sp.y - y) <= SPAWN_CLEAR_RADIUS);
        if (nearSpawn && at(x, y) !== TILE_FLOOR) spawnsClear = false;
      }
    }
    // Every non-wall square reachable from spawn 1 (crates can be bombed open).
    const seen = new Set([SPAWNS[0].y * COLS + SPAWNS[0].x]);
    const queue = [SPAWNS[0]];
    while (queue.length) {
      const { x, y } = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const i = ny * COLS + nx;
        if (seen.has(i) || tiles[i] === TILE_WALL) continue;
        seen.add(i);
        queue.push({ x: nx, y: ny });
      }
    }
    if (seen.size !== tiles.filter((t) => t !== TILE_WALL).length) connected = false;
    const perCrate = new Map();
    tiles.forEach((t) => { if (t > 0) perCrate.set(t, (perCrate.get(t) || 0) + 1); });
    for (const n of perCrate.values()) crateSizes.add(n);
    // Wall pieces = 4-connected groups of wall squares.
    const done = new Set();
    tiles.forEach((t, i) => {
      if (t !== TILE_WALL || done.has(i)) return;
      let size = 0;
      const stack = [i];
      done.add(i);
      while (stack.length) {
        const j = stack.pop();
        size += 1;
        const x = j % COLS, y = Math.floor(j / COLS);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
          const k = ny * COLS + nx;
          if (tiles[k] === TILE_WALL && !done.has(k)) { done.add(k); stack.push(k); }
        }
      }
      wallPieceSizes.add(size);
    });
  }
  check("every board has walls and crates", hasWalls && hasCrates);
  check("every board is point-symmetric (fair to both players)", mirrored);
  check("the squares around both spawns are always clear", spawnsClear);
  check("walls never cut the board in two", connected);
  check("crates come in sizes 1, 2 and 4 squares", [1, 2, 4].every((n) => crateSizes.has(n)),
    [...crateSizes].sort().join(","));
  check("walls come in several lengths and shapes", [1, 2, 3].every((n) => wallPieceSizes.has(n)),
    [...wallPieceSizes].sort().join(","));
}

{
  check("the same seed deals the same board",
    JSON.stringify(generateLayout(42)) === JSON.stringify(generateLayout(42)));
  const boards = new Set(Array.from({ length: 10 }, () => JSON.stringify(dealGame().tiles)));
  check("every new match deals a new board", boards.size === 10, boards.size + " distinct of 10");
  const real = dealGame();
  check("a real match starts with walls and crates",
    real.tiles.some((t) => t === TILE_WALL) && real.tiles.some((t) => t > 0));
}

console.log("walls and crates in play");
// Hand-built boards: start open, then place pieces exactly where the test needs them.
const put = (state, x, y, tile) => { state.tiles[y * COLS + x] = tile; };

g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
put(g, 5, 6, TILE_WALL);
put(g, 6, 5, 3);
tap(g, 0, "down");
check("a wall blocks movement", g.players[0].y === 5, "y=" + g.players[0].y);
tap(g, 0, "right");
check("a crate blocks movement", g.players[0].x === 5, "x=" + g.players[0].x);
requestMove(g, 0, "left");
run(g, 600);
setHeld(g, 0, null);
check("open floor still walks", g.players[0].x < 5);

g = createGame();
g.players.forEach((p) => { p.invulnIn = 999999; });
put(g, 7, 5, TILE_WALL);
boomAt(g, 5, 5, 0, 2);
run(g, 48);
const fireAt = (x, y) => g.blasts.some((b) => b.x === x && b.y === y);
check("fire reaches up to a wall", fireAt(6, 5));
check("fire never burns a wall square or past it", !fireAt(7, 5) && !fireAt(8, 5));
check("walls do not break", tileAt(g, 7, 5) === TILE_WALL);

g = createGame();
g.players.forEach((p) => { p.invulnIn = 999999; });
put(g, 5, 6, 11);
boomAt(g, 5, 5, 0, 2);
run(g, 48);
check("fire burns the crate's square", g.blasts.some((b) => b.x === 5 && b.y === 6));
check("the crate breaks", tileAt(g, 5, 6) === TILE_FLOOR);
check("fire stops at the crate", !g.blasts.some((b) => b.x === 5 && b.y === 7));

g = createGame();
g.players.forEach((p) => { p.invulnIn = 999999; });
for (const [x, y] of [[7, 5], [8, 5], [7, 6], [8, 6]]) put(g, x, y, 21);
boomAt(g, 5, 5, 0, 2);
run(g, 48);
check("a 2x2 crate breaks as a whole when one square is hit",
  [[7, 5], [8, 5], [7, 6], [8, 6]].every(([x, y]) => tileAt(g, x, y) === TILE_FLOOR));
check("fire does not run on through the broken crate", !g.blasts.some((b) => b.x === 8 && b.y === 5));

g = createGame();
g.players[1].invulnIn = 0;
g.players[1].x = 5; g.players[1].y = 8;
put(g, 5, 7, 5);
boomAt(g, 5, 6, 0, 2);
run(g, 48);
check("a crate shields whoever stands behind it", g.players[1].lives === START_LIVES && g.players[1].alive);
check("…and is gone afterwards", tileAt(g, 5, 7) === TILE_FLOOR);

g = createGame({ classes: ["sniper", "classic"] });
g.players[1].x = 6; g.players[1].y = 12;
put(g, 5, 11, TILE_WALL);
put(g, 7, 13, 9);
const ring = sniperTargets(g, 0) || [];
check("sniper shots never land on walls or crates",
  ring.length === 6 && !ring.some((c) => (c.x === 5 && c.y === 11) || (c.x === 7 && c.y === 13)),
  JSON.stringify(ring));
for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
  put(g, 6 + dx, 12 + dy, TILE_WALL);
}
requestBomb(g, 0);
step(g, 16);
check("a target boxed in by walls cannot be sniped", g.bombs.length === 0 && g.events.some((e) => e.type === "bombRefused"));

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
