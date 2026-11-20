import { assert, test } from 'orca/testing'
import { landedWords, landRun, type LandInput } from './land'
import type { Finding, FindingState, ProjectFindings } from './model'
import type { Results } from './results'

const f = (id: string, state: FindingState, over: Partial<Finding> = {}): Finding =>
  ({ id, title: `T ${id}`, kind: 'bug', labels: [], severity: 'minor', state, reports: [], history: [], ...over })
const pf = (...findings: Finding[]): ProjectFindings => ({ v: 2, project: 'p', next: 5, findings })
const res = (ids: string[], over: Partial<Results> = {}, shots: string[] = []): Results => ({
  runId: 'r2', persona: 'dex', seed: 1, appCommit: 'c', clean: false, steps: [], goals: [], scores: {},
  findings: ids.map((id) => ({ id, kinds: ['ui'], severity: 'minor' as const, title: `Result ${id}`, step: 's', repro: 'one\n\n two \n', expected: 'ok', actual: 'bad', shots })), ...over
})
const input = (results: Results, matches: LandInput['matches'], over: Partial<LandInput> = {}): LandInput =>
  ({ persona: 'dex', name: 'Dex', runId: 'r2', startedAt: 100, recheck: [], results, resultsDir: '/qa/runs/r2', qaPath: '/qa', matches, ...over })
const one = (start: Finding, over: Partial<LandInput> = {}, r: Results = res(['a'])) =>
  landRun(pf(start), input(r, [{ finding: 'a', match: start.id }], over), 200)

