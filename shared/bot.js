// Computer players. A bot plays a seat the way a person would: it only sees
// what that seat may see (pass it viewFor(state, index), so a hidden Shade
// fools it too), it thinks a few times a second, and it acts through the same
// calls the keyboard makes. Its level sets how often it thinks, how fast it
// walks and how carefully it plays.
//
// Every decision rests on one picture: for each square, the time windows in
// which it will be on fire — from fire burning now and from every bomb on the
// board, chain reactions included. Routes are searched in time, one step (or
// a pause) at a time, and never enter a square while it burns.

import {
  DIRECTIONS,
  CLASS_IDS,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  RING_STEP_MS,
  TILE_WALL,
  TILE_FIRE,
} from "./constants.js";
import {
  classOf,
  tileAt,
  fireSquares,
  bombPreview,
  fatalityReady,
  requestMove,
  setHeld,
  requestBomb,
  requestAbility,
  requestFatality,
} from "./engine.js";

// aimError — how far its throws can miss, in squares
// ringWarn — how long before the fire wall reaches a square it stops using it
// thinkMs — how often it looks at the board again (its reaction time)
// stepMs — how fast it walks
// margin — ms of safety it keeps from fire when planning
// aggression — chance to take a bombing chance when it sees one
// sloppy — chance to not notice it is standing in danger
// wander — chance to amble about instead of hunting
// traps — bombs to cut off an enemy's escape, not only to hit them
// abilityChance, finishChance — how readily it uses its ability and a fatality
export const BOT_LEVELS = {
  easy: {
    id: "easy", name: "Easy",
    thinkMs: 420, stepMs: 230, margin: 20, aggression: 0.3, sloppy: 0.15, wander: 0.35,
    traps: false, abilityChance: 0.15, finishChance: 0.25, aimError: 1.6, ringWarn: 3600,
  },
  medium: {
    id: "medium", name: "Medium",
    thinkMs: 220, stepMs: 140, margin: 80, aggression: 0.65, sloppy: 0.02, wander: 0.1,
    traps: false, abilityChance: 0.4, finishChance: 0.7, aimError: 0.5, ringWarn: 5200,
  },
  hard: {
    id: "hard", name: "Hard",
    thinkMs: 110, stepMs: 95, margin: 110, aggression: 0.95, sloppy: 0, wander: 0,
    traps: true, abilityChance: 0.7, finishChance: 1, aimError: 0, ringWarn: 6200,
  },
};
export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS);
export const DEFAULT_BOT_LEVEL = "medium";
export const safeBotLevel = (value) => (BOT_LEVELS[value] ? value : DEFAULT_BOT_LEVEL);

const BOT_NAMES = ["Cinder", "Vesper", "Hollow", "Sable", "Moth", "Wick", "Ashen", "Rook", "Nyx", "Tallow", "Gloam", "Vigil"];

// `count` bot names nobody in `taken` already uses.
export function botNames(count, taken = []) {
  const pool = BOT_NAMES.filter((name) => !taken.includes(name));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export const randomClass = () => CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)];

// The calls a bot makes, wired to the real game state for seat `index`.
export function handsFor(state, index) {
  return {
    move: (dir) => requestMove(state, index, dir),
    hold: (dir) => setHeld(state, index, dir),
    bomb: (aim = null) => requestBomb(state, index, aim),
    ability: (aim = null) => requestAbility(state, index, aim),
    fatality: () => requestFatality(state, index),
  };
}

// --- reading the board ------------------------------------------------------

const MOVES = Object.entries(DIRECTIONS);
const WAIT = ["wait", { dx: 0, dy: 0 }];
const ring = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
// Squares are numbered by the board the state carries, not by a fixed size:
// the free-for-all board is much bigger than the duel one.
const spot = (state, p) => p.y * state.cols + p.x;
const onBoard = (state, x, y) => x >= 0 && x < state.cols && y >= 0 && y < state.rows;

