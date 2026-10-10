# Koejonnen

Online 4-player Koejonnen card game. Svelte 5 + TypeScript + Vite front-end, Firebase
Anonymous Authentication + Firestore for rooms (no other backend). The room creator's
browser is the host: it runs the authoritative game engine, executes all bot turns, and
writes every state transition. Other clients only send intents.

Transport (`src/lib/transport.ts`):

- **Solo** runs fully in the tab (`link-local.ts`) — no Firestore traffic; a reload resumes
  from `localStorage`.
- **Multiplayer**: each guest opens a WebRTC data channel to the host (`link-p2p.ts`); Firestore
  carries only the lobby view and signaling (`rooms/{code}/rtc/{uid}`, ~2 writes per connect).
  A guest whose channel does not open (strict NAT, no WebRTC) falls back to the Firestore path
  (`link-firestore.ts`) automatically. A browser without WebRTC uses the Firestore path from the start.
  Optional TURN relay: set `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_CRED`.
- The host keeps the full engine state in its own `localStorage` for reload recovery.

## Install

```bash
npm install
```

Requires Node 20+ and, for the emulators, a JDK + the Firebase CLI
(`npm i -g firebase-tools`).

## Run tests

```bash
npm test          # unit tests + 60-match bot simulation
npm run build     # svelte-check + production build
```

`npm test` also picks up `tests/e2e.emulator.test.ts` when the Firestore emulator is
reachable on `127.0.0.1:8180`; it skips cleanly when no emulator is running.

## Local development (Firebase Emulator Suite, no credentials needed)

Terminal 1 — start the emulators:

```bash
firebase emulators:start
```

Terminal 2 — start the dev server:

```bash
npm run dev
```

Open the printed Vite URL. The app detects the missing `VITE_FIREBASE_*` config and
connects to the emulators automatically (Auth `127.0.0.1:9199`, Firestore
`127.0.0.1:8180`, Emulator UI `http://127.0.0.1:4100`).

> Port note: this project uses 9199/8180 instead of the Firebase defaults
> (auth 9099, firestore 8080). Change the ports in `firebase.json`, `.env.example`, `src/lib/firebase.ts` and
> `tests/e2e.emulator.test.ts` if you want the defaults back.

### Scripted end-to-end match

With the emulators running (`firebase emulators:start` in another shell):

```bash
npm run e2e
```

The test signs in anonymously, creates a room, attaches the host engine, fills the
remaining seats with three bots, starts the match and drives the host's own seat with
the bot policy until `GAME_OVER`. Assertions: a winner exists, the winner's lines are 0,
and at least one hand was played. To do it manually instead: `npm run dev`, create a
room, press "Add bot" three times, then "Start" — the host client plays the bots.

## Deploy to a real Firebase project

