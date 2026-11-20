import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { Config } from './config'

export type Runner = (cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }) =>
  Promise<{ code: number; stdout: string; stderr: string }>

export class ToolError extends Error {
  constructor(public cmd: string, public stderr: string, public code = 1) {
    super(`${cmd} failed: ${stderr.split('\n')[0]}`)
  }
}

export interface Tools {
  /** False when gh isn't installed: every gh method then throws. */
  hasGh: boolean
  /** Origin's URL; null when the repo has no origin. */
  remoteUrl(path: string): Promise<string | null>
  createWorktree(o: { projectPath: string; name: string; branch: string; base: string; setup: Config['setup'] }): Promise<void>
  /** Reset to the local `branch` as committed. */
  resetQa(path: string, branch: string): Promise<void>
  /** How many files in the checkout at `path` have changes that aren't committed, new files included. */
  uncommitted(path: string): Promise<number>
  createIssue(repo: string, title: string, body: string): Promise<{ number: number; url: string }>
  /** Closes the issue as not planned. */
  closeIssue(repo: string, number: number): Promise<void>
  /** The repo's main checkout for any of its worktrees; null when `path` isn't in a git repo. */
  mainCheckout(path: string): Promise<string | null>
  /** Orca's live terminals. */
  terminals(): Promise<{ handle: string; ptyId: string; worktreePath: string }[]>
  /** Orca's worktrees, with when each was last active. */
  worktrees(): Promise<{ path: string; lastActivityAt: number }[]>
  /** Starts a chat agent in a worktree and gives its Orca session id. */
  launchChat(o: { agent: string; worktreePath: string; prompt: string; focus?: boolean }): Promise<{ session: string }>
  /** The chat agents in a worktree. */
  chats(worktreePath: string): Promise<{ session: string; state: string; title: string }[]>
  sendToChat(session: string, subject: string, body: string): Promise<void>
  renameChat(session: string, name: string): Promise<void>
  /** The commit `ref` points to. */
  headOf(path: string, ref: string): Promise<string>
  /** Whether `branch` has moved off `start` and its head is now in origin's `base`. Throws when the fetch fails. */
  mergedInto(path: string, o: { branch: string; base: string; start: string }): Promise<boolean>
  /** The newest PR from `branch`, any state; null when there is none. */
  prForBranch(repo: string, branch: string): Promise<{ number: number; url: string; state: 'open' | 'merged' | 'closed' } | null>
}

const STATE = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' } as const
// An empty or relative path would run in the worker's own directory, so refuse before running anything.
const abs = (path: string) => {
  if (!isAbsolute(path)) throw new Error(`path must be absolute: "${path}"`)
}
const lastLine = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? ''

/** Why every gh method refuses when gh isn't installed. */
export const NO_GH = "GitHub's gh command isn't installed."

