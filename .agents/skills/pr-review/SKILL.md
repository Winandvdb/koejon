---
name: pr-review
description: Review one GitHub pull request of this repo with three review hats (General, Security, Performance) and post the findings as one review with inline comments on the PR. Use when the user says "review PR 52", "review #52", "do a code review of pull request 52" or runs /pr-review.
argument-hint: <PR number, e.g. 52 or #52>
---

# pr-review

You review ONE pull request and post the result on GitHub as ONE review with inline comments.
Do the steps in order. Do not ask the user for approval, except in a STOP case.
You do not change code, commit or push. You only read and comment.

## Fixed values

- Repo: `Winandvdb/koejon`
- Main checkout: the directory that contains `AGENTS.md`. Call it `<REPO>` (an absolute path).
- Hats: the files in `<REPO>/.agents/skills/pr-review/hats/`. Each file is one review hat: `general.md`, `security.md`, `performance.md`.
- Review event: `REQUEST_CHANGES` when there is a blocking finding (step 5), else `COMMENT`. Never `APPROVE`.
- Marker: put the line `<!-- pr-review -->` at the end of each review body and each comment body. Step 3 uses it to find earlier reviews.

## STOP cases

When one of these is true, stop. Tell the user what you found. Do not post anything.

- No PR number was given and the user did not choose one (see step 0).
- The PR does not exist, or it is merged or closed.
- `gh` is not logged in.

## Tool notes

- `gh` and `git fetch` need the network. If a command fails with a TLS, certificate or "Forbidden" error inside a sandbox, run it again outside the sandbox.
- Replace every `<...>` placeholder with the real value before you run a command.
- Write temporary files (diff, findings, payload) to the scratchpad directory, or `$TMPDIR` if there is no scratchpad. Call it `<TMP>`.

---

## Step 0: Get the PR number

The argument is a number (`52`) or `#52`. Use only the number: `<N>`.

If there is no argument, run this and show the result to the user. Ask which PR to review. Then STOP until they answer.

```bash
gh pr list --repo Winandvdb/koejon --state open --json number,title,author \
  --jq '.[] | "#\(.number) \(.title) (\(.author.login))"'
```

## Step 1: Read the PR

```bash
cd <REPO>
gh auth status
gh api user --jq .login          # this is <ME>
gh pr view <N> --repo Winandvdb/koejon \
  --json number,title,body,state,isDraft,author,baseRefName,headRefName,headRefOid,files,closingIssuesReferences
```

- `state` is `MERGED` or `CLOSED` → STOP.
- `headRefOid` is `<SHA>`. `baseRefName` is `<BASE>`.
- If the PR closes an issue, read it: `gh issue view <issue> --repo Winandvdb/koejon --json title,body`. Its acceptance criteria tell you what the PR must do.

Read `<REPO>/AGENTS.md`. It has the code map and the rules of this repo.

## Step 2: Get the code and the diff

Check out the PR head in a separate worktree, so that you can read full files:

```bash
cd <REPO>
git fetch origin <BASE> "pull/<N>/head"
git worktree add --detach <REPO>/.worktrees/pr-<N> <SHA>
git diff --unified=5 origin/<BASE>...<SHA> > <TMP>/pr-<N>.diff
```

`<WT>` is `<REPO>/.worktrees/pr-<N>`. If `<WT>` already exists, run `git -C <WT> checkout --detach <SHA>` instead of `git worktree add`.

Read the full diff. If the diff is very large (more than 3000 lines), skip lock files and generated files, and say so in the review body.

## Step 3: Get the earlier comments

```bash
gh api --paginate repos/Winandvdb/koejon/pulls/<N>/comments \
  --jq '.[] | {path, line, body, user: .user.login}' > <TMP>/pr-<N>-comments.json
```

You use this list in step 5, so that you do not post the same point again.

## Step 4: Review with the three hats

Do one review pass for each hat file. If you can start subagents, start one subagent per hat, all three at the same time. If you cannot, do the three passes one after the other, and keep each pass to its own hat.

Give each pass this task. Fill in the values:

