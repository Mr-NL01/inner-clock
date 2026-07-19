import {
  PLAYER_COUNT,
  NAME_MAX_LENGTH,
  DICE_PER_TURN,
  TARGET_TOTAL,
  DIVE_MAX,
  BEER_COUNTER_VALUE,
} from "./config.js";

// Game state machine for Dertigen. NO DOM ACCESS — this file must be
// testable in plain Node/JS. Same subscribe/emit snapshot pattern as the
// Mexen and Inner Clock engines.
//
// Screens: HOME -> NAMES -> (per turn) DRINK? -> DICE_TURN -> [HUNT] ->
// SCOREBOARD -> next player's turn. One endless loop; the game only ends
// through the stop menu (screen "EXITED", main.js navigates away).

function clampPlayerCount(n) {
  return Math.min(PLAYER_COUNT.max, Math.max(PLAYER_COUNT.min, n));
}

function makeDefaultNames(count) {
  return Array.from({ length: count }, () => "");
}

// Empty/whitespace-only names fall back to "Player N".
export function displayName(names, index) {
  const raw = (names[index] || "").trim();
  return raw.length > 0 ? raw : `Player ${index + 1}`;
}

// rng is injectable so tests can script exact outcomes; production callers
// use the default Math.random. Each die is uniform 1-6, independent.
export function rollDie(rng = Math.random) {
  return Math.floor(rng() * 6) + 1;
}

const IN_GAME_SCREENS = ["DRINK", "DICE_TURN", "HUNT", "SCOREBOARD"];

