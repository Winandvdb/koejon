---
name: release-pr
description: Open (or refresh) the release PR into main, from a release branch cut from develop, with a description of every change in the release. Collects the PRs merged into develop since the last release, groups them for players, lists the manual checks and the Firestore rules changes. Never merges. Use when the user says "make a release PR", "release to main", "prepare a release" or runs /release-pr.
argument-hint: (none)
---

# release-pr

You cut a release branch from `develop`, open ONE pull request from it into `main` and write its description.
The description tells the reviewer what goes live and what to check before the merge.
The release branch freezes the release: PRs that merge into `develop` later do not change the PR, its checks or its description.
Do the steps in order. Do not ask the user for approval, except in a STOP case.

**Never merge the PR.** A merge into `main` deploys the live site (`.github/workflows/firebase-hosting-merge.yml`). The user merges by hand.

## Fixed values

- Repo: `Winandvdb/koejon`
- Head branch: the release branch `release/<YYYY-MM-DD>` (today's date), cut from `origin/develop` in step 3. Call it `<REL>`. Base branch: `main`.
- PR title: `Release to main`
- Main checkout: the directory that contains `AGENTS.md`. Call it `<REPO>`.
- Earlier release PRs: the merged PRs into `main`. Older ones have head `develop`, newer ones a `release/*` branch. Step 2 finds the last one.

## STOP cases

When one of these is true, stop. Tell the user what you found. Do not change anything.

- `gh` is not logged in.
- `develop` has no commits that `main` does not have (step 2).
- `main` has non-merge commits that `develop` does not have (step 2), for example a hotfix. Someone must merge `main` back into `develop` first.
- An open PR into `main` exists whose head is not a `release/*` branch (step 2), for example an old release PR from `develop`. The user must close it first.

## Tool notes

- `gh` and `git fetch` need the network. If a command fails with a TLS, certificate or "Forbidden" error inside a sandbox, run it again outside the sandbox.
- Replace every `<...>` placeholder with the real value before you run a command.
- Do not check out a branch and do not edit files. Use `origin/main`, `origin/develop` and `origin/<REL>` only.
- Never push commits to `<REL>`. A fix for the release goes into `develop` through a normal PR. Then close the release PR and run this skill again.

---

## Step 1: Preflight

```bash
cd <REPO>
gh auth status
git fetch origin
```

## Step 2: Check what goes live

Check for an open release PR:

```bash
gh pr list --repo Winandvdb/koejon --base main --state open --json number,url,headRefName
```

- Head is a `release/*` branch: note the PR number as `<P>` and its head as `<REL>`. You refresh its body in step 8. You do not open a second one and you do not cut a new branch. Its content stays as it is.
- Head is another branch → STOP.

Set `<SRC>`: `origin/<REL>` when `<P>` exists, else `origin/develop`.

```bash
git log --oneline --no-merges <SRC>..origin/main     # must be empty
git log --oneline origin/main..<SRC>                 # must not be empty
```

First output not empty → STOP. Second output empty → STOP: there is nothing to release.
The merge commits of earlier release PRs exist only on `main`. `--no-merges` skips them, because their content is already on `develop`.

Find the last release PR. Its number is `<L>`. Read its body for the tone and the level of detail:

```bash
gh pr list --repo Winandvdb/koejon --base main --state merged --limit 1 --json number,url,headRefName
gh pr view <L> --repo Winandvdb/koejon --json body --jq .body
```

## Step 3: Cut the release branch

Skip this step when `<P>` exists.

`<REL>` is `release/<YYYY-MM-DD>` with today's date. Check that the name is free:

```bash
git ls-remote --heads origin 'refs/heads/release/<YYYY-MM-DD>*'
```

If the name is taken, add `-2` (then `-3`, and so on) until it is free.
Push the current `origin/develop` as the new branch. This makes no local branch, so nothing tracks `develop`:

```bash
git push origin origin/develop:refs/heads/<REL>
git fetch origin
git rev-parse origin/<REL> origin/develop     # the two hashes are normally equal
```

The hashes differ only when a PR merged into `develop` between the fetches. That is not a problem: the release is `origin/<REL>`.
From here on, use `origin/<REL>`, not `origin/develop`, for the content of the release.

## Step 4: Find the PRs in the release

Each PR merge into `develop` (or into a feature branch that later reached `develop`) is a merge commit `Merge pull request #<n> from ...`:

```bash
git log --merges --format='%s' origin/main..origin/<REL> \
  | sed -nE 's/^Merge pull request #([0-9]+) from .*/\1/p' | sort -n | uniq
```

These are the release PRs `<PRS>`. For each one:

```bash
gh pr view <n> --repo Winandvdb/koejon \
  --json number,title,body,labels,baseRefName,closingIssuesReferences
```

Note per PR: title, the issues it closes, the labels (`needs manual check`, `bug`), the summary and the "Check by hand" part of the body.
A PR with `baseRefName` other than `develop` reached `develop` through that branch. Name it in "Related PRs" (step 6).

Also look for commits on `develop` that came from no PR. There should be none, because `develop` is protected:

```bash
git log --no-merges --first-parent --format='%h %s' origin/main..origin/<REL>
```

Name any result in "Related PRs".

## Step 5: Check the risky parts

Run each command. Note the result for the body.

```bash
git diff --stat origin/main origin/<REL> -- firestore.rules     # rules change on deploy
git diff --stat origin/main origin/<REL> -- src/engine/        # engine state shape
git diff --stat origin/main origin/<REL> -- .github/ pwa/ vite.config.ts firebase.json
```

- `firestore.rules` changed: say what changed, and that CI deploys the rules on the merge.
- `src/engine/` changed: read the diff of the types. If the state shape changed, add a check that a host in the middle of a match during the deploy can reload and continue.
- CI, service worker or hosting config changed: say it in "Approach".

Then find the work that is NOT in the release:

```bash
gh pr list --repo Winandvdb/koejon --base develop --state open --json number,title,isDraft
git log --merges --format='%s' origin/<REL>..origin/develop \
  | sed -nE 's/^Merge pull request #([0-9]+) from .*/\1/p' | sort -n | uniq
```

The second command lists the PRs that merged into `develop` after the cut. They go in the next release.

## Step 6: Write the body

Write the body to a file in your scratchpad. Use this layout. Write in English, in short sentences.

```
## Functional context

Release of `develop` to `main` (live on koejon.web.app), cut as `<REL>`. It contains everything merged into `develop` since the last release (#<L>) up to the cut:

- **<Player-facing theme>** (#<issue>, #<issue>): <what a player sees or gets now, 1-2 sentences>.
- **<Theme>** (#<issue>): <...>
- **Docs / CI / tooling**: <one line for changes that players do not see>.

## Approach

| PR | Change |
|---|---|
| #<n> | <what changed in the code, 1-2 sentences: files, functions, state fields> |

<One line about Firestore rules: "Firestore rules do not change in this release." or what changes.>

## Checks

<"PRs #<a> and #<b> have the label `needs manual check`." Leave out when none.> Do these on the preview of this PR (prod build) or on the dev channel:

- [ ] CI is green on this PR
- [ ] <one check per "Check by hand" item of each PR, with the PR number at the end> (#<n>)
- [ ] <only if the engine state shape changed> A host in the middle of a match during the deploy can reload and continue (#<n>)
- [ ] A full solo match on hard
- [ ] Multiplayer room: create, join, play a hand

## Related PRs

Head is `<REL>`, base is `main`. This release contains #<n>, #<n> and #<n>. <PRs that reached develop through another branch.>

Not in this release: <open PRs into develop, as #<n> (<short reason: draft, open>), and PRs merged into develop after the cut, as #<n> (merged after the cut)>. <"None" if empty.>
```

Rules:

- **Functional context**: group by what players notice, not by PR. Each bullet names its issues. Put docs, skills, CI and refactors in one last bullet.
- **Approach**: one row per PR in `<PRS>`, every PR, sorted by number. Group PRs that belong together in one row (`#43, #44, #45`).
- **Checks**: take the checks from the PRs, do not invent new features to check. Merge duplicates.
- Do not copy whole PR bodies. Do not invent changes that no PR describes.
- End the body with the attribution line that your harness gives you, if any.

## Step 7: Check the body

Compare the body with `<PRS>` from step 4:

- Every PR number in `<PRS>` appears in "Approach" and in "Related PRs".
- No PR number appears that is not in `<PRS>`, except in "Not in this release" and the last-release reference.

Fix the body until both are true.

## Step 8: Open or refresh the PR

No open release PR (step 2):

```bash
gh pr create --repo Winandvdb/koejon --base main --head <REL> --assignee @me \
  --title "Release to main" --body-file <file>
```

Open release PR `<P>` exists:

```bash
gh pr edit <P> --repo Winandvdb/koejon --body-file <file>
```

Add the label `needs manual check` when the "Checks" list has a check that only a person can do. That is almost always true:

```bash
gh pr edit <PR number> --repo Winandvdb/koejon --add-label "needs manual check"
```

Do not merge. Do not approve.

## Step 9: Report to the user

Give, in short sentences:

- The PR link, and if you made it or refreshed it.
- The release branch `<REL>`, and if you cut it now or it already existed.
- The number of PRs in the release, and the player-facing themes.
- If Firestore rules or the engine state shape change.
- What is not in the release, also the PRs merged into `develop` after the cut.
- That the user must do the checks and then merge by hand. The merge deploys the live site.
- That a fix for the release goes into `develop` first. Then the user closes this PR and runs the skill again.
