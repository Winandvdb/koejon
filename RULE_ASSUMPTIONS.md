# Rule assumptions and deviations

Decisions taken where the rules/spec left room for interpretation, plus local
environment deviations. Each entry lists the chosen behavior.

## Game rules

- **Advancing after a hand is scored** — the result panel stays up until a human
  clicks "next hand"; bots never advance a scored hand so the result cannot flash
  past. Any seated player's click advances the game for everyone.
- **Koei bookkeeping** — a defending win gives the playing team a Koei: the team's line
  count increases by 1 (may exceed 13) and a separate `koeien` counter is incremented so
  the scoreboard can draw those lines crooked with hairs. On the boomke the Koei is
  drawn at the bottom, below the line ladder.
- **Dealer-draw packets** — team B draws from the same shuffled deck minus team A's
  packet ("the remaining deck"). Tie on rank → both players redraw on a fresh shuffle.
  Packet sizes are picked by the engine: A ∈ [4, 16], B ∈ [4, remaining − 4].
- **Dealer draw** — the packet draws need no input and resolve automatically.
  The draw winner then chooses the first dealer interactively (bots pick a random
  teammate). The chosen dealer is announced for at least 3 s before the deal.
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
- **Dealing is automatic** — no deal prompt: the `DEALING` phase announces the dealer
  for ~3 s, then the host issues the deal itself (after the draw, after scoring and
  after all-passed hands).
- **Trick confirmation** — a completed trick stays on the table until every seat has
  confirmed it (`ack`); the next lead is gated on all 4 acks. The leading player is
  auto-confirmed (their next card is the confirmation — no extra click); bots ack
  automatically; other humans click "Gezien". This also keeps the
  first-two-tricks review window open as long as needed.
- **Dealer's cards confirmation** — the same `ack` gate applies at the start of
  PLAYING: the turned cards stay at the dealer's seat until all seats confirmed
  them (the first leader auto-confirms), then the first lead is allowed.
- **Troefke** — when the bidder's partner leads the first trick, the bidder may
  ask for "Troefke" (please open with trump) during the dealer-card confirm
  window, next to "Gezien". The request shows as a "Troef?" bubble on the
  leader; it is advisory only and may be ignored (no engine enforcement).
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
