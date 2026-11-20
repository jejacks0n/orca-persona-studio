import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { JsonValue } from 'orca'
import { afterEach, assert, mockHost, mountWorker, test, type MockHost, type TestWorker } from 'orca/testing'
import type { Finding, ProjectFindings, Report } from './model'
import { fixture, read, until } from './test-helpers'
import type { Runner } from './tools'
import * as worker from './worker'

const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const f of cleanup.splice(0)) await f() })

/** A temp copy of fixtures/project: personas Maya and Dex in docs/qa/personas. */
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => rmSync(`${dir}-files`, { recursive: true, force: true }))
  cpSync(fixture('project'), dir, { recursive: true })
  worker.setFilesRoot(`${dir}-files`)
  return dir
}
/** Where the worker keeps project app's finding files: outside the checkout, under the files root. */
const fd = (dir: string) => join(`${dir}-files`, 'app', 'findings')

/** Each folder is its own main checkout, with its .git inside it; everything else succeeds. */
function fakeRunner(calls: string[][] = []): Runner {
  return async (_cmd, args) => {
    calls.push(args)
    if (args.includes('--git-common-dir')) return { code: 0, stdout: `${join(args[1], '.git')}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
}

const settings = { agent: 'claude', orcaPath: 'orca', ghPath: 'gh', gitPath: 'git', prPollMinutes: 5 }
type HostOpts = { settings?: Partial<typeof settings>; results?: Record<string, unknown> | ((dir: string) => Record<string, unknown>) }
/** The copy is a local worktree named "app" on main. */
function hostFor(dir: string, storage: Record<string, JsonValue> = {}, o: HostOpts = {}): MockHost {
  // The mock host doesn't fill in the manifest's setting defaults the way Orca does.
  return mockHost({ storage, settings: { ...settings, ...o.settings }, results: {
    'workspace.list': local({ name: 'app', path: dir, branch: 'main' }),
    'editor.open': { opened: true },
    ...(typeof o.results === 'function' ? o.results(dir) : o.results) } })
}

async function mount(host: MockHost): Promise<TestWorker> {
  const w = await mountWorker(worker, { host })
  cleanup.push(() => w.deactivate())
  return w
}

const report = (persona: string, n = 1): Report => ({ id: `r${n}`, persona, runId: `run${n}`, at: 100 * n, saw: 'It broke',
  steps: ['Open it'], shots: [], severity: 'major', step: '1. Open' })
const finding = (id: string, over: Partial<Finding> = {}): Finding => ({ id, title: `Title ${id}`, kind: 'bug', labels: [],
  severity: 'major', state: 'new', reports: [report('maya')], history: [], ...over })
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as JsonValue

/** A worker over a fresh copy stored as project "app", holding `findings`. */
async function seeded(findings: Finding[] = [], o: HostOpts & { storage?: Record<string, JsonValue>; runner?: Runner } = {}) {
  const dir = copy()
  worker.setRunner(o.runner ?? fakeRunner())
  const host = hostFor(dir, { projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }],
    'findings:app': json({ v: 2, project: 'app', next: findings.length + 1, findings }), ...o.storage }, o)
  return { dir, host, w: await mount(host) }
}
const stored = (host: MockHost) => host.data().storage['findings:app'] as ProjectFindings
const byId = (host: MockHost, id: string) => stored(host).findings.find((f) => f.id === id)!
const brief = (dir: string, id: string) => read(join(fd(dir), id, 'finding.md'))
const notesFile = (dir: string, id: string) => join(fd(dir), id, 'notes.md')
const changedPosts = (w: TestWorker) => w.posts.filter((p) => p.event === 'changed').map((p) => p.payload)

const focused = (displayName: string, branch: string, ...terminals: string[]) =>
  ({ context: { branch, displayName, terminals: terminals.map((id) => ({ id })) } })
// Orca gives a new subscriber the current context first: none, from the mock host.
const focusPosts = (w: TestWorker) => w.posts.filter((p) => p.event === 'focus').map((p) => p.payload)
/** A workspace.list answer of local worktrees, in order. Orca says `hostId: 'local'` for them. */
function local(...ws: { name: string; path: string; branch: string }[]) {
  return { truncated: false, workspaces: ws.map((x, i) => ({ id: i === 0 ? 'main' : `ws${i}`, kind: 'worktree', hostId: 'local', ...x })) }
}

test('focusing a git worktree makes it a project, leaves its checkout untouched and answers its persona count', async () => {
  const dir = copy()
  worker.setRunner(fakeRunner())
  const id = basename(dir)
  // Another project already has this worktree's id, so this one gets -2.
  const w = await mount(hostFor(dir, { projects: [{ id, name: 'other', path: '/elsewhere', branch: 'main' }] }))
  await w.emit('workspace.changed', focused('app', 'main'))
  const project = { kind: 'project', id: `${id}-2`, name: id, personas: 2, path: dir }
  assert.deepEqual(await w.request('focus.get'), project)
  assert.deepEqual(focusPosts(w), [{ kind: 'none' }, project])
  assert.deepEqual(w.host.data().storage.projects, [{ id, name: 'other', path: '/elsewhere', branch: 'main' },
    { id: `${id}-2`, name: id, path: dir, branch: 'main' }])
  assert.equal(existsSync(join(dir, '.git/info/exclude')), false)
  assert.equal(existsSync(join(dir, '.studio')), false)
  // Focusing it again is the same project.
  await w.emit('workspace.changed', { context: null })
  await w.emit('workspace.changed', focused('app', 'main'))
  assert.deepEqual(await w.request('focus.get'), project)
  assert.equal((w.host.data().storage.projects as unknown[]).length, 2)
})

test('a persona\'s QA worktree is its project, with that persona named; no project is stored for it', async () => {
  const dir = copy(), qa = mkdtempSync(join(tmpdir(), 'studio-qa-'))
  cleanup.push(() => rmSync(qa, { recursive: true, force: true }))
  // The QA worktree's main checkout is the project's.
  worker.setRunner(async (_cmd, args) => args.includes('--git-common-dir')
    ? { code: 0, stdout: `${join(args[1] === qa ? dir : args[1], '.git')}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' })
  const ws = (branch: string) => local({ name: 'app', path: dir, branch: 'main' }, { name: 'qa', path: qa, branch })
  // An older version stored the QA worktree as a project of its own; that entry no longer wins.
  const stale = { id: 'app-qa', name: 'app · qa', path: qa, branch: 'studio/qa-maya' }
  const w = await mount(hostFor(dir, { projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }, stale] }, { results: { 'workspace.list': ws('studio/qa-maya') } }))
  await w.emit('workspace.changed', focused('qa', 'studio/qa-maya'))
  assert.deepEqual(await w.request('focus.get'), { kind: 'project', id: 'app', name: 'app', personas: 2, path: qa, persona: 'maya' })
  assert.equal((w.host.data().storage.projects as unknown[]).length, 2)
  // A QA-looking branch for a persona the project doesn't have is a project of its own.
  const other = await mount(hostFor(dir, { projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }] }, { results: { 'workspace.list': ws('studio/qa-zed') } }))
  await other.emit('workspace.changed', focused('qa', 'studio/qa-zed'))
  const f: any = await other.request('focus.get')
  assert.notEqual(f.id, 'app')
  assert.equal(f.persona, undefined)
})

