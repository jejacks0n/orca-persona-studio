import { isAbsolute, relative, resolve } from 'node:path'
import { severityRank } from './finding'
import { kindOf } from './findings-view'
import type { Finding, ProjectFindings, Report } from './model'
import type { Results } from './results'

export interface LandInput { persona: string; name: string; runId: string; startedAt: number; recheck: string[]
  results: Results; resultsDir: string; qaPath: string; matches: { finding: string; match: string | null }[] }
export interface Landed { fresh: number; again: number; confirmed: number; reopened: number }

const imageExt = /\.(png|jpe?g)$/i

/** Pure. Applies one finished, matched run to the findings list; the input is never changed. */
export function landRun(pf: ProjectFindings, x: LandInput, at: number): { pf: ProjectFindings; landed: Landed } {
  const out = structuredClone(pf)
  const landed: Landed = { fresh: 0, again: 0, confirmed: 0, reopened: 0 }
  const note = (f: Finding, text: string) => { f.history.push({ at, text }) }
  const reopen = (f: Finding, text: string) => {
    f.state = 'kept'; delete f.confirmed
    f.reopened = { by: x.persona, runId: x.runId, note: text, at }
    note(f, `Reopened: ${x.name} still sees it`)
    landed.reopened++
  }
  const reopenedNow = new Set<string>()
  const entries = new Map<string, string | null>()
  for (const m of x.matches) if (!entries.has(m.finding)) entries.set(m.finding, m.match)

  for (const r of x.results.findings) {
    const report: Report = {
      id: `${x.runId}-${r.id}`, persona: x.persona, runId: x.runId, at,
      saw: r.expected ? `${r.actual}\n\nExpected: ${r.expected}` : r.actual,
      steps: r.repro.split('\n').filter((l) => l.trim()),
      shots: r.shots.map((s) => resolve(x.resultsDir, s)).filter((p) => {
        const rel = relative(x.qaPath, p)
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && imageExt.test(p)
      }),
      severity: r.severity, step: r.step
    }
    const id = entries.get(r.id)
    // Only a finding from before this run; one it just made isn't a match.
    const f = id && pf.findings.some((y) => y.id === id) ? out.findings.find((y) => y.id === id) : undefined
    if (!f) {
      const kinds = r.kinds
      out.findings.push({
        id: `f${out.next++}`, title: r.title, kind: r.kind ?? kindOf(kinds, r.severity), labels: kinds, severity: r.severity,
        state: 'new', reports: [report], history: [{ at, text: `Reported by ${x.name}` }], fresh: true
      })
      landed.fresh++
      continue
    }
    f.reports.push(report)
    if (severityRank(r.severity) > severityRank(f.severity)) f.severity = r.severity
    if (reopenedNow.has(f.id)) continue
    if (f.state === 'fixed' && (x.recheck.includes(f.id) || f.confirmed || x.startedAt > (f.fixedAt ?? Infinity))) {
      reopen(f, report.saw)
      reopenedNow.add(f.id)
    } else if (f.state === 'closed' || f.state === 'fixed') landed.again++
    else { note(f, `Seen again by ${x.name}`); landed.again++ }
  }

  for (const id of x.recheck) {
    const f = out.findings.find((y) => y.id === id)
    if (!f || f.state !== 'fixed') continue
    const entry = x.results.rechecks?.find((c) => c.findingId === id)
    if (entry?.result === 'still') reopen(f, entry.note)
    else if (entry?.result === 'fixed' || (!entry && x.results.clean)) {
      f.confirmed = { by: x.persona, runId: x.runId, at }
      note(f, `Confirmed by ${x.name}`)
      landed.confirmed++
    }
  }
  return { pf: out, landed }
}

/** The line shown when a run lands, e.g. "Dex's run is back. 2 new · 1 seen again · rechecked 2 fixes: 1 confirmed, 1 reopened". */
export function landedWords(name: string, l: Landed): string {
  const n = l.confirmed + l.reopened
  const checked = [l.confirmed ? `${l.confirmed} confirmed` : '', l.reopened ? `${l.reopened} reopened` : ''].filter(Boolean).join(', ')
  const parts = [l.fresh ? `${l.fresh} new` : 'nothing new', l.again ? `${l.again} seen again` : '',
    n ? `rechecked ${n} fix${n > 1 ? 'es' : ''}: ${checked}` : ''].filter(Boolean)
  return `${name}'s run is back. ${parts.join(' · ')}`
}