test('an unmatched problem becomes a new finding with the report and history', () => {
  const { pf: out, landed } = landRun(pf(), input(res(['a']), [{ finding: 'a', match: null }]), 200)
  const n = out.findings[0]
  assert.equal(n.id, 'f5'); assert.equal(out.next, 6); assert.equal(n.fresh, true); assert.equal(n.state, 'new')
  assert.equal(n.kind, 'bug'); assert.deepEqual(n.labels, ['ui'])
  assert.deepEqual(n.history, [{ at: 200, text: 'Reported by Dex' }])
  assert.equal(n.reports[0].id, 'r2-a'); assert.equal(n.reports[0].saw, 'bad\n\nExpected: ok')
  assert.deepEqual(n.reports[0].steps, ['one', ' two '])
  assert.equal(landed.fresh, 1)
})
test('a match on New, Kept or Working adds the report, raises severity, says seen again', () => {
  for (const s of ['new', 'kept', 'progress'] as const) {
    const input0 = pf(f('f1', s, { fresh: true }))
    const r = res(['a']); r.findings[0].severity = 'major'
    const { pf: out, landed } = landRun(input0, input(r, [{ finding: 'a', match: 'f1' }]), 200)
    const x = out.findings[0]
    assert.equal(x.state, s); assert.equal(x.severity, 'major'); assert.equal(x.reports.length, 1)
    assert.equal(x.history.at(-1)?.text, 'Seen again by Dex'); assert.equal(x.fresh, true)
    assert.equal(landed.again, 1); assert.equal(input0.findings[0].reports.length, 0)
  }
})
test('a match on Closed adds the report and stays closed, not fresh', () => {
  const { pf: out, landed } = one(f('f1', 'closed', { closed: { reason: 'duplicate', at: 1 } }))
  assert.equal(out.findings[0].state, 'closed'); assert.equal(out.findings[0].reports.length, 1)
  assert.equal(out.findings[0].fresh, undefined); assert.equal(landed.again, 1)
})
test('a match on Fixed that was being rechecked reopens it to Kept, keeping work and fixedAt', () => {
  const work = { worktreePath: 'w', branch: 'b', pr: { number: 3, url: 'u', state: 'merged' as const } }
  const { pf: out, landed } = one(f('f1', 'fixed', { work, fixedAt: 500, confirmed: { by: 'dex', runId: 'r1', at: 1 } }), { recheck: ['f1'] })
  const x = out.findings[0]
  assert.equal(x.state, 'kept'); assert.equal(x.confirmed, undefined); assert.deepEqual(x.work, work); assert.equal(x.fixedAt, 500)
  assert.deepEqual(x.reopened, { by: 'dex', runId: 'r2', note: 'bad\n\nExpected: ok', at: 200 })
  assert.equal(x.history.at(-1)?.text, 'Reopened: Dex still sees it')
  assert.deepEqual(landed, { fresh: 0, again: 0, confirmed: 0, reopened: 1 })
})
test('a match on a Confirmed fix reopens it even when not rechecked', () => {
  const { pf: out } = one(f('f1', 'fixed', { fixedAt: 500, confirmed: { by: 'dex', runId: 'r1', at: 1 } }))
  assert.equal(out.findings[0].state, 'kept'); assert.equal(out.findings[0].confirmed, undefined)
})
test('a match on Fixed not rechecked reopens only when the run started after the fix', () => {
  assert.equal(one(f('f1', 'fixed', { fixedAt: 50 })).pf.findings[0].state, 'kept')
  const { pf: out, landed } = one(f('f1', 'fixed', { fixedAt: 150 }))
  assert.equal(out.findings[0].state, 'fixed'); assert.equal(out.findings[0].reports.length, 1)
  assert.deepEqual(landed, { fresh: 0, again: 1, confirmed: 0, reopened: 0 })
})
test('a rechecked fix: still reopens with the note, fixed confirms, clean with no entry confirms, otherwise untouched', () => {
  const start = pf(f('f1', 'fixed'), f('f2', 'fixed'), f('f3', 'fixed'), f('f4', 'fixed'))
  const rechecks = [{ findingId: 'f1', result: 'still' as const, note: 'Yes, still.' }, { findingId: 'f2', result: 'fixed' as const, note: '' }]
  const recheck = ['f1', 'f2', 'f3', 'f4', 'f404']
  const a = landRun(start, input(res([], { rechecks, clean: true }), [], { recheck }), 200)
  assert.equal(a.pf.findings[0].state, 'kept'); assert.equal(a.pf.findings[0].reopened?.note, 'Yes, still.')
  assert.deepEqual(a.pf.findings[1].confirmed, { by: 'dex', runId: 'r2', at: 200 })
  assert.equal(a.pf.findings[1].history.at(-1)?.text, 'Confirmed by Dex')
  assert.equal(a.pf.findings[2].confirmed?.by, 'dex'); assert.equal(a.pf.findings[3].confirmed?.by, 'dex')
  assert.deepEqual(a.landed, { fresh: 0, again: 0, confirmed: 3, reopened: 1 })
  const b = landRun(start, input(res([], { rechecks }), [], { recheck }), 200)
  assert.equal(b.pf.findings[2].confirmed, undefined); assert.equal(b.pf.findings[3].state, 'fixed')
})
test('a report wins over a "fixed" verdict', () => {
  const r = res(['a'], { rechecks: [{ findingId: 'f1', result: 'fixed', note: '' }] })
  const { pf: out, landed } = landRun(pf(f('f1', 'fixed')), input(r, [{ finding: 'a', match: 'f1' }], { recheck: ['f1'] }), 200)
  assert.equal(out.findings[0].state, 'kept'); assert.equal(out.findings[0].confirmed, undefined); assert.equal(landed.confirmed, 0)
})
test('a recheck for a finding moved on or gone is skipped', () => {
  const { pf: out, landed } = landRun(pf(f('f1', 'kept')), input(res([], { clean: true }), [], { recheck: ['f1', 'f9'] }), 200)
  assert.equal(out.findings[0].confirmed, undefined); assert.deepEqual(landed, { fresh: 0, again: 0, confirmed: 0, reopened: 0 })
})
test('unknown match ids, missing entries and duplicate entries leave one report per reported problem', () => {
  const { pf: out, landed } = landRun(pf(f('f1', 'new')), input(res(['a', 'b', 'c']), [
    { finding: 'a', match: 'f999' }, { finding: 'c', match: 'f1' }, { finding: 'c', match: null }]), 200)
  assert.equal(out.findings.length, 3); assert.equal(out.findings.flatMap((x) => x.reports).length, 3)
  assert.equal(out.findings[0].reports.length, 1); assert.equal(landed.fresh, 2); assert.equal(out.next, 7)
})
test('two matches on one Fixed finding reopen it once', () => {
  const { pf: out, landed } = landRun(pf(f('f1', 'fixed')), input(res(['a', 'b']), [{ finding: 'a', match: 'f1' }, { finding: 'b', match: 'f1' }], { recheck: ['f1'] }), 200)
  assert.equal(out.findings[0].reports.length, 2); assert.equal(out.findings[0].history.length, 1); assert.equal(landed.reopened, 1)
})
test('a group is matched as one finding, its members untouched', () => {
  const m = f('f2', 'new')
  const { pf: out } = one(f('f1', 'new', { members: [m] }))
  assert.equal(out.findings[0].reports.length, 1); assert.equal(out.findings[0].members?.[0].reports.length, 0)
})
test('shots stay inside the QA folder and must be png or jpg', () => {
  const shots = ['../../../../etc/passwd.png', '/tmp/x.png', 'shots/a.gif', 'shots/a.jpg']
  const { pf: out } = landRun(pf(), input(res(['a'], {}, shots), []), 200)
  assert.deepEqual(out.findings[0].reports[0].shots, ['/qa/runs/r2/shots/a.jpg'])
})
test('landedWords', () => {
  assert.equal(landedWords('Dex', { fresh: 2, again: 1, confirmed: 1, reopened: 1 }), "Dex's run is back. 2 new · 1 seen again · rechecked 2 fixes: 1 confirmed, 1 reopened")
  assert.equal(landedWords('Maya', { fresh: 0, again: 0, confirmed: 0, reopened: 0 }), "Maya's run is back. nothing new")
  assert.equal(landedWords('Maya', { fresh: 0, again: 0, confirmed: 1, reopened: 0 }), "Maya's run is back. nothing new · rechecked 1 fix: 1 confirmed")
})
test('a match only names a finding from before this run, not one this run just made', () => {
  const { pf: out, landed } = landRun(pf(), input(res(['a', 'b']), [{ finding: 'a', match: null }, { finding: 'b', match: 'f5' }]), 200)
  assert.deepEqual(out.findings.map((x) => [x.id, x.reports.length]), [['f5', 1], ['f6', 1]])
  assert.equal(landed.fresh, 2)
})
