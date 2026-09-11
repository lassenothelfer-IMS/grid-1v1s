// On-screen controls for phones and tablets: a D-pad under one thumb, bomb and
// fatality buttons under the other. They call the same handlers as the
// keyboard, so a tap steps once, holding keeps walking, and sliding your thumb
// to another arrow turns — exactly like pressing a second key.
//
// The D-pad reads direction from where the finger is relative to its centre,
// in screen coordinates. That is what makes table mode work for free: player 1's
// strip is rotated 180°, so "away from you" on their pad is screen-down, which
// is also board-down, which is away from their spawn.

import { fatalityReady } from "/shared/engine.js";
import { FATALITY_STREAK } from "/shared/constants.js";

const PLAYER_NAMES = ["Player 1", "Player 2"];

// True on phones and tablets. `?touch` in the URL forces it (handy for testing
// on a desktop); a keyboard keeps working either way.
export function isTouchDevice() {
  if (new URLSearchParams(location.search).has("touch")) return true;
  return window.matchMedia("(pointer: coarse)").matches;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Builds one player's control strip inside `host`.
// handlers: { onMove(player, dir), onHold(player, dir|null), onBomb(player), onFatality(player) }
export function createTouchPad(host, { player, rotated, handlers }) {
  const strip = el("div", "touch-strip" + (rotated ? " rotated" : ""));
  strip.setAttribute("data-player", String(player));

  // --- D-pad ------------------------------------------------------------------
  const dpad = el("div", "dpad");
  dpad.setAttribute("aria-label", "Move");
  const arrows = {};
  for (const [dir, glyph] of [["up", "▲"], ["right", "▶"], ["down", "▼"], ["left", "◀"]]) {
    arrows[dir] = el("span", "dpad-arrow " + dir, glyph);
    dpad.append(arrows[dir]);
  }
  dpad.append(el("span", "dpad-hub"));

  // --- status and buttons -----------------------------------------------------
  const side = el("div", "touch-side");
  const hud = el("div", "touch-hud");
  const hudName = el("div", "touch-name", PLAYER_NAMES[player]);
  const hudLives = el("div", "touch-lives");
  const hudStreak = el("div", "touch-streak");
  hud.append(hudName, hudLives, hudStreak);

  const buttons = el("div", "touch-buttons");
  const fatal = el("button", "touch-btn fatal locked");
  fatal.type = "button";
  fatal.setAttribute("aria-label", "Fatality");
  fatal.append(el("span", "glyph", "✠"), el("span", "count", ""));
  const bomb = el("button", "touch-btn bomb");
  bomb.type = "button";
  bomb.setAttribute("aria-label", "Bomb");
  bomb.append(el("span", "glyph", "◉"), el("span", "count", ""));
  buttons.append(fatal, bomb);
  side.append(hud, buttons);

  strip.append(dpad, side);
  host.replaceChildren(strip);

  // --- D-pad input ----------------------------------------------------------------
  const fingers = new Map(); // pointerId -> direction under that finger (or null)

  function directionAt(event) {
    const box = dpad.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < box.width * 0.13) return null; // resting on the hub
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
  }

  function showActive() {
    const held = [...fingers.values()].filter(Boolean);
    const current = held.length ? held[held.length - 1] : null;
    for (const [dir, node] of Object.entries(arrows)) node.classList.toggle("on", dir === current);
    return current;
  }

  function onDown(event) {
    event.preventDefault();
    // Keep following this finger when it slides off the pad. Capturing can
    // throw for a pointer the browser has already dropped — never let that
    // swallow the move itself.
    try {
      dpad.setPointerCapture(event.pointerId);
    } catch {
      /* the move still counts */
    }
    const dir = directionAt(event);
    fingers.set(event.pointerId, dir);
    if (dir) handlers.onMove(player, dir);
    showActive();
  }

  function onMoveFinger(event) {
    if (!fingers.has(event.pointerId)) return;
    const dir = directionAt(event);
    if (dir === fingers.get(event.pointerId)) return;
    fingers.set(event.pointerId, dir);
    // Sliding onto a new arrow is a fresh press; sliding back to the hub lets go.
    if (dir) handlers.onMove(player, dir);
    else handlers.onHold(player, showActive());
    showActive();
  }

  function onUp(event) {
    if (!fingers.has(event.pointerId)) return;
    fingers.delete(event.pointerId);
    handlers.onHold(player, showActive());
  }

  dpad.addEventListener("pointerdown", onDown);
  dpad.addEventListener("pointermove", onMoveFinger);
  dpad.addEventListener("pointerup", onUp);
  dpad.addEventListener("pointercancel", onUp);
  dpad.addEventListener("lostpointercapture", onUp);

  // --- buttons: act on touch-down, not on release ------------------------------
  function press(button, action) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      action();
      button.classList.remove("hit");
      void button.offsetWidth;
      button.classList.add("hit");
    });
  }
  press(bomb, () => handlers.onBomb(player));
  press(fatal, () => handlers.onFatality(player));

  // --- per-frame refresh, only touching the DOM when something changed ---------
  let lastKey = "";
  function update(state, { maxBombs }) {
    const me = state.players[player];
    if (!me) return;
    const offer = fatalityReady(state, player);
    const fatalState = offer === "near" || offer === "anywhere" ? "ready" : me.streak >= FATALITY_STREAK ? "far" : "locked";
    const live = state.bombs.filter((b) => b.owner === player).length;
    const free = Math.max(0, maxBombs - live);
    const key = [me.lives, state.maxLives, me.streak, fatalState, free, me.alive].join("|");
    if (key === lastKey) return;
    lastKey = key;

    hudLives.replaceChildren(
      ...Array.from({ length: state.maxLives }, (_, n) => el("span", n < me.lives ? "seg on" : "seg")),
    );
    hudStreak.textContent = me.streak >= 2 ? me.streak + " streak" : "";
    fatal.className = "touch-btn fatal " + fatalState;
    fatal.querySelector(".count").textContent = Math.min(me.streak, FATALITY_STREAK) + "/" + FATALITY_STREAK;
    bomb.classList.toggle("empty", free === 0);
    bomb.querySelector(".count").textContent = String(free);
  }

  return {
    update,
    destroy() {
      fingers.clear();
      host.replaceChildren();
    },
  };
}
