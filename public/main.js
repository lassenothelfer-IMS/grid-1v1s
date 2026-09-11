// App shell: menu, class selection, the render loop, and the two ways a match
// can be driven — locally (engine runs here) or online (engine runs on the server).

import {
  createGame,
  step,
  requestMove,
  setHeld,
  requestBomb,
  requestFatality,
  fatalityReady,
} from "/shared/engine.js";
import {
  SELF_SHIELDS,
  CLASSES,
  CLASS_IDS,
  DEFAULT_CLASS,
  MODES,
  MODE_IDS,
  DEFAULT_MODE,
  STREAK_SHOWN_FROM,
  FATALITY_STREAK,
  FATALITY_RANGE,
  FATALITY_ANYWHERE_STREAK,
} from "/shared/constants.js";
import { draw, fitCanvas, resetMotion } from "/render.js";
import { createInput, LOCAL_SCHEMES, ONLINE_SCHEMES } from "/input.js";
import { connect } from "/net.js";

const app = document.getElementById("app");
const canvas = document.getElementById("board");
const boardWrap = document.querySelector(".board-wrap");
const overlay = document.getElementById("overlay");
const panel = document.getElementById("panel");
const legend = document.getElementById("legend");
const modeLabel = document.getElementById("mode-label");
const roomLabel = document.getElementById("room-label");
const clockEl = document.getElementById("clock");
const cardEls = [document.getElementById("card-0"), document.getElementById("card-1")];
const shieldEls = [document.getElementById("shields-0"), document.getElementById("shields-1")];
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

const session = {
  mode: null,      // null | "local" | "online"
  state: null,     // the game state being rendered
  classes: [DEFAULT_CLASS, DEFAULT_CLASS],
  gameMode: DEFAULT_MODE, // "blitz" | "siege"
  input: null,
  socket: null,
  slot: -1,
  code: null,
  overShown: false,
  overAt: 0,      // when the match ended, so a fatality can play out first
};

const PLAYER_NAMES = ["Player 1", "Player 2"];

// One glyph per class, borrowed from the template's relic set.
const CLASS_GLYPHS = { classic: "◉", speedy: "↯", sniper: "⌖", tank: "❖" };
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

// The fatality key as a player would read it, per controlled slot.
const FATALITY_KEYS_LOCAL = ["X", "Right Shift"];
const FATALITY_KEY_ONLINE = "X";
const FATALITY_SHOW_MS = 2600; // the fatality plays out before the result card

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

function showPanel(nodes, { wide = false } = {}) {
  panel.className = wide === "mid" ? "panel mid" : wide ? "panel wide" : "panel";
  panel.replaceChildren(...nodes);
  overlay.hidden = false;
}

function hidePanel() {
  overlay.hidden = true;
}

function statsOf(className) {
  return CLASSES[className] || CLASSES[DEFAULT_CLASS];
}

// The chips on a class card, read straight from the class numbers.
function classTags(stats) {
  const tags = [
    { text: stats.maxBombs + (stats.maxBombs === 1 ? " bomb" : " bombs") },
    { text: "Radius " + stats.blastRadius },
  ];
  if (stats.delivery === "remote") tags.push({ text: "Range " + stats.minRange + "+" });
  if (stats.shields > 0) tags.push({ text: 1 + stats.shields + " hits" });
  // The first chip is the one that sets the class apart; it gets the accent.
  const signature =
    stats.delivery === "remote" ? 2 :
    stats.shields > 0 ? 3 :
    stats.maxBombs > 2 ? 0 : 1;
  tags[Math.min(signature, tags.length - 1)].key = true;
  return tags;
}

// --- teardown ---------------------------------------------------------------

function leaveSession() {
  session.input?.destroy();
  session.input = null;
  session.socket?.close();
  session.socket = null;
  session.mode = null;
  session.state = null;
  session.slot = -1;
  session.code = null;
  session.overShown = false;
  session.overAt = 0;
  app.classList.remove("in-match");
  roomLabel.hidden = true;
  modeLabel.textContent = "A duel on the grid";
  legend.replaceChildren();
  feed.length = 0;
  lastSeen = null;
  showCallout(null);
  lastStreaks = [0, 0];
  streakEl.hidden = true;
  setPrompt(null);
  boardWrap.classList.remove("quake");
  resetMotion();
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
        onBack: () => showMenu(),
        onPick: (mode) => pickLocalClasses(mode),
      })),
      menuItem("02", "Create room", "Online", () => showModePicker({
        onBack: () => showMenu(),
        onPick: (mode) => pickHostClass(mode),
      })),
      menuItem("03", "Join room", "Online", () => showJoinForm()),
    ]),
  ]);
}

