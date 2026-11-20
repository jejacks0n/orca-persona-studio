import { assert, test } from 'orca/testing'
import { advance, nextToMatch, stageWord } from './run'
import type { ActiveRun, RunStage } from './model'

const run = (stage: RunStage, over: Partial<ActiveRun> = {}): ActiveRun =>
  ({ id: 'r1', stage, at: 1, seed: 7, port: 5000, recheck: [], ...over })
const task = (role: 'run' | 'review' | 'match') => ({ id: 't', role, chat: 'c1' })
const qa = { path: '/qa', branch: 'b', workspaceId: 'w' }

test('preparing, prepared, launched(run) gives using', () => {
  const a = advance(run('preparing'), { type: 'prepared', qa, app: { pid: 9 } })
  assert.equal(a.stage, 'preparing'); assert.deepEqual(a.qa, qa); assert.deepEqual(a.app, { pid: 9 })
  assert.equal(advance(a, { type: 'launched', task: task('run') }).stage, 'using')
})
test('advance does not change its input', () => {
  const a = run('preparing'); advance(a, { type: 'prepared', qa })
  assert.deepEqual(a, run('preparing'))
})
test('launched(review) gives reviewing, results gives waiting with no task', () => {
  const a = advance(run('using', { task: task('run') }), { type: 'launched', task: task('review') })
  assert.equal(a.stage, 'reviewing')
  const b = advance(a, { type: 'results', path: '/r', at: 5 })
  assert.equal(b.stage, 'waiting'); assert.equal(b.task, undefined); assert.deepEqual(b.results, { path: '/r', at: 5 })
})
test('launched(match) from waiting gives matching; from using it is stale', () => {
  assert.equal(advance(run('waiting'), { type: 'launched', task: task('match') }).stage, 'matching')
  assert.throws(() => advance(run('using'), { type: 'launched', task: task('match') }), /stale/)
})
test('other stale events throw', () => {
  assert.throws(() => advance(run('using'), { type: 'prepared', qa }), /stale/)
  assert.throws(() => advance(run('using'), { type: 'launched', task: task('run') }), /stale/)
  assert.throws(() => advance(run('preparing'), { type: 'launched', task: task('review') }), /stale/)
  assert.throws(() => advance(run('matching'), { type: 'results', path: '/r', at: 1 }), /stale/)
})
test('ended marks the task only for its own chat; appStopped drops app', () => {
  const a = run('using', { task: task('run'), app: { pid: 1 } })
  assert.deepEqual(advance(a, { type: 'ended', chat: 'other', at: 9 }), a)
  assert.equal(advance(a, { type: 'ended', chat: 'c1', at: 9 }).task?.endedAt, 9)
  assert.deepEqual(advance(run('waiting'), { type: 'ended', chat: 'c1', at: 9 }), run('waiting'))
  assert.equal(advance(a, { type: 'appStopped' }).app, undefined)
})
test('stageWord covers every stage', () => {
  assert.equal(stageWord(run('preparing')), 'Preparing')
  assert.equal(stageWord(run('using')), 'Using the app')
  assert.equal(stageWord(run('using'), 'Writing up the report'), 'Writing up')
  assert.equal(stageWord(run('reviewing')), 'Writing up')
  assert.equal(stageWord(run('waiting')), 'Matching (waiting)')
  assert.equal(stageWord(run('matching')), 'Matching')
})
test('nextToMatch: null while matching, else the earliest results', () => {
  const w = (persona: string, at: number) => ({ persona, run: run('waiting', { results: { path: '/', at } }) })
  assert.equal(nextToMatch([w('a', 5), { persona: 'm', run: run('matching') }]), null)
  assert.equal(nextToMatch([w('a', 5), w('b', 2)]), 'b')
  assert.equal(nextToMatch([{ persona: 'x', run: run('waiting') }]), null)
})