```
You review pull request #<N> of Winandvdb/koejon: "<title>".
PR description and linked issue: <body and acceptance criteria>.

Your review hat is in <REPO>/.agents/skills/pr-review/hats/<hat>.md. Read it and keep to its scope.
Read <REPO>/AGENTS.md for the rules of this repo.
The diff is in <TMP>/pr-<N>.diff. The full code at the PR head is in <WT>.
Read the full files around each change, not only the diff. Follow callers and callees when you need to.
Do not edit any file. Do not run git commands that change state.

Report only real problems in lines that this PR adds or changes.
For each finding, give:
- path: file path relative to the repo root
- line: the line number in the NEW file (the PR head). It must be a "+" line or a context line inside a diff hunk.
- severity: high (bug, data loss, cheat or cost that will happen), medium (likely problem), low (small but real)
- title: one short sentence
- body: what is wrong, a concrete case that fails, and the fix. Max 120 words.
If you find nothing, return an empty list. An empty list is a good result.
```

## Step 5: Check the findings

Collect all findings. For each finding:

1. Read the code in `<WT>` at that path and line. Confirm that the problem is real. If you cannot confirm it, drop it.
2. If two hats report the same problem, keep one, with the tag of the hat that explains it best.
3. If an earlier comment from step 3 already makes the same point on the same code, drop it.
4. Check that the line is inside a diff hunk on the new side. If it is not, move the finding to the review body (step 6) instead of an inline comment.

Mark a finding as **blocking** when its severity is `high` AND one of these is true:

- It is a Security finding.
- It is a General finding that breaks the game, the score or a match in progress, or loses data.
- It is a General finding where the code no longer does what the ruleset says (`rules/rules-nl.md`, `rules/rules-en.md`, `RULE_ASSUMPTIONS.md`).

The owner-confirm comment on a rule text change (General hat) is never blocking by itself. Give it severity `low`, and keep it even when the 15-comment limit is reached.

Performance findings are never blocking. When you are not sure that a finding is blocking, it is not blocking.

Keep max 15 inline comments. Always keep all blocking findings. If there are more, keep the highest severity, and list the rest in short lines in the review body.

## Step 6: Post the review

Write each inline comment body in this form:

```
**[<Hat tag> · <severity>]** <title>

<body>

<only for a blocking finding: "**Blocking:** this must be fixed before merge.">

<!-- pr-review -->
```

Use a ```` ```suggestion ```` block only when you are sure of the exact replacement lines.

Write the review body in this form:

```
## Code review: General, Security, Performance

| Hat | Findings |
|---|---|
| General | <count> |
| Security | <count> |
| Performance | <count> |

<only when there are blocking findings: "**Changes requested:** <count> blocking finding(s). Fix them before merge.">

<findings that are not on a diff line, one line each, or "No other findings.">

<!-- pr-review -->
```

If there are no findings at all, still post the review. Use the body `## Code review: General, Security, Performance` and the line `No findings.`, plus the marker.

Write the payload to `<TMP>/pr-<N>-review.json`:

```json
{
  "commit_id": "<SHA>",
  "event": "<EVENT>",
  "body": "<review body>",
  "comments": [
    { "path": "<path>", "line": <line>, "side": "RIGHT", "body": "<comment body>" }
  ]
}
```

Choose `<EVENT>` from this table. Use the first row that is true:

| Situation | `<EVENT>` | Then |
|---|---|---|
| No blocking finding | `COMMENT` | nothing |
| Blocking finding, and the PR author is not `<ME>` | `REQUEST_CHANGES` | nothing |
| Blocking finding, and the PR author is `<ME>` | `COMMENT` | Change the PR to a draft (see below). GitHub does not let you request changes on your own PR. |

Post it:

```bash
gh api --method POST repos/Winandvdb/koejon/pulls/<N>/reviews --input <TMP>/pr-<N>-review.json --jq .html_url
```

If GitHub returns `422` because a line is not part of the diff, move those comments to the review body and post again once.

For your own PR with a blocking finding, change it to a draft after the review is posted. In this repo, a draft PR means that something failed, and a draft cannot be merged:

```bash
gh pr ready <N> --repo Winandvdb/koejon --undo
```

Do not change a draft back to ready, and do not dismiss earlier reviews. The PR author does that after the fix.

## Step 7: Clean up

```bash
git -C <REPO> worktree remove <REPO>/.worktrees/pr-<N>
```

Remove only the `pr-<N>` worktree that you made in step 2. Never delete other folders in `.worktrees/`.

## Step 8: Report to the user

Give, in short sentences:

- The review link.
- The result: commented, changes requested, or changed to a draft.
- The number of findings per hat and per severity.
- The high-severity findings, one line each.
- Findings that you dropped in step 5 because you could not confirm them, if any.
