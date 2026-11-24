import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from 'orca'
import { afterEach, assert, mockHost, mountWorker, test, type MockHost, type MockHostOptions, type TestWorker } from 'orca/testing'
import type { ActiveRun, Finding, PersonaRecord } from './model'
import { alive, startApp, stopApp } from './serve'
import { doneFilePath, progressFilePath } from './tasks'
import { fixture, read, until } from './test-helpers'
import type { Runner } from './tools'
import * as worker from './worker'

const cleanup: (() => unknown)[] = []
const hosts: MockHost[] = []
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
  // Every test stops any app it started, even on failure.
  for (const h of hosts.splice(0)) {
    for (const v of Object.values(h.data().storage)) {
      const pid = (v as Partial<PersonaRecord> | null)?.run?.app?.pid
      if (pid) await stopApp(pid)
    }
  }
})

const SERVER = `"${process.execPath}" -e "require('http').createServer((q,s)=>s.end('ok')).listen(+process.argv[1])" {port}`
let base = 47400
const settings = { agent: 'claude', orcaPath: 'orca', ghPath: 'gh', gitPath: 'git', prPollMinutes: 5 }
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as JsonValue
const listening = (port: number) => new Promise<boolean>((done) => {
  const s = createServer()
  s.once('error', () => done(true))
  s.listen(port, '127.0.0.1', () => s.close(() => done(false)))
})

/** A temp copy of fixtures/project as project "app" on main, with Maya and Dex. The fake runner makes each QA worktree
 *  as a folder Orca then lists, answers agent launches with sessions s1, s2 and so on, and says yes to everything else. */
async function setup(o: { config?: Record<string, unknown>; findings?: Finding[]; storage?: Record<string, JsonValue>; hold?: Promise<void>
  /** Held before answering the nth agent launch. */
  holdLaunch?: (n: number) => Promise<void> | undefined
  /** workspace.list names branches as refs/heads/<name>. */
  refs?: boolean
  /** What `git status --porcelain` says about the project's checkout: its uncommitted files. */
  status?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'studio-runs-')), root = `${dir}-files`, qaRoot = `${dir}-qa`
  cleanup.push(() => { for (const d of [dir, root, qaRoot]) rmSync(d, { recursive: true, force: true }) })
  cpSync(fixture('project'), dir, { recursive: true })
  base += 10
  writeFileSync(join(dir, 'persona.studio'), JSON.stringify({ personas: 'docs/qa/personas', port: base, url: 'http://127.0.0.1:{port}',
    start: SERVER, ...o.config }))
  worker.setFilesRoot(root)
  const calls: string[][] = [], made: { name: string; path: string; branch: string }[] = []
  /** `git diff HEAD --binary` in each copy: a reset clears it, and a prepare of `npm install` rewrites the lockfile. */
  const diffs: Record<string, string> = {}
  /** What `orca agent list` answers. */
  const agents: { orcaSessionId: string; kind: string; state: string }[] = []
  let sessions = 0
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })
  const runner: Runner = async (_cmd, args, opts) => {
    calls.push(args)
    if (args[0] === 'worktree' && args[1] === 'create') {
      await o.hold
      const at = (k: string) => args[args.indexOf(k) + 1], path = join(qaRoot, at('--name'))
      mkdirSync(path, { recursive: true })
      made.push({ name: at('--name'), path, branch: at('--branch') })
      return ok('{}')
    }
    // Each QA worktree's main checkout is the project.
    if (args.includes('--git-common-dir')) return ok(`${join(made.some((m) => m.path === args[1]) ? dir : args[1], '.git')}\n`)
    if (args[0] === 'agent' && args[1] === 'launch') {
      const n = ++sessions
      await o.holdLaunch?.(n)
      return ok(JSON.stringify({ result: { outcome: { sessionId: `s${n}` } } }))
    }
    if (args[0] === 'agent' && args[1] === 'list') return ok(JSON.stringify({ result: { agents } }))
    if (args[0] === 'status' && args[1] === '--porcelain') return ok(o.status ?? '')
    if (args[0] === 'reset') diffs[opts!.cwd!] = ''
    if (args[0] === '-c' && args[1] === 'npm install') diffs[opts!.cwd!] = LOCK
    if (args[0] === 'diff') return ok(diffs[opts!.cwd!] ?? '')
    return ok('')
  }
  worker.setRunner(runner)
  const opts = (storage: Record<string, JsonValue>): MockHostOptions => ({ storage, settings, results: {
    'workspace.list': () => ({ truncated: false, workspaces: [{ id: 'main', kind: 'worktree', hostId: 'local', name: 'app', path: dir, branch: 'main' },
      ...made.map((m, i) => ({ id: `qa${i}`, kind: 'worktree', hostId: 'local', ...m, branch: `${o.refs ? 'refs/heads/' : ''}${m.branch}` }))] }) } })
  const host = mockHost(opts({ projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }],
    'findings:app': json({ v: 2, project: 'app', next: (o.findings?.length ?? 0) + 1, findings: o.findings ?? [] }), ...o.storage }))
  const w = await mount(host)
  return { dir, files: join(root, 'app'), host, w, calls, made, opts, agents, diffs }
}
async function mount(host: MockHost): Promise<TestWorker> {
  hosts.push(host)
  const w = await mountWorker(worker, { host })
  cleanup.push(() => w.deactivate())
  return w
}

