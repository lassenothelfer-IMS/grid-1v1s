// App shell: menu, class selection, the render loop, and the two ways a match
// can be driven — locally (engine runs here) or online (engine runs on the server).

import { createGame, step, requestMove, requestBomb } from "/shared/engine.js";
import { START_LIVES, CLASSES, CLASS_IDS, DEFAULT_CLASS } from "/shared/constants.js";
import { draw, fitCanvas, resetMotion } from "/render.js";
import { createInput, LOCAL_SCHEMES, ONLINE_SCHEMES } from "/input.js";
import { connect } from "/net.js";

const canvas = document.getElementById("board");
const overlay = document.getElementById("overlay");
const panel = document.getElementById("panel");
const hud = document.getElementById("hud");
const legend = document.getElementById("legend");
const roomLabel = document.getElementById("room-label");
const clockEl = document.getElementById("clock");
const livesEls = [document.getElementById("lives-0"), document.getElementById("lives-1")];
const classEls = [document.getElementById("class-0"), document.getElementById("class-1")];

const session = {
  mode: null,      // null | "local" | "online"
  state: null,     // the game state being rendered
  classes: [DEFAULT_CLASS, DEFAULT_CLASS],
  input: null,
  socket: null,
  slot: -1,
  code: null,
  overShown: false,
};

// --- small DOM helpers ------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function showPanel(...nodes) {
  panel.replaceChildren(...nodes);
  overlay.hidden = false;
}

function hidePanel() {
  overlay.hidden = true;
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
  hud.hidden = true;
  roomLabel.hidden = true;
  legend.replaceChildren();
  resetMotion();
}

// --- menu -------------------------------------------------------------------

function showMenu(error) {
  leaveSession();
  showPanel(
    el("h2", {}, "Grid 1v1"),
    el("p", {}, "Ein Tastendruck, ein Feld. Bomben zünden nach 1,5 Sekunden."),
    ...(typeof error === "string" ? [el("p", { className: "error" }, error)] : []),
    el("button", { className: "primary", onclick: () => pickLocalClasses() }, "Lokal — 1 Gerät"),
    el("button", { onclick: () => pickHostClass() }, "Online — Raum erstellen"),
    el("button", { onclick: () => showJoinForm() }, "Online — Raum beitreten"),
  );
}

// --- class selection --------------------------------------------------------

// One reusable picker: a heading, who it is for, and a button per class.
function showClassPicker({ title, forPlayer, onPick, onBack }) {
  showPanel(
    el("h2", {}, title),
    ...(forPlayer === undefined
      ? []
      : [el("div", { className: "who", "data-player": String(forPlayer) },
          forPlayer === 0 ? "Spieler 1" : "Spieler 2")]),
    ...CLASS_IDS.map((id) =>
      el("button", { className: "class-option", onclick: () => onPick(id) }, [
        el("span", { className: "n" }, CLASSES[id].name),
        el("span", { className: "d" }, CLASSES[id].blurb),
      ]),
    ),
    el("button", { onclick: onBack }, "Zurück"),
  );
}

function pickLocalClasses() {
  showClassPicker({
    title: "Klasse wählen",
    forPlayer: 0,
    onBack: () => showMenu(),
    onPick: (first) =>
      showClassPicker({
        title: "Klasse wählen",
        forPlayer: 1,
        onBack: () => pickLocalClasses(),
        onPick: (second) => startLocal([first, second]),
      }),
  });
}

function pickHostClass() {
  showClassPicker({
    title: "Klasse wählen",
    onBack: () => showMenu(),
    onPick: (className) => startOnlineHost(className),
  });
}

function showJoinForm(error) {
  const field = el("input", { type: "text", maxLength: 4, placeholder: "CODE", autocomplete: "off" });
  const submit = () => {
    const code = field.value.trim().toUpperCase();
    if (code.length !== 4) {
      showJoinForm("Der Code hat 4 Zeichen.");
      return;
    }
    showClassPicker({
      title: "Klasse wählen",
      onBack: () => showJoinForm(),
      onPick: (className) => startOnlineGuest(code, className),
    });
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });

  showPanel(
    el("h2", {}, "Raum beitreten"),
    el("p", {}, "Gib den 4-stelligen Code des Hosts ein."),
    ...(typeof error === "string" ? [el("p", { className: "error" }, error)] : []),
    field,
    el("div", { className: "row" }, [
      el("button", { onclick: () => showMenu() }, "Zurück"),
      el("button", { className: "primary", onclick: submit }, "Weiter"),
    ]),
  );
  field.focus();
}

// --- local mode -------------------------------------------------------------

