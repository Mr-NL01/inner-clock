import assert from "node:assert/strict";
import { createEngine, rollDie, displayName } from "../js/dertigen/engine.js";

// Plain Node test runner: node bbakkie/tests/dertigen-engine.test.js
// Every case injects a deterministic RNG; no Math.random reaches the dice.

let assertionCount = 0;
let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  assertionCount += 1;
  assert.deepStrictEqual(actual, expected, msg);
}
function ok(cond, msg) {
  assertionCount += 1;
  assert.ok(cond, msg);
}
function throws(fn, msg) {
  assertionCount += 1;
  assert.throws(fn, undefined, msg);
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

// Scripted RNG: a queue of exact die values. (v - 0.5) / 6 avoids the
// float-precision off-by-one that (v - 1) / 6 would hit in rollDie.
function makeRig() {
  const queue = [];
  const rng = () => {
    if (queue.length === 0) throw new Error("RNG queue empty — test script under-provisioned");
    return (queue.shift() - 0.5) / 6;
  };
  rng.push = (...vals) => queue.push(...vals);
  rng.left = () => queue.length;
  return rng;
}

function newGame(names, rig) {
  const eng = createEngine(rig);
  eng.setPlayerCount(names.length);
  eng.goToNames();
  names.forEach((n, i) => eng.setName(i, n));
  eng.startGame();
  return eng;
}

// Plays one full dice turn from DRINK/DICE_TURN through resolveTurn().
// script: [[diceValues, pickValue], ...] — diceValues length must equal the
// current dice pool each throw.
function playTurn(eng, rig, script, drinkN = 0) {
  if (eng.getState().screen === "DRINK") eng.drink(drinkN);
  for (const [dice, pick] of script) {
    rig.push(...dice);
    eng.throwDice();
    eng.pickValue(pick);
  }
  eng.resolveTurn();
}

// From SCOREBOARD (dismissing a dive popup if present) to the next turn.
function nextTurn(eng) {
  if (eng.getState().popup) eng.dismissPopup();
  eng.advanceTurn();
}

// Common scripts.
const T30 = [[[5, 5, 5, 5, 5, 5], 5]]; // total 30 — a no-op turn
const T33 = [
  [[6, 6, 6, 6, 6, 3], 6],
  [[3], 3],
]; // total 33 — verschil 3
const T32 = [
  [[6, 6, 6, 6, 6, 2], 6],
  [[2], 2],
]; // total 32 — verschil 2

console.log("dertigen-engine tests");

test("1. pickValue takes ALL dice of the chosen value", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  eq(eng.getState().screen, "DICE_TURN", "0 sips skips DRINK");
  rig.push(5, 5, 5, 2, 1, 4);
  eng.throwDice();
  eng.pickValue(5);
  const s = eng.getState();
  eq(s.setAside, [5, 5, 5], "three 5s set aside");
  eq(s.dicePool, 3, "three dice remain");
  eq(s.lastThrow, null, "throw consumed");
});

test("2. pickValue rejects a value not in the throw", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  rig.push(5, 5, 5, 2, 1, 4);
  eng.throwDice();
  throws(() => eng.pickValue(3), "3 is not in the throw");
  const s = eng.getState();
  eq(s.setAside, [], "state unchanged after illegal pick");
  eq(s.lastThrow, [5, 5, 5, 2, 1, 4], "throw still awaiting a legal pick");
});

test("3. six distinct throws last 6 throws; triples shorten the turn", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[1, 2, 3, 4, 5, 6], 6],
    [[1, 2, 3, 4, 5], 5],
    [[1, 2, 3, 4], 4],
    [[1, 2, 3], 3],
    [[1, 2], 2],
    [[1], 1],
  ]);
  eq(eng.getState().throwsTaken, 6, "six single picks = six throws");

  const rig2 = makeRig();
  const eng2 = newGame(["A", "B"], rig2);
  rig2.push(5, 5, 5, 2, 2, 2);
  eng2.throwDice();
  eng2.pickValue(5);
  rig2.push(2, 2, 2);
  eng2.throwDice();
  eng2.pickValue(2);
  const s = eng2.getState();
  eq(s.throwsTaken, 2, "two triples = two throws");
  eq(s.turnComplete, true, "all six dice aside");
});

