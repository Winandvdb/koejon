# AGENTS.md

Instructions for AI coding agents in this repo. Read this file first.
Human docs: `README.md` (setup, deploy, data flow). Game rules: `rules/rules-en.md`.

## What this is

Koejonnen: an online 4-player Belgian card game. Svelte 5 + TypeScript + Vite.
Firebase Anonymous Auth + Firestore. No other backend.
The browser that creates a room is the **host**. The host runs the game engine and all bots.
Other browsers only send intents (play this card, bid, pass).

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (Node 20+). |
| `npm test` | Unit tests + 60-match bot simulation per bot level (vitest). Must pass. |
| `npm run build` | `svelte-check` (type check of `src/`, and of `tests/` + `scripts/` via `tsconfig.test.json`) + production build. Must pass. |
| `npm run dev` | Dev server. Needs `firebase emulators:start` in another shell for multiplayer. Solo play needs no emulator. |
| `npm run e2e` | Full match against the Firestore emulator. Optional. |
| `npm run bench -- [--base origin/develop] [--matches 500] [--level normal]` | Bot benchmark (`scripts/bot-benchmark.mjs`): this checkout's bot against the bot of a git ref. Prints win rate and bidding stats. Run it for every bot change: the win rate plus its ± margin must reach 50%. |

Before you say a change is done, run `npm test` and `npm run build`. Both must pass.

## Code map