Prerequisites in the [Firebase console](https://console.firebase.google.com) for project
`koejon-3059e` (or your own):

1. **Authentication → Sign-in method → Anonymous**: enable.
2. **Firestore Database**: create a database (production mode is fine; the included
   `firestore.rules` replace the defaults).

Then:

```bash
# fill .env.production with your web app's VITE_FIREBASE_* values
# (it is committed on purpose: web config is public and embedded in the
# bundle anyway — security comes from Firestore rules, not the apiKey)
firebase deploy              # runs npm run build (predeploy), then deploys
                             # hosting to the "app" target (koejon.web.app)
firebase deploy --only firestore:rules   # push rules only (CI does this too)
```

The GitHub Actions workflows need no secrets for the config — the committed
`.env.production` supplies it to `npm run build` in CI as well.
`.env.local` stays for local dev overrides only and is gitignored.

To point the CLI at a different project, edit `.firebaserc` or run `firebase use`.

## How it works

- `src/engine/` — pure TypeScript game engine (state machine, no Firebase/DOM imports):
  cards, seeded RNG, dealer draw, dealing, bidding, legal-play rules (follow suit,
  no-underbuy, trump-led), trick resolution, boomke scoring, match end.
- `src/bots/` — bot heuristics that only ever pick from `legalActions`.
- `src/lib/` — `host.ts` (`HostGame`: authoritative loop, bot scheduling, intent
  processing, heartbeat), `room.ts` (client session: view, intents), the links
  (`link-local.ts`, `link-p2p.ts`, `link-firestore.ts`, behind `transport.ts`),
  `firebase.ts` (init + emulator auto-connect), and the match records: `kjn.ts`,
  `history.ts`, `stats.ts`, `download.ts`. The `AGENTS.md` code map lists every module.
- `src/components/` — Svelte UI: home, lobby, table, boomke scoreboard, log, rules dialog,
  replay viewer.
- Firestore layout: `rooms/{code}` (lobby view and public state), `rooms/{code}/hands/{uid}`
  (private hands; `hands/host` holds bot hands), `rooms/{code}/rtc/{uid}` (WebRTC
  signaling: the guest's offer and the host's answer), `rooms/{code}/actions/{uid}`
  (player intents, fallback path only), `rooms/{code}/engine/state` (host-only serialized
  engine state for recovery), `games/{id}` (finished matches as KJN/1 records,
  write-only; see below).

### Data flow

1. A guest joins the room and writes `rtc/{uid}` with a WebRTC offer. The host
   writes its answer into the same doc. The SDPs carry all ICE candidates, so this
   takes about two writes per connect.
2. Over the data channel the guest sends intents (join, leave, act). The host
   validates each one through the engine (`apply`) and sends the new public state and
   that guest's hand back over the same channel. No Firestore traffic for game moves.
3. Firestore keeps the lobby view (`rooms/{code}`) and the heartbeat, so a guest can
   find the room before a channel exists.
4. A guest whose channel does not open within a timeout falls back to Firestore. It
   writes `actions/{uid}` with its intents. The host queues them, applies them, and
   writes the public state, hand docs and engine snapshot in one batch. It then
   deletes the intent doc. This guest renders from the `rooms/{code}` snapshot plus
   its own hand doc. Other guests of the same room stay on their channel.

If the host disconnects the room shows a "host left" state (no host migration — known
limitation). Reconnects resume from the Firestore snapshot; a host reload restores the
engine from `rooms/{code}/engine/state`. When the host explicitly leaves, the whole
room tree is deleted instead. A stuck human seat can be replaced by a bot from the
host's kick button (lobby seat list or in-game nameplate).

## Game records (KJN/1)

Every finished match that a human played to the end, multiplayer and solo, is
stored once as a KJN/1 record, for later analysis and bot work. Code: `src/lib/kjn.ts` (record, `serializeKjn`,
`parseKjn`, `replayKjn`).

### Format

KJN/1 is plain text in the style of PBN/PGN: one `[Tag "value"]` per line.
A header section comes first, then one section per hand, with an empty line
between sections. The text ends with one newline. Tags always appear in the
order below; optional tags are left out, never empty. This is the canonical
form: `parseKjn` rejects any other spelling.

Cards are a suit `S H D C` plus a rank `9 T J Q K A` (`T` = 10), e.g. `HT`.
Seats are `0`–`3`; teams are seats {0,2} = team 0 and {1,3} = team 1.

Header:

| Tag | Value |
|---|---|
| `Format` | `KJN/1` |
| `App` | Build (short commit) that recorded the match |
| `Seats` | Four of `human`, `bot-easy`, `bot-normal`, `bot-hard`, `mixed` (switched mid-match), seat 0 first |
| `Winner` | Winning team. Only in a finished match |
| `Lines` | Lines left per team at the end, `"team0 team1"`. With `Winner` |

Each hand, passed (thrown-in) hands included:

| Tag | Value |
|---|---|
| `Hand` | 1, 2, … |
| `Dealer` | Seat |
| `Deal` | The four dealt hands, seat 0 first, separated by ` / `, each in dealt order. The dealer's 6th and 5th cards are the turned cards |
| `Turned` | First (face-up) and second turned card |
| `Auction` | Bids in order as seat + `G` (ik ga) or `P` (pas). Round 2, when played, follows after ` / ` |
| `Choice` | Only when the dealer chose: the trump suit, or `-` (pass) |
| `Contract` | `"bidder trump level"`, e.g. `"3 D 2"`, or `-` when everybody passed |
| `Troefke` | `1` when the bidder asked for troefke, else `0`. Not for a passed hand |
| `Play` | Tricks in order, separated by ` / `: the leading seat, then the four cards in play order. Not for a passed hand |
| `Playing` | Team of the bidder. Not for a passed hand (also for `Points` … `Koei`) |
| `Points` | Card points per team, `"team0 team1"` |
| `Crossed` | Lines crossed per team this hand |
| `Kapot` | `1` when the winning team took all 6 tricks |
| `Koei` | `1` when the playing team got a koei |

Trick acknowledgements and other UI actions are not recorded. The record has
the dealt cards, not the seed: it stays readable without the RNG or engine
build that made it. A change that an existing KJN/1 reader would read
differently needs a new version (`KJN/2`); `tests/kjn.test.ts` holds a frozen
KJN/1 sample that must keep parsing to the same text.

### The `games` collection

At `GAME_OVER` the host queues one document `games/{random id}` (except for the
matches under "Not stored" below):
`format`, `app`, `seats`, `winner`, `hands` (count) and `kjn` (the full text, about
6 KB; at most 100 000 characters). The in-progress record lives next to the engine
state in the host's `localStorage` (`koejon-kjn-<code>`), so a host reload loses
no hands. A finished record moves to an upload queue (`koejon-games-pending`, at
most 20, shared by all rooms), so a new match never replaces one that did not
upload yet. The queue uploads on every host commit, when the browser comes back
online, and when a host starts. Each record keeps its doc id across retries: a
retry of a write that already landed is denied (write-once) and dropped, so a
match is never stored twice. A denied write is dropped too; other failures stay
in the queue.

Solo play stays offline; only the finished match is uploaded, signing in first
when the match started offline. If the queue is lost while offline (storage
cleared), the record is lost, which is acceptable.

Not stored: unfinished matches, matches the host began on an older build,
bot-only matches from tests or `npm run bench`, and matches that no human played
to the end. At `GAME_OVER` at least one seat must still be `human`; a seat that
changed hands is `mixed` and does not count. Without such a seat the host makes
no record at all: no upload and no `room.kjn`, so also no local history entry and
no download.

The rules check only what every build must keep: signed in, create only (the app
cannot read, change or delete games), at most 12 fields, a `format` of the form
`KJN/<n>` and a `kjn` string of at most 100 000 characters. Newer builds can add
fields or a new format version without a rules change. The exact document shape
is checked in `tests/kjn.test.ts`.

### Local history

The `games` collection is write-only and holds no player identifiers, so a
player's own matches live on their device (`src/lib/history.ts`). In `GAME_OVER`
the host puts the canonical KJN/1 text on the room (`room.kjn`): over the data
channel, and on the `GAME_OVER` room write for Firestore guests, so no extra
write. Before `GAME_OVER` it is always null, since the record holds every dealt
card; a new match clears it. Each seated human client, solo included, adds the
match once to `localStorage` (`koejon-history`, at most 20, oldest dropped
first) with the finish time, own seat and the seat names. Names stay on the
device and never go into the KJN text. The same text is never added twice, so a
reload on the end screen does not duplicate it. A record that `parseKjn` rejects
is not kept. The history is never uploaded.

### Export for analysis

The app cannot read `games`; use admin access. With `gcloud` logged in to the
project (a managed export needs the Blaze plan and a Cloud Storage bucket):

```bash
gcloud firestore export gs://<bucket>/games-export --collection-ids=games
```

or, from a script with the Admin SDK (`npm i firebase-admin` in a scratch folder,
credentials from `gcloud auth application-default login`):

```js
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { writeFileSync } from 'node:fs'
initializeApp({ projectId: '<project-id>' })
const snap = await getFirestore().collection('games').get()
writeFileSync('games.kjn', snap.docs.map((d) => d.get('kjn')).join('\n'))
```

Records in the file are separated by an empty line before each `[Format` tag.

**`games` is untrusted input.** Any signed-in client (every visitor has an
anonymous uid) can create documents, so a record can be fabricated. Keep only
records that `parseKjn` accepts and that `replayKjn` confirms: it plays the record
through the engine from the dealt cards and throws when a move is illegal or a
hand result or the match result differs. Filter by `format` first. If abuse shows
up, Firebase App Check on this collection is the next step.

### Privacy decision

No in-app notice is shown for this collection. A `games` document holds no
names, Firebase UIDs, room codes, device data or timestamps (Firestore only
keeps its own create time), and the seats are only `human` or a bot level. The
card play of an anonymous seat cannot be linked to a person with the data we
keep, so we treat it as anonymous gameplay data. Every field is needed for
gameplay analysis. If a field that can identify a player or device is ever
added, add an in-app notice before that ships.

## Rules

The in-app "Regels/Rules" button renders `rules/rules-nl.md` / `rules/rules-en.md`.
Interpretation decisions that were not fully specified are listed in
`RULE_ASSUMPTIONS.md`.
