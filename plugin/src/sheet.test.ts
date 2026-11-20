import { assert, test } from 'orca/testing'
import { parseSheet } from './sheet'
import { fixture, read } from './test-helpers'

test('a counted goal parses its measure; a plain one is judged', () => {
  const s = parseSheet(read(fixture('project/docs/qa/personas/maya.md')))
  assert.deepEqual(s.goals[0].measure, { metric: 'keys', task: 'open-photo', target: 3, better: 'lower' })
  assert.equal(s.goals[1].measure, undefined)
})
test('Who is the paragraphs of its section, each on one line; none when there is no Who', () => {
  assert.deepEqual(parseSheet(read(fixture('project/docs/qa/personas/maya.md'))).who,
    ['Maya is a hobby photographer who edits on a tablet on the couch. She is patient with new tools but gives up on anything that needs a manual.'])
  assert.deepEqual(parseSheet('# Sam\n## Who\nOne\nline.\n\nTwo.\n## Goals\n- Fast.').who, ['One line.', 'Two.'])
  assert.deepEqual(parseSheet('# Sam\n## Goals\n- Fast.').who, [])
})
test('no Goals section never throws; a bad Counted line leaves the goal judged', () => {
  assert.deepEqual(parseSheet('# Sam\n## Script\n1. Go.').goals, [])
  const s = parseSheet('# Sam\n## Goals\n- Fast.\n  Counted: vibes on x, target lots.\n')
  assert.equal(s.goals[0].measure, undefined)
})
