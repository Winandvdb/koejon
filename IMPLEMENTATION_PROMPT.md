# Task: Implement "Koejonnen" — online 4-player card game

Build a complete, working web implementation of the card game Koejonnen in this repository.
Work autonomously. Do NOT stop to ask questions: apply the defaults in this spec, record every
deviation in `RULE_ASSUMPTIONS.md`, and keep iterating until all verification steps pass.

Original Dutch rules with owner corrections: `rules/koejonnen-rules-nl.txt` (source of truth is
the spec below — it already includes all corrections).

## Tech stack (fixed)

- Svelte 5 + TypeScript + Vite (use `npm create vite` svelte-ts template). Package manager: npm.
- Vitest for unit tests.
- Firebase JS SDK (v11): Anonymous Authentication + Firestore. No other backend.
- `firebase.json` + `firestore.rules` + `.env.example` included; local development MUST work
  end-to-end against the Firebase Emulator Suite with no real credentials.

## Complete game rules

### Cards and points
- 24 cards: ranks 9, 10, J, Q, K, A in 4 suits (♠ ♥ ♦ ♣).
- Trick rank order (high to low): A, K, Q, J, 10, 9.
- Point values: A=4, K=3, Q=2, J=1, 10=0, 9=0. Total card points per deal = 40.

### Players and teams
- Exactly 4 players, seats 0–3 clockwise. Teams are fixed by seating: seats {0,2} vs {1,3}
  (partner sits opposite). No random team formation.

