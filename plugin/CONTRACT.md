# What a project should provide

Persona Studio reads files from your project. This page says which, and what should be in them.

## Config

`persona.studio` sits at the project root, committed with the project. It's JSON, and it's also the file that opens the Persona Studio tab: pressing a button in the sidebar opens it, and can help you create this file if the project doesn't have it yet. Every field is optional and falls back to its default.

```json
{
  "personas": "docs/qa/personas",
  "runPrompt": "docs/qa/run-prompt.md",
  "reviewPrompt": "Review the run's findings against the goals.",
  "repo": "owner/name",
  "setup": "run",
  "start": "npm run dev -- --port {port}",
  "prepare": ["npm install"],
  "copy": [".env"],
  "url": "http://localhost:{port}",
  "port": 4210,
  "builderBrief": "docs/qa/builder-brief.md",
  "runsDir": "qa-runs",
  "resultsFile": "results.json"
}
```

| Field | Meaning |
| --- | --- |
| `personas` | Folder of persona files, relative to the project root. |
| `runPrompt` | Your prompt for a persona run: a file or the text itself (see [Prompts](#prompts)). |
| `reviewPrompt` | Your prompt for reviewing a run's findings: a file or the text itself. |
| `repo` | The GitHub repo, as `owner/name`. Defaults to the one the `origin` remote points at. |
| `setup` | What a new workspace does first: `run` (run the project's setup), `skip`, or `inherit` (follow the repository's own setup policy). |
| `start` | The command that starts the app in a persona's copy. `{port}` is filled in. |
| `prepare` | Commands to run in the copy before `start`, in order. |
| `copy` | Files to copy from your project into the copy, by path (a `.env`, say). |
| `url` | Where the started app answers; Persona Studio waits for it. Defaults to `http://localhost:{port}`. |
| `port` | The first port to try for a run's copy of the app. Defaults to 4210. |
| `builderBrief` | Your instructions for the agent that works on a finding: a file or the text itself. |
| `runsDir` | Folder where each run keeps its output, relative to the workspace. |
| `resultsFile` | The file name a run writes its results to, inside its run folder. |

When there's no `runPrompt`, Persona Studio uses `start`, `prepare`, `copy`, `url` and `port` to start the app itself, and uses its own run prompt.

The setup chat (**Set up personas**) writes `start`, `prepare`, `copy` and, only if needed, `url`, along with the persona files and a portrait beside each. It never commits them.

A field with the wrong type is refused, and the message names the field. So is a prompt file that isn't there.

Each Orca worktree is its own project, the main checkout included, and reads `persona.studio` from its own root. There's no base branch to set: the worktree's own branch is the one runs test (its last local commit; Run asks first when there are uncommitted changes), fixes are built from, and PRs go into.

## Persona files

Each `*.md` file in the personas folder is one persona. The file name (without `.md`) is its id, and the first `# ` heading is its name, optionally followed by a colon and a short tag (`# Maya: edits photos on a tablet`). Files starting with `_` (a template, say) are skipped. Personas are listed by id.

Persona Studio reads only these sections. The rest of the persona file is for the persona's agent.

```md
# Maya: edits photos on a tablet
## Who
Maya is a hobby photographer who edits on a tablet on the couch.
## Goals
- Open a photo from the keys in three presses or fewer.
  Counted: keys on open-photo, target 3, lower is better.
- The help is readable on a tablet.
## Script
1. Open my photo. Measured: open-photo
## Known
- Undo history is lost on reload.
```

- **Who**: a few sentences on who the persona is, shown on the persona's page in the tab.
- **Goals**: each `- ` bullet is a goal. A goal with no extra line is judged by the run as met, close or not met.
- **Counted line**: an indented line right under a goal, written `Counted: <metric> on <task>, target <number>, <lower|higher> is better.` It makes the goal a number the run counts. `<metric>` is one of `keys`, `clicks`, `taps`, `tabs`, `dialogs` or `ms`. `<task>` matches a `Measured:` marker in the Script. A Counted line that doesn't read is ignored, and the goal is judged instead.
- **Script**: numbered steps. A step ending in `Measured: <task>` is where the run counts that task. The marker is not part of the step text.
- **Known**: each `- ` bullet is a problem already on your list. Runs don't report these as new.

A persona file with no Goals section is fine; it just has no goals.

A persona's portrait is an `.svg` beside its file with the same name (`maya.md`, `maya.svg`), up to 64 KB. The tab shows it in place of the persona's initial: in the Personas list, in the header when the persona is chosen, and on the persona's page. It's drawn as an image, so nothing in the SVG runs. `PORTRAIT_PROMPT` in [`src/prompts.ts`](src/prompts.ts) holds the rules that have an agent draw them; the setup chat includes it.

## Prompts

`runPrompt`, `reviewPrompt` and `builderBrief` each hold either a file or the prompt itself:

- **One line ending in `.md`** is a Markdown file in your project, relative to its root, such as `"docs/qa/run-prompt.md"`. It must be inside the project, and it must exist.
- **Anything else** is the prompt, word for word: `"Use the app as {persona} and report what gets in your way."`

Persona Studio fills these placeholders, written in braces, before it hands the prompt to an agent:

| Placeholder | Filled with |
| --- | --- |
| `{persona}` | The persona's id. |
| `{seed}` | The number for this run, so a run can be repeated. |
| `{script}` | The persona file's path. The agent follows its `## Script` section, if it has one. |
| `{goals}` | The persona file's `## Goals` section as written: the bullets and their Counted lines, word for word. |
| `{runDir}` | The folder this run writes into. |
| `{doneFile}` | The path the agent writes its done file to when it finishes. |
| `{url}` | The address of this run's copy of the app: `url` with `{port}` filled in. |
| `{worktree}` | The root of the persona's QA worktree, where the run happens. |
| `{resultsFile}` | The results file's name, from `resultsFile`. |
| `{port}` | The port this run's copy of the app listens on. A run prompt that doesn't use it can't share the machine, so that project's personas run one at a time. |
| `{recheck}` | The fixes to check again, one per line with the finding's id and title. |
| `{closed}` | Closed findings with their reasons, so the run doesn't report them again. |
| `{focus}` | Your answer to "Anything to focus on?" when you started the run, or empty. |

A run does three things in order: rechecks the fixes it was given, follows the persona file's `## Script` if it has one, then goes after the persona file's goals its own way, steered by `{focus}`. Your prompts cover how to run and judge your app. Each must end by telling the agent to write `{doneFile}`, as described under [Done files](#done-files).

## Results file

After each run, your reviewer writes one results file: `<runsDir>/<run folder>/<resultsFile>`. A run that was split across several folders writes one results file, in its first folder, and prefixes each finding id with its folder number (`1-F8`, `2-F15`). Shot paths are relative to the folder holding the results file, so a shot in another folder is written `../<other folder>/shots/<file>`. Shots should be JPEG and under about 700 KB to show in the tab; a PNG works too while it's under that limit.

Everything below is required unless marked optional. Text fields may be empty but must be text. A bad file is refused, and the message lists each problem by where it is (for example `findings[0].severity`). A refused file fails the review, so the owner sees it as the reviewer's problem.

Each finding's `step` must be, word for word, the `name` of one of the run's `steps`.

A fix the run was asked to recheck, and didn't report again in a clean run, counts as fine even without a `rechecks` entry. If a run says a fix is fine and also reports a problem that matches it, the report wins.

```jsonc
{
  "runId": "2026-11-10-maya-503179919",
  "persona": "maya",                      // the persona's id
  "seed": 503179919,                      // the number the run used
  "appCommit": "b03fd01...",              // the app's commit the run tested
  "clean": true,                          // false if the run was disturbed or incomplete
  "scriptHash": "ab12...",                // optional: identifies the script that was followed
  "input": "touch",                       // optional: how this persona gets around, such as touch
  "steps": [
    { "name": "1. Open my photo",
      "measured": "open-photo",           // optional: the task named by a Measured: marker
      "counts": { "keys": 45, "clicks": 14 } },  // optional: keys, clicks, taps, tabs, dialogs or ms
    { "name": "Free time: Getting the picture in" }
  ],
  "findings": [
    { "id": "1-F8",                       // unique in the file: a repeated id is refused
      "kind": "bug",                      // optional: bug, missing or polish; bug when left out
      "kinds": ["a11y"],                  // your own labels, shown as written
      "severity": "major",                // blocker, major, minor or polish
      "title": "The help i never opens on a tablet",
      "step": "Free time: Getting the picture in",   // a steps[].name above, word for word
      "repro": "Tap the i beside Choose characters.",
      "expected": "The help shows.",
      "actual": "Nothing appears.",
      "shots": ["shots/046-after-tapping-the-i.png"] }
  ],
  "goals": [
    { "goal": "Open a photo from the keys in three presses or fewer.",   // the goal's text, as in the persona file
      "value": 45 },                      // a counted goal has a number...
    { "goal": "The help is readable on a tablet.",
      "judgment": "notMet",               // ...a judged goal has met, close or notMet
      "evidence": "Tapping the help i never opens it.",   // optional
      "shot": "shots/046-after-tapping-the-i.png" }       // optional
  ],
  "rechecks": [                           // optional: a verdict on each fix in {recheck}
    { "findingId": "f12", "result": "fixed", "note": "The help opens on tap now." }   // result: fixed or still
  ],
  "scores": { "keyboard": 60 }            // a number for each score you track, or null if not measured
}
```

## Done files

Persona Studio can't tell when an agent has finished its task, so every agent it launches ends by writing a done file. The prompt names the exact path as `{doneFile}`. Orca takes at most 4,096 characters as an agent's prompt, so each filled prompt goes in a file, and the agent is told to read that file and follow it.

Your project's checkout only ever gets `persona.studio`. Everything else Persona Studio writes (done files, filled prompts, each finding's brief and notes) lives outside it, under `~/.persona-studio/<project id>/`, so there's nothing to add to `.gitignore`.

- **Write it last, in one write.** Persona Studio reads the file as soon as it appears, so the agent writes it only when everything else is done, as one whole JSON object.

Your run and review prompts must end by telling the agent to write `{doneFile}`; Persona Studio's own prompts already do. Each writes one shape:

| Role | Runs in | Done file |
| --- | --- | --- |
| run | the persona's QA worktree (your run prompt) | `{ ok, results?, error? }` |
| review | the persona's QA worktree (your review prompt) | `{ ok, results?, error? }` |

- **run:** `ok` is true when the run finished. `results` names the results file (as for review below). A run that names it skips the review; one that doesn't gets the review next when the project has a `reviewPrompt`. When `ok` is false, `error` says what went wrong.
- **review:** `ok` is true when the results file is written, and `results` is its path: absolute, or relative to the QA worktree's root. When it is false, `error` says why. A results file that doesn't read (see [Results file](#results-file)) fails the review.
- An agent whose turn ends with no done file written is taken as stopped, and you can run the persona again.

Matching a run's findings against the project's list is Persona Studio's own step, with its own prompt; your project doesn't provide it.

## Progress files

You don't have to do anything for these. Persona Studio adds one paragraph to the end of every prompt it gives an agent, your run and review prompts included. It asks the agent to add a short line to a progress file under `~/.persona-studio/<project id>/` each time it starts something new (for example `Step 7 of 31: Export my .ans`), and never to rewrite the file. The sidebar shows a running persona's newest line.