| Path | Contents | Rules |
|---|---|---|
| `src/engine/` | Pure game engine: cards, seeded RNG, dealer draw, cut, deal, bidding, legal plays, tricks, scoring. Entry: `createMatch`, `legalActions`, `apply`, `toPublic`. | No Firebase, DOM or Svelte imports. Deterministic: use the seeded RNG in `rng.ts`, never `Math.random`. All game rules live here. |
| `src/bots/bot.ts` | Bots as data: a `BotConfig` is `{ name, rules: [{ when?: { phase }, use: spec }] }`; the first rule whose phase matches and whose algorithm `supports` the decision decides, no match throws. A plain algorithm spec is a pure bot. `createBot` also handles the steps without a real choice (lifts, first dealer, single legal action). `botAction(s, seat, rand, level)` = the bot `heuristic:<level>`, used by the host. | A bot only picks from `legalActions`. |
| `src/bots/algorithm.ts` | `Algorithm` (`id`, `supports(obs)`, `decide(obs, rand, trace?)`), the registry (`createAlgorithm(spec)`, spec = `'name:variant'` or `{ id, ...options }`), `BotTrace`. | An algorithm builds the algorithms its options name through the registry, never by import. |
| `src/bots/observation.ts` | `observe(state, seat)`: public state, own hand, legal actions. `decisionPhase`: which decisions count as `bidding` (bids, troefke, the dealer's choice) or `play`. | Algorithms get only an observation, never the engine `State`: they cannot read other hands, the deck or the RNG. |
| `src/bots/value.ts` | `handValue(before, after, team)`: value of a hand as lines crossed minus lines the other team crossed. `breakEven(stake)`: win chance a bid needs. | All search algorithms score hands with it. |
| `src/bots/heuristic.ts` | The hand-written bot as algorithm `heuristic:easy\|normal\|hard` (`BOT_PROFILES`). Tuning constants in `HEURISTIC_DEFAULTS`; spec options override them. Writes the rule that decided into the trace. | |
| `src/lib/host.ts` | `HostGame`: the authoritative loop on the host. Applies intents, runs bots, publishes state. | |
| `src/lib/room.ts` | `RoomSession`: client side of a room (view, send intents). `createRoom`, `joinRoom`. | |
| `src/lib/transport.ts` | `HostLink` / `GuestLink` interfaces. | |
| `src/lib/link-local.ts` | Solo mode: host and guest in one tab, state in `localStorage`. No network. | |
| `src/lib/link-p2p.ts` | Multiplayer over WebRTC. Firestore only for lobby and signaling. | |
| `src/lib/link-firestore.ts` | Multiplayer fallback over Firestore when WebRTC fails. | Keep Firestore reads and writes low (cost). |
| `src/lib/firebase.ts` | Firebase init, emulator auto-connect. | |
| `src/lib/kjn.ts` | KJN/1 game records: `recordAction` (host builds the record), `serializeKjn`, `parseKjn`, `gameDoc`, `replayKjn` (engine check for analysis), `replaySteps` (engine state after each recorded action, for the replay viewer), `loadKjn` / `readKjnFile` (a finished match from untrusted text or a file, size-checked and replayed). The host queues one `games/{id}` doc per finished match that a human played to the end (multiplayer and solo) and uploads it. Format spec in `README.md`. | KJN/1 is frozen: an incompatible change needs a new format version. No names, UIDs or room codes in a record. A record error must never stop a match. Only a match that a human played to the end gets a record (`finishRecord` in `host.ts`: a seat still `human` at `GAME_OVER`, `mixed` does not count); else no upload, no `room.kjn`, no history entry and no download. |
| `src/lib/history.ts` | Local match history: the last `HISTORY_MAX` (20) finished matches in `localStorage` (`koejon-history`), with own seat, seat names and the `KJN/1` text. The host puts the text on `room.kjn` in `GAME_OVER` only; `RoomSession` saves it once per match for a seated human. `removeHistory` deletes one entry. | Device only: never uploaded, no Firestore reads. Seat names stay out of the `KJN/1` text. |
| `src/lib/stats.ts` | Personal statistics on this device: `matchStats` (one seat's numbers from a finished `KJN/1` record), `totalStats` (the history plus `koejon-stats`, the totals of matches that dropped out of it; `addHistory` adds those via `keepDropped`), per group (`matchGroup`: `players` when another seat had a human, else `bots`). Shown in the played matches panel of `Home.svelte`. | No engine state and no network: the numbers come from the history only. |
| `src/lib/download.ts` | `.kjn` file of a finished match (`kjnFile`: `room.kjn` unchanged, `koejon-<YYYY-MM-DD>-<HHmm>.kjn`) and `downloadKjn`: share sheet where files can be shared, else a `Blob` download. Used by the overflow menu of the replay screen (`Replay.svelte`), which also opens a `.kjn` file. | No network. |
| `src/lib/deckstack.ts` | `deckStack(pub)`: how the next deck forms at the cut (trick piles, or the hands after an all-passed deal), bottom packet first, from `CUTTING` until the deal. `dealPairs(dealer)`: the deal per two (deck positions and seat); `pairOfCard`: the pair that brings each hand card; `DEAL_MS`: the deal animation, which the host waits for before the first bid (`HostOptions.dealLingerMs`). `Table.svelte` animates both: the deck goes to the dealer, the hand cards fly in per two (a blind dealer gets backs). | Must move the cards as the engine does (`cutDeck`, `allPassed`, `doDeal`): `tests/deckstack.test.ts` plays the moves on the engine's cards. Public state only. |
| `src/lib/quotes.ts` | Table talk ("quotes"). `activeQuotes(pub)` derives candidates; the host's `QuoteBook` decides which fire. | Quotes stay in Flemish dialect. Fired quotes ride on `room.quotes`, so all clients show the same line. |
| `src/lib/i18n.ts` | All UI text, Dutch (`nl`, default) and English (`en`). | Every new UI string goes in both languages. |
| `src/lib/prefs.ts`, `theme.ts` | Per-player preferences in `localStorage`. | Wrap `localStorage` in try/catch. |
| `src/lib/storage.ts` | `safeStorage`: `localStorage` that never throws (blocked storage reads as empty). | Use it for app storage; never touch `localStorage` directly outside a try/catch. |
| `src/lib/devsettings.ts` | Dev build test shortcuts (`DevSettings`): tree length, bot speed, skip "Gezien", interactive card draws, autoplay. Per browser in `localStorage` (`koejon-dev`). `App.svelte` gives them to the host (`HostOptions.dev`) and shows `DevPanel.svelte` in the settings popover, in dev builds only. | Production builds use `DEV_DEFAULTS`. The host uploads no KJN record for a match with another tree length or with autoplay. |
| `src/lib/seed.ts` | `?seed=N`: a solo game that repeats exactly (deal, bot names, bot plays), for scripted demos. The host's `rand` option carries it. | Solo only. Only in the Vite dev server or a build with `VITE_ALLOW_SEED=1`; never set that flag in a deploy workflow (whoever knows the seed knows every hand). |
| `src/components/` | Svelte UI. `Table.svelte` is the game table. `App.svelte` is startup and routing. `Home.svelte` also lists the played matches and opens `.kjn` files. `Replay.svelte` is the read-only replay viewer (all hands open, step / hand / auto-play controls). | Must work at phone width. Replay sends no intents and uses no network. |
| `src/app.css` | All styles and colour tokens. | |
| `public/` | Web app manifest, app icons (`icon.svg` is the source of the PNGs) and `robots.txt`. | Copied to `dist/` as is. |
| `pwa/` | Service worker template (`sw.js`) and `precache.ts`. A plugin in `vite.config.ts` emits `dist/sw.js` with the list of built files. `devbrand.ts` + `dev/` hold the dev build name and icons; a plugin emits them only when `VITE_APP_VARIANT=dev` (the dev channel and previews of PRs into develop). | The worker never caches other origins (Firebase). Registered in production builds only. |
| `tests/` | Vitest tests. `helpers.ts` has state builders: `playingState`, `lastTrickState`, `biddingState`, `dealtState`, card helper `C`, and `mulberry`, `memoryStore`, `blockStorage`, `until`. | Reuse the helpers. |
| `rules/` | Game rules (NL, EN). Shown in the app. | |
| `RULE_ASSUMPTIONS.md` | Rule choices that the rules text did not specify. | Add an entry when you decide a new rule detail. |
| `firestore.rules` | Firestore security rules. Deployed by CI on push to `main`. | Prod, dev and PR previews share one database, and CI deploys the rules only from `main`. A rules change must accept every write of every build that is still in use. Keep the rules to auth, ownership, write-once and size limits. Check the exact data shape in tests, not in the rules. To make a rule stricter, first release a build that already writes the new shape, then tighten the rule in a later release. |
| `docs/spikes/` | Spike write-ups (issues with label `question`), one file per issue: `<issue>-<slug>.md`. | The result of a spike is a write-up here, not code. |
| `IMPLEMENTATION_PROMPT.md` | The original build spec. Historical. | Where it differs from the code or README, the code and README are correct. |

## Game words (Dutch → meaning)

- **troef**: trump. **kopen**: play a trump on a non-trump lead. **onderkopen**: trump lower than a trump already in the trick (not allowed when you can follow suit).
- **slag**: trick. **ik ga / pas**: bid / pass. **troefke**: the bidder asks the partner to lead trump.
- **boomke**: the score tree. **meetje / lijn vegen**: cross off a score line. **koei**: penalty line. **kapot**: one team takes all 6 tricks.
- **maat**: partner (opposite seat). Teams: seats {0,2} and {1,3}.

## Code style

- Match the code around your change. Short comments that explain *why*, not *what*.
- TypeScript strict. No new dependencies unless the task needs one. Pin exact versions.
- Make the smallest change that meets the task. Do not refactor unrelated code.
- For a bug: first write a test that fails, then fix it.

## Git and GitHub

- Branches start from `develop`. PRs go into `develop`.
- `develop` and `main` are protected: GitHub rejects direct pushes. A change gets into them only through a merged PR, also a small docs change.
- Push to `develop` deploys the dev channel. Push to `main` deploys live. Never push to `main` or `develop` directly.
- Branch name: `feature/<issue>-<short-slug>` or `fix/<issue>-<short-slug>` for bugs. `<issue>` is the GitHub issue number.
- PR body: follow `.github/pull_request_template.md` (Summary, Plan, Acceptance criteria, Tests, Check by hand).
- Commit messages: short, imperative, for example `Fix trick rollback on late message`.
- Never commit `.env.local` or other secrets. `.env.production` is committed on purpose (public web config).

## GitHub issues

- All work is tracked as GitHub issues in `Winandvdb/koejon`. There is no backlog in the repo.
- An issue has a description, `Depends on #<D>` / `Related to #<R>` lines when needed, and an `### Acceptance criteria` checklist. It has one type label (`bug`, `enhancement`, `question`) and one `priority:` label.
- To create an issue, use the `create-issue` skill (`.agents/skills/create-issue/SKILL.md`).
- Before you edit an issue (title, body, labels), fetch it again with `gh issue view <n> --json title,body,labels,updatedAt`. Make your change on that fresh copy, never on a copy from earlier in the session. Other people or agents can change the issue at any time, and `gh issue edit --body` replaces the full body.
- An assigned issue is taken. Do not work on an issue that is assigned to someone else.
- To start work on an issue, use the `start-issue` skill (`.agents/skills/start-issue/SKILL.md`). It claims the issue and makes a worktree in `.worktrees/<issue>` (ignored by git). The plan and the acceptance criteria status go in the PR body.
- `develop` is the default branch, so `Closes #<issue>` closes the issue when the PR merges.
- To release `develop` to `main`, use the `release-pr` skill (`.agents/skills/release-pr/SKILL.md`). It cuts a `release/<YYYY-MM-DD>` branch from `develop` and opens the PR from it into `main`, with a description of all changes and the checks. It never merges: the merge deploys live.
- Older issues start with `Backlog: task-<T>` and can name other work as `task-<T>`. Find that issue with `gh issue list --state all --search '"Backlog: task-<T>" in:body'`.
- To review a PR, use the `pr-review` skill (`.agents/skills/pr-review/SKILL.md`). It reviews with three hats (General, Security, Performance) and posts one review with inline comments. A high-severity security issue or breaking bug requests changes, or turns your own PR into a draft.
- A PR with the label `needs manual check` is complete, but a person must still check the UI or network behaviour. A draft PR means that something failed.

## Keep this file current

If your change adds, moves or removes a module, a command or a rule above, update this file in the same PR.