test("4. band boundaries: 6, 10 dive; 11/29 self-points; 30 nothing; 31/36 hunt", () => {
  // total 6 — dive
  let rig = makeRig();
  let eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [[[1, 1, 1, 1, 1, 1], 1]]);
  eq(eng.getState().popup, { type: "dive" }, "total 6 is a successful duik");
  eq(eng.getState().screen, "SCOREBOARD");

  // total 10 — dive
  rig = makeRig();
  eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[1, 1, 1, 1, 2, 4], 1],
    [[2, 4], 2],
    [[4], 4],
  ]);
  eq(eng.getState().popup, { type: "dive" }, "total 10 is still a duik");

  // total 11 — self +19
  rig = makeRig();
  eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[1, 1, 1, 2, 2, 4], 1],
    [[2, 2, 4], 2],
    [[4], 4],
  ]);
  eq(eng.getState().players[0].sips, 19, "total 11 -> self +19");
  eq(eng.getState().popup, null, "no popup for a plain band");

  // total 29 — self +1
  rig = makeRig();
  eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[6, 6, 6, 5, 5, 1], 6],
    [[5, 5, 1], 5],
    [[1], 1],
  ]);
  eq(eng.getState().players[0].sips, 1, "total 29 -> self +1");

  // total 30 — nothing
  rig = makeRig();
  eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, T30);
  eq(eng.getState().players[0].sips, 0, "total 30 -> nothing");
  eq(eng.getState().players[1].sips, 0);
  eq(eng.getState().screen, "SCOREBOARD");

  // total 31 — left +1, hunt starts at wanted 1
  rig = makeRig();
  eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[6, 6, 6, 6, 5, 2], 6],
    [[5, 2], 5],
    [[2], 2],
  ]);
  let s = eng.getState();
  eq(s.screen, "HUNT", "total 31 starts a hunt");
  eq(s.players[1].sips, 1, "left player got the base verschil immediately");
  eq(s.hunt.wanted, 1, "hunting 1s");
  eq(s.hunt.baseVerschil, 1);

  // total 36 — left +6, hunt wanted 6
  rig = makeRig();
  eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [[[6, 6, 6, 6, 6, 6], 6]]);
  s = eng.getState();
  eq(s.players[1].sips, 6, "total 36 -> left +6");
  eq(s.hunt.wanted, 6, "hunt wanted = 6");
});

test("5. dive doubling: others 0, 4, 12, 25 become 0, 8, 24, 50; diver unchanged", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B", "C", "D", "E"], rig);
  // Round 1: hand out band self-points to C, D, E (B stays at 0).
  playTurn(eng, rig, T30); // A
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);
  playTurn(eng, rig, [
    [[6, 6, 6, 6, 1, 1], 6],
    [[1, 1], 1],
  ]); // C: total 26 -> +4
  nextTurn(eng);
  playTurn(eng, rig, [[[3, 3, 3, 3, 3, 3], 3]]); // D: total 18 -> +12
  nextTurn(eng);
  playTurn(eng, rig, [
    [[1, 1, 1, 2, 2, 4], 1],
    [[2, 2, 4], 2],
    [[4], 4],
  ]); // E: total 11 -> +19
  nextTurn(eng);
  // Round 2: E needs +6 more to reach 25.
  playTurn(eng, rig, T30); // A
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);
  playTurn(eng, rig, T30); // C (drinks 0 first)
  nextTurn(eng);
  playTurn(eng, rig, T30); // D (drinks 0 first)
  nextTurn(eng);
  playTurn(eng, rig, [[[4, 4, 4, 4, 4, 4], 4]]); // E: total 24 -> +6 = 25
  nextTurn(eng);
  eq(
    eng.getState().players.map((p) => p.sips),
    [0, 0, 4, 12, 25],
    "setup: others at 0, 4, 12, 25"
  );

  // Round 3: A dives.
  playTurn(eng, rig, [[[1, 1, 1, 1, 1, 1], 1]]);
  const s = eng.getState();
  eq(s.players.map((p) => p.sips), [0, 0, 8, 24, 50], "doubling: 0 stays 0, diver unchanged");
  eq(s.popup, { type: "dive" });
});

test("6. hunt canonical: total 33, two 3s then dead, dead -> left gains exactly 9", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B", "C"], rig);
  playTurn(eng, rig, T33);
  let s = eng.getState();
  eq(s.screen, "HUNT");
  eq(s.players[1].sips, 3, "base verschil 3 applied to B");

  rig.push(3, 3, 1, 1, 1, 1); // two hunted 3s
  eng.huntThrow();
  s = eng.getState();
  eq(s.players[1].sips, 9, "3 base + 3 + 3");
  eq(s.hunt.remaining, 4, "four dice left at this level");
  eq(s.hunt.pointsToLeft, 9);

  rig.push(1, 1, 1, 1); // dead — joker
  eng.huntThrow();
  s = eng.getState();
  eq(s.popup, { type: "joker" }, "joker popup on the first dead throw");
  eq(s.hunt.jokerUsed, true, "joker consumed");
  eq(s.hunt.ended, false, "hunt continues after the joker");
  eng.dismissPopup();

  rig.push(1, 1, 1, 1); // dead again — hunt over
  eng.huntThrow();
  s = eng.getState();
  eq(s.hunt.ended, true, "second dead throw ends the hunt");
  eng.finishHunt();
  s = eng.getState();
  eq(s.screen, "SCOREBOARD");
  eq(s.players[1].sips, 9, "left received 3 + 3 + 3 = 9 total");
  eq(s.players[0].sips, 0, "thrower unchanged");
});

