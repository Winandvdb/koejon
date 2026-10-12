# AGENTS.md

Instructions for AI coding agents in this repo. Read this file first.
Human docs: `README.md` (setup, deploy, data flow, KJN format). Game rules: `rules/rules-en.md`.
Details of a module live in its doc comments; this file holds what to know before you open it, and the rules.

## What this is

Koejonnen: an online 4-player Belgian card game. Svelte 5 + TypeScript + Vite.
Firebase Anonymous Auth + Firestore. No other backend.
The browser that creates a room is the **host**. The host runs the game engine and all bots.
Other browsers only send intents (play this card, bid, pass).

## Commands

Before you say a change is done, run `npm test` and `npm run build`. Both must pass.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (Node 20+). |
| `npm test` | Unit tests, a 60-match simulation per `heuristic:<level>` and 3 matches of the `hard` level bot (vitest). |
| `npm run build` | `svelte-check` of `src/`, and of `tests/` + `scripts/` (`tsconfig.test.json`), then the production build. |
| `npm run dev` | Dev server. Multiplayer needs `firebase emulators:start` in another shell; solo does not. |
| `npm run e2e` | Optional: a full match against the Firestore emulator. |
| `npm run bench` | Two bots against each other (`scripts/bot-benchmark.mjs`; flags and side syntax in its header). `--level hard` plays the pimc bot and is slow: to bench the heuristic alone, use `--a heuristic:hard`. **Run it for every bot change: the win rate plus its ± margin must reach 50%.** |
| `npm run tune` | SPSA tuning of the `heuristic:hard` constants (`scripts/tune-heuristic.mjs`; flags in its header). Check the result on new seeds with `npm run bench -- --a tune-heuristic.json --b heuristic:hard`, and change `HEURISTIC_DEFAULTS` only when that passes the bench rule. `--play pimc` tunes the bids of the `hard` level bot: put those values on the heuristic rule of `LEVEL_CONFIGS.hard`, not in `LEVEL_OPTIONS.hard`, which would also move `heuristic:hard` and the plain tuner (`tests/tune-spsa.test.ts` checks that `tuneBot` follows the level bot). A new constant in `HEURISTIC_DEFAULTS` needs a range in `PARAMS` (`scripts/tune-spsa.mjs`). |
| `node scripts/bot-probe.mjs` | How predictable a bot's cards are: how often they differ from a reference bot (default `heuristic:hard`) and from its own card with other random worlds (flags in its header). Run it for a change to the `hard` level's anchor or margin. |
| `npm run bot:trace` | Plays the seeded match that `bench` plays for `--seed` and prints every decision with the rule, algorithm and trace that chose it (`scripts/bot-trace.mjs`; flags in its header and the README). Use it to see why a bot chose an action, before you tune it. |

## Code map

A **Rule** is a constraint that a change must keep.

### `src/engine/` — pure game engine

Cards, seeded RNG, dealer draw, cut, deal, bidding, legal plays, tricks, scoring. Entry: `createMatch`, `legalActions`, `apply`, `toPublic`. Shared helpers: `teamOf`, `partnerOf`, `leftOf`, `isBidding`, `dealOrder`, `dealHands`.
**Rule:** no Firebase, DOM or Svelte imports. Deterministic: use the seeded RNG in `rng.ts`, never `Math.random`. All game rules live here.

### `src/bots/`

Algorithms get only an `Observation` (public state, own hand, legal actions), never the engine `State`. A bot only picks from `legalActions`.

