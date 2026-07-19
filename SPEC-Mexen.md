# Mexen — Build Specification (MVP)

Author: Bram Bredewold
Purpose: hand this file to Claude Code. Build phase by phase, in order. Do not
skip ahead. This extends the existing Inner Clock app; do not break Inner Clock.

## What this game is

A single-device, pass-and-play dice drinking game (Dutch "Mexen"). Players take
turns throwing two virtual dice. The first player sets the throw limit for the
round (1–3 throws). Scores are ranked, the lowest score loses the round. The
app tracks scores, the Ridder title, and Mex count. Drinking itself is done by
the humans; the app only announces it.

It is NOT networked. Do not add servers, accounts, or network code.
UI language: all buttons and labels in English ("Throw dice", "Next round").
Only the game terms "Mex" and "Ridder" stay Dutch.

## Hard constraints (non-negotiable, same as Inner Clock)

- Vanilla HTML, CSS, JavaScript only. No frameworks, no build step, no npm.
- Mobile-first, portrait, iPhone Safari as PWA.
- Dice results come from the engine BEFORE the animation plays. The 1 s dice
  animation is theater easing into a predetermined result, exactly like the
  Inner Clock intro count-up. Use `Math.random()`; each die uniform 1–6,
  independent.
- engine has NO DOM access; ui has NO game rules. Same split discipline.

## File structure (additions)

```
inner-clock/
  index.html            unchanged except: game-switch button (Phase 1)
  mexen.html            new page, all Mexen screens as sections
  css/styles.css        shared base styles
  css/mexen.css         Mexen-specific styles
  js/mexen/config.js    scoring table, labels, timings — plain data
  js/mexen/engine.js    game state machine, dice, scoring. NO DOM ACCESS.
  js/mexen/ui.js        all DOM reads/writes, screen switching
  js/mexen/main.js      wiring + event listeners
  service-worker.js     UPDATED: precache all new files, bump VERSION
```

Navigation between the two games is a plain `<a>` link between index.html and
mexen.html. No router, no SPA tricks. Both pages are precached, so switching
works offline.

## CRITICAL — service worker (do this in Phase 1, not last)

