// Canvas renderer, Nocturne "Arena · Sigil" direction. Reads game state,
// writes pixels — no game logic here. Colours, sizes and animation timings are
// taken from the design project's templates/arena-sigil; each player's colour
// comes from public/palette.js.
//
// Everything the renderer remembers between frames (smoothed positions,
// embers, shattering crates…) lives in a "view". The live board has one; the
// kill cam replays old frames through a view of its own, so the two never
// trip over each other's effects.

import {
  COLS,
  ROWS,
  SPAWNS,
  DEFAULT_COLORS,
  DIRECTIONS,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  ABSORB_GRACE_MS,
  TILE_WALL,
  TILE_FLOOR,
  TILE_FIRE,
  FATALITY_RANGE,
} from "/shared/constants.js";
import { sniperTargets, fatalityReady, classOf, fireSquares, bombPreview } from "/shared/engine.js";
import { paletteOf } from "/palette.js";

// The template draws on a 64px cell; everything here is expressed as a
// fraction of that so it scales with the board.
const T = 64;

// A player colour in the shapes the canvas wants.
const sides = new Map();
function sideOf(color) {
  if (!sides.has(color)) {
    const c = paletteOf(color);
    sides.set(color, {
      core: c.core,
      hi: c.hi,
      lo: c.lo,
      ring: `rgba(${c.rgb},`,
      glow: `rgba(${c.rgb},0.62)`,
      rim: c.rim,
      pulseMs: c.pulseMs,
    });
  }
  return sides.get(color);
}

// Grid positions are integers, but figures glide between them. This is purely
// cosmetic: the engine only ever knows the whole square a player is on.
const SMOOTH_TAU_MS = 34;
const SNAP_DISTANCE = 1.6; // further than one step means a new round, not a walk
const SHATTER_MS = 420;
const FATALITY_SHATTER_MS = 750;
const PUFF_MS = 520;
const DEATH_MS = 650;      // a hit figure coming apart on the square that burned it
const AFTERGLOW_MS = 260;  // fire fading out once it can no longer hurt anyone

// view.viewer — { index, team } when the board is seen from one seat (online);
//   null when everyone shares the screen. It decides what counts as "yours":
//   your team's hidden Shade and decoys are drawn see-through, the enemy's
//   decoys look exactly like the real thing.
// view.replay — a kill cam view: no aiming aids, and a reticle on view.mark.
export function createView({ replay = false } = {}) {
  return {
    replay,
    viewer: null,
    aim: null,              // { index, x, y }: the throw being lined up
    mark: null,             // kill cam: { x, y, color }
    motion: new Map(),      // "p0" / "d0" -> { x, y } in fractional cells
    seen: new Map(),        // "p0" -> "shown" | "ghost" | "gone", for vanish puffs
    embers: [],             // drifting up out of fresh blasts
    lastBlastKeys: new Set(),
    lastCrates: new Map(),  // id -> { x0, y0, x1, y1 }, so a broken one can shatter
    shatters: [],           // { box, life }
    puffs: [],              // { x, y, color, life }
    deaths: [],             // { x, y, fromX, fromY, color, life }
    afterglow: [],          // { x, y, life } — squares whose fire just went out
    lastRound: null,        // a new round wipes last round's embers and flashes
    fatalityAt: null,       // when the fatality finish was first seen
    burst: [],              // its shatter burst
    lastFrameAt: null,
  };
}

const live = createView();

export function resetMotion() {
  const viewer = live.viewer;
  Object.assign(live, createView(), { viewer });
}

export function setViewer(viewer) {
  live.viewer = viewer;
}

// Where the player on this screen is aiming: { index, x, y } while a pointer
// is over the board, null otherwise. The board shows the throw before it is
// taken — the same landing square and blast the engine would work out.
export function setAim(aim) {
  live.aim = aim;
}

// Bounding box of every crate on the board, keyed by crate id.
function cratesOf(tiles, cols) {
  const boxes = new Map();
  if (!tiles) return boxes;
  for (let i = 0; i < tiles.length; i += 1) {
    const id = tiles[i];
    if (id <= 0) continue;
    const x = i % cols;
    const y = Math.floor(i / cols);
    const box = boxes.get(id);
    if (!box) boxes.set(id, { x0: x, y0: y, x1: x, y1: y });
    else {
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
    }
  }
  return boxes;
}

function smoothed(view, key, target, dt) {
  const previous = view.motion.get(key);
  if (!previous || Math.hypot(target.x - previous.x, target.y - previous.y) > SNAP_DISTANCE) {
    const snapped = { x: target.x, y: target.y };
    view.motion.set(key, snapped);
    return snapped;
  }
  // Frame-rate independent exponential ease toward the true square.
  const t = 1 - Math.exp(-dt / SMOOTH_TAU_MS);
  previous.x += (target.x - previous.x) * t;
  previous.y += (target.y - previous.y) * t;
  return previous;
}

export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// CSS `radial-gradient(circle at 34% 28%, a, b 54%, c)` on a d×d box.
function orbGradient(ctx, left, top, d, stops) {
  const ox = left + d * 0.34;
  const oy = top + d * 0.28;
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, d * 0.977);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.54, stops[1]);
  g.addColorStop(1, stops[2]);
  return g;
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