// Per square, the [from, to] windows (ms from now) in which it burns. Ground
// the fire wall has taken burns for good.
function fireWindows(state, extraBombs = [], ringWarn = 5000) {
  const at = (p) => spot(state, p);
  const windows = Array.from({ length: state.cols * state.rows }, () => []);
  state.tiles.forEach((tile, i) => { if (tile === TILE_FIRE) windows[i].push([-1, Infinity]); });
  // The fire wall, as far ahead as this bot looks: ground it is about to take
  // counts as ground that burns, so the bot backs away before it arrives.
  if (state.ring) {
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        const rings = Math.min(x, y, state.cols - 1 - x, state.rows - 1 - y);
        if (rings < state.ring.inset) continue; // already burnt, marked above
        const due = state.ring.left + (rings - state.ring.inset) * RING_STEP_MS;
        if (due <= ringWarn) windows[y * state.cols + x].push([due, Infinity]);
      }
    }
  }
  for (const blast of state.blasts) windows[at(blast)].push([-1, blast.ttl]);
  const pending = [...state.bombs, ...extraBombs].map((bomb) => ({ bomb, due: Math.max(0, bomb.fuse) }));
  while (pending.length) {
    let next = 0;
    for (let i = 1; i < pending.length; i += 1) if (pending[i].due < pending[next].due) next = i;
    const { bomb, due } = pending.splice(next, 1)[0];
    for (const square of fireSquares(state, bomb)) {
      windows[at(square)].push([due, due + BLAST_DURATION_MS]);
      // A bomb this fire reaches goes off with it.
      for (const other of pending) {
        if (other.bomb.x === square.x && other.bomb.y === square.y && other.due > due) other.due = due;
      }
    }
  }
  return windows;
}

const burnsDuring = (windows, from, to, margin) => windows.some(([s, e]) => s - margin < to && e + margin > from);
const quietFrom = (windows, t, margin) => windows.every(([, e]) => e + margin < t);

// Squares a player cannot walk into: walls, crates, bombs, other players and
// the enemy's decoys (it cannot tell them from the real thing).
function blockedGrid(state, me) {
  const at = (p) => spot(state, p);
  const grid = new Uint8Array(state.cols * state.rows);
  for (let i = 0; i < grid.length; i += 1) if (state.tiles[i] === TILE_WALL || state.tiles[i] > 0) grid[i] = 1;
  for (const bomb of state.bombs) grid[at(bomb)] = 1;
  for (const p of state.players) {
    if (p !== me && p.alive && p.x !== null && p.x !== undefined) grid[at(p)] = 1;
  }
  for (const decoy of state.decoys || []) if (decoy.owner !== me.index) grid[at(decoy)] = 1;
  grid[at(me)] = 0;
  return grid;
}

// Breadth-first search through time: each move — or a pause — takes stepMs,
// and a square is never entered while it will burn. Returns the moves ("up",
// "wait", …) of the quickest way to a square where goal(node, t) holds, or
// null. node.last is the direction of the step that got there (its facing).
function route(board, grid, windows, start, goal, { stepMs, margin, maxSteps = 20 }) {
  let frontier = [{ x: start.x, y: start.y, last: start.facing, parent: null, dir: null }];
  const seen = new Set([start.x + "," + start.y + ",0"]);
  for (let k = 0; k <= maxSteps && frontier.length; k += 1) {
    const next = [];
    for (const node of frontier) {
      if (goal(node, k * stepMs)) return pathOf(node);
      if (k === maxSteps) continue;
      for (const [dir, { dx, dy }] of [...MOVES, WAIT]) {
        const x = node.x + dx;
        const y = node.y + dy;
        if (dir !== "wait" && (!onBoard(board, x, y) || grid[y * board.cols + x])) continue;
        const arrive = (k + 1) * stepMs;
        if (burnsDuring(windows[y * board.cols + x], arrive - stepMs / 2, arrive + stepMs, margin)) continue;
        const key = x + "," + y + "," + (k + 1);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ x, y, last: dir === "wait" ? node.last : dir, parent: node, dir });
      }
    }
    frontier = next;
  }
  return null;
}

function pathOf(node) {
  const path = [];
  for (let n = node; n.parent; n = n.parent) path.unshift(n.dir);
  return path;
}

// The bomb `me` would drop standing on (x, y) facing `facing`.
function bombFrom(me, stats, x, y, facing) {
  return {
    x,
    y,
    owner: me.index,
    fuse: stats.fuseMs || BOMB_FUSE_MS,
    radius: stats.blastRadius,
    shape: stats.pattern || "cross",
    dir: facing || "down",
  };
}

// --- deciding ----------------------------------------------------------------

