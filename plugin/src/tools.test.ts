import { existsSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { makeTools, nodeRunner, ToolError, type Runner } from './tools'

const paths = { orca: 'orca', gh: 'gh', git: 'git' }
type Reply = { code?: number; stdout?: string; stderr?: string }
type Call = { cmd: string; args: string[]; cwd?: string; timeoutMs?: number }

// Records every call; replies come from `replies` in order (default: exit 0, no output).
function fake(replies: Reply[] = []) {
  const calls: Call[] = []
  const run: Runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd, ...(opts?.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }) })
    const r = replies[calls.length - 1] ?? {}
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  return { calls, tools: makeTools(run, paths) }
}

test('every gh method says gh is missing when there is no gh, and hasGh is false', async () => {
  const f = { calls: [] as Call[] }
  const tools = makeTools(async (cmd, args) => { f.calls.push({ cmd, args }); return { code: 0, stdout: '', stderr: '' } }, { ...paths, gh: null })
  assert.equal(tools.hasGh, false)
  const msg = /GitHub's gh command isn't installed\./
  await assert.rejects(tools.createIssue('a/b', 'T', 'B'), msg)
  await assert.rejects(tools.closeIssue('a/b', 3), msg)
  await assert.rejects(tools.prForBranch('a/b', 'feat'), msg)
  assert.deepEqual(f.calls, [])
  assert.equal(fake().tools.hasGh, true)
})

test('remoteUrl is origin\'s URL, null when there is no origin', async () => {
  const f = fake([{ stdout: 'git@github.com:a/b.git\n' }])
  assert.equal(await f.tools.remoteUrl('/w'), 'git@github.com:a/b.git')
  assert.deepEqual(f.calls, [{ cmd: 'git', args: ['-C', '/w', 'remote', 'get-url', 'origin'], cwd: undefined }])
  assert.equal(await fake([{ code: 2, stderr: 'error: No such remote' }]).tools.remoteUrl('/w'), null)
})

test('createWorktree runs orca worktree create with every flag, allowing it 15 minutes', async () => {
  const f = fake()
  await f.tools.createWorktree({ projectPath: '/p', name: 'n', branch: 'b', base: 'main', setup: 'run' })
  assert.deepEqual(f.calls, [{ cmd: 'orca', cwd: undefined, timeoutMs: 15 * 60_000, args: [
    'worktree', 'create', '--repo', 'path:/p', '--name', 'n', '--branch', 'b', '--base-branch', 'main', '--setup', 'run', '--no-parent', '--json'] }])
})

test('resetQa hard-resets to the local branch, whether or not origin has it', async () => {
  const f = fake()
  await f.tools.resetQa('/w', 'feat/x')
  assert.deepEqual(f.calls, [{ cmd: 'git', args: ['reset', '--hard', 'feat/x'], cwd: '/w' }])
})

test('uncommitted counts the files git status lists, new ones included', async () => {
  const f = fake([{ stdout: ' M src/a.ts\nA  src/b.ts\n?? notes.md\n' }, { stdout: '' }])
  assert.equal(await f.tools.uncommitted('/w'), 3)
  assert.equal(await f.tools.uncommitted('/w'), 0)
  assert.deepEqual(f.calls[0], { cmd: 'git', args: ['status', '--porcelain'], cwd: '/w' })
})

test('terminals and worktrees read orca\'s JSON lists', async () => {
  const t = fake([{ stdout: JSON.stringify({ ok: true, result: { terminals: [{ handle: 'term_1', ptyId: 'p1', worktreePath: '/w', title: 'x' }] } }) }])
  assert.deepEqual(await t.tools.terminals(), [{ handle: 'term_1', ptyId: 'p1', worktreePath: '/w' }])
  assert.deepEqual(t.calls, [{ cmd: 'orca', args: ['terminal', 'list', '--json'], cwd: undefined }])
  const w = fake([{ stdout: JSON.stringify({ ok: true, result: { worktrees: [{ path: '/w', lastActivityAt: 5, branch: 'refs/heads/main' }] } }) }])
  assert.deepEqual(await w.tools.worktrees(), [{ path: '/w', lastActivityAt: 5 }])
  assert.deepEqual(w.calls, [{ cmd: 'orca', args: ['worktree', 'list', '--json'], cwd: undefined }])
})

