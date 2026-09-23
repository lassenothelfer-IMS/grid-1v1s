import {
  createGame as dealGame,
  generateLayout,
  tileAt,
  step,
  requestMove,
  setHeld,
  requestBomb,
  requestFatality,
  requestAbility,
  fatalityReady,
  sniperTargets,
  viewFor,
} from "../shared/engine.js";
import {
  COLS,
  ROWS,
  SPAWNS,
  TEAM_SPAWNS,
  COLOR_IDS,
  NAME_MAX,
  SHADE_VANISH_MS,
  DECOY_MS,
  DECOY_COOLDOWN_MS,
  ROUND_END_KILLCAM_MS,
  RING_GRACE_MS,
  RING_STEP_MS,
  ROYALE_SPAWNS,
  ROYALE_POINTS_PER_PLAYER,
  TILE_FIRE,
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
check("still ticking just before the fuse runs out", g.bombs.length === 1 && g.blasts.length === 0);
run(g, 300);
check("detonates when it does", g.bombs.length === 0 && g.blasts.length > 0);

console.log("bomb limits per class");
// Tries to lay 7 bombs in a row; returns the most that were live at once.
// (The fuse is short enough that the first ones go off along the way.)
function bombsAfterSpam(className) {
  const s = createGame({ classes: [className, "classic"] });
  s.players[0].invulnIn = 999999;
  let peak = [];
  for (let i = 0; i < 7; i += 1) {
    requestBomb(s, 0);
    step(s, 16);
    const mine = s.bombs.filter((b) => b.owner === 0);
    if (mine.length > peak.length) peak = mine;
    tap(s, 0, "down");
  }
  return peak;
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

console.log("fatality — the bomb beats your X by a split second");
// The reported bug: a streak of 4, your bomb drops them a moment before your X
// lands. The kill must not swallow the fatality.
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) loseRound(g, 1);
g.players[0].x = 5; g.players[0].y = 10;
g.players[1].x = 7; g.players[1].y = 12;
g.players[1].selfShields = 0;
g.bombs.push({ x: 7, y: 11, owner: 0, fuse: 16, radius: 1 }); // placed earlier, going off now
g.bombs.push({ x: 2, y: 3, owner: 0, fuse: 900, radius: 2 }); // and another still ticking elsewhere
run(g, 32);
check("the bomb gets there first: the round freezes", g.phase === "roundEnd" && g.players[1].lives === 2);
check("the finishing blow is on offer during the freeze", fatalityReady(g, 0) === "anywhere");
run(g, 80);
requestFatality(g, 0);
step(g, 16);
check("X in the freeze still performs the fatality", g.status === "over" && g.finish?.type === "fatality");
check("…on the opponent where they fell", g.finish.victim === 1 && g.finish.x === 7 && g.finish.y === 12);
check("…crediting the streak that earned it", g.finish.by === 0 && g.finish.streak === FATALITY_ANYWHERE_STREAK);

console.log("fatality — on the last life");
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) loseRound(g, 1);
g.players[1].lives = 1; g.players[1].selfShields = 0;
boomAt(g, g.players[1].x, g.players[1].y, 0, 1);
run(g, 32);
check("a match-winning kill with a fatality on offer holds the freeze open",
  g.status === "playing" && g.phase === "roundEnd" && g.pendingWinner === 0);
requestFatality(g, 0);
step(g, 16);
check("…so X still turns it into a fatality", g.status === "over" && g.winner === 0 && g.finish?.type === "fatality");

g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) loseRound(g, 1);
g.players[1].lives = 1; g.players[1].selfShields = 0;
boomAt(g, g.players[1].x, g.players[1].y, 0, 1);
run(g, 32 + ROUND_END_MS + 50);
check("without X the kill decides it once the freeze ends",
  g.status === "over" && g.winner === 0 && g.finish === null && g.pendingWinner === null);

g = createGame();
g.players[1].lives = 1;
boomAt(g, g.players[1].x, g.players[1].y, 0, 2);
run(g, 32);
check("with no fatality on offer the last life still ends it at once", g.status === "over" && g.winner === 0);

