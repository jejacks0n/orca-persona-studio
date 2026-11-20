import type { Kind } from './model'
import type { GoalResult, Metric, Severity } from './types'

export interface Results { runId: string; persona: string; seed: number; appCommit: string; clean: boolean
  scriptHash?: string; input?: string
  steps: { name: string; measured?: string; counts?: Partial<Record<Metric, number>> }[]
  findings: { id: string; kinds: string[]; severity: Severity; title: string; step: string; repro: string
    expected: string; actual: string; shots: string[]; kind?: Kind }[]
  rechecks?: { findingId: string; result: 'fixed' | 'still'; note: string }[]
  goals: GoalResult[]; scores: Record<string, number | null> }

const severities = ['blocker', 'major', 'minor', 'polish']
const metrics = ['keys', 'clicks', 'taps', 'tabs', 'dialogs', 'ms']
const kindValues = ['bug', 'missing', 'polish']
const recheckResults = ['fixed', 'still']
const judgments = ['met', 'close', 'notMet']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Check a results file by hand. Collects every problem as `<path>: <what>` and throws them together. */
export function parseResults(json: unknown): Results {
  const bad: string[] = []
  const str = (o: Record<string, unknown>, path: string, key: string, optional = false) => {
    if (typeof o[key] === 'string' || (optional && o[key] === undefined)) return
    bad.push(`${path}${path ? '.' : ''}${key}: must be a string`)
  }
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const list = (o: Record<string, unknown>, key: string, each: (item: Record<string, unknown>, path: string) => void, optional = false) => {
    const v = o[key]
    if (optional && v === undefined) return
    if (!Array.isArray(v)) { bad.push(`${key}: must be a list`); return }
    v.forEach((item, i) => {
      if (isObj(item)) each(item, `${key}[${i}]`)
      else bad.push(`${key}[${i}]: must be an object`)
    })
  }
  const strings = (v: unknown, path: string) => {
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) bad.push(`${path}: must be a list of strings`)
  }

  if (!isObj(json)) throw new Error('results: must be an object')
  for (const k of ['runId', 'persona', 'appCommit']) str(json, '', k)
  str(json, '', 'scriptHash', true)
  str(json, '', 'input', true)
  if (!num(json.seed)) bad.push('seed: must be a number')
  if (typeof json.clean !== 'boolean') bad.push('clean: must be true or false')

  list(json, 'steps', (s, p) => {
    str(s, p, 'name'); str(s, p, 'measured', true)
    if (s.counts === undefined) return
    if (!isObj(s.counts)) { bad.push(`${p}.counts: must be an object`); return }
    for (const [k, v] of Object.entries(s.counts)) {
      if (!metrics.includes(k)) bad.push(`${p}.counts.${k}: not a metric (${metrics.join(', ')})`)
      else if (!num(v)) bad.push(`${p}.counts.${k}: must be a number`)
    }
  })
  const ids = new Set<unknown>()
  list(json, 'findings', (f, p) => {
    for (const k of ['id', 'title', 'step', 'repro', 'expected', 'actual']) str(f, p, k)
    if (ids.has(f.id)) bad.push(`${p}.id: "${f.id}" is already used`)
    ids.add(f.id)
    strings(f.kinds, `${p}.kinds`); strings(f.shots, `${p}.shots`)
    if (f.kind !== undefined && !kindValues.includes(f.kind as string)) bad.push(`${p}.kind: must be one of ${kindValues.join(', ')}`)
    if (!severities.includes(f.severity as string)) bad.push(`${p}.severity: must be one of ${severities.join(', ')}`)
  })
  list(json, 'rechecks', (r, p) => {
    str(r, p, 'findingId'); str(r, p, 'note')
    if (!recheckResults.includes(r.result as string)) bad.push(`${p}.result: must be one of ${recheckResults.join(', ')}`)
  }, true)
  list(json, 'goals', (g, p) => {
    str(g, p, 'goal'); str(g, p, 'evidence', true); str(g, p, 'shot', true)
    if (g.value !== undefined && !num(g.value)) bad.push(`${p}.value: must be a number`)
    if (g.judgment !== undefined && !judgments.includes(g.judgment as string)) bad.push(`${p}.judgment: must be one of ${judgments.join(', ')}`)
    if (g.value === undefined && g.judgment === undefined) bad.push(`${p}: needs a value or a judgment`)
  })
  if (!isObj(json.scores)) bad.push('scores: must be an object')
  else for (const [k, v] of Object.entries(json.scores)) {
    if (v !== null && !num(v)) bad.push(`scores.${k}: must be a number or null`)
  }

  if (bad.length) throw new Error(bad.join('\n'))
  return json as unknown as Results
}
