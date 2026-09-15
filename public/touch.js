// On-screen controls for phones and tablets: a D-pad under one thumb, bomb,
// ability and fatality buttons under the other. They call the same handlers
// as the keyboard, so a tap steps once, holding keeps walking, and sliding your
// thumb to another arrow turns — exactly like pressing a second key.
//
// The D-pad reads direction from where the finger is relative to its centre,
// in screen coordinates. That is what makes table mode work for free: player 1's
// strip is rotated 180°, so "away from you" on their pad is screen-down, which
// is also board-down, which is away from their spawn.

import { fatalityReady, classOf } from "/shared/engine.js";
import { FATALITY_STREAK } from "/shared/constants.js";
import { paint } from "/palette.js";

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

function button(className, label, glyph) {
  const node = el("button", "touch-btn " + className);
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.append(el("span", "glyph", glyph), el("span", "count", ""));
  return node;
}

// Builds one player's control strip inside `host`.
// handlers: { onMove(player, dir), onHold(player, dir|null), onBomb(player),
//             onAbility(player), onFatality(player) }
export function createTouchPad(host, { player, rotated, handlers }) {
  const strip = el("div", "touch-strip" + (rotated ? " rotated" : ""));

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
  const hudName = el("div", "touch-name", "");
  const hudLives = el("div", "touch-lives");
  const hudStreak = el("div", "touch-streak");
  hud.append(hudName, hudLives, hudStreak);

  const buttons = el("div", "touch-buttons");
  const fatal = button("fatal locked", "Fatality", "✠");
  const skill = button("skill", "Ability", "◎");
  skill.hidden = true;
  const bomb = button("bomb", "Bomb", "◉");
  buttons.append(fatal, skill, bomb);
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
  function press(node, action) {
    node.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      action();
      node.classList.remove("hit");
      void node.offsetWidth;
      node.classList.add("hit");
    });
  }
  press(bomb, () => handlers.onBomb(player));
  press(skill, () => handlers.onAbility?.(player));
  press(fatal, () => handlers.onFatality(player));

  // --- per-frame refresh, only touching the DOM when something changed ---------
  let lastKey = "";
  function update(state) {
    const me = state.players[player];
    if (!me) return;
    const stats = classOf(me);
    const offer = fatalityReady(state, player);
    const fatalState = offer === "near" || offer === "anywhere" ? "ready" : me.streak >= FATALITY_STREAK ? "far" : "locked";
    const live = state.bombs.filter((b) => b.owner === player).length;
    const free = Math.max(0, stats.maxBombs - live);
    const cooldown = Math.ceil((me.abilityCd || 0) / 1000);
    const key = [me.name, me.color, me.lives, state.maxLives, me.streak, fatalState, free, me.alive, stats.ability, cooldown].join("|");
    if (key === lastKey) return;
    lastKey = key;

    paint(strip, me.color);
    hudName.textContent = me.name;
    hudLives.replaceChildren(
      ...Array.from({ length: state.maxLives }, (_, n) => el("span", n < me.lives ? "seg on" : "seg")),
    );
    hudStreak.textContent = me.streak >= 2 ? me.streak + " streak" : "";
    fatal.className = "touch-btn fatal " + fatalState;
    fatal.querySelector(".count").textContent = Math.min(me.streak, FATALITY_STREAK) + "/" + FATALITY_STREAK;
    skill.hidden = !stats.ability;
    skill.classList.toggle("cooling", cooldown > 0);
    skill.querySelector(".count").textContent = cooldown > 0 ? cooldown + "s" : "";
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