test('overview lists personas with name, tag and fresh counts from the working copy, with no config file at all', async () => {
  const { dir, w } = await seeded([
    finding('f1', { fresh: true }), finding('f2'), finding('f3', { state: 'kept', fresh: true }),
    finding('f4', { fresh: true, reports: [report('dex'), report('maya', 2)] })],
  { settings: { ghPath: '' }, storage: { 'record:app:maya': json({ v: 2, project: 'app', persona: 'maya',
    runs: [{ runId: 'a', at: 100 }, { runId: 'b', at: 300 }, { runId: 'c', at: 200 }] }) } })
  rmSync(join(dir, 'persona.studio'), { force: true })
  mkdirSync(join(dir, 'docs/personas'), { recursive: true })
  writeFileSync(join(dir, 'docs/personas/maya.md'), '# Maya: the patient photographer\n')
  writeFileSync(join(dir, 'docs/personas/dex.md'), '# Dex\n')
  const realExists = (p: string) => existsSync(p)
  cleanup.push(() => worker.setExists(realExists))
  worker.setExists((p) => !p.includes('gh'))
  assert.deepEqual(await w.request('overview.get', { project: 'app' }), {
    personas: [{ id: 'dex', name: 'Dex', tag: '', state: 'idle', fresh: 1, runs: 0, recheck: 0 },
      { id: 'maya', name: 'Maya', tag: 'the patient photographer', state: 'idle', fresh: 2, runs: 3, recheck: 0, lastRunAt: 300 }],
    counts: { new: 3, kept: 1, progress: 0, fixed: 0, closed: 0 }, hasGh: false, configError: null,
    canRun: 'Persona Studio doesn\'t know how to start this app yet. Set "start" in persona.studio, or set up personas.' })
  await assert.rejects(w.request('overview.get', { project: 'nope' }), (e: any) =>
    e.code === 'invalid_params' && /nope/.test(e.message))
})

test('findings.list answers a row for every finding', async () => {
  const { w } = await seeded([finding('f1', { fresh: true }), finding('f2', { state: 'kept' })])
  const { rows } = await w.request('findings.list', { project: 'app' })
  assert.deepEqual(rows.map((r) => [r.id, r.state, r.fresh, r.personas]), [['f1', 'new', true, ['maya']], ['f2', 'kept', false, ['maya']]])
})

test('finding.act keeps a finding, saves, rewrites its brief, posts changed and answers an undo token', async () => {
  const { dir, host, w } = await seeded([finding('f1', { fresh: true }), finding('f2')])
  const { undo } = await w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f1'] } })
  assert.equal(typeof undo, 'string')
  assert.equal(byId(host, 'f1').state, 'kept')
  assert.equal(byId(host, 'f1').fresh, undefined)
  assert.match(brief(dir, 'f1'), /State: kept/)
  assert.match(brief(dir, 'f1'), /## Maya/)
  assert.equal(existsSync(join(fd(dir), 'f2')), false)
  assert.equal(existsSync(join(dir, '.studio')), false)
  assert.deepEqual(changedPosts(w), [{ project: 'app' }])
  // Only keep and close can be undone.
  const closed = await w.request('finding.act', { project: 'app', action: { type: 'close', ids: ['f2'], reason: 'notABug' } })
  assert.equal(typeof closed.undo, 'string')
  assert.deepEqual(await w.request('finding.act', { project: 'app', action: { type: 'reopen', id: 'f2' } }), { undo: null })
})

test('findings.undo puts the record back; a second undo, or one after another change, says "Too late to undo that."', async () => {
  const { dir, host, w } = await seeded([finding('f1'), finding('f2'), finding('f3', { fresh: true })])
  const before = stored(host)
  const { undo } = await w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f1'] } })
  assert.deepEqual(await w.request('findings.undo', { project: 'app', token: undo! }), { ok: true })
  assert.deepEqual(stored(host), before)
  assert.match(brief(dir, 'f1'), /State: new/)
  assert.equal(changedPosts(w).length, 2)
  await assert.rejects(w.request('findings.undo', { project: 'app', token: undo! }), /^Error: Too late to undo that\.$/)
  // Not the latest token.
  const first = await w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f1'] } })
  await w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f2'] } })
  await assert.rejects(w.request('findings.undo', { project: 'app', token: first.undo! }), /Too late to undo that\./)
  // The latest, but opening a fresh finding changed the record since.
  const latest = await w.request('finding.act', { project: 'app', action: { type: 'close', ids: ['f1'], reason: 'wontFix' } })
  await w.request('finding.get', { project: 'app', id: 'f3' })
  await assert.rejects(w.request('findings.undo', { project: 'app', token: latest.undo! }), /Too late to undo that\./)
  assert.equal(byId(host, 'f1').state, 'closed')
})

/** A deep copy with every object's keys in reverse order; arrays keep theirs. */
const reversed = (v: unknown): unknown => Array.isArray(v) ? v.map(reversed)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v

test('undo still works when storage hands records back with their keys in another order', async () => {
  const dir = copy()
  worker.setRunner(fakeRunner())
  const map = new Map<string, unknown>([['projects', [{ id: 'app', name: 'app', path: dir, branch: 'main' }]],
    ['findings:app', json({ v: 2, project: 'app', next: 3, findings: [finding('f1'), finding('f2')] })]])
  const host = hostFor(dir, {}, { results: {
    'storage.get': ({ key }: { key: string }) => ({ value: map.has(key) ? reversed(map.get(key)) : null }),
    'storage.set': ({ key, value }: { key: string; value: unknown }) => { map.set(key, structuredClone(value)); return { ok: true } },
    'storage.keys': () => ({ keys: [...map.keys()] }) } })
  const w = await mount(host)
  const { undo } = await w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f1'] } })
  assert.deepEqual(await w.request('findings.undo', { project: 'app', token: undo! }), { ok: true })
  assert.equal((map.get('findings:app') as ProjectFindings).findings[0].state, 'new')
})

test('a refused action reaches the caller with the reducer\'s own words', async () => {
  const { host, w } = await seeded([finding('f1', { state: 'kept' })])
  const before = stored(host)
  await assert.rejects(w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f1'] } }),
    /^Error: Only a new finding can be kept\.$/)
  assert.deepEqual(stored(host), before)
  assert.deepEqual(changedPosts(w), [])
})

test('group merges the notes files under "From <title>:"', async () => {
  const { dir, host, w } = await seeded([finding('f1'), finding('f2', { title: 'Menu hides' })])
  mkdirSync(join(fd(dir), 'f1'), { recursive: true })
  mkdirSync(join(fd(dir), 'f2'), { recursive: true })
  writeFileSync(notesFile(dir, 'f1'), 'Lead note\n')
  writeFileSync(notesFile(dir, 'f2'), 'Seen on the iPad\n')
  assert.deepEqual(await w.request('finding.act', { project: 'app', action: { type: 'group', ids: ['f1', 'f2'], lead: 'f1' } }), { undo: null })
  assert.equal(read(notesFile(dir, 'f1')), 'Lead note\n\nFrom Menu hides:\nSeen on the iPad\n')
  assert.deepEqual(stored(host).findings.map((f) => [f.id, f.members?.length]), [['f1', 2]])
  assert.match(brief(dir, 'f1'), /# Title f1/)
})

test('finding.get clears fresh and joins persona names to reports', async () => {
  const { host, w } = await seeded([finding('f1', { fresh: true, reports: [report('maya'), report('ghost', 2)],
    members: [finding('f7', { title: 'Old one', reports: [report('dex'), report('dex', 2)] })] })])
  const d = await w.request('finding.get', { project: 'app', id: 'f1' })
  assert.deepEqual(d.finding.reports.map((r) => [r.persona, r.personaName]), [['maya', 'Maya'], ['ghost', 'ghost']])
  assert.deepEqual(d.finding.members, [{ id: 'f7', title: 'Old one', personas: ['dex'] }])
  assert.equal(d.finding.fresh, undefined)
  assert.deepEqual(d.notes, { text: '', mtime: 0 })
  assert.equal(byId(host, 'f1').fresh, undefined)
  assert.deepEqual(changedPosts(w), [{ project: 'app', finding: 'f1' }])
  // Opening it again changes nothing, so nothing is saved or posted.
  await w.request('finding.get', { project: 'app', id: 'f1' })
  assert.equal(changedPosts(w).length, 1)
  await assert.rejects(w.request('finding.get', { project: 'app', id: 'f9' }), /no longer on the list/)
})

test('notes.set saves, and a stale base is refused with code conflict', async () => {
  const { dir, w } = await seeded([finding('f1')])
  const { mtime } = await w.request('notes.set', { project: 'app', id: 'f1', text: 'Try the iPad', base: 0 })
  assert.ok(mtime > 0)
  assert.equal(read(notesFile(dir, 'f1')), 'Try the iPad')
  await assert.rejects(w.request('notes.set', { project: 'app', id: 'f1', text: 'Mine', base: 0 }),
    (e: any) => e.code === 'conflict' && /notes changed/.test(e.message))
  assert.equal(read(notesFile(dir, 'f1')), 'Try the iPad')
  assert.deepEqual(await w.request('notes.set', { project: 'app', id: 'f1', text: 'Mine', base: mtime }).then(() => read(notesFile(dir, 'f1'))), 'Mine')
})

test('tab.open opens the committed persona.studio at the root, making it only when missing, and posts show', async () => {
  const { dir, host, w } = await seeded()
  host.respond('workspace.list', { truncated: false, workspaces: [
    { id: 'remote', kind: 'worktree', name: 'app', path: dir, branch: 'main', hostId: 'ssh-1' },
    { id: 'other', kind: 'worktree', name: 'app 2', path: `${dir}-2`, branch: 'main', hostId: 'local' },
    { id: 'main', kind: 'worktree', name: 'app', path: dir, branch: 'main', hostId: 'local' }] })
  const file = join(dir, 'persona.studio')
  const mine = read(file)
  assert.deepEqual(await w.request('tab.open', { project: 'app', show: { state: 'kept' } }), { ok: true })
  assert.equal(read(file), mine)
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'main', path: 'persona.studio' }])
  assert.deepEqual(w.posts.filter((p) => p.event === 'show').map((p) => p.payload), [{ project: 'app', at: dir, state: 'kept' }])
  // A project without one gets an empty config to commit when the owner likes.
  rmSync(file, { force: true })
  await w.request('tab.open', { project: 'app' })
  assert.equal(read(file), '{}\n')
  host.respond('workspace.list', { truncated: false, workspaces: [] })
  await assert.rejects(w.request('tab.open', { project: 'app' }), /own checkout/)
})

