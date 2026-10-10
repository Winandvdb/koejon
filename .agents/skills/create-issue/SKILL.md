---
name: create-issue
description: Create one GitHub issue in this repo, with a description, acceptance criteria, a type label and a priority label, ready for the start-issue skill. Use when the user says "create an issue", "make a task for ...", "log this bug", "add to the backlog" or runs /create-issue.
argument-hint: <what the issue is about>
---

# create-issue

You write ONE GitHub issue that another session can pick up with the `start-issue` skill.
That session sees only the issue and the code. Write so it needs nothing else.

## Fixed values

- Repo: `Winandvdb/koejon`
- Type labels: `bug` (something is broken), `enhancement` (new or changed behaviour), `question` (a spike: the result is a write-up in `docs/spikes/`, not code).
- Priority labels: `priority: high`, `priority: medium`, `priority: low`.

## Tool notes

- `gh` needs the network. If a command fails with a TLS, certificate or "Forbidden" error inside a sandbox, run it again outside the sandbox.
- Replace every `<...>` placeholder with the real value before you run a command.

## Step 1: Understand the request

Take the request from the argument and the conversation.
If you cannot tell what must change or why, ask the user. Then STOP until they answer.

Read `AGENTS.md`. Use its code map to find the code that the issue touches. Read that code.
For a bug: find where the wrong behaviour comes from. If you cannot find the cause, write what you checked and the candidate causes.

## Step 2: Check for duplicates

```bash
gh issue list --repo Winandvdb/koejon --state all --search "<2-4 key words>" --json number,state,title
```

If an open issue already covers the request, do not make a new one. Tell the user the issue number and STOP.
If a related issue exists, note its number for the body.

## Step 3: Write the issue

- **Title**: short and imperative, or a short statement of the bug. Example: `Pulse the Gezien and Ik ga buttons`, `Guest seat turns into a bot after the host minimizes the app`.
- **Description**: what is wrong or missing now, what the result must be, and why. Name the files, functions and CSS classes that you found in step 1. Say what is out of scope when that is not clear.
- **Acceptance criteria**: 2 to 8 items. Each item is one result that a test or a person can check. Say "with a test" where a test must prove it. For UI: phone width, light and dark theme, and text in nl and en when that applies.
- **Dependencies**: one line `Depends on #<D>` for each issue that must be merged first.
- **Related**: one line `Related to #<R>` for a related issue.
- **Type label**: one from the fixed values.
- **Priority**: use the priority that the user gave. If they gave none, use `priority: medium` and say so in the report.

Write the body to a file. Keep the `### Acceptance criteria` heading exactly: `start-issue` looks for it.

```
<description>

Depends on #<D>
Related to #<R>

### Acceptance criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
```

Leave out the `Depends on` and `Related to` lines when there are none.

## Step 4: Create the issue

```bash
gh issue create --repo Winandvdb/koejon --title "<title>" \
  --label "<type label>" --label "<priority label>" --body-file <file>
```

Do not assign the issue. `start-issue` assigns it when work starts.

## Step 5: Report to the user

Give, in short sentences:

- The issue link and number.
- The labels, and if you chose the priority yourself.
- Open questions that you wrote in the issue, if any.
- The next command: `/start-issue <number>`.