const recordOf = (host: MockHost, persona = 'maya') => host.data().storage[`record:app:${persona}`] as PersonaRecord | undefined
const runOf = (host: MockHost, persona = 'maya') => recordOf(host, persona)?.run
const rowOf = async (w: TestWorker, persona = 'maya') => (await w.request('overview.get', { project: 'app' })).personas.find((p) => p.id === persona)!
const launches = (calls: string[][]) => calls.filter((a) => a[0] === 'agent' && a[1] === 'launch')
const using = (host: MockHost, persona = 'maya') => until(() => runOf(host, persona)?.stage === 'using', `${persona}'s run chat`)
/** Launches and stops finish after the request answers, so these wait for what they check. */
const staged = (host: MockHost, stage: string, persona = 'maya') => until(() => runOf(host, persona)?.stage === stage, `${persona} ${stage}`)
const dead = (pid: number) => until(() => !alive(pid), `app ${pid} to stop`)
const saw = (calls: string[][], line: string) => until(() => calls.some((a) => a.join(' ') === line), line)
const start = (w: TestWorker, persona = 'maya', focus?: string) => w.request('run.start', { project: 'app', persona, ...(focus && { focus }) })

const finding = { id: 'F1', kinds: [], severity: 'major', title: 'The help never opens', step: '3. Read the help page',
  repro: 'Tap the i.', expected: 'The help shows.', actual: 'Nothing appears.', shots: [] }
/** Writes the run's results file in its folder in the QA worktree; answers its path. */
function results(run: ActiveRun, persona = 'maya'): string {
  const dir = join(run.qa!.path, 'qa-runs', run.id), path = join(dir, 'results.json')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify({ runId: run.id, persona, seed: run.seed, appCommit: 'abc', clean: true, steps: [], findings: [finding],
    goals: [], scores: {} }))
  return path
}
function done(files: string, taskId: string, v: unknown) {
  mkdirSync(join(files, 'tasks'), { recursive: true })
  writeFileSync(doneFilePath(files, taskId), typeof v === 'string' ? v : JSON.stringify(v))
}
const LOCK = 'diff --git a/package-lock.json b/package-lock.json\n-  "version": "1"\n+  "version": "2"\n'
const EDIT = 'diff --git a/docs/qa/personas/maya.md b/docs/qa/personas/maya.md\n+More about Maya.\n'
const NO_START = `Persona Studio doesn't know how to start this app yet. Set "start" in persona.studio, or set up personas.`
/** The fixture's own-harness prompts: a run prompt without {port}, and a review prompt. */
const harness = { start: undefined, runPrompt: 'docs/qa/run-prompt.md', reviewPrompt: 'docs/qa/review-prompt.md' }

