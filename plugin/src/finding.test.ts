import { assert, test } from 'orca/testing'
import { act, type Action } from './finding'
import type { Finding, FindingState, ProjectFindings, Report } from './model'
import type { Severity } from './types'

const report = (persona: string, at: number): Report =>
  ({ id: `${persona}-${at}`, persona, runId: 'r', at, saw: 'It broke.', steps: [], shots: [], severity: 'minor' as Severity, step: 's' })
const f = (id: string, state: FindingState, over: Partial<Finding> = {}): Finding =>
  ({ id, title: `Title ${id}`, kind: 'bug', labels: [], severity: 'minor', state, reports: [report('dex', 10)], history: [], ...over })
const pf = (...findings: Finding[]): ProjectFindings => ({ v: 2, project: 'p', next: 9, findings })

test('keep moves New to Kept, clears fresh and adds "Kept" to the history', () => {
  const out = act(pf(f('f1', 'new', { fresh: true })), { type: 'keep', ids: ['f1'] }, 50)
  assert.equal(out.findings[0].state, 'kept'); assert.equal(out.findings[0].fresh, undefined)
  assert.deepEqual(out.findings[0].history.at(-1), { at: 50, text: 'Kept' })
})
test('keep refuses anything not in New', () => {
  assert.throws(() => act(pf(f('f1', 'kept')), { type: 'keep', ids: ['f1'] }, 1), /Only a new finding can be kept/)
})
test('close takes New or Kept, records the reason and why, and writes "Closed: won\'t fix"', () => {
  const out = act(pf(f('f1', 'kept')), { type: 'close', ids: ['f1'], reason: 'wontFix', why: 'Covered elsewhere.' }, 60)
  assert.deepEqual(out.findings[0].closed, { reason: 'wontFix', why: 'Covered elsewhere.', at: 60 })
  assert.equal(out.findings[0].history.at(-1)?.text, "Closed: won't fix")
  assert.throws(() => act(pf(f('f1', 'progress')), { type: 'close', ids: ['f1'], reason: 'notABug' }, 1), /Only New and Kept findings can be closed/)
})
test('close ignores closeIssue: the result is the same with and without it', () => {
  const base: Action = { type: 'close', ids: ['f1'], reason: 'notABug' }
  const start = pf(f('f1', 'kept', { issue: { number: 4, url: 'u' } }))
  assert.deepEqual(act(start, { ...base, closeIssue: true }, 60), act(start, base, 60))
})
test('reopen sends Closed to New and Fixed to Kept, dropping closed and confirmed', () => {
  assert.equal(act(pf(f('f1', 'closed', { closed: { reason: 'duplicate', at: 1 } })), { type: 'reopen', id: 'f1' }, 2).findings[0].state, 'new')
  const fixed = act(pf(f('f1', 'fixed', { confirmed: { by: 'dex', runId: 'r', at: 1 } })), { type: 'reopen', id: 'f1' }, 2).findings[0]
  assert.equal(fixed.state, 'kept'); assert.equal(fixed.confirmed, undefined)
})
test('group folds the others into the lead: reports by time, highest severity, the new title, the originals kept', () => {
  const a = f('f1', 'new', { severity: 'minor' }), b = f('f2', 'new', { severity: 'major', reports: [report('priya', 5)] })
  const out = act(pf(a, b), { type: 'group', ids: ['f1', 'f2'], lead: 'f1', title: 'Both' }, 9)
  assert.equal(out.findings.length, 1)
  const g = out.findings[0]
  assert.equal(g.id, 'f1'); assert.equal(g.title, 'Both'); assert.equal(g.severity, 'major')
  assert.deepEqual(g.reports.map((r) => r.persona), ['priya', 'dex'])        // priya's report is earlier (at 5)
  assert.deepEqual(g.members?.map((m) => m.id), ['f1', 'f2'])
  assert.equal(g.history.at(-1)?.text, 'Grouped with 1 other')
})
test('group refuses one finding, a lead outside the set, and findings in different lists', () => {
  assert.throws(() => act(pf(f('f1', 'new')), { type: 'group', ids: ['f1', 'f1'], lead: 'f1' }, 1), /two or more/)
  assert.throws(() => act(pf(f('f1', 'new'), f('f2', 'new')), { type: 'group', ids: ['f1', 'f2'], lead: 'f9' }, 1), /lead/)
  assert.throws(() => act(pf(f('f1', 'new'), f('f2', 'kept')), { type: 'group', ids: ['f1', 'f2'], lead: 'f1' }, 1), /same list/)
})
test('grouping a group flattens it, and ungroup puts every original back in its old place in the list', () => {
  const once = act(pf(f('f1', 'new'), f('f2', 'new'), f('f3', 'new')), { type: 'group', ids: ['f1', 'f2'], lead: 'f1' }, 1)
  const twice = act(once, { type: 'group', ids: ['f1', 'f3'], lead: 'f3' }, 2)
  assert.deepEqual(twice.findings[0].members?.map((m) => m.id), ['f1', 'f2', 'f3'])
  assert.deepEqual(act(twice, { type: 'ungroup', id: 'f3' }, 3).findings.map((x) => x.id).sort(), ['f1', 'f2', 'f3'])
})
test('issue records the link and "Issue #12 opened"; seen clears fresh; an unknown id says so', () => {
  assert.deepEqual(act(pf(f('f1', 'kept')), { type: 'issue', id: 'f1', number: 12, url: 'https://example.test/12' }, 1).findings[0].issue, { number: 12, url: 'https://example.test/12' })
  assert.throws(() => act(pf(), { type: 'seen', id: 'nope' }, 1), /no longer on the list/)
})
test("ungroup carries the group's closed record, work and issue and fixed marks onto every original", () => {
  const closed = { reason: 'duplicate' as const, at: 1 }
  const c = act(pf(f('f1', 'closed', { closed }), f('f2', 'closed', { closed: { reason: 'wontFix', at: 2 } })), { type: 'group', ids: ['f1', 'f2'], lead: 'f1' }, 3)
  assert.deepEqual(act(c, { type: 'ungroup', id: 'f1' }, 4).findings.map((x) => x.closed), [closed, closed])
  const k = act(pf(f('f1', 'kept'), f('f2', 'kept')), { type: 'group', ids: ['f1', 'f2'], lead: 'f1' }, 1)
  const issue = { number: 12, url: 'https://example.test/12' }
  const back = act(act(k, { type: 'issue', id: 'f1', ...issue }, 2), { type: 'ungroup', id: 'f1' }, 3).findings
  assert.deepEqual(back.map((x) => x.issue), [issue, issue])
})