function think(view, me, level, memory, act) {
  const stats = classOf(me);
  const { margin, stepMs } = level;
  const plan = { stepMs, margin };
  const at = (p) => spot(view, p);
  const windows = fireWindows(view, [], level.ringWarn);
  const grid = blockedGrid(view, me);
  const quiet = (node, t) => quietFrom(windows[at(node)], t, margin);

  // 1. Fire is coming here — a bomb's, or the closing wall's: get to a square
  //    it will never reach.
  if (!quietFrom(windows[at(me)], 0, margin) && Math.random() >= level.sloppy) {
    const escape = route(view, grid, windows, me, quiet, { ...plan, maxSteps: 26 });
    return escape || [MOVES[Math.floor(Math.random() * 4)][0]];
  }

  const enemies = view.players.filter((p) => p.team !== me.team);
  for (const e of enemies) if (e.alive && e.x !== null && e.x !== undefined) memory.lastSeen.set(e.index, { x: e.x, y: e.y });
  const targets = [
    ...enemies.filter((p) => p.alive && p.x !== null && p.x !== undefined),
    ...(view.decoys || []).filter((d) => view.players[d.owner].team !== me.team),
  ];
  const friends = view.players.filter((p) => p.team === me.team && p !== me && p.alive && p.x !== null);
  const nearest = targets.reduce((best, t) => (!best || ring(me, t) < ring(me, best) ? t : best), null);

  // 2. A fatality on offer.
  const offer = fatalityReady(view, me.index);
  if ((offer === "near" || offer === "anywhere") && Math.random() < level.finishChance) act.fatality();

  // 3. The class ability, when someone is close.
  if (stats.ability === "decoy" && me.abilityCd <= 0 && nearest && ring(me, nearest) <= 4 &&
      Math.random() < level.abilityChance) {
    act.ability();
  }

  // 4. Drop or throw a bomb when it pays — and only with a way out.
  const live = view.bombs.filter((b) => b.owner === me.index).length;
  if (live < stats.maxBombs && Math.random() < level.aggression) {
    const shot = bestShot(view, me, stats, level, grid, targets, friends, memory, nearest);
    if (shot !== undefined) {
      act.bomb(shot);
      return []; // next look sees the new bomb and runs
    }
  }

  // 5. Where to go.
  if (Math.random() < level.wander) return amble(view, me, grid, windows, quiet, plan, memory);

  let hunt;
  if (stats.delivery === "remote") {
    // A sniper wants range, not closeness.
    hunt = (node, t) => quiet(node, t) &&
      targets.some((target) => { const d = ring(node, target); return d >= stats.minRange && d <= stats.minRange + 2; });
  } else {
    const cache = new Map();
    hunt = (node, t) => {
      if (!quiet(node, t)) return false;
      const key = node.x + "," + node.y + "," + node.last;
      if (!cache.has(key)) {
        const squares = fireSquares(view, bombFrom(me, stats, node.x, node.y, node.last));
        cache.set(key, targets.some((target) => squares.some((s) => s.x === target.x && s.y === target.y)));
      }
      return cache.get(key);
    };
  }
  const attack = targets.length ? route(view, grid, windows, me, hunt, { ...plan, maxSteps: 22 }) : null;
  if (attack) {
    memory.digging = false;
    return attack;
  }

  // Nobody within reach: open the way by breaking crates.
  const dig = route(view, grid, windows, me, (node, t) => quiet(node, t) &&
    fireSquares(view, bombFrom(me, stats, node.x, node.y, node.last)).some((s) => tileAt(view, s.x, s.y) > 0),
  { ...plan, maxSteps: 18 });
  if (dig) {
    memory.digging = true;
    return dig;
  }
  return amble(view, me, grid, windows, quiet, plan, memory);
}

// The shot to take, if any: an aim (a square to throw at) or null for "at my
// feet". Returns undefined when no shot is worth it. Each candidate is judged
// by the bomb it would really make — the engine works that out — and is only
// taken if there is still a way out afterwards.
function bestShot(view, me, stats, level, grid, targets, friends, memory, nearest) {
  const aims = [null];
  if (nearest && (stats.throwRange > 0 || stats.delivery === "remote")) {
    const miss = level.aimError;
    aims.unshift({
      x: Math.round(nearest.x + (Math.random() * 2 - 1) * miss),
      y: Math.round(nearest.y + (Math.random() * 2 - 1) * miss),
    });
  }
  for (const aim of aims) {
    const bomb = bombPreview(view, me.index, aim);
    if (!bomb) continue;
    if (payingShot(view, me, level, grid, targets, friends, memory, bomb)) return aim;
  }
  return undefined;
}