test('uncommitted changes hold a run back with how many files have them; anyway starts it on the last commit', async () => {
  const { host, w, calls, made } = await setup({ status: ' M src/app.ts\n?? notes.md\n' })
  assert.deepEqual(await start(w), { uncommitted: 2 })
  assert.equal(runOf(host), undefined)
  assert.deepEqual(made, [])
  assert.deepEqual(await w.request('run.start', { project: 'app', persona: 'maya', anyway: true }), { ok: true })
  await using(host)
  // The persona's copy is reset to the local branch, never origin's.
  assert.ok(calls.some((a) => a.join(' ') === 'reset --hard main'))
  assert.equal(calls.some((a) => a.includes('fetch')), false)
  await w.request('run.stop', { project: 'app', persona: 'maya' })
})

test("a run resets what preparing left in the copy, but not a change made there after", async () => {
  const { host, w, calls, made, diffs } = await setup({ config: { prepare: ['npm install'] } })
  const resets = () => calls.filter((a) => a[0] === 'reset').length
  const again = async () => {
    assert.deepEqual(await start(w), { ok: true })
    await using(host)
    await w.request('run.stop', { project: 'app', persona: 'maya' })
  }
  await again()
  const qa = made[0].path
  assert.equal(diffs[qa], LOCK)
  // Its own rewritten lockfile doesn't hold the next run back.
  await again()
  assert.equal(resets(), 2)
  diffs[qa] = LOCK + EDIT
  assert.deepEqual(await start(w), { ok: true })
  await until(async () => (await rowOf(w)).error, "Maya's run to fail")
  assert.equal((await rowOf(w)).error, `Maya's copy (${qa}) has changes that aren't committed in 2 files. Commit or discard them there, then run again.`)
  assert.equal(resets(), 2)
  // Discarded, with new files left there, it runs again.
  diffs[qa] = ''
  await again()
  assert.equal(resets(), 3)
})

test('what preparing left in the copy is still reset after a run whose app never came up', async () => {
  const { w, calls } = await setup({ config: { prepare: ['npm install'], start: 'exit 1' } })
  for (const n of [1, 2]) {
    assert.deepEqual(await start(w), { ok: true })
    await until(async () => (await rowOf(w)).error, `run ${n} to fail`)
    assert.match((await rowOf(w)).error!, /^The app stopped before it answered/)
    assert.equal(calls.filter((a) => a[0] === 'reset').length, n)
  }
})

