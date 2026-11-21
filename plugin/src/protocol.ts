// The worker's contract with the sidebar panel and the tab, declared once: src/panel.tsx, src/app*.ts and src/worker.ts read it.
import type { Action } from './finding'
import type { Row } from './findings-view'
import type { Finding, FindingState, Report } from './model'
import type { Trend } from './trends-draw'

/** The focused Orca worktree: any git worktree is a project. */
/** `path`: the focused worktree's checkout. `persona`: that worktree is the persona's QA worktree, which belongs to this project. */
export type Focus = { kind: 'none' } | { kind: 'notGit'; name: string } | { kind: 'project'; id: string; name: string; personas: number; path?: string; persona?: string }
/** Why the focused workspace shows no project. */
export const focusWords = (f: Exclude<Focus, { kind: 'project' }>): string =>
  f.kind === 'none' ? 'Open a project in Orca to see its personas.'
    : `${f.name} isn't in a git repository. Persona Studio works with apps kept in git; open one to see its personas.`
/** Where the setup chat is, after setup.start: `existing` when it was already open. */
/** Where the contract for bringing your own harness is published. */
export const CONTRACT_URL = 'https://github.com/jejacks0n/orca-persona-studio/blob/main/plugin/CONTRACT.md'

export const setupWords = (existing: boolean): string => (existing ? 'Setup is already open in your tabs as "Set up personas".'
  : 'Setup is open in the "Set up personas" chat. Your personas will appear here once they\'re saved.')
/** Why a run held back, and what to do: commit, or run anyway on the last commit. */
export const uncommittedWords = (n: number): string =>
  `${n === 1 ? '1 file has' : `${n} files have`} uncommitted changes. Commit them first, or run anyway to test your last commit.`
/** An error in its own words. */
export const say = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A `Step <n> of <total>: …` progress line: n, total, and what the step is doing. */
const STEP = /^step (\d+) of (\d+):?\s*(.*)$/i
/** The script step a running persona is on, as `n/total`; undefined when its newest line isn't a step. */
export function stepOf(p: PersonaRow): string | undefined {
  const step = STEP.exec(p.line?.trim() ?? '')
  return step ? `${step[1]}/${step[2]}` : undefined
}

/** A running persona's status in one line: its stage, then the script step as n/total and what it's doing (from a
 *  `Step <n> of <total>: …` progress line), or the stage and its newest line.
 *  `withStep: false` leaves out the n/total, for a caller that shows it apart (stepOf). */
export function statusOf(p: PersonaRow, withStep = true): string {
  const stage = p.stage ?? 'Running', line = p.line?.trim() ?? ''
  const step = STEP.exec(line)
  if (step) return [stage, withStep && `${step[1]}/${step[2]}`, step[3]].filter(Boolean).join(' · ')
  if (!line || line === stage) return stage
  return line.startsWith(stage) ? line : `${stage} · ${line}`
}

/** `stage`, `line` and `chat` (the run chat's name) while running; `error`, why the last run failed; `recheck`, how many
 *  fixes its next run checks again. */
export interface PersonaRow { id: string; name: string; tag: string; state: 'idle' | 'running'; line?: string; fresh: number; runs: number; lastRunAt?: number
  stage?: string; error?: string; chat?: string; recheck: number
  /** The portrait beside its persona file, as a data URL. */
  portrait?: string }
/** `canRun`: why runs can't start, or null. `configError`: why persona.studio or the persona files don't load, or null. */
export interface Overview { personas: PersonaRow[]; counts: Record<FindingState, number>; hasGh: boolean; canRun: string | null; configError: string | null }
/** One persona: its row, the run's last lines, QA branch and port while running, and every goal in its persona file. */
export interface PersonaDetail { row: PersonaRow; lines: string[]; branch: string | null; port: number | null
  /** The run is in the project's own checkout, not a copy of its own. */
  inPlace?: true
  /** The persona file's `## Who`, a paragraph each. */
  who: string[]
  goals: { text: string; met: boolean; trend?: Trend }[] }
export interface ReportView extends Report { personaName: string }
export interface Detail { finding: Omit<Finding, 'reports' | 'members'> & { reports: ReportView[]; members: { id: string; title: string; personas: string[] }[] }
  notes: { text: string; mtime: number } }
/** `persona: null` clears the tab's chosen persona; left out, the tab keeps it. */
export type Show = { state?: FindingState; persona?: string | null; finding?: string; run?: true }

declare module 'orca' {
  interface PluginRequests {
    'focus.get': { output: Focus }
    'theme.get': { output: { canvas: string | null } }
    'overview.get': { input: { project: string }; output: Overview }
    'findings.list': { input: { project: string }; output: { rows: Row[] } }
    'finding.get': { input: { project: string; id: string }; output: Detail }
    'finding.act': { input: { project: string; action: Action }; output: { undo: string | null } }
    'findings.undo': { input: { project: string; token: string }; output: { ok: true } }
    'notes.set': { input: { project: string; id: string; text: string; base: number }; output: { mtime: number } }
    'tab.open': { input: { project: string; show?: Show }; output: { ok: true } }
    /** The projects whose persona.studio holds `text`: the tab sends its own file to learn which project it belongs to. */
    'tab.projects': { input: { text: string }; output: { projects: string[] } }
    /** What the last tab.open asked to show, once: the tab asks when it has loaded, as a new tab misses the post. */
    /** `at`: the asking tab's checkout, when it knows it. */
    'show.take': { input: { project: string; at?: string }; output: { show: Show | null } }
    'shot.get': { input: { project: string; id: string; report: string; index: number }; output: { url: string | null; name: string } }
    'shot.open': { input: { project: string; id: string; report: string; index: number }; output: { ok: true } }
    'issue.draft': { input: { project: string; id: string }; output: { title: string; body: string; notes: string } }
    'issue.create': { input: { project: string; id: string; title: string; body: string }; output: { number: number; url: string } }
    'discuss.start': { input: { project: string; id: string }; output: { chat: string; title: string; existing: boolean } }
    'setup.start': { input: { project: string }; output: { chat: string; existing: boolean } }
    /** One worktree for every finding in `ids`; the brief covers them all. `autoBrief` is the brief with Open a PR when done ticked. */
    'work.draft': { input: { project: string; ids: string[] }; output: { name: string; base: string; brief: string; autoBrief: string } }
    /** One worktree for all of `ids`, named `name`; or with `each`, one each, named from its title (`name` unused). `autoPr`: each agent opens its PR when done. */
    'work.start': { input: { project: string; ids: string[]; name: string; base: string; each?: boolean; autoPr?: boolean }; output: { ok: true } }
    'tick': { output: { ok: true } }
    /** Without `anyway`, a checkout with uncommitted changes doesn't start: it answers how many files have them. */
    'run.start': { input: { project: string; persona: string; focus?: string; anyway?: boolean }; output: { ok: true; inPlace?: true } | { uncommitted: number } }
    'run.stop': { input: { project: string; persona: string }; output: { ok: true } }
    'run.watch': { input: { project: string; persona: string }; output: { ok: true } }
    'persona.get': { input: { project: string; persona: string }; output: PersonaDetail }
    /** Open the persona's file in Orca's editor. */
    'persona.open': { input: { project: string; persona: string }; output: { ok: true } }
  }
  interface PluginPanelEvents { focus: Focus; changed: { project: string; finding?: string }; show: { project: string; at: string } & Show
    /** A run landed on the findings list: `text` is the line that says how it went. */
    landed: { project: string; persona: string; text: string } }
}