// Whether this exact bomb is worth it, and survivable.
function payingShot(view, me, level, grid, targets, friends, memory, bomb) {
  const at = (p) => spot(view, p);
  const squares = fireSquares(view, bomb);
  const burns = (p) => squares.some((s) => s.x === p.x && s.y === p.y);
  if (friends.some(burns)) return false;

  const windows = fireWindows(view, [bomb], level.ringWarn);
  let worth = targets.some(burns) ||
    (memory.digging && squares.some((s) => tileAt(view, s.x, s.y) > 0));
  if (!worth && level.traps) {
    // Would it leave an enemy with nowhere to run?
    worth = targets.some((target) => {
      if (target.index === undefined || ring(me, target) > 5) return false;
      const theirs = grid.slice();
      theirs[at(me)] = 1;
      theirs[at(bomb)] = 1;
      theirs[at(target)] = 0;
      return !route(view, theirs, windows, { x: target.x, y: target.y, facing: target.facing },
        (node, t) => quietFrom(windows[at(node)], t, 0), { stepMs: 110, margin: 0, maxSteps: 14 });
    });
  }
  if (!worth) return false;

  const mine = grid.slice();
  mine[at(bomb)] = 1; // nobody walks onto a bomb
  return Boolean(route(view, mine, windows, me, (node, t) => quietFrom(windows[at(node)], t, level.margin),
    { stepMs: level.stepMs, margin: level.margin, maxSteps: 16 }));
}

// No target in reach: head for where an enemy was last seen, or the middle.
function amble(view, me, grid, windows, quiet, plan, memory) {
  const seen = [...memory.lastSeen.values()];
  const where = seen.length ? seen[Math.floor(Math.random() * seen.length)]
    : { x: Math.floor(view.cols / 2), y: Math.floor(view.rows / 2) };
  const path = route(view, grid, windows, me, (node, t) => quiet(node, t) && ring(node, where) <= 2,
    { ...plan, maxSteps: 20 });
  if (path) return path.slice(0, 4);
  const open = MOVES.filter(([, { dx, dy }]) => onBoard(view, me.x + dx, me.y + dy) &&
    !grid[(me.y + dy) * view.cols + me.x + dx]);
  return open.length ? [open[Math.floor(Math.random() * open.length)][0]] : [];
}

// --- the bot ----------------------------------------------------------------

export function createBot(index, levelId = DEFAULT_BOT_LEVEL) {
  const level = BOT_LEVELS[safeBotLevel(levelId)];
  let clock = 0;
  let nextThink = 200 + Math.random() * level.thinkMs; // nobody reacts on the very first frame
  let nextStep = 0;
  let path = [];
  let memory = { round: null, lastSeen: new Map(), digging: false };

  return {
    index,
    level: level.id,
    // view: what this seat may see (viewFor); act: handsFor(state, index).
    update(view, dt, act) {
      clock += dt;
      const me = view.players[index];
      if (!me || view.status !== "playing") return;
      if (view.round !== memory.round) {
        memory = { round: view.round, lastSeen: new Map(), digging: false };
        path = [];
      }

      if (view.phase === "roundEnd") {
        // The freeze after taking a round: the one thing left is the finish.
        if (clock >= nextThink) {
          nextThink = clock + level.thinkMs;
          const offer = fatalityReady(view, index);
          if ((offer === "near" || offer === "anywhere") && Math.random() < level.finishChance) act.fatality();
        }
        return;
      }
      if (view.phase !== "live" || !me.alive) {
        path = [];
        return;
      }

      if (clock >= nextThink) {
        nextThink = clock + level.thinkMs * (0.75 + Math.random() * 0.5);
        path = think(view, me, level, memory, act);
      }
      if (path.length && clock >= nextStep && me.moveCd <= 0) {
        const dir = path.shift();
        if (dir !== "wait") {
          act.move(dir);
          act.hold(null);
        }
        nextStep = clock + level.stepMs;
      }
    },
  };
}