test("7. joker does not reset on escalation", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, T32); // verschil 2
  rig.push(2, 2, 2, 2, 2, 2); // six 2s — full level, escalate to 3
  eng.huntThrow();
  let s = eng.getState();
  eq(s.hunt.wanted, 3, "escalated to hunting 3s");
  eq(s.hunt.jokerUsed, false, "joker untouched by escalation");

  rig.push(1, 1, 1, 1, 1, 1); // dead on the fresh level — joker
  eng.huntThrow();
  eq(eng.getState().hunt.jokerUsed, true, "joker spent");
  eng.dismissPopup();

  rig.push(1, 1, 1, 1, 1, 1); // dead — NO new joker, hunt ends
  eng.huntThrow();
  eq(eng.getState().hunt.ended, true, "hunt ends after the second dead throw overall");
});

test("8. escalation scores by the NEW number: base 2 + 12 + 6 = 20", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, T32); // B +2
  rig.push(2, 2, 2, 2, 2, 2); // six 2s -> +12, escalate
  eng.huntThrow();
  eq(eng.getState().players[1].sips, 14, "2 base + six 2s");

  rig.push(3, 3, 1, 1, 1, 1); // two 3s at the new level -> +6
  eng.huntThrow();
  eq(eng.getState().players[1].sips, 20, "hunting 3s adds 3 per die");

  rig.push(1, 1, 1, 1); // dead — joker
  eng.huntThrow();
  eng.dismissPopup();
  rig.push(1, 1, 1, 1); // dead — over
  eng.huntThrow();
  eng.finishHunt();
  const s = eng.getState();
  eq(s.players[1].sips, 20, "left gained base 2 + 12 + 6 = 20");
  eq(s.screen, "SCOREBOARD");
});

test("9. escalation at 6 stays 6", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [[[6, 6, 6, 6, 6, 6], 6]]); // total 36 -> wanted 6
  rig.push(6, 6, 6, 6, 6, 6); // full level of 6s
  eng.huntThrow();
  const s = eng.getState();
  eq(s.hunt.wanted, 6, "a verschil of 6 escalates to... 6");
  eq(s.hunt.remaining, 6, "fresh dice regardless");
  eq(s.players[1].sips, 6 + 36, "six 6s still scored");
});

test("10. rotation wraps: last player's left is player 0", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B", "C"], rig);
  playTurn(eng, rig, T30); // A
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);
  eq(eng.getState().currentIndex, 2, "C's turn");
  playTurn(eng, rig, [
    [[6, 6, 6, 6, 5, 2], 6],
    [[5, 2], 5],
    [[2], 2],
  ]); // C: total 31
  const s = eng.getState();
  eq(s.players[0].sips, 1, "C's left is A (wrap to player 0)");
  eq(s.leftIndex, 0);
});

test("11. drink floors at 0 and the counter cannot exceed current sips", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[6, 6, 6, 5, 1, 1], 6],
    [[5, 1, 1], 5],
    [[1, 1], 1],
  ]); // A: total 25 -> +5
  eq(eng.getState().players[0].sips, 5);
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);

  let s = eng.getState();
  eq(s.screen, "DRINK", "A has sips, so the drink screen shows");
  for (let i = 0; i < 9; i++) eng.adjustDrinkCounter(1);
  eq(eng.getState().drinkCounter, 5, "counter capped at current sips");
  for (let i = 0; i < 9; i++) eng.adjustDrinkCounter(-1);
  eq(eng.getState().drinkCounter, 0, "counter floored at 0");
  eng.beerCounter();
  eq(eng.getState().drinkCounter, 5, "beer button clamps 10 to current sips");

  eng.drink(99);
  s = eng.getState();
  eq(s.players[0].sips, 0, "sips floor at 0");
  eq(s.screen, "DICE_TURN", "drinking proceeds to the dice phase");
});

