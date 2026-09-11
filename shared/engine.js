// Pure game engine: no DOM, no sockets, no timers of its own.
// The caller owns the clock and calls step(state, dtMs).

import {
  COLS,
  ROWS,
  SPAWNS,
  MODES,
  DEFAULT_MODE,
  FATALITY_STREAK,
  FATALITY_RANGE,
  FATALITY_ANYWHERE_STREAK,
  HOLD_DELAY_MS,
  HOLD_REPEAT_MS,
  MOVE_COOLDOWN_MS,
  MOVE_BUFFER_MS,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  COUNTDOWN_MS,
  ROUND_END_MS,
  SELF_SHIELDS,
  ABSORB_GRACE_MS,
  DIRECTIONS,
  CLASSES,
  DEFAULT_CLASS,
  RING_8,
  TILE_FLOOR,
  TILE_WALL,
  SPAWN_CLEAR_RADIUS,
  WALL_PIECES,
  CRATE_PIECES,
  WALL_SHAPES,
  CRATE_SHAPES,
} from "./constants.js";

const DIR_VECTORS = Object.values(DIRECTIONS);

// --- arena layout -------------------------------------------------------------

// Small seeded PRNG, so a layout can be reproduced from its seed.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tileIndex = (x, y) => y * COLS + x;

// The square a cell maps to when the board is rotated 180° about its centre.
function twinOf({ x, y }) {
  return { x: COLS - 1 - x, y: ROWS - 1 - y };
}

function nearSpawn(x, y) {
  return SPAWNS.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= SPAWN_CLEAR_RADIUS);
}

// True while every square that is not a wall can still be reached from the
// first spawn. Crates count as reachable — a bomb opens them.
function wallsLeaveBoardConnected(tiles) {
  const seen = new Uint8Array(COLS * ROWS);
  const start = SPAWNS[0];
  const queue = [start];
  seen[tileIndex(start.x, start.y)] = 1;
  let reached = 1;
  while (queue.length) {
    const { x, y } = queue.pop();
    for (const { dx, dy } of DIR_VECTORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const i = tileIndex(nx, ny);
      if (seen[i] || tiles[i] === TILE_WALL) continue;
      seen[i] = 1;
      reached += 1;
      queue.push({ x: nx, y: ny });
    }
  }
  const open = tiles.reduce((n, t) => (t === TILE_WALL ? n : n + 1), 0);
  return reached === open;
}

// Deals a board: walls first (kept apart and never splitting the board), then
// crates. Pieces are placed in the top half and mirrored into the bottom half.
export function generateLayout(seed) {
  const rng = mulberry32(seed);
  const tiles = new Array(COLS * ROWS).fill(TILE_FLOOR);
  const between = ([lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (shapes) => {
    let roll = rng() * shapes.reduce((n, s) => n + s.weight, 0);
    for (const shape of shapes) {
      roll -= shape.weight;
      if (roll < 0) return shape.cells;
    }
    return shapes[shapes.length - 1].cells;
  };

  // A random spot for `cells` in the top half, plus its mirrored twin — or
  // null if either copy would overlap something or crowd a spawn.
  const propose = (cells) => {
    const w = Math.max(...cells.map(([dx]) => dx)) + 1;
    const h = Math.max(...cells.map(([, dy]) => dy)) + 1;
    const ox = Math.floor(rng() * (COLS - w + 1));
    const oy = Math.floor(rng() * (ROWS / 2 - h + 1));
    const piece = cells.map(([dx, dy]) => ({ x: ox + dx, y: oy + dy }));
    const twin = piece.map(twinOf);
    const all = [...piece, ...twin];
    if (all.some((c) => nearSpawn(c.x, c.y) || tiles[tileIndex(c.x, c.y)] !== TILE_FLOOR)) return null;
    return { piece, twin, all };
  };

  const wallTarget = between(WALL_PIECES);
  for (let placed = 0, tries = 0; placed < wallTarget && tries < 400; tries += 1) {
    const spot = propose(pick(WALL_SHAPES));
    if (!spot) continue;
    // Keep a gap to other walls so they read as separate pieces and cannot
    // close off a pocket together.
    const own = new Set(spot.all.map((c) => tileIndex(c.x, c.y)));
    const crowded = spot.all.some((c) => {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
          const i = tileIndex(nx, ny);
          if (!own.has(i) && tiles[i] === TILE_WALL) return true;
        }
      }
      return false;
    });
    if (crowded) continue;
    for (const c of spot.all) tiles[tileIndex(c.x, c.y)] = TILE_WALL;
    if (!wallsLeaveBoardConnected(tiles)) {
      for (const c of spot.all) tiles[tileIndex(c.x, c.y)] = TILE_FLOOR;
      continue;
    }
    placed += 1;
  }

  const crateTarget = between(CRATE_PIECES);
  let nextCrate = 1;
  for (let placed = 0, tries = 0; placed < crateTarget && tries < 400; tries += 1) {
    const spot = propose(pick(CRATE_SHAPES));
    if (!spot) continue;
    const pieceId = nextCrate;
    const twinId = nextCrate + 1;
    nextCrate += 2;
    for (const c of spot.piece) tiles[tileIndex(c.x, c.y)] = pieceId;
    for (const c of spot.twin) tiles[tileIndex(c.x, c.y)] = twinId;
    placed += 1;
  }

  return tiles;
}

