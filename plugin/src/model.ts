import type { RunRecord, Severity } from './types'

export type Kind = 'bug' | 'missing' | 'polish'
export type FindingState = 'new' | 'kept' | 'progress' | 'fixed' | 'closed'
export type CloseReason = 'wontFix' | 'notABug' | 'duplicate' | 'cantReproduce'

export const STATES: readonly FindingState[] = ['new', 'kept', 'progress', 'fixed', 'closed']
export const stateWord: Record<FindingState, string> = { new: 'New', kept: 'Kept', progress: 'Working', fixed: 'Fixed', closed: 'Closed' }
export const reasonWord: Record<CloseReason, string> = { wontFix: "Won't fix", notABug: 'Not a bug', duplicate: 'Duplicate', cantReproduce: "Can't reproduce" }
/** The screens say "low" because "polish" is also a kind. */
export const severityWord: Record<Severity, string> = { blocker: 'blocker', major: 'major', minor: 'minor', polish: 'low' }

export interface Report { id: string; persona: string; runId: string; at: number; saw: string; steps: string[]; shots: string[]; severity: Severity; step: string }
export interface Work { worktreePath: string; branch: string; workspaceId?: string; chat?: string
  /** The commit the branch started from: `base` is the branch it was cut from, `start` the commit. */
  base?: string; start?: string
  pr?: { number: number; url: string; state: 'open' | 'merged' | 'closed' } }
export interface Finding { id: string; title: string; kind: Kind; labels: string[]; severity: Severity; state: FindingState
  reports: Report[]; history: { at: number; text: string }[]; fresh?: boolean
  closed?: { reason: CloseReason; why?: string; at: number }
  reopened?: { by: string; runId: string; note: string; at: number }
  confirmed?: { by: string; runId: string; at: number }
  fixedAt?: number; work?: Work; issue?: { number: number; url: string }; discussion?: string
  /** The originals a Group folded in, kept whole so Ungroup can put them back. */
  members?: Finding[] }
export interface ProjectFindings { v: 2; project: string; next: number; findings: Finding[] }
export type RunStage = 'preparing' | 'using' | 'reviewing' | 'waiting' | 'matching'
export interface RunTask { id: string; role: 'run' | 'review' | 'match'; chat: string; endedAt?: number }
export interface ActiveRun { id: string; stage: RunStage; at: number; seed: number; port: number; focus?: string
  recheck: string[]; qa?: { path: string; branch: string; workspaceId: string }; app?: { pid: number }
  task?: RunTask; results?: { path: string; at: number } }
export interface PersonaRecord { v: 2; project: string; persona: string; runs: RunRecord[]
  run?: ActiveRun; error?: { at: number; text: string } }
export const emptyFindings = (project: string): ProjectFindings => ({ v: 2, project, next: 1, findings: [] })