test("11b. beer button adds 10 per tap, clamped to current sips", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  playTurn(eng, rig, [
    [[1, 1, 1, 2, 2, 4], 1],
    [[2, 2, 4], 2],
    [[4], 4],
  ]); // A: total 11 -> +19
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);
  playTurn(eng, rig, [
    [[2, 2, 2, 2, 2, 4], 2],
    [[4], 4],
  ]); // A drinks 0, then total 14 -> +16 = 35
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);

  eq(eng.getState().screen, "DRINK", "A back on the drink screen with 35 sips");
  eq(eng.getState().players[0].sips, 35);
  eng.beerCounter();
  eq(eng.getState().drinkCounter, 10, "first tap: 10");
  eng.beerCounter();
  eq(eng.getState().drinkCounter, 20, "second tap: 20");
  eng.beerCounter();
  eq(eng.getState().drinkCounter, 30, "third tap: 30 (the 35-sips example)");
  eng.beerCounter();
  eq(eng.getState().drinkCounter, 35, "fourth tap clamps to current sips");
});

test("12. startTurn skips DRINK when sips === 0", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  eq(eng.getState().screen, "DICE_TURN", "fresh game: 0 sips, no drink screen");
  playTurn(eng, rig, T30);
  nextTurn(eng);
  eq(eng.getState().screen, "DICE_TURN", "B also at 0 sips, skipped again");
});

test("13. quitCurrentPlayer mid-hunt voids the turn", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B", "C"], rig);
  playTurn(eng, rig, T33); // B +3, hunt starts
  rig.push(3, 3, 1, 1, 1, 1);
  eng.huntThrow(); // B at 9
  eq(eng.getState().players[1].sips, 9);

  eng.quitCurrentPlayer();
  const s = eng.getState();
  eq(s.players.map((p) => p.name), ["B", "C"], "A removed, seating re-linked");
  eq(s.players[0].sips, 0, "B restored to the TURN_START snapshot");
  eq(s.players[1].sips, 0);
  eq(s.currentIndex, 0, "next turn belongs to the ex-left player (B)");
  eq(s.screen, "DICE_TURN", "B has 0 sips again, drink screen skipped");
});

test("14. quitCurrentPlayer with 2 players ends the game", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B"], rig);
  eng.quitCurrentPlayer();
  eq(eng.getState().screen, "EXITED", "fewer than 2 remain -> quitGame");
});

test("15. quit on SCOREBOARD after a dive: doubled totals stand", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B", "C"], rig);
  playTurn(eng, rig, T30); // A
  nextTurn(eng);
  playTurn(eng, rig, [
    [[6, 6, 6, 6, 1, 1], 6],
    [[1, 1], 1],
  ]); // B: total 26 -> +4
  nextTurn(eng);
  playTurn(eng, rig, [[[3, 3, 3, 3, 3, 3], 3]]); // C: total 18 -> +12
  nextTurn(eng);

  playTurn(eng, rig, [[[1, 1, 1, 1, 1, 1], 1]], 0); // A dives
  let s = eng.getState();
  eq(s.screen, "SCOREBOARD");
  eq(s.players.map((p) => p.sips), [0, 8, 24], "B and C doubled");
  eng.dismissPopup();

  eng.quitCurrentPlayer(); // rollback window is closed on SCOREBOARD
  s = eng.getState();
  eq(s.players.map((p) => p.name), ["B", "C"], "quitter gone");
  eq(s.players.map((p) => p.sips), [8, 24], "doubled totals unchanged");
  eq(s.currentIndex, 0, "B is next, exactly as if Continue had been pressed");
  eq(s.screen, "DRINK", "B has sips, so their turn starts on the drink screen");
});

test("16. (extra) quit on the DRINK screen", () => {
  const rig = makeRig();
  const eng = newGame(["A", "B", "C"], rig);
  playTurn(eng, rig, [
    [[6, 6, 6, 5, 5, 1], 6],
    [[5, 5, 1], 5],
    [[1], 1],
  ]); // A: total 29 -> +1
  nextTurn(eng);
  playTurn(eng, rig, T30); // B
  nextTurn(eng);
  playTurn(eng, rig, T30); // C
  nextTurn(eng);
  eq(eng.getState().screen, "DRINK", "back to A, who now has 1 sip");

  eng.quitCurrentPlayer();
  const s = eng.getState();
  eq(s.players.map((p) => p.name), ["B", "C"], "A removed from the drink screen");
  eq(s.players.map((p) => p.sips), [0, 0], "nobody else's sips touched");
  eq(s.currentIndex, 0, "B (ex-left) is up");
});

test("helpers: rollDie range and displayName fallback", () => {
  const rig = makeRig();
  rig.push(1, 6);
  eq(rollDie(rig), 1);
  eq(rollDie(rig), 6);
  eq(displayName(["", "  ", "Zoë"], 0), "Player 1");
  eq(displayName(["", "  ", "Zoë"], 1), "Player 2");
  eq(displayName(["", "  ", "Zoë"], 2), "Zoë");
});

console.log("");
console.log(`${passed} passed, ${failed} failed, ${assertionCount} assertions`);
if (failed > 0) process.exit(1);
