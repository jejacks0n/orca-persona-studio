import { assert, test } from 'orca/testing'
import { failureOf } from './app-logic'
import { pickProject, reconnects, requestOver } from './web-env'

const answer = (status: number, body: string, statusText = '') => (async () => new Response(body, { status, statusText })) as unknown as typeof fetch

test('requestOver sends the header and JSON, and resolves with the answer', async () => {
  const sent: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return new Response(JSON.stringify({ place: { tab: 'new' } }), { status: 200 })
  }) as unknown as typeof fetch
  const out = await requestOver(fetchFn)('place.get', { project: 'p1' })
  assert.deepEqual(out, { place: { tab: 'new' } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, '/api/place.get')
  assert.equal(sent[0].init.method, 'POST')
  assert.equal(new Headers(sent[0].init.headers).get('X-Persona-Studio'), '1')
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { project: 'p1' })
})

test('requestOver rejects with the refusal\'s code and message', async () => {
  const body = JSON.stringify({ error: { code: 'not_found', message: 'That finding is gone.' } })
  const e = await requestOver(answer(404, body))('finding.get', { project: 'p1', id: 'f1' }).then(() => null, (x: unknown) => x)
  assert.ok(e instanceof Error)
  assert.equal((e as Error & { code?: string }).code, 'not_found')
  assert.equal(failureOf(e).problem, 'That finding is gone.')
  // A timeout reads as one, as it does on the desktop.
  const t = await requestOver(answer(500, JSON.stringify({ error: { code: 'timeout', message: 'Timed out.' } })))('projects.list', undefined).then(() => null, (x: unknown) => x)
  assert.equal(failureOf(t).slow, true)
  // Not the refusal shape: a plain Error with the status text.
  const p = await requestOver(answer(502, 'Bad gateway', 'Bad Gateway'))('projects.list', undefined).then(() => null, (x: unknown) => x)
  assert.ok(p instanceof Error)
  assert.equal((p as Error).message, 'Bad Gateway')
})

test('requestOver says Persona Studio isn\'t answering when fetch fails', async () => {
  const down = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
  const e = await requestOver(down)('projects.list', undefined).then(() => null, (x: unknown) => x)
  assert.ok(e instanceof Error)
  assert.equal((e as Error).message, "Persona Studio isn't answering. Is Orca running?")
})

test('pickProject keeps a listed project, falls back to the first, or none', () => {
  const projects = [{ id: 'a' }, { id: 'b' }]
  assert.equal(pickProject('b', projects), 'b')
  assert.equal(pickProject('gone', projects), 'a')
  assert.equal(pickProject(null, projects), 'a')
  assert.equal(pickProject('b', []), null)
  assert.equal(pickProject(null, []), null)
})

test('an open after an error refreshes and re-asks projects; the first open and a repeated open don\'t', () => {
  let back = 0
  const stream = reconnects(() => { back++ })
  stream.open()
  assert.equal(back, 0)
  stream.error(); stream.error()
  stream.open()
  assert.equal(back, 1)
  stream.open()
  assert.equal(back, 1)
  stream.error(); stream.open()
  assert.equal(back, 2)
})
