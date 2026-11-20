import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'

export type Handler = (input: unknown) => Promise<unknown>
export interface WebRequest { method: string; path: string; headers: Record<string, string | undefined>; body: string }
export interface WebResponse { status: number; type: string; body: string }

const MAX_BODY = 1024 * 1024
const JSON_TYPE = 'application/json; charset=utf-8'
/** On every response: no other page (a persona's app under test, say) may frame this one and steer the owner's taps. */
const NO_FRAMES = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }

const fail = (status: number, code: string, message: string): WebResponse =>
  ({ status, type: JSON_TYPE, body: JSON.stringify({ error: { code, message } }) })

// The status for a handler's error code; anything it doesn't name is a 500.
const STATUS = new Map([['invalid_params', 400], ['not_found', 404]])

const hostOk = (host: string | undefined, port: number) => host === `localhost:${port}` || host === `127.0.0.1:${port}`

/** Answers one request: the Host check first, then POST /api/<name>, then GET files. */
export async function route(
  req: WebRequest,
  deps: { port: number; handlers: Map<string, Handler>; file(path: string): WebResponse | null },
): Promise<WebResponse> {
  if (!hostOk(req.headers.host, deps.port)) return fail(403, 'forbidden', 'Wrong host.')
  if (req.method === 'OPTIONS') return fail(403, 'forbidden', 'Not allowed.')
  if (req.path.startsWith('/api/')) {
    if (req.method !== 'POST') return fail(404, 'not_found', 'Not found.')
    if (req.headers['x-persona-studio'] !== '1') return fail(403, 'forbidden', 'Missing X-Persona-Studio header.')
    const handler = deps.handlers.get(req.path.slice(5))
    if (!handler) return fail(404, 'not_found', 'Not found.')
    if (req.body.length > MAX_BODY) return fail(400, 'invalid_params', 'The request body is too large.')
    let input: unknown
    try { input = JSON.parse(req.body) } catch { return fail(400, 'invalid_params', 'The request body is not JSON.') }
    try {
      return { status: 200, type: JSON_TYPE, body: JSON.stringify((await handler(input)) ?? null) }
    } catch (e) {
      const err = e as { code?: string; message?: string }
      const code = typeof err.code === 'string' ? err.code : 'internal'
      return fail(STATUS.get(code) ?? 500, code, String(err.message ?? 'Something went wrong.'))
    }
  }
  if (req.method === 'GET') return deps.file(req.path) ?? fail(404, 'not_found', 'Not found.')
  return fail(404, 'not_found', 'Not found.')
}

/** Listens on 127.0.0.1 only; GET /api/events is a server-sent event stream fed by broadcast. */
export function startWeb(opts: {
  port: number
  handlers: Map<string, Handler>
  file(path: string): WebResponse | null
  onError(err: { code?: string }): void
}): { broadcast(event: string, payload: unknown): void; close(): Promise<void>; port(): number } {
  const streams = new Set<ServerResponse>()
  let bound = opts.port
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const headers = req.headers
    if (req.method === 'GET' && path === '/api/events' && hostOk(headers.host, bound)) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...NO_FRAMES })
      res.write(': hi\n\n')
      streams.add(res)
      res.on('close', () => { streams.delete(res) })
      return
    }
    const send = (r: WebResponse) => {
      res.writeHead(r.status, { 'content-type': r.type, ...NO_FRAMES })
      res.end(r.body)
    }
    const decoder = new TextDecoder()
    let body = '', size = 0, over = false
    req.on('data', (chunk) => {
      size += chunk.byteLength
      if (over) {
        if (size > 32 * MAX_BODY) req.destroy() // a runaway upload; below that we drain it so the 400 reaches the client
        return
      }
      if (size > MAX_BODY) {
        over = true
        send(fail(400, 'invalid_params', 'The request body is too large.'))
        return
      }
      body += decoder.decode(chunk, { stream: true })
    })
    req.on('end', () => {
      if (over) return
      body += decoder.decode()
      route({ method: req.method ?? 'GET', path, headers, body }, { port: bound, handlers: opts.handlers, file: opts.file })
        .catch(() => fail(500, 'internal', 'Something went wrong.'))
        .then((r) => send(r))
        .catch(() => res.destroy())
    })
  })
  server.on('error', (err) => opts.onError(err))
  server.listen(opts.port, '127.0.0.1', () => {
    const a = server.address()
    if (a && typeof a === 'object') bound = a.port
  })
  return {
    broadcast(event, payload) {
      const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
      for (const s of [...streams]) {
        try { s.write(msg) } catch { streams.delete(s) }
      }
    },
    close: () => new Promise<void>((done) => {
      for (const s of streams) { try { s.end() } catch { /* already gone */ } }
      streams.clear()
      server.close(() => done())
    }),
    port: () => bound,
  }
}