console.log("fatality — what the freeze does not allow");
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK - 1; i += 1) loseRound(g, 1);
g.players[0].x = 1; g.players[0].y = 1;
g.players[1].x = 9; g.players[1].y = 12;
g.players[1].selfShields = 0;
boomAt(g, 9, 12, 0, 1);
run(g, 32);
check("a kill that only reaches 4 needs range to where they fell",
  g.players[0].streak === FATALITY_STREAK && fatalityReady(g, 0) === null);
requestFatality(g, 0);
run(g, ROUND_END_MS + 50);
check("out of range, X in the freeze does nothing", g.status === "playing" && g.phase === "live");

g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) loseRound(g, 1);
g.players[1].selfShields = 0;
boomAt(g, g.players[1].x, g.players[1].y, 1, 1); // they blow themselves up
run(g, 32);
check("it works however they fell — even by their own bomb", fatalityReady(g, 0) === "anywhere");

g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) loseRound(g, 1);
g.players[0].x = 3; g.players[0].y = 8;
g.players[1].x = 3; g.players[1].y = 9;
g.players.forEach((pl) => { pl.selfShields = 0; });
boomAt(g, 3, 8, 1, 2);
boomAt(g, 3, 9, 0, 2);
run(g, 32);
check("a drawn round offers no finish to anyone", fatalityReady(g, 0) === null && fatalityReady(g, 1) === null);

g = dealGame({ mode: "siege", obstacles: false });
g.players[0].streak = FATALITY_ANYWHERE_STREAK;
requestFatality(g, 0);
run(g, 500);
check("a press during the countdown does nothing", g.status === "playing" && g.phase === "countdown");
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

// --- the newer classes ------------------------------------------------------------

const burning = (state, x, y) => state.blasts.some((b) => b.x === x && b.y === y);
const untouchable = (state) => state.players.forEach((p) => { p.invulnIn = 999999; });

console.log("quickfuse");
g = createGame({ classes: ["quickfuse", "classic"] });
requestBomb(g, 0);
step(g, 16);
const QUICK = CLASSES.quickfuse.fuseMs;
check("a quickfuse bomb gets its short fuse and a 1-square radius",
  g.bombs[0].fuseMax === QUICK && g.bombs[0].radius === 1, JSON.stringify(g.bombs[0]));
check("…in the same proportion to the normal fuse as 0.8 s was to 1.5 s",
  Math.abs(QUICK / BOMB_FUSE_MS - 0.8 / 1.5) < 0.005, QUICK + " of " + BOMB_FUSE_MS);
tap(g, 0, "right");
run(g, QUICK - 16 - 48 - MOVE_COOLDOWN_MS - 40);
check("…still ticking just before it runs out", g.bombs.length === 1);
run(g, 80);
check("…and gone right after", g.bombs.length === 0 && g.blasts.length > 0);
{
  const c = createGame();
  requestBomb(c, 0);
  step(c, 16);
  check("every other bomb burns for 1 second", BOMB_FUSE_MS === 1000 && c.bombs[0].fuseMax === BOMB_FUSE_MS);
}

console.log("diagonal");
g = createGame({ classes: ["diagonal", "classic"] });
untouchable(g);
requestBomb(g, 0);
step(g, 16);
check("a diagonal bomb is X-shaped", g.bombs[0].shape === "x" && g.bombs[0].radius === 2);
g.bombs = [{ x: 5, y: 7, owner: 0, fuse: 16, radius: 2, shape: "x" }];
run(g, 32);
check("an X blast burns both diagonals out to its radius",
  [[4, 6], [3, 5], [6, 6], [7, 5], [4, 8], [3, 9], [6, 8], [7, 9]].every(([x, y]) => burning(g, x, y)));
