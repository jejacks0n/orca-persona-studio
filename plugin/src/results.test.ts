import { assert, test } from 'orca/testing'
import { parseResults } from './results'
import { fixture, readJson } from './test-helpers'

const mayaPath = fixture('project/qa-runs/2026-11-10-maya-503179919/results.json')

test('the Maya fixture parses', () => {
  const r = parseResults(readJson(mayaPath))
  assert.equal(r.findings.length, 4)
  assert.equal(r.findings.find((f) => f.id === '1-F8')?.severity, 'major')
})
test('problems are listed by path', () => {
  assert.throws(() => parseResults({ runId: 'x', findings: [{ id: 'F1', severity: 'huge' }] }),
    /findings\[0\]\.severity/)
})
test('a goal result has a value or a judgment, not neither', () => {
  const base = readJson(mayaPath) as Record<string, unknown>
  assert.throws(() => parseResults({ ...base, goals: [{ goal: 'x' }] }), /goals\[0\]/)
})
test('two findings with the same id are refused', () => {
  const base = readJson(mayaPath) as { findings: { id: string }[] }
  assert.throws(() => parseResults({ ...base, findings: [base.findings[0], base.findings[0]] }), /findings\[1\]\.id: "1-F1" is already used/)
})
const withFinding = (extra: Record<string, unknown>) => {
  const base = readJson(mayaPath) as { findings: Record<string, unknown>[] }
  return { ...base, findings: [{ ...base.findings[0], ...extra }] }
}
const withRechecks = (rechecks: unknown) => ({ ...(readJson(mayaPath) as Record<string, unknown>), rechecks })

test('a finding may carry a kind, and only a known one', () => {
  assert.equal(parseResults(withFinding({ kind: 'missing' })).findings[0].kind, 'missing')
  assert.throws(() => parseResults(withFinding({ kind: 'feature' })), /findings\[0\]\.kind: must be one of bug, missing, polish/)
})
test('rechecks parse, and each result is fixed or still', () => {
  assert.equal(parseResults(withRechecks([{ findingId: 'f12', result: 'fixed', note: '' }])).rechecks?.length, 1)
  assert.throws(() => parseResults(withRechecks([{ findingId: 'f12', result: 'maybe', note: '' }])), /rechecks\[0\]\.result: must be one of fixed, still/)
  assert.throws(() => parseResults(withRechecks('nope')), /rechecks: must be a list/)
})
