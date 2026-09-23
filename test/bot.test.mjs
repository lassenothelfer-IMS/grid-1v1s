// Computer players, headless: whole matches between bots (and against a
// dummy that never moves), at the speed of the engine.
// Usage: node test/bot.test.mjs

import { createGame, step, viewFor } from "../shared/engine.js";
import { createBot, handsFor, BOT_LEVELS } from "../shared/bot.js";
import { CLASS_IDS, FATALITY_ANYWHERE_STREAK, BOMB_FUSE_MS } from "../shared/constants.js";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log("  ok   " + name);
  else {
    failures += 1;
    console.log("  FAIL " + name + (detail ? "  -> " + detail : ""));
  }
}

const TICK = 1000 / 60;

// Plays a match to the end (or maxMs of game time). `levels` gives a bot
// level per seat, or null for a dummy that just stands there.
function play({ levels, classes = [], format = "duel", mode = "blitz", seed, maxMs = 240000, setup }) {
  const state = createGame({ format, mode, seed, classes, countdownMs: 0 });
  setup?.(state);
  const bots = levels.map((level, i) => (level ? { bot: createBot(i, level), hands: handsFor(state, i) } : null));
  let t = 0;
  while (state.status === "playing" && t < maxMs) {
    bots.forEach((b, i) => b && b.bot.update(viewFor(state, i), TICK, b.hands));
    step(state, TICK);
    t += TICK;
  }
  return { state, t };
}

const total = (state, key) => state.players.reduce((n, p) => n + p.stats[key], 0);

console.log("hunting a dummy");
{
  let wins = 0;
  let slowest = 0;
  let selfDestructs = 0;
  for (let seed = 1; seed <= 8; seed += 1) {
    const { state, t } = play({ levels: ["hard", null], seed });
    if (state.status === "over" && state.winner === 0) wins += 1;
    slowest = Math.max(slowest, t);
    selfDestructs += state.players[0].stats.selfDestructs;
  }
  console.log(`    hard vs dummy: ${wins}/8 won, slowest ${(slowest / 1000).toFixed(0)} s, ${selfDestructs} self-destructs`);
  check("a hard bot finds and finishes a dummy on real boards", wins === 8, wins + "/8");
  check("…without blowing itself up along the way", selfDestructs <= 1, String(selfDestructs));
}

console.log("every class can play");
for (const id of CLASS_IDS) {
  let wins = 0;
  for (let seed = 11; seed <= 13; seed += 1) {
    const { state } = play({ levels: ["hard", null], classes: [id, "classic"], seed });
    if (state.winner === 0) wins += 1;
  }
  check(`a ${id} bot beats a dummy`, wins >= 2, wins + "/3");
}

console.log("staying alive");
{
  let survived = 0;
  let tries = 0;
  for (const level of ["medium", "hard"]) {
    for (let seed = 21; seed <= 30; seed += 1) {
      tries += 1;
      const { state } = play({
        levels: [level, null],
        seed,
        maxMs: 2500,
        setup: (s) => {
          // An enemy bomb lands right on the bot.
          const me = s.players[0];
          s.bombs.push({ x: me.x, y: me.y, owner: 1, fuse: BOMB_FUSE_MS, fuseMax: BOMB_FUSE_MS, radius: 2, shape: "cross", dir: "down" });
        },
      });
      if (state.players[0].stats.deaths === 0) survived += 1;
    }
  }
  check("medium and hard bots step out of a bomb dropped on them", survived === tries, survived + "/" + tries);
}

console.log("levels");
{
  const results = {};
  for (const [a, b] of [["hard", "easy"], ["hard", "medium"], ["medium", "easy"]]) {
    let wins = 0;
    let decided = 0;
    for (let seed = 40; seed < 50; seed += 1) {
      // Swap sides every other match, so the spawn never decides it.
      const flip = seed % 2 === 1;
      const { state } = play({ levels: flip ? [b, a] : [a, b], seed });
      if (state.winner === null) continue;
      decided += 1;
      if (state.winner === (flip ? 1 : 0)) wins += 1;
    }
    results[a + " vs " + b] = wins + "/" + decided;
  }
  console.log("    " + JSON.stringify(results));
  const share = (key) => { const [w, d] = results[key].split("/").map(Number); return d ? w / d : 0; };
  check("hard beats easy nearly always", share("hard vs easy") >= 0.8, results["hard vs easy"]);
  check("hard beats medium most of the time", share("hard vs medium") >= 0.6, results["hard vs medium"]);
  check("medium beats easy most of the time", share("medium vs easy") >= 0.6, results["medium vs easy"]);
}

