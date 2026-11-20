import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import type { Focus, Overview, PersonaRow } from './protocol'
import * as panel from './panel'

const project: Focus = { kind: 'project', id: 'app', name: 'app · ux', personas: 2 }
const row = (id: string, name: string, tag: string, fresh = 0): PersonaRow => ({ id, name, tag, state: 'idle', fresh, runs: 1, recheck: 0 })
const overview = (o: Partial<Overview> = {}): Overview => ({
  personas: [row('dex', 'Dex', 'draws by hand', 2), row('maya', 'Maya', '')],
  counts: { new: 3, kept: 1, progress: 0, fixed: 4, closed: 9 }, hasGh: false, canRun: null, configError: null, ...o })

/** A host whose worker answers the focus and overview, recording every tab.open and counting overview fetches. */
function boot(focus: Focus = project, o: () => Overview = () => overview(), extra: Record<string, unknown> = {}) {
  const calls: unknown[] = []
  const setups: unknown[] = []
  const n = { overviews: 0 }
  const requests: Record<string, unknown> = {
    'setup.start': (input: unknown) => { setups.push(input); return { chat: 's1', existing: false } },
    'focus.get': focus,
    'overview.get': () => { n.overviews++; return o() },
    'tab.open': (input: unknown) => { calls.push(input); return { ok: true } },
    ...extra }
  return { host: mockHost({ requests }), calls, setups, n }
}
const clean = (p: Awaited<ReturnType<typeof mount>>) => {
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.refusals, [])
  assert.deepEqual(p.warnings, [])
}

test('no project says why, with nothing to press and no heading', async () => {
  const none = await mount(panel, { host: boot({ kind: 'none' }).host })
  assert.ok(none.find({ text: 'Open a project in Orca to see its personas.' }))
  assert.equal(none.find({ type: 'Heading' }), null)
  assert.equal(none.find({ type: 'Button' }), null)
  clean(none)
  const notGit = await mount(panel, { host: boot({ kind: 'notGit', name: 'notes' }).host })
  assert.equal(notGit.find({ type: 'Heading' }), null)
  assert.ok(notGit.find({ text: "notes isn't a git repository." }))
  clean(notGit)
})

test('a project with no personas and no findings shows the invitation and only Set up personas, which starts setup', async () => {
  const { host, calls, setups } = boot(project, () => overview({ personas: [], counts: { new: 0, kept: 0, progress: 0, fixed: 0, closed: 0 } }))
  const p = await mount(panel, { host })
  assert.equal(p.find({ type: 'Heading' }), null)
  assert.ok(p.find({ text: "See your app through your users' eyes" }))
  assert.equal(p.findAll({ type: 'Image' }).length, 1)
  assert.deepEqual(p.findAll({ type: 'Button' }).map((x) => x.text), ['Set up personas'])
  // The setup steps, numbered, so the owner knows what pressing the button starts.
  assert.ok(p.find({ text: /Setup is a quick chat with an agent/ }))
  assert.deepEqual(['1', '2', '3', '4', '5'].map((n) => p.find({ type: 'Text', text: n }) !== null), [true, true, true, true, true])
  assert.ok(p.find({ text: /learns what your app does/ }) && p.find({ text: /Run your personas/ }))
  await p.press({ type: 'Button', text: 'Set up personas' })
  assert.deepEqual(setups, [{ project: 'app' }])
  assert.deepEqual(calls, [])
  await p.press({ type: 'Link', text: 'How it works' })
  assert.deepEqual(calls, [{ project: 'app', show: { persona: null } }])
  clean(p)
})

test('with no personas but converted findings, the counts and Set up personas show', async () => {
  const { host, setups } = boot(project, () => overview({ personas: [] }))
  const p = await mount(panel, { host })
  assert.ok(p.find({ text: "See your app through your users' eyes" }))
  assert.ok(p.find({ type: 'Text', text: '3' }) && p.find({ type: 'Link', text: 'New' }))
  assert.equal(p.find({ text: 'Open Studio' }), null)
  await p.press({ text: 'Set up personas' })
  assert.deepEqual(setups, [{ project: 'app' }])
  clean(p)
})

