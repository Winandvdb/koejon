# Koejonnen

Online 4-player Koejonnen card game. Svelte 5 + TypeScript + Vite front-end, Firebase
Anonymous Authentication + Firestore for rooms (no other backend). The room creator's
browser is the host: it runs the authoritative game engine, executes all bot turns, and
writes every state transition. Other clients only send intents.

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

> Port note: the spec defaults (auth 9099, firestore 8080) were occupied by other
> processes on this machine, so this project uses 9199/8180 (see RULE_ASSUMPTIONS.md).
> Change the ports in `firebase.json`, `.env.example`, `src/lib/firebase.ts` and
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
- `src/lib/` — `firebase.ts` (init + emulator auto-connect), `room.ts` (client session:
  room/hand subscriptions, intents), `host.ts` (`HostGame`: authoritative loop, bot
  scheduling, action-doc processing, heartbeat).
- `src/components/` — Svelte UI: home, lobby, table, boomke scoreboard, log, rules dialog.
- Firestore layout: `rooms/{code}` (public state), `rooms/{code}/hands/{uid}` (private
  hands; `hands/host` holds bot hands), `rooms/{code}/actions/{uid}` (player intents),
  `rooms/{code}/engine/state` (host-only serialized engine state for recovery).

### Firestore data flow

1. A client writes `actions/{uid}` with an intent (join, leave, act).
2. The host's snapshot listener queues it, validates it through the engine (`apply`)
   and writes the new public state + hand docs + engine snapshot in one batch, then
   deletes the intent doc.
3. All clients render from the `rooms/{code}` snapshot plus their own hand doc.

If the host disconnects the room shows a "host left" state (no host migration — known
limitation). Reconnects resume from the Firestore snapshot; a host reload restores the
engine from `rooms/{code}/engine/state`. When the host explicitly leaves, the whole
room tree is deleted instead. A stuck human seat can be replaced by a bot from the
host's kick button (lobby seat list or in-game nameplate).

## Rules

The in-app "Regels/Rules" button renders `rules/rules-nl.md` / `rules/rules-en.md`.
Interpretation decisions that were not fully specified are listed in
`RULE_ASSUMPTIONS.md`.
