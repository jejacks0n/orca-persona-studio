import { assert, test } from 'orca/testing'
import type { Finding } from './model'
import { closedText, DISCUSS_PROMPT, fill, goalsText, MATCH_PROMPT, PORTRAIT_PROMPT, recheckText, RUN_PROMPT, RUN_VARS, SETUP_PROMPT, SETUP_VARS, WORK_PROMPT } from './prompts'

const finding = (id: string, title: string, more: Partial<Finding> = {}): Finding =>
  ({ id, title, kind: 'bug', labels: [], severity: 'minor', state: 'fixed', reports: [], history: [], ...more })

test('fill replaces the names it has and leaves other braces', () => {
  assert.equal(fill('{a} {b}', { a: '1' }), '1 {b}')
})

test('every placeholder in each prompt is one it is filled with', () => {
  const prompts: [string, string, readonly string[]][] = [
    ['RUN_PROMPT', RUN_PROMPT, RUN_VARS],
    ['MATCH_PROMPT', MATCH_PROMPT, ['resultsPath', 'listPath', 'doneFile']],
    ['DISCUSS_PROMPT', DISCUSS_PROMPT, ['title', 'briefPath', 'notesPath']],
    ['WORK_PROMPT', WORK_PROMPT, ['what', 'findings', 'base', 'these', 'pr', 'fixes', 'builderBrief']]
  ]
  for (const [name, text, vars] of prompts) {
    const left = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !vars.includes(v))
    assert.deepEqual(left, [], `${name} has unfilled placeholders`)
  }
})

test('the run prompt names the browser flags, the Writing up stage, the done file and the rechecks', () => {
  for (const s of ['--format jpeg', '--page', '--scope isolated', 'Writing up', '{doneFile}', '{recheck}']) {
    assert.ok(RUN_PROMPT.includes(s), s)
  }
})

test('goalsText gives only the Goals section, Counted lines included', () => {
  const sheet = '# Maya\n## Goals\n- Open fast.\n  Counted: keys on open, target 3, lower is better.\n- Feels calm.\n## Script\n1. Open.\n'
  assert.equal(goalsText(sheet), '- Open fast.\n  Counted: keys on open, target 3, lower is better.\n- Feels calm.')
  assert.equal(goalsText('# Maya\n## Script\n1. Open.\n'), '')
})

test('closedText lists closed findings with their reason and why', () => {
  const list = [finding('f3', 'Title', { state: 'closed', closed: { reason: 'wontFix', why: 'too rare', at: 1 } }),
    finding('f4', 'Other', { state: 'closed', closed: { reason: 'notABug', at: 1 } }), finding('f5', 'Open', { state: 'kept' })]
  assert.equal(closedText(list.slice(0, 1)), "f3: Title (Won't fix: too rare)")
  assert.equal(closedText(list), "f3: Title (Won't fix: too rare)\nf4: Other (Not a bug)")
  assert.equal(closedText([finding('f5', 'Open', { state: 'kept' })]), '(none)')
})

test('recheckText gives one line per id, or (none)', () => {
  const list = [finding('f12', 'Help never opens'), finding('f13', 'Other')]
  assert.equal(recheckText(list, []), '(none)')
  assert.equal(recheckText(list, ['f12']), 'f12: Help never opens')
})

test('SETUP_PROMPT uses every setup var and says what setup must and mustn\'t do', () => {
  const names = new Set([...SETUP_PROMPT.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
  for (const n of names) assert.ok(n === 'port' || (SETUP_VARS as readonly string[]).includes(n), `${n} is not a setup var`)
  for (const v of SETUP_VARS) assert.ok(names.has(v), `${v} is never used`)
  const steps = ['Your app', 'Who uses it', 'Starting it', 'Save'].map((s) => SETUP_PROMPT.indexOf(s))
  assert.ok(steps.every((i, n) => i >= 0 && (n === 0 || i > steps[n - 1])), 'the four steps, in order')
  for (const s of ['{port}', 'Counted:', 'Measured:', '## Goals', '## Script', '## Known', 'Never print, log or commit',
    'Stop the app', 'commit nothing', 'CONTRACT.md', 'It is JSON, like {"start": "npm run dev -- --port {port}", "prepare": ["npm ci"], "copy": [".env"]}',
    'ask the owner before running one', 'The task is one word', 'the name in lowercase',
    // Setup suggests the personas; the owner picks, renames and changes them.
    'suggest five or six', 'which ones to keep', 'rename one',
    // It talks to the owner in plain words, and never stops on a promise of what comes next.
    'How to talk with the owner', "Never end a message by saying what you'll do next", 'the command you would type to run it yourself',
    // The owner sees outcomes and decisions, never settings: no JSON, commands or reasons unless they ask.
    "Don't show the owner the settings", "say what you'd pick", 'only if the owner asks',
    // A conversation of questions: short messages, each ending in one question.
    'Setup is a conversation: you ask, the owner answers', 'ends with one question', 'Ready to save']) {
    assert.ok(SETUP_PROMPT.includes(s), s)
  }
  const vars = { project: 'Demo', root: '/r', config: '/r/persona.studio', personas: 'docs/personas', trialPort: '4555' }
  const filled = fill(SETUP_PROMPT, vars)
  for (const n of Object.keys(vars)) assert.ok(!filled.includes(`{${n}}`), n)
  assert.ok(filled.includes('{port}'))
})

test('PORTRAIT_PROMPT says how to draw a portrait, and setup includes it', () => {
  assert.ok(!SETUP_PROMPT.includes('Ask the owner who uses it'), 'it suggests rather than asking the owner to come up with them')
  assert.ok(!/List the exact files and what goes in them/.test(SETUP_PROMPT), 'Save lists the files by name, not their contents')
  for (const dump of ['Sum up in a few lines', 'Show the drafts', 'what you drew and why']) assert.ok(!SETUP_PROMPT.includes(dump), `no ${dump}`)
  assert.ok(SETUP_PROMPT.includes(PORTRAIT_PROMPT))
  assert.ok(SETUP_PROMPT.includes('<id>.svg'))
  for (const s of ['pronouns', 'Age', 'never mock', 'viewBox="0 0 256 256"', '<title>', 'role="img"', 'no `script`', '12 KB']) {
    assert.ok(PORTRAIT_PROMPT.includes(s), s)
  }
  assert.deepEqual(PORTRAIT_PROMPT.match(/\{\w+\}/g), null)
})

test('SETUP_PROMPT makes personas for an app that isn\'t a web app, skips starting it, and points at the contract', () => {
  assert.ok(SETUP_PROMPT.includes('Do steps 1, 2 and 4, and skip step 3'))
  assert.ok(SETUP_PROMPT.includes('https://github.com/jejacks0n/orca-persona-studio/blob/main/plugin/CONTRACT.md'))
  assert.ok(!SETUP_PROMPT.includes('write nothing'), 'a non-web app still gets its personas')
})
