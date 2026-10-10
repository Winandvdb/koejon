# Spike: the human-review plugin for koejon PRs

Issue: #76 (2026-10-08). Question: can the [victorrentea/human-review](https://github.com/victorrentea/human-review)
Claude Code plugin help a person review koejon PRs? We looked at three tabs: **Demo** (a narrated
video of the feature), **Tests** (which tests run which changed lines) and **UX** (before/after
screens).

Short answer: **adopt in part.** The Tests tab works on koejon with a small vitest adapter
(prototyped, it gives exact per-test results). The Demo video works with three small patches to
the plugin and a dev `?seed=` parameter in koejon. Drop the UX audit for now: it sees only screens
that have a URL, and koejon has one.

All results below come from one trial run on PR #64 (*Hide the turned cards from the dealer's
hand*, issue #53). The plugin was at upstream commit `b0cd4a1`. Nothing was merged into koejon.

## 1. Setup that worked

- **Plugin code.** Fork `victorrentea/human-review` (done: [Winandvdb/human-review](https://github.com/Winandvdb/human-review)).
  The koejon patches are on branch
  [`koejon-spike`](https://github.com/Winandvdb/human-review/tree/koejon-spike) (commit `d4bcd22`,
  4 files, +235/−8 lines, see section 5). For the trial the scripts ran straight from a clone. The
  plugin install (`/plugin marketplace add Winandvdb/human-review`,
  `/plugin install human-review@human-review`) was not tried: it is a slash command for a person.
- **Python.** Use a venv with Python 3.10 or newer (Homebrew 3.14 worked; the macOS 3.9 is too
  old): `python3 -m venv .venv && .venv/bin/pip install pygments pillow numpy playwright pyyaml`.
  Put the venv first on `PATH`: the scripts call `python3`.
- **Node Playwright and Chromium.** The video recorder needs the Node `playwright` package. koejon
  has none, so the trial installed `playwright@1.56.0` in a separate folder and pointed
  `HUMAN_REVIEW_NODE_PATH` at it. Chromium went to a folder named by `PLAYWRIGHT_BROWSERS_PATH`.
  The UX audit uses the Python `playwright`, which downloads its own Chromium.
- **Other tools.** `ffmpeg` (already installed) and the macOS `say` voice. `plantuml` and Java
  are not needed for these three tabs.
- **koejon side** (only in a local clone, not committed):
  - `@vitest/coverage-istanbul@4.1.11` (`npm i --no-save`).
  - `scripts/review-app.sh` (45 lines): `up <sha>` builds that commit with `vite build` (another
    commit goes in a detached worktree) and runs `vite preview` on a free port; `url` and `down`.
  - `?seed=` in `src/main.ts` (12 lines), see section 3.
  - `human-review.json` at the repo root:

```json
{
  "base": "origin/develop",
  "ci": {"workflows": ["ci.yml"]},
  "steps": {
    "video": {
      "out": ".human-review/assets/feature.webm",
      "app": {
        "up": "bash scripts/review-app.sh up {sha}",
        "url": "bash scripts/review-app.sh url {shortsha}",
        "down": "bash scripts/review-app.sh down {shortsha}",
        "reset": "true",
        "env": {
          "BASE_URL": "{url}", "API_URL": "{url}",
          "HUMAN_REVIEW_API_PROBE": "",
          "HUMAN_REVIEW_VIDEO_VIEWPORT": "390x844",
          "NARRATION_FISH": "off",
          "HUMAN_REVIEW_NODE_PATH": "<folder with node_modules/playwright>",
          "PLAYWRIGHT_BROWSERS_PATH": "<chromium folder>"
        }
      }
    },
    "testcov": {
      "sources": ["src/**"],
      "exclude": ["**/*.test.ts"],
      "vitest": [{"label": "Vitest", "cwd": ".",
                  "command": "npx vitest run --exclude tests/simulation.test.ts --exclude tests/e2e.emulator.test.ts {vitest}"}]
    }
  }
}
```

  `reset: "true"` is a no-op on purpose: solo state lives in the browser's `localStorage`, and
  every film opens a new browser context. Without it the plugin stops and starts the server again.
  `NARRATION_FISH: "off"` keeps the narration local. With a Fish Audio key in the environment,
  the recorder sends every spoken line to that paid cloud service.

**Run.** Each step ran on its own (`run-steps.py --base <base> --only <step> --no-ledger`). The
CI gate (`preflight.py`) was not used, because it pushes the branch and waits for CI.

| Step | Time |
|---|---|
| `testcov` (155 vitest tests, per-test coverage) | 6.5 s |
| `tests` (test change manifest) | 4.0 s |
| `video` (build, film, narrate, cut) | 53 s (the film is 38 s, 860 KB) |
| `dsaudit` (two builds, 2 screens) | 19 s |
| page build (`refresh-report.py --no-serve`) | about 10 s |

A full run of these steps takes about 1.5 minutes. The work around it is larger: the model must
write the film script and `content.json`, and answer the test pairing (see section 4).

## 2. Tests tab with vitest: works

The plugin measured per-test coverage for JUnit and Karma only. The adapter on the fork branch
copies the Karma model:

- `testcov/vitest/setup.js` runs in each vitest worker. It snapshots the Istanbul counters
  (`globalThis.__VITEST_COVERAGE__`) around each test and writes the moved statement and function
  ids per test.
- `testcov/vitest/join.js` maps those ids to TypeScript lines with the provider's source map
  (`@jridgewell/trace-mapping`, already a vitest dependency).
- `testcov.py` gets `vitest_suites()`. Vitest 4 has no `--setupFiles` CLI option, so it writes a
  small wrapper config into `.human-review/coverage/` that loads `vite.config.ts` and adds the setup
  file.

Result on PR #64: 155 tests in 6.5 s. Each test lands at its own `it(` line. The changed lines in
`src/engine/view.ts` are matched exactly: line 105 (`return hand.slice(0, -2)`) is run only by the
two "leaves out" tests (`tests/turned.test.ts:30`, `:40`). Line 106 (`return hand`) is run only by the
"shows again" and "other seats" tests (`:51`, `:57`). On the page the Tests tab shows issue #53
sentence by sentence, coloured by coverage, next to the 4 tests. It showed one real gap: "the engine
and the legal actions stay the same" has no test.

Limits:

- Svelte components have no unit tests and are not measured. `Table.svelte` lines are listed as
  "no probe for this kind of file". A Playwright suite with V8 coverage (the plugin's `e2e` path)
  would close this, but koejon has no browser tests.
- Exclude `tests/simulation.test.ts`. Its 60 matches per bot level run almost all of the engine,
  so it would "cover" every changed engine line.
- The plugin's Code City step runs after `testcov` by itself and fails (Java only, its message
  names a petclinic path). Skip it with `--skip city`.
- The test pairing (`test-mapping.json`) is a model step. Its default runs `claude -p --model
  sonnet` (a paid call). In the trial the session answered the prompt itself through
  `rerun-model.py --prompt-only` / `--answer`.

## 3. Demo video: works after three patches

The film of PR #64 was made on the third try. It is 38 s at phone size (390×844), with 4 spoken
lines in the local macOS voice and a clickable transcript. It shows the dealer's hand with 4 cards
while the turned cards lie on the table, and 6 cards after the first card falls.

Patches the fork needed (`record-feature-video.sh`):

1. The recorder stopped when `$API_URL/api/pettypes` did not answer (the petclinic backend). Now
   `HUMAN_REVIEW_API_PROBE=""` skips this check for an app with no backend.
2. `NODE_PATH` was fixed to `petclinic-test/node_modules`. Now `HUMAN_REVIEW_NODE_PATH` sets it.
3. The viewport was fixed at 1280×800. Now `HUMAN_REVIEW_VIDEO_VIEWPORT` sets it (koejon: 390×844).
4. koejon's `package.json` has `"type": "module"`, so the feature script is an ES module. The
   recorder now also accepts `export default`.

**`?seed=` is necessary.** A seed for `createMatch` alone is not enough. Bots
(`host.ts:468`), bot names (`host.ts:204`), the seat shuffle (`host.ts:236`) and bot delays also
call `Math.random`. The prototype replaces `Math.random` with a seeded generator (mulberry32) in
`src/main.ts` when `?seed=N` is in the URL, before the app mounts. It is 12 lines, and three runs
gave the same deal. Seeds 1, 2, 4, 5, 7 and 9 make the human player the dealer.

**`?scene=` is not worth building now.** With a seed, the film script can click through the deal
to the state it needs. For PR #64 that took 35 lines of script. A `?scene=<name>` that jumps
directly to a state needs the state builders from `tests/helpers.ts` in `src/` (about 100–150
lines). Build it only if many films need states late in a match (koei, kapot, game over).

Costs and risks seen in the trial:

- **The film script is the hard part.** The first two films failed for the same reason: the
  script did not know the game flow. The turned cards already show during bidding ("Dealer
  chooses"), and the sort question comes after the dealer chooses. The plugin reported both
  failures correctly (`FAILED to reach`, a red band on the page), but each try is a full run. A
  per-PR model run will meet the same problem. A short "solo flow" note for the film prompt (which
  buttons come in which order) would help.
- The burnt-in caption covers the top player's name plate at phone width.
- The Demo tab calls the app row "Start App in Docker" (petclinic wording).
- In the first version of `review-app.sh`, `up` never returned: the background server kept the
  caller's stdout open. The fixed version redirects the whole background group.

## 4. UX audit: drop for now

The step runs. It built the merge-base in a second worktree, shot both builds and stopped the base
server itself (19 s). But it gives almost nothing for koejon:

- Its findings are native controls that are not inside a design-system component marked
  `data-ds="…"`. koejon has no such components, so the result was "0 gaps, 0 components".
- It opens each screen by URL. Screen discovery reads Angular routes only. koejon has one URL, so
  only Home can be audited. The table, the boomke and the result panels need `?scene=`.
- Small bug: an empty path (`"Home": ""`) became `/Home`.

Adopt it only after `?scene=` exists, and then only for its before/after screenshots and DOM diff.

## 5. Other findings

- **The Review tab needs `review-points.md`.** Without it the tab says that nothing records the
  review. The plugin's `/record-review` skill writes that file in the coding session. Our
  `start-issue` skill could call it before the PR opens.
- **The page builder needs `content.json`** (layout and short texts, written by the model) and
  refuses to build without it. With `pr.base: "develop"` the header measured from the wrong commit
  in the trial. Use the real merge-base.
- **Cost.** All producers are free. Paid model work is the film script, the test pairing (one
  Sonnet call) and `content.json`. A run inside a Claude session does these in the session.
- **Plugin tests.** Of the plugin's tests for the changed scripts, 109 pass and 2 fail. Both also
  fail on upstream `b0cd4a1`, so the patches do not cause them. The vitest adapter has no test in
  the plugin yet.
- **Upstream.** The patches are general, not koejon-only: a frontend-only app, a phone viewport,
  ESM projects, vitest. They could go to victorrentea as a PR. That is not done; ask the repo
  owner first.

## 6. Recommendation

1. Use the fork with the `koejon-spike` patches.
2. Add `?seed=` to koejon, and the review setup (`human-review.json`, `scripts/review-app.sh`,
   `@vitest/coverage-istanbul`, `.human-review/` in `.gitignore`).
3. Use the Tests tab and the Demo video on PRs that change the table or the engine.
4. Skip the UX audit and Code City.

## Follow-up issues

- #77: Add a `?seed=` URL parameter for repeatable solo games.
- #78: Set up the human-review plugin for koejon PRs (Tests tab and Demo video). Depends on #77.