test('discussion records the chat and "Discussed"; an unknown id says so', () => {
  const out = act(pf(f('f1', 'new')), { type: 'discussion', id: 'f1', chat: 's1' }, 5)
  assert.equal(out.findings[0].discussion, 's1')
  assert.deepEqual(out.findings[0].history.at(-1), { at: 5, text: 'Discussed' })
  assert.throws(() => act(pf(f('f1', 'new')), { type: 'discussion', id: 'zz', chat: 's1' }, 5), /no longer on the list/)
})

test('work, pr, merged and unwork move a finding along its way', () => {
  const w = { worktreePath: '/w', branch: 'b', base: 'main', start: 'c0' }
  const started = act(pf({ ...f('f1', 'kept'), reopened: { by: 'maya', runId: 'r', note: 'n', at: 1 } }), { type: 'work', id: 'f1', work: w }, 5)
  assert.deepEqual([started.findings[0].state, started.findings[0].work, started.findings[0].reopened, started.findings[0].history.at(-1)?.text], ['progress', w, undefined, 'Work started in b'])
  assert.throws(() => act(pf(f('f1', 'new')), { type: 'work', id: 'f1', work: w }, 5), /Only a kept finding can be started\./)
  const open = { number: 4, url: 'u', state: 'open' as const }
  const withPr = act(started, { type: 'pr', id: 'f1', pr: open }, 6)
  assert.equal(withPr.findings[0].history.at(-1)?.text, 'PR #4 opened')
  assert.equal(act(withPr, { type: 'pr', id: 'f1', pr: { ...open, state: 'open' } }, 7).findings[0].history.length, withPr.findings[0].history.length)
  const fixed = act(withPr, { type: 'merged', id: 'f1', pr: { ...open, state: 'merged' } }, 8).findings[0]
  assert.deepEqual([fixed.state, fixed.fixedAt, fixed.confirmed, fixed.work?.pr?.state, fixed.history.at(-1)?.text], ['fixed', 8, undefined, 'merged', 'PR #4 merged'])
  assert.equal(act(started, { type: 'merged', id: 'f1' }, 8).findings[0].history.at(-1)?.text, 'Merged into main')
  assert.throws(() => act(pf(f('f1', 'kept')), { type: 'merged', id: 'f1' }, 8), /isn't being worked on/)
  const back = act(started, { type: 'unwork', id: 'f1', why: 'PR #4 closed without merging' }, 9).findings[0]
  assert.deepEqual([back.state, back.work, back.history.at(-1)?.text], ['kept', undefined, 'PR #4 closed without merging'])
})