test('in a persona\'s QA worktree, tab.open opens the tab there, and its show is for that tab alone', async () => {
  const dir = copy(), qa = mkdtempSync(join(tmpdir(), 'studio-qa-'))
  cleanup.push(() => rmSync(qa, { recursive: true, force: true }))
  writeFileSync(join(qa, 'persona.studio'), '{}\n')
  worker.setRunner(async (_cmd, args) => args.includes('--git-common-dir')
    ? { code: 0, stdout: `${join(args[1] === qa ? dir : args[1], '.git')}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' })
  const w = await mount(hostFor(dir, { projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }] },
    { results: { 'workspace.list': local({ name: 'app', path: dir, branch: 'main' }, { name: 'qa', path: qa, branch: 'studio/qa-maya' }) } }))
  await w.emit('workspace.changed', focused('qa', 'studio/qa-maya'))
  await w.request('tab.open', { project: 'app', show: { persona: 'maya' } })
  assert.deepEqual(w.host.callsOf('editor.open'), [{ workspaceId: 'ws1', path: 'persona.studio' }])
  assert.deepEqual(w.posts.filter((p) => p.event === 'show').map((p) => p.payload), [{ project: 'app', at: qa, persona: 'maya' }])
  // The main checkout's tab doesn't take it; the QA worktree's does.
  assert.deepEqual(await w.request('show.take', { project: 'app', at: dir }), { show: null })
  assert.deepEqual(await w.request('show.take', { project: 'app', at: qa }), { show: { persona: 'maya' } })
})

test('moving between two QA worktrees, focus.get and tab.open wait for the new focus instead of answering the old one', async () => {
  const dir = copy(), a = mkdtempSync(join(tmpdir(), 'studio-qa-')), b = mkdtempSync(join(tmpdir(), 'studio-qa-'))
  cleanup.push(() => rmSync(a, { recursive: true, force: true }), () => rmSync(b, { recursive: true, force: true }))
  for (const qa of [a, b]) writeFileSync(join(qa, 'persona.studio'), '{}\n')
  worker.setRunner(async (_cmd, args) => args.includes('--git-common-dir')
    ? { code: 0, stdout: `${join([a, b].includes(args[1]) ? dir : args[1], '.git')}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' })
  const w = await mount(hostFor(dir, { projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }] }, { results: { 'workspace.list':
    local({ name: 'app', path: dir, branch: 'main' }, { name: 'qa-maya', path: a, branch: 'studio/qa-maya' }, { name: 'qa-dex', path: b, branch: 'studio/qa-dex' }) } }))
  await w.emit('workspace.changed', focused('qa-maya', 'studio/qa-maya'))
  // Asked while the worker is still working out the switch.
  const moving = w.emit('workspace.changed', focused('qa-dex', 'studio/qa-dex'))
  const [f] = await Promise.all([w.request('focus.get'), moving])
  assert.deepEqual(f, { kind: 'project', id: 'app', name: 'app', personas: 2, path: b, persona: 'dex' })
  const again = w.emit('workspace.changed', focused('qa-maya', 'studio/qa-maya'))
  await Promise.all([w.request('tab.open', { project: 'app', show: { persona: 'maya' } }), again])
  assert.deepEqual(w.posts.filter((p) => p.event === 'show').map((p) => p.payload), [{ project: 'app', at: a, persona: 'maya' }])
})

test('tab.open with a show is remembered until taken, then gone', async () => {
  const { w } = await seeded()
  assert.deepEqual(await w.request('show.take', { project: 'app' }), { show: null })
  await w.request('tab.open', { project: 'app', show: { state: 'kept', persona: 'maya', finding: 'f1' } })
  assert.deepEqual(await w.request('show.take', { project: 'app' }), { show: { state: 'kept', persona: 'maya', finding: 'f1' } })
  assert.deepEqual(await w.request('show.take', { project: 'app' }), { show: null })
})

test('a tab.open without a show clears a remembered one', async () => {
  const { w } = await seeded()
  await w.request('tab.open', { project: 'app', show: { state: 'fixed' } })
  await w.request('tab.open', { project: 'app' })
  assert.deepEqual(await w.request('show.take', { project: 'app' }), { show: null })
})

test("finding.get for a finding that's gone is refused in plain words", async () => {
  const { w } = await seeded([finding('f1')])
  await assert.rejects(w.request('finding.get', { project: 'app', id: 'f9' }),
    (e: any) => e.code === 'invalid_params' && e.message === 'That finding is no longer on the list.')
})

test('the tick posts changed for notes an agent edited, once', async () => {
  const { dir, w } = await seeded([finding('f1'), finding('f2')])
  await new Promise((r) => setTimeout(r, 5))
  mkdirSync(join(fd(dir), 'f1'), { recursive: true })
  writeFileSync(notesFile(dir, 'f1'), 'The agent was here\n')
  // The owner's own save isn't news to the tab that made it.
  await w.request('notes.set', { project: 'app', id: 'f2', text: 'Mine', base: 0 })
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(await w.request('tick'), { ok: true })
  assert.deepEqual(changedPosts(w), [{ project: 'app', finding: 'f1' }])
  await w.request('tick')
  assert.equal(changedPosts(w).length, 1)
})

test('two requests at once apply one after the other', async () => {
  const { host, w } = await seeded([finding('f1'), finding('f2')])
  await Promise.all([
    w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f1'] } }),
    w.request('finding.act', { project: 'app', action: { type: 'keep', ids: ['f2'] } })])
  assert.deepEqual(stored(host).findings.map((f) => f.state), ['kept', 'kept'])
})

test('the open command opens the tab for the focused project, or says why there is none', async () => {
  const { host, w } = await seeded()
  assert.equal(await w.command('open'), 'Open a project in Orca to see its personas.')
  await w.emit('workspace.changed', focused('app', 'main'))
  assert.equal(await w.command('open'), 'Opened the Persona Studio tab.')
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'main', path: 'persona.studio' }])
})

