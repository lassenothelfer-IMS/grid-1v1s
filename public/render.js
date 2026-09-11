// Canvas renderer. Reads game state, writes pixels — no game logic here.

import {
  COLS,
  ROWS,
  SPAWNS,
  BOMB_FUSE_MS,
  BLAST_DURATION_MS,
  INVULN_MS,
} from "/shared/constants.js";
import { sniperTargets } from "/shared/engine.js";

const PLAYER_COLORS = [
  { fill: "#62a8e5", edge: "#a9d3f6", glow: "rgba(98,168,229,0.45)" },
  { fill: "#ec6b86", edge: "#ffb3c2", glow: "rgba(236,107,134,0.45)" },
];

// Grid positions are integers, but figures glide between them. This is purely
// cosmetic: the engine only ever knows the whole square a player is on.
const SMOOTH_TAU_MS = 34;
const SNAP_DISTANCE = 1.6; // further than one step means a respawn, not a walk
const motion = new Map();  // player index -> { x, y } in fractional cells
let lastFrameAt = null;

export function resetMotion() {
  motion.clear();
  lastFrameAt = null;
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function draw(canvas, state, now = performance.now()) {
  const dt = lastFrameAt === null ? 16 : Math.min(now - lastFrameAt, 100);
  lastFrameAt = now;

  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const cell = Math.min(width / COLS, height / ROWS);
  const offsetX = (width - cell * COLS) / 2;
  const offsetY = (height - cell * ROWS) / 2;
  const px = (cx) => offsetX + cx * cell;
  const py = (cy) => offsetY + cy * cell;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0a0e15";
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.fillStyle = "#111825";
  ctx.fillRect(px(0), py(0), cell * COLS, cell * ROWS);
  ctx.strokeStyle = "#1b2433";
  ctx.lineWidth = Math.max(1, cell * 0.02);
  for (let c = 0; c <= COLS; c += 1) {
    ctx.beginPath();
    ctx.moveTo(px(c), py(0));
    ctx.lineTo(px(c), py(ROWS));
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r += 1) {
    ctx.beginPath();
    ctx.moveTo(px(0), py(r));
    ctx.lineTo(px(COLS), py(r));
    ctx.stroke();
  }

  // Spawn pockets
  SPAWNS.forEach((spawn, i) => {
    ctx.fillStyle = i === 0 ? "rgba(98,168,229,0.12)" : "rgba(236,107,134,0.12)";
    ctx.fillRect(px(spawn.x), py(spawn.y), cell, cell);
  });

  if (!state) return;

  // Sniper firing solution: the 8 squares a shot would land in, shown only
  // while the shooter is actually far enough away to take it.
  for (const player of state.players) {
    const targets = sniperTargets(state, player.index);
    if (!targets || targets.length === 0) continue;
    const colors = PLAYER_COLORS[player.index];
    ctx.save();
    ctx.strokeStyle = colors.edge;
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(now / 260);
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.setLineDash([cell * 0.16, cell * 0.14]);
    for (const cellPos of targets) {
      const inset = cell * 0.16;
      roundRect(ctx, px(cellPos.x) + inset, py(cellPos.y) + inset,
        cell - inset * 2, cell - inset * 2, cell * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Blasts
  for (const blast of state.blasts) {
    const life = Math.max(0, Math.min(1, blast.ttl / BLAST_DURATION_MS));
    const inset = cell * 0.06 * (1 - life);
    const gradient = ctx.createRadialGradient(
      px(blast.x) + cell / 2, py(blast.y) + cell / 2, cell * 0.05,
      px(blast.x) + cell / 2, py(blast.y) + cell / 2, cell * 0.7,
    );
    // Keep a floor on the alpha so dying fire still reads as lethal, not as scorch.
    gradient.addColorStop(0, `rgba(255,244,214,${0.35 + 0.6 * life})`);
    gradient.addColorStop(0.45, `rgba(255,150,48,${0.3 + 0.6 * life})`);
    gradient.addColorStop(1, `rgba(255,70,40,${0.15 + 0.35 * life})`);
    ctx.fillStyle = gradient;
    roundRect(ctx, px(blast.x) + inset, py(blast.y) + inset, cell - inset * 2, cell - inset * 2, cell * 0.18);
    ctx.fill();
  }

  // Bombs
  for (const bomb of state.bombs) {
    const cx = px(bomb.x) + cell / 2;
    const cy = py(bomb.y) + cell / 2;
    const progress = 1 - Math.max(0, bomb.fuse) / BOMB_FUSE_MS;
    // Tighter pulse as the fuse runs out — the 1.5s is meant to be felt.
    const pulse = 1 + 0.12 * Math.sin(now / (90 - 55 * progress));
    const radius = cell * 0.3 * pulse;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + cell * 0.06, radius * 0.95, radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10151f";
    ctx.strokeStyle = PLAYER_COLORS[bomb.owner].fill;
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Fuse ring drains clockwise from 12 o'clock.
    ctx.strokeStyle = progress > 0.75 ? "#ff6b3d" : "#f4d35e";
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius + cell * 0.11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  // Players
  for (const player of state.players) {
    if (!player.alive) {
      motion.delete(player.index); // so the respawn snaps instead of sliding
      continue;
    }
    const at = smoothed(player, dt);
    const colors = PLAYER_COLORS[player.index];
    const blinking = player.invulnIn > 0 && Math.floor(now / 110) % 2 === 0;
    ctx.globalAlpha = blinking ? 0.45 : 1;

    const pad = cell * 0.14;
    const x = px(at.x) + pad;
    const y = py(at.y) + pad;
    const size = cell - pad * 2;

    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = cell * 0.5;
    ctx.fillStyle = colors.fill;
    roundRect(ctx, x, y, size, size, cell * 0.22);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = Math.max(1, cell * 0.045);
    roundRect(ctx, x, y, size, size, cell * 0.22);
    ctx.stroke();

    // Spawn-grace arc, so "why didn't that kill them" is always visible.
    if (player.invulnIn > 0) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.beginPath();
      ctx.arc(
        px(at.x) + cell / 2,
        py(at.y) + cell / 2,
        cell * 0.44,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (player.invulnIn / INVULN_MS),
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
