import { assert, test } from 'orca/testing'
import type { Finding } from './model'
import { NAME, slugOf, watchWork } from './work'

const f = (over: Partial<Finding['work'] & object> | null = {}): Finding => ({ id: 'f1', title: 'T', kind: 'bug', labels: [], severity: 'major',
  state: 'progress', reports: [], history: [], ...(over && { work: { worktreePath: '/w', branch: 'b', base: 'main', start: 'c0', ...over } }) })
const pr = (state: 'open' | 'merged' | 'closed', number = 7) => ({ number, url: `https://x/pull/${number}`, state })
const none = { pr: null, merged: false, gone: false }

test('slugOf drops stop words and one-letter words and keeps four', () => {
  assert.equal(slugOf('Enter on Set FG drops the selection instead of recoloring it'), 'enter-set-fg-drops')
  assert.equal(slugOf('!!! the a'), 'work')
  assert.ok(NAME.test('enter-set-fg') && !NAME.test('-x') && !NAME.test('A b') && !NAME.test('a'.repeat(64)))
})

test('watchWork picks the action for one Working finding, and null when nothing changed', () => {
  assert.equal(watchWork(f(), none), null)
  assert.deepEqual(watchWork(f(), { ...none, merged: true }), { type: 'merged', id: 'f1' })
  assert.deepEqual(watchWork(f(), { ...none, pr: pr('merged') }), { type: 'merged', id: 'f1', pr: pr('merged') })
  assert.deepEqual(watchWork(f(), { ...none, pr: pr('closed') }), { type: 'unwork', id: 'f1', why: 'PR #7 closed without merging' })
  assert.deepEqual(watchWork(f(), { ...none, pr: pr('open') }), { type: 'pr', id: 'f1', pr: pr('open') })
  assert.equal(watchWork(f({ pr: pr('open') }), { ...none, pr: pr('open') }), null)
  assert.deepEqual(watchWork(f(), { ...none, gone: true }), { type: 'unwork', id: 'f1', why: 'The worktree was removed with nothing merged' })
  // Merged wins over gone: a merged branch's worktree is usually removed.
  assert.equal(watchWork(f(), { ...none, merged: true, gone: true })?.type, 'merged')
  assert.equal(watchWork(f(null), none), null)
})