export function tileAt(state, x, y) {
  return state.tiles[tileIndex(x, y)];
}

function isSolid(state, x, y) {
  return tileAt(state, x, y) !== TILE_FLOOR;
}

export function classOf(player) {
  return CLASSES[player.className] || CLASSES[DEFAULT_CLASS];
}

function refillShields(player) {
  player.selfShields = SELF_SHIELDS;
  player.shields = classOf(player).shields;
}

function makePlayer(index, className, lives) {
  const spawn = SPAWNS[index];
  const player = {
    index,
    className: CLASSES[className] ? className : DEFAULT_CLASS,
    x: spawn.x,
    y: spawn.y,
    lives,
    alive: true,
    streak: 0,           // rounds won in a row
    fatalityQueued: false,
    selfShields: 0,      // absorb hits from your own fire only
    shields: 0,          // absorb hits from any fire (class perk)
    pendingMove: null,   // a single buffered press
    pendingTtl: 0,
    held: null,          // direction still held down after the press
    holdTimer: 0,
    bombQueued: false,
    moveCd: 0,
    invulnIn: 0,         // brief untouchable spell after a shield absorbs a hit
    invulnMax: ABSORB_GRACE_MS, // what invulnIn started from, for drawing the ring
  };
  refillShields(player);
  return player;
}

// options.classes — class id per player
// options.mode — "blitz" or "siege" (see MODES); sets the lives
// options.seed — reproduce a specific layout (a random one otherwise)
// options.obstacles — false for an empty board (used by tests)
// options.countdownMs — length of the opening countdown (0 starts live; tests)
export function createGame(options = {}) {
  const classes = options.classes || [];
  const mode = MODES[options.mode] ? options.mode : DEFAULT_MODE;
  const lives = MODES[mode].lives;
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const countdown = options.countdownMs ?? COUNTDOWN_MS;
  const tiles = options.obstacles === false
    ? new Array(COLS * ROWS).fill(TILE_FLOOR)
    : generateLayout(seed);
  return {
    status: "playing",   // "playing" | "over"
    winner: null,        // 0 | 1 | null (null on a draw)
    finish: null,        // { type: "fatality", by, victim, x, y, streak } when it ends in one
    mode,
    maxLives: lives,
    elapsed: 0,
    seed,
    // Rounds: "countdown" before round 1, "live" while playing, "roundEnd"
    // for the freeze after a life is lost. phaseLeft counts the freeze down.
    phase: countdown > 0 ? "countdown" : "live",
    phaseLeft: countdown,
    round: 1,
    liveFor: 0,          // ms since the current round went live
    history: [],         // per finished round: the index of who survived it, null if both fell
    fallen: [],          // who lost a life in the round that just ended
    layout: tiles.slice(), // the match's board as dealt, restored every round
    tiles,
    players: [makePlayer(0, classes[0], lives), makePlayer(1, classes[1], lives)],
    bombs: [],           // { x, y, owner, fuse, radius }
    blasts: [],          // { x, y, ttl, heat: [ms from p0's fire, ms from p1's fire] }
    events: [],          // transient, consumed by the presentation layer
  };
}

// A key went down: step once right away, and start the hold-to-walk timer.
export function requestMove(state, index, dir) {
  const player = state.players[index];
  if (!player || !DIRECTIONS[dir]) return;
  player.pendingMove = dir;
  player.pendingTtl = MOVE_BUFFER_MS;
  player.held = dir;
  player.holdTimer = HOLD_DELAY_MS;
}

