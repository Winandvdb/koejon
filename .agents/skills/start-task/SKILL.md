---
name: start-task
description: Start and finish one backlog task of this repo end to end. Claims the GitHub issue (assigns it to the logged-in gh user), makes a git worktree from develop, plans, implements, tests and opens a PR into develop. Use when the user says "start task 7", "pick up task-7", "work on issue #7" or runs /start-task.
argument-hint: <task number, e.g. 7 or task-7>
---

# start-task

You implement ONE backlog task, from claim to pull request.
Do the steps in order. Do not skip a step. Do not ask the user for approval, except in a STOP case.

## Fixed values

- Repo: `Winandvdb/koejon`
- Base branch: `develop` (PRs go into `develop`, never `main`)
- Main checkout: the directory that contains `backlog/` and `AGENTS.md`. Call it `<REPO>` (an absolute path).

## STOP cases

When one of these is true, stop. Tell the user what you found. Do not change anything more.

- No task number was given and the user did not choose one (see step 0).
- The backlog task does not exist, or its status is `Done`.
- The GitHub issue is closed.
- The issue is assigned to a different user than you (step 3).
- A branch for this task already exists on `origin` (step 3).
- A dependency is not finished (step 2).
- `gh` is not logged in.

## Tool notes

- `gh`, `backlog` and `npm ci` need the network. If a command fails with a TLS, certificate or "Forbidden" error inside a sandbox, run it again outside the sandbox.
- If the backlog MCP tools are not available, use the `backlog` CLI. Both edit the same files.
- Replace every `<...>` placeholder with the real value before you run a command.

---

## Step 0: Get the task number

The argument is a number (`7`) or a task id (`task-7`). Use only the number: `<N>`.

If there is no argument, run this and show the result to the user. Ask which task to start. Then STOP until they answer.

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
```

Read `<REPO>/AGENTS.md`. It has the code map, commands and rules.

## Step 2: Read the task

```bash
backlog task view <N> --plain
```

Note: title, status, labels, priority, dependencies, description and acceptance criteria.

- Status `Done` → STOP.
- For each id in `dependencies`, run `backlog task view <dep> --plain`. If its status is not `Done`, also check its GitHub issue (step 3 query with the dep number). If the issue is not closed and the task is not `Done` → STOP.

## Step 3: Find the GitHub issue and check that it is free

The first line of each issue body is `Backlog: task-<N>`. The issue number can differ from `<N>`.

```bash
gh issue list --repo Winandvdb/koejon --state all --limit 300 --json number,state,body,assignees \
  --jq '.[] | select(.body | test("^Backlog: task-<N>( |\\n|$)")) | {number, state, assignees: [.assignees[].login]}'