test('createIssue gives gh the body as a file, returns the number and URL, and removes the file afterward', async () => {
  const seen: { args: string[]; body: string; exists: boolean }[] = []
  const run: Runner = async (_cmd, args, _opts) => {
    const file = args[args.indexOf('--body-file') + 1]
    seen.push({ args, body: readFileSync(file, 'utf8'), exists: existsSync(file) })
    return { code: 0, stdout: 'Creating issue\nhttps://github.com/a/b/issues/3\n', stderr: '' }
  }
  assert.deepEqual(await makeTools(run, paths).createIssue('a/b', 'T', 'Line 1\n\nLine 2'), { number: 3, url: 'https://github.com/a/b/issues/3' })
  assert.equal(seen.length, 1)
  const [{ args, body }] = seen
  assert.equal(body, 'Line 1\n\nLine 2')
  assert.deepEqual(args.slice(0, 5), ['issue', 'create', '--repo', 'a/b', '--title'])
  assert.equal(args[5], 'T')
  assert.equal(args[6], '--body-file')
  assert.equal(args.length, 8)
  assert.equal(existsSync(args[7]), false)
})

test('createIssue removes the body file when gh fails', async () => {
  let file = ''
  const run: Runner = async (_cmd, args) => {
    file = args[args.indexOf('--body-file') + 1]
    return { code: 1, stdout: '', stderr: 'HTTP 502' }
  }
  await assert.rejects(makeTools(run, paths).createIssue('a/b', 'T', 'B'), /502/)
  assert.ok(file !== '')
  assert.equal(existsSync(file), false)
})

test('closeIssue closes the issue as not planned', async () => {
  const f = fake()
  await f.tools.closeIssue('a/b', 3)
  assert.deepEqual(f.calls, [{ cmd: 'gh', cwd: undefined, args: ['issue', 'close', '3', '--repo', 'a/b', '--reason', 'not planned'] }])
})

test('a non-zero exit throws ToolError with the first stderr line in the message', async () => {
  const f = fake([{ code: 2, stderr: 'boom\nmore detail\n' }])
  let err: any
  try { await f.tools.headOf('/w', 'HEAD') } catch (e) { err = e }
  assert.ok(err instanceof ToolError)
  assert.equal(err.message, 'git rev-parse failed: boom')
  assert.equal(err.stderr, 'boom\nmore detail\n')
  assert.equal(err.code, 2)
})

test('nodeRunner resolves a non-zero exit with its code and stdout', async () => {
  const r = await nodeRunner(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)'])
  assert.equal(r.code, 3)
  assert.equal(r.stdout, 'hi')
})

test('nodeRunner turns off git\'s terminal prompts', async () => {
  const r = await nodeRunner(process.execPath, ['-e', 'process.stdout.write(String(process.env.GIT_TERMINAL_PROMPT))'])
  assert.equal(r.stdout, '0')
})

test('nodeRunner stops a command that runs past its timeout and says so', async () => {
  const r = await nodeRunner(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 })
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /timed out/)
})

test('an empty or relative path is refused before any command runs', async () => {
  const f = fake()
  const bad = ['', 'relative/dir']
  for (const p of bad) {
    for (const call of [
      () => f.tools.resetQa(p, 'main'),
      () => f.tools.uncommitted(p),
      () => f.tools.changes(p),
      () => f.tools.mainCheckout(p),
      () => f.tools.headOf(p, 'HEAD'),
      () => f.tools.remoteUrl(p),
    ]) {
      let err: unknown
      try { await call() } catch (e) { err = e }
      assert.ok(err instanceof Error)
    }
  }
  assert.deepEqual(f.calls, [])
})

