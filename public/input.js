// Keyboard handling. A press steps once immediately (onMove); what stays held
// is reported separately (onHold) and the engine turns it into a steady walk.
// Each player keeps a press stack so the newest held direction wins — hold
// left, add up, and releasing up drops you back to walking left.
//
// OS key auto-repeat is ignored: its rate differs per machine, so the walking
// rhythm is timed by the engine instead (HOLD_DELAY_MS / HOLD_REPEAT_MS).
// Keys are matched by physical position (event.code), so they sit in the same
// place on QWERTY and QWERTZ keyboards.

export const LOCAL_SCHEMES = [
  {
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    bomb: ["Space"],
    fatality: ["KeyX"],
    ability: ["KeyE"],
  },
  {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    bomb: ["Enter", "NumpadEnter"],
    fatality: ["ShiftRight"], // X belongs to player 1's side of the keyboard
    ability: ["Period", "ControlRight", "Numpad0"],
  },
];

// Online: you only drive one player, so both key sets do the same thing.
export const ONLINE_SCHEMES = [
  {
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    bomb: ["Space", "Enter", "NumpadEnter"],
    fatality: ["KeyX"],
    ability: ["KeyE", "Period"],
  },
];

// How the keys above read in the legend and the HUD.
export const KEY_LABELS = {
  local: [
    { move: "W A S D", bomb: "Space", fatality: "X", ability: "E" },
    { move: "Arrows", bomb: "Enter", fatality: "R-Shift", ability: ". / R-Ctrl" },
  ],
  online: { move: "WASD / Arrows", bomb: "Space / Enter", fatality: "X", ability: "E / ." },
};

const SWALLOW = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export function createInput(schemes, { onMove, onHold, onBomb, onFatality, onAbility }) {
  const moveKeys = new Map(); // code -> { slot, dir }
  const bombKeys = new Map(); // code -> slot
  const fatalityKeys = new Map(); // code -> slot
  const abilityKeys = new Map(); // code -> slot
  const stacks = schemes.map(() => []);

  schemes.forEach((scheme, slot) => {
    for (const dir of ["up", "down", "left", "right"]) {
      for (const code of scheme[dir]) moveKeys.set(code, { slot, dir });
    }
    for (const code of scheme.bomb) bombKeys.set(code, slot);
    for (const code of scheme.fatality || []) fatalityKeys.set(code, slot);
    for (const code of scheme.ability || []) abilityKeys.set(code, slot);
  });

  function topOf(slot) {
    const stack = stacks[slot];
    return stack.length ? stack[stack.length - 1] : null;
  }

  function onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (SWALLOW.has(event.code)) event.preventDefault();
    if (event.repeat) return;

    const bombSlot = bombKeys.get(event.code);
    if (bombSlot !== undefined) onBomb(bombSlot);

    const fatalitySlot = fatalityKeys.get(event.code);
    if (fatalitySlot !== undefined) onFatality?.(fatalitySlot);

    const abilitySlot = abilityKeys.get(event.code);
    if (abilitySlot !== undefined) onAbility?.(abilitySlot);

    const binding = moveKeys.get(event.code);
    if (!binding) return;
    const stack = stacks[binding.slot];
    const at = stack.indexOf(binding.dir);
    if (at !== -1) stack.splice(at, 1);
    stack.push(binding.dir);
    onMove(binding.slot, binding.dir);
  }

  function onKeyUp(event) {
    const binding = moveKeys.get(event.code);
    if (!binding) return;
    const stack = stacks[binding.slot];
    const at = stack.indexOf(binding.dir);
    if (at === -1) return;
    stack.splice(at, 1);
    onHold(binding.slot, topOf(binding.slot));
  }

  // A lost focus must not leave a direction stuck down.
  function onBlur() {
    stacks.forEach((stack, slot) => {
      if (!stack.length) return;
      stack.length = 0;
      onHold(slot, null);
    });
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