// The set of held keys changed without a new press — a key was released, and
// maybe an older one is still down underneath it. `null` means nothing held.
export function setHeld(state, index, dir) {
  const player = state.players[index];
  if (!player) return;
  const next = DIRECTIONS[dir] ? dir : null;
  if (next === player.held) return;
  player.held = next;
  player.holdTimer = HOLD_REPEAT_MS;
}

export function requestBomb(state, index) {
  const player = state.players[index];
  if (!player) return;
  player.bombQueued = true;
}

export function requestFatality(state, index) {
  const player = state.players[index];
  if (!player) return;
  player.fatalityQueued = true;
}

// Whether `index` could finish the match right now:
//   "anywhere" — streak long enough to strike from any distance
//   "near"     — close enough to the opponent for the finishing move
//   "far"      — the streak is there, the distance is not
//   null       — no fatality on offer (short streak, round not live, someone down)
export function fatalityReady(state, index) {
  const player = state.players[index];
  const target = state.players[index === 0 ? 1 : 0];
  if (!player || !target || state.status !== "playing" || state.phase !== "live") return null;
  if (!player.alive || !target.alive || player.streak < FATALITY_STREAK) return null;
  if (player.streak >= FATALITY_ANYWHERE_STREAK) return "anywhere";
  return ringDistance(player, target) <= FATALITY_RANGE ? "near" : "far";
}

function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function bombAt(state, x, y) {
  return state.bombs.find((b) => b.x === x && b.y === y);
}

function liveBombsOf(state, index) {
  return state.bombs.reduce((n, b) => (b.owner === index ? n + 1 : n), 0);
}

function playerAt(state, x, y, exceptIndex) {
  return state.players.some(
    (p) => p.index !== exceptIndex && p.alive && p.x === x && p.y === y,
  );
}

// Distance in "rings" — how many squares apart the two are on the widest axis.
// Matches the 8-square ring a sniper delivers into.
function ringDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// The squares a sniper could drop a bomb into right now, or null when the
// class cannot snipe, the target is down, or the shooter is too close.
export function sniperTargets(state, index) {
  const shooter = state.players[index];
  const target = state.players[index === 0 ? 1 : 0];
  if (!shooter || !target) return null;

  const stats = classOf(shooter);
  if (stats.delivery !== "remote") return null;
  if (!shooter.alive || !target.alive) return null;
  if (ringDistance(shooter, target) < stats.minRange) return null;

  return RING_8
    .map(({ dx, dy }) => ({ x: target.x + dx, y: target.y + dy }))
    .filter((cell) => inBounds(cell.x, cell.y) && !isSolid(state, cell.x, cell.y) &&
      !bombAt(state, cell.x, cell.y));
}

// Fire remembers whose bomb it came from, per owner, so a tile that both
// players' bombs reach counts as enemy fire for as long as the enemy's lasts.
function addBlast(state, x, y, owner) {
  let blast = state.blasts.find((b) => b.x === x && b.y === y);
  if (!blast) {
    blast = { x, y, ttl: 0, heat: [0, 0] };
    state.blasts.push(blast);
  }
  blast.heat[owner] = BLAST_DURATION_MS;
  blast.ttl = BLAST_DURATION_MS;
}

// Detonates `bomb` and anything its fire reaches, chain-reaction style.
// Each bomb uses its own radius and owner, so a Speedy bomb stays small — and
// stays its owner's fire — even when someone else's bomb sets it off.
// Fire stops dead at a wall; at a crate it burns that square, breaks the whole
// crate, and goes no further. Crates only disappear once the chain is done, so
// every arm in the same chain is stopped by them.
function explode(state, bomb) {
  const queue = [bomb];
  const spent = new Set();
  const broken = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (spent.has(current)) continue;
    spent.add(current);

    state.events.push({ type: "explosion", x: current.x, y: current.y, owner: current.owner });
    addBlast(state, current.x, current.y, current.owner);

    for (const { dx, dy } of DIR_VECTORS) {
      for (let r = 1; r <= current.radius; r += 1) {
        const nx = current.x + dx * r;
        const ny = current.y + dy * r;
        if (!inBounds(nx, ny)) break;
        const tile = tileAt(state, nx, ny);
        if (tile === TILE_WALL) break;
        addBlast(state, nx, ny, current.owner);
        if (tile !== TILE_FLOOR) {
          broken.add(tile);
          break;
        }
        const neighbour = bombAt(state, nx, ny);
        if (neighbour && !spent.has(neighbour)) queue.push(neighbour);
      }
    }
  }

  state.bombs = state.bombs.filter((b) => !spent.has(b));

  if (broken.size) {
    for (let i = 0; i < state.tiles.length; i += 1) {
      if (broken.has(state.tiles[i])) state.tiles[i] = TILE_FLOOR;
    }
    state.events.push({ type: "crateBroken", ids: [...broken] });
  }
}

