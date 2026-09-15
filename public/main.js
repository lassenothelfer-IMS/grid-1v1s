// App shell: menu, class selection, the render loop, and the two ways a match
// can be driven — locally (engine runs here) or online (engine runs on the server).

import {
  createGame,
  step,
  requestMove,
  setHeld,
  requestBomb,
  requestAbility,
  requestFatality,
  fatalityReady,
} from "/shared/engine.js";
import {
  PROTOCOL,
  SELF_SHIELDS,
  CLASSES,
  CLASS_IDS,
  DEFAULT_CLASS,
  MODES,
  MODE_IDS,
  DEFAULT_MODE,
  FORMATS,
  FORMAT_IDS,
  DEFAULT_FORMAT,
  COLOR_IDS,
  DEFAULT_COLORS,
  NAME_MAX,
  cleanName,
  defaultName,
  teamOfIndex,
  STREAK_SHOWN_FROM,
  FATALITY_STREAK,
  FATALITY_RANGE,
  FATALITY_ANYWHERE_STREAK,
} from "/shared/constants.js";
import { draw, fitCanvas, resetMotion, setViewer, createView } from "/render.js";
import { createInput, LOCAL_SCHEMES, ONLINE_SCHEMES, KEY_LABELS } from "/input.js";
import { connect } from "/net.js";
import { isTouchDevice, createTouchPad } from "/touch.js";
import { PALETTE, paletteOf, paint } from "/palette.js";

const app = document.getElementById("app");
const canvas = document.getElementById("board");
const boardWrap = document.querySelector(".board-wrap");
const overlay = document.getElementById("overlay");
const panel = document.getElementById("panel");
const legend = document.getElementById("legend");
const modeLabel = document.getElementById("mode-label");
const roomLabel = document.getElementById("room-label");
const clockEl = document.getElementById("clock");
const teamEls = [document.getElementById("team-0"), document.getElementById("team-1")];
const abilitiesEl = document.getElementById("abilities");
const feedEl = document.getElementById("feed");
const statusEl = document.getElementById("status");
const pipsEl = document.getElementById("pips");
const roundLabel = document.getElementById("round-label");
const calloutEl = document.getElementById("callout");
const calloutKicker = document.getElementById("callout-kicker");
const calloutMain = document.getElementById("callout-main");
const streakEl = document.getElementById("streak");
const streakName = document.getElementById("streak-name");
const streakCount = document.getElementById("streak-count");
const streakNote = document.getElementById("streak-note");
const promptEl = document.getElementById("prompt");
const camEl = document.getElementById("cam");
const camCaption = document.getElementById("cam-caption");
const touchHosts = [document.getElementById("touch-0"), document.getElementById("touch-1")];

// Phones and tablets get on-screen controls; the keyboard keeps working anyway.
const touchMode = isTouchDevice();
app.classList.toggle("touch", touchMode);
if (touchMode) {
  // Safari ignores maximum-scale; this is what actually stops pinch-zoom mid-fight.
  document.addEventListener("gesturestart", (event) => event.preventDefault());
}

const session = {
  mode: null,      // null | "local" | "online"
  state: null,     // the game state being rendered
  classes: [DEFAULT_CLASS, DEFAULT_CLASS],
  gameMode: DEFAULT_MODE, // "blitz" | "siege"
  format: DEFAULT_FORMAT, // "duel" (1v1) | "teams" (2v2, online only)
  killCam: true,
  input: null,
  socket: null,
  slot: -1,
  code: null,
  overShown: false,
  overAt: 0,      // when the match ended, so a fatality or kill cam can play out first
  pads: [],       // on-screen control strips: { player, pad }
  reconnect: null,    // { until, timer } while trying to get our seat back
  lost: new Map(),    // seat -> when its grace runs out, while that player is gone
  lobby: null,        // the latest 2v2 lobby, until the match starts
  cam: null,          // the kill cam while it plays
};

// Your seat in an online room — code and secret token — kept per browser tab,
// so a dropped connection, or a tab iOS reloaded in the background, can take
// the same seat back.
const SEAT_KEY = "grid1v1.seat";
const RECONNECT_WINDOW_MS = 30000;
function saveSeat(seat) {
  try { sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat)); } catch { /* private mode */ }
}
function loadSeat() {
  try { return JSON.parse(sessionStorage.getItem(SEAT_KEY) || "null"); } catch { return null; }
}
function clearSeat() {
  try { sessionStorage.removeItem(SEAT_KEY); } catch { /* private mode */ }
}

// Names and colours, remembered on this device: one profile for online play,
// one per player for local play.
const PROFILE_KEY = "grid1v1.profile";
const LOCAL_KEY = "grid1v1.local";
function loadStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function profileFrom(saved, index) {
  return {
    name: cleanName(saved && saved.name),
    color: saved && COLOR_IDS.includes(saved.color) ? saved.color : DEFAULT_COLORS[index],
  };
}
const onlineProfile = profileFrom(loadStored(PROFILE_KEY, null), 0);
const localProfiles = [0, 1].map((i) => profileFrom(loadStored(LOCAL_KEY, [])[i], i));
function saveProfiles() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(onlineProfile));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(localProfiles));
  } catch { /* private mode */ }
}

// One glyph per class, borrowed from the template's relic set.
const CLASS_GLYPHS = {
  classic: "◉", speedy: "↯", sniper: "⌖", tank: "❖",
  quickfuse: "✹", diagonal: "✕", line: "➤", shade: "☾", decoy: "◎",
};
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const PRESS = touchMode ? "tap" : "press"; // how the fatality is triggered, in prompts
const FATALITY_SHOW_MS = 2600; // the fatality plays out before the result card

// --- who is who -------------------------------------------------------------

const nameOf = (index) => (session.state && session.state.players[index] && session.state.players[index].name) || defaultName(index);
const colorOf = (index) => (session.state && session.state.players[index] && session.state.players[index].color) || DEFAULT_COLORS[index];
const isTeams = (state) => Boolean(state && state.format === "teams");
const leadOf = (state, team) => state.players.find((p) => p.team === team);
const teamName = (state, team) => state.players.filter((p) => p.team === team).map((p) => p.name).join(" & ");
const streakWord = (state) => (isTeams(state) ? " round streak" : " kill streak");

// Is this seat played from this screen? (Both are, in local play.)
const controls = (index) => session.mode !== "online" || index === session.slot;
const keysFor = (index) => (session.mode === "online" ? KEY_LABELS.online : KEY_LABELS.local[index] || KEY_LABELS.local[0]);
const shortKey = (label) => label.split(" / ")[0];
const fatalityKeyOf = (index) => (touchMode ? "✠" : shortKey(keysFor(index).fatality));

// --- small DOM helpers ------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-") || key.startsWith("aria-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of [].concat(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function painted(node, color) {
  return paint(node, color);
}

function showPanel(nodes, { wide = false } = {}) {
  panel.className = wide === "mid" ? "panel mid" : wide ? "panel wide" : "panel";
  panel.removeAttribute("style");
  panel.replaceChildren(...nodes);
  overlay.hidden = false;
}

function hidePanel() {
  overlay.hidden = true;
}

function statsOf(className) {
  return CLASSES[className] || CLASSES[DEFAULT_CLASS];
}

