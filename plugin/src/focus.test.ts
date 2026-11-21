import { basename } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { makeFocus } from './focus'
import { makeTools, type Runner } from './tools'

/** A workspace.list answer of local worktrees, in order. Orca says `hostId: 'local'` for them. */
const local = (...ws: { name: string; path: string; branch: string }[]) =>
  ({ truncated: false, workspaces: ws.map((x, i) => ({ id: `ws${i}`, kind: 'worktree', hostId: 'local', ...x })) })
const focused = (displayName: string, branch: string, ...terminals: string[]) =>
  ({ branch, displayName, terminals: terminals.map((id) => ({ id })) })
const reply = (stdout: string) => ({ code: 0, stdout, stderr: '' })
/** `orca <x> list --json` answers with `lists[x]`, as Orca's envelope; git says each folder is its own repo unless `repoOf` says otherwise (null: outside git). */
async function setup(workspaces: ReturnType<typeof local>, lists: { terminal?: unknown[]; worktree?: unknown[] } = {}, repoOf: (path: string) => string | null = (p) => p, hold = false) {
  const run: Runner = async (_cmd, args) => {
    if (args.includes('--git-common-dir')) {
      const root = repoOf(args[1])
      return root === null ? { code: 128, stdout: '', stderr: 'fatal: not a git repository' } : reply(`${root}/.git\n`)
    }
    const kind = args[0] === 'terminal' || args[0] === 'worktree' ? args[0] : undefined
    return kind && args[1] === 'list' ? reply(JSON.stringify({ ok: true, result: { [`${kind}s`]: lists[kind] ?? [] } })) : reply('')
  }
  const tools = makeTools(run, { orca: 'orca', gh: null, git: 'git' })
  const logs: string[] = []
  // With `hold`, workspace.list answers only once `release` is called.
  let release!: () => void
  const gate = hold ? new Promise<void>((r) => { release = r }) : Promise.resolve()
  let orca!: OrcaWorkerApi
  await mountWorker({ default: (o: OrcaWorkerApi) => { orca = o } }, { host: mockHost({ results: { 'workspace.list': () => gate.then(() => workspaces) } }) })
  return { release, focus: makeFocus({ host: orca.host, tools: async () => tools, log: (l) => logs.push(l) }), logs }
}

test('focus is none with no focused workspace, or none local that matches, and says so in one short line', async () => {
  const { focus, logs } = await setup({ truncated: false, workspaces: [
    { id: 'r', kind: 'worktree', name: 'app', path: '/a', branch: 'main', hostId: 'ssh-1' },
    { id: 'l', kind: 'worktree', name: 'app', path: '/a', branch: 'other', hostId: 'local' }] } as ReturnType<typeof local>)
  assert.deepEqual(await focus.resolve(), { kind: 'none' })
  focus.set(null)
  assert.deepEqual(await focus.resolve(), { kind: 'none' })
  focus.set(focused('app', 'main'))
  assert.deepEqual(await focus.resolve(), { kind: 'none' })
  assert.deepEqual(logs.filter((l) => l.includes('no local workspace')), ['studio: no local workspace is "app" on main (1 local)'])
})

test('focus matches a local workspace by name and branch: a git worktree or notGit, at its own path', async () => {
  const { focus } = await setup(local({ name: 'a', path: '/plain', branch: 'main' }, { name: 'c', path: '/repo', branch: 'dev' }), {}, (p) => (p === '/plain' ? null : p))
  focus.set(focused('a', 'main'))
  assert.deepEqual(await focus.resolve(), { kind: 'notGit', name: 'a' }, 'by its name in Orca')
  focus.set(focused('c', 'dev'))
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: 'repo', path: '/repo', branch: 'dev' })
})

test('a worktree that is not the main checkout is named repo · worktree', async () => {
  const { focus } = await setup(local({ name: 'ux-revisions', path: '/wt', branch: 'jejacks0n/ux-revisions' }), {}, () => '/src/phosphor')
  focus.set(focused('ux-revisions', 'jejacks0n/ux-revisions'))
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: 'phosphor · ux-revisions', path: '/wt', branch: 'jejacks0n/ux-revisions' })
})

test('of several workspaces with the same name and branch, the focus is the one holding a focused terminal, by handle or pty id', async () => {
  const [a, b, c] = ['/a', '/b', '/c']
  const { focus } = await setup(local(...[a, b, c].map((path) => ({ name: 'main', path, branch: 'main' }))),
    { terminal: [{ handle: 'term_b', ptyId: 'pty-b', worktreePath: b }, { handle: 'term_c', ptyId: 'pty-c', worktreePath: c }] })
  focus.set(focused('main', 'main', 'term_b'))
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: basename(b), path: b, branch: 'main' })
  focus.set(focused('main', 'main', 'pty-c'))
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: basename(c), path: c, branch: 'main' })
})

test('of several matches with no terminal to go by, the focus is the most recently active; unknown terminal ids are logged once', async () => {
  const [a, b, c] = ['/a', '/b', '/c']
  const { focus, logs } = await setup(local(...[a, b, c].map((path) => ({ name: 'main', path, branch: 'main' }))),
    { terminal: [], worktree: [{ path: a, lastActivityAt: 1 }, { path: b, lastActivityAt: 3 }, { path: c, lastActivityAt: 2 }] })
  focus.set(focused('main', 'main'))
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: basename(b), path: b, branch: 'main' })
  focus.set(focused('main', 'main', 'mystery'))
  await focus.resolve()
  focus.set(focused('main', 'main', 'mystery', 'other'))
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: basename(b), path: b, branch: 'main' })
  assert.equal(logs.filter((l) => l.includes('mystery')).length, 1)
})

test('a context change while a resolve is pending doesn\'t change or break that resolve', async () => {
  const { focus, release } = await setup(local({ name: 'a', path: '/a', branch: 'main' }), {}, (p) => p, true)
  focus.set(focused('a', 'main'))
  const pending = focus.resolve()
  focus.set(null)
  release()
  assert.deepEqual(await pending, { kind: 'git', name: 'a', path: '/a', branch: 'main' })
  assert.deepEqual(await focus.resolve(), { kind: 'none' })
})

test('Orca\'s workspaceId picks the focus outright, even when another match is more recently active', async () => {
  const [a, b] = ['/a', '/b']
  const { focus } = await setup(local(...[a, b].map((path) => ({ name: 'main', path, branch: 'main' }))),
    { terminal: [], worktree: [{ path: a, lastActivityAt: 1 }, { path: b, lastActivityAt: 3 }] })
  focus.set({ ...focused('main', 'main'), workspaceId: 'ws0' })
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: basename(a), path: a, branch: 'main' })
  // An id Orca doesn't list (an older Orca, or a stale event) falls back to name and branch.
  focus.set({ ...focused('main', 'main'), workspaceId: 'gone' })
  assert.deepEqual(await focus.resolve(), { kind: 'git', name: basename(b), path: b, branch: 'main' })
})

test('a workspaceId naming a workspace on another host is no local focus, even if a local one shares its name', async () => {
  const { focus } = await setup({ truncated: false, workspaces: [
    { id: 'r', kind: 'worktree', name: 'main', path: '/remote', branch: 'main', hostId: 'ssh-1' },
    { id: 'l', kind: 'worktree', name: 'main', path: '/local', branch: 'main', hostId: 'local' }] } as ReturnType<typeof local>)
  focus.set({ ...focused('main', 'main'), workspaceId: 'r' })
  assert.deepEqual(await focus.resolve(), { kind: 'none' })
})