```

The result gives `<ISSUE>` (the issue number).

- No result: make the issue. Use the task title. Use the label `bug` if the task has label `bug`, else `enhancement`. Add `priority: <priority>` if the task has a priority. Body:

  ```
  Backlog: task-<N>

  <task description>

  ### Acceptance criteria
  - [ ] <criterion 1>
  - [ ] <criterion 2>
  ```

  ```bash
  gh issue create --repo Winandvdb/koejon --title "<title>" --label "<label>" --body-file <file>
  ```

- `state` is `CLOSED` → STOP.
- `assignees` has a login that is not `<ME>` → STOP. Someone else works on it.
- Check for an existing branch:

  ```bash
  git ls-remote --heads origin "*task-<N>-*"
  ```

  Any output → STOP. A session already started this task.

## Step 4: Claim the issue (always)

```bash
gh issue edit <ISSUE> --repo Winandvdb/koejon --add-assignee @me
gh issue view <ISSUE> --repo Winandvdb/koejon --json assignees --jq '[.assignees[].login]'
```

The second command must show `<ME>`. If it does not, try the first command once more. If it still fails → STOP.

## Step 5: Make the worktree

Make the names:

- `<SLUG>`: 2 to 5 words from the title, lower case, joined with `-`. Example: `trick-rollback`.
- `<BRANCH>`: `fix/task-<N>-<SLUG>` if the task has label `bug`, else `feature/task-<N>-<SLUG>`.
- `<WT>`: the absolute path of `<REPO>/../koejon-task-<N>`.

```bash
cd <REPO>
git worktree add --no-track -b <BRANCH> <WT> origin/develop
cd <WT>
npm ci
```

`--no-track` is required: the branch must not track `origin/develop`.

**From now on, work only inside `<WT>`.** Every file you read or edit must be under `<WT>`. Every command runs in `<WT>`. Do not edit files in `<REPO>`.

## Step 6: Mark the task "In Progress" and push the branch

```bash
cd <WT>
backlog task edit <N> -s "In Progress" -a @<ME>
git add backlog
git commit -m "Start task-<N>: <title>"
git push -u origin <BRANCH>
```

The push makes the branch visible to other sessions (see the step 3 check).

## Step 7: Understand and plan

1. Read the issue and its comments: `gh issue view <ISSUE> --repo Winandvdb/koejon --comments`.
2. Use the code map in `AGENTS.md` to find the files. Read them. Read the tests in `tests/` for the same area.
3. Write a short plan: numbered steps, and for each step how you check it. Map every acceptance criterion to a step.
4. Save the plan in the task:

   ```bash
   backlog task edit <N> --plan $'1. <step> -> check: <how>\n2. <step> -> check: <how>'
   ```

## Step 8: Implement

Rules:

- Do only what the acceptance criteria ask. Do not refactor or "improve" other code.
- Match the style of the code around your change.
- Bug: first write a test that fails because of the bug. Then fix the code. Then the test must pass.
- Engine and bot logic: add or change tests in `tests/`. Reuse the builders in `tests/helpers.ts`.
- New UI text: add it in Dutch AND English in `src/lib/i18n.ts`.
- A new rule decision: add it to `RULE_ASSUMPTIONS.md`.
- If you add, move or remove a module, command or rule that `AGENTS.md` describes, update `AGENTS.md`.

Run both checks. Both must pass:

```bash
npm test
npm run build
```

If a check fails, fix the cause and run both again. If they still fail after 3 fix rounds, continue to step 9 and open the PR as a **draft**.

## Step 9: Update the task

For each acceptance criterion that you completed and checked:

```bash
backlog task edit <N> --check-ac <index> --check-ac <index>
backlog task edit <N> --notes "<what you changed, which files, what you tested, what to check by hand>"
```

If all criteria are checked and both checks pass: `backlog task edit <N> -s Done`. Otherwise keep `In Progress`.

## Step 10: Commit, push, open the PR

```bash
cd <WT>
git status
```

Look at the list. Add only files that belong to this task. Never add `.env.local`, logs, or `dist/`.

```bash
git add <files>
git commit -m "<short imperative summary>" -m "Closes #<ISSUE>"
git push
```

Add the attribution trailer that your harness gives you, if any, to the commit message.
`Closes #<ISSUE>` is in the commit message on purpose: the issue closes when the commit reaches `main`.

Write the PR body to a file:

```
Closes #<ISSUE> · Backlog: task-<N>

## Summary
<2-5 bullets: what changed and why>

## Acceptance criteria
- [x] <done criterion>
- [ ] <not done criterion — say why>

## Tests
- `npm test`: <pass/fail>
- `npm run build`: <pass/fail>

## Check by hand
<UI or network behaviour that tests do not cover, as steps. "None" if nothing.>
```

```bash
gh pr create --repo Winandvdb/koejon --base develop --head <BRANCH> --assignee @me \
  --title "task-<N>: <title>" --body-file <file>
```

Add `--draft` if a check fails or a criterion is not done.

## Step 11: Report to the user

Give, in short sentences:

- Issue `#<ISSUE>` is assigned to `<ME>`.
- Branch `<BRANCH>`, worktree `<WT>`.
- PR link, and if it is a draft, why.
- Result of `npm test` and `npm run build`.
- What the user must check by hand.
- After the merge, remove the worktree with `git worktree remove <WT>`.
