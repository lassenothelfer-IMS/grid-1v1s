// Pure game engine: no DOM, no sockets, no timers of its own.
// The caller owns the clock and calls step(state, dtMs).

import {
  COLS,
  ROWS,
  SPAWNS,
  START_LIVES,
  MOVE_COOLDOWN_MS,
  MOVE_BUFFER_MS,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  RESPAWN_DELAY_MS,
  INVULN_MS,
  DIRECTIONS,
  CLASSES,
  DEFAULT_CLASS,
  RING_8,
} from "./constants.js";

const DIR_VECTORS = Object.values(DIRECTIONS);

export function classOf(player) {
  return CLASSES[player.className] || CLASSES[DEFAULT_CLASS];
}

function makePlayer(index, className) {
  const spawn = SPAWNS[index];
  return {
    index,
    className: CLASSES[className] ? className : DEFAULT_CLASS,
    x: spawn.x,
    y: spawn.y,
    lives: START_LIVES,
    alive: true,
    pendingMove: null,   // a single buffered step, not a held direction
    pendingTtl: 0,
    bombQueued: false,
    moveCd: 0,
    respawnIn: 0,
    invulnIn: INVULN_MS,
  };
}

export function createGame(options = {}) {
  const classes = options.classes || [];
  return {
    status: "playing",   // "playing" | "over"
    winner: null,        // 0 | 1 | null (null on a draw)
    elapsed: 0,
    players: [makePlayer(0, classes[0]), makePlayer(1, classes[1])],
    bombs: [],           // { x, y, owner, fuse, radius }
    blasts: [],          // { x, y, ttl }
    events: [],          // transient, consumed by the presentation layer
  };
}

// One key press = one square. Repeated calls queue at most one step.
export function requestMove(state, index, dir) {
  const player = state.players[index];
  if (!player || !DIRECTIONS[dir]) return;
  player.pendingMove = dir;
  player.pendingTtl = MOVE_BUFFER_MS;
}

export function requestBomb(state, index) {
  const player = state.players[index];
  if (!player) return;
  player.bombQueued = true;
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
    .filter((cell) => inBounds(cell.x, cell.y) && !bombAt(state, cell.x, cell.y));
}

function addBlast(state, x, y) {
  const existing = state.blasts.find((b) => b.x === x && b.y === y);
  if (existing) {
    existing.ttl = BLAST_DURATION_MS;
    return;
  }
  state.blasts.push({ x, y, ttl: BLAST_DURATION_MS });
}

// Detonates `bomb` and anything its fire reaches, chain-reaction style.
// Each bomb uses the radius it was created with, so a Speedy bomb stays small
// even when a Classic bomb sets it off.
function explode(state, bomb) {
  const queue = [bomb];
  const spent = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (spent.has(current)) continue;
    spent.add(current);

    state.events.push({ type: "explosion", x: current.x, y: current.y });
    addBlast(state, current.x, current.y);

    for (const { dx, dy } of DIR_VECTORS) {
      for (let r = 1; r <= current.radius; r += 1) {
        const nx = current.x + dx * r;
        const ny = current.y + dy * r;
        if (!inBounds(nx, ny)) break;
        addBlast(state, nx, ny);
        const neighbour = bombAt(state, nx, ny);
        if (neighbour && !spent.has(neighbour)) queue.push(neighbour);
      }
    }
  }

  state.bombs = state.bombs.filter((b) => !spent.has(b));
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

function tryMove(state, player) {
  const vector = DIRECTIONS[player.pendingMove];
  if (!vector) return false;

  const nx = player.x + vector.dx;
  const ny = player.y + vector.dy;

  if (!inBounds(nx, ny)) return false;
  if (playerAt(state, nx, ny, player.index)) return false;
  // Bombs are solid — you can step off the one you are standing on, not back onto it.
  if (bombAt(state, nx, ny)) return false;

  player.x = nx;
  player.y = ny;
  player.moveCd = MOVE_COOLDOWN_MS;
  state.events.push({ type: "move", index: player.index, x: nx, y: ny });
  return true;
}

function respawn(state, player) {
  const spawn = SPAWNS[player.index];
  player.x = spawn.x;
  player.y = spawn.y;
  player.alive = true;
  player.moveCd = 0;
  player.pendingMove = null;
  player.pendingTtl = 0;
  player.invulnIn = INVULN_MS;
  state.events.push({ type: "respawn", index: player.index });
}

function hit(state, player) {
  player.lives -= 1;
  player.alive = false;
  player.respawnIn = RESPAWN_DELAY_MS;
  player.pendingMove = null;
  player.pendingTtl = 0;
  state.events.push({ type: "hit", index: player.index, x: player.x, y: player.y });
}

export function step(state, dt) {
  state.events = [];
  if (state.status === "over") return state;

  state.elapsed += dt;

  // 1. Players act.
  for (const player of state.players) {
    if (!player.alive) {
      if (player.lives > 0) {
        player.respawnIn -= dt;
        if (player.respawnIn <= 0) respawn(state, player);
      }
      player.bombQueued = false;
      continue;
    }

    player.moveCd = Math.max(0, player.moveCd - dt);
    player.invulnIn = Math.max(0, player.invulnIn - dt);

    if (player.bombQueued) {
      placeBomb(state, player);
      player.bombQueued = false;
    }

    if (player.pendingMove) {
      if (player.moveCd <= 0) {
        // Consume the press whether or not the step was legal, so walking into
        // a wall does not leave a queued move waiting to fire later.
        tryMove(state, player);
        player.pendingMove = null;
        player.pendingTtl = 0;
      } else {
        player.pendingTtl -= dt;
        if (player.pendingTtl <= 0) player.pendingMove = null;
      }
    }
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
  for (const blast of state.blasts) blast.ttl -= dt;
  state.blasts = state.blasts.filter((blast) => blast.ttl > 0);

  // 4. Anyone standing in fire takes the hit.
  for (const player of state.players) {
    if (!player.alive || player.invulnIn > 0) continue;
    if (state.blasts.some((b) => b.x === player.x && b.y === player.y)) {
      hit(state, player);
    }
  }

  // 5. Win check — both reaching zero on the same tick is a draw.
  const out = state.players.filter((p) => p.lives <= 0);
  if (out.length === 2) {
    state.status = "over";
    state.winner = null;
  } else if (out.length === 1) {
    state.status = "over";
    state.winner = out[0].index === 0 ? 1 : 0;
  }

  return state;
}
