import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { findingDir, mergeNotes, notesChangedSince, readNotes, writeBrief, writeNotes } from './finding-files'
import type { Finding, Report } from './model'

const proj = () => mkdtempSync(join(tmpdir(), 'studio-'))
const report = (id: string, persona: string, saw: string): Report => ({ id, persona, runId: 'r1', at: 1_700_000_000_000, saw,
  steps: ['Open the page', 'Tap Save'], shots: ['/shots/' + id + '.png'], severity: 'major', step: 'Save' })
const finding = (id: string, title: string): Finding => ({ id, title, kind: 'bug', labels: [], severity: 'major', state: 'new',
  reports: [report('a', 'maya', 'The button did nothing'), report('b', 'sam', 'Nothing saved')], history: [] })
const setMtime = (path: string, ms: number) => utimesSync(path, ms / 1000, ms / 1000)

test('findingDir is <files>/findings/<id>, outside the project', () => {
  assert.equal(findingDir('/files/app', 'f-1'), '/files/app/findings/f-1')
})

test('writeBrief writes finding.md with the title, both reports and their details, and rewrites it on a second call', () => {
  const p = proj()
  const path = writeBrief(p, finding('f-1', 'Save does nothing'), { maya: 'Maya Chen' })
  assert.equal(path, join(findingDir(p, 'f-1'), 'finding.md'))
  const text = readFileSync(path, 'utf8')
  for (const s of ['Save does nothing', 'bug', 'major', 'new', 'Maya Chen', 'sam', new Date(1_700_000_000_000).toISOString(),
    'The button did nothing', 'Nothing saved', 'Tap Save', '/shots/a.png']) assert.ok(text.includes(s), s)
  writeBrief(p, { ...finding('f-1', 'Renamed finding'), reports: [] }, {})
  const again = readFileSync(path, 'utf8')
  assert.ok(again.includes('Renamed finding') && !again.includes('Save does nothing'))
})

test('readNotes is empty and 0 when absent; writeNotes round-trips and returns the new mtime', () => {
  const p = proj()
  assert.deepEqual(readNotes(p, 'f-1'), { text: '', mtime: 0 })
  const { mtime } = writeNotes(p, 'f-1', 'Check the cart first', 0)
  assert.ok(mtime > 0)
  assert.deepEqual(readNotes(p, 'f-1'), { text: 'Check the cart first', mtime })
})

test('writeNotes with a stale base throws code conflict and leaves the file as it was', () => {
  const p = proj()
  writeNotes(p, 'f-1', 'mine', 0)
  const file = join(findingDir(p, 'f-1'), 'notes.md')
  setMtime(file, 1_700_000_000_000)
  const base = readNotes(p, 'f-1').mtime
  writeFileSync(file, 'an agent edited this')
  setMtime(file, 1_700_000_005_000)
  try {
    writeNotes(p, 'f-1', 'stale text', base)
    assert.fail('should have thrown')
  } catch (e) {
    const err = e as Error & { code?: string }
    assert.equal(err.code, 'conflict')
    assert.equal(err.message, 'The notes changed while you were typing. Copy your text, then reload them.')
  }
  assert.equal(readFileSync(file, 'utf8'), 'an agent edited this')
  // Writing a file that doesn't exist yet with a nonzero base is also stale.
  assert.throws(() => writeNotes(p, 'f-9', 'x', 123))
  assert.ok(!existsSync(join(findingDir(p, 'f-9'), 'notes.md')))
})

test('notesChangedSince names only the id whose notes changed after since; a missing file has not changed', () => {
  const p = proj()
  writeNotes(p, 'f-1', 'old', 0)
  writeNotes(p, 'f-2', 'new', 0)
  setMtime(join(findingDir(p, 'f-1'), 'notes.md'), 1_000_000)
  setMtime(join(findingDir(p, 'f-2'), 'notes.md'), 3_000_000)
  assert.deepEqual(notesChangedSince(p, ['f-1', 'f-2', 'f-3'], 2_000_000), ['f-2'])
})

test('mergeNotes puts non-empty notes under "From <title>:" in the lead file and skips empty ones', () => {
  const p = proj()
  writeNotes(p, 'lead', 'Lead note', 0)
  writeNotes(p, 'f-2', 'Check the cart', 0)
  writeNotes(p, 'f-3', '  \n', 0)
  mergeNotes(p, 'lead', [{ id: 'f-2', title: 'Cart bug' }, { id: 'f-3', title: 'Empty one' }, { id: 'f-4', title: 'No file' }])
  const text = readNotes(p, 'lead').text
  assert.ok(text.includes('Lead note'))
  assert.ok(text.includes('From Cart bug:') && text.includes('Check the cart'))
  assert.ok(!text.includes('From Empty one:') && !text.includes('From No file:'))
})