test('needs-you counts New, Kept, Working and Fixed for the focused project, or says nothing is waiting', async () => {
  const { w } = await seeded([finding('f1'), finding('f2'), finding('f3', { state: 'kept' }), finding('f4', { state: 'fixed' }),
    finding('f5', { state: 'closed' }), finding('f6', { state: 'progress' })])
  await w.emit('workspace.changed', focused('app', 'main'))
  assert.equal(await w.command('needs-you'), 'New: 2\nKept: 1\nWorking: 1\nFixed: 1')
  const empty = await seeded([finding('f1', { state: 'closed' })])
  await empty.w.emit('workspace.changed', focused('app', 'main'))
  assert.equal(await empty.w.command('needs-you'), 'Nothing is waiting.')
})

test('focus is none with no focused workspace, or none local that matches, and posts it once', async () => {
  const dir = copy()
  worker.setRunner(fakeRunner())
  const w = await mount(hostFor(dir, {}, { results: { 'workspace.list': { truncated: false, workspaces: [
    { id: 'r', kind: 'worktree', name: 'app', path: dir, branch: 'main', hostId: 'ssh-1' },
    { id: 'l', kind: 'worktree', name: 'app', path: dir, branch: 'other', hostId: 'local' }] } } }))
  await w.emit('workspace.changed', { context: null })
  await w.emit('workspace.changed', focused('app', 'main'))
  // Posted once: it never changed.
  assert.deepEqual(focusPosts(w), [{ kind: 'none' }])
  assert.deepEqual(await w.request('focus.get'), { kind: 'none' })
})

test('focus.get answers before any workspace.changed, from workspace.readContext', async () => {
  const dir = copy()
  worker.setRunner(fakeRunner())
  // No events at all, so the worker has heard no context.
  const w = await mountWorker(worker, { events: [], host: hostFor(dir, {}, { results: {
    'workspace.readContext': { branch: 'main', displayName: 'app', terminals: [] } } }) })
  cleanup.push(() => w.deactivate())
  assert.deepEqual(await w.request('focus.get'), { kind: 'project', id: basename(dir), name: basename(dir), personas: 2, path: dir })
  assert.equal(w.host.callsOf('workspace.readContext').length, 1)
})

test('a workspace.changed that arrives while the first focus.get is reading the context wins over the late answer', async () => {
  const [a, b] = [copy(), copy()]
  worker.setRunner(fakeRunner())
  let release!: () => void
  const late = new Promise<void>((r) => { release = r })
  // Orca's first-context event for a new subscriber reads it too (the first read, here the same as the event's); focus.get's read is the second.
  let reads = 0
  const w = await mountWorker(worker, { host: hostFor(a, {}, { results: {
    'workspace.list': local({ name: 'one', path: a, branch: 'main' }, { name: 'two', path: b, branch: 'main' }),
    'workspace.readContext': () => late.then(() => ({ branch: 'main', displayName: ++reads === 1 ? 'two' : 'one', terminals: [] })) } }) })
  cleanup.push(() => w.deactivate())
  const first = w.request('focus.get')
  const event = w.emit('workspace.changed', focused('two', 'main'))
  release()
  await event
  const two = { kind: 'project', id: basename(b), name: basename(b), personas: 2, path: b }
  assert.deepEqual(await first, two)
  assert.deepEqual(await w.request('focus.get'), two)
})

const realExists = (p: string) => existsSync(p)
test('with no orca path set and none found, the request is refused naming orca and Persona Studio\'s settings', async () => {
  cleanup.push(() => worker.setExists(realExists))
  const { w } = await seeded([], { settings: { orcaPath: '', gitPath: '' } })
  worker.setExists(() => false)
  await assert.rejects(w.request('overview.get', { project: 'app' }), /orca.*Persona Studio's settings/)
  worker.setExists((p) => p.includes('orca'))
  await assert.rejects(w.request('overview.get', { project: 'app' }), /git.*Persona Studio's settings/)
})

test('with no gh found, tools are made without gh and nothing throws', async () => {
  cleanup.push(() => worker.setExists(realExists))
  const { w } = await seeded([], { settings: { orcaPath: '', gitPath: '', ghPath: '' } })
  worker.setExists((p) => !p.includes('gh'))
  assert.equal((await w.request('overview.get', { project: 'app' })).hasGh, false)
})

test('a path set in settings is used as is', async () => {
  cleanup.push(() => worker.setExists(realExists))
  const cmds: string[] = []
  const { w } = await seeded([], { settings: { gitPath: '/t/git' }, runner: async (cmd, args) => { cmds.push(cmd); return fakeRunner()(cmd, args) } })
  worker.setExists(() => false)
  await w.emit('workspace.changed', focused('app', 'main'))
  assert.equal((await w.request('focus.get')).kind, 'project')
  assert.ok(cmds.includes('/t/git'))
})

const PNG = 'png bytes'
const b64 = (s: string) => btoa(s)
/** A report with screenshot files in a temp folder, so `dir/shots/*` can be real. */
function withShots(dir: string, files: Record<string, string>): string[] {
  mkdirSync(join(dir, 'shots'), { recursive: true })
  return Object.entries(files).map(([name, data]) => { const p = join(dir, 'shots', name); writeFileSync(p, data); return p })
}
const shotReport = (shots: string[]): Report => ({ ...report('maya'), shots })

test('shot.get answers a data URL for one of the report\'s own screenshots, and refuses any other', async () => {
  const dir0 = copy()
  const [png, jpg] = withShots(dir0, { 'a.png': PNG, 'b.jpeg': 'xx' })
  const { host, w } = await seeded([finding('f1', { reports: [shotReport([png, jpg])] })], {})
  const ok = await w.request('shot.get', { project: 'app', id: 'f1', report: 'r1', index: 0 })
  assert.deepEqual(ok, { url: `data:image/png;base64,${b64(PNG)}`, name: 'a.png' })
  assert.deepEqual(await w.request('shot.get', { project: 'app', id: 'f1', report: 'r1', index: 1 }),
    { url: `data:image/jpeg;base64,${b64('xx')}`, name: 'b.jpeg' })
  const refused = async (input: { id?: string; report: string; index: number }) => {
    const err: any = await w.request('shot.get', { project: 'app', id: 'f1', ...input }).then(() => null, (e) => e)
    assert.ok(err, JSON.stringify(input))
    assert.equal(err.code, 'invalid_params')
  }
  await refused({ report: 'nope', index: 0 })
  await refused({ report: 'r1', index: 2 })
  await refused({ report: 'r1', index: -1 })
  await refused({ id: 'gone', report: 'r1', index: 0 })
  assert.equal(host.callsOf('editor.open').length, 0)
})

test('a missing or oversized screenshot answers null, never an error', async () => {
  const dir0 = copy()
  const [big, exact] = withShots(dir0, { 'big.png': 'x'.repeat(700_001), 'edge.png': 'x'.repeat(700_000) })
  const gone = join(dir0, 'shots', 'gone.png')
  const { w } = await seeded([finding('f1', { reports: [shotReport([big, gone, exact])] })])
  assert.deepEqual(await w.request('shot.get', { project: 'app', id: 'f1', report: 'r1', index: 0 }), { url: null, name: 'big.png' })
  assert.deepEqual(await w.request('shot.get', { project: 'app', id: 'f1', report: 'r1', index: 1 }), { url: null, name: 'gone.png' })
  const edge = await w.request('shot.get', { project: 'app', id: 'f1', report: 'r1', index: 2 })
  assert.equal(edge.name, 'edge.png')
  assert.match(edge.url ?? '', /^data:image\/png;base64,/)
})

test('persona.open opens the persona\'s file in the checkout, by its relative path; an unknown persona is refused', async () => {
  const { host, w } = await seeded()
  assert.deepEqual(await w.request('persona.open', { project: 'app', persona: 'maya' }), { ok: true })
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'main', path: 'docs/qa/personas/maya.md' }])
  const err: any = await w.request('persona.open', { project: 'app', persona: 'zed' }).then(() => null, (e) => e)
  assert.equal(err.code, 'invalid_params')
})

test('answers are plain JSON: a finding with no issue, PR or close has no undefined fields in its row', async () => {
  const { w } = await seeded([finding('f1')])
  const out = await w.request('findings.list', { project: 'app' })
  // Orca refuses an answer holding undefined, which the test host doesn't check.
  const undefinedAt: string[] = []
  JSON.stringify(out, function (k, v) { if (v === undefined) undefinedAt.push(k); return v })
  assert.deepEqual(undefinedAt, [])
})