test('with worktrees off, a run uses the checkout as it is: no worktree, reset, copy or prepare, uncommitted changes and all, one persona at a time', async () => {
  const { dir, host, w, calls, made } = await setup({ config: { worktrees: false, copy: ['.env'], prepare: ['echo prepared > prepared.txt'] }, status: ' M src/app.ts\n' })
  writeFileSync(join(dir, '.env'), 'mine')
  assert.deepEqual(await start(w), { ok: true, inPlace: true })
  await using(host)
  assert.deepEqual(runOf(host)!.qa, { path: dir, branch: 'main', workspaceId: 'main' })
  assert.deepEqual(made, [])
  assert.equal(calls.some((a) => a.includes('reset') || (a[0] === 'worktree' && a[1] === 'create') || a.includes('--porcelain')), false)
  assert.equal(read(join(dir, '.env')), 'mine')
  assert.equal(existsSync(join(dir, 'prepared.txt')), false, 'prepare is skipped')
  assert.deepEqual(launches(calls)[0].slice(6, 8), ['--worktree', `path:${dir}`])
  // The run chat writes its run folder in the checkout.
  assert.ok(existsSync(join(dir, 'qa-runs', runOf(host)!.id)))
  const p = await w.request('persona.get', { project: 'app', persona: 'maya' })
  assert.equal(p.inPlace, true)
  await assert.rejects(start(w, 'dex'), /Runs use app's own checkout, so personas take turns\. Maya is running\./)
  await w.request('run.stop', { project: 'app', persona: 'maya' })
})

test('run.start makes the QA worktree, resets it, starts the app and launches the run chat', async () => {
  const { dir, files, host, w, calls, made } = await setup()
  assert.deepEqual(await start(w), { ok: true })
  await using(host)
  const run = runOf(host)!, qa = made[0].path
  const create = calls.find((a) => a[0] === 'worktree' && a[1] === 'create')!
  assert.deepEqual(create.slice(2, 10), ['--repo', `path:${dir}`, '--name', 'qa-maya', '--branch', 'studio/qa-maya', '--base-branch', 'main'])
  assert.ok(calls.some((a) => a.includes('reset') && a.includes('--hard')))
  const launch = launches(calls)[0]
  assert.deepEqual(launch.slice(0, 8), ['agent', 'launch', '--agent', 'claude', '--surface', 'chat', '--worktree', `path:${qa}`])
  assert.ok(calls.some((a) => a.join(' ') === "chat rename --session s1 --name Maya's run"))
  assert.deepEqual(run.qa, { path: qa, branch: 'studio/qa-maya', workspaceId: 'qa0' })
  assert.deepEqual(run.task, { id: `${run.id}-run`, role: 'run', chat: 's1' })
  assert.ok(run.app && alive(run.app.pid))
  assert.equal(await (await fetch(`http://127.0.0.1:${run.port}/`)).text(), 'ok')
  const promptText = read(join(files, 'prompts', `${run.id}-run.md`))
  assert.match(promptText, new RegExp(`port ${run.port}`))
  assert.match(promptText, /Recheck these fixes first\.[^\n]*\n\(none\)/)
  assert.ok(promptText.includes(join(qa, 'qa-runs', run.id)))
  assert.ok(promptText.includes(progressFilePath(files, run.id)))

  // The row and the persona say what the run is doing, from its newest progress line.
  writeFileSync(progressFilePath(files, run.id), 'Step 1 of 3: Open my photo\nWriting up\n')
  const posted = w.posts.length
  await w.request('tick')
  assert.ok(w.posts.slice(posted).some((p) => p.event === 'changed'))
  assert.deepEqual(await rowOf(w), { id: 'maya', name: 'Maya', tag: '', state: 'running', fresh: 0, runs: 0, recheck: 0,
    stage: 'Writing up', chat: "Maya's run", line: 'Writing up' })
  const d = await w.request('persona.get', { project: 'app', persona: 'maya' })
  assert.deepEqual([d.lines, d.branch, d.port], [['Step 1 of 3: Open my photo', 'Writing up'], 'studio/qa-maya', run.port])

  await w.request('run.stop', { project: 'app', persona: 'maya' })
  assert.equal(runOf(host), undefined)
  await dead(run.app.pid)
})

test('a run that names its results is matched and lands', async () => {
  const { files, host, w, calls } = await setup()
  await start(w)
  await using(host)
  const run = runOf(host)!, pid = run.app!.pid
  results(run)
  // Relative to the QA worktree's root.
  done(files, `${run.id}-run`, { ok: true, results: `qa-runs/${run.id}/results.json` })
  await w.request('tick')
  await staged(host, 'matching')
  await dead(pid)
  assert.equal(launches(calls).length, 2)
  const matchPrompt = read(join(files, 'prompts', `${run.id}-match.md`))
  assert.ok(matchPrompt.includes(join(files, 'runs', run.id, 'findings.json')))
  assert.ok(matchPrompt.includes(join(run.qa!.path, 'qa-runs', run.id, 'results.json')))
  assert.deepEqual(JSON.parse(read(join(files, 'runs', run.id, 'findings.json'))), [])

  done(files, `${run.id}-match`, { matches: [{ finding: 'F1', match: null }] })
  await w.request('tick')
  const { rows } = await w.request('findings.list', { project: 'app' })
  assert.deepEqual(rows.map((r) => [r.title, r.fresh]), [['The help never opens', true]])
  const rec = recordOf(host)!
  assert.equal(rec.run, undefined)
  assert.deepEqual(rec.runs.map((r) => [r.runId, r.loop, r.landed]), [[run.id, 1, { fresh: 1, again: 0, confirmed: 0, reopened: 0 }]])
  assert.deepEqual(w.posts.filter((p) => p.event === 'landed').map((p) => p.payload), [{ project: 'app', persona: 'maya', text: "Maya's run is back. 1 new" }])
})

test('two runs with results match one at a time', async () => {
  const fixed: Finding = { id: 'f1', title: 'Crop is slow', kind: 'bug', labels: [], severity: 'major', state: 'fixed', history: [],
    reports: [{ id: 'r1', persona: 'maya', runId: 'old', at: 1, saw: 'Slow', steps: [], shots: [], severity: 'major', step: '2.' }] }
  const { files, host, w, calls } = await setup({ findings: [fixed], config: { start: undefined, runPrompt: 'Run as {persona} on port {port}.' } })
  assert.equal((await rowOf(w)).recheck, 1)
  await start(w)
  await start(w, 'dex')
  await using(host)
  await using(host, 'dex')
  const maya = runOf(host)!, dex = runOf(host, 'dex')!
  assert.deepEqual([maya.recheck, dex.recheck], [['f1'], []])
  assert.notEqual(maya.port, dex.port)
  assert.equal(read(join(files, 'prompts', `${dex.id}-run.md`)).split('\n')[0], `Run as dex on port ${dex.port}.`)
  for (const [run, who] of [[maya, 'maya'], [dex, 'dex']] as const) done(files, `${run.id}-run`, { ok: true, results: results(run, who) })
  await w.request('tick')
  await staged(host, 'matching')
  assert.equal((await rowOf(w, 'dex')).stage, 'Matching (waiting)')
  assert.equal(launches(calls).length, 3)
  done(files, `${maya.id}-match`, { matches: [{ finding: 'F1', match: null }] })
  await w.request('tick')
  assert.equal(runOf(host), undefined)
  await staged(host, 'matching', 'dex')
  assert.equal(launches(calls).length, 4)
})

test('Stopping a matching run starts the next waiting match', async () => {
  const { files, host, w, calls } = await setup({ config: { start: undefined, runPrompt: 'Run on {port}.' } })
  await start(w)
  await start(w, 'dex')
  await using(host)
  await using(host, 'dex')
  for (const who of ['maya', 'dex']) done(files, `${runOf(host, who)!.id}-run`, { ok: true, results: results(runOf(host, who)!, who) })
  await w.request('tick')
  await staged(host, 'matching')
  assert.equal(runOf(host, 'dex')!.stage, 'waiting')
  await w.request('run.stop', { project: 'app', persona: 'maya' })
  await saw(calls, "chat rename --session s3 --name Stopped: Maya's run")
  await staged(host, 'matching', 'dex')
  assert.equal(launches(calls).length, 4)
})

test('an own-harness run prompt without {port} runs one persona at a time', async () => {
  const { host, w } = await setup({ config: harness })
  await start(w)
  const refused = (persona: string, text: string) => assert.rejects(start(w, persona), (e: any) => e.code === 'invalid_params' && e.message === text)
  await refused('dex', "app's run prompt doesn't use {port}, so its personas run one at a time. Maya is running.")
  await refused('maya', 'Maya is already running.')
  await refused('zed', 'There\'s no persona "zed" in app.')
  await using(host)
})

test('with no start and no runPrompt, run.start refuses', async () => {
  const { dir, host, w } = await setup({ config: { start: undefined } })
  await assert.rejects(start(w), (e: any) => e.code === 'invalid_params' && e.message === NO_START)
  assert.equal((await w.request('overview.get', { project: 'app' })).canRun, NO_START)
  assert.equal(recordOf(host), undefined)
  writeFileSync(join(dir, 'persona.studio'), '{"port": "high"}')
  await assert.rejects(start(w), (e: any) => e.code === 'invalid_params' && /"port" must be a number/.test(e.message))
  assert.match((await w.request('overview.get', { project: 'app' })).canRun!, /"port" must be a number/)
})

test('a review prompt runs a reviewer between the run and the matcher', async () => {
  const { files, host, w, calls } = await setup({ config: harness })
  await start(w, 'maya', 'the crop tool')
  await using(host)
  const run = runOf(host)!
  assert.equal(run.focus, 'the crop tool')
  assert.equal(run.app, undefined)
  done(files, `${run.id}-run`, { ok: true })
  await w.request('tick')
  await staged(host, 'reviewing')
  assert.deepEqual(runOf(host)!.task, { id: `${run.id}-review`, role: 'review', chat: 's2' })
  assert.match(read(join(files, 'prompts', `${run.id}-review.md`)), /^Review the findings from the last run\./)
  assert.equal(launches(calls).length, 2)
  done(files, `${run.id}-review`, { ok: true, results: results(run) })
  await w.request('tick')
  await staged(host, 'matching')
  assert.equal(launches(calls).length, 3)
})

test('a run without a reviewer that names no results, or a bad done or results file, fails the run in words', async () => {
  const { files, host, w, made } = await setup({ config: { start: undefined, runPrompt: 'Run on {port}.' } })
  const failsWith = async (write: (run: ActiveRun) => void, text: string | RegExp) => {
    await start(w)
    await using(host)
    write(runOf(host)!)
    await w.request('tick')
    const row = await rowOf(w)
    assert.equal(row.state, 'idle')
    if (typeof text === 'string') assert.equal(row.error, text)
    else assert.match(row.error!, text)
  }
  await failsWith((run) => done(files, `${run.id}-run`, { ok: true }), "Maya's run finished without naming its results file.")
  await failsWith((run) => done(files, `${run.id}-run`, { ok: false, error: 'The app never loaded.' }), 'The app never loaded.')
  await failsWith((run) => done(files, `${run.id}-run`, '{"ok": tr'), /^The done file .*-run\.json doesn't read\.$/)
  await failsWith((run) => {
    const path = results(run)
    writeFileSync(path, '{"runId": 1}')
    done(files, `${run.id}-run`, { ok: true, results: path })
  }, /^The results file .*results\.json doesn't read: runId: must be a string/)
  // A parse error never quotes the file.
  await failsWith((run) => {
    const path = results(run)
    writeFileSync(path, 'SECRET=hunter2')
    done(files, `${run.id}-run`, { ok: true, results: path })
  }, /^The results file .*results\.json isn't JSON\.$/)
  // Nor is a file outside the run's folder read at all.
  await failsWith((run) => {
    writeFileSync(join(run.qa!.path, '.env'), 'SECRET=hunter2')
    done(files, `${run.id}-run`, { ok: true, results: '.env' })
  }, `The results file ${join(made[0].path, '.env')} isn't in this run's folder.`)
})

test('a turn that ends without a done file fails after 30 s', async () => {
  const { host, w } = await setup()
  cleanup.push(() => worker.setNow(() => Date.now()))
  await start(w)
  await using(host)
  const pid = runOf(host)!.app!.pid, t0 = Date.now()
  worker.setNow(() => t0)
  // Another chat's turn says nothing about this one.
  await w.emit('agent.status.changed', { workspaceId: null, paneKey: 'structured-agent-session-s10:0', state: 'done', receivedAt: t0 })
  assert.equal(runOf(host)!.task!.endedAt, undefined)
  await w.emit('agent.status.changed', { workspaceId: null, paneKey: 'structured-agent-session-s1:0', state: 'done', receivedAt: t0 })
  assert.equal(runOf(host)!.task!.endedAt, t0)
  worker.setNow(() => t0 + 30_000)
  await w.request('tick')
  assert.equal((await rowOf(w)).state, 'running')
  worker.setNow(() => t0 + 31_000)
  await w.request('tick')
  const row = await rowOf(w)
  assert.equal(row.state, 'idle')
  assert.equal(row.error, "Maya's run agent finished without writing its done file.")
  await dead(pid)
})

test('Stop while preparing discards the run, and nothing after the worktree create runs', async () => {
  let release!: () => void
  const { files, host, w, calls } = await setup({ hold: new Promise<void>((r) => { release = r }), config: { prepare: ['true'] } })
  await start(w)
  await until(() => calls.some((a) => a[1] === 'create'), 'the worktree create')
  const { port, id } = runOf(host)!
  await w.request('run.stop', { project: 'app', persona: 'maya' })
  assert.equal(runOf(host), undefined)
  // Run again while that preparing is still at work in the same QA copy is refused.
  await assert.rejects(start(w), (e: any) => e.code === 'invalid_params' && e.message === "Maya's last run is still stopping. Try again in a moment.")
  release()
  await until(() => w.logs.some((l) => /dropped what it started/.test(l)), 'the preparing to stop')
  assert.equal(launches(calls).length, 0)
  assert.equal(calls.some((a) => a.includes('reset') || a[0] === '-c'), false)
  assert.equal(existsSync(join(files, 'runs', id, 'app.log')), false)
  assert.equal(await listening(port), false)
  assert.equal(recordOf(host)!.error, undefined)
  // Once it has stopped, Run works again, in the same copy.
  await start(w)
  await using(host)
  assert.equal(calls.filter((a) => a[1] === 'create').length, 1)
})

test('a matcher launch holds no request up, and a tick meanwhile launches nothing more', async () => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  const { files, host, w, calls } = await setup({ config: { start: undefined, runPrompt: 'Run on {port}.' }, holdLaunch: (n) => (n === 2 ? held : undefined) })
  await start(w)
  await using(host)
  const run = runOf(host)!
  done(files, `${run.id}-run`, { ok: true, results: results(run) })
  await w.request('tick')
  await until(() => launches(calls).length === 2, 'the matcher launch')
  assert.deepEqual((await w.request('findings.list', { project: 'app' })).rows, [])
  await w.request('tick')
  assert.equal(launches(calls).length, 2)
  assert.equal(runOf(host)!.stage, 'waiting')
  release()
  await staged(host, 'matching')
  assert.equal(runOf(host)!.task!.chat, 's2')
})

test('a QA worktree Orca lists as refs/heads/studio/qa-maya is found, and kept for the next run', async () => {
  const { host, w, calls } = await setup({ refs: true, config: { start: undefined, runPrompt: 'Run on {port}.' } })
  await start(w)
  await using(host)
  assert.equal(runOf(host)!.qa!.branch, 'studio/qa-maya')
  await w.request('run.stop', { project: 'app', persona: 'maya' })
  await start(w)
  await using(host)
  assert.equal(calls.filter((a) => a[1] === 'create').length, 1)
})

test('A done file written after Stop is ignored', async () => {
  const { files, host, w, calls } = await setup()
  await start(w)
  await using(host)
  const run = runOf(host)!
  await w.request('run.stop', { project: 'app', persona: 'maya' })
  await dead(run.app!.pid)
  done(files, `${run.id}-run`, { ok: true, results: results(run) })
  await w.request('tick')
  assert.equal(launches(calls).length, 1)
  assert.deepEqual((await w.request('findings.list', { project: 'app' })).rows, [])
  assert.equal(recordOf(host)!.runs.length, 0)
})

test('Stop renames the chat and sends it a message', async () => {
  const { host, w, calls } = await setup({ config: { start: undefined, runPrompt: 'Run on {port}.' } })
  await start(w)
  await using(host)
  await w.request('run.stop', { project: 'app', persona: 'maya' })
  await saw(calls, "chat rename --session s1 --name Stopped: Maya's run")
  await until(() => calls.some((a) => a.join('|') === 'orchestration|send|--to|orca_session_id:s1|--subject|Stopped|--body|'
    + 'Persona Studio stopped this run. Stop now and write nothing more.|--json'), 'the stop message')
  assert.equal((await rowOf(w)).state, 'idle')
})

test('a restart while preparing fails the run in plain words', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-app-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const port = base + 9_000, pid = startApp({ cwd: dir, command: SERVER, port, log: join(dir, 'app.log') })
  cleanup.push(() => stopApp(pid))
  const run = { id: 'maya-1', stage: 'preparing', at: 1, seed: 1, port, recheck: [], app: { pid } }
  const { w } = await setup({ storage: { 'record:app:maya': json({ v: 2, project: 'app', persona: 'maya', runs: [], run }) } })
  const row = await rowOf(w)
  assert.equal(row.state, 'idle')
  assert.equal(row.error, "Persona Studio restarted while preparing Maya's run. Run it again.")
  await dead(pid)
})

test('a restart while using keeps watching it', async () => {
  const { files, host, w, opts, agents } = await setup()
  await start(w)
  await using(host)
  agents.push({ orcaSessionId: 's1', kind: 'chat', state: 'working' })
  await w.deactivate()
  const again = mockHost(opts(host.data().storage as Record<string, JsonValue>))
  const w2 = await mount(again)
  const run = runOf(again)!
  assert.equal((await rowOf(w2)).state, 'running')
  assert.ok(alive(run.app!.pid))
  done(files, `${run.id}-run`, { ok: true, results: results(run) })
  await w2.request('tick')
  await staged(again, 'matching')
})

test('a restart while using whose chat Orca no longer lists fails the run after 30 s and stops its app', async () => {
  const { host, w, opts } = await setup()
  cleanup.push(() => worker.setNow(() => Date.now()))
  await start(w)
  await using(host)
  const pid = runOf(host)!.app!.pid, t0 = Date.now()
  await w.deactivate()
  worker.setNow(() => t0)
  const again = mockHost(opts(host.data().storage as Record<string, JsonValue>))
  const w2 = await mount(again)
  await until(() => runOf(again)?.task?.endedAt === t0, 'the dead chat to count as ended')
  worker.setNow(() => t0 + 31_000)
  await w2.request('tick')
  assert.equal((await rowOf(w2)).error, "Maya's run agent finished without writing its done file.")
  await dead(pid)
})

test('a restart while using whose app died fails the run', async () => {
  const run = { id: 'maya-1', stage: 'using', at: 1, seed: 1, port: 1, recheck: [], app: { pid: 999_999 },
    qa: { path: '/qa', branch: 'studio/qa-maya', workspaceId: 'qa' }, task: { id: 'maya-1-run', role: 'run', chat: 's1' } }
  const { w } = await setup({ storage: { 'record:app:maya': json({ v: 2, project: 'app', persona: 'maya', runs: [], run }) } })
  assert.equal((await rowOf(w)).error, "Maya's app stopped during the run.")
})

test('persona.get lists every goal, met or not, with a trend for a counted one', async () => {
  const counted = 'Open a photo from the keys in three presses or fewer.', judged = 'The help is readable on a tablet.'
  const runs = [1, 2].map((loop) => ({ runId: `r${loop}`, loop, seed: 1, resultsPath: '/r', at: loop, summary: { newItems: 0, newBig: 0, repeats: 0 },
    goals: [{ goal: counted, value: 6 - loop }, { goal: judged, judgment: 'met' }] }))
  const { w } = await setup({ storage: { 'record:app:maya': json({ v: 2, project: 'app', persona: 'maya', runs }) } })
  const d = await w.request('persona.get', { project: 'app', persona: 'maya' })
  assert.deepEqual(d.goals, [
    { text: counted, met: false, trend: { text: counted, target: 3, better: 'lower', unit: 'keys',
      points: [{ runId: 'r1', loop: 1, value: 5 }, { runId: 'r2', loop: 2, value: 4 }] } },
    { text: judged, met: true }])
  assert.deepEqual([d.row.runs, d.lines, d.branch, d.port], [2, [], null, null])
  assert.match(d.who[0], /^Maya is a hobby photographer/)
  await assert.rejects(w.request('persona.get', { project: 'app', persona: 'zed' }), (e: any) => e.code === 'invalid_params')
})
