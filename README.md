<p align="center"><img src=".github/readme/faces.png" width="160" alt="Three sample personas"></p>

<h1 align="center">Persona Studio</h1>

<p align="center"><b>See your app through your users' eyes before they tell you what's broken.</b></p>

<p align="center">Each persona is a distinct user with a real job to do. Persona Studio sends them into your app in Orca's browser and brings back the bugs, missing pieces, and rough edges that got in their way.</p>

<p align="center">
  <a href="https://github.com/jejacks0n/orca-persona-studio/actions/workflows/ci.yml"><img src="https://github.com/jejacks0n/orca-persona-studio/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  &nbsp;An <a href="https://orca.dev">Orca</a> plugin · v0.1.0 · MIT
</p>

## Why personas

- Personas go beyond your test suite, exploring the paths a real person takes and catching surprises you never thought to script.
- Test as real people, not "a user." Someone who never touches the mouse runs into very different walls than someone rushing on a phone.
- Give a persona a measurable goal, like exporting in three keystrokes or fewer, and track your progress across every run.

## Setup

Setup happens in a quick chat. An agent handles the wiring while you shape the personas. Nothing gets committed until you decide it's ready.

1. The agent learns what your app does and who it's for.
2. You keep, rename, or tweak the personas it suggests.
3. The agent makes sure your app starts cleanly.
4. Each persona is saved as a file in your project.
5. Run your personas to test your app from their perspective.