export function makeTools(run: Runner, paths: { orca: string; gh: string | null; git: string }): Tools {
  const gh = () => {
    if (paths.gh === null) throw new ToolError('gh', NO_GH)
    return paths.gh
  }
  const fail = (cmd: string, args: string[], r: { code: number; stderr: string }) =>
    new ToolError(`${cmd} ${args[0] === '-C' ? args[2] : args[0]}`, r.stderr, r.code)
  // Runs a command; a non-zero exit throws ToolError.
  const ok = async (cmd: string, args: string[], cwd?: string, timeoutMs?: number) => {
    const r = await run(cmd, args, cwd === undefined && timeoutMs === undefined ? undefined
      : { ...(cwd !== undefined && { cwd }), ...(timeoutMs !== undefined && { timeoutMs }) })
    if (r.code !== 0) throw fail(cmd, args, r)
    return r.stdout
  }
  // A git question: exit 0 is yes, 1 is no, anything else throws.
  const yesNo = async (args: string[]) => {
    const r = await run(paths.git, args)
    if (r.code === 0) return true
    if (r.code === 1) return false
    throw fail(paths.git, args, r)
  }
  const headOf = async (path: string, ref: string) => {
    abs(path)
    return (await ok(paths.git, ['-C', path, 'rev-parse', '--verify', ref])).trim()
  }
  return {
    hasGh: paths.gh !== null,
    async remoteUrl(path) {
      abs(path)
      const r = await run(paths.git, ['-C', path, 'remote', 'get-url', 'origin'])
      return r.code === 0 ? r.stdout.trim() || null : null
    },
    async createWorktree(o) {
      await ok(paths.orca, ['worktree', 'create', '--repo', `path:${o.projectPath}`, '--name', o.name, '--branch', o.branch,
        '--base-branch', o.base, '--setup', o.setup, '--no-parent', '--json'], undefined, 15 * 60_000)
    },
    async resetQa(path, branch) {
      abs(path)
      await ok(paths.git, ['reset', '--hard', branch], path)
    },
    async uncommitted(path) {
      abs(path)
      return (await ok(paths.git, ['status', '--porcelain'], path)).split('\n').filter(Boolean).length
    },
    async createIssue(repo, title, body) {
      const g = gh()
      // The body goes in a file so its length and characters never meet the command line.
      const dir = mkdtempSync(join(tmpdir(), 'studio-issue-'))
      try {
        const file = join(dir, 'body.md')
        writeFileSync(file, body)
        const url = lastLine(await ok(g, ['issue', 'create', '--repo', repo, '--title', title, '--body-file', file]))
        const m = /\/issues\/(\d+)$/.exec(url)
        if (!m) throw new ToolError(`${g} issue create`, `no issue URL in output: ${url}`)
        return { number: Number(m[1]), url }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    async closeIssue(repo, number) {
      await ok(gh(), ['issue', 'close', String(number), '--repo', repo, '--reason', 'not planned'])
    },
    async mainCheckout(path) {
      abs(path)
      const args = ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir']
      const r = await run(paths.git, args)
      // Git exits 128 for a folder outside any repo.
      if (r.code === 128) return null
      if (r.code !== 0) throw fail(paths.git, args, r)
      return dirname(r.stdout.trim())
    },
    async terminals() {
      const list: { handle: string; ptyId: string; worktreePath: string }[] = JSON.parse(await ok(paths.orca, ['terminal', 'list', '--json'])).result.terminals
      return list.map(({ handle, ptyId, worktreePath }) => ({ handle, ptyId, worktreePath }))
    },
    async worktrees() {
      const list: { path: string; lastActivityAt: number }[] = JSON.parse(await ok(paths.orca, ['worktree', 'list', '--json'])).result.worktrees
      return list.map(({ path, lastActivityAt }) => ({ path, lastActivityAt }))
    },
    async launchChat(o) {
      abs(o.worktreePath)
      const out = await ok(paths.orca, ['agent', 'launch', '--agent', o.agent, '--surface', 'chat', '--worktree', `path:${o.worktreePath}`,
        '--prompt', o.prompt, ...(o.focus ? ['--focus'] : []), '--json'])
      const session = JSON.parse(out)?.result?.outcome?.sessionId
      if (typeof session !== 'string' || !session) throw new ToolError(`${paths.orca} agent launch`, 'no session id in output')
      return { session }
    },
    async chats(worktreePath) {
      abs(worktreePath)
      const list: { orcaSessionId: string; kind: string; state: string; title?: string }[] =
        JSON.parse(await ok(paths.orca, ['agent', 'list', '--worktree', `path:${worktreePath}`, '--json'])).result.agents
      return list.filter((a) => a.kind === 'chat').map((a) => ({ session: a.orcaSessionId, state: a.state, title: a.title ?? '' }))
    },
    async sendToChat(session, subject, body) {
      await ok(paths.orca, ['orchestration', 'send', '--to', `orca_session_id:${session}`, '--subject', subject, '--body', body, '--json'])
    },
    async renameChat(session, name) {
      await ok(paths.orca, ['chat', 'rename', '--session', session, '--name', name])
    },
    headOf,
    async mergedInto(path, o) {
      abs(path)
      await ok(paths.git, ['-C', path, 'fetch', 'origin', o.base])
      const head = await headOf(path, o.branch)
      if (head === o.start) return false
      return yesNo(['-C', path, 'merge-base', '--is-ancestor', head, `origin/${o.base}`])
    },
    async prForBranch(repo, branch) {
      const rows: { number: number; url: string; state: string }[] = JSON.parse(await ok(gh(),
        ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'number,url,state', '--limit', '1']))
      if (rows.length === 0) return null
      const state = STATE[rows[0].state as keyof typeof STATE]
      if (!state) throw new ToolError(`${gh()} pr list`, `unknown pull request state: ${rows[0].state}`)
      return { number: Number(rows[0].number), url: String(rows[0].url), state }
    },
  }
}

// Never a shell. A non-zero exit resolves with its code; a spawn failure, signal or timeout (default 2 minutes)
// resolves with code -1. Git never stops to ask for a password: it fails instead.
export const nodeRunner: Runner = (cmd, args, opts) =>
  new Promise((resolve) => {
    const timeout = opts?.timeoutMs ?? 2 * 60_000
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    execFile(cmd, args, { cwd: opts?.cwd, maxBuffer: 10 * 1024 * 1024, timeout, env }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr })
      if (err.killed) return resolve({ code: -1, stdout, stderr: `${cmd} ${args[0] ?? ''} timed out after ${timeout / 1000} s.\n${stderr}` })
      resolve({ code: typeof err.code === 'number' ? err.code : -1, stdout, stderr: stderr || err.message })
    })
  })