function startLocal(classes) {
  const chosen = classes || session.classes;
  leaveSession();
  session.mode = "local";
  session.classes = chosen;
  session.state = createGame({ classes: chosen });
  session.input = createInput(LOCAL_SCHEMES, {
    onMove: (slot, dir) => requestMove(session.state, slot, dir),
    onBomb: (slot) => requestBomb(session.state, slot),
  });
  hud.hidden = false;
  hidePanel();
  showClassNames(chosen);
  setLegend([
    ["Spieler 1", ["W", "A", "S", "D"], "Space"],
    ["Spieler 2", ["↑", "←", "↓", "→"], "Enter"],
  ]);
}

// --- online mode ------------------------------------------------------------

function openSocket(onReady) {
  leaveSession();
  session.mode = "online";
  session.socket = connect({
    onOpen: onReady,
    onClose: () => {
      if (session.mode === "online") showMenu("Verbindung getrennt.");
    },
    onMessage: handleServerMessage,
  });
}

function startOnlineHost(className) {
  showPanel(el("h2", {}, "Verbinde …"));
  openSocket(() => session.socket.send({ type: "create", className }));
}

function startOnlineGuest(code, className) {
  showPanel(el("h2", {}, "Verbinde …"));
  openSocket(() => session.socket.send({ type: "join", code, className }));
}

function handleServerMessage(message) {
  switch (message.type) {
    case "joined":
      session.slot = message.slot;
      session.code = message.code;
      roomLabel.hidden = false;
      roomLabel.replaceChildren("Raum ", el("b", {}, message.code));
      break;

    case "waiting":
      showPanel(
        el("h2", {}, "Warte auf Gegner"),
        el("p", {}, "Teile diesen Code — das Spiel startet automatisch."),
        el("div", { className: "code" }, session.code || ""),
        el("button", { onclick: () => showMenu() }, "Abbrechen"),
      );
      break;

    case "start":
      session.overShown = false;
      session.classes = message.classes || session.classes;
      resetMotion();
      session.input?.destroy();
      session.input = createInput(ONLINE_SCHEMES, {
        onMove: (_slot, dir) => session.socket?.send({ type: "move", dir }),
        onBomb: () => session.socket?.send({ type: "bomb" }),
      });
      hud.hidden = false;
      hidePanel();
      showClassNames(session.classes);
      setLegend([
        [
          session.slot === 0 ? "Du bist Spieler 1" : "Du bist Spieler 2",
          ["W", "A", "S", "D"],
          "Space",
        ],
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

// --- game over --------------------------------------------------------------

function resultTitle(state) {
  if (state.winner === null) return "Unentschieden";
  if (session.mode === "online") {
    return state.winner === session.slot ? "Du gewinnst!" : "Du verlierst.";
  }
  return "Spieler " + (state.winner + 1) + " gewinnt!";
}

function showResult(state) {
  const again =
    session.mode === "local"
      ? el("button", { className: "primary", onclick: () => startLocal(session.classes) }, "Nochmal")
      : el(
          "button",
          {
            className: "primary",
            onclick: (event) => {
              event.currentTarget.disabled = true;
              session.socket?.send({ type: "rematch" });
            },
          },
          "Revanche",
        );

  showPanel(
    el("h2", {}, resultTitle(state)),
    el("p", {}, "Dauer " + formatClock(state.elapsed)),
    again,
    ...(session.mode === "local"
      ? [el("button", { onclick: () => pickLocalClasses() }, "Klassen ändern")]
      : []),
    el("button", { onclick: () => showMenu() }, "Hauptmenü"),
  );
}

// --- chrome -----------------------------------------------------------------

function showClassNames(classes) {
  classes.forEach((id, i) => {
    classEls[i].textContent = (CLASSES[id] || CLASSES[DEFAULT_CLASS]).name;
  });
}

function setLegend(rows) {
  legend.replaceChildren(
    ...rows.map(([who, keys, bomb]) =>
      el("span", {}, [
        el("b", {}, who),
        " ",
        ...keys.flatMap((k) => [el("span", { className: "k" }, k), " "]),
        "je 1 Feld · ",
        el("span", { className: "k" }, bomb),
        " Bombe",
      ]),
    ),
  );
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

function updateHud(state) {
  clockEl.textContent = formatClock(state.elapsed);
  state.players.forEach((player, i) => {
    const target = livesEls[i];
    if (target.childElementCount !== START_LIVES) {
      target.replaceChildren(
        ...Array.from({ length: START_LIVES }, () => el("span", { className: "pip" })),
      );
    }
    [...target.children].forEach((pip, index) => {
      pip.className = index < player.lives ? "pip" : "pip spent";
    });
  });
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
      session.overShown = true;
      showResult(session.state);
    } else if (session.state.status === "playing" && session.overShown) {
      session.overShown = false;
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
