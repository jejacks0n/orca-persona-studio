// The phone page's reach to the worker, over the Mac's localhost (src/web-server.ts), and the project it opens on.
// Pure, so it runs in tests; src/web.ts wires it to the page.
import type { Env } from './app-glue'

/** POST /api/<name> with the JSON input. A refusal rejects with its code, so failureOf shows the desktop's words. */
export function requestOver(fetchFn: typeof fetch): Env['request'] {
  return (async (name: string, input: unknown) => {
    let res: Response
    try {
      res = await fetchFn(`/api/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Persona-Studio': '1' },
        body: JSON.stringify(input ?? {}),
      })
    } catch {
      throw new Error("Persona Studio isn't answering. Is Orca running?")
    }
    if (res.ok) return res.json()
    const err = (await res.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null)?.error
    if (err && typeof err === 'object') throw Object.assign(new Error(String(err.message ?? res.statusText)), { code: err.code })
    throw new Error(res.statusText || `Persona Studio answered ${res.status}.`)
  }) as Env['request']
}

/** The project to open: the kept one while it's listed, else the first, else none. */
export const pickProject = (kept: string | null, projects: { id: string }[]): string | null =>
  projects.some((p) => p.id === kept) ? kept : projects[0]?.id ?? null

/** Follows the event stream's `error` and `open`: `back` runs on an open after an error (the stream reconnected, and
 *  what changed meanwhile wasn't heard), not on the first open. */
export function reconnects(back: () => void): { error(): void; open(): void } {
  let lost = false
  return {
    error() { lost = true },
    open() { if (lost) { lost = false; back() } },
  }
}
