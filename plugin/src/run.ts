import type { ActiveRun, RunTask } from './model'

export type RunEvent =
  | { type: 'prepared'; qa: NonNullable<ActiveRun['qa']>; app?: { pid: number } }
  | { type: 'launched'; task: RunTask }
  | { type: 'ended'; chat: string; at: number }
  | { type: 'results'; path: string; at: number }
  | { type: 'appStopped' }

const launchFrom = { run: 'preparing', review: 'using', match: 'waiting' } as const
const launchTo = { run: 'using', review: 'reviewing', match: 'matching' } as const

/** Pure. Throws `Error('stale')` for an event the stage doesn't take; the worker drops those. */
export function advance(run: ActiveRun, e: RunEvent): ActiveRun {
  const out = structuredClone(run)
  switch (e.type) {
    case 'prepared':
      if (out.stage !== 'preparing') throw new Error('stale')
      out.qa = e.qa
      if (e.app) out.app = e.app
      break
    case 'launched':
      if (out.stage !== launchFrom[e.task.role]) throw new Error('stale')
      out.stage = launchTo[e.task.role]; out.task = e.task
      break
    case 'ended':
      if (out.task && out.task.chat === e.chat) out.task.endedAt = e.at
      break
    case 'results':
      if (out.stage !== 'using' && out.stage !== 'reviewing') throw new Error('stale')
      out.stage = 'waiting'; delete out.task; out.results = { path: e.path, at: e.at }
      break
    case 'appStopped':
      delete out.app
      break
  }
  return out
}

export function stageWord(run: ActiveRun, line?: string): string {
  switch (run.stage) {
    case 'preparing': return 'Preparing'
    case 'using': return line?.startsWith('Writing up') ? 'Writing up' : 'Using the app'
    case 'reviewing': return 'Writing up'
    case 'waiting': return 'Matching (waiting)'
    case 'matching': return 'Matching'
  }
}

export function nextToMatch(runs: { persona: string; run: ActiveRun }[]): string | null {
  if (runs.some((r) => r.run.stage === 'matching')) return null
  const waiting = runs.filter((r) => r.run.stage === 'waiting' && r.run.results)
  waiting.sort((a, b) => a.run.results!.at - b.run.results!.at)
  return waiting[0]?.persona ?? null
}
