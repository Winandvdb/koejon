---
name: start-issue
description: Start and finish one GitHub issue of this repo end to end. Claims the issue (assigns it to the logged-in gh user), makes a git worktree from develop, plans, implements, tests and opens a PR into develop. Use when the user says "start issue 52", "pick up #52", "work on issue #52", "start task 52" or runs /start-issue.
argument-hint: <issue number, e.g. 52 or #52>
---

# start-issue

You implement ONE GitHub issue, from claim to pull request.
Do the steps in order. Do not skip a step. Do not ask the user for approval, except in a STOP case.

## Fixed values

- Repo: `Winandvdb/koejon`. Its default branch is `develop`, so `Closes #<N>` closes the issue when the PR merges.
- Base branch: `develop` (PRs go into `develop`, never `main`)
- Main checkout: the directory that contains `AGENTS.md`. Call it `<REPO>` (an absolute path).

## STOP cases

When one of these is true, stop. Tell the user what you found. Do not change anything more.

- No issue number was given and the user did not choose one (see step 0).
- The issue does not exist, or it is closed.
- The issue is assigned to a different user than you (step 2).
- A branch or an open PR for this issue already exists (step 2).
- A dependency is not finished (step 2).
- `gh` is not logged in.

## Tool notes

- `gh` and `npm ci` need the network. If a command fails with a TLS, certificate or "Forbidden" error inside a sandbox, run it again outside the sandbox.
- Replace every `<...>` placeholder with the real value before you run a command.
- Older issues start with a line `Backlog: task-<T>` and can name other work as `task-<T>`. The backlog is gone. To find the issue for `task-<T>`: `gh issue list --repo Winandvdb/koejon --state all --search '"Backlog: task-<T>" in:body'`.

---

## Step 0: Get the issue number

The argument is a number (`52`) or `#52`. Use only the number: `<N>`.

If there is no argument, run this and show the result to the user. Ask which issue to start. Then STOP until they answer.

```bash
gh issue list --repo Winandvdb/koejon --state open --search "no:assignee" --json number,title,labels \
  --jq '.[] | "#\(.number) [\([.labels[].name] | map(select(startswith("priority"))) | join(""))] \(.title)"'
```

## Step 1: Preflight (in `<REPO>`)

```bash
cd <REPO>
gh auth status
gh api user --jq .login          # this is <ME>
git fetch origin
git status --porcelain           # save this output: it is <BASELINE>
```

`<BASELINE>` lists the changes that were already in `<REPO>` before you started. You use it in step 9.

Read `<REPO>/AGENTS.md`. It has the code map, commands and rules.

## Step 2: Read the issue and check that it is free

```bash
gh issue view <N> --repo Winandvdb/koejon \
  --json title,state,labels,assignees,body,closedByPullRequestsReferences
```

Note: title, labels, priority label, description and acceptance criteria (the `- [ ]` list under `### Acceptance criteria`).

- `state` is `CLOSED` → STOP.
- `assignees` has a login that is not `<ME>` → STOP. Someone else works on it.
- `closedByPullRequestsReferences` is not empty → STOP. A PR for this issue already exists.
- Check for an existing branch:

  ```bash
  git ls-remote --heads origin "*/<N>-*"
  ```

  Any output → STOP. A session already started this issue.

- Dependencies: each line `Depends on #<D>` in the body. For each `<D>`:

  ```bash
  gh issue view <D> --repo Winandvdb/koejon --json state --jq .state
  ```

  The output must be `CLOSED`. If it is not → STOP. The dependency is not merged yet.

## Step 3: Claim the issue (always)

```bash
gh issue edit <N> --repo Winandvdb/koejon --add-assignee @me
gh issue view <N> --repo Winandvdb/koejon --json assignees --jq '[.assignees[].login]'
```

The second command must show `<ME>`. If it does not, try the first command once more. If it still fails → STOP.

## Step 4: Make the worktree

Make the names:

- `<SLUG>`: 2 to 5 words from the title, lower case, joined with `-`. Example: `trick-rollback`.
- `<BRANCH>`: `fix/<N>-<SLUG>` if the issue has label `bug`, else `feature/<N>-<SLUG>`.
- `<WT>`: the absolute path `<REPO>/.worktrees/<N>`. It is inside the repo folder, so sandboxed commands can write there. `.worktrees/` is in `.gitignore`.

```bash
cd <REPO>
git check-ignore -q .worktrees/x || echo "NOT IGNORED"
```

If this prints `NOT IGNORED`, add the line `.worktrees/` to `<REPO>/.gitignore` before you continue. Do not commit that change in `<REPO>`. Tell the user about it in step 10.

```bash
git worktree add --no-track -b <BRANCH> <WT> origin/develop
cd <WT>
git push -u origin <BRANCH>
npm ci
```

`--no-track` is required: the branch must not track `origin/develop`.
The push makes the branch visible to other sessions (see the step 2 check).

**From now on, work only inside `<WT>`.** Every file you read or edit must be under `<WT>`. Every command runs in `<WT>`. Do not edit files in `<REPO>`.