- `bot.ts` — a bot is data: `BotConfig = { name, rules: [{ when?: { phase }, use: spec }] }`; the first rule whose phase matches and whose algorithm `supports` the decision decides, and no match throws. `LEVEL_CONFIGS` gives the bot per level; `botAction` (used by the host) plays it. `hard` = `pimc` for cards and troefke + `heuristic:hard` for bids, with `HARD_PIMC` worlds per decision kept low so that a phone host decides within 2 s, and its cards anchored to `heuristic:hard` with `skill: 1` (no lazy dumps) and `HARD_ANCHOR_MARGIN` (more human-like play). **Rule:** tests of heuristic rules use `createBot('heuristic:<level>')`, not `botAction`.
- `algorithm.ts` — `Algorithm`, `BotTrace` and the registry (`createAlgorithm(spec)`). **Rule:** an algorithm builds the algorithms its options name through the registry, never by import.
- `observation.ts` — `observe`, and `decisionPhase` (the one place that says which decisions are `bidding` or `play`).
- `value.ts` — `handValue` (all search algorithms score hands with it) and `breakEven`.
- `determinize.ts` — `sampleWorld`: a full engine `State` that fits an observation. **Rule:** the hand's played cards come from the `log` since its last `deal` event. Hidden fields the rest of the hand does not need get neutral values (`seed`, `rng`, pile order, the draw deck). All randomness via `rand`. A world shares arrays with the live state: change it only through `apply`.
- `solver.ts` — `solve`: double-dummy value of each action when all hands are known. **Rule:** `tests/solver.test.ts` checks it against a plain minimax on the engine, so a change to scoring or play rules in `src/engine/` must show up there.
- `pimc.ts` — algorithm `pimc`. It takes card play and the troefke but no bids or dealer's choice, so a bot with it needs a second rule for those. A rule `when: { phase: 'play' }` leaves the troefke to the next rule. Option `anchor` (an algorithm spec) with `margin`: pimc plays the anchor's card unless its own best card is more than `margin` lines better on the same worlds; cards only, not the troefke.
- `mcts.ts` — algorithms `mcts` (determinized MCTS) and `ismcts` (SO-ISMCTS). They search every decision of the hand on `Hand`, a bitmask copy of the rules, because the engine's `apply` is far too slow for that. **Rule:** `tests/mcts.test.ts` compares `Hand` with the engine, so a rule change in `src/engine/` must show up in `Hand`.
- `conventions.ts` — the troefke convention shared by all algorithms: `troefkeHand` (may ask), `troefkeLead` (obey), `troefkeWeight` (read). When to ask stays per algorithm. **Rule:** a convention, not an engine rule: the partner may ignore it.
- `heuristic.ts` — algorithm `heuristic:easy|normal|hard`. Constants in `HEURISTIC_DEFAULTS` (tuned with `npm run tune`, except the ones marked `fixed` in `PARAMS`); `LEVEL_OPTIONS` overrides them per level. Option `skill` overrides the level's share of smart cards; it is not a tuning constant, so it stays out of `HEURISTIC_DEFAULTS` and `PARAMS`.

### `src/lib/`

