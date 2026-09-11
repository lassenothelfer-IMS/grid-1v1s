// Rules of Grid 1v1. Imported unchanged by both the browser (local mode)
// and the Node server (online mode) — there is exactly one copy of the numbers.

export const COLS = 12;
export const ROWS = 16;

// Spawn pockets: player 0 at the top notch, player 1 at the bottom notch.
export const SPAWNS = [
  { x: 5, y: 0 },
  { x: 6, y: ROWS - 1 },
];

export const START_LIVES = 3;

// Movement is one square per key press — holding a key does nothing. This is
// only a floor on how fast repeated presses can be honoured, not a walk speed.
export const MOVE_COOLDOWN_MS = 80;
// A press that arrives during the cooldown is remembered this long, so tapping
// slightly early still lands instead of being swallowed.
export const MOVE_BUFFER_MS = 160;

export const BOMB_FUSE_MS = 1500;      // the 1.5s the game is built around
export const BLAST_DURATION_MS = 350;  // how long fire stays lethal on a tile
export const RESPAWN_DELAY_MS = 900;
export const INVULN_MS = 1500;         // grace period after (re)spawning

// --- classes ---------------------------------------------------------------
//
// A class only changes how bombs work: how many you may have live at once,
// how far their fire reaches, and where they appear when you press the button.
// `delivery: "self"` drops the bomb on your own tile; `"remote"` spawns it next
// to the opponent, but only from at least `minRange` away.

export const CLASSES = {
  classic: {
    id: "classic",
    name: "Classic",
    blurb: "2 Bomben, voller Radius. Der Allrounder.",
    maxBombs: 2,
    blastRadius: 2,
    delivery: "self",
  },
  speedy: {
    id: "speedy",
    name: "Speedy",
    blurb: "5 Bomben gleichzeitig — dafür nur 1 Feld Radius.",
    maxBombs: 5,
    blastRadius: 1,
    delivery: "self",
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    blurb: "2 Bomben, die neben dem Gegner erscheinen. Nur aus 4+ Feldern Abstand.",
    maxBombs: 2,
    blastRadius: 2,
    delivery: "remote",
    minRange: 4,
  },
};

export const CLASS_IDS = Object.keys(CLASSES);
export const DEFAULT_CLASS = "classic";

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
