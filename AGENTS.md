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
| `npm test` | Unit tests + 60-match bot simulation (vitest). Must pass. |
| `npm run build` | `svelte-check` (type check) + production build. Must pass. |
| `npm run dev` | Dev server. Needs `firebase emulators:start` in another shell for multiplayer. Solo play needs no emulator. |
| `npm run e2e` | Full match against the Firestore emulator. Optional. |
| `npm run bench -- [--base origin/develop] [--matches 500] [--level normal]` | Bot benchmark (`scripts/bot-benchmark.mjs`): this checkout's bot against the bot of a git ref. Prints win rate and bidding stats. Run it for every bot change: the win rate plus its ± margin must reach 50%. |

Before you say a change is done, run `npm test` and `npm run build`. Both must pass.

## Code map

| Path | Contents | Rules |
|---|---|---|
| `src/engine/` | Pure game engine: cards, seeded RNG, dealer draw, deal, bidding, legal plays, tricks, scoring. Entry: `createMatch`, `legalActions`, `apply`, `toPublic`. | No Firebase, DOM or Svelte imports. Deterministic: use the seeded RNG in `rng.ts`, never `Math.random`. All game rules live here. |
| `src/bots/bot.ts` | Bot heuristics. Levels `easy`, `normal`, `hard` (`BOT_PROFILES`). Entry: `botAction`. | A bot only picks from `legalActions`. Never read other players' hands. |
| `src/lib/host.ts` | `HostGame`: the authoritative loop on the host. Applies intents, runs bots, publishes state. | |
| `src/lib/room.ts` | `RoomSession`: client side of a room (view, send intents). `createRoom`, `joinRoom`. | |
| `src/lib/transport.ts` | `HostLink` / `GuestLink` interfaces. | |
| `src/lib/link-local.ts` | Solo mode: host and guest in one tab, state in `localStorage`. No network. | |
| `src/lib/link-p2p.ts` | Multiplayer over WebRTC. Firestore only for lobby and signaling. | |
| `src/lib/link-firestore.ts` | Multiplayer fallback over Firestore when WebRTC fails. | Keep Firestore reads and writes low (cost). |
| `src/lib/fs.ts`, `firebase.ts` | Firestore wrapper (counts reads and writes), Firebase init, emulator auto-connect. | |
| `src/lib/quotes.ts` | Table talk ("quotes"). `activeQuotes(pub)` derives quotes from public state. | Quotes stay in Flemish dialect. Pick speaker and line with the deterministic `hash`, so all clients agree. |
| `src/lib/i18n.ts` | All UI text, Dutch (`nl`, default) and English (`en`). | Every new UI string goes in both languages. |
| `src/lib/prefs.ts`, `theme.ts` | Per-player preferences in `localStorage`. | Wrap `localStorage` in try/catch. |
| `src/components/` | Svelte UI. `Table.svelte` is the game table. `App.svelte` is startup and routing. | Must work at phone width. |
| `src/app.css` | All styles and colour tokens. | |
| `public/` | Web app manifest and app icons (`icon.svg` is the source of the PNGs). | Copied to `dist/` as is. |
| `pwa/` | Service worker template (`sw.js`) and `precache.ts`. A plugin in `vite.config.ts` emits `dist/sw.js` with the list of built files. | The worker never caches other origins (Firebase). Registered in production builds only. |
| `tests/` | Vitest tests. `helpers.ts` has state builders: `playingState`, `lastTrickState`, `biddingState`, `dealtState`, card helper `C`. | Reuse the helpers. |
| `rules/` | Game rules (NL, EN). Shown in the app. | |
| `RULE_ASSUMPTIONS.md` | Rule choices that the rules text did not specify. | Add an entry when you decide a new rule detail. |
| `firestore.rules` | Firestore security rules. Deployed by CI on push to `main`. | |
| `backlog/` | Task backlog (Backlog.md). See below. | |
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
- Push to `develop` deploys the dev channel. Push to `main` deploys live. Never push to `main` or `develop` directly.
- Branch name: `feature/task-<N>-<short-slug>` or `fix/task-<N>-<short-slug>` for bugs.
- Commit messages: short, imperative, for example `Fix trick rollback on late message`.
- Never commit `.env.local` or other secrets. `.env.production` is committed on purpose (public web config).

## Backlog and GitHub issues

- Each task is a file in `backlog/tasks/task-<N> - <Title>.md`. It has a description and acceptance criteria.
- Each task has one GitHub issue in `Winandvdb/koejon`. The first line of the issue body is `Backlog: task-<N>`.
- The issue number can differ from the task number. Find the issue by that first line.
- An assigned issue is taken. Do not work on an issue that is assigned to someone else.
- Edit task files with the `backlog` CLI (`backlog task edit <N> ...`) or the backlog MCP tools. Do not change the `<!-- SECTION -->` / `<!-- AC -->` markers by hand.
- To start work on a task, use the `start-task` skill (`.agents/skills/start-task/SKILL.md`). It claims the issue and makes a worktree in `.worktrees/task-<N>` (ignored by git).
- A PR with the label `needs manual check` is complete, but a person must still check the UI or network behaviour. A draft PR means that something failed.

## Keep this file current

If your change adds, moves or removes a module, a command or a rule above, update this file in the same PR.