// The chips on a class card, read straight from the class numbers. The ones
// that set the class apart get the accent.
function classTags(stats) {
  const tags = [{ text: stats.maxBombs + (stats.maxBombs === 1 ? " bomb" : " bombs") }];
  if (stats.pattern === "line") tags.push({ text: "Full line", key: true });
  else if (stats.pattern === "x") tags.push({ text: "X · radius " + stats.blastRadius, key: true });
  else tags.push({ text: "Radius " + stats.blastRadius });
  if (stats.fuseMs) tags.push({ text: stats.fuseMs / 1000 + " s fuse", key: true });
  if (stats.delivery === "remote") tags.push({ text: "Range " + stats.minRange + "+", key: true });
  if (stats.shields > 0) tags.push({ text: 1 + stats.shields + " hits", key: true });
  if (stats.stealth) tags.push({ text: "Vanishes", key: true });
  if (stats.ability) tags.push({ text: "Ability", key: true });
  if (!tags.some((t) => t.key)) tags[stats.maxBombs > 2 ? 0 : 1].key = true;
  return tags;
}

// --- teardown ---------------------------------------------------------------

function leaveSession() {
  session.input?.destroy();
  session.input = null;
  unmountPads();
  keepAwake(false);
  stopReconnect();
  stopCam();
  session.lost.clear();
  session.lobby = null;
  clearSeat();
  const link = session.socket;
  session.socket = null;
  session.mode = null;
  if (link) {
    link.send({ type: "leave" }); // on purpose: the room can close now
    link.close();
  }
  session.state = null;
  session.slot = -1;
  session.code = null;
  session.overShown = false;
  session.overAt = 0;
  app.classList.remove("in-match", "teams");
  roomLabel.hidden = true;
  modeLabel.textContent = "A duel on the grid";
  setLegend([]);
  feed.length = 0;
  lastSeen = null;
  showCallout(null);
  lastStreaks = [0, 0];
  streakEl.hidden = true;
  setPrompt(null);
  boardWrap.classList.remove("quake");
  resetMotion();
  setViewer(null);
  camBuffer.length = 0;
  camWatch = null;
}

// --- menu -------------------------------------------------------------------

function menuItem(num, label, hint, onclick) {
  return el("button", { className: "menu-item", onclick }, [
    el("span", { className: "num" }, num),
    el("span", { className: "label" }, label),
    el("span", { className: "hint" }, hint),
  ]);
}

function showMenu(error) {
  leaveSession();
  showPanel([
    el("div", { className: "kicker" }, "Grid 1v1"),
    el("h2", {}, "New duel"),
    el("p", { className: "lede" },
      "Bombs go off after 1.5 seconds. Your own bombs only cost you a life on the second hit."),
    ...(typeof error === "string" ? [el("p", { className: "error" }, error)] : []),
    el("div", { className: "menu-list" }, [
      menuItem("01", "Local", "1 device", () => showModePicker({
        online: false,
        onBack: () => showMenu(),
        onPick: (mode) => pickLocalClasses(mode),
      })),
      menuItem("02", "Create room", "Online · 1v1 or 2v2", () => showModePicker({
        online: true,
        onBack: () => showMenu(),
        onPick: (mode) => pickHostClass(mode),
      })),
      menuItem("03", "Join room", "Online", () => showJoinForm()),
    ]),
  ]);
}

// --- mode selection ---------------------------------------------------------

// A row of mutually exclusive buttons: [[value, label], …].
function segmented(label, choices, current, onChange) {
  const buttons = choices.map(([value, text]) => {
    const b = el("button", { type: "button", className: value === current ? "seg on" : "seg" }, text);
    b.addEventListener("click", () => {
      buttons.forEach((other) => other.classList.toggle("on", other === b));
      onChange(value);
    });
    return b;
  });
  return el("div", { className: "option-row" }, [
    el("span", { className: "kicker" }, label),
    el("div", { className: "segmented" }, buttons),
  ]);
}

function showModePicker({ online, onPick, onBack }) {
  const cards = MODE_IDS.map((id, i) => {
    const mode = MODES[id];
    const rounds = 2 * mode.lives - 1;
    const reachesFatality = mode.lives > FATALITY_STREAK;
    return el("button", { className: "slot-card", onclick: () => onPick(id) }, [
      el("div", { className: "slot-top" }, [
        el("span", { className: "kicker" }, "Mode " + ROMAN[i]),
        el("span", { className: "slot-glyph roman", "aria-hidden": "true" }, ROMAN[mode.lives - 1]),
      ]),
      el("div", { className: "slot-name" }, mode.name),
      el("div", { className: "slot-desc" }, mode.blurb),
      el("div", { className: "tags" }, [
        el("span", { className: "tag key" }, mode.lives + " lives"),
        el("span", { className: "tag" }, "Up to " + rounds + " rounds"),
        ...(reachesFatality ? [el("span", { className: "tag" }, "Fatality")] : []),
      ]),
    ]);
  });

  if (!online) session.format = "duel"; // 2v2 needs four devices
  const options = [
    ...(online
      ? [segmented("Format", FORMAT_IDS.map((id) => [id, FORMATS[id].name]), session.format, (v) => { session.format = v; })]
      : []),
    segmented("Kill cam", [["on", "On"], ["off", "Off"]], session.killCam ? "on" : "off",
      (v) => { session.killCam = v === "on"; }),
  ];

  showPanel([
    el("div", { className: "panel-head" }, [
      el("h2", {}, "Choose a mode"),
      el("span", { className: "kicker" }, "How many lives the duel runs on"),
    ]),
    el("div", { className: "rule-h" }),
    el("div", { className: "options" }, options),
    el("div", { className: "loadout modes" }, cards),
    el("div", {}, [el("button", { onclick: onBack }, "Back")]),
  ], { wide: "mid" });
}

// --- class selection --------------------------------------------------------

// One reusable picker in the template's loadout layout: your name and colour
// on top, then a card per class. `profile` is edited in place. In local play
// the classes that make no sense on a shared screen are locked.
function showClassPicker({ profile, who = null, takenColor = null, local = false, onPick, onBack }) {
  const nameField = el("input", {
    type: "text",
    className: "name-field",
    maxLength: NAME_MAX,
    placeholder: who || "Your name",
    value: profile.name || "",
    autocomplete: "off",
    spellcheck: false,
    "aria-label": "Name",
  });
  const commit = () => {
    profile.name = cleanName(nameField.value);
    saveProfiles();
  };
  nameField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") nameField.blur();
  });

  if (!COLOR_IDS.includes(profile.color) || profile.color === takenColor) {
    profile.color = COLOR_IDS.find((c) => c !== takenColor);
  }
  const swatches = COLOR_IDS.map((id) => {
    const b = el("button", {
      type: "button",
      className: "swatch",
      title: PALETTE[id].name + (id === takenColor ? " — taken" : ""),
      disabled: id === takenColor,
      "aria-label": PALETTE[id].name,
    });
    painted(b, id);
    b.addEventListener("click", () => {
      profile.color = id;
      refresh();
    });
    return b;
  });
  const refresh = () => {
    swatches.forEach((b, i) => b.classList.toggle("on", COLOR_IDS[i] === profile.color));
    painted(panel, profile.color);
  };

  const cards = CLASS_IDS.map((id, i) => {
    const stats = CLASSES[id];
    const locked = local && stats.onlineOnly;
    return el("button", {
      className: locked ? "slot-card locked" : "slot-card",
      disabled: locked,
      title: locked ? "Online only — on a shared screen there is nobody to hide from" : "",
      onclick: () => {
        commit();
        onPick(id);
      },
    }, [
      el("div", { className: "slot-top" }, [
        el("span", { className: "kicker" }, "Class " + ROMAN[i]),
        el("span", { className: "slot-glyph", "aria-hidden": "true" }, CLASS_GLYPHS[id] || "◉"),
      ]),
      el("div", { className: "slot-name" }, stats.name),
      el("div", { className: "slot-desc" }, stats.blurb),
      el("div", { className: "tags" }, [
        ...classTags(stats).map((t) => el("span", { className: t.key ? "tag key" : "tag" }, t.text)),
        ...(locked ? [el("span", { className: "tag" }, "Online only")] : []),
      ]),
    ]);
  });

  showPanel([
    el("div", { className: "panel-head" }, [
      el("h2", {}, "Choose a class"),
      el("span", { className: "kicker" }, "One class per duel"),
      ...(who ? [el("span", { className: "kicker who" }, who)] : []),
    ]),
    el("div", { className: "profile-row" }, [
      el("div", { className: "orb", "aria-hidden": "true" }),
      nameField,
      el("div", { className: "swatches", role: "group", "aria-label": "Colour" }, swatches),
    ]),
    el("div", { className: "rule-h" }),
    el("div", { className: "loadout" }, cards),
    el("div", {}, [el("button", { onclick: () => { commit(); onBack(); } }, "Back")]),
  ], { wide: true });
  refresh();
}