// --- mode selection ---------------------------------------------------------

function showModePicker({ onPick, onBack }) {
  const cards = MODE_IDS.map((id, i) => {
    const mode = MODES[id];
    const rounds = 2 * mode.lives - 1;
    const reachesFatality = mode.lives > FATALITY_STREAK;
    return el("button", { className: "slot-card", "data-player": "0", onclick: () => onPick(id) }, [
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

  showPanel([
    el("div", { className: "panel-head" }, [
      el("h2", {}, "Choose a mode"),
      el("span", { className: "kicker" }, "How many lives the duel runs on"),
    ]),
    el("div", { className: "rule-h" }),
    el("div", { className: "loadout modes" }, cards),
    el("div", {}, [el("button", { onclick: onBack }, "Back")]),
  ], { wide: "mid" });
}

// --- class selection --------------------------------------------------------

// One reusable picker in the template's loadout layout: a card per class.
function showClassPicker({ forPlayer, showWho, onPick, onBack }) {
  const cards = CLASS_IDS.map((id, i) => {
    const stats = CLASSES[id];
    return el("button", { className: "slot-card", "data-player": String(forPlayer), onclick: () => onPick(id) }, [
      el("div", { className: "slot-top" }, [
        el("span", { className: "kicker" }, "Class " + ROMAN[i]),
        el("span", { className: "slot-glyph", "aria-hidden": "true" }, CLASS_GLYPHS[id] || "◉"),
      ]),
      el("div", { className: "slot-name" }, stats.name),
      el("div", { className: "slot-desc" }, stats.blurb),
      el("div", { className: "tags" },
        classTags(stats).map((t) => el("span", { className: t.key ? "tag key" : "tag" }, t.text))),
    ]);
  });

  showPanel([
    el("div", { className: "panel-head" }, [
      el("h2", {}, "Choose a class"),
      el("span", { className: "kicker" }, "One class per duel"),
      ...(showWho
        ? [el("span", { className: "kicker who", "data-player": String(forPlayer) }, PLAYER_NAMES[forPlayer])]
        : []),
    ]),
    el("div", { className: "rule-h" }),
    el("div", { className: "loadout" }, cards),
    el("div", {}, [el("button", { onclick: onBack }, "Back")]),
  ], { wide: true });
}

function pickLocalClasses(mode = session.gameMode) {
  showClassPicker({
    forPlayer: 0,
    showWho: true,
    onBack: () => showModePicker({ onBack: () => showMenu(), onPick: (m) => pickLocalClasses(m) }),
    onPick: (first) =>
      showClassPicker({
        forPlayer: 1,
        showWho: true,
        onBack: () => pickLocalClasses(mode),
        onPick: (second) => startLocal([first, second], mode),
      }),
  });
}

function pickHostClass(mode) {
  showClassPicker({
    forPlayer: 0,
    showWho: false,
    onBack: () => showModePicker({ onBack: () => showMenu(), onPick: (m) => pickHostClass(m) }),
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
      forPlayer: 1,
      showWho: false,
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

// --- local mode -------------------------------------------------------------

function startLocal(classes, mode) {
  const chosen = classes || session.classes;
  const gameMode = mode || session.gameMode;
  leaveSession();
  session.mode = "local";
  session.classes = chosen;
  session.gameMode = gameMode;
  session.state = createGame({ classes: chosen, mode: gameMode });
  session.input = createInput(LOCAL_SCHEMES, {
    onMove: (slot, dir) => requestMove(session.state, slot, dir),
    onHold: (slot, dir) => setHeld(session.state, slot, dir),
    onBomb: (slot) => requestBomb(session.state, slot),
    onFatality: (slot) => requestFatality(session.state, slot),
  });
  enterMatch(MODES[gameMode].name + " · Local duel", [["Local"], ["1 device"]]);
  setLegend([
    { player: 0, key: "W A S D", what: "Move" },
    { player: 0, key: "Space", what: "Bomb" },
    { player: 0, key: "X", what: "Fatality" },
    { player: 1, key: "Arrows", what: "Move" },
    { player: 1, key: "Enter", what: "Bomb" },
    { player: 1, key: "R-Shift", what: "Fatality" },
  ]);
}

// --- online mode ------------------------------------------------------------

function openSocket(onReady) {
  leaveSession();
  session.mode = "online";
  session.socket = connect({
    onOpen: onReady,
    onClose: () => {
      if (session.mode === "online") showMenu("Connection lost.");
    },
    onMessage: handleServerMessage,
  });
}

function startOnlineHost(className, mode) {
  showPanel([el("div", { className: "kicker" }, "Online"), el("h2", {}, "Connecting…")]);
  openSocket(() => session.socket.send({ type: "create", className, mode }));
}

function startOnlineGuest(code, className) {
  showPanel([el("div", { className: "kicker" }, "Online"), el("h2", {}, "Connecting…")]);
  openSocket(() => session.socket.send({ type: "join", code, className }));
}

function handleServerMessage(message) {
  switch (message.type) {
    case "joined":
      session.slot = message.slot;
      session.code = message.code;
      roomLabel.hidden = false;
      roomLabel.textContent = "Room " + message.code;
      if (message.mode) session.gameMode = message.mode;
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
      session.overShown = false;
      session.classes = message.classes || session.classes;
      session.gameMode = message.mode || session.gameMode;
      session.overAt = 0;
      boardWrap.classList.remove("quake");
      resetMotion();
      feed.length = 0;
      lastSeen = null;
      lastStreaks = [0, 0];
      session.input?.destroy();
      session.input = createInput(ONLINE_SCHEMES, {
        onMove: (_slot, dir) => session.socket?.send({ type: "move", dir }),
        onHold: (_slot, dir) => session.socket?.send({ type: "hold", dir }),
        onBomb: () => session.socket?.send({ type: "bomb" }),
        onFatality: () => session.socket?.send({ type: "fatality" }),
      });
      enterMatch(MODES[session.gameMode].name + " · Online duel", [["Online"], ["Room " + (session.code || "")]]);
      setLegend([
        { player: session.slot, key: "WASD / Arrows", what: "Move" },
        { player: session.slot, key: "Space / Enter", what: "Bomb" },
        { player: session.slot, key: "X", what: "Fatality" },
      ]);
      break;

    case "state":
      session.state = message.state;
      break;

    case "ended":
      showMenu(message.reason);
      break;

    case "error":
      session.socket?.close();
      session.socket = null;
      session.mode = null;
      showJoinForm(message.message);
      break;
  }
}

function enterMatch(mode, statusParts) {
  app.classList.add("in-match");
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
    return state.winner === session.slot ? "You win" : "You lose";
  }
  return PLAYER_NAMES[state.winner] + " wins";
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

  showPanel([
    el("div", { className: "kicker" }, "The duel is decided"),
    el("h2", {}, resultTitle(state)),
    el("p", { className: "lede" },
      (state.finish && state.finish.type === "fatality"
        ? "By fatality · " + state.finish.streak + " kill streak · "
        : "") + "Lasted " + formatClock(state.elapsed)),
    el("div", { className: "rule-h" }),
    again,
    ...(session.mode === "local"
      ? [el("button", { onclick: () => pickLocalClasses(session.gameMode) }, "Change classes")]
      : []),
    el("button", { onclick: () => showMenu() }, "Main menu"),
  ]);
}

// --- HUD --------------------------------------------------------------------

const MAX_BOMBS = Math.max(...Object.values(CLASSES).map((c) => c.maxBombs));
const MAX_RADIUS = Math.max(...Object.values(CLASSES).map((c) => c.blastRadius));
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

// Only rebuilt when something on it actually changed.
function renderCard(target, player, state) {
  const stats = statsOf(player.className);
  const isMe = session.mode === "online" && player.index === session.slot;
  const streakText =
    player.streak >= FATALITY_STREAK ? player.streak + " kill streak · Fatality ready" :
    player.streak >= STREAK_SHOWN_FROM ? player.streak + " kill streak" : "";
  const key = [player.className, player.lives, state.maxLives, isMe, streakText].join("|");
  if (target.dataset.key === key) return;
  target.dataset.key = key;

  target.replaceChildren(
    el("div", { className: "pcard-head" }, [
      el("div", { className: "orb", "data-player": String(player.index) }),
      el("div", { className: "pcard-id" }, [
        el("div", { className: "pname" }, PLAYER_NAMES[player.index]),
        el("div", { className: "psub" }, stats.name + (isMe ? " · You" : "")),
      ]),
    ]),
    el("div", { className: "lives" },
      Array.from({ length: state.maxLives }, (_, n) =>
        el("span", { className: n < player.lives ? "life on" : "life" }))),
    ...(streakText
      ? [el("div", { className: player.streak >= FATALITY_STREAK ? "pstreak hot" : "pstreak" }, streakText)]
      : []),
    el("div", { className: "stats" }, [
      statRow("Bombs", stats.maxBombs, stats.maxBombs / MAX_BOMBS),
      statRow("Radius", stats.blastRadius, stats.blastRadius / MAX_RADIUS),
      statRow("Hits", 1 + stats.shields, (1 + stats.shields) / MAX_HITS),
    ]),
  );
}

// Shields refill each life: one against your own fire for everyone (✦), plus
// the class's armour against any fire (◈). Spent ones become empty slots.
function renderShields(target, player) {
  const armor = statsOf(player.className).shields;
  const slots = [
    ...Array.from({ length: SELF_SHIELDS }, (_, n) => ({
      kind: "self", up: n < player.selfShields, glyph: "✦", title: "Blocks one hit from your own bomb",
    })),
    ...Array.from({ length: armor }, (_, n) => ({
      kind: "armor", up: n < player.shields, glyph: "◈", title: "Armor — blocks one hit from any bomb",
    })),
  ];
  const key = slots.map((s) => s.kind + (s.up ? 1 : 0)).join();
  if (target.dataset.key === key) return;
  target.dataset.key = key;
  target.replaceChildren(
    ...slots.map((s) =>
      el("span", { className: "relic " + (s.up ? s.kind : "spent"), title: s.title }, s.glyph)),
  );
}

// Footer slots for each player you control: bombs still free, and the
// fatality — locked until a 4 streak, lit when it can be used right now.
function renderAbilities(state) {
  const mine = session.mode === "online" ? [session.slot] : [0, 1];
  const bombKeys = session.mode === "online" ? ["Space"] : ["Space", "Enter"];
  const fatalKeys = session.mode === "online" ? [FATALITY_KEY_ONLINE] : ["X", "R-Shift"];
  const slots = mine.map((index, i) => {
    const player = state.players[index];
    const max = statsOf(player.className).maxBombs;
    const live = state.bombs.filter((b) => b.owner === index).length;
    const offer = fatalityReady(state, index);
    return {
      index,
      free: Math.max(0, max - live),
      bombKey: bombKeys[i],
      fatalKey: fatalKeys[i],
      streak: player.streak,
      fatal: offer === "near" || offer === "anywhere" ? "ready" : player.streak >= FATALITY_STREAK ? "far" : "locked",
    };
  });
  const key = slots.map((s) => [s.index, s.free, s.streak, s.fatal].join(":")).join();
  if (abilitiesEl.dataset.key === key) return;
  abilitiesEl.dataset.key = key;
  abilitiesEl.replaceChildren(
    ...slots.flatMap((s) => [
      el("div", { className: s.free ? "ability" : "ability empty", "data-player": String(s.index) }, [
        el("div", { className: "ability-slot", title: s.free + (s.free === 1 ? " bomb ready" : " bombs ready") }, [
          el("span", { "aria-hidden": "true" }, "◉"),
          el("span", { className: "ability-count" }, String(s.free)),
        ]),
        el("span", { className: "ability-key" }, s.bombKey),
      ]),
      el("div", { className: "ability fatal " + s.fatal, "data-player": String(s.index) }, [
        el("div", {
          className: "ability-slot",
          title: s.fatal === "ready" ? "Fatality — press " + s.fatalKey
            : s.fatal === "far" ? "Fatality — get within " + FATALITY_RANGE + " squares"
            : "Fatality unlocks at a " + FATALITY_STREAK + " kill streak",
        }, [
          el("span", { "aria-hidden": "true" }, "✠"),
          el("span", { className: "ability-count" }, Math.min(s.streak, FATALITY_STREAK) + "/" + FATALITY_STREAK),
        ]),
        el("span", { className: "ability-key" }, s.fatalKey),
      ]),
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
      lives: p.lives,
      self: p.selfShields,
      armor: p.shields,
      alive: p.alive,
      bombs: state.bombs.filter((b) => b.owner === p.index).length,
    })),
    crates: new Set((state.tiles || []).filter((t) => t > 0)),
    round: state.round,
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
        ? [el("span", { className: "who", "data-player": String(entry.who) }, PLAYER_NAMES[entry.who]), " "]
        : []),
      entry.text,
    ]),
  );
}

function updateFeed(state) {
  const now = summarise(state);
  if (lastSeen) {
    const entries = [];
    if (now.fatality && !lastSeen.fatality) {
      pushFeed([{ who: now.fatality.by, text: "performs a fatality on " + PLAYER_NAMES[now.fatality.victim] }]);
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
    now.players.forEach((p, i) => {
      const was = lastSeen.players[i];
      if (p.bombs > was.bombs) entries.push({ who: i, text: "places a bomb" });
      if (p.self < was.self && p.lives === was.lives) entries.push({ who: i, text: "survives their own blast" });
      if (p.armor < was.armor && p.lives === was.lives) entries.push({ who: i, text: "blocks the hit with armor" });
      if (p.lives < was.lives) entries.push({ who: i, text: "loses a life" });
    });
    if (entries.length) pushFeed(entries);
  }
  lastSeen = now;
}

// --- chrome -----------------------------------------------------------------

function setLegend(rows) {
  legend.replaceChildren(
    ...rows.map((row) =>
      el("div", { className: "codex-row", "data-player": String(row.player) }, [
        el("span", { className: "codex-key" }, row.key),
        el("span", { className: "codex-what" }, row.what),
      ])),
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

// One pip per round the match can last, lit in the colour of who survived it.
function renderPips(state) {
  const history = state.history || [];
  const key = history.map(String).join() + "|" + state.round + "|" + state.status;
  if (pipsEl.dataset.key === key) return;
  pipsEl.dataset.key = key;
  const total = Math.max(maxRoundsOf(state), history.length + (state.status === "over" ? 0 : 1));
  pipsEl.replaceChildren(
    ...Array.from({ length: total }, (_, i) => {
      const dot = el("span", { className: "pip-dot" });
      if (i < history.length) dot.setAttribute("data-won", history[i] === null ? "draw" : String(history[i]));
      else if (i === history.length && state.status !== "over") dot.classList.add("current");
      return dot;
    }),
  );
}

// The big text over the board. `spec` is null (hidden) or
// { key, kicker, main, kind, player, dim, anim } — the animation only restarts
// when the key changes, so a steady "3" does not flicker 60 times a second.
function showCallout(spec) {
  const key = spec ? spec.key : "";
  if (calloutEl.dataset.key === key) return;
  calloutEl.dataset.key = key;
  if (!spec) {
    calloutEl.hidden = true;
    return;
  }
  calloutKicker.textContent = spec.kicker || "";
  calloutMain.textContent = spec.main;
  calloutMain.className = "callout-main" + (spec.kind ? " " + spec.kind : "");
  if (spec.player === undefined) calloutMain.removeAttribute("data-player");
  else calloutMain.setAttribute("data-player", String(spec.player));
  calloutEl.className = "callout" + (spec.dim ? " dim" : "");
  calloutEl.hidden = false;
  void calloutEl.offsetWidth; // restart the CSS animation
  calloutEl.classList.add(spec.anim || "pop");
}

function calloutFor(state) {
  if (state.finish && state.finish.type === "fatality") {
    return {
      key: "fatality",
      kicker: PLAYER_NAMES[state.finish.by] + " · " + state.finish.streak + " kill streak",
      main: "Fatality",
      kind: "fatality",
      player: state.finish.by,
      dim: true,
      anim: "slam",
    };
  }
  if (state.status === "over") return null;
  const roundTag = "Round " + state.round;
  if (state.phase === "countdown") {
    const n = Math.max(1, Math.ceil(state.phaseLeft / 1000));
    return { key: "cd" + n, kicker: roundTag, main: String(n), dim: true };
  }
  if (state.phase === "roundEnd") {
    const fallen = state.fallen || [];
    const both = fallen.length > 1;
    return {
      key: "end" + state.round,
      kicker: roundTag + " over",
      main: both ? "Both fall" : PLAYER_NAMES[fallen[0]] + " falls",
      kind: "small",
      player: both ? undefined : fallen[0],
      dim: true,
    };
  }
  if (state.phase === "live" && state.liveFor < GO_FLASH_MS) {
    return { key: "go" + state.round, kicker: roundTag, main: "GO", kind: "go", anim: "fade" };
  }
  return null;
}

// --- kill streaks ------------------------------------------------------------

let lastStreaks = [0, 0];

// Is this slot played from this screen? (Both are, in local play.)
const controls = (index) => session.mode !== "online" || index === session.slot;
const fatalityKeyOf = (index) => (session.mode === "online" ? FATALITY_KEY_ONLINE : FATALITY_KEYS_LOCAL[index]);

// The quick banner when a streak reaches 2, 3, 4…
function flashStreak(index, streak) {
  const mine = controls(index);
  const key = fatalityKeyOf(index);
  streakName.textContent = PLAYER_NAMES[index];
  streakCount.textContent = streak + " kill streak";
  streakNote.textContent =
    streak >= FATALITY_ANYWHERE_STREAK
      ? (mine ? "Fatality — press " + key + ", from anywhere" : "They can finish you from anywhere")
      : streak >= FATALITY_STREAK
        ? (mine ? "Fatality unlocked — get within " + FATALITY_RANGE + " squares, press " + key
          : "Fatality unlocked — keep your distance")
        : "";
  streakEl.setAttribute("data-player", String(index));
  streakEl.className = "streak" + (streak >= FATALITY_STREAK ? " big" : "");
  streakEl.hidden = false;
  void streakEl.offsetWidth; // restart the animation
  streakEl.classList.add("flash");
}

function watchStreaks(state) {
  state.players.forEach((player, i) => {
    if (player.streak > lastStreaks[i] && player.streak >= STREAK_SHOWN_FROM) flashStreak(i, player.streak);
    lastStreaks[i] = player.streak;
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
  promptEl.setAttribute("data-player", String(spec.player));
  promptEl.className = "prompt" + (spec.ready ? " ready" : "");
  promptEl.hidden = false;
}

function promptFor(state) {
  for (const player of state.players) {
    const offer = fatalityReady(state, player.index);
    if (!offer) continue;
    const name = PLAYER_NAMES[player.index];
    const key = fatalityKeyOf(player.index);
    const ready = offer !== "far";
    const text = controls(player.index)
      ? (ready ? name + " · Press " + key + " — Fatality"
        : name + " · Fatality ready — get within " + FATALITY_RANGE + " squares")
      : (ready ? name + " can finish you — get away!" : name + " has a fatality — keep your distance");
    return { key: player.index + offer + text, text, player: player.index, ready };
  }
  return null;
}

function updateHud(state) {
  clockEl.textContent = formatClock(state.elapsed);
  roundLabel.textContent = "Round " + state.round + " of up to " + maxRoundsOf(state);
  renderPips(state);
  showCallout(calloutFor(state));
  watchStreaks(state);
  setPrompt(promptFor(state));
  state.players.forEach((player, i) => {
    renderCard(cardEls[i], player, state);
    renderShields(shieldEls[i], player);
  });
  renderAbilities(state);
  updateFeed(state);
}

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

  if (session.state) {
    updateHud(session.state);
    if (session.state.status === "over" && !session.overShown) {
      const fatality = session.state.finish && session.state.finish.type === "fatality";
      if (!session.overAt) {
        session.overAt = now;
        if (fatality) boardWrap.classList.add("quake");
      }
      if (!fatality || now - session.overAt >= FATALITY_SHOW_MS) {
        session.overShown = true;
        showResult(session.state);
      }
    } else if (session.state.status === "playing" && session.overShown) {
      session.overShown = false;
      session.overAt = 0;
      hidePanel();
    }
  }

  draw(canvas, session.state, now);
  requestAnimationFrame(frame);
}

// Handle for poking at a running match from the devtools console.
window.grid1v1 = session;

showMenu();
requestAnimationFrame(frame);