### Match score — the "boomke"
- Each team starts with 13 lines. First team to erase all its lines wins the match.
- A "Koei" adds a line to a team (count may exceed 13). Draw it crooked with hairs (cow's tail).
- Lines never go below 0; reaching 0 ends the match immediately after scoring that hand.

### First-dealer draw (once per match, before the first deal)
- One member of team A picks up a packet from the deck: must take >= 4 cards and leave >= 8.
  The bottom card of the packet is revealed.
- One member of team B does the same on the remaining deck: take >= 4, leave >= 4.
- Higher card wins (rank order above). Tie → both players redraw.
- The winner chooses ANY of the 4 players as the first dealer.
- Digital version: the drawing player presses "Draw"; the engine picks a random packet size
  (team A: [4, 16]; team B: [4, remaining-4]) and reveals the card. The winner picks a seat
  as first dealer. Bots draw automatically and choose a random teammate.

### Deal
- The deck is shuffled (digital equivalent of the right-neighbor cut — no interaction needed).
- Deal clockwise in batches of 2 cards, three rounds: each player ends with 6 cards.
- The dealer's final batch of 2 stays separate: card 5 face-down, card 6 face-up and visible to
  all = the "first turned card". Both cards belong to the dealer's hand.
- The dealer may NOT look at their own cards during bidding: render the dealer's own 4 cards
  plus the face-down set-aside card as card backs. After trump is decided, the dealer sees all 6.

### Bidding
- Round 1 (first turned card): starting left of the dealer, clockwise, each of the 3 non-dealer
  players announces "play" or "pass". First "play" → trump = suit of the first turned card,
  stake level = 1.
- If all 3 pass: the dealer turns the second set-aside card face-up ("second turned card"),
  visible to all.
  - Same suit as the first: no announcements. The dealer immediately chooses: play (trump =
    that suit, level 2) or pass.
  - Different suit: round 2 — the same 3 players bid again, same order, on the new suit.
    First "play" → trump = suit of the second card, level 2.
  - If all 3 pass again: the dealer chooses — play with trump = either of the two shown suits
    (level 2), or pass.
- If the deal is fully passed (dealer also passes): the deal moves to the next dealer (seat
  left of the previous dealer) and the first-card stake multiplier doubles. Consecutive
  all-passes keep doubling (×2 → ×4 → ×8 …). The multiplier applies ONLY to level-1 stakes;
  level-2 stakes are never multiplied. The multiplier resets to 1 as soon as a hand is played
  and scored.

### Playing (6 tricks per deal)
- The player left of the dealer leads the first trick. The dealer now sees their cards.
- Legal plays — enforce exactly:
  - Led suit = trump: must play a trump if holding one (even a lower trump than those played).
    If void in trump: any card.
  - Led suit ≠ trump: if holding led-suit cards, must either follow suit OR play a trump —
    but the trump must be HIGHER than the highest trump currently in the trick ("no underbuy").
    If no trump is in the trick yet, any trump is legal. If void in the led suit: any card.
  - You may never discard a plain card while holding the led suit.
- Trick resolution: highest trump wins; if no trump, highest card of the led suit. The winner
  leads the next trick.

### Scoring a hand
- Sum card points won per team (total is always 40). "Playing team" = team of the player who
  announced "play" (or of the dealer when the dealer chose).
- Winning team = playing team iff it scored > 20; otherwise (including 20–20) the defending
  team wins.
- Lines erased by the WINNING team — playing or defending, same rule:
  - Level 1 (played on first turned card): 1 line × multiplier.
  - Level 2 (played on second turned card): 2 lines, never multiplied.
- Kapot: if the winning team took all 6 tricks, it erases 1 EXTRA line on top (level 1:
  1×m + 1; level 2: 2 + 1 = 3). Either team can play kapot; the +1 is never multiplied.
- Koei: if the DEFENDING team wins, the playing team adds 1 Koei on top of everything —
  including a defending kapot win.
- After scoring, the next dealer is the seat left of the previous dealer; deal again.
- Match ends when a team reaches 0 lines.

## Architecture

### Engine (pure TypeScript, framework-free)
- `src/engine/`: no Firebase or DOM imports. Deterministic seeded RNG (e.g. mulberry32).
- Model the game as a state machine. Phases:
  `LOBBY → DEALER_DRAW → DEALING → BIDDING_R1 → BIDDING_R2 → DEALER_CHOICE → PLAYING →
  SCORED → (next DEALING | GAME_OVER)`
- Expose: `createMatch`, `legalActions(state, seat)`, `apply(state, action) → newState` (or an
  equivalent reducer/command pattern). All rules above must live here.
- Serialize hands and state as plain JSON-safe data.

### Networking — Firebase Firestore, host-authoritative
- The room creator's client is the host. The host runs the engine, executes all bots' turns,
  and writes all state transitions. Other clients send intents only.
- Firestore layout:
  - `rooms/{code}` — public state: phase, seats (uid | bot), dealer, bidding progress, current
    trick, turned card(s), trump, lines per team, koeien, multiplier, seat of playing bidder,
    per-seat action-needed flag, match winner.
  - `rooms/{code}/hands/{uid}` — that player's hand. `firestore.rules`: readable/writable only
    by that uid.
  - `rooms/{code}/hands/host` — bot hands keyed by bot seat; readable only by the host uid.
  - `rooms/{code}/actions/{uid}` — a player's pending intent; rules: a uid may create/overwrite
    only its own doc. Host subscribes, validates through the engine, writes the new public
    state + updated hand docs, then deletes the action.
- Auth: `signInAnonymously` on app start. Store nickname in the seat entry.
- If the host disconnects, show a "host left" state (no migration — note the limitation).
- Handle reconnect via Firestore snapshot resume; re-read own hand doc.

### Bots (`src/bots/`)
- Produce engine actions; run inside the host client. Keep heuristics simple and legal:
  - Bidding: rate the hand for the proposed trump suit (trump count, trump honors, off-suit
    aces/kings); play above a threshold, else pass. Dealer choice: compare ratings of both
    shown suits, pick the better if it clears the threshold.
  - Trick play: lead a strong card when your team is the playing team; when following, win
    with the cheapest winning card, but if partner currently wins the trick play a
    high-point card (A/K/Q); when losing, dump the lowest legal card.
  - Must respect the no-underbuy rule — derive legal cards from `legalActions`, never raw hand.
- Bots in the dealer-draw phase draw automatically and pick a random teammate.

### UI (Svelte)
- Home: nickname, "Create room" → shows a 4–6 char room code; "Join room" by code.
- Lobby: 4 seats with names; host can add/remove bots, shuffle seats, start. Show each seat's
  team (opposite seats are partners).
- Table: own seat bottom, partner top, opponents left/right. Show dealer marker, playing-bidder
  marker, whose turn, trick cards in the center, turned trump card(s), trump suit icon,
  multiplier badge.
- Own hand: only legal cards are clickable; illegal cards visibly disabled. During bidding the
  dealer sees own cards face-down.
- Bidding UI: "Ik ga"/"Pas" (NL) / "Play"/"Pass" (EN) buttons on your turn; dealer-choice
  UI (two suit buttons + pass) when applicable. NL term for the no-underbuy rule:
  "niet onderkopen".
- Boomke scoreboard: two vertical trunks each crossed by the team's remaining lines (SVG or
  CSS). Koei lines drawn crooked with hairs. Animate erase/add if cheap.