function pickLocalClasses(mode = session.gameMode) {
  showClassPicker({
    profile: localProfiles[0],
    who: "Player 1",
    local: true,
    onBack: () => showModePicker({ online: false, onBack: () => showMenu(), onPick: (m) => pickLocalClasses(m) }),
    onPick: (first) =>
      showClassPicker({
        profile: localProfiles[1],
        who: "Player 2",
        local: true,
        takenColor: localProfiles[0].color,
        onBack: () => pickLocalClasses(mode),
        onPick: (second) => startLocal([first, second], mode),
      }),
  });
}

function pickHostClass(mode) {
  showClassPicker({
    profile: onlineProfile,
    onBack: () => showModePicker({ online: true, onBack: () => showMenu(), onPick: (m) => pickHostClass(m) }),
    onPick: (className) => startOnlineHost(className, mode),
  });
}

function showJoinForm(error) {
  const field = el("input", { type: "text", maxLength: 4, placeholder: "CODE", autocomplete: "off" });
  const submit = () => {
    const code = field.value.trim().toUpperCase();
    if (code.length !== 4) {
      showJoinForm("The code has 4 characters.");
      return;
    }
    showClassPicker({
      profile: onlineProfile,
      onBack: () => showJoinForm(),
      onPick: (className) => startOnlineGuest(code, className),
    });
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });

  showPanel([
    el("div", { className: "kicker" }, "Online"),
    el("h2", {}, "Join room"),
    el("p", { className: "lede" }, "Enter the 4-character code from the host."),
    ...(typeof error === "string" ? [el("p", { className: "error" }, error)] : []),
    field,
    el("div", { className: "row" }, [
      el("button", { onclick: () => showMenu() }, "Back"),
      el("button", { className: "primary", onclick: submit }, "Next"),
    ]),
  ]);
  field.focus();
}

// The rows of the Controls list for the seats played from this screen.
function legendRowsFor(indices, classes) {
  return indices.flatMap((i) => {
    const keys = keysFor(i);
    return [
      { player: i, key: keys.move, what: "Move" },
      { player: i, key: keys.bomb, what: "Bomb" },
      ...(statsOf(classes[i]).ability ? [{ player: i, key: keys.ability, what: "Decoy" }] : []),
      { player: i, key: keys.fatality, what: "Fatality" },
    ];
  });
}

// --- local mode -------------------------------------------------------------

function startLocal(classes, mode) {
  const chosen = classes || session.classes;
  const gameMode = mode || session.gameMode;
  leaveSession();
  session.mode = "local";
  session.classes = chosen;
  session.gameMode = gameMode;
  session.format = "duel";
  session.state = createGame({
    mode: gameMode,
    killCam: session.killCam,
    players: [0, 1].map((i) => ({ className: chosen[i], name: localProfiles[i].name, color: localProfiles[i].color })),
  });
  const handlers = {
    onMove: (slot, dir) => requestMove(session.state, slot, dir),
    onHold: (slot, dir) => setHeld(session.state, slot, dir),
    onBomb: (slot) => requestBomb(session.state, slot),
    onAbility: (slot) => requestAbility(session.state, slot),
    onFatality: (slot) => requestFatality(session.state, slot),
  };
  session.input = createInput(LOCAL_SCHEMES, handlers);
  // Table mode: each player's controls on their own edge, player 1's facing them.
  if (touchMode) {
    app.classList.add("table");
    mountPad(0, touchHosts[0], true, handlers);
    mountPad(1, touchHosts[1], false, handlers);
  }
  enterMatch(MODES[gameMode].name + " · Local duel", [["Local"], ["1 device"]]);
  setLegend(legendRowsFor([0, 1], chosen));
}

// --- online mode ------------------------------------------------------------

// Opens the connection for the current online session. If it drops while
// that session is still on, we try to take the seat back.
function dial(onReady) {
  const link = connect({
    onOpen: () => onReady(link),
    onClose: () => {
      if (session.socket === link && session.mode === "online") connectionDropped();
    },
    onMessage: handleServerMessage,
  });
  session.socket = link;
  return link;
}

function openSocket(onReady) {
  leaveSession();
  session.mode = "online";
  dial(onReady);
}

// --- reconnecting -----------------------------------------------------------

function connectionDropped() {
  if (!loadSeat()) {
    showMenu("Connection lost.");
    return;
  }
  if (!session.reconnect) session.reconnect = { until: Date.now() + RECONNECT_WINDOW_MS, timer: null };
  showReconnecting();
  scheduleReconnect(1200);
}

function scheduleReconnect(delay) {
  if (!session.reconnect) return;
  clearTimeout(session.reconnect.timer);
  session.reconnect.timer = setTimeout(tryReconnect, delay);
}

function tryReconnect() {
  const seat = loadSeat();
  if (!session.reconnect || !seat) return;
  if (Date.now() > session.reconnect.until) {
    stopReconnect();
    session.mode = null;
    clearSeat();
    showMenu("Couldn't reconnect — the match is over.");
    return;
  }
  dial((link) => link.send({ type: "resume", code: seat.code, token: seat.token }));
}

function stopReconnect() {
  if (session.reconnect) clearTimeout(session.reconnect.timer);
  session.reconnect = null;
}

function showReconnecting() {
  showPanel([
    el("div", { className: "kicker" }, "Connection lost"),
    el("h2", {}, "Reconnecting…"),
    el("p", { className: "lede" }, "Your seat is held for a few seconds — keep the game open."),
    el("button", { onclick: () => showMenu() }, "Leave match"),
  ]);
}

// Coming back to the app is the best moment to try again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && session.reconnect) scheduleReconnect(0);
});

// A page that was reloaded mid-match (iOS does this to background tabs).
function resumeSavedSeat() {
  session.mode = "online";
  session.reconnect = { until: Date.now() + RECONNECT_WINDOW_MS, timer: null };
  showPanel([el("div", { className: "kicker" }, "Online"), el("h2", {}, "Rejoining your match…")]);
  tryReconnect();
}

function startOnlineHost(className, mode) {
  showPanel([el("div", { className: "kicker" }, "Online"), el("h2", {}, "Connecting…")]);
  const { format, killCam } = session;
  openSocket((link) => link.send({
    type: "create", className, mode, format, killCam, name: onlineProfile.name, color: onlineProfile.color,
  }));
}

function startOnlineGuest(code, className) {
  showPanel([el("div", { className: "kicker" }, "Online"), el("h2", {}, "Connecting…")]);
  openSocket((link) => link.send({
    type: "join", code, className, name: onlineProfile.name, color: onlineProfile.color,
  }));
}