test('Set up personas starts setup and says where it is', async () => {
  const none = () => overview({ personas: [] })
  const a = boot(project, none)
  const p = await mount(panel, { host: a.host })
  await p.press({ type: 'Button', text: 'Set up personas' })
  assert.deepEqual(a.setups, [{ project: 'app' }])
  assert.deepEqual(a.calls, [])
  assert.ok(p.find({ type: 'Callout', text: 'Setup is open in the "Set up personas" chat. Your personas will appear here once they\'re saved.' }))
  clean(p)
  const b = boot(project, none, { 'setup.start': () => ({ chat: 's1', existing: true }) })
  const q = await mount(panel, { host: b.host })
  await q.press({ type: 'Button', text: 'Set up personas' })
  assert.ok(q.find({ type: 'Callout', text: 'Setup is already open in your tabs as "Set up personas".' }))
  clean(q)
  const c = boot(project, none, { 'setup.start': () => { throw hostError('action_failed', 'Setup is already starting.') } })
  const r = await mount(panel, { host: c.host })
  await r.press({ type: 'Button', text: 'Set up personas' })
  assert.ok(r.find({ type: 'Callout', text: /Setup is already starting/ }))
  clean(r)
})

test('the setup notice stays with its project and goes once it has personas', async () => {
  let f: Focus = project
  let personas: PersonaRow[] = []
  const { host } = boot(f, () => overview({ personas }), { 'focus.get': () => f })
  const p = await mount(panel, { host })
  await p.press({ type: 'Button', text: 'Set up personas' })
  const text = 'Setup is open in the "Set up personas" chat. Your personas will appear here once they\'re saved.'
  assert.ok(p.find({ type: 'Callout', text }))
  f = { kind: 'project', id: 'other', name: 'other · ux', personas: 0 }
  await p.post('focus', f)
  assert.ok(!p.find({ type: 'Callout', text }))
  f = project
  personas = [row('dex', 'Dex', '')]
  await p.post('focus', f)
  assert.ok(!p.find({ type: 'Callout', text }))
  clean(p)
})

test('a project with personas shows four counts in order, each persona, its tag and a new badge only when fresh', async () => {
  const p = await mount(panel, { host: boot().host })
  assert.equal(p.find({ type: 'Heading' }), null)
  assert.deepEqual(p.findAll({ type: 'Link' }).map((b) => b.text), ['New', 'Kept', 'Working', 'Fixed', 'Dex', 'Maya'])
  assert.deepEqual(['3', '1', '0', '4'].map((n) => p.find({ type: 'Text', text: n }) !== null), [true, true, true, true])
  assert.deepEqual(p.findAll({ type: 'Button' }).map((b) => b.text), ['Run all idle', 'Open Studio', 'View', 'Run again', 'View', 'Run again'])
  assert.equal(p.find({ text: 'Closed' }), null)
  assert.ok(p.find({ text: /^Dex/ }) && p.find({ text: 'Maya' }))
  assert.ok(p.find({ text: /draws by hand/ }))
  assert.ok(p.find({ type: 'Text', text: '2 New' }) && !p.find({ type: 'Badge' }))
  assert.equal(p.find({ text: "See your app through your users' eyes" }), null)
  assert.equal(p.find({ type: 'Callout' }), null)
  clean(p)
})

test('a count tile opens the tab on that list', async () => {
  const { host, calls } = boot()
  const p = await mount(panel, { host })
  await p.press({ type: 'Link', text: 'Kept' })
  await p.press({ type: 'Link', text: 'Working' })
  assert.deepEqual(calls, [{ project: 'app', show: { state: 'kept' } }, { project: 'app', show: { state: 'progress' } }])
  clean(p)
})

test('a persona row opens the tab filtered to it', async () => {
  const { host, calls } = boot()
  const p = await mount(panel, { host })
  await p.press({ text: 'Maya' })
  assert.deepEqual(calls, [{ project: 'app', show: { persona: 'maya' } }])
  clean(p)
})

test('Open Studio opens the tab with no persona chosen', async () => {
  const { host, calls } = boot()
  const p = await mount(panel, { host })
  await p.press({ type: 'Button', text: 'Open Studio' })
  assert.deepEqual(calls, [{ project: 'app', show: { persona: null } }])
  clean(p)
})

test('a changed post for this project refetches, for another project it does not', async () => {
  let counts = { new: 3, kept: 1, progress: 0, fixed: 4, closed: 0 }
  const { host, n } = boot(project, () => overview({ counts }))
  const p = await mount(panel, { host })
  const before = n.overviews
  counts = { ...counts, new: 5 }
  await p.post('changed', { project: 'other' })
  assert.equal(n.overviews, before)
  assert.ok(p.find({ type: 'Text', text: '3' }) && p.find({ type: 'Link', text: 'New' }))
  await p.post('changed', { project: 'app' })
  assert.equal(n.overviews, before + 1)
  assert.ok(p.find({ type: 'Text', text: '5' }) && p.find({ type: 'Link', text: 'New' }))
  clean(p)
})