function spawnBomb(state, owner, x, y, radius) {
  state.bombs.push({ x, y, owner: owner.index, fuse: BOMB_FUSE_MS, radius });
  state.events.push({ type: "bomb", x, y, owner: owner.index });
}

function placeBomb(state, player) {
  if (!player.alive) return;
  const stats = classOf(player);
  if (liveBombsOf(state, player.index) >= stats.maxBombs) return;

  if (stats.delivery === "remote") {
    const targets = sniperTargets(state, player.index);
    if (!targets || targets.length === 0) {
      state.events.push({ type: "bombRefused", index: player.index });
      return;
    }
    const cell = targets[Math.floor(Math.random() * targets.length)];
    spawnBomb(state, player, cell.x, cell.y, stats.blastRadius);
    return;
  }

  if (bombAt(state, player.x, player.y)) return;
  spawnBomb(state, player, player.x, player.y, stats.blastRadius);
}

function tryMove(state, player, dir) {
  const vector = DIRECTIONS[dir];
  if (!vector) return false;

  const nx = player.x + vector.dx;
  const ny = player.y + vector.dy;

  if (!inBounds(nx, ny)) return false;
  if (isSolid(state, nx, ny)) return false;
  if (playerAt(state, nx, ny, player.index)) return false;
  // Bombs are solid — you can step off the one you are standing on, not back onto it.
  if (bombAt(state, nx, ny)) return false;

  player.x = nx;
  player.y = ny;
  player.moveCd = MOVE_COOLDOWN_MS;
  state.events.push({ type: "move", index: player.index, x: nx, y: ny });
  return true;
}

function stopMoving(player) {
  player.pendingMove = null;
  player.pendingTtl = 0;
  player.held = null;
  player.holdTimer = 0;
}

function movePlayer(state, player, dt) {
  if (player.held) player.holdTimer -= dt;

  // A fresh press always wins over the hold repeat.
  if (player.pendingMove) {
    if (player.moveCd <= 0) {
      // Consume the press whether or not the step was legal, so walking into
      // a wall does not leave a queued move waiting to fire later.
      tryMove(state, player, player.pendingMove);
      player.pendingMove = null;
      player.pendingTtl = 0;
    } else {
      player.pendingTtl -= dt;
      if (player.pendingTtl <= 0) player.pendingMove = null;
    }
    return;
  }

  if (player.held && player.holdTimer <= 0 && player.moveCd <= 0) {
    tryMove(state, player, player.held);
    player.holdTimer = HOLD_REPEAT_MS;
  }
}

function goLive(state) {
  state.phase = "live";
  state.phaseLeft = 0;
  state.liveFor = 0;
  state.events.push({ type: "go", round: state.round });
}

// Both players back to their spawns on the board as it was dealt, with
// nothing left burning or ticking. A key still held down keeps counting as
// held, so you can lean into your first move.
function startNextRound(state) {
  state.round += 1;
  state.tiles = state.layout.slice();
  state.bombs = [];
  state.blasts = [];
  state.fallen = [];
  for (const player of state.players) {
    const spawn = SPAWNS[player.index];
    player.x = spawn.x;
    player.y = spawn.y;
    player.alive = true;
    player.moveCd = 0;
    player.pendingMove = null;
    player.pendingTtl = 0;
    player.bombQueued = false;
    player.invulnIn = 0;
    refillShields(player);
  }
  state.events.push({ type: "round", round: state.round });
  goLive(state);
}

// Presses made while the round is not live are dropped, not saved for later.
function dropPresses(state) {
  for (const player of state.players) {
    player.pendingMove = null;
    player.pendingTtl = 0;
    player.bombQueued = false;
    player.fatalityQueued = false;
  }
}

// The match ends on the spot in the executor's favour.
function performFatality(state, player) {
  const victim = state.players[player.index === 0 ? 1 : 0];
  state.finish = {
    type: "fatality",
    by: player.index,
    victim: victim.index,
    x: victim.x,
    y: victim.y,
    streak: player.streak,
  };
  victim.lives = 0;
  victim.alive = false;
  state.status = "over";
  state.winner = player.index;
  state.events.push({ type: "fatality", ...state.finish });
}

