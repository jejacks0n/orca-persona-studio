import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { CONFIG_FILE, listPersonas, parseConfig, portraitOf, promptOf, readConfig } from './config'
import { fixture, readJson } from './test-helpers'

const defaults = { personas: 'docs/personas', runsDir: 'qa-runs', resultsFile: 'results.json', setup: 'run', port: 4210,
  url: 'http://localhost:{port}', prepare: [], copy: [] }

test('no config at all gives the defaults, and nothing is required', () => {
  assert.deepEqual(parseConfig(undefined), defaults)
  assert.deepEqual(parseConfig({}), defaults)
})
test('a field of the wrong type is refused, naming the field', () => {
  assert.throws(() => parseConfig({ port: '4210' }), /"port" must be a number/)
  assert.throws(() => parseConfig({ prepare: 'npm i' }), /"prepare" must be a list/)
  assert.throws(() => parseConfig({ copy: [1] }), /"copy" must be a list/)
  assert.throws(() => parseConfig({ runsDir: 3 }), /"runsDir" must be a string/)
  assert.throws(() => parseConfig({ setup: 'sometimes' }), /setup/)
  assert.throws(() => parseConfig('nope'), /persona\.studio/)
  assert.throws(() => parseConfig({ builderBrief: 3 }), /persona\.studio: "builderBrief" must be a non-empty string/)
})
test('set fields override the defaults, and the three prompts are kept as written', () => {
  const c = parseConfig({ repo: 'a/b', start: 'npm start', port: 3000, prepare: ['npm i'], runPrompt: 'Use it.', reviewPrompt: 'r.md', builderBrief: 'x.md' })
  assert.equal(c.repo, 'a/b')
  assert.equal(c.start, 'npm start')
  assert.equal(c.port, 3000)
  assert.deepEqual(c.prepare, ['npm i'])
  assert.deepEqual([c.runPrompt, c.reviewPrompt, c.builderBrief], ['Use it.', 'r.md', 'x.md'])
})
test('readConfig reads persona.studio at the root: missing or blank is the defaults, a broken one throws with its path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-config-'))
  assert.equal(CONFIG_FILE, 'persona.studio')
  assert.deepEqual(readConfig(dir), defaults)
  writeFileSync(join(dir, 'persona.studio'), ' \n')
  assert.deepEqual(readConfig(dir), defaults)
  writeFileSync(join(dir, 'persona.studio'), '{ nope')
  assert.throws(() => readConfig(dir), new RegExp(join(dir, 'persona.studio').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')))
  writeFileSync(join(dir, 'persona.studio'), '{"port": 5000}')
  assert.equal(readConfig(dir).port, 5000)
})

test('a prompt is a file when it is one line ending in .md, else the text itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-prompt-'))
  mkdirSync(join(dir, 'docs/qa'), { recursive: true })
  writeFileSync(join(dir, 'docs/qa/run-prompt.md'), 'Run as {persona}.\n')
  assert.equal(promptOf(dir, 'runPrompt', 'docs/qa/run-prompt.md'), 'Run as {persona}.\n')
  assert.equal(promptOf(dir, 'runPrompt', 'my custom run prompt'), 'my custom run prompt')
  assert.equal(promptOf(dir, 'runPrompt', 'Read the notes.\nThen see docs/qa/run-prompt.md'), 'Read the notes.\nThen see docs/qa/run-prompt.md')
  assert.throws(() => promptOf(dir, 'reviewPrompt', 'docs/qa/missing.md'), /persona\.studio: "reviewPrompt" names docs\/qa\/missing\.md, which isn't there/)
  assert.throws(() => promptOf(dir, 'builderBrief', '../outside.md'), /persona\.studio: "builderBrief" must name a file inside the project/)
})

test('readConfig refuses a prompt file that is missing, so the mistake shows up front', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-prompt-'))
  writeFileSync(join(dir, 'persona.studio'), '{"runPrompt": "docs/qa/run-prompt.md"}')
  assert.throws(() => readConfig(dir), /"runPrompt" names docs\/qa\/run-prompt\.md/)
  writeFileSync(join(dir, 'persona.studio'), '{"runPrompt": "Just use the app."}')
  assert.equal(readConfig(dir).runPrompt, 'Just use the app.')
})
test('personas are the persona files, without _ files, named by their # heading', () => {
  const ps = listPersonas(fixture('project'), parseConfig(readJson(fixture('project/persona.studio'))))
  assert.deepEqual(ps.map((p) => [p.id, p.name]), [['dex', 'Dex'], ['maya', 'Maya']])
})
test('a heading splits into name and tag at the colon; no colon gives an empty tag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-personas-'))
  mkdirSync(join(dir, 'docs/personas'), { recursive: true })
  writeFileSync(join(dir, 'docs/personas/dex.md'), '# Dex: draws ANSI by hand\n\nbody\n')
  writeFileSync(join(dir, 'docs/personas/maya.md'), '# Maya\n')
  const ps = listPersonas(dir, parseConfig(undefined))
  assert.deepEqual(ps.map((p) => [p.id, p.name, p.tag]), [['dex', 'Dex', 'draws ANSI by hand'], ['maya', 'Maya', '']])
  assert.equal(ps[0].sheetPath, join(dir, 'docs/personas/dex.md'))
})
test('a persona\'s portrait is the .svg beside its file, as a data URL; none, or one too big, is no portrait', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-portrait-'))
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128"/></svg>'
  writeFileSync(join(dir, 'dex.md'), '# Dex\n')
  writeFileSync(join(dir, 'dex.svg'), svg)
  assert.equal(portraitOf(join(dir, 'dex.md')), `data:image/svg+xml;base64,${readFileSync(join(dir, 'dex.svg'), 'base64')}`)
  writeFileSync(join(dir, 'maya.md'), '# Maya\n')
  assert.equal(portraitOf(join(dir, 'maya.md')), undefined)
  writeFileSync(join(dir, 'walt.svg'), `<svg>${' '.repeat(64 * 1024)}</svg>`)
  assert.equal(portraitOf(join(dir, 'walt.md')), undefined)
})
test('a project with no personas folder has no personas', () => {
  assert.deepEqual(listPersonas(fixture('project/docs'), parseConfig({})), [])
})