test('tab.projects names the projects whose persona.studio is the tab\'s file, ignoring outer whitespace', async () => {
  const dir = copy(), other = copy()
  writeFileSync(join(dir, 'persona.studio'), '{ "port": 4300 }\n')
  writeFileSync(join(other, 'persona.studio'), '{}\n')
  worker.setRunner(fakeRunner())
  const host = hostFor(dir, { projects: [{ id: 'app', name: 'app', path: dir, branch: 'main' }, { id: 'other', name: 'other', path: other, branch: 'main' }] })
  const w = await mount(host)
  assert.deepEqual(await w.request('tab.projects', { text: '  { "port": 4300 }' }), { projects: ['app'] })
  assert.deepEqual(await w.request('tab.projects', { text: '{}' }), { projects: ['other'] })
  assert.deepEqual(await w.request('tab.projects', { text: '{"x":1}' }), { projects: [] })
})

test('shot.open opens the file in the open workspace that holds it, by its relative path', async () => {
  const dir0 = copy()
  const [shot] = withShots(dir0, { 'a.png': PNG })
  const qa = mkdtempSync(join(tmpdir(), 'studio-qa-'))
  cleanup.push(() => rmSync(qa, { recursive: true, force: true }))
  const [qaShot] = withShots(qa, { 'q.png': PNG })
  const { host, w } = await seeded([finding('f1', { reports: [shotReport([shot, qaShot, '/nowhere/x.png'])] })])
  host.respond('workspace.list', { truncated: false, workspaces: [
    { id: 'remote', kind: 'worktree', name: 'qa', path: qa, branch: 'qa', hostId: 'ssh-1' },
    { id: 'qa', kind: 'worktree', name: 'qa', path: qa, branch: 'qa', hostId: 'local' },
    { id: 'main', kind: 'worktree', name: 'app', path: dir0, branch: 'main', hostId: 'local' }] })
  assert.deepEqual(await w.request('shot.open', { project: 'app', id: 'f1', report: 'r1', index: 1 }), { ok: true })
  assert.deepEqual(await w.request('shot.open', { project: 'app', id: 'f1', report: 'r1', index: 0 }), { ok: true })
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'qa', path: 'shots/q.png' }, { workspaceId: 'main', path: 'shots/a.png' }])
  await assert.rejects(w.request('shot.open', { project: 'app', id: 'f1', report: 'r1', index: 2 }), /That screenshot isn't in a workspace Orca has open\./)
  const err: any = await w.request('shot.open', { project: 'app', id: 'f1', report: 'zz', index: 0 }).then(() => null, (e) => e)
  assert.equal(err.code, 'invalid_params')
})

const withNotes = (dir: string, id: string, text: string) => {
  mkdirSync(join(fd(dir), id), { recursive: true })
  writeFileSync(notesFile(dir, id), text)
}

test('issue.draft leaves the notes out of the body', async () => {
  const two = { ...report('dex', 2), saw: 'Later', steps: ['Nope'] }
  const { dir, w } = await seeded([finding('f1', { title: 'Save fails', reports: [{ ...report('maya'), saw: 'Save did nothing', steps: ['Open it', 'Press save'] }, two] }),
    finding('f2', { reports: [report('maya')] }), finding('f3', { reports: [report('maya'), report('dex', 2), report('zed', 3)] })])
  withNotes(dir, 'f1', 'Check the retry code.\n')
  const d = await w.request('issue.draft', { project: 'app', id: 'f1' })
  assert.equal(d.title, 'Save fails')
  assert.equal(d.body, 'Save did nothing\n\nSteps to reproduce:\n1. Open it\n2. Press save\n\nSeen by Maya and Dex.')
  assert.equal(d.notes, 'Check the retry code.')
  assert.ok(!d.body.includes('retry'))
  assert.equal((await w.request('issue.draft', { project: 'app', id: 'f2' })).notes, '')
  assert.match((await w.request('issue.draft', { project: 'app', id: 'f3' })).body, /Seen by Maya, Dex and zed\.$/)
})

/** The fixture's persona.studio names a repo; this takes it out so the remote decides. */
const noRepo = (dir: string) => writeFileSync(join(dir, 'persona.studio'), '{"personas":"docs/qa/personas"}')

/** gh runs recorded; git's remote is `remote`. */
function ghRunner(calls: string[][], o: { remote?: string; failClose?: string } = {}): Runner {
  return async (_cmd, args) => {
    calls.push(args)
    if (args.includes('--git-common-dir')) return { code: 0, stdout: `${join(args[1], '.git')}\n`, stderr: '' }
    if (args.includes('get-url')) return o.remote ? { code: 0, stdout: `${o.remote}\n`, stderr: '' } : { code: 2, stdout: '', stderr: 'no origin' }
    if (args[0] === 'issue' && args[1] === 'create') return { code: 0, stdout: 'https://github.com/acme/app/issues/9\n', stderr: '' }
    if (args[0] === 'issue' && args[1] === 'close' && o.failClose) return { code: 1, stdout: '', stderr: `${o.failClose}\nmore` }
    return { code: 0, stdout: '', stderr: '' }
  }
}
const ghCalls = (calls: string[][]) => calls.filter((a) => a[0] === 'issue')