// Everything a match needs on this screen, from a "start" or a resume.
function setupOnlineMatch(message) {
  session.overShown = false;
  session.classes = message.classes || session.classes;
  session.gameMode = message.mode || session.gameMode;
  session.format = message.format || session.format;
  session.overAt = 0;
  session.lobby = null;
  boardWrap.classList.remove("quake");
  resetMotion();
  setViewer({ index: session.slot, team: teamOfIndex(session.slot) });
  stopCam();
  camBuffer.length = 0;
  camWatch = null;
  feed.length = 0;
  lastSeen = null;
  lastStreaks = [0, 0];
  session.input?.destroy();
  unmountPads();
  const handlers = {
    onMove: (_slot, dir) => session.socket?.send({ type: "move", dir }),
    onHold: (_slot, dir) => session.socket?.send({ type: "hold", dir }),
    onBomb: () => session.socket?.send({ type: "bomb" }),
    onAbility: () => session.socket?.send({ type: "ability" }),
    onFatality: () => session.socket?.send({ type: "fatality" }),
  };
  session.input = createInput(ONLINE_SCHEMES, handlers);
  if (touchMode) mountPad(session.slot, touchHosts[1], false, handlers);
  const format = FORMATS[session.format].name;
  app.classList.toggle("teams", session.format === "teams");
  enterMatch(MODES[session.gameMode].name + " · Online " + format, [["Online " + format], ["Room " + (session.code || "")]]);
  setLegend(legendRowsFor([session.slot], session.classes));
}

// The 2v2 lobby: four seats, two per side. Anyone can move to an open seat;
// the host starts once all four are in.
function showLobby(lobby) {
  const me = lobby.slot;
  const isHost = lobby.host === me;
  const full = lobby.seats.every((s) => s && s.connected);
  const seatRow = (i) => {
    const seat = lobby.seats[i];
    if (!seat) {
      return el("button", { className: "lobby-seat empty", onclick: () => session.socket?.send({ type: "seat", to: i }) }, [
        el("span", { className: "orb hollow" }),
        el("span", { className: "lobby-name" }, "Open seat"),
        el("span", { className: "hint" }, "Sit here"),
      ]);
    }
    const tags = [statsOf(seat.className).name, i === me ? "You" : "", i === lobby.host ? "Host" : "", seat.connected ? "" : "Away"];
    return painted(el("div", { className: "lobby-seat" + (seat.connected ? "" : " away") + (i === me ? " me" : "") }, [
      el("span", { className: "orb" }),
      el("span", { className: "lobby-name" }, seat.name),
      el("span", { className: "hint" }, tags.filter(Boolean).join(" · ")),
    ]), seat.color);
  };
  showPanel([
    el("div", { className: "kicker" }, "Room " + lobby.code + " · 2v2 · " + MODES[lobby.mode].name),
    el("h2", {}, full ? "Everyone's here" : "Waiting for players"),
    el("p", { className: "lede" }, "Share the code. Pick a side by sitting in one of its open seats."),
    el("div", { className: "code" }, lobby.code),
    el("div", { className: "lobby" }, [0, 1].map((team) => el("div", { className: "lobby-team" }, [
      el("div", { className: "kicker" }, team === 0 ? "Top side" : "Bottom side"),
      seatRow(team),
      seatRow(team + 2),
    ]))),
    isHost
      ? el("button", { className: "primary", disabled: !full, onclick: () => session.socket?.send({ type: "start" }) },
        full ? "Start match" : "Waiting for 4 players")
      : el("p", { className: "lede" }, full ? "Waiting for the host to start." : "The host starts once all four are in."),
    el("button", { onclick: () => showMenu() }, "Leave"),
  ], { wide: "mid" });
}

// The page comes fresh from disk, but a server process keeps running the code
// it was started with. If the two disagree, nothing sensible can happen.
const OUTDATED =
  "The server is running a different version of the game. Restart it (npm start), then reload this page.";

function handleServerMessage(message) {
  if ((message.type === "joined" || message.type === "resumed") && message.protocol !== PROTOCOL) {
    showMenu(OUTDATED);
    return;
  }
  switch (message.type) {
    case "joined":
      session.slot = message.slot;
      session.code = message.code;
      session.format = message.format || "duel";
      session.killCam = message.killCam !== false;
      roomLabel.hidden = false;
      roomLabel.textContent = "Room " + message.code;
      if (message.mode) session.gameMode = message.mode;
      saveSeat({ code: message.code, token: message.token, slot: message.slot });
      break;

    case "resumed":
      stopReconnect();
      session.slot = message.slot;
      session.code = message.code;
      session.format = message.format || session.format;
      roomLabel.hidden = false;
      roomLabel.textContent = "Room " + message.code;
      saveSeat({ code: message.code, token: message.token, slot: message.slot });
      if (message.inMatch) {
        if (!session.input) setupOnlineMatch(message); // this page was reloaded
        session.overShown = false; // bring the result card back if it was up
        hidePanel();
      }
      break;

    case "lobby":
      session.lobby = message;
      session.slot = message.slot;
      session.format = "teams";
      session.gameMode = message.mode;
      {
        const seat = loadSeat();
        if (seat) saveSeat({ ...seat, slot: message.slot });
      }
      if (!session.state) showLobby(message);
      break;

    case "opponent-lost":
      session.lost.set(message.slot, Date.now() + (message.grace || 0));
      if (!session.state && !session.lobby) {
        showPanel([
          el("div", { className: "kicker" }, "Room " + (session.code || "")),
          el("h2", {}, message.slot === 0 ? "Waiting for the host" : "Waiting for your opponent"),
          el("p", { className: "lede" }, "They stepped away — it carries on as soon as they're back."),
          el("button", { onclick: () => showMenu() }, "Leave"),
        ]);
      }
      break;

    case "opponent-back":
      if (message.slot === undefined) session.lost.clear();
      else session.lost.delete(message.slot);
      break;

    case "waiting":
      showPanel([
        el("div", { className: "kicker" }, "Room created · " + MODES[session.gameMode].name),
        el("h2", {}, "Waiting for an opponent"),
        el("p", { className: "lede" }, "Share this code — the game starts as soon as they join."),
        el("div", { className: "code" }, session.code || ""),
        el("button", { onclick: () => showMenu() }, "Cancel"),
      ]);
      break;

    case "start":
      session.lost.clear();
      setupOnlineMatch(message);
      break;

    case "state":
      session.state = message.state;
      break;

    case "ended":
      showMenu(message.reason);
      break;

    case "error":
      if (message.reason === "gone") {
        // Our seat is gone: the room closed while we were away.
        stopReconnect();
        session.mode = null;
        showMenu("That match ended while you were away.");
        break;
      }
      clearSeat();
      session.socket?.close();
      session.socket = null;
      session.mode = null;
      showJoinForm(message.message);
      break;
  }
}

function enterMatch(mode, statusParts) {
  app.classList.add("in-match");
  keepAwake(true);
  modeLabel.textContent = mode;
  hidePanel();
  statusEl.replaceChildren(
    ...statusParts.flatMap((part, i) => [
      ...(i ? [el("span", { className: "bar" })] : []),
      el("span", {}, part[0]),
    ]),
  );
  pushFeed([{ text: "The duel begins" }]);
}

// --- game over --------------------------------------------------------------

function resultTitle(state) {
  if (state.winner === null) return "Draw";
  if (session.mode === "online") {
    return state.winner === teamOfIndex(session.slot) ? "You win" : "You lose";
  }
  return teamName(state, state.winner) + (isTeams(state) ? " win" : " wins");
}

