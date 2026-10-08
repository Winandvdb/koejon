# Review pages with the human-review plugin

The [human-review](https://github.com/victorrentea/human-review) Claude Code plugin builds one
HTML page per change for the person who reviews it. For koejon two tabs are useful (spike #76,
`docs/spikes/76-human-review.md`):

- **Tests**: the issue's sentences next to the vitest tests that run the changed lines, measured
  per test.
- **Demo**: a narrated film of a seeded solo game at phone size (390×844).

koejon needs patches that are not upstream: the fork
[`Winandvdb/human-review`](https://github.com/Winandvdb/human-review), branch
[`koejon-spike`](https://github.com/Winandvdb/human-review/tree/koejon-spike) (vitest adapter,
an app with no backend, phone viewport, ESM film scripts).

## One-time setup

1. Clone the fork on its patch branch. Link the skill so Claude Code offers `/human-review`, and
   tell its scripts where they are:

   ```bash
   git clone --depth 1 -b koejon-spike https://github.com/Winandvdb/human-review.git ~/tools/human-review
   ln -s ~/tools/human-review/skills/human-review ~/.claude/skills/human-review
   export HUMAN_REVIEW_HOME=~/tools/human-review/skills/human-review   # in your shell profile
   ```

   - Use `--depth 1`. The repo is large (about 150 MB even shallow, because of demo files), and a
     full clone can stall. Run `git -C ~/tools/human-review fetch --unshallow` later if you need
     the history.
   - If your git config rewrites `https://github.com/` to SSH (`url.git@github.com:.insteadOf`),
     the clone uses SSH and can hang on a key or host prompt in a shell without a terminal (for
     example `!` in Claude Code). Write the URL as `https://<your-user>@github.com/Winandvdb/human-review.git`:
     the rewrite rule does not match that form, and the public fork needs no login.
   - Do not use `/plugin marketplace add Winandvdb/human-review`: it installs the fork's default
     branch, which does not have the patches.
   - Restart Claude Code after the skill link, so it offers `/human-review`.
2. Python 3.10 or newer, in a venv that comes first on `PATH` (the scripts call `python3`):

   ```bash
   python3 -m venv ~/tools/hr-venv
   ~/tools/hr-venv/bin/pip install pygments pillow numpy playwright==1.56.0 pyyaml
   export PATH=~/tools/hr-venv/bin:$PATH
   ```

3. `npm install` (the dev dependencies `playwright` and `@vitest/coverage-istanbul`), then
   `npx playwright install chromium` once.
4. `ffmpeg` (`brew install ffmpeg`). The narration uses the macOS `say` voice.

## Run

In a Claude Code session in the repo: `/human-review origin/develop` (the branch) or
`/human-review <PR number>`. The page lands in `.human-review/`, which git ignores.

- Always give the base. With no argument and a clean working tree, the skill compares the branch
  against `origin/main`, not against `develop`: it passes its own `--base` to every script. The
  `"base": "origin/develop"` in `human-review.json` applies only when you run `run-steps.py`
  without `--base`.
- Skip the producers that only fail or stay empty here: when the skill runs `run-steps.py`, add
  `--skip city,diagrams`. Code City is Java-only, and the diagram diff needs PlantUML while koejon
  has no diagrams. Without the skip, `steps-ledger.py check` also reports a DRIFT for the Data and
  Structure tabs.
- Stop the page server before you delete `.human-review/`:
  `$HUMAN_REVIEW_HOME/scripts/serve-review.py --stop`.

One step on its own, for example to check the setup:

```bash
$HUMAN_REVIEW_HOME/scripts/run-steps.py --only testcov --skip city,diagrams --no-ledger
$HUMAN_REVIEW_HOME/scripts/run-steps.py --only video --no-ledger
```

What `human-review.json` sets up:

- `video.app`: `scripts/review-app.sh up <sha>` builds that commit with `VITE_ALLOW_SEED=1` (so
  `?seed=` works, `src/lib/seed.ts`) and `VITE_USE_FIREBASE_EMULATOR=true` (a film never signs in
  to the live Firebase project or writes to its database; without a running emulator the app
  plays solo offline), and serves it with `vite preview` on a free port; `down` stops it. `reset: "true"` is a no-op on purpose: solo state lives in the browser, and every film opens a
  fresh browser context.
- `NARRATION_FISH: "off"`: the narration stays on this Mac. Without it, a Fish Audio key in the
  environment sends every spoken line to that paid service.
- `testcov.vitest`: per-test coverage of all vitest tests except `tests/simulation.test.ts` (it runs
  almost the whole engine, so it would "cover" every changed line) and the emulator e2e test.
- Leave out the UX audit and Code City: they find nothing for koejon (see the spike).

## Writing the film script

The model writes `.human-review/feature-script.js` per change (`export default async ({page, say,
pause, app}) => …`, see the plugin's `reference/feature-script.md`). koejon has no URL per screen:
the script starts a seeded solo game and clicks through it.

- **Seeds** (on the code of #77): with seeds 2, 6, 7, 10 and 12 you become the dealer (you win the
  draw and choose yourself). With seeds 1, 3, 4, 5, 8, 9 and 11 a bot deals. A change to how the
  host draws random numbers moves these; probe again if a film no longer gets there.
- **Solo flow**, in this order. A button only shows when it is your turn:
  1. Home: set the language (`EN` button), type a name in *Nickname*, click *Play against bots*.
  2. Dealer draw: *Lift* (you draw a card).
  3. *Choose the first dealer*: a button per player name (when you won the draw).
  4. Cut: *Lift* again when you cut.
  5. First deal only: *How do you want to sort your cards?* (three buttons).
  6. Bidding: *Play* / *Pass*. When everybody passed: *Dealer chooses* (a suit or *Pass*).
  7. The turned cards lie at the dealer's seat (`.area-me .turned-at` when you deal) from the
     bidding until the first card of the hand is played.
  8. *Seen* when the table waits for you; then the tricks (`.trick-area .trick-card`).
- Drive the flow with one loop that clicks whichever of these buttons shows, until the state the
  film needs is on screen. A fixed list of clicks breaks on the first step that comes in another
  order. Two of three films in the spike failed on that.
- Wait for an element before you `say()` something about it, and catch a miss per screen
  (`FAILED to reach:`), as the plugin's reference says.

Example (seed 2, to the first trick):

```js
export default async ({page, say, pause, app}) => {
  const NAME = 'Reviewer';
  const btn = (name) => page.getByRole('button', {name, exact: true});
  const visible = (text) => page.getByText(text).isVisible();
  await page.goto(`${app}/?seed=2`);
  await btn('EN').click();
  await page.getByLabel('Nickname').first().fill(NAME);
  await page.getByRole('button', {name: /Play against bots/}).click();
  const playUntil = async (done, ms = 60000) => {
    const t0 = Date.now();
    while (!(await done()) && Date.now() - t0 < ms) {
      if (await btn('Lift').isVisible()) await btn('Lift').click();
      else if (await visible('Choose the first dealer'))
        await page.locator('.fab-row .fab', {hasText: NAME}).click();
      else if (await visible('How do you want to sort your cards?') || await visible('Dealer chooses'))
        await page.locator('.fab-row .fab').first().click();
      else if (await btn('Play').isVisible()) await btn('Play').click();
      else if (await btn('Seen').isVisible()) await btn('Seen').click();
      await page.waitForTimeout(200);
    }
  };
  const turned = page.locator('.area-me .turned-at');
  await playUntil(() => turned.isVisible());
  await turned.waitFor({timeout: 1000});
  await say('You are the dealer: the turned cards lie at your seat.', turned);
  await pause(1000);
  return {ok: true, note: '1/1 changed screens filmed'};
};
```

## Limits

- Svelte components have no unit tests, so their lines show as "no probe for this kind of file".
- The test pairing on the Tests tab is a model step (`rerun-model.py`, a Sonnet call by default).
- The fork's patches are not upstream yet; offering them to victorrentea needs the owner's yes.