check("…its own square too", burning(g, 5, 7));
check("…but not the straight lines", ![[5, 6], [5, 8], [4, 7], [6, 7], [5, 5]].some(([x, y]) => burning(g, x, y)));
g = createGame({ classes: ["diagonal", "classic"] });
untouchable(g);
put(g, 6, 6, TILE_WALL);
put(g, 4, 8, 13);
g.bombs = [{ x: 5, y: 7, owner: 0, fuse: 16, radius: 2, shape: "x" }];
run(g, 32);
check("walls stop a diagonal arm", !burning(g, 6, 6) && !burning(g, 7, 5));
check("crates break and stop it", burning(g, 4, 8) && tileAt(g, 4, 8) === TILE_FLOOR && !burning(g, 3, 9));
g = createGame({ classes: ["diagonal", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0);
step(g, 16);
tap(g, 0, "right");
run(g, BOMB_FUSE_MS);
check("standing right beside your own X bomb is safe",
  g.players[0].alive && g.players[0].selfShields === 1 && g.players[0].x === 6);

console.log("line");
g = createGame({ classes: ["line", "classic"] });
untouchable(g);
check("a line player starts facing the enemy side", g.players[0].facing === "down");
requestBomb(g, 0);
step(g, 16);
check("the bomb is aimed the way its owner faces", g.bombs[0].shape === "line" && g.bombs[0].dir === "down");
tap(g, 0, "right");
run(g, BOMB_FUSE_MS);
check("its fire runs all the way to the far edge",
  Array.from({ length: ROWS }, (_, y) => y).every((y) => burning(g, SPAWNS[0].x, y)));
check("…and nowhere else", !burning(g, SPAWNS[0].x - 1, 0) && !burning(g, SPAWNS[0].x + 1, 0));
g = createGame({ classes: ["line", "classic"] });
untouchable(g);
g.players[0].x = 5; g.players[0].y = 5;
tap(g, 0, "left");
requestBomb(g, 0);
step(g, 16);
check("walking turns you: the next bomb fires left", g.bombs[0].dir === "left");
g.bombs[0].fuse = 16;
run(g, 32);
check("…from the bomb to the left edge", [0, 1, 2, 3, 4].every((x) => burning(g, x, 5)) && !burning(g, 5, 5));
g = createGame({ classes: ["line", "classic"] });
g.players[0].x = 0; g.players[0].y = 5;
tap(g, 0, "left");
check("pressing into the edge turns without moving", g.players[0].x === 0 && g.players[0].facing === "left");
g = createGame({ classes: ["line", "classic"] });
untouchable(g);
put(g, 5, 9, 17);
put(g, 3, 5, TILE_WALL);
g.bombs = [
  { x: 5, y: 5, owner: 0, fuse: 16, radius: CLASSES.line.blastRadius, shape: "line", dir: "down" },
  { x: 6, y: 5, owner: 0, fuse: 16, radius: CLASSES.line.blastRadius, shape: "line", dir: "left" },
];
run(g, 32);
check("a crate still stops a line", burning(g, 5, 9) && !burning(g, 5, 10) && tileAt(g, 5, 9) === TILE_FLOOR);
check("…and so does a wall", burning(g, 4, 5) && !burning(g, 3, 5) && !burning(g, 2, 5));

console.log("shade");
g = createGame({ classes: ["shade", "classic"] });
run(g, SHADE_VANISH_MS - 100);
check("a shade is seen while it has not stood still long enough", !g.players[0].hidden);
run(g, 150);
check("after a second of stillness it vanishes", g.players[0].hidden);
{
  const theirs = viewFor(g, 1).players[0];
  const mine = viewFor(g, 0).players[0];
  check("the other side's view carries no position for it", theirs.x === null && theirs.y === null && theirs.hidden);
  check("its own view still does", mine.x === SPAWNS[0].x && mine.y === SPAWNS[0].y);
  check("…and the real state is untouched", g.players[0].x === SPAWNS[0].x);
}
tap(g, 0, "down");
check("one step keeps it hidden", g.players[0].hidden && g.players[0].y === 1);
tap(g, 0, "down");
check("a second step straight after gives it away", !g.players[0].hidden && g.players[0].y === 2);
run(g, SHADE_VANISH_MS + 50);
tap(g, 0, "down");
run(g, SHADE_VANISH_MS + 50);
check("waiting again makes the next step quiet too", g.players[0].hidden && g.players[0].y === 3);
requestBomb(g, 0);
step(g, 16);
check("placing a bomb gives it away", !g.players[0].hidden);
g = createGame({ classes: ["shade", "sniper"] });
g.players[0].x = 5; g.players[0].y = 4;
run(g, SHADE_VANISH_MS + 50);
check("a sniper cannot aim at a shade it cannot see", g.players[0].hidden && sniperTargets(g, 1) === null);
g = createGame({ classes: ["shade", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
g.players[1].x = 5; g.players[1].y = 7;
run(g, SHADE_VANISH_MS + 50);
tap(g, 1, "up");
tap(g, 1, "up");
check("walking into a hidden shade is blocked — and reveals it",
  g.players[1].y === 6 && !g.players[0].hidden);
g = createGame({ classes: ["shade", "classic"], mode: "siege" });
g.players.forEach((p) => { p.streak = 0; });
g.players[1].streak = FATALITY_STREAK;
g.players[0].x = 5; g.players[0].y = 5;
g.players[1].x = 6; g.players[1].y = 6;
run(g, SHADE_VANISH_MS + 50);
check("a finishing move needs its target in sight", g.players[0].hidden && fatalityReady(g, 1) === "far");
g = createGame({ classes: ["classic", "classic"] });
run(g, 5000);
check("nobody else ever hides", g.players.every((p) => !p.hidden));

console.log("decoy");
g = createGame({ classes: ["decoy", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
g.players[1].x = 6; g.players[1].y = 9;
requestAbility(g, 0);
step(g, 16);
check("the ability drops a decoy where you stand",
  g.decoys.length === 1 && g.decoys[0].x === 5 && g.decoys[0].y === 5 && g.decoys[0].owner === 0);
tap(g, 0, "left");
check("a step sideways sends it the other way", g.players[0].x === 4 && g.decoys[0].x === 6 && g.decoys[0].y === 5);
tap(g, 0, "down");
check("a step down takes it down too", g.players[0].y === 6 && g.decoys[0].x === 6 && g.decoys[0].y === 6);
tap(g, 1, "up");
tap(g, 1, "up");
tap(g, 1, "up");
check("it blocks the enemy like a real player would", g.players[1].y === 7 && g.decoys[0].y === 6);
requestAbility(g, 0);
step(g, 16);
check("while on cooldown the ability does nothing",
  g.decoys.length === 1 && g.decoys[0].x === 6 && g.events.some((e) => e.type === "abilityRefused"));
run(g, DECOY_MS);
check("the decoy fades after 3 s", g.decoys.length === 0);
run(g, DECOY_COOLDOWN_MS - DECOY_MS);
requestAbility(g, 0);
step(g, 16);
check("…and the cooldown runs out", g.decoys.length === 1);
g.players[0].invulnIn = 999999;
boomAt(g, g.decoys[0].x, g.decoys[0].y, 1);
run(g, 32);
check("fire pops a decoy", g.decoys.length === 0 && g.players[0].alive);
g = createGame({ classes: ["decoy", "sniper"] });
g.players[0].x = 1; g.players[0].y = 1;
g.decoys.push({ x: 6, y: 10, owner: 0, ttl: DECOY_MS });
const aimed = sniperTargets(g, 1) || [];
check("a sniper aims at whichever copy is nearer — even the fake",
  aimed.length > 0 && aimed.every((c) => Math.max(Math.abs(c.x - 6), Math.abs(c.y - 10)) === 1));
g = createGame();
requestAbility(g, 0);
step(g, 16);
check("classes without an ability ignore the key", g.decoys.length === 0);

// --- 2v2 ------------------------------------------------------------------------

console.log("2v2 — the setup");
let t = createGame({ format: "teams" });
check("four players, two teams, top against bottom",
  t.players.length === 4 && t.players.map((p) => p.team).join() === "0,1,0,1" &&
  t.players.every((p) => p.y === (p.team === 0 ? 0 : ROWS - 1)));
check("they start on the four team spawns",
  t.players.every((p) => p.x === TEAM_SPAWNS[p.index].x && p.y === TEAM_SPAWNS[p.index].y));
check("the spawns mirror each other",
  t.players.every((p) => {
    const twin = t.spawns[p.index ^ 1];
    return twin.x === COLS - 1 - p.x && twin.y === ROWS - 1 - p.y;
  }));
check("everyone gets their own colour and a default name",
  new Set(t.players.map((p) => p.color)).size === 4 && t.players.map((p) => p.name).join() === "Player 1,Player 2,Player 3,Player 4");
{
  let clear = true;
  let mirrored = true;
  for (let seed = 1; seed <= 200; seed += 1) {
    const tiles = generateLayout(seed, { format: "teams" });
    for (let i = 0; i < tiles.length; i += 1) {
      const x = i % COLS, y = Math.floor(i / COLS);
      if (TEAM_SPAWNS.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= SPAWN_CLEAR_RADIUS) && tiles[i] !== TILE_FLOOR) clear = false;
      const twin = tiles[tiles.length - 1 - i];
      if ((tiles[i] === TILE_WALL) !== (twin === TILE_WALL) || (tiles[i] > 0) !== (twin > 0)) mirrored = false;
    }
  }
  check("2v2 boards keep all four spawns clear", clear);
  check("…and stay point-symmetric", mirrored);
  const real = dealGame({ format: "teams", seed: 5 });
  check("a 2v2 match deals its board around the team spawns",
    JSON.stringify(real.layout) === JSON.stringify(generateLayout(5, { format: "teams" })));
}

// Knocks one player out with enemy fire (or their own, with owner = index).
function knock(state, index, owner) {
  const victim = state.players[index];
  victim.invulnIn = 0;
  victim.selfShields = 0;
  victim.shields = 0;
  boomAt(state, victim.x, victim.y, owner ?? (index + 1) % state.players.length, 1);
  run(state, 32);
}

console.log("2v2 — rounds");
t = createGame({ format: "teams" });
knock(t, 1, 0);
check("one player down does not end the round", t.phase === "live" && !t.players[1].alive && t.players[3].alive);
check("…and costs no life yet", t.players.every((p) => p.lives === START_LIVES));
check("the knockout is credited", t.kills.length === 1 && t.kills[0].victim === 1 && t.kills[0].by === 0 &&
  t.players[0].stats.kills === 1 && t.players[1].stats.deaths === 1);
knock(t, 3, 2);
check("a team with nobody standing loses the round", t.phase === "roundEnd" && t.history[0] === 0);
check("the whole team loses one life together",
  t.players[1].lives === START_LIVES - 1 && t.players[3].lives === START_LIVES - 1 &&
  t.players[0].lives === START_LIVES && t.players[2].lives === START_LIVES);
check("the winning team shares the streak", t.players[0].streak === 1 && t.players[2].streak === 1 &&
  t.players[1].streak === 0 && t.players[3].streak === 0);
run(t, ROUND_END_MS + 50);
check("the next round brings everyone back to their spawns",
  t.round === 2 && t.players.every((p) => p.alive && p.x === TEAM_SPAWNS[p.index].x && p.y === TEAM_SPAWNS[p.index].y));
t.players.forEach((p) => { p.lives = 1; });
knock(t, 0, 1);
knock(t, 2, 3);
check("a team out of lives loses the match", t.status === "over" && t.winner === 1);

t = createGame({ format: "teams" });
t.players[0].x = 3; t.players[0].y = 8;
t.players[1].x = 3; t.players[1].y = 9;
t.players[2].invulnIn = 0; t.players[3].invulnIn = 0;
knock(t, 2, 1);
knock(t, 3, 0);
t.players.forEach((p) => { p.selfShields = 0; p.invulnIn = 0; });
boomAt(t, 3, 8, 1, 2);
boomAt(t, 3, 9, 0, 2);
run(t, 32);
check("both teams wiped on the same tick is a drawn round",
  t.phase === "roundEnd" && t.history[0] === null && t.players.every((p) => p.lives === START_LIVES - 1));

console.log("2v2 — friendly fire");
t = createGame({ format: "teams" });
t.players[2].x = 5; t.players[2].y = 5;
t.players[2].invulnIn = 0;
boomAt(t, 5, 5, 0, 1);
run(t, 48);
check("a teammate's fire counts as your own: the self shield takes it",
  t.players[2].alive && t.players[2].selfShields === 0);
run(t, ABSORB_GRACE_MS);
boomAt(t, 5, 5, 0, 1);
run(t, 48);
check("…the next one knocks you out", !t.players[2].alive);
check("…and is no kill for your teammate", t.players[0].stats.kills === 0 && t.kills[0].by === 0);
t = createGame({ format: "teams" });
t.players[2].x = 5; t.players[2].y = 5;
t.players[2].invulnIn = 0;
boomAt(t, 5, 5, 0, 1);
boomAt(t, 6, 5, 3, 1);
run(t, 48);
check("enemy fire mixed in is still enemy fire", !t.players[2].alive && t.kills[0].by === 3);

console.log("2v2 — a shared fatality");
t = createGame({ format: "teams", mode: "siege" });
for (let i = 0; i < FATALITY_STREAK; i += 1) {
  knock(t, 1, 0);
  knock(t, 3, 0);
  run(t, ROUND_END_MS + 50);
}
check("four rounds in a row give both teammates a 4 streak", t.players[0].streak === 4 && t.players[2].streak === 4);
t.players[2].x = 5; t.players[2].y = 7;
t.players[3].x = 6; t.players[3].y = 8;
check("either teammate can use it — here the one in reach", fatalityReady(t, 2) === "near" && fatalityReady(t, 0) === "far");
requestFatality(t, 2);
step(t, 16);
check("it ends the match for the whole enemy team",
  t.status === "over" && t.winner === 0 && t.players[1].lives === 0 && t.players[3].lives === 0);
check("…landing on the enemy in reach", t.finish.by === 2 && t.finish.victim === 3 &&
  JSON.stringify(t.finish.victims) === "[1,3]");

console.log("names and colours");
{
  const bell = String.fromCharCode(7);
  const named = createGame({ players: [{ name: "  Lasse" + bell + "   N  ", color: "jade" }, { name: "x".repeat(40), color: "jade" }] });
  check("names are tidied up", named.players[0].name === "Lasse N", JSON.stringify(named.players[0].name));
  check("…and kept short", named.players[1].name.length === NAME_MAX);
  check("a colour someone already has goes to the next free one",
    named.players[0].color === "jade" && named.players[1].color !== "jade" && COLOR_IDS.includes(named.players[1].color));
  const blank = createGame({ players: [{ name: "   ", color: "nope" }] });
  check("a blank name and an unknown colour fall back to the defaults",
    blank.players[0].name === "Player 1" && blank.players[0].color === "ember");
}

console.log("match stats");
g = createGame();
requestBomb(g, 0);
step(g, 16);
check("bombs placed are counted", g.players[0].stats.bombs === 1);
g = createGame();
untouchable(g);
put(g, 8, 8, 21);
boomAt(g, 8, 7, 0, 1);
run(g, 32);
check("broken crates go to whoever's fire broke them", g.players[0].stats.crates === 1 && g.players[1].stats.crates === 0);
g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
boomAt(g, 5, 7, 1, 1);
run(g, 32);
check("enemy fire right beside you is a near miss", g.players[0].stats.nearMisses === 1 && g.players[0].alive);
boomAt(g, 5, 9, 1, 1);
run(g, 32);
check("fire further away is not", g.players[0].stats.nearMisses === 1);
g = createGame();
g.players[0].invulnIn = 0;
boomAt(g, g.players[0].x, g.players[0].y, 0, 1);
run(g, 32);
check("hits a shield took are counted", g.players[0].stats.blocked === 1);
g = createGame({ mode: "siege" });
loseRound(g, 1);
loseRound(g, 1);
loseRound(g, 0, 0);
check("kills, deaths and self-destructs are counted",
  g.players[0].stats.kills === 2 && g.players[1].stats.deaths === 2 &&
  g.players[0].stats.deaths === 1 && g.players[0].stats.selfDestructs === 1);
check("the best streak outlives the streak itself", g.players[0].stats.bestStreak === 2 && g.players[0].streak === 0);

console.log("kill cam");
g = createGame({ killCam: true });
boomAt(g, g.players[1].x, g.players[1].y, 0, 1);
run(g, 32);
check("with the kill cam on, the freeze is long enough for the replay",
  g.phase === "roundEnd" && g.phaseLeft > ROUND_END_MS && g.phaseLeft <= ROUND_END_KILLCAM_MS);
check("the round remembers who got whom, and when",
  g.kills.length === 1 && g.kills[0].victim === 1 && g.kills[0].by === 0 && g.kills[0].at > 0);
g = createGame();
boomAt(g, g.players[1].x, g.players[1].y, 0, 1);
run(g, 32);
check("without it, the freeze stays short", g.phaseLeft <= ROUND_END_MS);
g = createGame({ mode: "siege" });
for (let i = 0; i < FATALITY_STREAK - 1; i += 1) loseRound(g, 1);
g.killCam = true;
g.players[0].x = 5; g.players[0].y = 7;
g.players[1].x = 6; g.players[1].y = 8;
g.players[1].selfShields = 0;
boomAt(g, 6, 8, 0, 1);
run(g, 32);
check("a fatality on offer keeps the freeze short, kill cam or not",
  fatalityReady(g, 0) !== null && g.phaseLeft <= ROUND_END_MS);

// --- throwing ---------------------------------------------------------------------

console.log("throwing bombs");
g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0, { x: 8, y: 5 });
step(g, 16);
check("a bomb lands on the square you aim at", g.bombs[0]?.x === 8 && g.bombs[0]?.y === 5,
  JSON.stringify(g.bombs[0]));
check("…and the throw is announced", g.events.some((e) => e.type === "throw"));

g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0, { x: 11, y: 5 }); // further than classic can throw
step(g, 16);
check("out of range it falls short, at the end of your reach",
  g.bombs[0]?.x === 5 + CLASSES.classic.throwRange, "x=" + g.bombs[0]?.x);

g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
put(g, 6, 5, TILE_WALL);
put(g, 7, 5, 9);
requestBomb(g, 0, { x: 8, y: 5 });
step(g, 16);
check("it arcs over walls and crates", g.bombs[0]?.x === 8 && tileAt(g, 6, 5) === TILE_WALL &&
  tileAt(g, 7, 5) === 9);

g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
put(g, 8, 5, TILE_WALL);
requestBomb(g, 0, { x: 8, y: 5 });
step(g, 16);
check("aiming at a wall leaves it on the last free square on the way", g.bombs[0]?.x === 7, "x=" + g.bombs[0]?.x);

g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
g.players[1].x = 7; g.players[1].y = 5;
requestBomb(g, 0, { x: 7, y: 5 });
step(g, 16);
check("a bomb never lands on someone's head", g.bombs[0]?.x === 6, "x=" + g.bombs[0]?.x);

g = createGame();
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0);
step(g, 16);
check("with no aim it drops at your feet, as it always did", g.bombs[0]?.x === 5 && g.bombs[0]?.y === 5);

g = createGame({ classes: ["line", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0, { x: 1, y: 5 });
step(g, 16);
check("a line bomb is not thrown — the aim turns its lane",
  g.bombs[0]?.x === 5 && g.bombs[0]?.y === 5 && g.bombs[0]?.dir === "left", JSON.stringify(g.bombs[0]));

g = createGame({ classes: ["sniper", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0, { x: 5, y: 11 });
step(g, 16);
check("a sniper puts it exactly where you click", g.bombs[0]?.x === 5 && g.bombs[0]?.y === 11);
g = createGame({ classes: ["sniper", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0, { x: 5, y: 7 }); // 2 squares: inside its minimum range
step(g, 16);
check("…never closer than its minimum range",
  g.bombs.length === 0 && g.events.some((e) => e.type === "bombRefused"));
g = createGame({ classes: ["sniper", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
requestBomb(g, 0, { x: 5, y: 15 }); // 10 squares: past its maximum
step(g, 16);
check("…nor further than its maximum", g.bombs.length === 0);

g = createGame({ classes: ["decoy", "classic"] });
g.players[0].x = 5; g.players[0].y = 5;
requestAbility(g, 0, { x: 7, y: 5 });
step(g, 16);
check("a decoy can be put down at arm's length", g.decoys[0]?.x === 7 && g.decoys[0]?.y === 5);

// --- free-for-all ------------------------------------------------------------------

console.log("free-for-all — the board and the sides");
let r = dealGame({ format: "royale", countdownMs: 0 });
check("six players on a 25x25 board", r.players.length === 6 && r.cols === 25 && r.rows === 25,
  r.players.length + " on " + r.cols + "x" + r.rows);
check("everyone is their own side", r.sides === 6 && r.players.every((p, i) => p.team === i));
check("they start spread around it",
  r.players.every((p, i) => p.x === ROYALE_SPAWNS[i].x && p.y === ROYALE_SPAWNS[i].y));
check("one life each, and a points target to play for",
  r.maxLives === 1 && r.target === ROYALE_POINTS_PER_PLAYER * 5, "target=" + r.target);
r.players[0].streak = 9;
check("no fatality in a free-for-all", r.fatality === false && fatalityReady(r, 0) === null);
{
  const three = dealGame({ format: "royale", players: [{}, {}, {}], countdownMs: 0 });
  check("it can be played by three", three.players.length === 3 && three.spawns.length === 3 &&
    three.target === ROYALE_POINTS_PER_PLAYER * 2);
  let clear = true;
  for (let seed = 1; seed <= 60; seed += 1) {
    const tiles = generateLayout(seed, { format: "royale" });
    for (let i = 0; i < tiles.length; i += 1) {
      const x = i % 25, y = Math.floor(i / 25);
      if (ROYALE_SPAWNS.some((sp) => Math.abs(sp.x - x) + Math.abs(sp.y - y) <= SPAWN_CLEAR_RADIUS) &&
        tiles[i] !== TILE_FLOOR) clear = false;
    }
  }
  check("its boards keep all six spawns clear", clear);
  const turned = generateLayout(3, { format: "royale" });
  const kind = (t) => (t === TILE_WALL ? "wall" : t > 0 ? "crate" : "floor");
  const quarterTurn = turned.every((t, i) => {
    const x = i % 25, y = Math.floor(i / 25);
    return kind(t) === kind(turned[x * 25 + (24 - y)]);
  });
  check("…and look the same after a quarter turn", quarterTurn);
}

console.log("free-for-all — scoring a round");
r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
for (const index of [3, 1, 4, 2, 5]) knock(r, index, (index + 1) % 6);
check("the round ends when one player is left", r.phase === "roundEnd" && r.history[0] === 0);
check("the first one out scores nothing, the last one standing the most",
  r.players[3].score === 0 && r.players[1].score === 1 && r.players[5].score === 4 && r.players[0].score === 5,
  r.players.map((p) => p.score).join());
check("nobody loses a life — a round costs you your place, not a life",
  r.players.every((p) => p.lives === 1));
run(r, ROUND_END_KILLCAM_MS + 100);
check("everyone is back for the next round", r.round === 2 && r.players.every((p) => p.alive));

r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
r.players[0].score = r.target - 5;
for (const index of [1, 2, 3, 4, 5]) knock(r, index, 0);
check("reaching the points target wins the match", r.status === "over" && r.winner === 0,
  "status=" + r.status + " score=" + r.players[0].score);

console.log("free-for-all — the fire wall");
r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
check("it waits before it starts", r.ring.inset === 0 && tileAt(r, 0, 0) === TILE_FLOOR);
run(r, RING_GRACE_MS + 50);
check("then the outermost ring burns", r.ring.inset === 1 && tileAt(r, 0, 0) === TILE_FIRE &&
  tileAt(r, 24, 24) === TILE_FIRE);
check("…and only that ring", tileAt(r, 1, 1) === TILE_FLOOR);
run(r, RING_STEP_MS + 50);
check("…another ring follows", r.ring.inset === 2 && tileAt(r, 1, 1) === TILE_FIRE);

r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
r.players[0].x = 0; r.players[0].y = 0;
r.players[0].selfShields = 1;
r.players[0].shields = 1;
run(r, RING_GRACE_MS + 100);
check("standing in it kills you, shield or not",
  !r.players[0].alive && r.kills.some((k) => k.victim === 0 && k.by === null));

r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
r.players[1].x = 3; r.players[1].y = 3;
run(r, RING_GRACE_MS + 50);
check("walking into it is allowed — it is the standing there that kills", (() => {
  const me = r.players[1];
  me.x = 1; me.y = 3;
  tap(r, 1, "left"); // one step further, into the fire
  return me.x === 0;
})());
check("…and then it takes you", !r.players[1].alive);

r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
r.bombs.push({ x: 0, y: 0, owner: 0, fuse: 999999, fuseMax: 999999, radius: 1, shape: "cross", dir: "down" });
run(r, RING_GRACE_MS + 100);
check("a bomb the fire reaches goes off with it", r.bombs.length === 0 && r.blasts.length > 0);

r = dealGame({ format: "royale", obstacles: false, countdownMs: 0 });
run(r, RING_GRACE_MS + RING_STEP_MS * 3);
const burnt = r.ring.inset;
for (const index of [1, 2, 3, 4, 5]) knock(r, index, 0);
run(r, ROUND_END_KILLCAM_MS + 100);
check("a new round puts the board — and the fire wall — back",
  burnt >= 3 && r.ring.inset === 0 && tileAt(r, 0, 0) === TILE_FLOOR && r.round === 2);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
