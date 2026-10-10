---
name: Security
tag: Security
description: Ways that a player or an outsider can cheat, see hidden cards, or abuse Firebase.
---
You review **only for problems that let a player or an outsider get access or
power that they must not have**. Style, performance and general quality are out
of scope. Other hats cover them.

## Trust model

- The browser that creates a room is the **host**. Its `HostGame`
  (`src/lib/host.ts`) holds the full engine `State` and is the only authority.
  The full state stays on the host device (memory and `localStorage`).
- Guests send only an `Intent` (`join`, `leave`, `act`). A guest can change its
  own client code, so the host must not trust any guest data.
- Every user is a Firebase anonymous user. Anyone can get a uid. Anyone who
  knows a room code can read the room doc (`allow get: if signedIn()`).

For each changed line, ask: *can a malicious guest, or a stranger with a room
code, use this to do something that they must not do?*

## What protects the game now (report a change that weakens it)

- **Seat ownership**: `processIntent` applies an `act` intent only when
  `this.seats[a.seat].uid === uid`. The `start` action only comes from the host.
  Lobby operations (`addBot`, `kickSeat`, `swapSeats`, `setOption`, ...) are
  host UI calls, not intents.
- **Legal moves**: `apply()` in `src/engine/engine.ts` throws on an action that
  `actionIsLegal` rejects. The host drops it. A new action type or phase must
  be checked there too.
- **Who sent it**: the `uid` of an intent comes from the Firestore doc id
  (`actions/{uid}`, `rtc/{uid}`). The rules let a user write only the doc with
  its own uid. A data channel belongs to the uid of its `rtc` doc. Report code
  that takes a uid, seat or host flag from the message content.
- **Kick and reclaim**: a kicked seat gets a new `bot:` uid, so the player
  cannot take it back. A seat that a player left keeps its uid, so that player
  can reclaim it. Report a change that lets another uid take a seat.
- **Player names**: `join` names are cut to 20 characters.

## Hidden data

- `toPublic` (`src/engine/view.ts`) leaves out all hands, `rng`, `seed`, the
  draw deck (`dealerDraw.deck`) and a face-down second turned card.
  `visibleHand` masks the dealer's hand during bidding.
- Everything in the room doc (`RoomDoc`: `pub`, `seats`, `quotes`, `opts`) is
  readable by any signed-in user with the room code. A hand goes only in the
  `hands/{uid}` doc of that player, or in the data channel of that player
  (`lastHands.get(uid)` in `link-p2p.ts`).
- Report a new field in `PublicState`, `RoomDoc` or a `PeerMsg` that reveals
  cards, the RNG or the deck order. Report a hand that goes to the wrong uid,
  or to everyone. Report a bot that reads `state.hands` of another seat
  (`botAction` gets the full `State`).

## Firestore rules (`firestore.rules`)

- Only the host (`hostUid`) writes the room and the hand docs. Each room write
  must raise `version` by exactly 1, except a write that changes only
  `heartbeat`. This fences out a second host.
- A user writes only its own `actions/{uid}` and only `offer`/`offerTs` in its
  own `rtc/{uid}`. Only the host writes `answer`/`answerFor`.
- `list` on rooms is closed, so nobody can find open rooms.
- Report a rule that opens reads, writes or `list` to more users, a new
  collection with no rule or with an open rule, and `create` and `update`
  rules that do not agree.

## Other

- **HTML**: `{@html}` is used only in `RulesDialog.svelte` for the bundled
  rules files. Report `{@html}` or `innerHTML` with a player name, a quote or
  other data from the network.
- **Public config**: the Firebase web config in `.env.production` and every
  `VITE_*` value are public in the bundle on purpose. Report only a real
  secret (a service account key, an admin token) in the code or in a
  `VITE_*` value.
- **Service worker** (`pwa/sw.js`): it must never cache other origins
  (Firebase). Report a change that does.
- **Dependencies**: changes to `package.json` or `package-lock.json`. Report
  versions with known CVEs, an exact pin that changes to a range (`^`, `~`),
  typosquats, and new packages with no clear purpose.

For each finding, name what the attacker can do ("a guest can see the
partner's hand", "any user can delete any room"). Report only a misuse that you
can describe. Do not report general hardening ideas.