test('mainCheckout is the folder above git\'s common dir; null outside a git repo', async () => {
  const f = fake([{ stdout: '/src/app/.git\n' }])
  assert.equal(await f.tools.mainCheckout('/wt/app-qa'), '/src/app')
  assert.deepEqual(f.calls, [{ cmd: 'git', args: ['-C', '/wt/app-qa', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd: undefined }])
  assert.equal(await fake([{ code: 128, stderr: 'fatal: not a git repository' }]).tools.mainCheckout('/x'), null)
  let err: unknown
  try { await fake([{ code: -1, stderr: 'spawn git ENOENT' }]).tools.mainCheckout('/x') } catch (e) { err = e }
  assert.ok(err instanceof ToolError)
})

test('launchChat starts a chat agent and gives its session; --focus goes before --json', async () => {
  const out = JSON.stringify({ result: { outcome: { kind: 'structured', sessionId: 's1' } } })
  const f = fake([{ stdout: out }, { stdout: out }])
  assert.deepEqual(await f.tools.launchChat({ agent: 'claude', worktreePath: '/w', prompt: 'hi' }), { session: 's1' })
  await f.tools.launchChat({ agent: 'claude', worktreePath: '/w', prompt: 'hi', focus: true })
  assert.deepEqual(f.calls.map((c) => c.args), [
    ['agent', 'launch', '--agent', 'claude', '--surface', 'chat', '--worktree', 'path:/w', '--prompt', 'hi', '--json'],
    ['agent', 'launch', '--agent', 'claude', '--surface', 'chat', '--worktree', 'path:/w', '--prompt', 'hi', '--focus', '--json'],
  ])
  const bad = fake([{ stdout: JSON.stringify({ result: { outcome: { kind: 'error' } } }) }])
  await assert.rejects(bad.tools.launchChat({ agent: 'claude', worktreePath: '/w', prompt: 'hi' }), (e: unknown) => e instanceof ToolError)
})

test('chats lists a worktree\'s chat agents only', async () => {
  const agents = [
    { orcaSessionId: 'a', kind: 'chat', state: 'working', title: 'T' },
    { orcaSessionId: 'b', kind: 'terminal', state: 'idle', title: 'X' },
    { orcaSessionId: 'c', kind: 'chat', state: 'idle' },
  ]
  const f = fake([{ stdout: JSON.stringify({ result: { agents } }) }])
  assert.deepEqual(await f.tools.chats('/w'), [{ session: 'a', state: 'working', title: 'T' }, { session: 'c', state: 'idle', title: '' }])
  assert.deepEqual(f.calls[0].args, ['agent', 'list', '--worktree', 'path:/w', '--json'])
})

test('sendToChat and renameChat run their orca commands', async () => {
  const f = fake()
  await f.tools.sendToChat('s1', 'Subj', 'Body')
  await f.tools.renameChat('s1', 'Name')
  assert.deepEqual(f.calls.map((c) => c.args), [
    ['orchestration', 'send', '--to', 'orca_session_id:s1', '--subject', 'Subj', '--body', 'Body', '--json'],
    ['chat', 'rename', '--session', 's1', '--name', 'Name'],
  ])
})

test('headOf gives the trimmed commit', async () => {
  const f = fake([{ stdout: 'abc123\n' }])
  assert.equal(await f.tools.headOf('/w', 'br'), 'abc123')
  assert.deepEqual(f.calls[0].args, ['-C', '/w', 'rev-parse', '--verify', 'br'])
})

test('mergedInto is false without merge-base while the head is still the start', async () => {
  const f = fake([{}, { stdout: 'S\n' }])
  assert.equal(await f.tools.mergedInto('/w', { branch: 'br', base: 'main', start: 'S' }), false)
  assert.deepEqual(f.calls.map((c) => c.args), [['-C', '/w', 'fetch', 'origin', 'main'], ['-C', '/w', 'rev-parse', '--verify', 'br']])
})

test('mergedInto asks whether the head is an ancestor of origin\'s base; a failed fetch throws', async () => {
  const yes = fake([{}, { stdout: 'H\n' }, { code: 0 }])
  assert.equal(await yes.tools.mergedInto('/w', { branch: 'br', base: 'main', start: 'S' }), true)
  assert.deepEqual(yes.calls[2].args, ['-C', '/w', 'merge-base', '--is-ancestor', 'H', 'origin/main'])
  assert.equal(await fake([{}, { stdout: 'H' }, { code: 1 }]).tools.mergedInto('/w', { branch: 'br', base: 'main', start: 'S' }), false)
  await assert.rejects(fake([{ code: 128, stderr: 'fatal: unable to access' }]).tools.mergedInto('/w', { branch: 'br', base: 'main', start: 'S' }), (e: unknown) => e instanceof ToolError)
})

test('prForBranch gives null for no PR, else the PR with its state mapped', async () => {
  assert.equal(await fake([{ stdout: '[]' }]).tools.prForBranch('a/b', 'br'), null)
  const f = fake([{ stdout: JSON.stringify([{ number: 7, url: 'U', state: 'MERGED' }]) }])
  assert.deepEqual(await f.tools.prForBranch('a/b', 'br'), { number: 7, url: 'U', state: 'merged' })
  assert.deepEqual(f.calls[0].args, ['pr', 'list', '--repo', 'a/b', '--head', 'br', '--state', 'all', '--json', 'number,url,state', '--limit', '1'])
})
