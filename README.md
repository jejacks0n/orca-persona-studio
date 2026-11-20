# Persona Studio

**Version:** 0.1.0

Improve your Test-Driven Development using simulated personas and highly specific user goals.

An [Orca](https://orca.dev) plugin. Persona Studio uses personas, which represent a specific type of user with something to get done in your app. Each one uses the app the way that person would, and reports what bugs it encounters or friction points it ran into. You can set specific things to count, like number of keystrokes, clicks, etc. Everything they report lands in one findings list per project, where you decide what matters, and a finding you want fixed goes to an agent in an ordinary Orca worktree.

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

The **Persona Studio** panel follows the project you have open in Orca. It shows how many findings are New, Kept, Working and Fixed (each count opens the tab on that list), then your personas, each with how many new findings it has. Pressing a persona opens the tab filtered to it. A persona that's idle has **Run** (**Run again** once it has run before), a running one shows its newest progress line with **Stop**, and **Run all idle** starts every persona that isn't running.

### The tab

One tab per project, opened from the sidebar or the command palette. The findings list is on the left and the selected finding on the right: what each persona saw, its steps and screenshots, its history, and your notes. Select several findings to keep, close or group them at once, or, in Kept, to start work on them: in one worktree with one agent, or one each. Keep and Close can be undone.

Pressing a persona shows its run, or when it last ran, its findings by list and its goals, with **Run** or **Watch the run** and **Stop**. Every finding has **Discuss**, which opens a chat about it, and a kept one also has **Start work**, which makes a worktree and opens an agent briefed from the finding and your notes.

### Phone

The tab is also a page on your Mac, so you can use it from Orca's phone app. Open `http://localhost:4747` in a browser tab there, or run **Persona Studio: open on the phone** on the Mac. It works over any connection the phone app has. If 4747 is taken, change **Phone page port** in the settings and open the new address.

### Commands

- **Persona Studio: open the tab** opens the tab for the project you have open.
- **Persona Studio: open on the phone** opens the phone page in a browser tab.
- **Persona Studio: what needs me** says how many findings are waiting in each list.

## Development

The plugin is TypeScript with no build step: Orca loads `plugin/src/` directly. The worker (`worker.ts`) is the only place that changes state; the sidebar (`panel.tsx`) and the tab (`app*.ts`) ask it and redraw.

```sh
orca plugin test plugin                       # tests
npx --yes -p typescript@5 tsc -p plugin       # types; prints nothing when clean
```

- `plugin/src/`: the worker, the sidebar, the tab, and their tests
- `plugin/CONTRACT.md`: what a project provides
- `docs/mockups/`: the clickable mockup the screens are built from

## License

MIT