test('a focus post refetches everything', async () => {
  let f: Focus = { kind: 'none' }
  const { host, n } = boot(f, () => overview(), { 'focus.get': () => f })
  const p = await mount(panel, { host })
  assert.equal(n.overviews, 0)
  f = project
  await p.post('focus', f)
  assert.equal(n.overviews, 1)
  assert.ok(p.find({ type: 'Text', text: '3' }) && p.find({ type: 'Link', text: 'New' }))
  clean(p)
})

test('a refusal shows in a danger callout; a timeout says it is still working', async () => {
  const refuse = boot(project, undefined, { 'tab.open': () => { throw hostError('action_failed', 'No workspace is open here.') } })
  const p = await mount(panel, { host: refuse.host })
  await p.press({ type: 'Button', text: 'Open Studio' })
  assert.ok(p.find({ type: 'Callout', text: /No workspace is open here/ }))
  clean(p)
  const slow = boot(project, undefined, { 'tab.open': () => { throw hostError('timeout', 'Took too long.') } })
  const q = await mount(panel, { host: slow.host })
  await q.press({ type: 'Link', text: 'New' })
  assert.ok(q.find({ text: /Still working on it/ }))
  assert.equal(q.find({ text: /Took too long/ }), null)
  clean(q)
})

test('the panel keeps nothing in storage', async () => {
  const p = await mount(panel, { host: boot().host })
  await p.press({ type: 'Link', text: 'Kept' })
  assert.deepEqual(p.persisted.storage, {})
  clean(p)
})

test('a refresh error clears when a later changed refresh succeeds', async () => {
  let fail = false
  const { host } = boot(project, () => { if (fail) throw hostError('action_failed', 'The overview broke.'); return overview() })
  const p = await mount(panel, { host })
  fail = true
  await p.post('changed', { project: 'app' })
  assert.ok(p.find({ type: 'Callout', text: /The overview broke/ }))
  fail = false
  await p.post('changed', { project: 'app' })
  assert.equal(p.find({ type: 'Callout' }), null)
  clean(p)
})

test('"Still working" clears when the worker\'s changed post arrives', async () => {
  const { host } = boot(project, undefined, { 'tab.open': () => { throw hostError('timeout', 'Took too long.') } })
  const p = await mount(panel, { host })
  await p.press({ type: 'Link', text: 'New' })
  assert.ok(p.find({ text: /Still working on it/ }))
  await p.post('changed', { project: 'app' })
  assert.equal(p.find({ text: /Still working on it/ }), null)
  clean(p)
})

test('a refused press stays through a changed post', async () => {
  const { host } = boot(project, undefined, { 'tab.open': () => { throw hostError('action_failed', 'No workspace is open here.') } })
  const p = await mount(panel, { host })
  await p.press({ type: 'Link', text: 'New' })
  await p.post('changed', { project: 'app' })
  assert.ok(p.find({ type: 'Callout', text: /No workspace is open here/ }))
  clean(p)
})

const running = (): Overview => overview({ personas: [{ ...row('dex', 'Dex', 'draws by hand'), state: 'running', line: 'Opening the editor', chat: "Dex's run" },
  row('maya', 'Maya', ''), { ...row('lea', 'Lea', ''), runs: 0 }, { ...row('walt', 'Walt', ''), error: 'The app would not start.' }] })

test('a running row shows its line and Stop, which requests run.stop; Run and Run again ask for the right thing', async () => {
  const started: unknown[] = [], stopped: unknown[] = []
  const { host, calls } = boot(project, running, { 'run.start': (i: unknown) => { started.push(i); return { ok: true } }, 'run.stop': (i: unknown) => { stopped.push(i); return { ok: true } } })
  const p = await mount(panel, { host })
  assert.ok(p.find({ text: /Opening the editor/ }))
  await p.press({ type: 'Button', text: 'Stop' })
  assert.deepEqual(stopped, [{ project: 'app', persona: 'dex' }])
  await p.press({ type: 'Button', text: 'Run' })
  assert.deepEqual(started, [{ project: 'app', persona: 'lea' }])
  assert.deepEqual(p.findAll({ type: 'Button', text: 'Run again' }).length, 2)
  await p.press({ type: 'Button', text: 'Run again' })
  assert.deepEqual(calls, [{ project: 'app', show: { persona: 'maya', run: true } }])
  // Why it failed is on the persona's page; the row only says it failed.
  assert.equal(p.find({ text: /The app would not start/ }), null)
  assert.ok(p.find({ type: 'Text', text: 'Failed' }))
  clean(p)
})