// After-match numbers, one column per player. The best in a row is lit in
// that player's colour (the fewest, for deaths).
const STAT_ROWS = [
  ["Kills", "kills", "high"],
  ["Deaths", "deaths", "low"],
  ["Bombs placed", "bombs", null],
  ["Crates broken", "crates", "high"],
  ["Near misses", "nearMisses", "high"],
  ["Hits blocked", "blocked", "high"],
  ["Self-destructs", "selfDestructs", null],
  ["Best streak", "bestStreak", "high"],
];

function statsTable(state) {
  const players = state.players;
  const head = el("tr", {}, [
    el("th", {}, ""),
    ...players.map((p) => painted(el("th", { scope: "col" }, [el("span", { className: "dot" }), p.name]), p.color)),
  ]);
  const rows = STAT_ROWS.map(([label, key, best]) => {
    const values = players.map((p) => (p.stats && p.stats[key]) || 0);
    const top = best === "high" ? Math.max(...values) : best === "low" ? Math.min(...values) : null;
    const standsOut = top !== null && values.some((v) => v !== top);
    return el("tr", {}, [
      el("th", { scope: "row" }, label),
      ...players.map((p, i) =>
        painted(el("td", { className: standsOut && values[i] === top ? "best" : "" }, String(values[i])), p.color)),
    ]);
  });
  return el("div", { className: "stats-wrap" }, [
    el("table", { className: "stats-table" }, [el("thead", {}, head), el("tbody", {}, rows)]),
  ]);
}

function showResult(state) {
  const again =
    session.mode === "local"
      ? el("button", { className: "primary", onclick: () => startLocal(session.classes, session.gameMode) }, "Play again")
      : el(
          "button",
          {
            className: "primary",
            onclick: (event) => {
              event.currentTarget.disabled = true;
              session.socket?.send({ type: "rematch" });
            },
          },
          "Rematch",
        );
  const rounds = (state.history || []).length;
  const fatality = state.finish && state.finish.type === "fatality";

  showPanel([
    el("div", { className: "kicker" }, "The duel is decided"),
    el("h2", {}, resultTitle(state)),
    el("p", { className: "lede" },
      (fatality ? "By fatality · " + state.finish.streak + streakWord(state) + " · " : "") +
      "Lasted " + formatClock(state.elapsed) + " · " + rounds + (rounds === 1 ? " round" : " rounds")),
    statsTable(state),
    el("div", { className: "rule-h" }),
    el("div", { className: "result-actions" }, [
      again,
      ...(session.mode === "local"
        ? [el("button", { onclick: () => pickLocalClasses(session.gameMode) }, "Change classes")]
        : []),
      el("button", { onclick: () => showMenu() }, "Main menu"),
    ]),
  ], { wide: "mid" });
}

// --- HUD --------------------------------------------------------------------

const MAX_BOMBS = Math.max(...Object.values(CLASSES).map((c) => c.maxBombs));
const MAX_RADIUS = Math.max(...Object.values(CLASSES).filter((c) => c.pattern !== "line").map((c) => c.blastRadius));
const MAX_HITS = Math.max(...Object.values(CLASSES).map((c) => 1 + c.shields));

function statRow(label, value, fraction) {
  return el("div", { className: "stat" }, [
    el("span", { className: "stat-label" }, label),
    el("span", { className: "stat-track" }, [
      el("span", { className: "stat-fill", style: "width:" + Math.round(fraction * 100) + "%" }),
    ]),
    el("span", { className: "stat-val" }, String(value)),
  ]);
}

function livesBar(state, lives) {
  return el("div", { className: "lives" },
    Array.from({ length: state.maxLives }, (_, n) => el("span", { className: n < lives ? "life on" : "life" })));
}

// Shields refill each round: one against your own fire for everyone (✦), plus
// the class's armour against any fire (◈). Spent ones become empty slots.
function relicRow(player) {
  const armor = statsOf(player.className).shields;
  const slots = [
    ...Array.from({ length: SELF_SHIELDS }, (_, n) => ({
      kind: "self", up: n < player.selfShields, glyph: "✦", title: "Blocks one hit from your own (or a teammate's) bomb",
    })),
    ...Array.from({ length: armor }, (_, n) => ({
      kind: "armor", up: n < player.shields, glyph: "◈", title: "Armor — blocks one hit from any bomb",
    })),
  ];
  return el("div", { className: "relic-row" },
    slots.map((s) => el("span", { className: "relic " + (s.up ? s.kind : "spent"), title: s.title }, s.glyph)));
}

function playerCard(player, state, { compact, streakText = "" }) {
  const stats = statsOf(player.className);
  const isMe = session.mode === "online" && player.index === session.slot;
  const down = compact && !player.alive && state.phase === "live";
  // What matters most comes first: on a narrow card the end gets cut off.
  const sub = [stats.name, player.hidden ? "Unseen" : "", down ? "Down" : "", isMe ? "You" : ""].filter(Boolean).join(" · ");
  const card = el("section", { className: "pcard" + (compact ? " compact" : "") + (down ? " down" : "") }, [
    el("div", { className: "pcard-head" }, [
      el("div", { className: "orb" }),
      el("div", { className: "pcard-id" }, [
        el("div", { className: "pname" }, player.name),
        el("div", { className: "psub" }, sub),
      ]),
      ...(compact ? [relicRow(player)] : []),
    ]),
    ...(compact ? [] : [
      livesBar(state, player.lives),
      ...(streakText
        ? [el("div", { className: player.streak >= FATALITY_STREAK ? "pstreak hot" : "pstreak" }, streakText)]
        : []),
      el("div", { className: "stats" }, [
        statRow("Bombs", stats.maxBombs, stats.maxBombs / MAX_BOMBS),
        statRow("Radius", stats.pattern === "line" ? "∞" : stats.blastRadius,
          stats.pattern === "line" ? 1 : stats.blastRadius / MAX_RADIUS),
        statRow("Hits", 1 + stats.shields, (1 + stats.shields) / MAX_HITS),
      ]),
    ]),
  ]);
  return painted(card, player.color);
}

// One side column: in 1v1 the player's card and shields; in 2v2 the team's
// shared lives and streak, then a compact card per teammate. Only rebuilt
// when something on it actually changed.
function renderTeam(target, team, state) {
  const members = state.players.filter((p) => p.team === team);
  const lead = members[0];
  if (!lead) return;
  const teams = isTeams(state);
  const streakText =
    lead.streak >= FATALITY_STREAK ? lead.streak + streakWord(state) + " · Fatality ready" :
    lead.streak >= STREAK_SHOWN_FROM ? lead.streak + streakWord(state) : "";
  const key = JSON.stringify([
    teams, state.maxLives, lead.lives, streakText, session.slot, session.mode, state.phase === "live",
    members.map((p) => [p.name, p.color, p.className, p.alive, p.hidden, p.selfShields, p.shields]),
  ]);
  if (target.dataset.key === key) return;
  target.dataset.key = key;

  if (!teams) {
    target.replaceChildren(
      playerCard(lead, state, { compact: false, streakText }),
      el("section", { className: "relics" }, [el("div", { className: "kicker" }, "Shields"), relicRow(lead)]),
    );
    return;
  }
  const head = painted(el("div", { className: "team-head" }, [
    el("div", { className: "kicker" }, team === 0 ? "Top side" : "Bottom side"),
    livesBar(state, lead.lives),
    ...(streakText ? [el("div", { className: lead.streak >= FATALITY_STREAK ? "pstreak hot" : "pstreak" }, streakText)] : []),
  ]), lead.color);
  target.replaceChildren(head, ...members.map((p) => playerCard(p, state, { compact: true })));
}

