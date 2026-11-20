// The grammar Orca uses to color persona.studio as JSON (syntaxes/, contributed in orca-plugin.json).
import { fileURLToPath } from 'node:url'
import { assert, test } from 'orca/testing'
import { readJson } from './test-helpers'

type Rule = { match?: string; begin?: string; end?: string; patterns?: Rule[] }
const grammar = readJson(fileURLToPath(new URL('../syntaxes/persona-studio.tmLanguage.json', import.meta.url))) as { repository: Record<string, Rule> }
const rule = (name: string) => grammar.repository[name]
const whole = (re: string, text: string) => new RegExp(`^(?:${re})$`).test(text)

test('every pattern in the persona.studio grammar compiles', () => {
  const walk = (r: Rule): void => {
    for (const re of [r.match, r.begin, r.end]) if (re !== undefined) new RegExp(re)
    r.patterns?.forEach(walk)
  }
  Object.values(grammar.repository).forEach(walk)
})

test('the grammar reads JSON numbers, constants and escapes, and nothing else as them', () => {
  for (const n of ['0', '4210', '-1.5', '2e10', '1.5E-3']) assert.ok(whole(rule('number').match!, n), n)
  for (const n of ['01', '1.', '+1']) assert.equal(whole(rule('number').match!, n), false, n)
  for (const c of ['true', 'false', 'null']) assert.ok(whole(rule('constant').match!, c), c)
  for (const e of ['\\n', '\\"', '\\u00e9']) assert.ok(whole(rule('escape').match!, e), e)
  assert.equal(whole(rule('escape').match!, '\\x'), false)
})
