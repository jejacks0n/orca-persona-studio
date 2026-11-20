import { STATES, type CloseReason, type Finding, type FindingState, type Kind } from './model'
import { severityRank } from './finding'
import type { Severity } from './types'

/** `reports` and `latest` (newest report time) are carried only so `rows` can order. */
export interface Row { id: string; title: string; kind: Kind; severity: Severity; state: FindingState; personas: string[]
  runs: number; reopened: boolean; fresh: boolean; members: number; pr?: { number: number; state: string }
  issue?: number; confirmedBy?: string; closedReason?: CloseReason; reports: number; latest: number }
export interface Filter { state: FindingState; persona?: string; kind?: Kind; q?: string }

/** A finding's kind when a results file gives only free labels: 'polish' if a label or the severity is polish, 'missing' if a label is missing or feature, else 'bug'. */
export function kindOf(labels: readonly string[], severity: Severity): Kind {
  const l = labels.map((x) => x.toLowerCase())
  if (severity === 'polish' || l.includes('polish')) return 'polish'
  if (l.includes('missing') || l.includes('feature')) return 'missing'
  return 'bug'
}

export function toRow(f: Finding): Row {
  const pr = f.work?.pr
  return {
    id: f.id, title: f.title, kind: f.kind, severity: f.severity, state: f.state,
    personas: [...new Set(f.reports.map((r) => r.persona))],
    runs: new Set(f.reports.map((r) => r.runId)).size,
    reopened: !!f.reopened, fresh: f.fresh === true, members: f.members?.length ?? 0,
    pr: pr && { number: pr.number, state: pr.state }, issue: f.issue?.number,
    confirmedBy: f.confirmed?.by, closedReason: f.closed?.reason,
    reports: f.reports.length, latest: Math.max(0, ...f.reports.map((r) => r.at)),
  }
}

const matches = (r: Row, { persona, kind, q }: Omit<Filter, 'state'>): boolean =>
  (!persona || r.personas.includes(persona)) && (!kind || r.kind === kind) && (!q || r.title.toLowerCase().includes(q.toLowerCase()))

/** Rows matching the filter, ordered: severity (highest first), reopened first, most reports first, newest report first. */
export function rows(all: readonly Row[], filter: Filter): Row[] {
  return all.filter((r) => r.state === filter.state && matches(r, filter)).sort((a, b) =>
    severityRank(b.severity) - severityRank(a.severity) || +b.reopened - +a.reopened || b.reports - a.reports || b.latest - a.latest)
}

/** How many rows each list holds under the same persona, kind and search. */
export function counts(all: readonly Row[], filter: Omit<Filter, 'state'>): Record<FindingState, number> {
  const out = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<FindingState, number>
  for (const r of all) if (matches(r, filter)) out[r.state]++
  return out
}
