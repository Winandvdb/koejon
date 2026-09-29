# Rule assumptions and deviations

Decisions taken where the rules/spec left room for interpretation, plus local
environment deviations. Each entry lists the chosen behavior.

## Game rules

- **Advancing after a hand is scored** — the rules do not say who moves the game from
  `SCORED` to the next deal. Any seated player (or bot) may send the `next` action; the
  first one received advances the game.
- **Koei bookkeeping** — a defending win gives the playing team a Koei: the team's line
  count increases by 1 (may exceed 13) and a separate `koeien` counter is incremented so
  the scoreboard can draw those lines crooked with hairs.
- **Dealer-draw packets** — team B draws from the same shuffled deck minus team A's
  packet ("the remaining deck"). Tie on rank → both players redraw on a fresh shuffle.
  Packet sizes are picked by the engine: A ∈ [4, 16], B ∈ [4, remaining − 4].
- **Dealer draw is fully automatic** — the draw/choose steps need no input, so the
  host resolves them for humans too; the draw winner picks a random teammate as
  first dealer (same rule the bots use). No dealer-draw UI is shown.
- **Dealer's hidden cards** — the engine always tracks the dealer's full 6-card hand;
  masking is a view concern. During bidding the dealer's hand doc contains
  `cards: null` and the UI renders card backs (4 hand cards + the face-down set-aside
  card). After trump is set the real cards are written.
- **Mid-game player leave** — the spec only defines host disconnect. Chosen behavior:
  when a seated player leaves mid-match, a bot silently takes over the seat so the
  match can finish; in the lobby the seat is simply cleared.
- **Host disconnect detection** — clients flag "host left" when the room heartbeat is
  older than 15 s (heartbeat written by the host every 5 s). No host migration (spec'd
  limitation).
- **Match start** — the host can only start when all 4 seats are occupied (the game is
  defined for exactly 4 players). Any extra `start` intents are rejected.
- **Seating** — the room creator is always seat 0 and host; joining players take the
  lowest free seat. Teams are fixed by seat parity ({0,2} vs {1,3}) per spec.
- **20–20** — implemented as a defending-team win per spec (playing team needs >20).
- **Dealing is automatic** — there is no `DEALING` phase or deal prompt: choosing the
  first dealer, an all-passed hand and `next` after scoring all deal immediately
  (owner decision; the spec's interactive deal step was removed).
- **Trick linger** — a completed trick stays on the table until the winner leads the next
  trick. The host delays a bot's next lead by at least 3 s; a human winner simply leads
  when ready (no timer).
- **Trick review window** — only the first two completed tricks of a hand may be
  looked back at, and only until the first card of the third trick is played
  (owner's literal reading of the rule). The info panel shows them during that
  window; afterwards no played trick is visible again.
- **Boomke drawing** — one shared trunk: the viewer's team ("Wij") on the left,
  the opponents ("Zij") on the right. Crossed-out marks stay visible; marks erased
  by the same hand share one continuous diagonal scratch so multi-line erasures
  are recognizable (the engine tags each mark with the hand number that crossed
  it). A Koei is drawn as a curved tail with hairs in red.
- **Optional info** — trump/stake display, points & trick counts and the
  first-tricks review are per-browser display settings (gear icon), persisted in
  `localStorage`. They are view-only and do not affect the game.
- **No log panel** — the event log stays in the state (used for bid bubbles) but
  is not rendered, per owner request.
- **Invite links** — `?room=CODE` prefills the join field; the lobby shows a QR code and
  a copyable link.

## Implementation / environment

- **Emulator ports moved** — spec defaults auth `9099` / firestore `8080` were occupied
  by unrelated processes on this machine (another project's emulator suite and a Spring
  app). This project uses: Firestore `8180`, Auth `9199`, Emulator UI `4100`, Hub
  `4401`, logging `4501`. Configured in `firebase.json`, `.env.example`,
  `src/lib/firebase.ts`, `tests/e2e.emulator.test.ts`.
- **Emulator auto-connect** — the app connects to the emulators when
  `VITE_USE_FIREBASE_EMULATOR=true` **or** when no `VITE_FIREBASE_*` config is present,
  so `npm run dev` works with zero configuration.
- **Host-authoritative writes** — all state transitions are single batched writes by
  the host (room public state + hand docs + `hands/host` + engine snapshot). Clients
  only write their own `actions/{uid}` intent doc.
- **Engine recovery** — the full engine state is persisted host-only under
  `rooms/{code}/engine/state` so a host reload can resume a match; other clients cannot
  read it (it contains all hands and the RNG state).
