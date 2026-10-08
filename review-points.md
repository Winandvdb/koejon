---
base: 1952a5b42889e507d2f3683ccfd2b3c680b86e55
audited-base: 1952a5b42889e507d2f3683ccfd2b3c680b86e55
audited-head: 645b4eadae1c5810698db7fc79009bbcdd54a9d1
implementation: 645b4eadae1c5810698db7fc79009bbcdd54a9d1
head: 645b4eadae1c5810698db7fc79009bbcdd54a9d1
reviewers: /code-review high
harness: claude-code
session: 0e3b4d47-67f2-4d87-8524-dd118006ad9c
fixed-in: HEAD
anchors: review-commit
---

## Fixed

### Review builds signed in to the live Firebase project
- file: scripts/review-app.sh:27-28
- file: docs/human-review.md:75-77
- source: /code-review high
- severity: high
- observation: the review build was a production build with the real Firebase config. Every film signed in anonymously to the live project, and a film played to the end would write a games record into the shared database.
- fix: build with VITE_USE_FIREBASE_EMULATOR=true; without an emulator the app plays solo offline.

### A deleted .human-review/ left the base worktree registered
- file: scripts/review-app.sh:23
- file: scripts/review-app.sh:58
- source: /code-review high
- severity: medium
- observation: up added a git worktree under .human-review/.apps and down never removed it; after rm -rf .human-review the next worktree add for that sha failed.
- fix: prune before add, and down removes the worktree.

### up printed the URL when the server never answered
- file: scripts/review-app.sh:41-45
- source: /code-review high
- severity: medium
- observation: the wait loop ended silently after 30 s or a crashed vite preview, and up still exited 0 with a URL, so the film recorded an error page.
- fix: fail with the end of preview.log when the port never answers.

### Python playwright was not pinned
- file: docs/human-review.md:41
- source: /code-review high
- severity: low
- observation: pip installed the latest playwright while npx installed Chromium for the pinned 1.56.0; a Python script would miss its browser.
- fix: pin playwright==1.56.0 in the pip line.

### Docs and human-review.json seemed to disagree on the base
- file: docs/human-review.md:54-57
- source: /code-review high
- severity: low
- observation: the docs said a run with no argument compares against origin/main while human-review.json sets origin/develop.
- fix: say the skill passes its own --base; the config base applies to run-steps.py without --base.

## Ignored

### Normalise the short sha in url and down
- file: scripts/review-app.sh:49
- source: /code-review high
- severity: info
- observation: up names the app dir with git rev-parse --short, url and down use the plugin's {shortsha} as given.
- why: the plugin makes {shortsha} with git rev-parse --short too (run-steps.py _app_slots).

### HEAD builds the dirty working tree in place
- file: scripts/review-app.sh:19
- source: /code-review high
- severity: low
- observation: HEAD builds the working tree with its .env.local; another commit builds a clean worktree.
- why: in place is how uncommitted work gets filmed; the emulator flag now fixes the backend.

### The base worktree uses HEAD's node_modules
- file: scripts/review-app.sh:25
- source: /code-review high
- severity: low
- observation: a base commit is built with the current checkout's dependency versions, not its own lockfile.
- why: only the UX audit builds a base commit, and koejon does not configure it.

### The stacked PR breaks "PRs go into develop"
- file: AGENTS.md:73
- source: /code-review high
- severity: info
- observation: PR #81 targets feature/77-seed-url-parameter and the branch started from it.
- why: the human asked in this session to stack #78 on #77 and not merge #77 yet.

### The review dev dependencies install in every npm ci
- file: package.json:26-27
- source: /code-review high
- severity: low
- observation: playwright and @vitest/coverage-istanbul install in CI and deploys, though only the local review tool uses them.
- why: the issue asked for this choice; one pinned version for everyone outweighs install time.

## Assumptions

### Playwright as a pinned dev dependency, not a folder outside the repo
- file: package.json:27
- alternative: a Playwright folder outside the repo via HUMAN_REVIEW_NODE_PATH
- confidence: 0.6
- why: every checkout then films with the same recorder version and no extra path. It costs install time in CI and deploys, which the review flagged; optionalDependencies would also work.

### The CI gate waits for the PR workflow
- file: human-review.json:4
- alternative: name the develop workflow, or let the plugin pick every run on the sha
- confidence: 0.9
- why: koejon has no ci.yml, and firebase-hosting-pull-request.yml is the one that tests a PR branch. It only runs while the PR can merge, which the #77 review showed.

### Install the fork as a user skill link, not from the plugin marketplace
- file: docs/human-review.md:23
- alternative: /plugin marketplace add Winandvdb/human-review
- confidence: 0.8
- why: the marketplace takes the fork's default branch, which lacks the koejon patches. Merging koejon-spike into the fork's main would make the marketplace route work.
