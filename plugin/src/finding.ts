import { reasonWord, type CloseReason, type Finding, type Work, type ProjectFindings } from './model'
import type { Severity } from './types'

export type Action =
  | { type: 'keep'; ids: string[] }
  /** `closeIssue` is for the worker, which closes the GitHub issue too; the record doesn't change with it. */
  | { type: 'close'; ids: string[]; reason: CloseReason; why?: string; closeIssue?: boolean }
  | { type: 'reopen'; id: string }
  | { type: 'group'; ids: string[]; lead: string; title?: string }
  | { type: 'ungroup'; id: string }
  | { type: 'seen'; id: string }
  | { type: 'issue'; id: string; number: number; url: string }
  | { type: 'discussion'; id: string; chat: string }
  | { type: 'work'; id: string; work: Work }
  | { type: 'pr'; id: string; pr: NonNullable<Work['pr']> }
  /** `pr` is the merged PR, when gh told. */
  | { type: 'merged'; id: string; pr?: NonNullable<Work['pr']> }
  | { type: 'unwork'; id: string; why: string }

const CARRIED = ['closed', 'work', 'fixedAt', 'confirmed', 'reopened', 'issue', 'discussion'] as const

export const severityRank = (s: Severity): number => ({ blocker: 3, major: 2, minor: 1, polish: 0 })[s]

/** Pure. Returns a new record; throws an Error whose message is fit to show the owner when the action isn't allowed. */
export function act(pf: ProjectFindings, a: Action, at: number): ProjectFindings {
  const out = structuredClone(pf)
  const list = out.findings
  const find = (id: string): Finding => {
    const found = list.find((x) => x.id === id)
    if (!found) throw new Error('That finding is no longer on the list.')
    return found
  }
  const inProgress = (x: Finding): Finding => {
    if (x.state !== 'progress' || !x.work) throw new Error("That finding isn't being worked on.")
    return x
  }
  const note = (x: Finding, text: string) => { x.history.push({ at, text }) }

  switch (a.type) {
    case 'keep':
      for (const x of a.ids.map(find)) if (x.state !== 'new') throw new Error('Only a new finding can be kept.')
      for (const x of a.ids.map(find)) { x.state = 'kept'; delete x.fresh; note(x, 'Kept') }
      break
    case 'close':
      for (const x of a.ids.map(find)) {
        if (x.state !== 'new' && x.state !== 'kept') throw new Error('Only New and Kept findings can be closed.')
      }
      for (const x of a.ids.map(find)) {
        x.state = 'closed'; delete x.fresh
        x.closed = a.why ? { reason: a.reason, why: a.why, at } : { reason: a.reason, at }
        note(x, `Closed: ${reasonWord[a.reason].toLowerCase()}`)
      }
      break
    case 'reopen': {
      const x = find(a.id)
      if (x.state !== 'closed' && x.state !== 'fixed') throw new Error('Only a closed or fixed finding can be reopened.')
      x.state = x.state === 'closed' ? 'new' : 'kept'
      delete x.closed; delete x.confirmed
      note(x, 'Reopened')
      break
    }
    case 'group': {
      const ids = [...new Set(a.ids)]
      if (ids.length < 2) throw new Error('Pick two or more findings to group.')
      if (!ids.includes(a.lead)) throw new Error('The lead has to be one of the findings you picked.')
      const picked = ids.map(find)
      if (new Set(picked.map((x) => x.state)).size > 1) throw new Error('Only findings in the same list can be grouped.')
      const lead = find(a.lead)
      // Grouping a group flattens it: the originals are carried over, never nested.
      const members = picked.flatMap((x) => structuredClone(x.members ?? [{ ...x, members: undefined }]))
      lead.members = members
      lead.reports = picked.flatMap((x) => x.reports).sort((p, q) => p.at - q.at)
      lead.severity = picked.reduce((s, x) => (severityRank(x.severity) > severityRank(s) ? x.severity : s), lead.severity)
      if (a.title) lead.title = a.title
      note(lead, `Grouped with ${ids.length - 1} other${ids.length > 2 ? 's' : ''}`)
      out.findings = list.filter((x) => x === lead || !ids.includes(x.id))
      break
    }
    case 'ungroup': {
      const g = find(a.id)
      if (!g.members?.length) throw new Error("That finding isn't a group.")
      // The group may have moved on since it was formed, so its state-bound marks go back onto every original.
      const back = g.members.map((m) => {
        const x: Finding = { ...m, state: g.state, history: [...m.history, { at, text: 'Ungrouped' }] }
        for (const k of CARRIED) { if (g[k] === undefined) delete x[k]; else Object.assign(x, { [k]: structuredClone(g[k]) }) }
        return x
      })
      list.splice(list.indexOf(g), 1, ...back)
      break
    }
    case 'seen':
      delete find(a.id).fresh
      break
    case 'issue': {
      const x = find(a.id)
      x.issue = { number: a.number, url: a.url }
      note(x, `Issue #${a.number} opened`)
      break
    }
    case 'discussion': {
      const x = find(a.id)
      x.discussion = a.chat
      note(x, 'Discussed')
      break
    }
    case 'work': {
      const x = find(a.id)
      if (x.state !== 'kept') throw new Error('Only a kept finding can be started.')
      x.state = 'progress'; x.work = a.work; delete x.reopened
      note(x, `Work started in ${a.work.branch}`)
      break
    }
    case 'pr': {
      const x = inProgress(find(a.id))
      if (!x.work!.pr) note(x, `PR #${a.pr.number} opened`)
      x.work!.pr = a.pr
      break
    }
    case 'merged': {
      const x = inProgress(find(a.id))
      if (a.pr) x.work!.pr = a.pr
      const pr = x.work!.pr
      if (pr) pr.state = 'merged'
      x.state = 'fixed'; x.fixedAt = at; delete x.confirmed
      note(x, pr ? `PR #${pr.number} merged` : `Merged into ${x.work!.base ?? 'the base branch'}`)
      break
    }
    case 'unwork': {
      const x = inProgress(find(a.id))
      x.state = 'kept'; delete x.work
      note(x, a.why)
      break
    }
  }
  return out
}
