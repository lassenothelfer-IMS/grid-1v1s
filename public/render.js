// Canvas renderer, Nocturne "Arena · Sigil" direction. Reads game state,
// writes pixels — no game logic here. Colours, sizes and animation timings are
// taken from the design project's templates/arena-sigil.

import {
  COLS,
  ROWS,
  SPAWNS,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  ABSORB_GRACE_MS,
  TILE_WALL,
  FATALITY_RANGE,
} from "/shared/constants.js";
import { sniperTargets, fatalityReady } from "/shared/engine.js";

// The template draws on a 64px cell; everything here is expressed as a
// fraction of that so it scales with the board.
const T = 64;

const SIDES = [
  { // ember
    core: "#e8a33d",
    hi: "#ffe0ad",
    lo: "#8e5417",
    ring: "rgba(232,163,61,",
    glow: "rgba(232,163,61,0.65)",
    rim: "rgba(255,240,210,0.7)",
    pulseMs: 1900,
  },
  { // violet
    core: "#c0a8ff",
    hi: "#efe6ff",
    lo: "#5e4b9c",
    ring: "rgba(192,168,255,",
    glow: "rgba(192,168,255,0.6)",
    rim: "rgba(240,234,255,0.7)",
    pulseMs: 2300,
  },
];

// Grid positions are integers, but figures glide between them. This is purely
// cosmetic: the engine only ever knows the whole square a player is on.
const SMOOTH_TAU_MS = 34;
const SNAP_DISTANCE = 1.6; // further than one step means a new round, not a walk
const motion = new Map();  // player index -> { x, y } in fractional cells
let lastFrameAt = null;

// Embers drifting up out of fresh blasts (template: emberDrift, 90px over ~2.4s).
const embers = [];
let lastBlastKeys = new Set();

// Crates that were on the board last frame, so a broken one can shatter.
let lastCrates = new Map(); // id -> { x0, y0, x1, y1 } in cells
const shatters = [];        // { box, life }
const SHATTER_MS = 420;
let lastRound = null;       // a new round wipes last round's embers and flashes

// The fatality finish: when it was first seen, and its shatter burst.
const FATALITY_SHATTER_MS = 750;
let fatalityAt = null;
const burst = [];           // { x, y, vx, vy, r, life, span, color }

export function resetMotion() {
  motion.clear();
  embers.length = 0;
  shatters.length = 0;
  lastBlastKeys = new Set();
  lastCrates = new Map();
  lastRound = null;
  fatalityAt = null;
  burst.length = 0;
  lastFrameAt = null;
}

