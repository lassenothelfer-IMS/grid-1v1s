// What each player colour looks like. The ids are shared with the server
// (shared/constants.js COLOR_IDS); the paint lives here. Ember and violet are
// the Nocturne originals; the rest are tuned to sit beside them on the dark
// board.

export const PALETTE = {
  ember: { name: "Ember", core: "#e8a33d", hi: "#ffe0ad", lo: "#8e5417", text: "#f0b657", rgb: "232,163,61", rim: "rgba(255,240,210,0.7)", pulseMs: 1900 },
  violet: { name: "Violet", core: "#c0a8ff", hi: "#efe6ff", lo: "#5e4b9c", text: "#c0a8ff", rgb: "192,168,255", rim: "rgba(240,234,255,0.7)", pulseMs: 2300 },
  jade: { name: "Jade", core: "#5fd4a0", hi: "#d6ffea", lo: "#1f6b4c", text: "#7fe0b4", rgb: "95,212,160", rim: "rgba(220,255,238,0.7)", pulseMs: 2100 },
  frost: { name: "Frost", core: "#7cc4f4", hi: "#e3f4ff", lo: "#2c5f86", text: "#9ad2f7", rgb: "124,196,244", rim: "rgba(228,244,255,0.7)", pulseMs: 2500 },
  crimson: { name: "Crimson", core: "#e8607a", hi: "#ffd6de", lo: "#7c2336", text: "#f08195", rgb: "232,96,122", rim: "rgba(255,226,232,0.7)", pulseMs: 1700 },
  pearl: { name: "Pearl", core: "#e9e1d4", hi: "#ffffff", lo: "#857c70", text: "#efe7da", rgb: "233,225,212", rim: "rgba(255,255,255,0.75)", pulseMs: 2700 },
};

export const paletteOf = (color) => PALETTE[color] || PALETTE.ember;

// Gives an element a player's colour as CSS custom properties (--pc, --pc-rgb,
// --pc-hi, --pc-lo, --pc-text). Everything inside it inherits them.
export function paint(node, color) {
  const c = paletteOf(color);
  node.style.setProperty("--pc", c.core);
  node.style.setProperty("--pc-rgb", c.rgb);
  node.style.setProperty("--pc-hi", c.hi);
  node.style.setProperty("--pc-lo", c.lo);
  node.style.setProperty("--pc-text", c.text);
  return node;
}
