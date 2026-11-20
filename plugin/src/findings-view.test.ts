import { assert, test } from 'orca/testing'
import { counts, kindOf, rows, toRow } from './findings-view'
import type { Finding, FindingState, Report } from './model'
import type { Severity } from './types'

const report = (persona: string, runId: string, at: number): Report =>
  ({ id: `${persona}-${runId}-${at}`, persona, runId, at, saw: 'It broke.', steps: [], shots: [], severity: 'minor' as Severity, step: 's' })
const f = (id: string, state: FindingState, over: Partial<Finding> = {}): Finding =>
  ({ id, title: `Title ${id}`, kind: 'bug', labels: [], severity: 'minor', state, reports: [report('dex', 'r1', 10)], history: [], ...over })

test('kindOf: polish label or severity first, then missing or feature, else bug', () => {
  assert.equal(kindOf(['polish', 'missing'], 'major'), 'polish')
  assert.equal(kindOf([], 'polish'), 'polish')
  assert.equal(kindOf(['Feature'], 'major'), 'missing')
  assert.equal(kindOf(['missing'], 'minor'), 'missing')
  assert.equal(kindOf(['crash'], 'blocker'), 'bug')
})
test('toRow lists distinct personas in first-report order and counts distinct runs', () => {
  const row = toRow(f('f1', 'new', { reports: [report('dex', 'r1', 1), report('dex', 'r2', 2), report('priya', 'r3', 3)] }))
  assert.deepEqual(row.personas, ['dex', 'priya'])
  assert.equal(row.runs, 3)
  assert.equal(row.reports, 3); assert.equal(row.latest, 3)
})
test('toRow carries pr, issue, confirmedBy, closedReason, members, reopened and fresh', () => {
  const row = toRow(f('f1', 'closed', {
    fresh: true, issue: { number: 7, url: 'u' }, confirmed: { by: 'dex', runId: 'r', at: 1 },
    closed: { reason: 'duplicate', at: 2 }, reopened: { by: 'dex', runId: 'r', note: 'n', at: 3 },
    work: { worktreePath: 'w', branch: 'b', pr: { number: 4, url: 'u', state: 'open' } },
    members: [f('a', 'new'), f('b', 'new')],
  }))
  assert.deepEqual(row.pr, { number: 4, state: 'open' }); assert.equal(row.issue, 7)
  assert.equal(row.confirmedBy, 'dex'); assert.equal(row.closedReason, 'duplicate')
  assert.equal(row.members, 2); assert.equal(row.reopened, true); assert.equal(row.fresh, true)
  const plain = toRow(f('f2', 'new'))
  assert.equal(plain.members, 0); assert.equal(plain.reopened, false); assert.equal(plain.fresh, false); assert.equal(plain.pr, undefined)
})
test('order: severity, then reopened, then most reports, then newest report', () => {
  const reopened = { by: 'dex', runId: 'r', note: 'n', at: 1 }
  const all = [
    f('plain', 'new'),
    f('reopenedMinor', 'new', { reopened }),
    f('major', 'new', { severity: 'major' }),
    f('two', 'new', { reports: [report('dex', 'r1', 1), report('dex', 'r2', 2)] }),
    f('newer', 'new', { reports: [report('dex', 'r1', 20)] }),
  ].map(toRow)
  assert.deepEqual(rows(all, { state: 'new' }).map((r) => r.id), ['major', 'reopenedMinor', 'two', 'newer', 'plain'])
})
test('filter combines persona, kind and q; counts follow the same filter and add up', () => {
  const all = [
    f('a', 'new', { title: 'Login Button', reports: [report('dex', 'r1', 1)] }),
    f('b', 'kept', { title: 'login form', reports: [report('dex', 'r1', 1)] }),
    f('c', 'new', { title: 'login lag', kind: 'polish', reports: [report('dex', 'r1', 1)] }),
    f('d', 'new', { title: 'login typo', reports: [report('priya', 'r1', 1)] }),
    f('e', 'closed', { title: 'Cart', reports: [report('dex', 'r1', 1)] }),
  ].map(toRow)
  const filter = { persona: 'dex', kind: 'bug' as const, q: 'LOGIN' }
  assert.deepEqual(rows(all, { state: 'new', ...filter }).map((r) => r.id), ['a'])
  const c = counts(all, filter)
  assert.deepEqual(c, { new: 1, kept: 1, progress: 0, fixed: 0, closed: 0 })
  assert.equal(Object.values(c).reduce((x, y) => x + y, 0), 2)
})