test('issue.create records the issue and refuses a second one', async () => {
  const calls: string[][] = []
  const { dir, host, w } = await seeded([finding('f1'), finding('f2')], { runner: ghRunner(calls, { remote: 'git@github.com:acme/app.git' }) })
  noRepo(dir)
  assert.deepEqual(await w.request('issue.create', { project: 'app', id: 'f1', title: 'T', body: 'B' }),
    { number: 9, url: 'https://github.com/acme/app/issues/9' })
  assert.deepEqual(ghCalls(calls).map((a) => a.slice(0, 5)), [['issue', 'create', '--repo', 'acme/app', '--title']])
  assert.deepEqual(byId(host, 'f1').issue, { number: 9, url: 'https://github.com/acme/app/issues/9' })
  assert.equal(byId(host, 'f1').history.at(-1)?.text, 'Issue #9 opened')
  assert.deepEqual(changedPosts(w), [{ project: 'app', finding: 'f1' }])
  await assert.rejects(w.request('issue.create', { project: 'app', id: 'f1', title: 'T', body: 'B' }), /This finding already has issue #9\./)
  assert.equal(ghCalls(calls).length, 1)
  assert.equal(byId(host, 'f2').issue, undefined)
})

test('issue.create prefers the config\'s repo, and refuses with no repo or no gh', async () => {
  const calls: string[][] = []
  // Origin is set only after the first refusal; ghRunner reads it on each call.
  const remote: { remote?: string } = {}
  const withCfg = await seeded([finding('f1')], { runner: ghRunner(calls, remote) })
  noRepo(withCfg.dir)
  // No remote and no configured repo.
  await assert.rejects(withCfg.w.request('issue.create', { project: 'app', id: 'f1', title: 'T', body: 'B' }), /This project has no GitHub remote\./)
  assert.equal(ghCalls(calls).length, 0)
  remote.remote = 'git@github.com:acme/app.git'
  writeFileSync(join(withCfg.dir, 'persona.studio'), '{"repo":"cfg/repo","personas":"docs/qa/personas"}')
  await withCfg.w.request('issue.create', { project: 'app', id: 'f1', title: 'T', body: 'B' })
  assert.deepEqual(ghCalls(calls).map((a) => a[3]), ['cfg/repo'])
  const none = await seeded([finding('f1')], { runner: ghRunner([], { remote: 'git@github.com:acme/app.git' }), settings: { ghPath: '' } })
  worker.setExists(() => false)
  cleanup.push(() => worker.setExists(existsSync))
  await assert.rejects(none.w.request('issue.create', { project: 'app', id: 'f1', title: 'T', body: 'B' }), /GitHub's gh command isn't installed\./)
  assert.equal(byId(none.host, 'f1').issue, undefined)
})

const withIssue = { issue: { number: 5, url: 'https://github.com/acme/app/issues/5' } }
const close = (id: string, closeIssue?: boolean) =>
  ({ project: 'app', action: { type: 'close' as const, ids: [id], reason: 'wontFix' as const, ...(closeIssue !== undefined && { closeIssue }) } })

test('closing with closeIssue closes the issue as not planned', async () => {
  const calls: string[][] = []
  const { dir, host, w } = await seeded([finding('f1', { state: 'kept', ...withIssue }), finding('f2', { state: 'kept' }), finding('f3', { state: 'kept', ...withIssue })],
    { runner: ghRunner(calls, { remote: 'git@github.com:acme/app.git' }) })
  noRepo(dir)
  await w.request('finding.act', close('f1', true))
  assert.deepEqual(ghCalls(calls), [['issue', 'close', '5', '--repo', 'acme/app', '--reason', 'not planned']])
  assert.equal(byId(host, 'f1').state, 'closed')
  // Without the flag, or with no issue, no gh call is made.
  await w.request('finding.act', close('f3'))
  await w.request('finding.act', close('f2', true))
  assert.equal(ghCalls(calls).length, 1)
  assert.equal(byId(host, 'f3').state, 'closed')
})

test('a failed issue close leaves the finding closed and says so in its history', async () => {
  const calls: string[][] = []
  const { dir, host, w } = await seeded([finding('f1', { state: 'kept', ...withIssue })], { runner: ghRunner(calls, { remote: 'git@github.com:acme/app.git', failClose: 'HTTP 403' }) })
  noRepo(dir)
  const r = await w.request('finding.act', close('f1', true))
  assert.ok(r.undo)
  const f = byId(host, 'f1')
  assert.equal(f.state, 'closed')
  assert.match(f.history.at(-1)!.text, /^Couldn't close issue #5: .*HTTP 403/)
  assert.deepEqual(changedPosts(w), [{ project: 'app' }])
  // The undo token still matches what was stored.
  await w.request('findings.undo', { project: 'app', token: r.undo! })
  assert.equal(byId(host, 'f1').state, 'kept')
})

test('closing with closeIssue when gh is missing refuses and leaves the finding as it was', async () => {
  const { host, w } = await seeded([finding('f1', { state: 'kept', ...withIssue })], { settings: { ghPath: '' } })
  worker.setExists(() => false)
  cleanup.push(() => worker.setExists(existsSync))
  await assert.rejects(w.request('finding.act', close('f1', true)), /GitHub's gh command isn't installed\./)
  assert.equal(byId(host, 'f1').state, 'kept')
})

/** Fake orca: launches answer s1, s2, ...; `agent list` lists `live`; renames and launches are recorded. */
function chatRunner(calls: string[][], live: string[]): Runner {
  let n = 0
  return async (cmd, args) => {
    calls.push(args)
    if (args[0] === 'agent' && args[1] === 'launch') return { code: 0, stdout: JSON.stringify({ result: { outcome: { sessionId: `s${++n}` } } }), stderr: '' }
    if (args[0] === 'agent' && args[1] === 'list') return { code: 0, stdout: JSON.stringify({ result: { agents: live.map((s) => ({ orcaSessionId: s, kind: 'chat', state: 'idle' })) } }), stderr: '' }
    return fakeRunner()(cmd, args)
  }
}
const launches = (calls: string[][]) => calls.filter((a) => a[0] === 'agent' && a[1] === 'launch')

test('discuss.start launches a focused chat in the checkout, names it, records it, and returns to it while it is listed', async () => {
  const calls: string[][] = [], live: string[] = []
  const { dir, host, w } = await seeded([finding('f1', { title: 'T'.repeat(70) })], { runner: chatRunner(calls, live) })
  const first = await w.request('discuss.start', { project: 'app', id: 'f1' })
  const title = `Discuss: ${'T'.repeat(70)}`.slice(0, 59) + '…'
  assert.deepEqual(first, { chat: 's1', title, existing: false })
  assert.equal(title.length, 60)
  const l = launches(calls)[0]
  assert.equal(l[l.indexOf('--worktree') + 1], `path:${dir}`)
  assert.ok(l.includes('--focus'))
  assert.deepEqual(calls.find((a) => a[0] === 'chat'), ['chat', 'rename', '--session', 's1', '--name', title])
  const prompt = read(join(`${dir}-files`, 'app', 'prompts', 'discuss-f1.md'))
  assert.ok(prompt.includes(join(fd(dir), 'f1', 'finding.md')) && prompt.includes(join(fd(dir), 'f1', 'notes.md')))
  assert.ok(existsSync(join(fd(dir), 'f1', 'finding.md')))
  assert.equal(byId(host, 'f1').discussion, 's1')
  assert.equal(byId(host, 'f1').history.at(-1)?.text, 'Discussed')
  assert.deepEqual(changedPosts(w), [{ project: 'app', finding: 'f1' }])
  // Still listed: nothing new is launched.
  live.push('s1')
  assert.deepEqual(await w.request('discuss.start', { project: 'app', id: 'f1' }), { chat: 's1', title, existing: true })
  assert.equal(launches(calls).length, 1)
  // Gone from the list: a new chat.
  live.length = 0
  assert.deepEqual(await w.request('discuss.start', { project: 'app', id: 'f1' }), { chat: 's2', title, existing: false })
  assert.equal(byId(host, 'f1').discussion, 's2')
})

test('discuss.start refuses a second start while one is launching, and a finding that is gone', async () => {
  const calls: string[][] = []
  const { w } = await seeded([finding('f1')], { runner: chatRunner(calls, []) })
  const both = await Promise.allSettled([w.request('discuss.start', { project: 'app', id: 'f1' }), w.request('discuss.start', { project: 'app', id: 'f1' })])
  assert.deepEqual(both.map((r) => r.status), ['fulfilled', 'rejected'])
  assert.match(String((both[1] as PromiseRejectedResult).reason?.message), /That discussion is already starting\./)
  assert.equal(launches(calls).length, 1)
  await assert.rejects(w.request('discuss.start', { project: 'app', id: 'nope' }), /no longer on the list/)
})

test('setup.start launches one chat named Set up personas, in the checkout, with the filled setup prompt', async () => {
  const calls: string[][] = []
  const { dir, host, w } = await seeded([], { runner: chatRunner(calls, []) })
  assert.deepEqual(await w.request('setup.start', { project: 'app' }), { chat: 's1', existing: false })
  const l = launches(calls)[0]
  assert.equal(l[l.indexOf('--worktree') + 1], `path:${dir}`)
  assert.ok(l.includes('--surface') && l.includes('chat') && l.includes('--focus'))
  assert.deepEqual(calls.find((a) => a[0] === 'chat'), ['chat', 'rename', '--session', 's1', '--name', 'Set up personas'])
  const prompt = read(join(`${dir}-files`, 'app', 'prompts', 'setup.md'))
  assert.ok(prompt.includes(dir) && !prompt.includes('{root}'))
  assert.deepEqual(host.data().storage['setup:app'], { chat: 's1' })
})

test('setup.start again while its chat is open says existing; after it was closed it launches a new one', async () => {
  const calls: string[][] = [], live: string[] = []
  const { w } = await seeded([], { runner: chatRunner(calls, live) })
  await w.request('setup.start', { project: 'app' })
  live.push('s1')
  assert.deepEqual(await w.request('setup.start', { project: 'app' }), { chat: 's1', existing: true })
  assert.equal(launches(calls).length, 1)
  live.length = 0
  assert.deepEqual(await w.request('setup.start', { project: 'app' }), { chat: 's2', existing: false })
  assert.equal(launches(calls).length, 2)
})

test('two setup.start at once launch one chat', async () => {
  const calls: string[][] = []
  const { w } = await seeded([], { runner: chatRunner(calls, []) })
  const both = await Promise.allSettled([w.request('setup.start', { project: 'app' }), w.request('setup.start', { project: 'app' })])
  assert.deepEqual(both.map((r) => r.status), ['fulfilled', 'rejected'])
  assert.match(String((both[1] as PromiseRejectedResult).reason?.message), /Setup is already starting\./)
  assert.equal(launches(calls).length, 1)
})

test("setup.start works with a persona.studio that doesn't load", async () => {
  const calls: string[][] = []
  const { dir, w } = await seeded([], { runner: chatRunner(calls, []) })
  writeFileSync(join(dir, 'persona.studio'), '{"port": "x"}')
  assert.deepEqual(await w.request('setup.start', { project: 'app' }), { chat: 's1', existing: false })
  assert.ok(read(join(`${dir}-files`, 'app', 'prompts', 'setup.md')).includes('docs/personas'))
})

test("the setup chat's turn ending posts changed for its project", async () => {
  const { w } = await seeded([], { runner: chatRunner([], []) })
  await w.request('setup.start', { project: 'app' })
  await w.emit('agent.status.changed', { workspaceId: null, paneKey: 'structured-agent-session-s9:x', state: 'done', receivedAt: 1 })
  assert.deepEqual(changedPosts(w), [])
  await w.emit('agent.status.changed', { workspaceId: null, paneKey: 'structured-agent-session-s1:x', state: 'done', receivedAt: 1 })
  assert.deepEqual(changedPosts(w), [{ project: 'app' }])
})

/** Fake git, gh and orca for work. `pr` is what gh lists, `head` and `merged` what git says of branch fix-it. Every worktree's main checkout is the project. */
function workRunner(calls: string[][], o: { pr?: { number: number; url: string; state: string } | null; head?: string; merged?: boolean; failCreate?: boolean } = {}): Runner {
  return async (_cmd, args) => {
    calls.push(args)
    if (args[0] === 'worktree' && args[1] === 'create') return o.failCreate ? { code: 1, stdout: '', stderr: 'no room\nmore' } : { code: 0, stdout: '{}', stderr: '' }
    if (args.includes('--git-common-dir')) return { code: 0, stdout: `${join(args[1].replace(/-wt$/, ''), '.git')}\n`, stderr: '' }
    if (args[0] === 'agent' && args[1] === 'launch') return { code: 0, stdout: JSON.stringify({ result: { outcome: { sessionId: 's1' } } }), stderr: '' }
    if (args.includes('rev-parse') && args.includes('HEAD')) return { code: 0, stdout: 'c0\n', stderr: '' }
    if (args.includes('rev-parse') && args.includes('fix-it')) return { code: 0, stdout: `${o.head ?? 'c0'}\n`, stderr: '' }
    if (args.includes('merge-base')) return { code: o.merged ? 0 : 1, stdout: '', stderr: '' }
    if (args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: JSON.stringify(o.pr ? [o.pr] : []), stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
}
/** The project and, while `live` holds them, the worktrees Orca lists. */
const listing = (live: { name: string; path: string; branch: string }[]) => (dir: string) =>
  ({ 'workspace.list': () => local({ name: 'app', path: dir, branch: 'main' }, ...live.map((x) => ({ ...x, path: x.path || `${dir}-wt` }))) })
const fixIt = { name: 'fix-it', path: '', branch: 'refs/heads/fix-it' }
const there = { ...fixIt, path: '/wt' }
const inProgress = (over: Partial<NonNullable<Finding['work']>> = {}): Finding =>
  finding('f1', { state: 'progress', work: { worktreePath: '/wt', branch: 'fix-it', base: 'main', start: 'c0', ...over } })
test('work.start makes the worktree, launches a focused briefed chat, and moves the finding to Working', async () => {
  const calls: string[][] = []
  const { dir, host, w } = await seeded([finding('f1', { state: 'kept', title: 'Enter drops the selection', issue: { number: 9, url: 'u' } })],
    { runner: workRunner(calls), results: listing([fixIt]) })
  const draft = await w.request('work.draft', { project: 'app', ids: ['f1'] })
  assert.deepEqual([draft.name, draft.base], ['enter-drops-selection', 'main'])
  assert.ok(draft.brief.includes(join(fd(dir), 'f1', 'finding.md')) && draft.brief.includes('Fixes #9'))
  assert.ok(draft.brief.includes('When the owner is happy with it, push the branch and open a PR against `main`.') && !draft.brief.includes('without waiting'))
  assert.ok(draft.autoBrief.includes('open a PR against `main` without waiting for the owner') && !draft.autoBrief.includes('owner is happy'))
  await assert.rejects(w.request('work.start', { project: 'app', ids: ['f1'], name: 'Bad Name', base: 'main' }), /lowercase letters/)
  assert.deepEqual(await w.request('work.start', { project: 'app', ids: ['f1'], name: 'fix-it', base: 'main' }), { ok: true })
  await until(() => byId(host, 'f1').state === 'progress', 'the finding to be Working')
  assert.deepEqual(byId(host, 'f1').work, { worktreePath: `${dir}-wt`, branch: 'fix-it', workspaceId: 'ws1', chat: 's1', base: 'main', start: 'c0' })
  assert.equal(byId(host, 'f1').history.at(-1)?.text, 'Work started in fix-it')
  assert.deepEqual(calls.find((a) => a[0] === 'worktree'), ['worktree', 'create', '--repo', `path:${dir}`, '--name', 'fix-it', '--branch', 'fix-it',
    '--base-branch', 'main', '--setup', 'run', '--no-parent', '--json'])
  const l = launches(calls)[0]
  assert.ok(l.includes('--focus') && l[l.indexOf('--worktree') + 1] === `path:${dir}-wt`)
  assert.deepEqual(calls.find((a) => a[0] === 'chat'), ['chat', 'rename', '--session', 's1', '--name', 'Worktree: fix-it'])
  assert.ok(read(join(`${dir}-files`, 'app', 'prompts', 'work-f1.md')).includes('Fixes #9'))
  assert.deepEqual(changedPosts(w).at(-1), { project: 'app', finding: 'f1' })
  await assert.rejects(w.request('work.start', { project: 'app', ids: ['f1'], name: 'fix-it', base: 'main' }), /Only a kept finding/)
})

test('work.start on several findings makes one worktree for all, briefed on every one, and moves them all to Working', async () => {
  const calls: string[][] = []
  const { dir, host, w } = await seeded([finding('f1', { state: 'kept', title: 'Enter drops the selection', issue: { number: 9, url: 'u' } }),
    finding('f2', { state: 'kept', title: 'Undo forgets colours', issue: { number: 11, url: 'u' } }), finding('f3', { state: 'new' })],
  { runner: workRunner(calls), results: listing([{ ...fixIt, name: 'fix-f1-f2', branch: 'refs/heads/fix-f1-f2' }]) })
  const draft = await w.request('work.draft', { project: 'app', ids: ['f1', 'f2'] })
  assert.equal(draft.name, 'fix-f1-f2')
  assert.ok(draft.brief.startsWith('You are fixing 2 findings from Persona Studio:'))
  for (const id of ['f1', 'f2']) assert.ok(draft.brief.includes(join(fd(dir), id, 'finding.md')) && draft.brief.includes(join(fd(dir), id, 'notes.md')))
  assert.ok(draft.brief.includes('`Fixes #9`, `Fixes #11`') && draft.brief.includes('Keep to these findings.'))
  await assert.rejects(w.request('work.start', { project: 'app', ids: ['f1', 'f3'], name: 'fix-f1-f3', base: 'main' }), /Only kept findings can be started\./)
  await w.request('work.start', { project: 'app', ids: ['f1', 'f2'], name: 'fix-f1-f2', base: 'main' })
  await until(() => byId(host, 'f2').state === 'progress', 'both findings to be Working')
  assert.equal(calls.filter((a) => a[0] === 'worktree' && a[1] === 'create').length, 1)
  assert.equal(launches(calls).length, 1)
  assert.deepEqual(byId(host, 'f1').work, byId(host, 'f2').work)
  assert.equal(byId(host, 'f1').work!.branch, 'fix-f1-f2')
  assert.ok(read(join(`${dir}-files`, 'app', 'prompts', 'work-f1-f2.md')).includes('Undo forgets colours'))
})

test('work.start with each makes a worktree per finding, named from its title, numbered when two titles match, each briefed to open its PR when asked', async () => {
  const calls: string[][] = []
  const names = ['enter-drops-selection', 'enter-drops-selection-2']
  const { dir, host, w } = await seeded([finding('f1', { state: 'kept', title: 'Enter drops the selection' }), finding('f2', { state: 'kept', title: 'Enter drops the selection' })],
    { runner: workRunner(calls), results: listing(names.map((n) => ({ name: n, path: "", branch: `refs/heads/${n}` }))) })
  await w.request('work.start', { project: 'app', ids: ['f1', 'f2'], name: 'ignored', base: 'main', each: true, autoPr: true })
  await until(() => byId(host, 'f1').state === 'progress' && byId(host, 'f2').state === 'progress', 'both findings to be Working')
  for (const id of ['f1', 'f2']) assert.ok(read(join(`${dir}-files`, 'app', 'prompts', `work-${id}.md`)).includes('without waiting for the owner'), id)
  assert.deepEqual(calls.filter((a) => a[0] === 'worktree' && a[1] === 'create').map((a) => a[a.indexOf('--name') + 1]).sort(), names)
  assert.deepEqual([byId(host, 'f1').work!.branch, byId(host, 'f2').work!.branch].sort(), names)
})

test('a worktree that fails to make leaves the finding Kept, with the reason in its history', async () => {
  const { host, w } = await seeded([finding('f1', { state: 'kept' })], { runner: workRunner([], { failCreate: true }), results: listing([]) })
  await w.request('work.start', { project: 'app', ids: ['f1'], name: 'fix-it', base: 'main' })
  await until(() => byId(host, 'f1').history.length > 0, 'the failure to be recorded')
  assert.equal(byId(host, 'f1').state, 'kept')
  assert.match(byId(host, 'f1').history.at(-1)!.text, /^Couldn't start work: orca worktree failed: no room/)
  assert.deepEqual(changedPosts(w).at(-1), { project: 'app', finding: 'f1' })
  // It can be started again once it settles.
  await until(() => w.request('work.start', { project: 'app', ids: ['f1'], name: 'fix-it', base: 'main' }).then(() => true, () => false), 'the first start to settle')
})

test('the tick records a PR, then its merge moves the finding to Fixed', async () => {
  let pr: { number: number; url: string; state: string } | null = { number: 7, url: 'https://x/pull/7', state: 'OPEN' }
  const { host, w } = await seeded([inProgress(), finding('f2')], { runner: async (c, a) => workRunner([], { pr })(c, a), results: listing([there]) })
  await w.request('tick')
  assert.deepEqual(byId(host, 'f1').work!.pr, { number: 7, url: 'https://x/pull/7', state: 'open' })
  assert.equal(byId(host, 'f1').history.at(-1)?.text, 'PR #7 opened')
  // Within the poll interval nothing is looked at again.
  pr = { ...pr, state: 'MERGED' }
  await w.request('tick')
  assert.equal(byId(host, 'f1').state, 'progress')
  let t = Date.now() + 6 * 60_000
  worker.setNow(() => t)
  cleanup.push(() => worker.setNow(() => Date.now()))
  await w.request('tick')
  const f = byId(host, 'f1')
  assert.deepEqual([f.state, f.work!.pr!.state, f.confirmed, f.history.at(-1)?.text], ['fixed', 'merged', undefined, 'PR #7 merged'])
  assert.ok(typeof f.fixedAt === 'number')
  assert.deepEqual(changedPosts(w).at(-1), { project: 'app' })
})

test('a PR closed without merging, or a removed worktree, puts the finding back in Kept', async () => {
  const closed = await seeded([inProgress()], { runner: workRunner([], { pr: { number: 7, url: 'u', state: 'CLOSED' } }), results: listing([there]) })
  await closed.w.request('tick')
  assert.deepEqual([byId(closed.host, 'f1').state, byId(closed.host, 'f1').work, byId(closed.host, 'f1').history.at(-1)?.text], ['kept', undefined, 'PR #7 closed without merging'])
  const gone = await seeded([inProgress()], { runner: workRunner([]), results: listing([]) })
  await gone.w.request('tick')
  assert.deepEqual([byId(gone.host, 'f1').state, byId(gone.host, 'f1').history.at(-1)?.text], ['kept', 'The worktree was removed with nothing merged'])
})

test('without gh, a branch still at its start commit is not merged; one that moved and is in origin is', async () => {
  const realExists = (p: string) => existsSync(p)
  cleanup.push(() => worker.setExists(realExists))
  worker.setExists((p) => !p.includes('gh'))
  const still = await seeded([inProgress()], { settings: { ghPath: '' }, runner: workRunner([], { head: 'c0', merged: true }), results: listing([there]) })
  await still.w.request('tick')
  assert.equal(byId(still.host, 'f1').state, 'progress')
  const moved = await seeded([inProgress()], { settings: { ghPath: '' }, runner: workRunner([], { head: 'c9', merged: true }), results: listing([there]) })
  await moved.w.request('tick')
  assert.deepEqual([byId(moved.host, 'f1').state, byId(moved.host, 'f1').history.at(-1)?.text], ['fixed', 'Merged into main'])
  // A finding with no start commit isn't watched without gh.
  const loop = await seeded([inProgress({ start: undefined })], { settings: { ghPath: '' }, runner: workRunner([], { head: 'c9', merged: true }), results: listing([there]) })
  await loop.w.request('tick')
  assert.equal(byId(loop.host, 'f1').state, 'progress')
  // Nor does a removed worktree (usually removed after the merge) say it merged nothing.
  const removed = await seeded([inProgress({ start: undefined })], { settings: { ghPath: '' }, runner: workRunner([]), results: listing([]) })
  await removed.w.request('tick')
  assert.deepEqual([byId(removed.host, 'f1').state, byId(removed.host, 'f1').history], ['progress', []])
})

test('a second work.start while one is making its worktree is refused', async () => {
  const { w } = await seeded([finding('f1', { state: 'kept' })], { runner: workRunner([]), results: listing([fixIt]) })
  const both = await Promise.allSettled([1, 2].map(() => w.request('work.start', { project: 'app', ids: ['f1'], name: 'fix-it', base: 'main' })))
  assert.deepEqual(both.map((r) => r.status), ['fulfilled', 'rejected'])
  assert.match(String((both[1] as PromiseRejectedResult).reason?.message), /That finding's work is already starting\./)
})

test('overview.get with a broken persona.studio says why, and logs it once', async () => {
  const { dir, w } = await seeded()
  writeFileSync(join(dir, 'persona.studio'), '{"port": "high"}')
  const o = await w.request('overview.get', { project: 'app' })
  assert.match(o.configError!, /"port" must be a number/)
  assert.deepEqual(o.personas, [])
  await w.request('overview.get', { project: 'app' })
  assert.equal(w.logs.filter((l) => /"port" must be a number/.test(l)).length, 1)
})

test('theme.get answers the terminal background Orca saved, and null without a settings store or a colour', async () => {
  const home = mkdtempSync(join(tmpdir(), 'home-')), was = process.env.HOME
  cleanup.push(() => { process.env.HOME = was; rmSync(home, { recursive: true, force: true }) })
  process.env.HOME = home
  let answer = { code: 0, stdout: '#1c1c1c\n', stderr: '' }
  const base = fakeRunner()
  const { w } = await seeded([], { runner: async (cmd, args, opts) => (cmd.endsWith('sqlite3') ? answer : base(cmd, args, opts)) })
  assert.deepEqual(await w.request('theme.get'), { canvas: null })
  const store = join(home, 'Library', 'Application Support', 'orca', 'profiles', 'local-default')
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, 'profile-state.db'), '')
  assert.deepEqual(await w.request('theme.get'), { canvas: '#1c1c1c' })
  answer = { code: 0, stdout: '\n', stderr: '' }
  assert.deepEqual(await w.request('theme.get'), { canvas: null })
  answer = { code: 1, stdout: '#fff', stderr: 'no such table' }
  assert.deepEqual(await w.request('theme.get'), { canvas: null })
})