- Score/turn log panel (last events as text).
- Language toggle NL/EN via a small i18n dictionary module (`src/lib/i18n.ts`). Default NL.
- Rules view: a "Regels/Rules" button opens a dialog that renders the full consolidated rules.
  Load `rules/rules-nl.md` or `rules/rules-en.md` (already in the repo) via Vite `?raw`
  imports, keyed by the selected language; render with a tiny markdown renderer (e.g.
  `marked`).
- Card rendering: CSS/SVG cards (suit + rank text is fine; no images needed).

### Firebase config
- Firebase is already initialized: `.firebaserc` (project `koejon-3059e`), `firebase.json`,
  `firestore.rules`, `firestore.indexes.json`. Adjust them:
  - `firebase.json`: set `hosting.public` to `dist` (Vite build output); add an `emulators`
    section (auth 9099, firestore 8080, ui enabled).
  - `firestore.rules`: replace the default open rules with the room rules below.
- `src/lib/firebase.ts`: initialize from `import.meta.env.VITE_FIREBASE_*`; if
  `VITE_USE_FIREBASE_EMULATOR=true` or config is absent, connect to local emulators.
- `.env.example` with all VITE_FIREBASE_* keys. Never commit `.env.local`.
- `firestore.rules`: `hands/{uid}` readable/writable only by that uid (`hands/host` only by
  the host uid); `actions/{uid}` create/update only by own uid; `rooms/{code}` writable only
  by the host uid, readable by any signed-in user.

## Verification — all must pass before you are done
1. `npm run build` is clean (svelte-check included, no type errors).
2. `npm test` (vitest) covers at minimum:
   - deal invariants: 24 unique cards, 6 per seat, dealer's 5th/6th set aside with 6th revealed;
   - legal-play generation incl. no-underbuy edge cases (can follow → no lower trump; void →
     low trump legal; trump led → must trump);
   - trick resolution incl. trump overplay;
   - full bidding flow: round 1 play, all-pass → round 2, same-suit shortcut to dealer choice,
     dealer play-or-pass, all-pass → multiplier doubles and deal passes left;
   - every scoring case from the scoring table incl. multiplier, kapot +1 extra line for both
     playing and defending sweeps, 20–20 loss, Koei only on defender win;
   - match end at 0 lines; dealer rotation;
   - dealer-draw constraints (packet ≥4, remaining ≥4, tie redraw, winner picks dealer).
3. Simulation test: run >= 50 complete bot-vs-bot matches through the engine only; assert
   termination and invariants (each trick has a legal winner, total points = 40 per hand).
4. Emulator run: `firebase emulators:start` + `npm run dev`; create a room, fill with 3 bots,
   play a full match to completion (scripted host commands are acceptable; document the exact
   commands/steps in README.md).
5. Update README.md: how to install, run tests, run emulators + dev server, and how to deploy
   to a real Firebase project (`firebase deploy` after `npm run build`, requires Anonymous Auth
   + Firestore enabled in the console).

## Working rules
- Keep going until every verification step passes. Fix failures; do not stop.
- If a rule edge is genuinely unspecified, choose the simplest consistent behavior and record it
  in `RULE_ASSUMPTIONS.md`.
- Pin dependency versions (no `latest`). Prefer versions at least a week old.
- Commit at meaningful milestones with conventional messages.