// A small filled arrowhead at (x, y) pointing along a direction vector.
function chevron(ctx, x, y, { dx, dy }, size) {
  const px = -dy;
  const py = dx;
  ctx.beginPath();
  ctx.moveTo(x + dx * size, y + dy * size);
  ctx.lineTo(x - dx * size * 0.6 + px * size * 0.8, y - dy * size * 0.6 + py * size * 0.8);
  ctx.lineTo(x - dx * size * 0.6 - px * size * 0.8, y - dy * size * 0.6 - py * size * 0.8);
  ctx.closePath();
}

// A luminous orb inside a slowly breathing sigil ring — a circle, or in 2v2
// a diamond for the bottom team, so teammates read as a pair whatever colours
// they picked. `ghost` is how your own team sees a hidden Shade or a decoy.
function drawFigure(ctx, cx, cy, u, side, now, { alpha = 1, ghost = false, sigil = "circle" } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha * (ghost ? 0.42 : 1);

  // sigilPulse: scale .94 → 1.06, opacity .5 → 1
  const phase = (1 - Math.cos((now / side.pulseMs) * Math.PI * 2)) / 2;
  ctx.strokeStyle = side.ring + (0.5 * (0.5 + 0.5 * phase)).toFixed(3) + ")";
  ctx.lineWidth = Math.max(1, u);
  if (ghost) ctx.setLineDash([4 * u, 4 * u]);
  const R = 30 * u * (0.94 + 0.12 * phase);
  if (sigil === "diamond") diamond(ctx, cx, cy, R * 1.12);
  else circle(ctx, cx, cy, R);
  ctx.stroke();
  ctx.setLineDash([]);

  const d = 40 * u;
  ctx.shadowColor = side.glow;
  ctx.shadowBlur = 26 * u;
  ctx.fillStyle = orbGradient(ctx, cx - d / 2, cy - d / 2, d, [side.hi, side.core, side.lo]);
  circle(ctx, cx, cy, d / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = side.rim;
  ctx.lineWidth = Math.max(1, u);
  circle(ctx, cx, cy, d / 2 - 0.5);
  ctx.stroke();
  ctx.restore();
}

function addPuff(view, x, y, color) {
  view.puffs.push({ x, y, color, life: 0 });
}

export function draw(canvas, state, now = performance.now(), view = live) {
  const dt = view.lastFrameAt === null ? 16 : Math.min(now - view.lastFrameAt, 100);
  view.lastFrameAt = now;

  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  // The board is as big as the state says: 12×16 for a duel, 25×25 for a
  // free-for-all.
  const cols = (state && state.cols) || COLS;
  const rows = (state && state.rows) || ROWS;
  const cell = Math.min(width / cols, height / rows);
  const u = (cell / T) * Math.min(1.6, Math.max(1, 12 / cols)); // keep line weights readable on a big board
  const offsetX = (width - cell * cols) / 2;
  const offsetY = (height - cell * rows) / 2;
  const px = (cx) => offsetX + cx * cell;
  const py = (cy) => offsetY + cy * cell;
  const bw = cell * cols;
  const bh = cell * rows;
  const players = state ? state.players : [];
  const colorOf = (index) => (players[index] && players[index].color) || DEFAULT_COLORS[index] || "ember";
  const teamsMatch = Boolean(state && state.format === "teams");
  const sigilOf = (team) => (teamsMatch && team === 1 ? "diamond" : "circle");
  const mine = (team) => view.viewer !== null && view.viewer.team === team;

  // Ground: #17131f with 1px bone grid lines at 5.5%.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#17131f";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(230,222,210,0.055)";
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let c = 1; c < cols; c += 1) {
    ctx.moveTo(Math.round(px(c)) + 0.5, py(0));
    ctx.lineTo(Math.round(px(c)) + 0.5, py(rows));
  }
  for (let r = 1; r < rows; r += 1) {
    ctx.moveTo(px(0), Math.round(py(r)) + 0.5);
    ctx.lineTo(px(cols), Math.round(py(r)) + 0.5);
  }
  ctx.stroke();

  // Spawn pockets, in the template's relic-slot treatment.
  ((state && state.spawns) || SPAWNS).forEach((spawn, i) => {
    const s = sideOf(colorOf(i));
    const inset = 6 * u;
    ctx.fillStyle = s.ring + "0.07)";
    ctx.fillRect(px(spawn.x) + inset, py(spawn.y) + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = s.ring + "0.3)";
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeRect(px(spawn.x) + inset + 0.5, py(spawn.y) + inset + 0.5, cell - inset * 2 - 1, cell - inset * 2 - 1);
  });

  // Ritual geometry: an ember circle and a violet diamond, centred on the board.
  // Template ratios: circle 360 and diamond 232 on a 448px-deep board.
  const midX = px(0) + bw / 2;
  const midY = py(0) + bh / 2;
  const ref = Math.min(bw, bh);
  ctx.lineWidth = Math.max(1, u);
  ctx.strokeStyle = "rgba(232,163,61,0.16)";
  circle(ctx, midX, midY, (ref * (360 / 448)) / 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(192,168,255,0.13)";
  diamond(ctx, midX, midY, ((ref * (232 / 448)) / 2) * Math.SQRT2);
  ctx.stroke();

  // Inner vignette (template: inset 0 0 90px rgba(0,0,0,.55)).
  const vig = ctx.createRadialGradient(midX, midY, ref * 0.35, midX, midY, Math.hypot(bw, bh) / 2);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(px(0), py(0), bw, bh);

  if (!state) {
    view.lastBlastKeys = new Set();
    view.lastCrates = new Map();
    return;
  }

  if (state.round !== view.lastRound) {
    view.lastRound = state.round;
    view.embers.length = 0;
    view.shatters.length = 0;
    view.puffs.length = 0;
    view.deaths.length = 0;
    view.afterglow.length = 0;
    view.lastBlastKeys = new Set();
  }

  const tiles = state.tiles || [];
  const at = (x, y) => (x >= 0 && x < cols && y >= 0 && y < rows ? tiles[y * cols + x] : TILE_WALL);
  const wallAt = (x, y) => at(x, y) === TILE_WALL;

  // Walls — the template's raised stone: a cool 160° gradient, a lit top edge
  // and a shadowed base. Neighbouring wall squares fuse into one piece, so the
  // edges are only drawn where the piece ends.
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (tiles[y * cols + x] !== TILE_WALL) continue;
      const X = px(x);
      const Y = py(y);
      const stone = ctx.createLinearGradient(X + cell * 0.33, Y, X + cell * 0.67, Y + cell);
      stone.addColorStop(0, "#2c2436");
      stone.addColorStop(1, "#171220");
      ctx.fillStyle = stone;
      ctx.fillRect(X, Y, cell, cell);
      if (!wallAt(x, y - 1)) {
        ctx.fillStyle = "rgba(230,222,210,0.14)";
        ctx.fillRect(X, Y, cell, Math.max(1, u));
      }
      if (!wallAt(x, y + 1)) {
        const base = ctx.createLinearGradient(0, Y + cell - 9 * u, 0, Y + cell);
        base.addColorStop(0, "rgba(0,0,0,0)");
        base.addColorStop(1, "rgba(0,0,0,0.6)");
        ctx.fillStyle = base;
        ctx.fillRect(X, Y + cell - 9 * u, cell, 9 * u);
      }
      if (!wallAt(x - 1, y)) {
        ctx.fillStyle = "rgba(230,222,210,0.05)";
        ctx.fillRect(X, Y, Math.max(1, u), cell);
      }
      if (!wallAt(x + 1, y)) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(X + cell - Math.max(1, u), Y, Math.max(1, u), cell);
      }
    }
  }

  // Crates — the template's amber reliquaries: one warm box per crate, inset
  // 6px from its squares, with a thin ember rim. Big crates are one big box.
  const crates = cratesOf(tiles, cols);
  for (const box of crates.values()) {
    const inset = 6 * u;
    const X = px(box.x0) + inset;
    const Y = py(box.y0) + inset;
    const W = (box.x1 - box.x0 + 1) * cell - inset * 2;
    const H = (box.y1 - box.y0 + 1) * cell - inset * 2;
    const wood = ctx.createLinearGradient(X + W * 0.25, Y, X + W * 0.75, Y + H);
    wood.addColorStop(0, "#4a3623");
    wood.addColorStop(1, "#2b1e13");
    ctx.fillStyle = wood;
    ctx.fillRect(X, Y, W, H);
    ctx.strokeStyle = "rgba(232,163,61,0.22)";
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
    // A faint seal line across bigger crates, so a 2×2 reads as one heavy piece.
    if (W > cell || H > cell) {
      ctx.strokeStyle = "rgba(232,163,61,0.12)";
      ctx.beginPath();
      ctx.moveTo(X + 7 * u, Y + 7 * u);
      ctx.lineTo(X + W - 7 * u, Y + H - 7 * u);
      ctx.stroke();
    }
  }

  // Ground the fire wall has taken: scorched, still burning at its edge, and
  // deadly to stand on.
  if (state.ring) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (at(x, y) !== TILE_FIRE) continue;
        const X = px(x);
        const Y = py(y);
        ctx.fillStyle = "rgba(58,10,8,0.85)";
        ctx.fillRect(X, Y, cell, cell);
        ctx.fillStyle = `rgba(255,86,32,${(0.1 + 0.07 * pulse).toFixed(3)})`;
        ctx.fillRect(X, Y, cell, cell);
        // The edge where it meets the board still has flames on it.
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (at(x + dx, y + dy) === TILE_FIRE) continue;
          const hot = ctx.createLinearGradient(X + (dx > 0 ? cell : 0), Y + (dy > 0 ? cell : 0),
            X + (dx > 0 ? cell - cell * 0.5 : dx < 0 ? cell * 0.5 : 0), Y + (dy > 0 ? cell - cell * 0.5 : dy < 0 ? cell * 0.5 : 0));
          hot.addColorStop(0, `rgba(255,150,60,${(0.5 + 0.3 * pulse).toFixed(3)})`);
          hot.addColorStop(1, "rgba(255,90,30,0)");
          ctx.fillStyle = hot;
          ctx.fillRect(X, Y, cell, cell);
        }
      }
    }
  }

  // A crate that was here last frame and is gone now just broke.
  for (const [id, box] of view.lastCrates) {
    if (crates.has(id)) continue;
    view.shatters.push({ box, life: 0 });
    const squares = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
    for (let k = 0; k < 3 * squares; k += 1) {
      view.embers.push({
        x: px(box.x0) + Math.random() * (box.x1 - box.x0 + 1) * cell,
        y: py(box.y0) + Math.random() * (box.y1 - box.y0 + 1) * cell,
        r: (2.5 + Math.random() * 2) * u,
        life: 0,
        span: 1400 + Math.random() * 900,
        color: Math.random() < 0.5 ? "232,163,61" : "255,208,138",
      });
    }
  }
  view.lastCrates = crates;

  // Shatter flash: the broken box's rim flares and expands as it fades.
  for (let i = view.shatters.length - 1; i >= 0; i -= 1) {
    const s = view.shatters[i];
    s.life += dt;
    const t = s.life / SHATTER_MS;
    if (t >= 1) {
      view.shatters.splice(i, 1);
      continue;
    }
    const grow = 6 * u * t;
    const X = px(s.box.x0) + 6 * u - grow;
    const Y = py(s.box.y0) + 6 * u - grow;
    const W = (s.box.x1 - s.box.x0 + 1) * cell - 12 * u + grow * 2;
    const H = (s.box.y1 - s.box.y0 + 1) * cell - 12 * u + grow * 2;
    ctx.strokeStyle = `rgba(240,182,87,${(0.8 * (1 - t)).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.strokeRect(X, Y, W, H);
  }

  // Where someone went down this round — mostly for 2v2, where the round goes
  // on without them: a faint ring of ash in their colour.
  for (const kill of state.kills || []) {
    const s = sideOf(colorOf(kill.victim));
    const cx = px(kill.x) + cell / 2;
    const cy = py(kill.y) + cell / 2;
    ctx.strokeStyle = s.ring + "0.28)";
    ctx.lineWidth = Math.max(1, u);
    ctx.setLineDash([3 * u, 5 * u]);
    circle(ctx, cx, cy, 17 * u);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx - 7 * u, cy - 7 * u);
    ctx.lineTo(cx + 7 * u, cy + 7 * u);
    ctx.moveTo(cx + 7 * u, cy - 7 * u);
    ctx.lineTo(cx - 7 * u, cy + 7 * u);
    ctx.stroke();
  }

  // A line bomb's lane: faint arrowheads on every square its fire will reach.
  for (const bomb of state.bombs) {
    if (bomb.shape !== "line" || !DIRECTIONS[bomb.dir]) continue;
    const v = DIRECTIONS[bomb.dir];
    const s = sideOf(colorOf(bomb.owner));
    const urgency = 1 - Math.max(0, bomb.fuse) / (bomb.fuseMax || BOMB_FUSE_MS);
    ctx.fillStyle = s.ring + (0.1 + 0.22 * urgency).toFixed(3) + ")";
    for (let r = 1; r <= bomb.radius; r += 1) {
      const x = bomb.x + v.dx * r;
      const y = bomb.y + v.dy * r;
      if (x < 0 || x >= cols || y < 0 || y >= rows) break;
      const tile = tiles[y * cols + x];
      if (tile === TILE_WALL) break;
      chevron(ctx, px(x) + cell / 2, py(y) + cell / 2, v, 6 * u);
      ctx.fill();
      if (tile !== TILE_FLOOR) break;
    }
  }

  if (!view.replay) drawAimingAids(ctx, state, now, { cell, u, px, py, cols, rows, colorOf });
  if (!view.replay && view.aim) drawAim(ctx, state, view.aim, now, { cell, u, px, py, colorOf });

  // Blasts — additive bone/ember bloom. The template has a white-hot core, full
  // arms and softer ends, flickering between 72% and 100% every 0.14s.
  const keys = new Set(state.blasts.map((b) => b.x + "," + b.y));
  const flicker = Math.floor(now / 140) % 2 === 0 ? 0.72 : 1;
  ctx.globalCompositeOperation = "lighter";
  for (const blast of state.blasts) {
    const life = Math.max(0, Math.min(1, blast.ttl / BLAST_DURATION_MS));
    const horiz = keys.has(blast.x - 1 + "," + blast.y) || keys.has(blast.x + 1 + "," + blast.y);
    const vert = keys.has(blast.x + "," + (blast.y - 1)) || keys.has(blast.x + "," + (blast.y + 1));
    const neighbours =
      [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => keys.has(blast.x + dx + "," + (blast.y + dy))).length;
    const isCore = blast.core || (horiz && vert);
    const isEnd = !isCore && neighbours <= 1;
    const cx = px(blast.x) + cell / 2;
    const cy = py(blast.y) + cell / 2;
    // Fire kills until the moment it goes out, so it stays near full strength
    // to the end; the fade comes afterwards, in the harmless afterglow below.
    const a = (0.8 + 0.2 * Math.min(1, life / 0.35)) * flicker;
    const R = cell * 0.707; // gradient reaches the tile corners

    if (isCore) {
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 1.4);
      halo.addColorStop(0, `rgba(255,190,100,${0.35 * a})`);
      halo.addColorStop(1, "rgba(255,190,100,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(cx - cell * 1.4, cy - cell * 1.4, cell * 2.8, cell * 2.8);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, `rgba(255,246,226,${a})`);
      g.addColorStop(0.46, `rgba(255,205,120,${0.65 * a})`);
      g.addColorStop(0.78, `rgba(232,163,61,${0.18 * a})`);
      g.addColorStop(1, "rgba(232,163,61,0)");
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      const [inner, outer] = isEnd ? [0.5, 0.16] : [0.72, 0.24];
      g.addColorStop(0, `rgba(255,${isEnd ? 226 : 235},${isEnd ? 170 : 190},${inner * a})`);
      g.addColorStop(isEnd ? 0.7 : 0.72, `rgba(232,163,61,${outer * a})`);
      g.addColorStop(1, "rgba(232,163,61,0)");
      ctx.fillStyle = g;
    }
    ctx.fillRect(px(blast.x), py(blast.y), cell, cell);

    // A blast core that wasn't burning last frame just went off: loose embers.
    if (isCore && !view.lastBlastKeys.has(blast.x + "," + blast.y)) {
      for (let k = 0; k < 3; k += 1) {
        view.embers.push({
          x: cx + (Math.random() - 0.5) * cell * 0.9,
          y: cy + (Math.random() - 0.3) * cell * 0.8,
          r: (3.5 + Math.random() * 1.5) * u,
          life: 0,
          span: 2200 + Math.random() * 900,
          color: Math.random() < 0.5 ? "255,208,138" : "255,183,101",
        });
      }
    }
  }
  for (const key of view.lastBlastKeys) {
    if (keys.has(key)) continue;
    const [x, y] = key.split(",").map(Number);
    view.afterglow.push({ x, y, life: 0 });
  }
  view.lastBlastKeys = keys;

  // Afterglow: a square whose fire has gone out glows on briefly — safe to
  // walk into, and drawn much dimmer than anything that can still hurt.
  for (let i = view.afterglow.length - 1; i >= 0; i -= 1) {
    const g = view.afterglow[i];
    g.life += dt;
    const t = g.life / AFTERGLOW_MS;
    if (t >= 1) {
      view.afterglow.splice(i, 1);
      continue;
    }
    const cx = px(g.x) + cell / 2;
    const cy = py(g.y) + cell / 2;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.707);
    glow.addColorStop(0, `rgba(255,205,140,${(0.3 * (1 - t)).toFixed(3)})`);
    glow.addColorStop(1, "rgba(232,163,61,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(px(g.x), py(g.y), cell, cell);
  }

  // Embers: rise 90 template px, fade in by 20% of their life, out by the end.
  for (let i = view.embers.length - 1; i >= 0; i -= 1) {
    const e = view.embers[i];
    e.life += dt;
    const t = e.life / e.span;
    if (t >= 1) {
      view.embers.splice(i, 1);
      continue;
    }
    const alpha = t < 0.2 ? (t / 0.2) * 0.7 : 0.7 * (1 - (t - 0.2) / 0.8);
    ctx.fillStyle = `rgba(${e.color},${alpha.toFixed(3)})`;
    circle(ctx, e.x, e.y - 90 * u * t, e.r);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Bombs — the template's dark orb with a rim in the owner's colour; the fuse
  // is a thin arc that drains, and the tick quickens with it. An X bomb wears
  // a cross, a line bomb an arrowhead the way it will fire.
  for (const bomb of state.bombs) {
    const s = sideOf(colorOf(bomb.owner));
    const cx = px(bomb.x) + cell / 2;
    const cy = py(bomb.y) + cell / 2;
    const progress = 1 - Math.max(0, bomb.fuse) / (bomb.fuseMax || BOMB_FUSE_MS);
    const tickMs = (700 - 420 * progress) * ((bomb.fuseMax || BOMB_FUSE_MS) / BOMB_FUSE_MS);
    const scale = 1 + 0.065 * (1 - Math.cos((now / tickMs) * Math.PI * 2));
    const d = 38 * u * scale;

    ctx.save();
    ctx.shadowColor = progress > 0.75 ? "rgba(255,120,60,0.55)" : "rgba(240,182,87,0.35)";
    ctx.shadowBlur = 20 * u;
    const body = ctx.createRadialGradient(cx - d * 0.14, cy - d * 0.2, 0, cx - d * 0.14, cy - d * 0.2, d * 0.95);
    body.addColorStop(0, "#5a4a6e");
    body.addColorStop(1, "#1d1728");
    ctx.fillStyle = body;
    circle(ctx, cx, cy, d / 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = s.ring + "0.7)";
    ctx.lineWidth = Math.max(1, u * 1.2);
    circle(ctx, cx, cy, d / 2);
    ctx.stroke();

    if (bomb.shape === "x") {
      ctx.strokeStyle = s.ring + "0.75)";
      ctx.lineWidth = Math.max(1, u * 1.6);
      const k = d * 0.2;
      ctx.beginPath();
      ctx.moveTo(cx - k, cy - k);
      ctx.lineTo(cx + k, cy + k);
      ctx.moveTo(cx + k, cy - k);
      ctx.lineTo(cx - k, cy + k);
      ctx.stroke();
    } else if (bomb.shape === "line" && DIRECTIONS[bomb.dir]) {
      ctx.fillStyle = s.ring + "0.85)";
      chevron(ctx, cx, cy, DIRECTIONS[bomb.dir], d * 0.24);
      ctx.fill();
    }

    ctx.strokeStyle = progress > 0.75 ? "rgba(255,150,90,0.9)" : "rgba(240,182,87,0.75)";
    ctx.lineWidth = Math.max(1.5, u * 2.2);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2 + 6 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  // Decoys — to the other team, exactly the player they copy. Your own team
  // sees them see-through, so nobody fools themselves.
  const liveDecoys = new Set();
  for (const decoy of state.decoys || []) {
    const owner = players[decoy.owner];
    if (!owner) continue;
    const key = "d" + decoy.owner;
    liveDecoys.add(key);
    const at = smoothed(view, key, decoy, dt);
    drawFigure(ctx, px(at.x) + cell / 2, py(at.y) + cell / 2, u, sideOf(owner.color), now, {
      ghost: mine(owner.team),
      sigil: sigilOf(owner.team),
    });
  }
  for (const key of [...view.motion.keys()]) {
    if (key[0] === "d" && !liveDecoys.has(key)) {
      const gone = view.motion.get(key);
      addPuff(view, gone.x, gone.y, colorOf(Number(key.slice(1))));
      view.motion.delete(key);
    }
  }

  // Players. A hidden enemy Shade arrives with no position at all; your own
  // hidden Shade is drawn as a ghost. Vanishing and reappearing leave a puff.
  for (const player of players) {
    const key = "p" + player.index;
    const was = view.seen.get(key);
    if (!player.alive) {
      // The moment someone is hit, show them where the engine had them — on
      // the burning square — even if their figure was still gliding onto it.
      // (A fatality has its own picture of the victim.)
      const fatality = state.finish && state.finish.type === "fatality";
      if (was && was !== "dead" && !fatality) {
        const from = view.motion.get(key);
        const kill = (state.kills || []).filter((k) => k.victim === player.index).pop();
        const at = kill || player;
        if (at.x !== null && at.x !== undefined) {
          view.deaths.push({
            x: at.x,
            y: at.y,
            fromX: from ? from.x : at.x,
            fromY: from ? from.y : at.y,
            color: player.color,
            life: 0,
          });
        }
      }
      view.motion.delete(key); // so the next round snaps instead of sliding
      view.seen.set(key, "dead");
      continue;
    }
    if (player.x === null || player.x === undefined) {
      const last = view.motion.get(key);
      if (last && was !== "gone" && was !== "dead") addPuff(view, last.x, last.y, player.color);
      view.motion.delete(key);
      view.seen.set(key, "gone");
      continue;
    }
    const nowSeen = player.hidden ? "ghost" : "shown";
    if (was && was !== nowSeen && was !== "dead") addPuff(view, player.x, player.y, player.color);
    view.seen.set(key, nowSeen);

    const s = sideOf(player.color);
    const at = smoothed(view, key, player, dt);
    const cx = px(at.x) + cell / 2;
    const cy = py(at.y) + cell / 2;
    const blinking = player.invulnIn > 0 && Math.floor(now / 110) % 2 === 0;
    drawFigure(ctx, cx, cy, u, s, now, {
      alpha: blinking ? 0.45 : 1,
      ghost: player.hidden,
      sigil: sigilOf(player.team),
    });

    // A line bomber shows which way it faces — that is where its fire goes.
    if (player.facing && DIRECTIONS[player.facing] && classOf(player).pattern === "line") {
      const v = DIRECTIONS[player.facing];
      ctx.fillStyle = s.ring + "0.8)";
      chevron(ctx, cx + v.dx * 27 * u, cy + v.dy * 27 * u, v, 5 * u);
      ctx.fill();
    }

    // Grace arc after a shield absorbed a hit.
    if (player.invulnIn > 0) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = s.hi;
      ctx.lineWidth = Math.max(1.5, u * 1.6);
      ctx.beginPath();
      ctx.arc(cx, cy, 26 * u, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (player.invulnIn / (player.invulnMax || ABSORB_GRACE_MS)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // A hit: the figure finishes its step onto the square that burned it, flares
  // white and comes apart.
  for (let i = view.deaths.length - 1; i >= 0; i -= 1) {
    const d = view.deaths[i];
    d.life += dt;
    const t = d.life / DEATH_MS;
    if (t >= 1) {
      view.deaths.splice(i, 1);
      continue;
    }
    const s = sideOf(d.color);
    const k = Math.min(1, d.life / 70);
    const cx = px(d.fromX + (d.x - d.fromX) * k) + cell / 2;
    const cy = py(d.fromY + (d.y - d.fromY) * k) + cell / 2;
    const size = 40 * u * (1 - 0.55 * t);
    ctx.save();
    ctx.globalAlpha = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = 30 * u;
    ctx.fillStyle = orbGradient(ctx, cx - size / 2, cy - size / 2, size, ["#fff4e2", s.hi, s.core]);
    circle(ctx, cx, cy, size / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = s.ring + (0.9 * (1 - t)).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, 2.4 * u * (1 - t));
    circle(ctx, cx, cy, (20 + 34 * t) * u);
    ctx.stroke();
    ctx.restore();
  }

  // Puffs: a ring that widens and fades where a figure blinked in or out.
  for (let i = view.puffs.length - 1; i >= 0; i -= 1) {
    const p = view.puffs[i];
    p.life += dt;
    const t = p.life / PUFF_MS;
    if (t >= 1) {
      view.puffs.splice(i, 1);
      continue;
    }
    const s = sideOf(p.color);
    const cx = px(p.x) + cell / 2;
    const cy = py(p.y) + cell / 2;
    ctx.strokeStyle = s.ring + (0.7 * (1 - t)).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, 2 * u * (1 - t));
    circle(ctx, cx, cy, (14 + 22 * t) * u);
    ctx.stroke();
    ctx.fillStyle = s.ring + (0.18 * (1 - t)).toFixed(3) + ")";
    circle(ctx, cx, cy, (10 + 14 * t) * u);
    ctx.fill();
  }

  // Kill cam: a reticle on the square where the round was decided.
  if (view.replay && view.mark) {
    const s = sideOf(view.mark.color);
    const cx = px(view.mark.x) + cell / 2;
    const cy = py(view.mark.y) + cell / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 120);
    ctx.save();
    ctx.strokeStyle = s.ring + (0.55 + 0.35 * pulse).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1.2, 1.6 * u);
    ctx.setLineDash([5 * u, 4 * u]);
    circle(ctx, cx, cy, cell * 0.78);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * cell * 0.55, cy + dy * cell * 0.55);
      ctx.lineTo(cx + dx * cell * 1.0, cy + dy * cell * 1.0);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawFatality(ctx, state, now, dt, view, { cell, u, px, py, bw, bh, colorOf });
}

// Where the bomb you are lining up would land, and what it would burn.
function drawAim(ctx, state, aim, now, { cell, u, px, py, colorOf }) {
  const player = state.players[aim.index];
  if (!player || !player.alive || state.phase !== "live") return;
  const bomb = bombPreview(state, aim.index, aim);
  const side = sideOf(colorOf(aim.index));
  const pulse = 0.5 + 0.5 * Math.sin(now / 220);
  ctx.save();
  if (!bomb) {
    // No shot from here: a crossed-out square where the pointer is.
    ctx.strokeStyle = "rgba(230,222,210,0.3)";
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeRect(px(aim.x) + 6 * u, py(aim.y) + 6 * u, cell - 12 * u, cell - 12 * u);
    ctx.restore();
    return;
  }
  // The squares its fire would take.
  ctx.fillStyle = side.ring + (0.1 + 0.05 * pulse).toFixed(3) + ")";
  for (const square of fireSquares(state, bomb)) {
    ctx.fillRect(px(square.x), py(square.y), cell, cell);
  }
  // …and where it would come down.
  const cx = px(bomb.x) + cell / 2;
  const cy = py(bomb.y) + cell / 2;
  ctx.strokeStyle = side.ring + (0.55 + 0.35 * pulse).toFixed(3) + ")";
  ctx.lineWidth = Math.max(1, 1.6 * u);
  circle(ctx, cx, cy, cell * 0.3);
  ctx.stroke();
  ctx.setLineDash([3 * u, 4 * u]);
  ctx.beginPath();
  ctx.moveTo(px(player.x) + cell / 2, py(player.y) + cell / 2);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.restore();
}

// The live board's helpers for whoever is playing: a sniper's firing solution
// and the fatality zone. Never shown in a replay.
function drawAimingAids(ctx, state, now, { cell, u, px, py, cols, rows, colorOf }) {
  // Sniper firing solution: the dashed "empty slot" outline around the target.
  for (const player of state.players) {
    const targets = sniperTargets(state, player.index);
    if (!targets || targets.length === 0) continue;
    const s = sideOf(colorOf(player.index));
    ctx.save();
    ctx.strokeStyle = s.ring + (0.32 + 0.12 * Math.sin(now / 300)).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, u);
    ctx.setLineDash([4 * u, 4 * u]);
    const inset = 8 * u;
    for (const c of targets) {
      ctx.strokeRect(px(c.x) + inset, py(c.y) + inset, cell - inset * 2, cell - inset * 2);
    }
    ctx.restore();
  }

  // Fatality zone: from a 4 streak the ground within FATALITY_RANGE of each
  // enemy in sight is marked in the hunter's colour — dashed while out of
  // reach, solid and pulsing once the hunter is inside it. From 5 the enemies
  // themselves are marked. One marking per team, from its best-placed hunter.
  const RANK = { anywhere: 3, near: 2, far: 1 };
  const best = new Map(); // team -> { hunter, offer }
  for (const hunter of state.players) {
    const offer = fatalityReady(state, hunter.index);
    if (!offer) continue;
    const current = best.get(hunter.team);
    if (!current || RANK[offer] > RANK[current.offer]) best.set(hunter.team, { hunter, offer });
  }
  for (const { hunter, offer } of best.values()) {
    const side = sideOf(colorOf(hunter.index));
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    const prey = state.players.filter((p) => p.team !== hunter.team && p.x !== null && p.x !== undefined &&
      (state.phase !== "live" || (p.alive && !p.hidden)));
    for (const target of prey) {
      ctx.save();
      if (offer === "anywhere") {
        const cx = px(target.x) + cell / 2;
        const cy = py(target.y) + cell / 2;
        ctx.strokeStyle = side.ring + (0.55 + 0.4 * pulse).toFixed(3) + ")";
        ctx.lineWidth = Math.max(1.5, 2 * u);
        circle(ctx, cx, cy, cell * (0.62 + 0.08 * pulse));
        ctx.stroke();
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(cx + dx * cell * 0.45, cy + dy * cell * 0.45);
          ctx.lineTo(cx + dx * cell * 0.9, cy + dy * cell * 0.9);
        }
        ctx.stroke();
      } else {
        const x0 = Math.max(0, target.x - FATALITY_RANGE);
        const y0 = Math.max(0, target.y - FATALITY_RANGE);
        const x1 = Math.min(cols - 1, target.x + FATALITY_RANGE);
        const y1 = Math.min(rows - 1, target.y + FATALITY_RANGE);
        const X = px(x0), Y = py(y0), W = (x1 - x0 + 1) * cell, H = (y1 - y0 + 1) * cell;
        const near = offer === "near";
        ctx.fillStyle = side.ring + (near ? 0.08 + 0.07 * pulse : 0.04).toFixed(3) + ")";
        ctx.fillRect(X, Y, W, H);
        ctx.strokeStyle = side.ring + (near ? 0.55 + 0.35 * pulse : 0.35).toFixed(3) + ")";
        ctx.lineWidth = Math.max(1, (near ? 2 : 1.2) * u);
        if (!near) ctx.setLineDash([6 * u, 5 * u]);
        ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
      }
      ctx.restore();
    }
  }
}

// The finishing move: the board darkens, a sigil in the hunter's colour closes
// around the victim while their orb trembles, then it shatters — flash, a
// shockwave and a burst of embers. Purely a picture of state.finish.
function drawFatality(ctx, state, now, dt, view, { cell, u, px, py, bw, bh, colorOf }) {
  const fin = state.finish && state.finish.type === "fatality" ? state.finish : null;
  if (!fin) {
    view.fatalityAt = null;
    view.burst.length = 0;
    return;
  }
  if (view.fatalityAt === null) view.fatalityAt = now;
  const t = now - view.fatalityAt;
  const hunter = sideOf(colorOf(fin.by));
  const prey = sideOf(colorOf(fin.victim));
  const vx = px(fin.x) + cell / 2;
  const vy = py(fin.y) + cell / 2;

  ctx.fillStyle = `rgba(7,6,10,${Math.min(0.62, (t / 700) * 0.62).toFixed(3)})`;
  ctx.fillRect(px(0), py(0), bw, bh);

  if (t < FATALITY_SHATTER_MS) {
    const k = t / FATALITY_SHATTER_MS;
    const R = cell * (3.2 - 2.3 * k);
    ctx.save();
    ctx.shadowColor = hunter.glow;
    ctx.shadowBlur = 18 * u;
    ctx.strokeStyle = hunter.ring + (0.5 + 0.5 * k).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1.5, 2.2 * u);
    circle(ctx, vx, vy, R);
    ctx.stroke();
    ctx.translate(vx, vy);
    ctx.rotate(k * Math.PI * 1.5);
    ctx.strokeRect(-R * 0.7, -R * 0.7, R * 1.4, R * 1.4);
    ctx.restore();

    const shake = 3.5 * u * k * k;
    const ox = vx + (Math.random() - 0.5) * 2 * shake;
    const oy = vy + (Math.random() - 0.5) * 2 * shake;
    const d = 40 * u;
    ctx.save();
    ctx.shadowColor = prey.glow;
    ctx.shadowBlur = 26 * u;
    ctx.fillStyle = orbGradient(ctx, ox - d / 2, oy - d / 2, d, [prey.hi, prey.core, prey.lo]);
    circle(ctx, ox, oy, d / 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const k = t - FATALITY_SHATTER_MS;
  if (!view.burst.length && k < 100) {
    const colors = [hunter.core, hunter.hi, prey.core, "#fff1dc"];
    for (let i = 0; i < 56; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (90 + Math.random() * 360) * u;
      view.burst.push({
        x: vx,
        y: vy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: (2 + Math.random() * 3.5) * u,
        life: 0,
        span: 900 + Math.random() * 1100,
        color: colors[i % colors.length],
      });
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (k < 260) {
    ctx.fillStyle = `rgba(255,236,200,${(0.5 * (1 - k / 260)).toFixed(3)})`;
    ctx.fillRect(px(0), py(0), bw, bh);
  }
  const wave = Math.max(0, 1 - k / 900);
  if (wave > 0) {
    ctx.strokeStyle = hunter.ring + (0.85 * wave).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1.5, 3 * u * wave);
    circle(ctx, vx, vy, cell * (0.9 + (k / 1000) * 9));
    ctx.stroke();
  }
  for (let i = view.burst.length - 1; i >= 0; i -= 1) {
    const e = view.burst[i];
    e.life += dt;
    if (e.life >= e.span) {
      view.burst.splice(i, 1);
      continue;
    }
    const drag = Math.exp(-dt / 420);
    e.vx *= drag;
    e.vy = e.vy * drag - 14 * u * (dt / 1000) * 60 * 0.05; // embers drift upward as they slow
    e.x += (e.vx * dt) / 1000;
    e.y += (e.vy * dt) / 1000;
    ctx.globalAlpha = 1 - e.life / e.span;
    ctx.fillStyle = e.color;
    circle(ctx, e.x, e.y, e.r);
    ctx.fill();
  }
  ctx.restore();
}
