// Rules of Grid 1v1. Imported unchanged by both the browser (local mode)
// and the Node server (online mode) — there is exactly one copy of the numbers.

export const COLS = 12;
export const ROWS = 16;

// Spawn pockets: player 0 at the top notch, player 1 at the bottom notch.
export const SPAWNS = [
  { x: 5, y: 0 },
  { x: 6, y: ROWS - 1 },
];

// --- game modes ------------------------------------------------------------
//
// A mode only decides how many lives each player starts with. Every round
// ends with a lost life, so a match lasts at most 2 × lives − 1 rounds.
export const MODES = {
  blitz: {
    id: "blitz",
    name: "Blitz",
    lives: 3,
    blurb: "3 lives. Short and brutal — a few mistakes and it's over.",
  },
  siege: {
    id: "siege",
    name: "Siege",
    lives: 7,
    blurb: "7 lives. A long war of attrition, where kill streaks can end it early.",
  },
};
export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = "blitz";

// --- kill streaks and the fatality --------------------------------------------
//
// Winning a round — the opponent lost a life and you did not, however they
// died — adds one to your streak. Losing a life resets it; a drawn round resets
// both. From FATALITY_STREAK in a row you may finish the match with the
// fatality key, but only within FATALITY_RANGE squares of your opponent (ring
// distance, like the sniper). From FATALITY_ANYWHERE_STREAK it works from
// anywhere. Either way the match ends on the spot.
export const STREAK_SHOWN_FROM = 2;
export const FATALITY_STREAK = 4;
export const FATALITY_RANGE = 2;
export const FATALITY_ANYWHERE_STREAK = 5;

// A press steps one square immediately. Keep holding and, after HOLD_DELAY_MS,
// you keep walking one square every HOLD_REPEAT_MS. The delay is longer than
// the repeat so a quick tap never turns into two steps.
export const HOLD_DELAY_MS = 160;
export const HOLD_REPEAT_MS = 110;
// Floor on how fast separate presses are honoured (stops mash exploits).
export const MOVE_COOLDOWN_MS = 80;
// A press that arrives during the cooldown is remembered this long, so tapping
// slightly early still lands instead of being swallowed.
export const MOVE_BUFFER_MS = 160;

export const BOMB_FUSE_MS = 1500;      // the 1.5s the game is built around
export const BLAST_DURATION_MS = 350;  // how long fire stays lethal on a tile
// --- rounds ------------------------------------------------------------------
//
// A match is played in rounds. Losing a life ends the round for both players:
// the action freezes for ROUND_END_MS so everyone sees what happened, then the
// board resets — both players back on their spawns, broken crates restored,
// bombs and fire cleared, shields refilled. Only the first round opens with a
// countdown; every later one starts straight away. Lives (set by the mode)
// still decide the match.
export const COUNTDOWN_MS = 3000;
export const ROUND_END_MS = 1500;

// --- shields ---------------------------------------------------------------
//
// A shield swallows one hit that would otherwise cost a life. Shields refill
// at the start of every round.
//
// Everyone gets SELF_SHIELDS against their OWN fire, so two own-bomb hits cost
// one life. A class's `shields` work against ANY fire, and are spent after the
// self shield when you hit yourself — the two stack.
export const SELF_SHIELDS = 1;
// After a shield absorbs a hit you are briefly untouchable. It must outlast
// BLAST_DURATION_MS, or the same fire would eat the next shield a tick later.
export const ABSORB_GRACE_MS = 500;

// --- classes ---------------------------------------------------------------
//
// A class changes how bombs work — how many you may have live at once, how far
// their fire reaches, where they appear — and how many extra hits you can take.
// `delivery: "self"` drops the bomb on your own tile; `"remote"` spawns it next
// to the opponent, but only from at least `minRange` away. `shields` is the
// number of hits from any source absorbed per life (see SELF_SHIELDS above).

export const CLASSES = {
  classic: {
    id: "classic",
    name: "Classic",
    blurb: "3 bombs, full radius. The all-rounder.",
    maxBombs: 3,
    blastRadius: 2,
    delivery: "self",
    shields: 0,
  },
  speedy: {
    id: "speedy",
    name: "Speedy",
    blurb: "5 bombs at once — but only a 1-square radius.",
    maxBombs: 5,
    blastRadius: 1,
    delivery: "self",
    shields: 0,
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    blurb: "2 bombs that land right next to your opponent. Only from 4+ squares away.",
    maxBombs: 2,
    blastRadius: 2,
    delivery: "remote",
    minRange: 4,
    shields: 0,
  },
  tank: {
    id: "tank",
    name: "Tank",
    blurb: "Takes 2 hits per life. Only 2 small bombs, though (1-square radius).",
    maxBombs: 2,
    blastRadius: 1,
    delivery: "self",
    shields: 1,
  },
};

export const CLASS_IDS = Object.keys(CLASSES);
export const DEFAULT_CLASS = "classic";

// --- arena layout ------------------------------------------------------------
//
// Every match deals a fresh board of walls and crates. It is random, but
// point-symmetric: every piece in the top half has a twin rotated 180° about
// the centre, so neither player gets the better side.
//
// Walls never break and stop both movement and fire. Crates stop movement and
// fire too, but the first blast to reach any part of one breaks all of it.
// Tiles hold TILE_FLOOR, TILE_WALL, or a positive crate id shared by all the
// squares of one crate.

export const TILE_FLOOR = 0;
export const TILE_WALL = -1;

export const SPAWN_CLEAR_RADIUS = 2; // squares (in steps) kept empty around each spawn
export const WALL_PIECES = [1, 2];   // per half of the board, inclusive
export const CRATE_PIECES = [3, 5];  // per half of the board, inclusive

// [dx, dy] cells per shape, with how often each is picked.
export const WALL_SHAPES = [
  { weight: 1, cells: [[0, 0]] },
  { weight: 2, cells: [[0, 0], [1, 0]] },
  { weight: 2, cells: [[0, 0], [0, 1]] },
  { weight: 2, cells: [[0, 0], [1, 0], [2, 0]] },
  { weight: 2, cells: [[0, 0], [0, 1], [0, 2]] },
  { weight: 1, cells: [[0, 0], [1, 0], [0, 1]] },
  { weight: 1, cells: [[0, 0], [1, 0], [1, 1]] },
  { weight: 1, cells: [[0, 0], [0, 1], [1, 1]] },
  { weight: 1, cells: [[1, 0], [0, 1], [1, 1]] },
];

export const CRATE_SHAPES = [
  { weight: 4, cells: [[0, 0]] },
  { weight: 2, cells: [[0, 0], [1, 0]] },
  { weight: 2, cells: [[0, 0], [0, 1]] },
  { weight: 1, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
];

// The 8 squares around a target, used for sniper delivery.
export const RING_8 = [
  { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },                     { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 },
];

export const DIRECTIONS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export const TICK_MS = 1000 / 60;      // server simulation step
export const SNAPSHOT_MS = 1000 / 20;  // server broadcast rate
