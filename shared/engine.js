// Pure game engine: no DOM, no sockets, no timers of its own.
// The caller owns the clock and calls step(state, dtMs).

import {
  COLS,
  ROWS,
  SPAWNS,
  FORMATS,
  DEFAULT_FORMAT,
  teamOfIndex,
  COLOR_IDS,
  DEFAULT_COLORS,
  cleanName,
  defaultName,
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
  ROUND_END_KILLCAM_MS,
  SELF_SHIELDS,
  ABSORB_GRACE_MS,
  SHADE_VANISH_MS,
  DECOY_MS,
  DECOY_COOLDOWN_MS,
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
const DIAGONALS = [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }];
// A decoy takes the same step up or down as its owner, the opposite one sideways.
const MIRROR = { up: "up", down: "down", left: "right", right: "left" };
const TEAMS = [0, 1];

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

// True while every square that is not a wall can still be reached from the
// first spawn. Crates count as reachable — a bomb opens them.
function wallsLeaveBoardConnected(tiles, start) {
  const seen = new Uint8Array(COLS * ROWS);
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
// The squares around every spawn in `spawns` stay clear.
export function generateLayout(seed, spawns = SPAWNS) {
  const rng = mulberry32(seed);
  const tiles = new Array(COLS * ROWS).fill(TILE_FLOOR);
  const nearSpawn = (x, y) =>
    spawns.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= SPAWN_CLEAR_RADIUS);
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
    if (!wallsLeaveBoardConnected(tiles, spawns[0])) {
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

// Lives and streaks belong to a team; every member carries the team's count,
// kept equal by the engine. In 1v1 a team is just one player.
export function livesOf(state, team) {
  const member = state.players.find((p) => p.team === team);
  return member ? member.lives : 0;
}

function refillShields(player) {
  player.selfShields = SELF_SHIELDS;
  player.shields = classOf(player).shields;
}

const facingFrom = (spawn) => (spawn.y === 0 ? "down" : "up");

function freshStats() {
  return {
    bombs: 0,         // bombs placed
    crates: 0,        // crates broken by your fire
    kills: 0,         // enemies knocked out by your fire
    deaths: 0,        // times you were knocked out
    selfDestructs: 0, // …by your own fire
    blocked: 0,       // hits a shield took for you
    nearMisses: 0,    // enemy fire right beside you that did not touch you
    bestStreak: 0,    // longest run of rounds your team won
    fatalities: 0,
  };
}

function makePlayer(index, spec, lives, spawn) {
  const player = {
    index,
    team: teamOfIndex(index),
    name: cleanName(spec.name) || defaultName(index),
    color: COLOR_IDS.includes(spec.color) ? spec.color : DEFAULT_COLORS[index],
    className: CLASSES[spec.className] ? spec.className : DEFAULT_CLASS,
    x: spawn.x,
    y: spawn.y,
    facing: facingFrom(spawn), // last direction walked (or tried) — aims a Line bomb
    lives,
    alive: true,
    streak: 0,           // rounds your team won in a row
    fatalityQueued: false,
    selfShields: 0,      // absorb hits from your own (or a teammate's) fire only
    shields: 0,          // absorb hits from any fire (class perk)
    pendingMove: null,   // a single buffered press
    pendingTtl: 0,
    held: null,          // direction still held down after the press
    holdTimer: 0,
    bombQueued: false,
    abilityQueued: false,
    abilityCd: 0,        // ms until the class ability can be used again
    moveCd: 0,
    invulnIn: 0,         // brief untouchable spell after a shield absorbs a hit
    invulnMax: ABSORB_GRACE_MS, // what invulnIn started from, for drawing the ring
    hidden: false,       // a Shade out of the other team's sight
    still: 0,            // ms since you last moved, bombed or were hit
    stats: freshStats(),
  };
  refillShields(player);
  return player;
}

// options.format — "duel" (1v1, the default) or "teams" (2v2)
// options.players — per player { className, name, color }
// options.classes — class id per player (shorthand when only classes matter)
// options.mode — "blitz" or "siege" (see MODES); sets the lives
// options.killCam — lengthen the freeze after a round for the kill cam replay
// options.seed — reproduce a specific layout (a random one otherwise)
// options.obstacles — false for an empty board (used by tests)
// options.countdownMs — length of the opening countdown (0 starts live; tests)
export function createGame(options = {}) {
  const format = FORMATS[options.format] ? options.format : DEFAULT_FORMAT;
  const { players: count, spawns } = FORMATS[format];
  const mode = MODES[options.mode] ? options.mode : DEFAULT_MODE;
  const lives = MODES[mode].lives;
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const countdown = options.countdownMs ?? COUNTDOWN_MS;
  const tiles = options.obstacles === false
    ? new Array(COLS * ROWS).fill(TILE_FLOOR)
    : generateLayout(seed, spawns);

  // Nobody shares a colour: a taken one falls back to the first free one.
  const taken = new Set();
  const players = Array.from({ length: count }, (_, i) => {
    const spec = { className: options.classes?.[i], ...(options.players?.[i] || {}) };
    const player = makePlayer(i, spec, lives, spawns[i]);
    if (taken.has(player.color)) player.color = COLOR_IDS.find((c) => !taken.has(c));
    taken.add(player.color);
    return player;
  });

  return {
    status: "playing",   // "playing" | "over"
    winner: null,        // the winning team, 0 | 1, or null on a draw
    finish: null,        // { type: "fatality", by, victim, victims, x, y, streak } when it ends in one
    pendingWinner: null, // set while a match-winning kill holds the freeze open for a finish
    format,
    mode,
    maxLives: lives,
    killCam: Boolean(options.killCam),
    elapsed: 0,
    seed,
    // Rounds: "countdown" before round 1, "live" while playing, "roundEnd"
    // for the freeze after a team is wiped out. phaseLeft counts it down.
    phase: countdown > 0 ? "countdown" : "live",
    phaseLeft: countdown,
    round: 1,
    liveFor: 0,          // ms since the current round went live
    history: [],         // per finished round: the team that took it, null if both fell
    fallen: [],          // who went down in the current round, in order
    kills: [],           // this round's knockouts: { victim, by, x, y, at }
    layout: tiles.slice(), // the match's board as dealt, restored every round
    tiles,
    spawns: spawns.map((s) => ({ ...s })),
    players,
    bombs: [],           // { x, y, owner, fuse, fuseMax, radius, shape, dir }
    blasts: [],          // { x, y, ttl, core, heat: [ms of fire left, per player] }
    decoys: [],          // { x, y, owner, ttl }
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

// The class ability (Decoy). Does nothing for classes without one.
export function requestAbility(state, index) {
  const player = state.players[index];
  if (!player) return;
  player.abilityQueued = true;
}

// After a pause — an online player dropped and came back — a live round picks
// up with the same 3-2-1 as a match start, so nobody walks back into a blast
// cold. Fuses and fire stay frozen during it, exactly as they were.
export function resumeWithCountdown(state) {
  if (state.status !== "playing" || state.phase !== "live") return;
  state.phase = "countdown";
  state.phaseLeft = COUNTDOWN_MS;
}

export function requestFatality(state, index) {
  const player = state.players[index];
  if (!player) return;
  player.fatalityQueued = true;
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

function playerOn(state, x, y, except) {
  return state.players.find((p) => p !== except && p.alive && p.x === x && p.y === y);
}

// Distance in "rings" — how many squares apart the two are on the widest axis.
// Matches the 8-square ring a sniper delivers into.
function ringDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const inReach = (a, b) => ringDistance(a, b) <= FATALITY_RANGE;

// Whether `index` could finish the match right now:
//   "anywhere" — streak long enough to strike from any distance
//   "near"     — close enough to an enemy in sight for the finishing move
//   "far"      — the streak is there, the distance is not (live rounds only)
//   null       — no fatality on offer
//
// It is on offer in a live round, and also during the freeze right after your
// team takes the round — measured to where the enemies fell. That way a bomb
// that beats your X by a split second does not cost you the fatality.
export function fatalityReady(state, index) {
  const player = state.players[index];
  if (!player || state.status !== "playing") return null;
  if (!player.alive || player.streak < FATALITY_STREAK) return null;
  const enemies = state.players.filter((p) => p.team !== player.team);
  const anywhere = player.streak >= FATALITY_ANYWHERE_STREAK;
  if (state.phase === "live") {
    const standing = enemies.filter((e) => e.alive);
    if (!standing.length) return null;
    if (anywhere) return "anywhere";
    return standing.some((e) => !e.hidden && inReach(player, e)) ? "near" : "far";
  }
  if (state.phase === "roundEnd" && state.history[state.history.length - 1] === player.team) {
    if (anywhere) return "anywhere";
    return enemies.some((e) => inReach(player, e)) ? "near" : null; // nobody moves in the freeze
  }
  return null;
}

// The freeze-time rule above, for a whole team: can any of them finish it?
function canFinish(state, team) {
  return state.players.some((p) => p.team === team && p.alive && p.streak >= FATALITY_STREAK &&
    (p.streak >= FATALITY_ANYWHERE_STREAK ||
      state.players.some((e) => e.team !== team && inReach(p, e))));
}

// What a sniper would aim at: the nearest enemy in sight — or enemy decoy,
// which a sniper cannot tell apart — that is at least minRange away.
function sniperMark(state, shooter, minRange) {
  let mark = null;
  let best = Infinity;
  const consider = (target) => {
    const d = ringDistance(shooter, target);
    if (d >= minRange && d < best) {
      mark = target;
      best = d;
    }
  };
  for (const decoy of state.decoys) if (teamOfIndex(decoy.owner) !== shooter.team) consider(decoy);
  for (const p of state.players) if (p.team !== shooter.team && p.alive && !p.hidden) consider(p);
  return mark;
}

// The squares a sniper could drop a bomb into right now, or null when the
// class cannot snipe, nobody is in sight, or everyone is too close.
export function sniperTargets(state, index) {
  const shooter = state.players[index];
  if (!shooter) return null;

  const stats = classOf(shooter);
  if (stats.delivery !== "remote" || !shooter.alive) return null;
  const mark = sniperMark(state, shooter, stats.minRange);
  if (!mark) return null;

  return RING_8
    .map(({ dx, dy }) => ({ x: mark.x + dx, y: mark.y + dy }))
    .filter((cell) => inBounds(cell.x, cell.y) && !isSolid(state, cell.x, cell.y) &&
      !bombAt(state, cell.x, cell.y));
}

// Fire remembers whose bomb it came from, per player, so a tile that several
// bombs reach counts as enemy fire for as long as any enemy's lasts. `core`
// marks the square a bomb went off on.
function addBlast(state, x, y, owner, core = false) {
  let blast = state.blasts.find((b) => b.x === x && b.y === y);
  if (!blast) {
    blast = { x, y, ttl: 0, core: false, heat: state.players.map(() => 0) };
    state.blasts.push(blast);
  }
  blast.heat[owner] = BLAST_DURATION_MS;
  blast.ttl = BLAST_DURATION_MS;
  if (core) blast.core = true;
}

// The arms of fire a bomb sends out: a cross by default, the four diagonals
// for an "x", or one arm the way its owner faced for a "line".
function armsOf(bomb) {
  if (bomb.shape === "x") return DIAGONALS;
  if (bomb.shape === "line") return [DIRECTIONS[bomb.dir] || DIRECTIONS.down];
  return DIR_VECTORS;
}

// Detonates `bomb` and anything its fire reaches, chain-reaction style, and
// returns every square it burned with whose fire it was.
// Each bomb uses its own shape, radius and owner, so a Speedy bomb stays small
// — and stays its owner's fire — even when someone else's bomb sets it off.
// Fire stops dead at a wall; at a crate it burns that square, breaks the whole
// crate, and goes no further. Crates only disappear once the chain is done, so
// every arm in the same chain is stopped by them.
function explode(state, bomb) {
  const queue = [bomb];
  const spent = new Set();
  const broken = new Map(); // crate id -> whose fire broke it first
  const burned = [];

  while (queue.length) {
    const current = queue.shift();
    if (spent.has(current)) continue;
    spent.add(current);

    state.events.push({ type: "explosion", x: current.x, y: current.y, owner: current.owner });
    addBlast(state, current.x, current.y, current.owner, true);
    burned.push({ x: current.x, y: current.y, owner: current.owner });

    for (const { dx, dy } of armsOf(current)) {
      for (let r = 1; r <= current.radius; r += 1) {
        const nx = current.x + dx * r;
        const ny = current.y + dy * r;
        if (!inBounds(nx, ny)) break;
        const tile = tileAt(state, nx, ny);
        if (tile === TILE_WALL) break;
        addBlast(state, nx, ny, current.owner);
        burned.push({ x: nx, y: ny, owner: current.owner });
        if (tile !== TILE_FLOOR) {
          if (!broken.has(tile)) broken.set(tile, current.owner);
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
    for (const owner of broken.values()) {
      if (state.players[owner]) state.players[owner].stats.crates += 1;
    }
    state.events.push({ type: "crateBroken", ids: [...broken.keys()] });
  }
  return burned;
}

// A Shade stepping back into sight. Anything that gives you away also restarts
// the stillness clock.
function reveal(state, player) {
  player.still = 0;
  if (!player.hidden) return;
  player.hidden = false;
  state.events.push({ type: "revealed", index: player.index, x: player.x, y: player.y });
}

function spawnBomb(state, owner, x, y, stats) {
  const fuse = stats.fuseMs || BOMB_FUSE_MS;
  state.bombs.push({
    x,
    y,
    owner: owner.index,
    fuse,
    fuseMax: fuse,
    radius: stats.blastRadius,
    shape: stats.pattern || "cross",
    dir: owner.facing,
  });
  owner.stats.bombs += 1;
  reveal(state, owner);
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
    spawnBomb(state, player, cell.x, cell.y, stats);
    return;
  }

  if (bombAt(state, player.x, player.y)) return;
  spawnBomb(state, player, player.x, player.y, stats);
}

function useAbility(state, player) {
  if (classOf(player).ability !== "decoy") return;
  if (player.abilityCd > 0) {
    state.events.push({ type: "abilityRefused", index: player.index });
    return;
  }
  state.decoys = state.decoys.filter((d) => d.owner !== player.index);
  state.decoys.push({ x: player.x, y: player.y, owner: player.index, ttl: DECOY_MS });
  player.abilityCd = DECOY_COOLDOWN_MS;
  state.events.push({ type: "decoy", index: player.index, x: player.x, y: player.y });
}

// A decoy's step: blocked by what blocks a player — except its own owner,
// whom it may overlap (that is how it starts out).
function moveDecoy(state, decoy, dir) {
  const { dx, dy } = DIRECTIONS[dir];
  const nx = decoy.x + dx;
  const ny = decoy.y + dy;
  if (!inBounds(nx, ny) || isSolid(state, nx, ny) || bombAt(state, nx, ny)) return;
  if (state.players.some((p) => p.alive && p.index !== decoy.owner && p.x === nx && p.y === ny)) return;
  if (state.decoys.some((d) => d !== decoy && d.x === nx && d.y === ny)) return;
  decoy.x = nx;
  decoy.y = ny;
}

function tryMove(state, player, dir) {
  const vector = DIRECTIONS[dir];
  if (!vector) return false;
  player.facing = dir; // even into a wall: that is how a Line turns on the spot

  const nx = player.x + vector.dx;
  const ny = player.y + vector.dy;

  if (!inBounds(nx, ny)) return false;
  if (isSolid(state, nx, ny)) return false;
  const blocker = playerOn(state, nx, ny, player);
  if (blocker) {
    // Walking into a Shade you could not see gives it away.
    if (blocker.hidden && blocker.team !== player.team) reveal(state, blocker);
    return false;
  }
  // Someone else's decoy blocks like the player it pretends to be.
  if (state.decoys.some((d) => d.owner !== player.index && d.x === nx && d.y === ny)) return false;
  // Bombs are solid — you can step off the one you are standing on, not back onto it.
  if (bombAt(state, nx, ny)) return false;

  player.x = nx;
  player.y = ny;
  player.moveCd = MOVE_COOLDOWN_MS;
  state.events.push({ type: "move", index: player.index, x: nx, y: ny });

  // Hidden, a step taken after a full stillness is quiet; the next one is not.
  if (player.hidden && player.still < SHADE_VANISH_MS) reveal(state, player);
  player.still = 0;
  for (const decoy of state.decoys) {
    if (decoy.owner === player.index) moveDecoy(state, decoy, MIRROR[dir]);
  }
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

// Everyone back to their spawns on the board as it was dealt, with nothing
// left burning, ticking or pretending. A key still held down keeps counting
// as held, so you can lean into your first move.
function startNextRound(state) {
  state.round += 1;
  state.tiles = state.layout.slice();
  state.bombs = [];
  state.blasts = [];
  state.decoys = [];
  state.fallen = [];
  state.kills = [];
  for (const player of state.players) {
    const spawn = state.spawns[player.index];
    player.x = spawn.x;
    player.y = spawn.y;
    player.facing = facingFrom(spawn);
    player.alive = true;
    player.moveCd = 0;
    player.pendingMove = null;
    player.pendingTtl = 0;
    player.bombQueued = false;
    player.abilityQueued = false;
    player.abilityCd = 0;
    player.invulnIn = 0;
    player.hidden = false;
    player.still = 0;
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
    player.abilityQueued = false;
    player.fatalityQueued = false;
  }
}

// Acts on any fatality press that is on offer; returns true if the match ended.
// A press that is not on offer simply does nothing.
function resolveFatalityPresses(state) {
  for (const player of state.players) {
    if (!player.fatalityQueued) continue;
    player.fatalityQueued = false;
    const offer = fatalityReady(state, player.index);
    if (offer === "near" || offer === "anywhere") {
      performFatality(state, player);
      return true;
    }
  }
  return false;
}

// The match ends on the spot in the executor's favour: the whole enemy team
// is out. The finishing move lands on the nearest enemy it could reach.
function performFatality(state, player) {
  const enemies = state.players.filter((p) => p.team !== player.team);
  const standing = enemies.filter((e) => e.alive);
  const inSight = standing.filter((e) => !e.hidden && inReach(player, e));
  const pool = inSight.length ? inSight : standing.length ? standing : enemies;
  const victim = pool.reduce((a, b) => (ringDistance(player, b) < ringDistance(player, a) ? b : a));
  state.finish = {
    type: "fatality",
    by: player.index,
    victim: victim.index,
    victims: enemies.map((e) => e.index),
    x: victim.x,
    y: victim.y,
    streak: player.streak,
  };
  for (const enemy of enemies) {
    enemy.lives = 0;
    enemy.alive = false;
    enemy.hidden = false;
  }
  state.decoys = [];
  player.stats.fatalities += 1;
  state.status = "over";
  state.winner = player.team;
  state.pendingWinner = null;
  state.events.push({ type: "fatality", ...state.finish });
}

function coolFire(state, dt) {
  for (const blast of state.blasts) {
    blast.ttl -= dt;
    for (let i = 0; i < blast.heat.length; i += 1) blast.heat[i] = Math.max(0, blast.heat[i] - dt);
  }
  state.blasts = state.blasts.filter((blast) => blast.ttl > 0);
}

// Out for the rest of the round. Lives are settled when the round ends.
function knockOut(state, player, by) {
  player.alive = false;
  player.hidden = false;
  stopMoving(player);
  state.decoys = state.decoys.filter((d) => d.owner !== player.index);
  player.stats.deaths += 1;
  if (by === player.index) player.stats.selfDestructs += 1;
  else if (state.players[by] && state.players[by].team !== player.team) state.players[by].stats.kills += 1;
  state.fallen.push(player.index);
  state.kills.push({ victim: player.index, by, x: player.x, y: player.y, at: state.elapsed });
  state.events.push({ type: "hit", index: player.index, x: player.x, y: player.y, by });
}

// A hit lands. Enemy fire — any enemy's fire on the tile — can only be stopped
// by class shields. Otherwise it is your own fire (a teammate's counts as your
// own), which spends the self shield first. Anything left knocks you out.
function takeHit(state, player, blast) {
  let by = null;
  let hottest = 0;
  blast.heat.forEach((heat, owner) => {
    if (heat > hottest && teamOfIndex(owner) !== player.team) {
      hottest = heat;
      by = owner;
    }
  });
  const enemyFire = by !== null;
  if (!enemyFire) by = blast.heat[player.index] > 0 ? player.index : blast.heat.findIndex((h) => h > 0);

  let absorbedBy = null;
  if (!enemyFire && player.selfShields > 0) {
    player.selfShields -= 1;
    absorbedBy = "self";
  } else if (player.shields > 0) {
    player.shields -= 1;
    absorbedBy = "armor";
  }

  if (!absorbedBy) {
    knockOut(state, player, by);
    return;
  }

  player.stats.blocked += 1;
  player.invulnIn = ABSORB_GRACE_MS;
  player.invulnMax = ABSORB_GRACE_MS;
  reveal(state, player);
  state.events.push({ type: "absorb", index: player.index, by: absorbedBy, x: player.x, y: player.y });
}

// A team with nobody left standing loses the round — both at once is a draw.
// The losers lose a life; the winners' streak grows, everyone else's resets.
// Running out of lives ends the match (a draw if both teams do).
function endRound(state, wiped) {
  const winner = wiped.length === 2 ? null : 1 - wiped[0];
  state.history.push(winner);
  for (const player of state.players) {
    if (wiped.includes(player.team)) player.lives -= 1;
    player.streak = player.team === winner ? player.streak + 1 : 0;
    player.stats.bestStreak = Math.max(player.stats.bestStreak, player.streak);
  }
  state.decoys = [];

  const out = TEAMS.filter((team) => livesOf(state, team) <= 0);
  if (out.length === 2) {
    state.status = "over";
    state.winner = null;
    return;
  }
  const finishable = winner !== null && canFinish(state, winner);
  if (out.length === 1 && !finishable) {
    state.status = "over";
    state.winner = winner;
    return;
  }
  // Match point with a fatality on offer holds the freeze open so the winner
  // can still finish them; otherwise it is the break before the next round.
  state.phase = "roundEnd";
  state.phaseLeft = state.killCam && !finishable ? ROUND_END_KILLCAM_MS : ROUND_END_MS;
  if (out.length === 1) state.pendingWinner = winner;
  state.events.push({ type: "roundEnd", round: state.round, fallen: state.fallen.slice(), winner });
}

// What one seat may see. Hidden enemies lose their position, and anything that
// would give it away; everyone else is shown as they are.
export function viewFor(state, viewer) {
  const team = state.players[viewer] ? state.players[viewer].team : -1;
  const masked = new Set(state.players.filter((p) => p.hidden && p.team !== team).map((p) => p.index));
  if (!masked.size) return state;
  return {
    ...state,
    players: state.players.map((p) => (masked.has(p.index)
      ? { ...p, x: null, y: null, facing: null, held: null, pendingMove: null, still: 0 }
      : p)),
    events: state.events.filter((e) => !(e.type === "move" && masked.has(e.index))),
  };
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

  // After a round: the board freezes — no moves, no fuses, no damage — while
  // the last blast fades out, then the next round starts. The one thing that
  // still works is finishing the team that just fell with a fatality.
  if (state.phase === "roundEnd") {
    if (resolveFatalityPresses(state)) return state;
    dropPresses(state);
    coolFire(state, dt);
    state.phaseLeft -= dt;
    if (state.phaseLeft <= 0) {
      if (state.pendingWinner !== null) {
        // The match-winning kill stands as it was: no fatality came.
        state.status = "over";
        state.winner = state.pendingWinner;
        state.pendingWinner = null;
      } else {
        startNextRound(state);
      }
    }
    return state;
  }

  state.liveFor += dt;

  // 0. A fatality, if one was called and is on offer, ends everything at once.
  if (resolveFatalityPresses(state)) return state;

  // 1. Players act.
  for (const player of state.players) {
    if (!player.alive) {
      player.bombQueued = false;
      player.abilityQueued = false;
      continue;
    }

    player.moveCd = Math.max(0, player.moveCd - dt);
    player.invulnIn = Math.max(0, player.invulnIn - dt);
    player.abilityCd = Math.max(0, player.abilityCd - dt);

    if (player.abilityQueued) {
      useAbility(state, player);
      player.abilityQueued = false;
    }
    if (player.bombQueued) {
      placeBomb(state, player);
      player.bombQueued = false;
    }

    movePlayer(state, player, dt);
  }

  // 2. Decoys fade.
  for (const decoy of state.decoys) decoy.ttl -= dt;
  state.decoys = state.decoys.filter((d) => d.ttl > 0);

  // 3. Fuses burn down. Collect first, then explode, so chains see a stable list.
  const due = state.bombs.filter((bomb) => {
    bomb.fuse -= dt;
    return bomb.fuse <= 0;
  });
  const burned = [];
  for (const bomb of due) {
    if (state.bombs.includes(bomb)) burned.push(...explode(state, bomb));
  }

  // 4. Fire cools.
  coolFire(state, dt);

  // 5. Anyone standing in fire takes the hit; decoys in fire pop.
  for (const player of state.players) {
    if (!player.alive || player.invulnIn > 0) continue;
    const blast = state.blasts.find((b) => b.x === player.x && b.y === player.y);
    if (blast) takeHit(state, player, blast);
  }
  const popped = state.decoys.filter((d) => state.blasts.some((b) => b.x === d.x && b.y === d.y));
  if (popped.length) {
    state.decoys = state.decoys.filter((d) => !popped.includes(d));
    for (const d of popped) state.events.push({ type: "decoyPopped", owner: d.owner, x: d.x, y: d.y });
  }

  // 6. Near misses: fresh enemy fire on a square touching yours, none on yours.
  if (burned.length) {
    for (const player of state.players) {
      if (!player.alive) continue;
      const onMe = burned.some((f) => f.x === player.x && f.y === player.y);
      const close = burned.some((f) => teamOfIndex(f.owner) !== player.team && ringDistance(f, player) === 1);
      if (close && !onMe) player.stats.nearMisses += 1;
    }
  }

  // 7. A Shade that has stood still long enough fades from the enemy's sight.
  for (const player of state.players) {
    if (!player.alive || !classOf(player).stealth) continue;
    player.still += dt;
    if (!player.hidden && player.still >= SHADE_VANISH_MS) {
      player.hidden = true;
      state.events.push({ type: "vanished", index: player.index, x: player.x, y: player.y });
    }
  }

  // 8. A team with nobody standing ends the round.
  const wiped = TEAMS.filter((team) => !state.players.some((p) => p.team === team && p.alive));
  if (wiped.length) endRound(state, wiped);

  return state;
}