- `host.ts` — `HostGame`: the authoritative loop (intents, bots, publish, KJN upload via `HostOptions.saveGame`). **Rule:** imports no transport implementation.
- `room.ts` — `RoomSession` (client side: view, intents), `createRoom`, `joinRoom`, `resumeRoom`. **Rule:** no static imports of `firebase/*`, `firebase.ts`, `link-p2p.ts` or `link-firestore.ts`: they load by dynamic import, so the start bundle has no Firebase code.
- `transport.ts` — `HostLink` / `GuestLink` and `HEARTBEAT_MS`. **Rule:** transport only: no game records, no URLs.
- `link-local.ts` (solo, `localStorage`, no network), `link-p2p.ts` (WebRTC; Firestore for lobby and signaling), `link-firestore.ts` (fallback when WebRTC fails). **Rule:** keep Firestore reads and writes low (cost).
- `net-types.ts` — wire types shared by host, guests and all links. **Rule:** a change must stay readable by builds still in use (shared database).
- `firebase.ts` — Firebase init, emulator auto-connect. **Rule:** reach it only by dynamic import, so a solo player never downloads the SDK.
- `games.ts` — `saveGame`: one finished match as write-once `games/{id}`. `App.svelte` passes it to the host by dynamic import.
- `kjn.ts` — KJN/1 game records: build, serialize, parse, replay, load from a file. Format spec in `README.md`. **Rules:** KJN/1 is frozen: an incompatible change needs a new format version. No names, UIDs or room codes in a record. A record error must never stop a match. Only a match that a human played to the end gets a record (`finishRecord` in `host.ts`: a seat still `human` at `GAME_OVER`; `mixed` does not count); else no upload, no `room.kjn`, no history entry and no download.
- `history.ts` — the last 20 finished matches on this device. **Rule:** device only: never uploaded, no Firestore reads; seat names stay out of the KJN text.
- `stats.ts` — personal statistics from the history. **Rule:** no engine state and no network.
- `download.ts` — the `.kjn` file of a match (share sheet or download). No network.
- `deckstack.ts` — how the next deck forms at the cut, and the deal animation timing (`DEAL_MS`, which the host waits for). **Rule:** must move the cards as the engine does (`cutDeck`, `allPassed`, `doDeal`); `tests/deckstack.test.ts` checks it. Public state only.
- `quotes.ts` — table talk: `activeQuotes` finds candidates, the host's `QuoteBook` decides which fire. **Rule:** quotes stay in Flemish dialect. Fired quotes ride on `room.quotes`, so all clients show the same line.
- `i18n.ts` — all UI text, Dutch (`nl`, default) and English (`en`). **Rule:** every new UI string goes in both languages.
- `table.ts` — what the live table and the replay both show (bids, bubbles, trick shown, fly directions). **Rule:** public state only; both screens call these, never copy them.
- `prefs.ts`, `theme.ts` — per-device preferences as stores that save every change. **Rule:** use `safeStorage`. Components use the stores, never the keys (`koejon-name`, `koejon-bot-level`, `koejon-lang`, `koejon-sort-mode`, `koejon-theme`). Keep the keys: saved values must stay valid.
- `storage.ts` — `safeStorage` (never throws), `KeyValueStore`, `readJson`. **Rule:** use it for app storage; never touch `localStorage` outside a try/catch.
- `devsettings.ts` — dev build test shortcuts (`DevPanel.svelte`). **Rules:** production builds use `DEV_DEFAULTS`. The host uploads no KJN record for a match with another tree length or with autoplay.
- `seed.ts` — `?seed=N`: a solo game that repeats exactly. **Rule:** solo only, and only in the dev server or a build with `VITE_ALLOW_SEED=1`. Never set that flag in a deploy workflow: whoever knows the seed knows every hand.
- `url.ts`, `md.ts` — `appUrl(room?)`; rules markdown to HTML.

### Other paths

- `src/components/` — Svelte UI. `App.svelte`: startup and routing. `Table.svelte`: the game table. `Replay.svelte`: read-only replay. `Nameplate`, `Avatar`, `TurnedCards`, `Opponent`, `TrickArea` and `ResultPanel` are shared by both. **Rules:** must work at phone width. Replay sends no intents and uses no network. A change to a table part goes in the shared component, not in one screen.
- `src/app.css` — all styles and colour tokens.
- `public/` — manifest, icons (`icon.svg` is the source of the PNGs), `robots.txt`. Copied to `dist/` as is.
- `pwa/` — service worker template and precache list; dev build name and icons. **Rule:** the worker never caches other origins (Firebase). Registered in production builds only.
- `tests/` — vitest. `helpers.ts` has state builders (`playingState`, `lastTrickState`, `biddingState`, `dealtState`, card helper `C`), `memoryStore`, `blockStorage`, `until`, and `scanMatches` for seed scans (scans live in `bot-scan.test.ts`). **Rule:** reuse the helpers.
- `rules/` — game rules (NL, EN), shown in the app.
- `RULE_ASSUMPTIONS.md` — rule choices the rules text does not specify. **Rule:** add an entry when you decide a new rule detail.
- `firestore.rules` — deployed by CI from `main` only. **Rules:** prod, dev and PR previews share one database, so a rules change must accept every write of every build still in use. Keep the rules to auth, ownership, write-once and size limits; check the exact data shape in tests. To make a rule stricter, first release a build that writes the new shape, then tighten the rule in a later release.
- `docs/bots/` — bot measurements and the choices made from them (`search-bots.md`: why the `hard` level uses `pimc`; `levels.md`: the targets for the gaps between the levels). **Rule:** read it before you change the algorithm of a level; add new bench results when they change a choice.
- `docs/spikes/` — the result of a spike (issue label `question`) is a write-up here, not code: `<issue>-<slug>.md`.
- `IMPLEMENTATION_PROMPT.md` — the original build spec. Historical: where it differs, the code and README are correct.

