import type { Goal, GoalResult, RunRecord } from './types'

const resultFor = (goal: Goal, run: RunRecord): GoalResult | undefined => run.goals.find((g) => g.goal === goal.text)

/** A counted goal's value in each run that has one. */
export function series(goal: Goal, runs: RunRecord[]): { runId: string; loop: number; value: number; input?: string }[] {
  if (!goal.measure) return []
  return runs.flatMap((r) => {
    const v = resultFor(goal, r)?.value
    return v === undefined ? [] : [{ runId: r.runId, loop: r.loop, value: v, ...(r.input !== undefined && { input: r.input }) }]
  })
}

/** Whether the latest run meets the goal. */
export function isMet(goal: Goal, runs: RunRecord[]): boolean {
  const g = runs.length ? resultFor(goal, runs[runs.length - 1]) : undefined
  if (!g) return false
  if (!goal.measure) return g.judgment === 'met'
  if (g.value === undefined) return false
  return goal.measure.better === 'lower' ? g.value <= goal.measure.target : g.value >= goal.measure.target
}