Add mexen.html, css/mexen.css and all js/mexen/*.js files to the precache list
and bump the cache VERSION constant. Every later phase that adds a file must
add it to the precache list in the same commit. If this is forgotten, installed
iPhones keep serving the old app forever.

## Game rules (engine.js)

### Scoring

Each throw of two dice forms a score: the higher die is the tens digit, the
lower die is the units digit (6 & 2 = 62). Full ranking, highest to lowest:

```
21  = Mex        highest; thrower is immune from losing this round (🔥)
66  = 600
55  = 500
44  = 400
33  = 300
22  = 200
11  = 100        thrower becomes (or stays) Ridder ⚔️
65, 64, 63, 62, 61
54, 53, 52, 51
43, 42, 41
32               lowest possible score
31  = joker      NOT a score, NOT a throw — see below
```

### 31 — joker

Throwing 3 & 1 does not count as a throw and can never be a final score.
The player must immediately throw again; the throw counter does not advance.
This also applies on what would have been the last throw. If one die is held
(see holding rule), only the free die is rethrown and the hold persists.

### Turn structure and the throw limit

- Round 1: Player 1 starts. Later rounds: the loser of the previous round
  starts. Player order never changes.
- The throw limit is 3. The first player must throw all 3 times; there is no
  choice to stop early. The only exception is throwing Mex (21), which ends
  the turn immediately.
- If the FIRST player throws Mex on throw k, the throw limit for the round
  becomes k for everyone else.
- Every following player must throw EXACTLY the throw-limit number of times.
  No stopping early, same single exception: Mex ends your turn immediately
  (this does not change the limit for others).
- Only the LAST throw counts as a player's score. Rethrowing replaces the
  previous result; there is no "keep the best".

### Holding a 1 (the Mex hunt)

- If a player's throw contains exactly one die showing 1 and throws remain,
  that 1 MUST stay on the table; only the other die is rethrown.
- This hold can be initiated only once per turn.
- While holding: if the rethrown die shows a 1, the player now has two 1s on
  the table; they may hold the NEW 1 and rethrow the ORIGINALLY held die
  instead (still one die held, still the same single hold).
- While holding: if the rethrown die shows anything else (e.g. 5 → score 51),
  and the player throws again, they must pick up BOTH dice; the hold is over.
- The hold is irrelevant on a player's final throw (nothing is rethrown).
- Engine must expose which physical die is held so the UI can keep that exact
  die visually fixed on the table.

### Ridder

- At game start there is no Ridder.
- Throwing 1 & 1 (score 100) makes that player the Ridder immediately, taking
  the title from the previous Ridder if there was one.
- The Ridder title persists across rounds within a session.
- The Ridder's name is always shown with ⚔️ directly after it, on every screen
  where names appear (turn screen, end table).

### Doubles and drinking announcements

When a double N & N with N >= 2 is thrown, show a modal popup with a single
"Continue" button:

- Thrower is NOT the Ridder and a Ridder exists:
  "{RidderName} has to drink {N}!"
- Thrower IS the Ridder:
  "{RidderName} may give out {N} sips!"
- No Ridder exists yet: no popup. The score still counts.

The popup blocks the game until dismissed. The app never tracks sips.

### Mex count

Count every Mex (21) thrown during the current round. Reset each round.
Shown on the end screen (see below).

### End of round, loser, ties

- After the last player's turn, the round ends.
- The loser is the player with the lowest-ranked score, per the ranking table.
- Players who threw Mex are immune and can never be the loser (relevant only
  in the degenerate case where everyone threw Mex; then nobody loses and no
  throw-off happens).
- Tie for lowest between exactly 2 players: throw-off ("High is dry", screen
  spec below). One die each, highest single die wins, loser of the throw-off
  loses the round. If the throw-off ties, both rethrow until resolved.
- Tie for lowest between 3+ players: all tied players do the one-die
  throw-off sequentially in play order on the normal game screen (name +
  Gooien button, one die animation). Lowest die loses; if the lowest die is
  itself tied, only those players rethrow. The split-screen is used only for
  the 2-player case.

## Screens (mexen.html / ui.js)

Same black background and visual style as Inner Clock throughout.

### Game switcher (both games, Phase 1)

- On Inner Clock HOME, top right: 🎲 with the label "Mexen" under it. Tapping
  it navigates to mexen.html.
- On Mexen HOME, top right: ⏱️ with the label "Inner Clock" under it. Tapping
  it navigates back to index.html.
- The switcher appears ONLY on the two home screens, never mid-game.

### MEXEN HOME

- Player count selector 2–6 (same control style as Inner Clock).
- Big green Start button (identical style to Inner Clock).
- Start → NAMES screen.

### NAMES

- A large table with white outlines, one row per selected player.
- Column 1: "Player 1" … "Player N" (fixed labels).
- Column 2: text input, max 20 characters.
- Empty inputs fall back to the column-1 label as the display name
  ("Player 3" if row 3 was skipped).
- Big green Start button under the table → GAME.

### GAME (per turn)

- Current player's display name large at the top center (with ⚔️ if Ridder).
- Big green square button centered: "Throw dice". Same button for every
  player; there is no stop button, throws are mandatory.
- On press: engine resolves the throw first, then a 1 s animation of two dice
  tumbling across the screen, landing on the resolved values. While one die is
  held, that die does not tumble; it stays fixed in place and only the free
  die animates.
- After the dice land, show the resulting score (e.g. "62", "Mex!", "Ridder!")
  near the dice.
- The "Throw dice" button reappears until the player's throws are done. After
  their last throw, a short beat, then auto-advance to the next player.
- Mex ends the turn instantly (skip remaining throws, advance).
- 31: show "31!" briefly, do not advance the throw counter, require a rethrow.
- No running score table during the round (deliberately out of scope).

### THROW-OFF ("High is dry", 2-player tie only)

- Screen split in two by a horizontal white line in the middle.
- The two tied players' names appear just under and above the line; the top
  half is rendered rotated 180° so the player across the table reads it
  upright.
- Each half has its own green "Throw dice" button. Pressing it plays a ONE-die
  animation in that half and shows the result.
- When both have thrown: highest die wins, lowest loses the round. Tie → both
  buttons reset, rethrow.
- Then proceed to END.

### END (round result)

- Table with all players in ORDER OF PLAY of the round just finished (not
  sorted by score). Columns: name (with ⚔️ where applicable), final score.
  Mex shown as "Mex 🔥".
- The loser's row is highlighted in a creative way consistent with the app's
  style (Claude Code: pick something bolder than the Inner Clock red row, but
  keep the palette).
- If a throw-off happened: ✅ after the throw-off winner's name, ❌ after the
  loser's name.
- Under the table, the Mex count of the round, only if at least 1:
  "1 Mex!!", "3 Mex!!" etc. Hidden when 0.
- Under the Mex count, two equal-size buttons side by side:
  - Left, red: "Quit". Opens a confirm dialog: title "Are you sure?", body
    "When quitting the game all progress will be lost", red "Yes" button left,
    grey "No" button right. Yes → Mexen HOME, all game state (including
    Ridder) discarded. No → back to END.
  - Right, green: "Next round". Starts a new round: same players, same order,
    Ridder persists, Mex count resets, previous round's loser throws first.
    If the previous round had no loser (all Mex), the previous starter starts
    again.

## Mobile hardening

All Inner Clock Phase 5 measures apply to mexen.html as well: viewport meta,
`touch-action: manipulation`, no user-select, no overscroll, no touch callout,
pointerdown for all game buttons, Wake Lock while a game is in progress
(request on GAME entry, release on HOME/quit). The NAMES text inputs are the
one exception where user-select and the keyboard must work normally.

## Phases for Claude Code

- Phase 1: mexen.html skeleton with all sections and dummy navigation;
  game-switcher buttons on both home screens; service worker precache list
  updated + VERSION bump; verify offline switch between the two games.
- Phase 2: HOME (player count) + NAMES screen incl. fallback names; state
  carried into a stub game screen; engine module skeleton with a tested
  scoring function (ranking table incl. Mex, doubles, 100, 31).
- Phase 3: single-player turn engine: mandatory-3 / Mex-shortened throw limit,
  last-throw-counts,
  31 joker, Mex auto-stop, holding-a-1 rule with the swap case. Console-level
  verification before UI. This phase is the risk center; the holding rule and
  31 interact and must be right in the engine before any animation exists.
- Phase 4: multi-player round loop, Ridder tracking, doubles popups, Mex
  count; plain instant dice display (no animation yet).
- Phase 5: END table with loser highlight, Mex count display, quit dialog,
  next-round flow, throw-off (split screen + 3-plus fallback).
- Phase 6: 1 s dice animation (predetermined results, held die stays fixed),
  mobile hardening pass, service worker recheck, deploy.

## Explicitly out of scope for MVP

Sip tracking, sound, haptics, score history, persistence between sessions,
name persistence between sessions, networked play, running score table during
the round, configurable house rules for Mex multipliers.