function coolFire(state, dt) {
  for (const blast of state.blasts) {
    blast.ttl -= dt;
    blast.heat[0] = Math.max(0, blast.heat[0] - dt);
    blast.heat[1] = Math.max(0, blast.heat[1] - dt);
  }
  state.blasts = state.blasts.filter((blast) => blast.ttl > 0);
}

function loseLife(state, player) {
  player.lives -= 1;
  player.alive = false;
  stopMoving(player);
  state.fallen.push(player.index);
  state.events.push({ type: "hit", index: player.index, x: player.x, y: player.y });
}

// A hit lands. Own fire spends the self shield first, then class shields;
// enemy fire can only be stopped by class shields. Anything left costs a life.
function takeHit(state, player, ownFire) {
  let absorbedBy = null;
  if (ownFire && player.selfShields > 0) {
    player.selfShields -= 1;
    absorbedBy = "self";
  } else if (player.shields > 0) {
    player.shields -= 1;
    absorbedBy = "armor";
  }

  if (!absorbedBy) {
    loseLife(state, player);
    return;
  }

  player.invulnIn = ABSORB_GRACE_MS;
  player.invulnMax = ABSORB_GRACE_MS;
  state.events.push({ type: "absorb", index: player.index, by: absorbedBy, x: player.x, y: player.y });
}

export function step(state, dt) {
  state.events = [];
  if (state.status === "over") return state;

  state.elapsed += dt;

  // Before round 1: everyone waits on their spawn for the countdown.
  if (state.phase === "countdown") {
    dropPresses(state);
    state.phaseLeft -= dt;
    if (state.phaseLeft <= 0) goLive(state);
    return state;
  }

  // After a life is lost: the board freezes — no moves, no fuses, no damage —
  // while the last blast fades out, then the next round starts.
  if (state.phase === "roundEnd") {
    dropPresses(state);
    coolFire(state, dt);
    state.phaseLeft -= dt;
    if (state.phaseLeft <= 0) startNextRound(state);
    return state;
  }

  state.liveFor += dt;

  // 0. A fatality, if one was called and is on offer, ends everything at once.
  //    Called when it is not on offer, the press simply does nothing.
  for (const player of state.players) {
    if (!player.fatalityQueued) continue;
    player.fatalityQueued = false;
    const offer = fatalityReady(state, player.index);
    if (offer === "near" || offer === "anywhere") {
      performFatality(state, player);
      return state;
    }
  }

  // 1. Players act.
  for (const player of state.players) {
    if (!player.alive) {
      player.bombQueued = false;
      continue;
    }

    player.moveCd = Math.max(0, player.moveCd - dt);
    player.invulnIn = Math.max(0, player.invulnIn - dt);

    if (player.bombQueued) {
      placeBomb(state, player);
      player.bombQueued = false;
    }

    movePlayer(state, player, dt);
  }

  // 2. Fuses burn down. Collect first, then explode, so chains see a stable list.
  const due = state.bombs.filter((bomb) => {
    bomb.fuse -= dt;
    return bomb.fuse <= 0;
  });
  for (const bomb of due) {
    if (state.bombs.includes(bomb)) explode(state, bomb);
  }

  // 3. Fire cools.
  coolFire(state, dt);

  // 4. Anyone standing in fire takes the hit. It only counts as your own fire
  //    if none of the opponent's is burning on that tile.
  for (const player of state.players) {
    if (!player.alive || player.invulnIn > 0) continue;
    const blast = state.blasts.find((b) => b.x === player.x && b.y === player.y);
    if (!blast) continue;
    const enemyFire = blast.heat[player.index === 0 ? 1 : 0] > 0;
    takeHit(state, player, !enemyFire);
  }

  // 5. A lost life ends the round. Both falling on the same tick is a drawn
  //    round; running out of lives ends the match (a draw if both do).
  if (state.fallen.length) {
    const survivor = state.fallen.length === 2 ? null : state.fallen[0] === 0 ? 1 : 0;
    state.history.push(survivor);
    // Streaks: the survivor adds one, however the other fell; the fallen reset.
    for (const player of state.players) {
      player.streak = player.index === survivor ? player.streak + 1 : 0;
    }

    const out = state.players.filter((p) => p.lives <= 0);
    if (out.length === 2) {
      state.status = "over";
      state.winner = null;
    } else if (out.length === 1) {
      state.status = "over";
      state.winner = out[0].index === 0 ? 1 : 0;
    } else {
      state.phase = "roundEnd";
      state.phaseLeft = ROUND_END_MS;
      state.events.push({ type: "roundEnd", round: state.round, fallen: state.fallen.slice() });
    }
  }

  return state;
}
