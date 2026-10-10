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
- **Dealer-draw packets** — the engine shuffles one deck per attempt and keeps it on
  the host. Team B lifts from what team A left of that deck ("the remaining deck"),
  with no reshuffle in between. Tie on rank → both players redraw on a fresh shuffle.
  Packet sizes: A ∈ [4, 16], B ∈ [4, remaining − 4].
- **Dealer draw** — each team's drawing player chooses the packet size (bots pick a
  random allowed size). The draw winner then chooses the first dealer interactively
  (bots pick a random teammate).
- **Cut** — the `CUTTING` phase comes before every deal, the first one included. The
  dealer's right neighbour chooses the packet size, 4..20 (bots pick a random allowed
  size). The chosen dealer is announced during the cut and for at least 3 s after it.
- **Dealer's hidden cards** — the engine always tracks the dealer's full 6-card hand;
  masking is a view concern. During bidding the dealer's hand doc contains
  `cards: null` and the UI renders card backs (4 hand cards + the face-down set-aside
  card). After trump is set the real cards are written.
- **Mid-game player leave** — the spec only defines host disconnect. Chosen behavior:
  when a seated player leaves mid-match, a bot silently takes over the seat so the
  match can finish; in the lobby the seat is simply cleared.
- **Host disconnect detection** — clients flag "host left" when the room heartbeat is
  older than 45 s (heartbeat written by the host every 15 s, `HEARTBEAT_MS`). No host
  migration (spec'd limitation).
- **Match start** — the host can only start when all 4 seats are occupied (the game is
  defined for exactly 4 players). Any extra `start` intents are rejected.
- **Seating** — the room creator is always seat 0 and host; joining players take the
  lowest free seat. Teams are fixed by seat parity ({0,2} vs {1,3}) per spec.
- **20–20** — a draw: no lines erased, no Koei, and the next deal's level-1 stake
  goes to ×2 (playing team needs >20; defenders win at ≤19).
- **Stake multiplier cap** — the level-1 stake is at most ×2 (owner decision,
  2026-10-06). All-passed deals and 20-20 draws set it to ×2; consecutive events in
  any mix keep it at ×2 instead of doubling again. Level-2 stakes are never multiplied.
- **Deck between hands** — no reshuffle. Each won trick goes on its team's pile; the
  engine shuffles its 4 cards (seeded RNG), as a collected trick is rarely kept in
  play order. For the next deal, team 0's pile is put on top of team 1's pile, then
  the deck is cut once: the cutter's packet (4..20 cards) goes from the top to the bottom.
  After an all-passed deal the hands are thrown in as they are (seat 0 first). Only
  the first deal of a match uses a fresh shuffle.
- **Dealing is automatic** — no deal prompt: the `DEALING` phase announces the dealer
  for ~3 s, then the host issues the deal itself (after the draw, after scoring and
  after all-passed hands).
- **Trick confirmation** — a completed trick stays on the table until every seat has
  confirmed it (`ack`); the next lead is gated on all 4 acks. The leading player is
  auto-confirmed (their next card is the confirmation — no extra click); bots ack
  automatically; other humans click "Gezien". This also keeps the
  first-two-tricks review window open as long as needed.
- **Dealer's cards confirmation** — the same `ack` gate applies at the start of
  PLAYING: all seats confirm the turned cards (the first leader auto-confirms),
  then the first lead is allowed. The turned cards stay at the dealer's seat
  until that first card is played, so the first leader can still look at them.
- **Troefke** — when the bidder's partner leads the first trick, the bidder may
  ask for "Troefke" (please open with trump) during the dealer-card confirm
  window, next to "Gezien". Asking counts as the bidder's confirmation — no
  separate "Gezien" click is needed. The request shows as a "Troef?" bubble on
  the leader; it is advisory only and may be ignored (no engine enforcement).
- **Trick review window** — only the first two completed tricks of a hand may be
  looked back at, and only until the first card of the third trick is played
  (owner's literal reading of the rule). The info panel shows them during that
  window; afterwards no played trick is visible again.
- **Boomke drawing** — one shared trunk: the viewer's team ("Wij") on the left,
  the opponents ("Zij") on the right. Crossed-out marks stay visible; marks erased
  by the same hand share one continuous diagonal scratch so multi-line erasures
  are recognizable (the engine tags each mark with the hand number that crossed
  it). Erasures cross the top ladder lines first; Koei tails hang at the bottom
  and are crossed only once all lines are gone.
- **Optional info** — trump/stake display, points & trick counts and the
  first-tricks review are per-browser display settings (gear icon), persisted in
  `localStorage`. They are view-only and do not affect the game.
- **No log panel** — the event log stays in the state (used for bid bubbles) but
  is not rendered, per owner request.
- **Match score** (personal statistics, #57) — a finished match gives the winning
  team 13 and the losing team 13 minus the lines it still had to cross, Koeien
  included, at least 0 (`matchScore`). Both players of a team get the team's score.
- **Double and triple crosses** (#57) — a hand counts as a double or triple cross for
  a team when the team really crossed 2 or 3 lines in it. The last hand of a match can
  cross fewer lines than its stake: a stake of 2 with 1 line left is no double. A 20-20
  draw counts as neither. A bid ("ik ga" or the dealer's trump choice) counts as won
  only when the bidder's team wins the hand; a draw is not a win.
- **With players or against bots** (#57) — the statistics count a match "with players"
  when at least one seat other than the own seat was played by a human, also for part of
  the match (`mixed`). When the three other seats were all bots, it counts "against bots".
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
- **Host-authoritative writes** — only the host publishes state: the room public
  state plus one hand doc per human seat, in one batched write (over Firestore) or
  one message per guest (over WebRTC). Clients only send intents (their own
  `actions/{uid}` doc over Firestore).
- **Engine recovery** — the full engine state stays on the host device, in
  `localStorage` under `koejon-engine-{code}`, so a host reload can resume a match.
  It never goes to Firestore, so other clients cannot read it (it contains all hands
  and the RNG state).
- **Bot dealer chooses blind** — a human dealer's hand doc is masked during bidding,
  so a bot dealer may not rate its hand for the dealer choice either. The bot picks a
  shown suit at random (≈70% play) instead of evaluating its cards.
- **Room update fencing** — every host commit must set `version` to exactly
  `version + 1` (enforced in `firestore.rules`); heartbeat-only writes are exempt.
  A second host instance on the same uid is fenced out instead of corrupting the
  room with diverging writes.
- **Host leave deletes the room** — when the host clicks "Leave", the whole room tree
  (room doc, hand docs, engine state) is deleted instead of leaving a zombie room
  the other players cannot continue.
- **Kicking a stuck player** — the host can remove a human seat (lobby: seat cleared;
  mid-game: a bot takes over, same as a voluntary leave). This covers players who
  close their tab without sending a leave intent.
- **Intent outbox** — clients queue intents and write the next `actions/{uid}` doc
  only after the host deleted the previous one, so rapid actions cannot overwrite
  each other or be deleted unseen.
- **Hand docs are host-written only** — a player reads their own `hands/{uid}` doc
  but cannot write it (deviation from the original spec text: self-write had no use
  and could only corrupt the player's own view).
- **Rooms are get-only** — `list` on `rooms` is denied: join-by-code needs only
  `get`, and denying `list` stops enumeration of open lobbies.
