import { assert, test } from 'orca/testing'
import { connect } from 'node:net'
import { route, startWeb } from './web-server'
import type { Handler, WebRequest } from './web-server'

const handlers = new Map<string, Handler>([
  ['ping', async () => ({ ok: true })],
  ['refuse', async () => { throw Object.assign(new Error('No.'), { code: 'invalid_params' }) }],
  ['boom', async () => { throw new Error('Boom') }],
])
const file = (path: string) => (path === '/' ? { status: 200, type: 'text/html', body: '<p>hi</p>' } : null)
const deps = { port: 4747, handlers, file }
const req = (over: Partial<WebRequest> = {}): WebRequest => ({
  method: 'POST', path: '/api/ping', headers: { host: 'localhost:4747', 'x-persona-studio': '1' }, body: '{}', ...over,
})
const hdr = (host: string | undefined, extra: Record<string, string> = {}) => ({ host, ...extra })

test('route refuses another Host, and answers localhost and 127.0.0.1', async () => {
  assert.equal((await route(req({ headers: hdr('evil.com:4747', { 'x-persona-studio': '1' }) }), deps)).status, 403)
  assert.equal((await route(req({ headers: { 'x-persona-studio': '1' } }), deps)).status, 403)
  for (const host of ['localhost:4747', '127.0.0.1:4747']) {
    const r = await route(req({ headers: hdr(host, { 'x-persona-studio': '1' }) }), deps)
    assert.equal(r.status, 200)
    assert.equal(r.body, '{"ok":true}')
  }
})

test('route refuses an API request without X-Persona-Studio, and OPTIONS', async () => {
  assert.equal((await route(req({ headers: hdr('localhost:4747') }), deps)).status, 403)
  assert.equal((await route(req({ headers: hdr('localhost:4747', { 'x-persona-studio': '2' }) }), deps)).status, 403)
  assert.equal((await route(req({ method: 'OPTIONS' }), deps)).status, 403)
})

test('route answers an unknown request with 404, and a refusal with its code', async () => {
  assert.equal((await route(req({ path: '/api/nope' }), deps)).status, 404)
  assert.equal((await route(req({ path: '/api/__proto__' }), deps)).status, 404)
  const refused = await route(req({ path: '/api/refuse' }), deps)
  assert.equal(refused.status, 400)
  assert.equal(refused.body, '{"error":{"code":"invalid_params","message":"No."}}')
  const boom = await route(req({ path: '/api/boom' }), deps)
  assert.equal(boom.status, 500)
  assert.equal(JSON.parse(boom.body).error.code, 'internal')
})

test("route answers a body that isn't JSON, or is over 1 MB, with 400", async () => {
  for (const body of ['not json', '"' + 'x'.repeat(1024 * 1024) + '"']) {
    const r = await route(req({ body }), deps)
    assert.equal(r.status, 400)
    assert.equal(JSON.parse(r.body).error.code, 'invalid_params')
    assert.equal((await route(req(), deps)).status, 200)
  }
})

test('route answers undefined from a handler with null', async () => {
  const h = new Map<string, Handler>([['none', async () => undefined]])
  assert.equal((await route(req({ path: '/api/none' }), { ...deps, handlers: h })).body, 'null')
})

test('route maps odd error codes safely', async () => {
  const h = new Map<string, Handler>([['odd', async () => { throw Object.assign(new Error('x'), { code: 'constructor' }) }]])
  assert.equal((await route(req({ path: '/api/odd' }), { ...deps, handlers: h })).status, 500)
})

test('route serves GET through file(), and 404 when it has nothing', async () => {
  const get = (path: string) => route(req({ method: 'GET', path, headers: hdr('localhost:4747') }), deps)
  assert.equal((await get('/')).body, '<p>hi</p>')
  assert.equal((await get('/missing')).status, 404)
})

test('startWeb streams broadcasts, and drops a client that went away', async () => {
  const web = startWeb({ port: 0, handlers, file, onError: () => {} })
  for (let i = 0; i < 100 && web.port() === 0; i++) await new Promise((r) => setTimeout(r, 20))
  const base = `http://127.0.0.1:${web.port()}`
  const ctl = new AbortController()
  try {
    const res = await fetch(`${base}/api/events`, { signal: ctl.signal })
    assert.equal(res.headers.get('content-type'), 'text/event-stream')
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let text = ''
    web.broadcast('changed', { project: 'p' })
    while (!text.includes('data: {"project":"p"}')) {
      const { value, done } = await reader.read()
      if (done) break
      text += dec.decode(value)
    }
    assert.ok(text.startsWith(': hi'))
    assert.ok(text.includes('event: changed\ndata: {"project":"p"}'))
    const raw = await new Promise<string>((done) => {
      const sock = connect(web.port(), '127.0.0.1', () => sock.write('GET /api/events HTTP/1.1\r\nHost: evil.com\r\n\r\n'))
      sock.on('data', (c) => { sock.destroy(); done(new TextDecoder().decode(c)) })
    })
    assert.ok(raw.startsWith('HTTP/1.1 403'))
    const multi = await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'x-persona-studio': '1' }, body: '"' + 'é'.repeat(700000) + '"' })
    assert.equal(multi.status, 400)
    const bad = await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'x-persona-studio': '1' }, body: '{}' })
    assert.equal(bad.status, 200)
    const big = await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'x-persona-studio': '1' }, body: 'x'.repeat(2 * 1024 * 1024) })
    assert.equal(big.status, 400)
    assert.equal((await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'x-persona-studio': '1' }, body: '{}' })).status, 200)
    // A second client is still served after the first goes away. There's no observable for the drop itself without new API.
    const res2 = await fetch(`${base}/api/events`)
    const reader2 = res2.body!.getReader()
    await reader2.read() // ': hi'
    ctl.abort()
    await new Promise((r) => setTimeout(r, 100))
    web.broadcast('changed', { again: true })
    assert.ok(dec.decode((await reader2.read()).value).includes('data: {"again":true}'))
  } finally {
    await web.close()
  }
})

test('every response refuses to be framed: the shell, a module, the API and the event stream', async () => {
  const files = (path: string) => (path === '/src/web.js' ? { status: 200, type: 'text/javascript', body: '' } : file(path))
  const web = startWeb({ port: 0, handlers, file: files, onError: () => {} })
  for (let i = 0; i < 100 && web.port() === 0; i++) await new Promise((r) => setTimeout(r, 20))
  const base = `http://127.0.0.1:${web.port()}`
  const ctl = new AbortController()
  try {
    const answers = [await fetch(`${base}/`), await fetch(`${base}/src/web.js`), await fetch(`${base}/missing`),
      await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'x-persona-studio': '1' }, body: '{}' }),
      await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'x-persona-studio': '1' }, body: 'x'.repeat(2 * 1024 * 1024) }),
      await fetch(`${base}/api/events`, { signal: ctl.signal })]
    for (const r of answers) {
      assert.equal(r.headers.get('x-frame-options'), 'DENY', r.url)
      assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'none'", r.url)
    }
  } finally {
    ctl.abort()
    await web.close()
  }
})