console.log("bot against bot");
{
  // Two hard bots dodge so well that a match can run long; what matters is
  // that they keep attacking and that their kills come from each other.
  let bombs = 0;
  let self = 0;
  let deaths = 0;
  let minutes = 0;
  for (let seed = 60; seed < 66; seed += 1) {
    const { state, t } = play({ levels: ["hard", "hard"], seed, maxMs: 120000,
      classes: [CLASS_IDS[seed % 9], CLASS_IDS[(seed + 4) % 9]] });
    bombs += total(state, "bombs");
    self += total(state, "selfDestructs");
    deaths += total(state, "deaths");
    minutes += t / 60000;
  }
  console.log(`    ${(bombs / minutes).toFixed(0)} bombs a minute, ${deaths} deaths, ${self} of them self-destructs`);
  check("hard bots keep attacking each other", bombs / minutes >= 15, (bombs / minutes).toFixed(1) + "/min");
  check("…land kills on each other", deaths - self >= 3, String(deaths - self));
  check("…and rarely blow themselves up", self <= deaths / 3, self + "/" + deaths);
}

console.log("2v2 with four bots");
{
  let finished = 0;
  let friendly = 0;
  for (let seed = 70; seed < 74; seed += 1) {
    const { state } = play({ levels: ["hard", "medium", "hard", "medium"], format: "teams", seed, maxMs: 360000 });
    if (state.status === "over") finished += 1;
    friendly += state.players.reduce((n, p) => n + p.stats.deaths, 0) - total(state, "kills") - total(state, "selfDestructs");
  }
  // Like hard against hard, a 2v2 of good bots can occasionally run very long.
  check("four bots play a 2v2 to the end", finished >= 3, finished + "/4");
  console.log(`    teammates knocked out by their own side: ${friendly}`);
}

console.log("free-for-all with six bots");
{
  let finished = 0;
  let kills = 0;
  let deaths = 0;
  let selfDestructs = 0;
  let rounds = 0;
  for (let seed = 80; seed < 83; seed += 1) {
    const { state } = play({
      levels: ["hard", "medium", "hard", "medium", "easy", "hard"],
      format: "royale",
      seed,
      maxMs: 420000,
    });
    if (state.status === "over") finished += 1;
    rounds += state.history.length;
    kills += total(state, "kills");
    deaths += total(state, "deaths");
    selfDestructs += total(state, "selfDestructs");
  }
  const ring = deaths - kills - selfDestructs;
  console.log(`    ${finished}/3 matches decided over ${rounds} rounds — ${kills} kills, ${ring} taken by the fire wall`);
  check("six bots play a free-for-all to a winner", finished === 3, finished + "/3");
  check("…killing each other along the way", kills >= rounds, kills + " kills in " + rounds + " rounds");
  check("…and not simply all walking into the fire", ring < deaths / 2, ring + " of " + deaths);
}

console.log("the finishing move");
{
  const { state } = play({
    levels: ["hard", null],
    mode: "siege",
    maxMs: 3000,
    setup: (s) => { s.players[0].streak = FATALITY_ANYWHERE_STREAK; },
  });
  check("a bot with a fatality on offer takes it", state.finish?.type === "fatality" && state.finish.by === 0);
}

console.log("levels are what they say");
check("three levels, getting quicker", BOT_LEVELS.easy.thinkMs > BOT_LEVELS.medium.thinkMs &&
  BOT_LEVELS.medium.thinkMs > BOT_LEVELS.hard.thinkMs && BOT_LEVELS.easy.stepMs > BOT_LEVELS.hard.stepMs);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