## Game words (Dutch → meaning)

- **troef**: trump. **kopen**: play a trump on a non-trump lead. **onderkopen**: trump lower than a trump already in the trick (not allowed when you can follow suit).
- **slag**: trick. **ik ga / pas**: bid / pass. **troefke**: the bidder asks the partner to lead trump.
- **boomke**: the score tree. **meetje / lijn vegen**: cross off a score line. **koei**: penalty line. **kapot**: one team takes all 6 tricks.
- **maat**: partner (opposite seat). Teams: seats {0,2} and {1,3}.

## Code style

- Match the code around your change. Short comments that explain *why*, never *what*: prefer self-explanatory code.
- TypeScript strict. No new dependencies unless the task needs one. Pin exact versions.
- Make the smallest change that meets the task. Do not refactor unrelated code.
- For a bug: first write a test that fails, then fix it.
- Prefer a seed scan to a check by hand: many game situations are very hard to get in a played match (a troefke with the trump ace, a kapot on the 5th trick). For a bot or game rule, add a scan to `tests/bot-scan.test.ts` with `scanMatches`: find the situation in seeded matches and check the rule each time it occurs. Skip the decisions that the trace marks `lazy dump`, and require a minimum number of hits, so that a scan never passes on an empty set. Keep "Check by hand" in the PR for what only a person can judge: the UI, animations, a real network.

## Git and GitHub

- All work is a GitHub issue in `Winandvdb/koejon`; there is no backlog in the repo. An issue has a description, `Depends on #<D>` / `Related to #<R>` lines when needed, an `### Acceptance criteria` checklist, one type label (`bug`, `enhancement`, `question`) and one `priority:` label.
- Skills (`.agents/skills/`): `create-issue` to create an issue, `start-issue` to claim one and work in a worktree (`.worktrees/<issue>`), `pr-review` to review a PR, `release-pr` to open the release PR from `develop` into `main` (it never merges: the merge deploys live).
- Before you edit an issue, fetch it again (`gh issue view <n> --json title,body,labels,updatedAt`) and change that fresh copy: others can change it at any time, and `gh issue edit --body` replaces the full body.
- An assigned issue is taken. Do not work on an issue assigned to someone else.
- Branches start from `develop`: `feature/<issue>-<short-slug>`, or `fix/<issue>-<short-slug>` for bugs. PRs go into `develop`; `Closes #<issue>` closes the issue on merge.
- `develop` and `main` are protected: a change gets in only through a merged PR, also a small docs change. A push to `develop` deploys the dev channel, a push to `main` deploys live.
- PR body: follow `.github/pull_request_template.md` (Summary, Plan, Acceptance criteria, Tests, Check by hand). The plan and the acceptance criteria status go there. A PR with the label `needs manual check` is complete, but a person must still check the UI or network. A draft PR means that something failed.
- Commit messages: short, imperative, for example `Fix trick rollback on late message`.
- Never commit `.env.local` or other secrets. `.env.production` is committed on purpose (public web config).
- Older issues start with `Backlog: task-<T>` and can name other work as `task-<T>`. Find it with `gh issue list --state all --search '"Backlog: task-<T>" in:body'`.

## Keep this file current

If your change adds, moves or removes a module, a command or a rule above, update this file in the same PR.