test('Run all idle starts each idle persona; a refusal shows and the rest still start', async () => {
  const started: string[] = []
  const { host } = boot(project, running, { 'run.start': (i: { persona: string }) => {
    started.push(i.persona)
    if (i.persona === 'maya') throw new Error('Maya cannot run.')
    return { ok: true } } })
  const p = await mount(panel, { host })
  await p.press({ type: 'Button', text: 'Run all idle' })
  assert.deepEqual(started, ['maya', 'lea', 'walt'])
  assert.ok(p.find({ text: /Maya cannot run/ }))
})

test('when runs cannot start, the reason replaces every Run button', async () => {
  const p = await mount(panel, { host: boot(project, () => ({ ...running(), canRun: 'Add a persona.studio file first.' })).host })
  assert.ok(p.find({ text: 'Add a persona.studio file first.' }))
  assert.deepEqual(p.findAll({ type: 'Button' }).map((b) => b.text).filter((t) => /^Run/.test(t)), [])
})

test('a persona.studio that does not load says why above everything, not that there are no personas', async () => {
  const why = 'persona.studio: "port" must be a number.'
  const p = await mount(panel, { host: boot(project, () => overview({ personas: [], configError: why, canRun: why })).host })
  const callouts = p.findAll({ type: 'Callout' })
  assert.equal(callouts.length, 1)
  assert.ok(callouts[0].text.includes(why))
  assert.equal(p.find({ text: "See your app through your users' eyes" }), null)
  clean(p)
})

test('a run still preparing shows its stage on its row', async () => {
  const p = await mount(panel, { host: boot(project, () => overview({ personas: [{ ...row('dex', 'Dex', ''), state: 'running', stage: 'Preparing' }] })).host })
  assert.ok(p.find({ text: /Preparing/ }))
  clean(p)
})

test('View opens the persona in the tab', async () => {
  const { host, calls } = boot()
  const p = await mount(panel, { host })
  await p.press({ type: 'Button', text: 'View' })
  assert.deepEqual(calls, [{ project: 'app', show: { persona: 'dex' } }])
  clean(p)
})

test('a running persona on a script step shows n/total beside its name, and the step without it below', async () => {
  const p = await mount(panel, { host: boot(project, () => overview({ personas: [{ ...row('dex', 'Dex', ''), state: 'running', stage: 'Using the app', line: 'Step 2 of 3: Make a checklist' }] })).host })
  assert.ok(p.find({ type: 'Text', text: '2/3' }))
  assert.ok(p.find({ type: 'Text', text: 'Using the app · Make a checklist' }))
  clean(p)
})

test('a running row shows its script step as n/total, and nothing when the line has no step', async () => {
  const stepping = () => overview({ personas: [{ ...row('dex', 'Dex', 'draws by hand'), state: 'running', line: 'Step 4 of 9: Opening the editor', chat: "Dex's run" }] })
  const p = await mount(panel, { host: boot(project, stepping).host })
  assert.ok(p.find({ type: 'Text', text: '4/9' }))
  clean(p)
  const q = await mount(panel, { host: boot(project, running).host })
  assert.equal(q.find({ type: 'Text', text: /^\d+\/\d+$/ }), null)
  clean(q)
})

test('uncommitted changes hold Run and Run all idle back with Run anyway; Cancel drops them', async () => {
  const started: unknown[] = []
  const { host } = boot(project, running, { 'run.start': (i: { anyway?: boolean }) => { started.push(i); return i.anyway ? { ok: true } : { uncommitted: 1 } } })
  const p = await mount(panel, { host })
  await p.press({ type: 'Button', text: 'Run all idle' })
  assert.ok(p.find({ text: '1 file has uncommitted changes. Commit them first, or run anyway to test your last commit.' }))
  await p.press({ type: 'Button', text: 'Run anyway' })
  const idle = ['maya', 'lea', 'walt']
  assert.deepEqual(started, [...idle.map((persona) => ({ project: 'app', persona })), ...idle.map((persona) => ({ project: 'app', persona, anyway: true }))])
  assert.equal(p.find({ type: 'Button', text: 'Run anyway' }), null)
  await p.press({ type: 'Button', text: 'Run' })
  await p.press({ type: 'Button', text: 'Cancel' })
  assert.equal(p.find({ text: /uncommitted changes/ }), null)
  clean(p)
})
