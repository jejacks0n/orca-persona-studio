export type Severity = 'blocker' | 'major' | 'minor' | 'polish'
export type Judgment = 'met' | 'close' | 'notMet'
export type Metric = 'keys' | 'clicks' | 'taps' | 'tabs' | 'dialogs' | 'ms'

/** One Orca worktree. `branch` is the worktree's own branch. Its config is read from the working copy each time, never stored. */
export interface Project { id: string; name: string; path: string; branch: string }
export interface Goal { text: string; measure?: { metric: Metric; task: string; target: number; better: 'lower' | 'higher' } }
export interface GoalResult { goal: string; value?: number; judgment?: Judgment; evidence?: string; shot?: string }
/** One landed run. `loop` is its number among the persona's runs, from 1. */
export interface RunRecord { runId: string; loop: number; seed: number; resultsPath: string; at: number
  goals: GoalResult[]; input?: string
  landed?: { fresh: number; again: number; confirmed: number; reopened: number } }
