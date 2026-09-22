// Rules of Grid 1v1. Imported unchanged by both the browser (local mode)
// and the Node server (online mode) — there is exactly one copy of the numbers.

export const COLS = 12;
export const ROWS = 16;

// Bumped whenever the messages or the game state change shape. A page and a
// server from different versions then say so, instead of half-working.
export const PROTOCOL = 3;

// Spawn pockets: player 0 at the top notch, player 1 at the bottom notch.
export const SPAWNS = [
  { x: 5, y: 0 },
  { x: 6, y: ROWS - 1 },
];

// --- formats -------------------------------------------------------------------
//
// 1v1 is two teams of one; 2v2 two teams of two. Players are numbered so that
// index % 2 is the team: team 0 starts at the top, team 1 at the bottom, and
// every spawn has a twin rotated 180° on the other side.
export const TEAM_SPAWNS = [
  { x: 3, y: 0 },
  { x: COLS - 4, y: ROWS - 1 },
  { x: COLS - 4, y: 0 },
  { x: 3, y: ROWS - 1 },
];

export const FORMATS = {
  duel: { id: "duel", name: "1v1", players: 2, spawns: SPAWNS },
  teams: { id: "teams", name: "2v2", players: 4, spawns: TEAM_SPAWNS },
};
export const FORMAT_IDS = Object.keys(FORMATS);
export const DEFAULT_FORMAT = "duel";

export const teamOfIndex = (index) => index % 2;

// --- names and colours ----------------------------------------------------------
//
// Only the ids live here, so the server can check them; what each colour looks
// like is up to the client (public/palette.js).
export const COLOR_IDS = ["ember", "violet", "jade", "frost", "crimson", "pearl"];
// By player index: a warm pair for the top team, a cool pair for the bottom.
export const DEFAULT_COLORS = ["ember", "violet", "jade", "frost"];
export const NAME_MAX = 14;
export const defaultName = (index) => "Player " + (index + 1);

// Anything typed as a name, made safe to show: no control characters, no
// runs of spaces, at most NAME_MAX characters. Empty means "use the default".
export function cleanName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

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

export const BOMB_FUSE_MS = 1000;      // every bomb's fuse, unless its class says otherwise
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
// With the kill cam on, the freeze after a round is long enough to replay the
// last second before the kill in slow motion — unless a fatality is on offer,
// which keeps the short freeze.
export const ROUND_END_KILLCAM_MS = 3400;

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
// `pattern` is the shape of the fire: "cross" (the default), "x" (diagonals
// only) or "line" (one way, the way you faced, to the edge of the board).
// `fuseMs` overrides BOMB_FUSE_MS. `stealth` and `ability` are described with
// the Shade and Decoy numbers below.

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
  quickfuse: {
    id: "quickfuse",
    name: "Quickfuse",
    blurb: "Fuses burn in 0.53 s instead of 1 — but the blast only reaches 1 square.",
    maxBombs: 3,
    blastRadius: 1,
    delivery: "self",
    shields: 0,
    fuseMs: 533, // the same share of the normal fuse as before: 0.8 of 1.5 s
  },
  diagonal: {
    id: "diagonal",
    name: "Diagonal",
    blurb: "Fire bursts out in an X instead of a cross. Right beside the bomb is safe.",
    maxBombs: 3,
    blastRadius: 2,
    delivery: "self",
    shields: 0,
    pattern: "x",
  },
  line: {
    id: "line",
    name: "Line",
    blurb: "Fire shoots one way only — the way you face — all the way to the edge.",
    maxBombs: 2,
    blastRadius: Math.max(COLS, ROWS),
    delivery: "self",
    shields: 0,
    pattern: "line",
  },
  shade: {
    id: "shade",
    name: "Shade",
    blurb: "Stand still for a second and you vanish from enemy eyes. One quiet step keeps you hidden.",
    maxBombs: 2,
    blastRadius: 2,
    delivery: "self",
    shields: 0,
    stealth: true,
    onlineOnly: true, // on a shared screen there is nobody to hide from
  },
  decoy: {
    id: "decoy",
    name: "Decoy",
    blurb: "Ability: a fake copy of you for 3 s. It copies your steps, mirrored left and right.",
    maxBombs: 2,
    blastRadius: 2,
    delivery: "self",
    shields: 0,
    ability: "decoy",
  },
};

// Shade: after SHADE_VANISH_MS of standing still you disappear for the other
// team. While hidden, one step keeps you hidden; a second step before another
// SHADE_VANISH_MS of stillness gives you away, and so does placing a bomb,
// shrugging off a hit, or someone walking into you. Snipers cannot target you
// and a fatality needs you in sight (unless it works from anywhere).
export const SHADE_VANISH_MS = 1000;

// Decoy: a copy of you that walks when you walk — same step up or down,
// mirrored left and right. It blocks like a player, cannot be told apart
// from you by the other team, and pops in fire.
export const DECOY_MS = 3000;
export const DECOY_COOLDOWN_MS = 6000;

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
