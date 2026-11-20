import { closeSync, copyFileSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, relative } from 'node:path'

// Copies by path only; never reads or prints a file's contents (these are things like .env).
export function copyInto(from: string, to: string, files: string[]): string[] {
  const missing: string[] = []
  for (const f of files) {
    const rel = relative(from, join(from, f))
    if (isAbsolute(f) || rel === '..' || rel.startsWith('../') || rel === '') {
      throw new Error('persona.studio: "copy" must name files inside the project')
    }
    if (!existsSync(join(from, rel))) { missing.push(f); continue }
    mkdirSync(dirname(join(to, rel)), { recursive: true })
    copyFileSync(join(from, rel), join(to, rel))
  }
  return missing
}

const free = (port: number) => new Promise<boolean>((done) => {
  const s = createServer()
  s.once('error', () => done(false))
  s.listen(port, '127.0.0.1', () => s.close(() => done(true)))
})

export async function freePort(base: number, taken: number[]): Promise<number> {
  for (let p = base; p < base + 100; p++) if (!taken.includes(p) && (await free(p))) return p
  throw new Error(`No free port from ${base} to ${base + 99}.`)
}

// The command comes from the project's committed config and runs through sh -c, on purpose.
export function startApp(o: { cwd: string; command: string; port: number; log: string }): number {
  const fd = openSync(o.log, 'a')
  try {
    const child = spawn('sh', ['-c', o.command.split('{port}').join(String(o.port))], {
      cwd: o.cwd, detached: true, stdio: ['ignore', fd, fd],
    })
    child.on('error', () => {}) // a failed spawn is reported by the missing pid, not by crashing the worker
    child.unref()
    if (child.pid === undefined) throw new Error(`Couldn't start the app: could not run "${o.command}" in ${o.cwd}.`)
    return child.pid
  } finally {
    closeSync(fd)
  }
}

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function stopApp(pid: number): Promise<void> {
  const signal = (s: 'SIGTERM' | 'SIGKILL' | 0) => { try { process.kill(-pid, s); return true } catch { return false } }
  if (!signal('SIGTERM')) return
  for (let i = 0; i < 50 && signal(0); i++) await sleep(100)
  signal('SIGKILL') // the leader may exit on SIGTERM while a child of the group keeps running
}

export async function waitForUrl(url: string, timeoutMs: number, pid: number): Promise<void> {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (!alive(pid)) throw new Error(`The app stopped before it answered at ${url}.`)
    try { await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(2000, end - Date.now()))) }); return } catch { /* not up yet */ }
    if (Date.now() >= end) throw new Error(`The app didn't answer at ${url} within ${Math.round(timeoutMs / 1000)} s.`)
    await sleep(500)
  }
}