// Footer slots for each player you control: bombs still free, the class
// ability if there is one, and the fatality — locked until a 4 streak, lit
// when it can be used right now.
function renderAbilities(state) {
  const mine = session.mode === "online" ? [session.slot] : [0, 1];
  const slots = mine.map((index) => {
    const player = state.players[index];
    if (!player) return null;
    const stats = statsOf(player.className);
    const live = state.bombs.filter((b) => b.owner === index).length;
    const offer = fatalityReady(state, index);
    const keys = keysFor(index);
    return {
      index,
      color: player.color,
      free: Math.max(0, stats.maxBombs - live),
      bombKey: shortKey(keys.bomb),
      skillKey: stats.ability ? shortKey(keys.ability) : null,
      cooldown: Math.ceil((player.abilityCd || 0) / 1000),
      fatalKey: shortKey(keys.fatality),
      streak: player.streak,
      fatal: offer === "near" || offer === "anywhere" ? "ready" : player.streak >= FATALITY_STREAK ? "far" : "locked",
    };
  }).filter(Boolean);
  const key = slots.map((s) => [s.index, s.color, s.free, s.skillKey, s.cooldown, s.streak, s.fatal].join(":")).join();
  if (abilitiesEl.dataset.key === key) return;
  abilitiesEl.dataset.key = key;
  abilitiesEl.replaceChildren(
    ...slots.flatMap((s) => [
      painted(el("div", { className: s.free ? "ability" : "ability empty" }, [
        el("div", { className: "ability-slot", title: s.free + (s.free === 1 ? " bomb ready" : " bombs ready") }, [
          el("span", { "aria-hidden": "true" }, "◉"),
          el("span", { className: "ability-count" }, String(s.free)),
        ]),
        el("span", { className: "ability-key" }, s.bombKey),
      ]), s.color),
      ...(s.skillKey
        ? [painted(el("div", { className: "ability skill" + (s.cooldown ? " cooling" : "") }, [
          el("div", { className: "ability-slot", title: s.cooldown ? "Decoy — ready in " + s.cooldown + " s" : "Decoy — press " + s.skillKey }, [
            el("span", { "aria-hidden": "true" }, "◎"),
            el("span", { className: "ability-count" }, s.cooldown ? s.cooldown + "s" : ""),
          ]),
          el("span", { className: "ability-key" }, s.skillKey),
        ]), s.color)]
        : []),
      painted(el("div", { className: "ability fatal " + s.fatal }, [
        el("div", {
          className: "ability-slot",
          title: s.fatal === "ready" ? "Fatality — press " + s.fatalKey
            : s.fatal === "far" ? "Fatality — get within " + FATALITY_RANGE + " squares"
            : "Fatality unlocks at a " + FATALITY_STREAK + " streak",
        }, [
          el("span", { "aria-hidden": "true" }, "✠"),
          el("span", { className: "ability-count" }, Math.min(s.streak, FATALITY_STREAK) + "/" + FATALITY_STREAK),
        ]),
        el("span", { className: "ability-key" }, s.fatalKey),
      ]), s.color),
    ]),
  );
}

// --- event feed -------------------------------------------------------------
//
// Told from differences between what was drawn last and what is drawn now, so
// it reads the same in local play and from 20 Hz online snapshots.

const feed = [];
let lastSeen = null;

function summarise(state) {
  return {
    players: state.players.map((p) => ({
      self: p.selfShields,
      armor: p.shields,
      alive: p.alive,
      hidden: p.hidden,
      bombs: state.bombs.filter((b) => b.owner === p.index).length,
      decoys: (state.decoys || []).filter((d) => d.owner === p.index).length,
    })),
    crates: new Set((state.tiles || []).filter((t) => t > 0)),
    round: state.round,
    kills: (state.kills || []).length,
    fatality: state.finish && state.finish.type === "fatality" ? state.finish : null,
  };
}

function pushFeed(entries) {
  feed.push(...entries);
  while (feed.length > 2) feed.shift();
  feedEl.replaceChildren(
    ...feed.flatMap((entry, i) => [
      ...(i ? [el("span", { className: "sep" }, "·")] : []),
      ...(entry.who !== undefined
        ? [painted(el("span", { className: "who" }, nameOf(entry.who)), colorOf(entry.who)), " "]
        : []),
      entry.text,
    ]),
  );
}

function killEntry(state, kill) {
  const killer = state.players[kill.by];
  if (kill.by === kill.victim) return { who: kill.victim, text: "blows themselves up" };
  if (!killer) return { who: kill.victim, text: "falls" };
  if (killer.team === state.players[kill.victim].team) return { who: kill.by, text: "takes out their own teammate" };
  return { who: kill.by, text: "takes out " + nameOf(kill.victim) };
}

function updateFeed(state) {
  const now = summarise(state);
  if (lastSeen) {
    const entries = [];
    if (now.fatality && !lastSeen.fatality) {
      const victims = (now.fatality.victims || [now.fatality.victim]).map(nameOf).join(" & ");
      pushFeed([{ who: now.fatality.by, text: "performs a fatality on " + victims }]);
      lastSeen = now;
      return;
    }
    if (now.round > lastSeen.round) {
      pushFeed([{ text: "Round " + now.round + " begins" }]);
      lastSeen = now;
      return;
    }
    const broken = [...lastSeen.crates].filter((id) => !now.crates.has(id)).length;
    if (broken === 1) entries.push({ text: "A crate breaks" });
    if (broken > 1) entries.push({ text: broken + " crates break" });
    for (const kill of (state.kills || []).slice(lastSeen.kills)) entries.push(killEntry(state, kill));
    now.players.forEach((p, i) => {
      const was = lastSeen.players[i];
      if (!was) return;
      if (p.bombs > was.bombs) entries.push({ who: i, text: "places a bomb" });
      if (p.decoys > was.decoys) entries.push({ who: i, text: "drops a decoy" });
      if (p.hidden && !was.hidden) entries.push({ who: i, text: "vanishes" });
      if (!p.hidden && was.hidden && p.alive) entries.push({ who: i, text: "is seen again" });
      if (p.self < was.self && p.alive) entries.push({ who: i, text: "survives their own blast" });
      if (p.armor < was.armor && p.alive) entries.push({ who: i, text: "blocks the hit with armor" });
    });
    if (entries.length) pushFeed(entries);
  }
  lastSeen = now;
}

// --- chrome -----------------------------------------------------------------

// The Controls list. Rows are kept and re-coloured once the match state says
// what colour each seat actually has.
let legendRows = [];
function setLegend(rows) {
  legendRows = rows;
  legend.dataset.key = "";
  renderLegend();
}