- File paths: always use the full path that starts with `<WT>/`. Example: `<WT>/src/lib/quotes.ts`, not `<REPO>/src/lib/quotes.ts` and not `src/lib/quotes.ts`.
- Before every `git commit`, run the **checkout check**:

  ```bash
  cd <WT>
  git rev-parse --show-toplevel    # must print <WT>
  git branch --show-current        # must print <BRANCH>
  ```

  If one of them prints something else, do not commit. Run `cd <WT>` and check again.

## Step 5: Understand and plan

1. Read the issue comments: `gh issue view <N> --repo Winandvdb/koejon --comments`.
2. Use the code map in `AGENTS.md` to find the files. Read them. Read the tests in `tests/` for the same area.
3. Write a short plan: numbered steps, and for each step how you check it. Map every acceptance criterion to a step. Keep the plan: it goes in the PR body in step 9.

## Step 6: Implement

Rules:

- Do only what the acceptance criteria ask. Do not refactor or "improve" other code.
- Match the style of the code around your change.
- Bug: first write a test that fails because of the bug. Then fix the code. Then the test must pass.
- Engine and bot logic: add or change tests in `tests/`. Reuse the builders in `tests/helpers.ts`.
- New UI text: add it in Dutch AND English in `src/lib/i18n.ts`.
- A new rule decision: add it to `RULE_ASSUMPTIONS.md`.
- Spike (label `question`): write the result to `<WT>/docs/spikes/<N>-<SLUG>.md`. Do not change code. Make an issue for each follow-up with the `create-issue` skill, and list the issue numbers at the end of the write-up.
- If you add, move or remove a module, command or rule that `AGENTS.md` describes, update `AGENTS.md`.

Run both checks. Both must pass:

```bash
npm test
npm run build
```

If a check fails, fix the cause and run both again. If they still fail after 3 fix rounds, continue to step 7 and open the PR as a **draft**.

## Step 7: Sort the acceptance criteria

Put each acceptance criterion in one of three groups:

| Group | Meaning | Example |
|---|---|---|
| **Done** | You made the change AND a test or check proves it. | A new test passes. |
| **Manual check** | You made the change, but only a person can confirm it. You cannot see the screen or a real bad network. | "No clipping on cards", "colour stands out", "works on iOS". |
| **Not done** | You did not make the change, or a test for it fails. | |

The groups go in the PR body (step 9). Do not edit the issue body.

## Step 8: Check the main checkout

Check that you did not edit the main checkout by mistake:

```bash
git -C <REPO> status --porcelain
```

Compare the output with `<BASELINE>` from step 1. Ignore lines for `.worktrees/` and `.gitignore`: you made those in step 4, and they are not mistakes. **Never delete anything in `.worktrees/`.** If there are other new lines, you edited files in `<REPO>`. For each new file:

1. Copy the change to the same path under `<WT>`.
2. Undo it in `<REPO>`: `git -C <REPO> restore <path>` for a changed file, or delete a new file.

Never undo a line that was already in `<BASELINE>`. That is the user's own work.

## Step 9: Commit, push, open the PR

Run the checkout check (step 4) and look at the changes:

```bash
cd <WT>
git status
```

Look at the list. Add only files that belong to this issue. Never add `.env.local`, logs, or `dist/`.

```bash
git add <files>
git commit -m "<short imperative summary>" -m "Closes #<N>"
git push
```

Add the attribution trailer that your harness gives you, if any, to the commit message.

Write the PR body to a file:

```
Closes #<N>

## Summary
<2-5 bullets: what changed and why>

## Plan
1. <step> -> check: <how>
2. <step> -> check: <how>

## Acceptance criteria
- [x] <Done criterion>
- [ ] <Manual check criterion> — manual check, see below
- [ ] <Not done criterion> — not done: <why>

## Tests
- `npm test`: <pass/fail>
- `npm run build`: <pass/fail>

## Check by hand
<UI or network behaviour that tests do not cover, as steps. "None" if nothing.>
```

```bash
gh pr create --repo Winandvdb/koejon --base develop --head <BRANCH> --assignee @me \
  --title "#<N>: <title>" --body-file <file>
```

Add flags to that command from this table. Use the first row that is true:

| Situation | Add |
|---|---|
| `npm test` or `npm run build` fails, or a criterion is **Not done** | `--draft` |
| All criteria are **Done** or **Manual check**, and at least one is **Manual check** | `--label "needs manual check"` |
| All criteria are **Done** | nothing |

A draft PR always means that something is wrong. A **Manual check** alone is not a reason for a draft.

## Step 10: Report to the user

Give, in short sentences:

- Issue `#<N>` is assigned to `<ME>`.
- Branch `<BRANCH>`, worktree `<WT>`.
- PR link. If it is a draft, why. If it has the label `needs manual check`, which criteria.
- Result of `npm test` and `npm run build`.
- What the user must check by hand.
- If you added `.worktrees/` to `<REPO>/.gitignore` in step 4: the user must commit that.
- After the merge, remove the worktree with `git worktree remove <WT>`.
