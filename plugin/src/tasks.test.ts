import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { doneFilePath, progressFilePath, progressLines, progressNote, promptFile, readDone } from './tasks'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'studio-'))

test('doneFilePath is <dir>/tasks/<task>.json', () => {
  assert.equal(doneFilePath('/h/p', 'run-1'), '/h/p/tasks/run-1.json')
})

test('readDone: waiting with no file, bad for broken JSON, a non-object or an unreadable path, done for an object', () => {
  const dir = tmp()
  assert.deepEqual(readDone(dir, 'run-1'), { status: 'waiting' })
  mkdirSync(join(dir, 'tasks'), { recursive: true })
  writeFileSync(doneFilePath(dir, 'run-1'), '{"ok":')
  assert.deepEqual(readDone(dir, 'run-1'), { status: 'bad' })
  writeFileSync(doneFilePath(dir, 'run-1'), '[1]')
  assert.deepEqual(readDone(dir, 'run-1'), { status: 'bad' })
  writeFileSync(doneFilePath(dir, 'run-1'), '{"ok":true}')
  assert.deepEqual(readDone(dir, 'run-1'), { status: 'done', output: { ok: true } })
  // A read error other than "no such file" (here, a folder at the path) is bad, not waiting.
  mkdirSync(doneFilePath(dir, 'run-2'), { recursive: true })
  assert.deepEqual(readDone(dir, 'run-2'), { status: 'bad' })
})

test('promptFile keeps a long prompt in <dir>/prompts and answers a short pointer; progressNote makes the progress folder', () => {
  const dir = tmp()
  const long = 'x'.repeat(10_000)
  const pointer = promptFile(dir, 'run-1', long)
  const file = join(dir, 'prompts', 'run-1.md')
  assert.equal(pointer, `Read \`${file}\` and follow it exactly.`)
  assert.equal(readFileSync(file, 'utf8'), long)
  const progress = join(dir, 'progress', 'run-1.log')
  assert.equal(progressFilePath(dir, 'run-1'), progress)
  assert.ok(progressNote(dir, 'run-1').includes(`add one short line to \`${progress}\``))
  assert.ok(progressNote(dir, 'run-1').includes('begin each step\'s line with `Step <n> of <total>:`'))
  assert.ok(existsSync(join(dir, 'progress')))
})

test('progressLines: the last 5 non-empty lines, undefined with no file', () => {
  const dir = tmp()
  assert.equal(progressLines(dir, 'run-1'), undefined)
  progressNote(dir, 'run-1')
  writeFileSync(progressFilePath(dir, 'run-1'), Array.from({ length: 7 }, (_, i) => `line ${i + 1}`).join('\n') + '\n\n')
  const got = progressLines(dir, 'run-1')
  assert.deepEqual(got?.lines, ['line 3', 'line 4', 'line 5', 'line 6', 'line 7'])
  assert.deepEqual(progressLines(dir, 'run-1', 2)?.lines, ['line 6', 'line 7'])
  assert.ok((got?.at ?? 0) > 0)
})

test('every path and write stays in the files folder, never the project checkout', () => {
  const root = tmp(), project = join(root, 'project'), dir = join(root, 'files')
  mkdirSync(project, { recursive: true })
  mkdirSync(dir, { recursive: true })
  const note = progressNote(dir, 'a')
  const pointer = promptFile(dir, 'a', 'text')
  const paths = [doneFilePath(dir, 'a'), progressFilePath(dir, 'a'), join(dir, 'prompts', 'a.md')]
  for (const path of paths) assert.ok(path.startsWith(dir + '/'), `${path} is under ${dir}`)
  assert.ok(note.includes(dir) && !note.includes(project))
  assert.ok(pointer.includes(dir) && !pointer.includes(project))
  readDone(dir, 'a')
  progressLines(dir, 'a')
  assert.deepEqual(readdirSync(dir).sort(), ['progress', 'prompts'])
  assert.deepEqual(readdirSync(project), [])
})
