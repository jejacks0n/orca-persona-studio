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

## How it works

1. **Run personas.** Each persona works in its own copy of your project, at your branch's last commit, on its own port. Run one, or all of them side by side.
2. **Collect findings.** Every run's reports land in one findings list per project, sorted into New, Kept, Working, Fixed and Closed. Each report is matched against the list, so a problem already on the list gets one more report on its existing finding.
3. **Triage.** Keep what matters, close the rest with a reason (Won't fix, Not a bug, Duplicate, Can't reproduce), group findings that are the same problem, and add your own notes. **Discuss** opens a chat about a finding that writes what you decide into its notes.
4. **Hand off.** **Start work** makes an Orca worktree with an agent briefed from the finding and your notes, then moves the finding to Fixed once that work merges. **Make an issue** sends it to GitHub instead.
5. **Run again.** A persona's next run rechecks the fixes for what it reported and scores its goals again, so you can watch a number like "keys to export" go down.

Each run starts two or three agent chats: the persona's run, a review if you set `reviewPrompt`, and one that matches its reports against the findings list. Each persona's copy also runs your `prepare` commands, such as `npm ci`, and **Run all idle** does all of that for every persona at once.

## Getting started

### Requirements

- [Orca](https://orca.dev) 1.4.248 or newer
- Your app in a git repository
- Optional: the GitHub CLI (`gh`), for making issues and following pull requests
- macOS or Linux. Windows isn't supported: Persona Studio runs commands with `sh` and looks for its tools in Unix paths.

If Persona Studio can't find Orca, git or gh, set its path in Persona Studio's settings.

### Install

```sh
orca plugin install jejacks0n.persona-studio
```

Orca shows the access the plugin asks for and asks you to approve it. `orca plugin update jejacks0n.persona-studio` brings it up to the newest release.

### Set up personas

Open your project in Orca and press **Set up personas** in the Persona Studio sidebar. Setup happens in a quick chat. An agent handles the wiring while you shape the personas, and you commit the result when you're happy with it.

1. The agent learns what your app does and who it's for.
2. You keep, rename, or tweak the personas it suggests.
3. The agent makes sure your app starts cleanly.
4. Each persona is saved as a file in your project.
5. Run your personas to test your app from their perspective.

For a web app, that's everything: Persona Studio starts your app for each run and the persona uses it in Orca's browser. For anything else, setup still writes your personas, and you add a run harness.

## Bring your own harness

A run harness is a prompt that tells the persona's agent how to start and drive your app. Use one for a desktop app, a CLI, an API, or a web app you'd rather drive with your own tools. Point `runPrompt` in `persona.studio` at it:

```json
{
  "personas": "docs/personas",
  "runPrompt": "docs/qa/run-prompt.md"
}
```

Persona Studio fills in the placeholders (`{persona}`, `{runDir}` and the rest), runs the prompt in the persona's own copy of your project, and reads back the results file it writes.

### Example: an Electron app with Playwright

This harness drives a desktop app with [Playwright's Electron support](https://playwright.dev/docs/api/class-electron). It assumes `playwright` is a dev dependency.

```md
You are {persona}. Read your persona file, {script}, and use the app the way that person would.

## Start the app
Run `npm ci && npm run build`. Then write a Playwright script in {runDir} that launches the app with
`_electron.launch({ args: ['.'] })` and drives its first window. Take a JPEG screenshot into {runDir}/shots/
whenever something goes wrong. Count every key press and click you make during a task marked `Measured:`.

## Use it
1. Recheck these fixes first, and say whether each is fixed or still broken:
{recheck}
2. Follow the Script in your persona file, step by step.
3. Then go after your goals your own way:
{goals}
Focus on: {focus}

These are already known and closed; leave them out:
{closed}

## Write it up
Close the app. Write {runDir}/{resultsFile} as JSON in the shape described at
https://github.com/jejacks0n/orca-persona-studio/blob/main/plugin/CONTRACT.md#results-file
with runId set to the name of the {runDir} folder, persona "{persona}" and seed {seed}.

Last, write {doneFile} as one JSON object: {"ok": true, "results": "{runDir}/{resultsFile}"},
or {"ok": false, "error": "<what went wrong>"} if you couldn't finish.
```

The same shape works for other apps; only **Start the app** changes:

- **A web app with Playwright:** start the server on `{port}`, then `chromium.launch()` and open `http://localhost:{port}`. With `{port}` in the prompt, personas run side by side; without it, they take turns.
- **A CLI:** run the commands the persona would type, and keep each command with its output as the evidence.
- **An API:** call it with `curl` or a small script, and keep each request with its response.

### Have your agent write it

Paste this into your coding agent in your project:

```md
Read https://github.com/jejacks0n/orca-persona-studio/blob/main/plugin/CONTRACT.md. Then write
docs/qa/run-prompt.md for this project: a Persona Studio run prompt that starts and drives this app
the way a real user would, using its placeholders, writes the results file, and ends by writing
{doneFile}. Set "runPrompt": "docs/qa/run-prompt.md" in persona.studio. Ask me how the app is
normally started if you can't tell from the repository.
```

To split the work in two, add `reviewPrompt`: a second agent reads what the run left in `{runDir}` and writes the results file. [CONTRACT.md](plugin/CONTRACT.md) has every placeholder, the results file, and the done file.

## Configuration

`persona.studio` at your project root holds the project's settings. Opening it opens the Persona Studio tab, and setup writes it for you. Every field is optional.

| Field | Default | What it does |
| --- | --- | --- |
| `personas` | `docs/personas` | Folder of persona files |
| `start` | | Command that starts a web app; `{port}` is filled in |
| `prepare` | `[]` | Commands run in a persona's copy before `start`, such as `npm install` |
| `copy` | `[]` | Untracked files copied into the copy, such as `.env` |
| `url` | `http://localhost:{port}` | Where the started app answers |
| `port` | `4210` | First port tried for a run; each run takes the next free one |
| `runPrompt` | | Your run harness (see above); with it, your prompt starts the app |
| `reviewPrompt` | | A second agent that turns a run's output into the results file |
| `builderBrief` | | Your rules for the agent that works on a finding |
| `repo` | the `origin` remote | GitHub repo, as `owner/name` |
| `setup` | `run` | What a new worktree does first: `run`, `skip` or `inherit` |
| `runsDir` | `qa-runs` | Where each run keeps its output, in the persona's copy, or your checkout |
| `resultsFile` | `results.json` | The results file's name in a run folder |
| `worktrees` | `true` | `false` runs personas in your own checkout, one at a time, instead of a worktree each |

A prompt field holds a path to a `.md` file in your project, or the prompt itself.

A persona is a Markdown file with a `# Name: tag` heading and `## Who`, `## Goals` and an optional `## Script`. A goal can be judged (met, close, not met) or counted, like "Open a photo in three presses or fewer" with a `Counted:` line under it. [CONTRACT.md](plugin/CONTRACT.md#persona-files) has the format.

## What it touches

- **Your project:** `persona.studio` is the only file Persona Studio adds there. The persona files are written by the setup chat, and you commit them. With `"worktrees": false`, run output also lands in `runsDir` in your checkout.
- **Its own folder:** its working files, such as each finding's brief and notes, the prompts it hands to agents, and run logs, live in `~/.persona-studio/<project>/`. They stay after you uninstall, so delete the folder to remove them.
- **Worktrees:** each persona gets an Orca worktree on the branch `studio/qa-<persona>` (or `studio/qa-<folder>-<persona>` when you run from another worktree), and each **Start work** makes one more.
- **Commands:** it runs `start` and `prepare` from `persona.studio` with `sh`, and drives Orca, git and gh through their command-line tools. Before a project's first run, and whenever they change, Run shows those commands, or your `runPrompt` and `reviewPrompt`, and asks first.
- **The network:** Persona Studio sends nothing off your machine itself. Only git and gh do, for fetches, issues and pull request checks. The agent chats it starts are Orca's, like any other chat.

## Using it

### Sidebar

The **Persona Studio** panel follows the project you have open in Orca.

- **Counts:** New, Kept, Working and Fixed. Each one opens the tab on that list.
- **Personas:** each with its new findings. **View** opens its page in the tab; **Run** starts it (**Run again** after the first run). A running persona shows its progress and step (2/3) with **Stop**, and a failed one is marked **Failed**.
- **Run all idle** starts every persona that isn't running, and **Open Studio** opens the tab.

A run uses your branch's last commit. If you have uncommitted changes, Run says how many files have them and offers **Run anyway**.

To test your checkout as it is instead, uncommitted changes and all, set `"worktrees": false` in `persona.studio`. Each run then works in your own checkout: no worktree is made, nothing is reset or copied, `prepare` is skipped (your checkout is already set up), and personas take turns. Run output lands in `runsDir` there, so add it to your `.gitignore`.

### The tab

One tab per project, with the findings list on the left and the selected finding on the right: what each persona saw, its steps and screenshots, its history, and your notes. ⌘-click (Ctrl-click) or Shift-click to select several findings and keep, close or group them at once, or to start work on them together. Keep and Close can be undone.

A persona's page shows its current run or when it last ran, its findings, and its goals, with **Run**, **Watch the run** and **Stop**.

### Commands

- **Persona Studio: open the tab** opens the tab for the project you have open.
- **Persona Studio: what needs me** says how many findings are waiting in each list.

## Development

The plugin is TypeScript, loaded by Orca straight from `plugin/src/`. The worker (`worker.ts`) holds all state; the sidebar (`panel.tsx`) and the tab (`app*.ts`) ask it and redraw.

To run your own copy, load the folder in place of the installed plugin; edits take effect on `orca plugin dev reload`:

```sh
git clone https://github.com/jejacks0n/orca-persona-studio.git
orca plugin dev load ./orca-persona-studio/plugin
```

```sh
orca plugin types plugin                           # the Orca typings tsc needs (once per Orca update)
npx --yes -p typescript@5 tsc -p plugin --noEmit   # types
orca plugin test plugin                            # tests
orca plugin check plugin                           # renders each sidebar state and loads the tab
orca plugin validate plugin                        # the manifest, as Orca loads it
```

CI runs all of these on Linux against a pinned Orca and Orca's newest release, on every push and pull request and once a week.

- `plugin/src/`: the worker, the sidebar, the tab, and their tests
- `plugin/CONTRACT.md`: the persona file, prompts, results and done files
- `.github/workflows/ci.yml`: CI
- `orca-catalog.json`: the community catalog entry; each release adds the entry `orca plugin release-entry plugin` prints, then tags `v<version>`

## License

MIT