Works with web apps out of the box and takes a few minutes: [load the plugin](#installation), open your project in Orca, and press **Set up personas** in the Persona Studio sidebar.

<details>
<summary><b>Not a web app? Bring your own harness</b> (CLI, desktop app, API)</summary>

1. Once you have personas (setup makes them for any app), set `runPrompt` in `persona.studio` to a `.md` path or inline prompt telling the agent how to start and drive your app, where to write its results, and to write `{doneFile}` when finished.
2. Optionally set `reviewPrompt` for a second agent that turns raw run output into findings.

See [CONTRACT.md](plugin/CONTRACT.md) for the full spec (placeholders, results format, and done files).

</details>

## How it works

- **Personas run independently.** Each persona runs when you tell it to, in its own copy of the project.
- **One findings list per project.** Reports from every persona and every run arrive as findings, sorted into five lists: New, Kept, Working, Fixed and Closed.
- **You triage.** Keep what matters, close what doesn't (Won't fix, Not a bug, Duplicate, Can't reproduce), group findings that are the same problem, and add your own notes to any finding.
- **You hand off.** Start work opens a normal Orca worktree with an agent briefed from the finding and your notes. Persona Studio doesn't build fixes itself.

### What exists today

Triage is built: the findings list, every triage action above, notes, screenshots, and making a GitHub issue from a finding. Running personas is built too, along with Discuss (a chat about one finding, writing into its notes) and Start work (a briefed worktree that Persona Studio watches until it merges, through `gh` when you have it, or git when you don't).

Setup is built: a chat that reads your project, writes your first personas with you, and writes `persona.studio`.

## Getting started

### Prerequisites

- [Orca](https://orca.dev) 1.4.248+
- A git project. Persona files (`.md` files with goals) make personas show up; until there are some, the sidebar offers **Set up personas**, which starts the setup chat.
- Optional: the GitHub CLI (`gh`), for making issues from findings.

### Installation

```sh
orca plugin dev load ./plugin
```

Orca lists the access the plugin asks for and needs your approval before it runs.

### Configuration

`persona.studio` at your project root holds the project's settings, and opening it opens the Persona Studio tab. The first time you open the tab, Persona Studio creates it as `{}`; commit it with the project. Every field is optional.

There are two ways to run personas:

- **Persona Studio starts your app.** Set `start`, and Persona Studio prepares a copy of the project, starts the app on a free port, waits for it to answer, and stops it when the run ends. Its own prompt drives the app in Orca's browser.

  ```json
  {
    "start": "npm run dev -- --port {port}",
    "prepare": ["npm install"],
    "copy": [".env"]
  }
  ```

- **Your own harness.** Set `runPrompt`, and your prompt starts and drives the app. Persona Studio ignores `start`, `prepare`, `copy` and `url`. Use `{port}` in the prompt so personas can run side by side; without it, they run one at a time.

  ```json
  {
    "personas": "docs/qa/personas",
    "runPrompt": "docs/qa/run-prompt.md",
    "reviewPrompt": "docs/qa/review-prompt.md"
  }
  ```

| Field | Default | What it does |
| --- | --- | --- |
| `personas` | `docs/personas` | Folder of persona files |
| `start` | | Command that starts the app; `{port}` is filled in |
| `prepare` | `[]` | Commands run in a fresh copy before `start` |
| `copy` | `[]` | Untracked files copied into the copy, such as `.env` |
| `url` | `http://localhost:{port}` | Where the started app answers |
| `port` | `4210` | First port tried for a run; each run gets a free one from here up |
| `runPrompt` | | Your prompt for a run (own harness) |
| `reviewPrompt` | | Your prompt for reviewing a run's findings |
| `builderBrief` | | Your rules for the agent that works on a finding |
| `repo` | the `origin` remote | GitHub repo, as `owner/name` |
| `setup` | `run` | What a new worktree does first: `run`, `skip` or `inherit` |
| `runsDir` | `qa-runs` | Where each run keeps its output, in its worktree |
| `resultsFile` | `results.json` | The results file's name in a run folder |

A prompt that's one line ending in `.md` is read from that file; anything else is the prompt itself. [`plugin/CONTRACT.md`](plugin/CONTRACT.md) has the details: placeholders, the persona file format, and the done and results files.

`persona.studio` is the only file Persona Studio puts in your project. Its working files, such as each finding's brief and notes, live in `~/.persona-studio/<project>/`.

## Using it

### Sidebar

The **Persona Studio** panel follows the project you have open in Orca. It shows how many findings are New, Kept, Working and Fixed (each count opens the tab on that list), then your personas, each with how many new findings it has. Pressing a persona, or its **View**, opens the tab on it. A persona that's idle has **Run** (**Run again** once it has run before), a running one shows its newest progress line and its step (2/3) with **Stop**, and one whose last run failed says so (the reason is on its page in the tab). **Run all idle** starts every persona that isn't running, and **Open Studio** opens the tab. Before a project has personas, the sidebar shows the setup steps and **Set up personas**.

### The tab

One tab per project, opened from the sidebar or the command palette. The findings list is on the left and the selected finding on the right: what each persona saw, its steps and screenshots, its history, and your notes. Select several findings to keep, close or group them at once, or, in Kept, to start work on them: in one worktree with one agent, or one each. Keep and Close can be undone.

Pressing a persona shows its run, or when it last ran, its findings by list and its goals, with **Run** or **Watch the run** and **Stop**. Every finding has **Discuss**, which opens a chat about it, and a kept one also has **Start work**, which makes a worktree and opens an agent briefed from the finding and your notes.

### Commands

- **Persona Studio: open the tab** opens the tab for the project you have open.
- **Persona Studio: what needs me** says how many findings are waiting in each list.

## Development

The plugin is TypeScript with no build step: Orca loads `plugin/src/` directly. The worker (`worker.ts`) is the only place that changes state; the sidebar (`panel.tsx`) and the tab (`app*.ts`) ask it and redraw.

```sh
orca plugin test plugin                       # tests
orca plugin types plugin                      # writes the Orca typings tsc needs (once per Orca update)
npx --yes -p typescript@5 tsc -p plugin --noEmit  # types; prints nothing when clean
orca plugin check plugin                      # renders each sidebar state and loads the tab
orca plugin validate plugin                   # the manifest, as Orca will load it
```

CI runs these on Linux against a pinned Orca and against Orca's newest release, which it also checks weekly. It takes Orca's CLI from the Linux package rather than installing the app.

- `plugin/src/`: the worker, the sidebar, the tab, and their tests
- `plugin/CONTRACT.md`: what a project provides
- `.github/workflows/ci.yml`: the CI workflow

## License

MIT
