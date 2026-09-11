// Keyboard handling. One press = one square: key repeat from a held key is
// dropped, so you cannot slide across the board by leaning on a key.

export const LOCAL_SCHEMES = [
  { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"], bomb: ["Space"] },
  {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    bomb: ["Enter", "NumpadEnter"],
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
  },
];

const SWALLOW = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export function createInput(schemes, { onMove, onBomb }) {
  const moveKeys = new Map(); // code -> { slot, dir }
  const bombKeys = new Map(); // code -> slot

  schemes.forEach((scheme, slot) => {
    for (const dir of ["up", "down", "left", "right"]) {
      for (const code of scheme[dir]) moveKeys.set(code, { slot, dir });
    }
    for (const code of scheme.bomb) bombKeys.set(code, slot);
  });

  function onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (SWALLOW.has(event.code)) event.preventDefault();
    // The OS auto-repeat is what "holding to move" would ride on. Drop it.
    if (event.repeat) return;

    const bombSlot = bombKeys.get(event.code);
    if (bombSlot !== undefined) onBomb(bombSlot);

    const binding = moveKeys.get(event.code);
    if (binding) onMove(binding.slot, binding.dir);
  }

  window.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