// Bounding box of every crate on the board, keyed by crate id.
function cratesOf(tiles) {
  const boxes = new Map();
  if (!tiles) return boxes;
  for (let i = 0; i < tiles.length; i += 1) {
    const id = tiles[i];
    if (id <= 0) continue;
    const x = i % COLS;
    const y = Math.floor(i / COLS);
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

function smoothed(player, dt) {
  const previous = motion.get(player.index);
  if (!previous || Math.hypot(player.x - previous.x, player.y - previous.y) > SNAP_DISTANCE) {
    const snapped = { x: player.x, y: player.y };
    motion.set(player.index, snapped);
    return snapped;
  }
  // Frame-rate independent exponential ease toward the true square.
  const t = 1 - Math.exp(-dt / SMOOTH_TAU_MS);
  previous.x += (player.x - previous.x) * t;
  previous.y += (player.y - previous.y) * t;
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

export function draw(canvas, state, now = performance.now()) {
  const dt = lastFrameAt === null ? 16 : Math.min(now - lastFrameAt, 100);
  lastFrameAt = now;

  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const cell = Math.min(width / COLS, height / ROWS);
  const u = cell / T; // one template pixel
  const offsetX = (width - cell * COLS) / 2;
  const offsetY = (height - cell * ROWS) / 2;
  const px = (cx) => offsetX + cx * cell;
  const py = (cy) => offsetY + cy * cell;
  const bw = cell * COLS;
  const bh = cell * ROWS;

  // Ground: #17131f with 1px bone grid lines at 5.5%.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#17131f";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(230,222,210,0.055)";
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let c = 1; c < COLS; c += 1) {
    ctx.moveTo(Math.round(px(c)) + 0.5, py(0));
    ctx.lineTo(Math.round(px(c)) + 0.5, py(ROWS));
  }
  for (let r = 1; r < ROWS; r += 1) {
    ctx.moveTo(px(0), Math.round(py(r)) + 0.5);
    ctx.lineTo(px(COLS), Math.round(py(r)) + 0.5);
  }
  ctx.stroke();

  // Spawn pockets, in the template's relic-slot treatment.
  SPAWNS.forEach((spawn, i) => {
    const s = SIDES[i];
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
  const half = (ref * (232 / 448)) / 2;
  ctx.strokeStyle = "rgba(192,168,255,0.13)";
  ctx.beginPath();
  ctx.moveTo(midX, midY - half * Math.SQRT2);
  ctx.lineTo(midX + half * Math.SQRT2, midY);
  ctx.lineTo(midX, midY + half * Math.SQRT2);
  ctx.lineTo(midX - half * Math.SQRT2, midY);
  ctx.closePath();
  ctx.stroke();

  // Inner vignette (template: inset 0 0 90px rgba(0,0,0,.55)).
  const vig = ctx.createRadialGradient(midX, midY, ref * 0.35, midX, midY, Math.hypot(bw, bh) / 2);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(px(0), py(0), bw, bh);

  if (!state) {
    lastBlastKeys = new Set();
    lastCrates = new Map();
    return;
  }

  if (state.round !== lastRound) {
    lastRound = state.round;
    embers.length = 0;
    shatters.length = 0;
  }

  const tiles = state.tiles || [];
  const wallAt = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && tiles[y * COLS + x] === TILE_WALL;

  // Walls — the template's raised stone: a cool 160° gradient, a lit top edge
  // and a shadowed base. Neighbouring wall squares fuse into one piece, so the
  // edges are only drawn where the piece ends.
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (tiles[y * COLS + x] !== TILE_WALL) continue;
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
  const crates = cratesOf(tiles);
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

  // A crate that was here last frame and is gone now just broke.
  for (const [id, box] of lastCrates) {
    if (crates.has(id)) continue;
    shatters.push({ box, life: 0 });
    const squares = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
    for (let k = 0; k < 3 * squares; k += 1) {
      embers.push({
        x: px(box.x0) + Math.random() * (box.x1 - box.x0 + 1) * cell,
        y: py(box.y0) + Math.random() * (box.y1 - box.y0 + 1) * cell,
        r: (2.5 + Math.random() * 2) * u,
        life: 0,
        span: 1400 + Math.random() * 900,
        color: Math.random() < 0.5 ? "232,163,61" : "255,208,138",
      });
    }
  }
  lastCrates = crates;

  // Shatter flash: the broken box's rim flares and expands as it fades.
  for (let i = shatters.length - 1; i >= 0; i -= 1) {
    const s = shatters[i];
    s.life += dt;
    const t = s.life / SHATTER_MS;
    if (t >= 1) {
      shatters.splice(i, 1);
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

  // Sniper firing solution: the dashed "empty slot" outline around the target.
  for (const player of state.players) {
    const targets = sniperTargets(state, player.index);
    if (!targets || targets.length === 0) continue;
    const s = SIDES[player.index];
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

  // Fatality zone: from a 4 streak the ground within FATALITY_RANGE of the prey
  // is marked in the hunter's colour — dashed while out of reach, solid and
  // pulsing once the hunter is inside it. From 5 the prey itself is marked.
  for (const hunter of state.players) {
    const offer = fatalityReady(state, hunter.index);
    if (!offer) continue;
    const prey = state.players[hunter.index === 0 ? 1 : 0];
    const side = SIDES[hunter.index];
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    ctx.save();
    if (offer === "anywhere") {
      const cx = px(prey.x) + cell / 2;
      const cy = py(prey.y) + cell / 2;
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
      const x0 = Math.max(0, prey.x - FATALITY_RANGE);
      const y0 = Math.max(0, prey.y - FATALITY_RANGE);
      const x1 = Math.min(COLS - 1, prey.x + FATALITY_RANGE);
      const y1 = Math.min(ROWS - 1, prey.y + FATALITY_RANGE);
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
    const isCore = horiz && vert;
    const isEnd = !isCore && neighbours <= 1;
    const cx = px(blast.x) + cell / 2;
    const cy = py(blast.y) + cell / 2;
    // Full strength while it can still hurt you; it only fades in its last third.
    const a = Math.min(1, life / 0.35) * flicker;
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
    if (isCore && !lastBlastKeys.has(blast.x + "," + blast.y)) {
      for (let k = 0; k < 3; k += 1) {
        embers.push({
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
  lastBlastKeys = keys;

  // Embers: rise 90 template px, fade in by 20% of their life, out by the end.
  for (let i = embers.length - 1; i >= 0; i -= 1) {
    const e = embers[i];
    e.life += dt;
    const t = e.life / e.span;
    if (t >= 1) {
      embers.splice(i, 1);
      continue;
    }
    const alpha = t < 0.2 ? (t / 0.2) * 0.7 : 0.7 * (1 - (t - 0.2) / 0.8);
    ctx.fillStyle = `rgba(${e.color},${alpha.toFixed(3)})`;
    circle(ctx, e.x, e.y - 90 * u * t, e.r);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Bombs — the template's dark orb with an ember rim. Rim takes the owner's
  // colour; the fuse is a thin arc that drains, and the tick quickens with it.
  for (const bomb of state.bombs) {
    const s = SIDES[bomb.owner];
    const cx = px(bomb.x) + cell / 2;
    const cy = py(bomb.y) + cell / 2;
    const progress = 1 - Math.max(0, bomb.fuse) / BOMB_FUSE_MS;
    const tickMs = 700 - 420 * progress;
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

    ctx.strokeStyle = progress > 0.75 ? "rgba(255,150,90,0.9)" : "rgba(240,182,87,0.75)";
    ctx.lineWidth = Math.max(1.5, u * 2.2);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2 + 6 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  // Players — luminous orbs inside a slowly breathing sigil ring.
  for (const player of state.players) {
    if (!player.alive) {
      motion.delete(player.index); // so the next round snaps instead of sliding
      continue;
    }
    const s = SIDES[player.index];
    const at = smoothed(player, dt);
    const cx = px(at.x) + cell / 2;
    const cy = py(at.y) + cell / 2;
    const blinking = player.invulnIn > 0 && Math.floor(now / 110) % 2 === 0;
    ctx.globalAlpha = blinking ? 0.45 : 1;

    // sigilPulse: scale .94 → 1.06, opacity .5 → 1
    const phase = (1 - Math.cos((now / s.pulseMs) * Math.PI * 2)) / 2;
    ctx.strokeStyle = s.ring + (0.5 * (0.5 + 0.5 * phase)).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, u);
    circle(ctx, cx, cy, 30 * u * (0.94 + 0.12 * phase));
    ctx.stroke();

    const d = 40 * u;
    ctx.save();
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = 26 * u;
    ctx.fillStyle = orbGradient(ctx, cx - d / 2, cy - d / 2, d, [s.hi, s.core, s.lo]);
    circle(ctx, cx, cy, d / 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = s.rim;
    ctx.lineWidth = Math.max(1, u);
    circle(ctx, cx, cy, d / 2 - 0.5);
    ctx.stroke();

    // Grace arc after a shield absorbed a hit.
    if (player.invulnIn > 0) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = s.hi;
      ctx.lineWidth = Math.max(1.5, u * 1.6);
      ctx.beginPath();
      ctx.arc(cx, cy, 26 * u, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (player.invulnIn / (player.invulnMax || ABSORB_GRACE_MS)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawFatality(ctx, state, now, dt, { cell, u, px, py, bw, bh });
}

// The finishing move: the board darkens, a sigil in the hunter's colour closes
// around the victim while their orb trembles, then it shatters — flash, a
// shockwave and a burst of embers. Purely a picture of state.finish.
function drawFatality(ctx, state, now, dt, { cell, u, px, py, bw, bh }) {
  const fin = state.finish && state.finish.type === "fatality" ? state.finish : null;
  if (!fin) {
    fatalityAt = null;
    burst.length = 0;
    return;
  }
  if (fatalityAt === null) fatalityAt = now;
  const t = now - fatalityAt;
  const hunter = SIDES[fin.by];
  const prey = SIDES[fin.victim];
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
  if (!burst.length && k < 100) {
    const colors = [hunter.core, hunter.hi, prey.core, "#fff1dc"];
    for (let i = 0; i < 56; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (90 + Math.random() * 360) * u;
      burst.push({
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
  for (let i = burst.length - 1; i >= 0; i -= 1) {
    const e = burst[i];
    e.life += dt;
    if (e.life >= e.span) {
      burst.splice(i, 1);
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
