import { assert, test } from 'orca/testing'
import { isMet, series } from './goals'
import type { Goal, GoalResult, RunRecord } from './types'

const run = (runId: string, loop: number, goals: GoalResult[], input?: string): RunRecord =>
  ({ runId, loop, seed: 1, resultsPath: '', at: 0, goals, input })
const keys: Goal = { text: 'Sign up fast', measure: { metric: 'keys', task: 'sign up', target: 3, better: 'lower' } }
const stars: Goal = { text: 'Feels welcome', measure: { metric: 'taps', task: 'x', target: 5, better: 'higher' } }
const judged: Goal = { text: 'Feels calm' }

test('series keeps order and skips runs without a value', () => {
  const runs = [run('a', 1, [{ goal: keys.text, value: 45 }], 'x'), run('b', 1, []), run('c', 2, [{ goal: keys.text, value: 12 }])]
  assert.deepEqual(series(keys, runs), [
    { runId: 'a', loop: 1, value: 45, input: 'x' }, { runId: 'c', loop: 2, value: 12 }])
  assert.deepEqual(series(judged, runs), [])
})

test('isMet: counted goals compare the latest value with the target', () => {
  const at = (v: number) => [run('a', 1, [{ goal: keys.text, value: 99 }]), run('b', 2, [{ goal: keys.text, value: v }])]
  assert.equal(isMet(keys, at(3)), true); assert.equal(isMet(keys, at(4)), false)
  const hi = (v: number) => [run('a', 1, [{ goal: stars.text, value: v }])]
  assert.equal(isMet(stars, hi(5)), true); assert.equal(isMet(stars, hi(4)), false)
  assert.equal(isMet(keys, []), false)
  assert.equal(isMet(keys, [run('a', 1, [])]), false)
})

test('isMet: a judged goal is met only when the latest run says met', () => {
  const j = (a: 'met' | 'close', b: 'met' | 'close') =>
    [run('a', 1, [{ goal: judged.text, judgment: a }]), run('b', 2, [{ goal: judged.text, judgment: b }])]
  assert.equal(isMet(judged, j('close', 'met')), true); assert.equal(isMet(judged, j('met', 'close')), false)
})