function renderLegend() {
  const key = legendRows.map((row) => row.player + ":" + colorOf(row.player)).join();
  if (legendRows.length && legend.dataset.key === key) return;
  legend.dataset.key = key;
  if (!legendRows.length) {
    legend.replaceChildren();
    return;
  }
  legend.replaceChildren(
    ...legendRows.map((row) =>
      painted(el("div", { className: "codex-row painted" }, [
        el("span", { className: "codex-key" }, row.key),
        el("span", { className: "codex-what" }, row.what),
      ]), colorOf(row.player))),
    el("div", { className: "codex-row" }, [
      el("span", { className: "codex-key" }, "Hold"),
      el("span", { className: "codex-what" }, "Keep walking"),
    ]),
  );
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

// --- rounds -------------------------------------------------------------------

const GO_FLASH_MS = 800;
const maxRoundsOf = (state) => 2 * state.maxLives - 1;

// One pip per round the match can last, lit in the colour of the side that
// took it — split between teammates in 2v2, between both sides on a draw.
function renderPips(state) {
  const history = state.history || [];
  const key = history.map(String).join() + "|" + state.round + "|" + state.status + "|" +
    state.players.map((p) => p.color).join();
  if (pipsEl.dataset.key === key) return;
  pipsEl.dataset.key = key;
  const tints = (team) => state.players.filter((p) => p.team === team).map((p) => paletteOf(p.color).core);
  const total = Math.max(maxRoundsOf(state), history.length + (state.status === "over" ? 0 : 1));
  pipsEl.replaceChildren(
    ...Array.from({ length: total }, (_, i) => {
      const dot = el("span", { className: "pip-dot" });
      if (i < history.length) {
        const colors = history[i] === null ? [tints(0)[0], tints(1)[0]] : tints(history[i]);
        dot.classList.add("won");
        dot.style.background = colors.length > 1
          ? `linear-gradient(90deg, ${colors[0]} 50%, ${colors[1]} 50%)`
          : colors[0];
        if (history[i] !== null) dot.style.boxShadow = "0 0 10px " + colors[0];
      } else if (i === history.length && state.status !== "over") {
        dot.classList.add("current");
      }
      return dot;
    }),
  );
}

// The big text over the board. `spec` is null (hidden) or
// { key, kicker, main, kind, color, dim, anim } — the animation only restarts
// when the key changes, so a steady "3" does not flicker 60 times a second.
function showCallout(spec) {
  const key = spec ? spec.key : "";
  if (calloutEl.dataset.key === key) {
    if (spec) calloutKicker.textContent = spec.kicker || ""; // e.g. a ticking countdown
    return;
  }
  calloutEl.dataset.key = key;
  if (!spec) {
    calloutEl.hidden = true;
    return;
  }
  calloutKicker.textContent = spec.kicker || "";
  calloutMain.textContent = spec.main;
  calloutMain.className = "callout-main" + (spec.kind ? " " + spec.kind : "") + (spec.color ? " painted" : "");
  calloutMain.removeAttribute("style");
  if (spec.color) painted(calloutMain, spec.color);
  calloutEl.className = "callout" + (spec.dim ? " dim" : "");
  calloutEl.hidden = false;
  void calloutEl.offsetWidth; // restart the CSS animation
  calloutEl.classList.add(spec.anim || "pop");
}

function calloutFor(state) {
  if (session.lost.size && state.status === "playing") {
    const [slot, until] = [...session.lost.entries()][0];
    const secs = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    return {
      key: "lost" + slot,
      kicker: "Match paused · waiting " + secs + "s",
      main: nameOf(slot) + " lost connection",
      kind: "small",
      color: colorOf(slot),
      dim: true,
    };
  }
  if (state.finish && state.finish.type === "fatality") {
    return {
      key: "fatality",
      kicker: nameOf(state.finish.by) + " · " + state.finish.streak + streakWord(state),
      main: "Fatality",
      kind: "fatality",
      color: colorOf(state.finish.by),
      dim: true,
      anim: "slam",
    };
  }
  if (state.status === "over" || session.cam) return null;
  const roundTag = "Round " + state.round;
  if (state.phase === "countdown") {
    const n = Math.max(1, Math.ceil(state.phaseLeft / 1000));
    return { key: "cd" + n, kicker: roundTag, main: String(n), dim: true };
  }
  if (state.phase === "roundEnd") {
    const winner = state.history[state.history.length - 1];
    // The winners can still land a fatality on the side that just fell.
    const finishable = winner !== null && winner !== undefined &&
      state.players.some((p) => p.team === winner && fatalityReady(state, p.index));
    let main;
    let color;
    if (isTeams(state)) {
      main = winner === null ? "Both sides fall" : "Round to " + teamName(state, winner);
      color = winner === null ? undefined : leadOf(state, winner).color;
    } else {
      const fallen = state.fallen || [];
      main = fallen.length > 1 ? "Both fall" : nameOf(fallen[0]) + " falls";
      color = fallen.length > 1 ? undefined : colorOf(fallen[0]);
    }
    return {
      key: "end" + state.round + (finishable ? "f" : ""),
      kicker: finishable ? "Finish them" : roundTag + " over",
      main,
      kind: "small",
      color,
      dim: true,
    };
  }
  if (state.phase === "live" && state.liveFor < GO_FLASH_MS) {
    return { key: "go" + state.round, kicker: roundTag, main: "GO", kind: "go", anim: "fade" };
  }
  return null;
}

// --- kill streaks ------------------------------------------------------------

let lastStreaks = [0, 0]; // per team

// The quick banner when a streak reaches 2, 3, 4…
function flashStreak(state, team, streak) {
  const lead = leadOf(state, team);
  const mine = session.mode !== "online" || team === teamOfIndex(session.slot);
  const key = fatalityKeyOf(session.mode === "online" ? session.slot : lead.index);
  streakName.textContent = isTeams(state) ? teamName(state, team) : lead.name;
  streakCount.textContent = streak + streakWord(state);
  streakNote.textContent =
    streak >= FATALITY_ANYWHERE_STREAK
      ? (mine ? "Fatality — " + PRESS + " " + key + ", from anywhere" : "They can finish you from anywhere")
      : streak >= FATALITY_STREAK
        ? (mine ? "Fatality unlocked — get within " + FATALITY_RANGE + " squares, " + PRESS + " " + key
          : "Fatality unlocked — keep your distance")
        : "";
  painted(streakEl, lead.color);
  streakEl.className = "streak" + (streak >= FATALITY_STREAK ? " big" : "");
  streakEl.hidden = false;
  void streakEl.offsetWidth; // restart the animation
  streakEl.classList.add("flash");
}

function watchStreaks(state) {
  if (session.cam) return; // after the replay, not on top of it
  [0, 1].forEach((team) => {
    const lead = leadOf(state, team);
    if (!lead) return;
    if (lead.streak > lastStreaks[team] && lead.streak >= STREAK_SHOWN_FROM) flashStreak(state, team, lead.streak);
    lastStreaks[team] = lead.streak;
  });
}

// The standing line under the board while a fatality is on offer.
function setPrompt(spec) {
  const key = spec ? spec.key : "";
  if (promptEl.dataset.key === key) return;
  promptEl.dataset.key = key;
  if (!spec) {
    promptEl.hidden = true;
    return;
  }
  promptEl.textContent = spec.text;
  painted(promptEl, spec.color);
  promptEl.className = "prompt painted" + (spec.ready ? " ready" : "");
  promptEl.hidden = false;
}

function promptFor(state) {
  // Your own offer first, then whoever threatens you.
  const order = [...state.players].sort((a, b) => Number(controls(b.index)) - Number(controls(a.index)));
  for (const player of order) {
    const offer = fatalityReady(state, player.index);
    if (!offer) continue;
    const name = player.name;
    const key = fatalityKeyOf(player.index);
    const ready = offer !== "far";
    const frozen = state.phase === "roundEnd";
    const text = controls(player.index)
      ? (ready ? name + " · " + (touchMode ? "Tap " : "Press ") + key + " — Fatality"
        : name + " · Fatality ready — get within " + FATALITY_RANGE + " squares")
      : (ready ? name + (frozen ? " can still finish you" : " can finish you — get away!")
        : name + " has a fatality — keep your distance");
    return { key: player.index + offer + text, text, color: player.color, ready };
  }
  return null;
}

function updateHud(state) {
  clockEl.textContent = formatClock(state.elapsed);
  roundLabel.textContent = "Round " + state.round + " of up to " + maxRoundsOf(state);
  renderPips(state);
  showCallout(calloutFor(state));
  watchStreaks(state);
  setPrompt(session.cam ? null : promptFor(state));
  renderTeam(teamEls[0], 0, state);
  renderTeam(teamEls[1], 1, state);
  renderAbilities(state);
  renderLegend();
  for (const { pad } of session.pads) pad.update(state);
  updateFeed(state);
}

// --- kill cam -------------------------------------------------------------------
//
// The board keeps a short memory of recent frames. When a round is decided —
// or the match, by anything but a fatality — the last second before the
// deciding kill is replayed in slow motion during the freeze, with a reticle
// on where it happened. Purely a presentation of frames already seen: online,
// that is this seat's own view, so a hidden Shade stays hidden in it too.

const CAM_LEAD_MS = 1000;  // game time replayed before the kill…
const CAM_TAIL_MS = 300;   // …and after it, long enough to see the hit land
const CAM_SPEED = 0.42;    // replay speed
const CAM_KEEP_MS = 2600;  // how much game time the memory holds
const camBuffer = [];      // { t, snap }, oldest first
const camView = createView({ replay: true });
let camWatch = null;       // the last { round, phase, status } seen, to spot a round being decided

function snapshotOf(state) {
  return structuredClone({
    format: state.format,
    round: state.round,
    phase: state.phase,
    status: "playing",
    history: [],
    finish: null,
    tiles: state.tiles,
    spawns: state.spawns,
    bombs: state.bombs,
    blasts: state.blasts,
    decoys: state.decoys || [],
    kills: state.kills || [],
    players: state.players.map((p) => ({
      index: p.index, team: p.team, name: p.name, color: p.color, className: p.className,
      x: p.x, y: p.y, alive: p.alive, hidden: p.hidden, facing: p.facing,
      invulnIn: p.invulnIn, invulnMax: p.invulnMax, streak: 0,
    })),
  });
}

function recordFrame(state) {
  if (state.phase === "countdown" || (state.finish && state.finish.type === "fatality")) return;
  const last = camBuffer[camBuffer.length - 1];
  if (last && last.t === state.elapsed) return; // the same snapshot again
  if (last && state.elapsed < last.t) camBuffer.length = 0; // a new match
  const frame = { t: state.elapsed, snap: snapshotOf(state) };
  camBuffer.push(frame);
  while (camBuffer.length && camBuffer[0].t < state.elapsed - CAM_KEEP_MS) camBuffer.shift();
  if (session.cam && frame.t <= session.cam.to) session.cam.frames.push(frame);
}

function camCaptionFor(state, kill) {
  const drawn = state.status === "over" ? state.winner === null : state.history[state.history.length - 1] === null;
  const name = (index) => painted(el("span", { className: "cam-name" }, nameOf(index)), colorOf(index));
  if (drawn) return ["Both fall"];
  if (kill.by === kill.victim) return [name(kill.victim), " · own bomb"];
  const killer = state.players[kill.by];
  if (!killer) return [name(kill.victim), " falls"];
  if (killer.team === state.players[kill.victim].team) return [name(kill.by), " ✕ ", name(kill.victim), " · friendly fire"];
  return [name(kill.by), " ✕ ", name(kill.victim)];
}

function watchForKillCam(state, now) {
  const previous = camWatch;
  camWatch = { round: state.round, phase: state.phase, status: state.status };
  if (!previous || !state.killCam || session.cam) return;
  const decided = previous.status === "playing" && previous.phase === "live" && previous.round === state.round &&
    (state.phase === "roundEnd" || state.status === "over");
  if (!decided || (state.finish && state.finish.type === "fatality")) return;
  // A finish on offer gets the short freeze — and the screen — to itself.
  if (state.status === "playing" && state.players.some((p) => {
    const offer = fatalityReady(state, p.index);
    return offer === "near" || offer === "anywhere";
  })) return;
  const kills = state.kills || [];
  const kill = kills[kills.length - 1];
  if (!kill) return;
  const from = kill.at - CAM_LEAD_MS;
  const frames = camBuffer.filter((f) => f.t >= from - 120);
  if (frames.length < 2) return;

  Object.assign(camView, createView({ replay: true }));
  camView.viewer = session.mode === "online" ? { index: session.slot, team: teamOfIndex(session.slot) } : null;
  camView.mark = { x: kill.x, y: kill.y, color: colorOf(kill.victim) };
  session.cam = { frames, from, to: kill.at + CAM_TAIL_MS, startedAt: now, round: state.round, status: state.status };
  camCaption.replaceChildren(...camCaptionFor(state, kill));
  camEl.hidden = false;
  camEl.classList.remove("show");
  void camEl.offsetWidth;
  camEl.classList.add("show");
}

// The frame to show right now, or null once the replay has run its course.
function camFrame(now) {
  const cam = session.cam;
  const t = cam.from + (now - cam.startedAt) * CAM_SPEED;
  if (t > cam.to) return null;
  let pick = cam.frames[0];
  for (const f of cam.frames) {
    if (f.t <= t) pick = f;
    else break;
  }
  return pick.snap;
}

function stopCam() {
  session.cam = null;
  camEl.hidden = true;
}

// --- touch controls and keeping the screen on ----------------------------------

function mountPad(player, host, rotated, handlers) {
  session.pads.push({ player, pad: createTouchPad(host, { player, rotated, handlers }) });
}

function unmountPads() {
  for (const { pad } of session.pads) pad.destroy();
  session.pads = [];
  app.classList.remove("table");
}

// A phone that dims mid-match is a lost round. Where the browser allows it,
// hold the screen on while a match is running.
let wakeLock = null;
async function keepAwake(on) {
  if (!touchMode || !("wakeLock" in navigator)) return;
  try {
    if (on && !wakeLock && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}
// The lock drops whenever the page is hidden; take it back on return.
document.addEventListener("visibilitychange", () => {
  if (session.state && session.state.status === "playing") keepAwake(true);
});

// --- loop -------------------------------------------------------------------

let last = performance.now();

function frame(now) {
  const dt = Math.min(now - last, 100); // a backgrounded tab must not fast-forward
  last = now;

  fitCanvas(canvas);

  // Only local mode advances the simulation here; online mode renders snapshots.
  if (session.mode === "local" && session.state && session.state.status === "playing") {
    step(session.state, dt);
  }

  const state = session.state;
  if (state) {
    recordFrame(state);
    watchForKillCam(state, now);
    if (session.cam && (state.round !== session.cam.round || state.status !== session.cam.status)) stopCam();
    updateHud(state);
    if (state.status === "over" && !session.overShown) {
      const fatality = state.finish && state.finish.type === "fatality";
      if (!session.overAt) {
        session.overAt = now;
        if (fatality) {
          boardWrap.classList.add("quake");
          streakEl.hidden = true; // the fatality gets the screen to itself
          setPrompt(null);
        }
      }
      if (!session.cam && (!fatality || now - session.overAt >= FATALITY_SHOW_MS)) {
        session.overShown = true;
        showResult(state);
      }
    } else if (state.status === "playing" && session.overShown) {
      session.overShown = false;
      session.overAt = 0;
      hidePanel();
    }
  }

  const replay = session.cam && camFrame(now);
  if (session.cam && !replay) stopCam();
  if (replay) draw(canvas, replay, now, camView);
  else draw(canvas, state, now);
  requestAnimationFrame(frame);
}

// Handle for poking at a running match from the devtools console.
window.grid1v1 = session;

if (loadSeat()) resumeSavedSeat();
else showMenu();
requestAnimationFrame(frame);