export function createEngine(rng = Math.random) {
  let state = {
    screen: "HOME",
    playerCount: PLAYER_COUNT.default,
    names: makeDefaultNames(PLAYER_COUNT.default),
    players: null, // [{ name, sips }] in fixed seating order, set at startGame
    currentIndex: 0,
    turnStartSips: null, // sips snapshot at TURN_START — the quit-rollback window,
    // which closes the moment the turn reaches SCOREBOARD (see quitCurrentPlayer)
    throwsTaken: 0,
    dicePool: DICE_PER_TURN, // dice not yet set aside this turn
    lastThrow: null, // [values] awaiting a pick; null = awaiting a throw
    setAside: [], // dice set aside this turn, in pick order
    lastPick: null, // { value, count } of the most recent confirmed pick — for the fly animation
    turnComplete: false, // all 6 aside; resolveTurn() is UI-scheduled so the last pick can animate
    hunt: null, // see resolveTurn()
    drinkCounter: 0,
    popup: null, // { type: "dive" } | { type: "joker" }
    stopMenu: null, // null | "menu" | "confirm-game" | "confirm-player"
    throwSeq: 0, // increments on every roll (turn + hunt) — animation trigger for the UI
    pickSeq: 0, // increments on every confirmed pick — ditto
    turnSeq: 0, // increments every TURN_START so the UI can detect turn boundaries
  };

  const listeners = [];

  function leftIndex() {
    return (state.currentIndex + 1) % state.players.length;
  }

  function snapshot() {
    return {
      ...state,
      names: [...state.names],
      players: state.players ? state.players.map((p) => ({ ...p })) : null,
      turnStartSips: state.turnStartSips ? [...state.turnStartSips] : null,
      lastThrow: state.lastThrow ? [...state.lastThrow] : null,
      setAside: [...state.setAside],
      lastPick: state.lastPick ? { ...state.lastPick } : null,
      hunt: state.hunt
        ? {
            ...state.hunt,
            lastResult: state.hunt.lastResult
              ? { ...state.hunt.lastResult, dice: [...state.hunt.lastResult.dice] }
              : null,
          }
        : null,
      popup: state.popup ? { ...state.popup } : null,
      leftIndex: state.players && IN_GAME_SCREENS.includes(state.screen) ? leftIndex() : null,
    };
  }

  function emit() {
    const snap = snapshot();
    listeners.forEach((fn) => fn(snap));
  }

  function subscribe(fn) {
    listeners.push(fn);
    fn(snapshot());
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function getState() {
    return snapshot();
  }

  // ---- HOME / NAMES ----

  function setPlayerCount(n) {
    if (state.screen !== "HOME") return;
    const clamped = clampPlayerCount(n);
    if (clamped === state.playerCount) return;

    const names = makeDefaultNames(clamped);
    for (let i = 0; i < Math.min(names.length, state.names.length); i++) {
      names[i] = state.names[i];
    }
    state.playerCount = clamped;
    state.names = names;
    emit();
  }

  function goToNames() {
    if (state.screen !== "HOME") return;
    state.screen = "NAMES";
    emit();
  }

  function setName(index, value) {
    if (state.screen !== "NAMES") return;
    if (index < 0 || index >= state.names.length) return;
    state.names[index] = value.slice(0, NAME_MAX_LENGTH);
    emit();
  }

  function startGame() {
    if (state.screen !== "NAMES") return;
    state.players = state.names.map((_, i) => ({ name: displayName(state.names, i), sips: 0 }));
    state.currentIndex = 0;
    startTurn();
    emit();
  }

  // ---- turn loop ----

  // TURN_START of the state machine. Not exposed: every path into it
  // (startGame, advanceTurn, quitCurrentPlayer) calls it internally.
  function startTurn() {
    state.turnSeq += 1;
    state.turnStartSips = state.players.map((p) => p.sips);
    state.throwsTaken = 0;
    state.dicePool = DICE_PER_TURN;
    state.lastThrow = null;
    state.setAside = [];
    state.lastPick = null;
    state.turnComplete = false;
    state.hunt = null;
    state.drinkCounter = 0;
    // The drink screen is skipped entirely at 0 sips.
    state.screen = state.players[state.currentIndex].sips === 0 ? "DICE_TURN" : "DRINK";
  }

  // ---- DRINK ----

  function adjustDrinkCounter(delta) {
    if (state.screen !== "DRINK") return;
    const max = state.players[state.currentIndex].sips;
    state.drinkCounter = Math.min(max, Math.max(0, state.drinkCounter + delta));
    emit();
  }

  // 🍺 adds 10 per tap, clamped to the player's sips (35 sips, three taps:
  // 10 -> 20 -> 30; a fourth tops out at 35).
  function beerCounter() {
    if (state.screen !== "DRINK") return;
    const max = state.players[state.currentIndex].sips;
    state.drinkCounter = Math.min(max, state.drinkCounter + BEER_COUNTER_VALUE);
    emit();
  }

  // 1 Sip = 1 point, floored at 0. Proceeds to the dice phase.
  function drink(n) {
    if (state.screen !== "DRINK") return;
    const p = state.players[state.currentIndex];
    p.sips = Math.max(0, p.sips - Math.max(0, Math.floor(n)));
    state.screen = "DICE_TURN";
    emit();
  }

  function confirmDrink() {
    drink(state.drinkCounter);
  }

  // ---- DICE_TURN ----

  function throwDice() {
    if (state.screen !== "DICE_TURN" || state.popup) return;
    if (state.lastThrow || state.turnComplete) return;
    state.lastThrow = Array.from({ length: state.dicePool }, () => rollDie(rng));
    state.throwsTaken += 1;
    state.throwSeq += 1;
    emit();
  }

  // The player picks exactly ONE face value; ALL dice showing it are set
  // aside. Throws on an illegal pick (per spec) — the UI only offers legal
  // values, so this surfacing means a caller bug.
  function pickValue(v) {
    if (state.screen !== "DICE_TURN" || !state.lastThrow) {
      throw new Error("pickValue: no throw to pick from");
    }
    if (!state.lastThrow.includes(v)) {
      throw new Error(`pickValue: no ${v} in the current throw`);
    }
    const taken = state.lastThrow.filter((d) => d === v);
    state.setAside.push(...taken);
    state.dicePool -= taken.length;
    state.lastThrow = null;
    state.lastPick = { value: v, count: taken.length };
    state.pickSeq += 1;
    if (state.setAside.length === DICE_PER_TURN) {
      state.turnComplete = true;
    }
    emit();
  }

  // Fires the band logic once all 6 dice are aside. UI-scheduled (like
  // Mexen's advanceTurn) so the final pick can finish animating first.
  function resolveTurn() {
    if (state.screen !== "DICE_TURN" || !state.turnComplete) return;
    const total = state.setAside.reduce((a, b) => a + b, 0);

    if (total <= DIVE_MAX) {
      // Successful duik: every OTHER player doubles (0 stays 0), diver unchanged.
      state.players.forEach((p, i) => {
        if (i !== state.currentIndex) p.sips *= 2;
      });
      state.popup = { type: "dive" };
      state.screen = "SCOREBOARD";
    } else if (total < TARGET_TOTAL) {
      state.players[state.currentIndex].sips += TARGET_TOTAL - total;
      state.screen = "SCOREBOARD";
    } else if (total === TARGET_TOTAL) {
      state.screen = "SCOREBOARD";
    } else {
      // Base verschil is applied to the left player the moment the hunt
      // starts; each hunted die adds incrementally in huntThrow() — the
      // scoreboard is always already correct, no settlement step.
      const verschil = total - TARGET_TOTAL; // always 1..6
      state.players[leftIndex()].sips += verschil;
      state.hunt = {
        wanted: verschil, // current hunted number
        baseVerschil: verschil,
        pointsToLeft: verschil, // includes the base verschil
        jokerUsed: false, // one joker per ENTIRE hunt — never resets, not even on escalation
        remaining: DICE_PER_TURN, // dice still to throw at the current level
        asideCount: 0, // dice set aside at the current level
        ended: false, // finishHunt() is UI-scheduled so the dead throw can be shown
        lastResult: null, // last throw's breakdown, for the UI animation
      };
      state.screen = "HUNT";
    }
    emit();
  }

  // ---- HUNT ----

  function huntThrow() {
    if (state.screen !== "HUNT" || state.popup || !state.hunt || state.hunt.ended) return;
    const h = state.hunt;
    const dice = Array.from({ length: h.remaining }, () => rollDie(rng));
    state.throwSeq += 1;

    const matchedCount = dice.filter((d) => d === h.wanted).length;
    const result = {
      dice,
      wanted: h.wanted,
      matchedCount,
      asideBefore: h.asideCount,
      escalated: false,
      joker: false,
      ended: false,
    };

    if (matchedCount > 0) {
      // Wanted dice are set aside automatically, each scoring the hunted
      // number (escalated dice thereby score their own face value).
      const points = matchedCount * h.wanted;
      h.pointsToLeft += points;
      state.players[leftIndex()].sips += points;
      h.remaining -= matchedCount;
      h.asideCount += matchedCount;
      if (h.remaining === 0) {
        // ESCALATE: next number, 6 fresh dice. A verschil of 6 stays at 6.
        h.wanted = Math.min(h.wanted + 1, 6);
        h.remaining = DICE_PER_TURN;
        h.asideCount = 0;
        result.escalated = true;
      }
    } else if (!h.jokerUsed) {
      // First dead throw of the ENTIRE hunt: joker — re-throw the same dice.
      h.jokerUsed = true;
      result.joker = true;
      state.popup = { type: "joker" };
    } else {
      // Any later dead throw ends the hunt immediately.
      h.ended = true;
      result.ended = true;
    }

    h.lastResult = result;
    emit();
  }

  // UI-scheduled after the hunt-ending throw has been shown for a beat.
  function finishHunt() {
    if (state.screen !== "HUNT" || !state.hunt || !state.hunt.ended) return;
    state.hunt = null;
    state.screen = "SCOREBOARD";
    emit();
  }

  // ---- SCOREBOARD / popups ----

  function dismissPopup() {
    if (!state.popup) return;
    state.popup = null;
    emit();
  }

  function advanceTurn() {
    if (state.screen !== "SCOREBOARD" || state.popup) return;
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
    startTurn();
    emit();
  }

  // ---- stop menu / quitting ----

  function openStopMenu() {
    if (!IN_GAME_SCREENS.includes(state.screen) || state.stopMenu) return;
    state.stopMenu = "menu";
    emit();
  }

  function stopChooseQuitGame() {
    if (state.stopMenu !== "menu") return;
    state.stopMenu = "confirm-game";
    emit();
  }

  function stopChooseQuitPlayer() {
    if (state.stopMenu !== "menu") return;
    state.stopMenu = "confirm-player";
    emit();
  }

  function stopCancel() {
    if (!state.stopMenu) return;
    state.stopMenu = null;
    emit();
  }

  // "No" on a confirmation goes back to the three-option menu.
  function stopBack() {
    if (state.stopMenu !== "confirm-game" && state.stopMenu !== "confirm-player") return;
    state.stopMenu = "menu";
    emit();
  }

  function stopConfirm() {
    if (state.stopMenu === "confirm-game") {
      quitGame();
    } else if (state.stopMenu === "confirm-player") {
      quitCurrentPlayer();
    }
  }

  // All state discarded; main.js navigates back to the landing page.
  function quitGame() {
    state.screen = "EXITED";
    state.players = null;
    state.turnStartSips = null;
    state.hunt = null;
    state.popup = null;
    state.stopMenu = null;
    emit();
  }

  // The current player is removed entirely; seating re-links across the
  // gap and play continues at the ex-left player's TURN_START.
  //
  // Rollback window (Bram's ruling): during DRINK/DICE_TURN/HUNT the
  // in-progress turn is VOIDED — every remaining player's sips return to
  // the TURN_START snapshot. On SCOREBOARD the turn is already settled, so
  // its points (band, hunt, dive doubling) all stand.
  function quitCurrentPlayer() {
    if (!IN_GAME_SCREENS.includes(state.screen) || !state.players) return;

    if (state.screen !== "SCOREBOARD") {
      state.players.forEach((p, j) => {
        if (j !== state.currentIndex) p.sips = state.turnStartSips[j];
      });
    }
    state.players.splice(state.currentIndex, 1);
    state.popup = null;
    state.stopMenu = null;

    if (state.players.length < 2) {
      quitGame();
      return;
    }
    // The splice shifted the quitter's left neighbour into their seat.
    state.currentIndex = state.currentIndex % state.players.length;
    startTurn();
    emit();
  }

  return {
    subscribe,
    getState,
    setPlayerCount,
    goToNames,
    setName,
    startGame,
    adjustDrinkCounter,
    beerCounter,
    drink,
    confirmDrink,
    throwDice,
    pickValue,
    resolveTurn,
    huntThrow,
    finishHunt,
    dismissPopup,
    advanceTurn,
    openStopMenu,
    stopChooseQuitGame,
    stopChooseQuitPlayer,
    stopCancel,
    stopBack,
    stopConfirm,
    quitGame,
    quitCurrentPlayer,
  };
}
