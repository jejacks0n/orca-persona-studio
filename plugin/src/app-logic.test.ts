import { assert, hostError, test } from 'orca/testing'
import { actionOf, applyShow, failureOf, isDarkColor, fieldOf, findingRefused, focusOf, notesRefused, refetchesFinding, refusedOf, rootClass, saveOf, settle, showsPersona, withDetail, type Act } from './app-logic'
import { freshUi, type Ui } from './app-view'
import type { Row } from './findings-view'
import type { Detail, PersonaDetail } from './protocol'

const row = (id: string, over: Partial<Row> = {}): Row => ({ id, title: `Title ${id}`, kind: 'bug', severity: 'major', state: 'new',
  personas: ['priya'], runs: 1, reopened: false, fresh: false, members: 0, reports: 1, latest: 1, ...over })
const ui = (over: Partial<Ui> = {}): Ui => ({ ...freshUi(), ...over })
const all = [row('a'), row('b'), row('c', { state: 'kept', issue: 4 })]
const act = (d: Record<string, string>, u = ui(), form?: Record<string, string>, shots?: Record<string, string | null>) =>
  actionOf(d, u, { project: 'p1', rows: all, form, shots })
/** The act's request, or a failure naming what came back instead. */
function request(a: Act) {
  if (!a || !('request' in a)) throw new Error(`not a request: ${JSON.stringify(a)}`)
  return a
}
function uiOf(a: Act, u: Ui) {
  if (!a || !('ui' in a)) throw new Error(`not a change to the tab: ${JSON.stringify(a)}`)
  return a.ui(u)
}
const detail = (id: string, notes: string, mtime: number): Detail => ({ finding: { id, title: id, kind: 'bug', labels: [], severity: 'major',
  state: 'new', reports: [], history: [], members: [] }, notes: { text: notes, mtime } })

test('Keep sends finding.act and, when it worked, sets the notice "Kept." with the undo token', () => {
  const u = ui({ open: 'a' })
  const a = request(act({ do: 'keep' }, u))
  assert.deepEqual(a.request, { name: 'finding.act', input: { project: 'p1', action: { type: 'keep', ids: ['a'] } } })
  assert.deepEqual(a.then!(u, { undo: 't1' }).notice, { text: 'Kept.', undo: 't1' })
  assert.deepEqual(a.then!(u, { undo: null }).notice, { text: 'Kept.' })
  // From the bulk bar: every pick, counted, and the picks clear.
  const b = request(act({ do: 'bulk-keep' }, ui({ picked: ['a', 'b'] })))
  assert.deepEqual(b.request.input, { project: 'p1', action: { type: 'keep', ids: ['a', 'b'] } })
  const after = b.then!(ui({ picked: ['a', 'b'] }), { undo: 't2' })
  assert.deepEqual([after.notice, after.picked], [{ text: 'Kept 2.', undo: 't2' }, []])
  assert.equal(act({ do: 'keep' }), null, 'nothing open, nothing to keep')
})

test('Close… opens the close dialog; closing it with a reason sends close with that reason and why', () => {
  assert.deepEqual(uiOf(act({ do: 'close' }, ui({ open: 'a' })), ui({ open: 'a' })).dialog, { type: 'close', ids: ['a'] })
  assert.deepEqual(uiOf(act({ do: 'bulk-close' }, ui({ picked: ['a', 'b'] })), ui()).dialog, { type: 'close', ids: ['a', 'b'] })
  const open = ui({ open: 'a', dialog: { type: 'close', ids: ['a'] } })
  const a = request(act({ do: 'submit' }, open, { reason: 'notABug', why: '  same as the export one  ' }))
  assert.deepEqual(a.request, { name: 'finding.act', input: { project: 'p1', action: { type: 'close', ids: ['a'], reason: 'notABug', why: 'same as the export one' } } })
  assert.deepEqual(a.then!(open, { undo: 't1' }).notice, { text: 'Closed as "Not a bug".', undo: 't1' })
  // An empty why is left out, and a bulk close counts.
  const bulk = ui({ picked: ['a', 'b'], dialog: { type: 'close', ids: ['a', 'b'] } })
  const b = request(act({ do: 'submit' }, bulk, { reason: 'wontFix', why: ' ' }))
  assert.deepEqual(b.request.input, { project: 'p1', action: { type: 'close', ids: ['a', 'b'], reason: 'wontFix' } })
  const after = b.then!(bulk, { undo: null })
  assert.deepEqual([after.notice, after.picked], [{ text: 'Closed 2 as "Won\'t fix".' }, []])
  assert.equal(act({ do: 'submit' }, open, { reason: 'nope' }), null, 'no such reason')
  assert.equal(act({ do: 'close' }), null, 'nothing open')
})

test("the close dialog's issue box sends closeIssue: true when ticked and leaves it out when not", () => {
  const open = ui({ open: 'c', tab: 'kept', dialog: { type: 'close', ids: ['c'] } })
  const sent = (form: Record<string, string>) => (request(act({ do: 'submit' }, open, form)).request.input as { action: Record<string, unknown> }).action
  assert.equal(sent({ reason: 'duplicate', closeIssue: 'true' }).closeIssue, true)
  assert.ok(!('closeIssue' in sent({ reason: 'duplicate', closeIssue: 'false' })))
  assert.ok(!('closeIssue' in sent({ reason: 'duplicate' })), 'no box, no field')
})

test('Group needs two picks: with one it sets the notice "Select two or more findings with ⌘-click or Shift-click, then press Group."', () => {
  const one = uiOf(act({ do: 'group' }, ui({ picked: ['a'] })), ui({ picked: ['a'] }))
  assert.deepEqual([one.notice, one.dialog], [{ text: 'Select two or more findings with ⌘-click or Shift-click, then press Group.' }, null])
  assert.deepEqual(uiOf(act({ do: 'group' }, ui({ picked: ['a', 'b'] })), ui({ picked: ['a', 'b'] })).dialog, { type: 'group', ids: ['a', 'b'] })
})

test('the group dialog sends the picked ids, the chosen lead and a typed title', () => {
  const open = ui({ picked: ['a', 'b'], dialog: { type: 'group', ids: ['a', 'b'] } })
  const a = request(act({ do: 'submit' }, open, { lead: 'b', title: ' Shapes vanish ' }))
  assert.deepEqual(a.request, { name: 'finding.act', input: { project: 'p1', action: { type: 'group', ids: ['a', 'b'], lead: 'b', title: 'Shapes vanish' } } })
  const after = a.then!(open, { undo: null })
  assert.deepEqual([after.notice, after.picked], [{ text: 'Grouped into "Shapes vanish".' }, []])
  // No title typed: the lead's title stays, and the notice names it.
  const b = request(act({ do: 'submit' }, open, { lead: 'b', title: '' }))
  assert.deepEqual(b.request.input, { project: 'p1', action: { type: 'group', ids: ['a', 'b'], lead: 'b' } })
  assert.deepEqual(b.then!(open, { undo: null }).notice, { text: 'Grouped into "Title b".' })
  assert.equal(act({ do: 'submit' }, open, { lead: 'z' }), null, 'the lead must be a pick')
})

test("Undo sends findings.undo with the notice's token", () => {
  const u = ui({ notice: { text: 'Closed as "Duplicate".', undo: 't9' } })
  const a = request(act({ do: 'undo' }, u))
  assert.deepEqual(a.request, { name: 'findings.undo', input: { project: 'p1', token: 't9' } })
  // Undo never claims anything about a GitHub issue.
  assert.deepEqual(a.then!(u, { ok: true }).notice, { text: 'Undone.' })
  assert.equal(act({ do: 'undo' }, ui({ notice: { text: 'Reopened.' } })), null, 'no token, nothing to undo')
})

test('Make an issue fetches the draft into the dialog; submitting sends the edited body, with the notes appended only when the box is ticked', () => {
  const u = ui({ open: 'c', tab: 'kept' })
  const a = request(act({ do: 'issue' }, u))
  assert.deepEqual(a.request, { name: 'issue.draft', input: { project: 'p1', id: 'c' } })
  const withDraft = a.then!(u, { title: 'Scrub drops shape', body: 'What Priya saw', notes: 'Look at the tween cache.' })
  assert.deepEqual(withDraft.dialog, { type: 'issue', title: 'Scrub drops shape', body: 'What Priya saw', notes: 'Look at the tween cache.' })
  assert.equal(a.then!(ui({ open: 'a' }), { title: 't', body: 'b', notes: '' }).dialog, null, 'the owner moved on: no dialog for a finding no longer open')
  const left = request(act({ do: 'submit' }, withDraft, { issueTitle: 'Scrubbing drops the shape', issueBody: 'Edited body', includeNotes: 'false' }))
  assert.deepEqual(left.request, { name: 'issue.create', input: { project: 'p1', id: 'c', title: 'Scrubbing drops the shape', body: 'Edited body' } })
  const ticked = request(act({ do: 'submit' }, withDraft, { issueTitle: 'Scrubbing drops the shape', issueBody: 'Edited body', includeNotes: 'true' }))
  assert.deepEqual(ticked.request.input, { project: 'p1', id: 'c', title: 'Scrubbing drops the shape', body: 'Edited body\n\nNotes:\nLook at the tween cache.' })
  assert.deepEqual(ticked.then!(withDraft, { number: 12, url: 'https://github.com/o/r/issues/12' }).notice, { text: 'Opened issue #12.' })
  // An issue needs a title: nothing is sent, and the notice says why.
  assert.deepEqual(uiOf(act({ do: 'submit' }, withDraft, { issueTitle: ' ', issueBody: 'b' }), withDraft).notice, { text: 'An issue needs a title.' })
})

test('choosing a list, a kind, a persona or typing a search changes the Ui and nothing else', () => {
  const u = ui({ persona: 'dex' })
  const only = (d: Record<string, string>) => {
    const a = act(d, u)
    assert.ok(a && 'ui' in a && !('request' in a) && !('link' in a), JSON.stringify(d))
    return uiOf(a, u)
  }
  assert.deepEqual(only({ do: 'tab', tab: 'fixed' }), { ...u, tab: 'fixed' })
  assert.deepEqual(only({ do: 'kind', kind: 'polish' }), { ...u, kind: 'polish' })
  assert.deepEqual(only({ do: 'persona', persona: 'priya' }), { ...u, persona: 'priya', view: 'detail' })
  assert.deepEqual(only({ do: 'persona', persona: 'dex' }), { ...u, persona: null }, 'the chosen persona again shows everyone')
  assert.deepEqual(only({ do: 'everyone' }), { ...u, persona: null })
  assert.deepEqual(fieldOf(u, 'q', 'scrub'), { ...u, q: 'scrub' })
  assert.equal(act({ do: 'tab', tab: 'nope' }, u), null)
  assert.equal(act({ do: 'kind', kind: 'nope' }, u), null)
  // Dialog fields are read when the dialog closes, not as they're typed.
  assert.equal(fieldOf(u, 'why', 'x'), u)
})

test('a show post switches list and persona and opens the named finding', () => {
  const u = ui({ tab: 'new', persona: 'dex', kind: 'bug', q: 'scrub', open: 'a', notes: { text: 'n', base: 1, dirty: false } })
  const shown = applyShow(u, { state: 'kept', persona: 'priya', finding: 'c' })
  assert.deepEqual([shown.tab, shown.persona, shown.open, shown.view, shown.notes], ['kept', 'priya', 'c', 'detail', null])
  // The search and kind would hide the named finding, so they clear.
  assert.deepEqual([shown.q, shown.kind], ['', 'all'])
  // Only what the post names changes.
  assert.deepEqual(applyShow(u, { state: 'fixed' }), { ...u, tab: 'fixed' })
  assert.equal(applyShow({ ...u, persona: 'priya' }, { persona: null }).persona, null)
})

test("settle keeps the open finding when it's still listed, else opens the first row", () => {
  const rows = [row('a', { severity: 'minor' }), row('b', { severity: 'blocker' }), row('c', { state: 'kept' })]
  const kept = ui({ open: 'a', notes: { text: 'mine', base: 1, dirty: true } })
  assert.equal(settle(kept, rows).open, 'a')
  assert.deepEqual(settle(kept, rows).notes, kept.notes, "the open finding's notes stay")
  // Gone from view (here, a search hides it): the first row in the list's order opens, with nothing carried over.
  const moved = settle(ui({ open: 'a', q: 'Title b', notes: { text: 'n', base: 1, dirty: false }, problem: 'x' }), rows)
  assert.deepEqual([moved.open, moved.notes, moved.problem], ['b', null, ''])
  assert.equal(settle(ui({ open: 'zz' }), rows).open, 'b', 'blocker sorts first')
  assert.equal(settle(ui({ tab: 'closed', open: 'a' }), rows).open, null, 'an empty list opens nothing')
  // While a dialog is open the owner is acting on the open finding, so it stays.
  assert.equal(settle(ui({ open: 'c', dialog: { type: 'issue', title: 't', body: 'b', notes: '' } }), rows).open, 'c')
  // Picks stay while their finding is in the list, even one a search hides; one that left the list drops.
  assert.deepEqual(settle(ui({ picked: ['a', 'b', 'c', 'gone'], q: 'Title b' }), rows).picked, ['a', 'b'])
})

test('a conflict from notes.set keeps the typed text and sets the problem', () => {
  const u = ui({ open: 'a', notes: { text: 'my long note', base: 5, dirty: true } })
  const refused = notesRefused(u, 'a', hostError('conflict', 'The notes changed while you were typing. Copy your text, then reload them.'))
  assert.deepEqual(refused.notes, { text: 'my long note', base: 5, dirty: true })
  assert.equal(refused.problem, 'The notes changed while you were typing. Copy your text, then reload them.')
  // A newer copy from the server doesn't replace the unsaved text.
  assert.deepEqual(withDetail(refused, detail('a', 'the agent wrote this', 9)).notes, refused.notes)
  // The refusal for a finding no longer open goes to the notice, so it isn't lost.
  assert.deepEqual(notesRefused(ui({ open: 'b' }), 'a', new Error('No.')).notice, { text: "Your notes weren't saved: No." })
})

test('typing in the notes marks them unsaved, and saving sends them against the time they started from', () => {
  const loaded = withDetail(ui({ open: 'a' }), detail('a', 'server', 7))
  assert.deepEqual(loaded.notes, { text: 'server', base: 7, dirty: false })
  assert.equal(saveOf(loaded, 'p1'), null, 'nothing to save')
  const typed = fieldOf(loaded, 'notes', 'server, and more')
  assert.deepEqual(typed.notes, { text: 'server, and more', base: 7, dirty: true })
  const a = request(saveOf(typed, 'p1'))
  assert.deepEqual(a.request, { name: 'notes.set', input: { project: 'p1', id: 'a', text: 'server, and more', base: 7 } })
  assert.deepEqual(a.then!({ ...typed, problem: 'old' }, { mtime: 8 }).notes, { text: 'server, and more', base: 8, dirty: false })
  assert.equal(a.then!({ ...typed, problem: 'old' }, { mtime: 8 }).problem, '')
  // Typed on while it saved: the new base is kept, and the text stays unsaved.
  assert.deepEqual(a.then!(fieldOf(typed, 'notes', 'newer'), { mtime: 8 }).notes, { text: 'newer', base: 8, dirty: true })
  // A clean server copy replaces the field.
  assert.deepEqual(withDetail(loaded, detail('a', 'agent edit', 9)).notes, { text: 'agent edit', base: 9, dirty: false })
})

test('the remaining controls: open, back, pick, group-with, reopen, ungroup, screenshots, links, notices', () => {
  const u = ui({ open: 'a', picked: ['b'], notes: { text: 'n', base: 1, dirty: false } })
  // A plain click opens it and drops the selection.
  assert.deepEqual(uiOf(act({ do: 'open', id: 'b' }, u), u), { ...u, picked: [], anchor: 'b', open: 'b', view: 'detail', opened: true, notes: null, problem: '' })
  assert.deepEqual(uiOf(act({ do: 'open', id: 'a' }, u), { ...u, view: 'list' }), { ...u, picked: [], anchor: 'a', view: 'detail', opened: true }, 'the open one keeps its notes')
  assert.equal(uiOf(act({ do: 'back' }, u), { ...u, view: 'detail' }).view, 'list')
  // ⌘-click adds or drops a row and leaves the open finding; the first one brings the open finding along.
  assert.deepEqual(uiOf(act({ do: 'open', id: 'a', mod: 'toggle' }, u), u).picked, ['b', 'a'])
  assert.deepEqual(uiOf(act({ do: 'open', id: 'b', mod: 'toggle' }, u), u).picked, [])
  const first = uiOf(act({ do: 'open', id: 'b', mod: 'toggle' }, ui({ open: 'a' })), ui({ open: 'a' }))
  assert.deepEqual([first.picked, first.open, first.anchor], [['a', 'b'], 'a', 'b'])
  assert.deepEqual(uiOf(act({ do: 'unpick' }, u), u).picked, [])
  const gw = uiOf(act({ do: 'group-with' }, u), u)
  assert.deepEqual([gw.picked, gw.notice, gw.view], [['b', 'a'], { text: '⌘-click the findings that belong with this one, then press Group.' }, 'list'])
  const reopen = request(act({ do: 'reopen' }, u))
  assert.deepEqual(reopen.request.input, { project: 'p1', action: { type: 'reopen', id: 'a' } })
  assert.deepEqual(reopen.then!(u, { undo: null }).notice, { text: 'Reopened.' })
  const ungroup = request(act({ do: 'ungroup' }, u))
  assert.deepEqual(ungroup.request.input, { project: 'p1', action: { type: 'ungroup', id: 'a' } })
  assert.deepEqual(ungroup.then!(u, { undo: null }).notice, { text: 'Ungrouped.' })
  const shots = { 'r1:0': 'data:image/png;base64,AAA', 'r1:1': null }
  assert.deepEqual(uiOf(act({ do: 'shot-zoom', report: 'r1', index: '0' }, u, undefined, shots), u).dialog, { type: 'shot', url: 'data:image/png;base64,AAA' })
  assert.equal(act({ do: 'shot-zoom', report: 'r1', index: '1' }, u, undefined, shots), null, 'nothing to enlarge')
  assert.deepEqual(request(act({ do: 'shot-open', report: 'r1', index: '1' }, u)).request,
    { name: 'shot.open', input: { project: 'p1', id: 'a', report: 'r1', index: 1 } })
  assert.deepEqual(act({ do: 'link', url: 'https://github.com/o/r/pull/3' }), { link: 'https://github.com/o/r/pull/3' })
  assert.equal(act({ do: 'link', url: 'javascript:alert(1)' }), null)
  assert.equal(uiOf(act({ do: 'cancel' }, ui({ dialog: { type: 'close', ids: ['a'] } })), ui()).dialog, null)
  assert.equal(uiOf(act({ do: 'dismiss' }, ui({ notice: { text: 'Kept.' } })), ui({ notice: { text: 'Kept.' } })).notice, null)
  assert.equal(act({ do: 'nope' }), null)
  assert.equal(act({}), null)
})

test('a request that timed out is still working, not refused; a changed post refetches the open finding when it names it or none', () => {
  assert.deepEqual(failureOf(hostError('timeout', 'slow')), { problem: '', slow: true })
  assert.deepEqual(failureOf(new Error('No.')), { problem: 'No.', slow: false })
  // In the notice bar: the refusal in its own words, or word that the worker is still at it.
  assert.deepEqual(refusedOf(ui(), new Error('Only a new finding can be kept.')).notice, { text: 'Only a new finding can be kept.' })
  assert.deepEqual(refusedOf(ui(), hostError('timeout', 'slow')).notice, { text: "Still working on it. The list updates when it's done." })
  assert.equal(refetchesFinding(ui({ open: 'a' }), { project: 'p1', finding: 'a' }), true)
  assert.equal(refetchesFinding(ui({ open: 'a' }), { project: 'p1' }), true)
  assert.equal(refetchesFinding(ui({ open: 'a' }), { project: 'p1', finding: 'b' }), false)
  assert.equal(refetchesFinding(ui(), { project: 'p1' }), false)
})

test('the root is the app, narrow under 700 px, and says which pane shows', () => {
  assert.equal(rootClass(ui(), 1000), 'app v-list')
  assert.equal(rootClass(ui({ view: 'detail' }), 699), 'app narrow v-detail')
  assert.equal(rootClass(ui(), 700), 'app v-list')
})

test("a finding.get refused because the finding is gone clears the open finding and says why", () => {
  const u = ui({ open: 'a', view: 'detail', notes: { text: 'n', base: 1, dirty: false }, problem: 'old' })
  const gone = findingRefused(u, 'a', hostError('invalid_params', 'That finding is no longer on the list.'))
  assert.deepEqual([gone.open, gone.notes, gone.problem, gone.notice], [null, null, '', { text: 'That finding is no longer on the list.' }])
  // Any other refusal keeps the finding open and shows in the notice; one for a finding no longer open changes nothing.
  assert.deepEqual(findingRefused(u, 'a', new Error('Disk full.')), { ...u, notice: { text: 'Disk full.' } })
  assert.equal(findingRefused(u, 'b', hostError('invalid_params', 'gone')), u)
})

test('focus after a redraw goes back to the same control, else to one that does the same', () => {
  assert.deepEqual(focusOf({ do: 'open', id: 'f2' }), ['[data-do="open"][data-id="f2"]', '[data-do="open"]'])
  assert.deepEqual(focusOf({ do: 'tab', tab: 'kept' }), ['[data-do="tab"][data-tab="kept"]', '[data-do="tab"]'])
  // Keep carries no id: after it moves on to the next finding, its Keep takes the focus, so Enter keeps going.
  assert.deepEqual(focusOf({ do: 'keep' }), ['[data-do="keep"]'])
  assert.deepEqual(focusOf({ do: 'shot-zoom', report: 'r1', index: '0' }), ['[data-do="shot-zoom"][data-report="r1"][data-index="0"]', '[data-do="shot-zoom"]'])
  assert.deepEqual(focusOf({ do: 'persona', persona: 'a"b\\c' }), ['[data-do="persona"][data-persona="a\\"b\\\\c"]', '[data-do="persona"]'], 'quotes and backslashes are escaped')
  assert.deepEqual(focusOf({}), [])
})

const person = (runs: number, recheck = 0, over: Partial<PersonaDetail['row']> = {}): PersonaDetail => ({ lines: [], branch: 'studio/qa-dex', port: 4210, who: [], goals: [],
  row: { id: 'dex', name: 'Dex', tag: 't', state: 'idle', fresh: 0, runs, recheck, ...over } })

test('a show with run opens the run dialog for that persona, with its name and what it rechecks', () => {
  const u = applyShow(ui(), { persona: 'dex', run: true }, person(2, 3).row)
  assert.deepEqual(u.dialog, { type: 'run', persona: 'dex', name: 'Dex', recheck: 3 })
  assert.equal(u.opened, false)
  assert.deepEqual(applyShow(ui({ personaDetail: person(2, 1) }), { persona: 'dex', run: true }).dialog, { type: 'run', persona: 'dex', name: 'Dex', recheck: 1 })
  assert.equal(applyShow(ui(), { persona: 'dex' }).dialog, null)
})

test('the run dialog sends run.start with the trimmed focus, and leaves it out when empty', () => {
  const u = ui({ dialog: { type: 'run', persona: 'dex', name: 'Dex', recheck: 0 } })
  const a = request(act({ do: 'submit' }, u, { focus: '  the export  ' }))
  assert.deepEqual(a.request, { name: 'run.start', input: { project: 'p1', persona: 'dex', focus: 'the export' } })
  assert.equal(a.then!(u, { ok: true }).notice?.text, 'Dex is running in its own copy. Carry on with the others.')
  assert.deepEqual(request(act({ do: 'submit' }, u, { focus: '   ' })).request.input, { project: 'p1', persona: 'dex' })
})

test('uncommitted changes hold a run back in the notice, with Run anyway, which keeps the focus', () => {
  const u = ui({ dialog: { type: 'run', persona: 'dex', name: 'Dex', recheck: 0 } })
  const a = request(act({ do: 'submit' }, u, { focus: 'the export' }))
  const held = a.then!(u, { uncommitted: 3 })
  assert.deepEqual(held.notice, { text: '3 files have uncommitted changes. Commit them first, or run anyway to test your last commit.',
    anyway: { persona: 'dex', name: 'Dex', focus: 'the export' } })
  const again = request(act({ do: 'run-anyway' }, held))
  assert.deepEqual(again.request, { name: 'run.start', input: { project: 'p1', persona: 'dex', focus: 'the export', anyway: true } })
  assert.equal(again.then!(held, { ok: true }).notice?.text, 'Dex is running in its own copy. Carry on with the others.')
  assert.equal(act({ do: 'run-anyway' }, ui()), null)
})

test('Run starts a first run at once and opens the dialog for a later one; Stop and Watch say what happened', () => {
  const first = ui({ personaDetail: person(0) })
  assert.deepEqual(request(act({ do: 'run', persona: 'dex' }, first)).request, { name: 'run.start', input: { project: 'p1', persona: 'dex' } })
  const again = ui({ personaDetail: person(2, 1) })
  assert.deepEqual(uiOf(act({ do: 'run', persona: 'dex' }, again), again).dialog, { type: 'run', persona: 'dex', name: 'Dex', recheck: 1 })
  const going = ui({ personaDetail: person(2, 0, { state: 'running', chat: "Dex's run" }) })
  const stop = request(act({ do: 'stop', persona: 'dex' }, going))
  assert.deepEqual(stop.request, { name: 'run.stop', input: { project: 'p1', persona: 'dex' } })
  assert.equal(stop.then!(going, { ok: true }).notice?.text, 'Dex stopped. Nothing from that run was kept.')
  const watch = request(act({ do: 'watch', persona: 'dex' }, going))
  assert.deepEqual(watch.request, { name: 'run.watch', input: { project: 'p1', persona: 'dex' } })
  assert.equal(watch.then!(going, { ok: true }).notice?.text, `Dex's run is the chat "Dex's run" in the workspace that just opened.`)
  assert.equal(act({ do: 'run', persona: 'maya' }, first), null)
  assert.deepEqual(request(act({ do: 'edit-persona', persona: 'dex' }, first)).request, { name: 'persona.open', input: { project: 'p1', persona: 'dex' } })
})

test('Shift-click selects the shown rows from the last one clicked, in list order, and leaves the open finding', () => {
  const rows = [row('a'), row('b'), row('c'), row('d'), row('e', { state: 'kept' })]
  const shift = (id: string, u: Ui) => { const a = actionOf({ do: 'open', id, mod: 'range' }, u, { project: 'p1', rows }); return uiOf(a, u) }
  const u = ui({ open: 'a' })
  assert.deepEqual([shift('c', u).picked, shift('c', u).open], [['a', 'b', 'c'], 'a'])
  assert.deepEqual(shift('b', ui({ open: 'a', anchor: 'd' })).picked, ['b', 'c', 'd'], 'from the anchor, upward too')
  assert.deepEqual(shift('c', ui({ anchor: 'zzz' })).picked, ['c'], 'an anchor that left the list starts at the clicked row')
  assert.deepEqual(shift('e', u).picked, [], 'a row in another list changes nothing')
})

test("a persona's pane shows until a finding is opened, and Back returns to it", () => {
  const u = uiOf(act({ do: 'persona', persona: 'dex' }), ui())
  assert.equal(showsPersona(u), true)
  const o = uiOf(act({ do: 'open', id: 'a' }, u), u)
  assert.equal(showsPersona(o), false)
  assert.equal(showsPersona(uiOf(act({ do: 'back' }, o), o)), true)
})

test('choosing a persona, or a show naming only one, shows its pane in a narrow tab; deselecting does not', () => {
  const chosen = uiOf(act({ do: 'persona', persona: 'dex' }), ui())
  assert.equal(rootClass(chosen, 500), 'app narrow v-detail')
  const off = uiOf(act({ do: 'persona', persona: 'dex' }, chosen), { ...chosen, view: 'list' })
  assert.deepEqual([off.persona, off.view], [null, 'list'])
  assert.equal(rootClass(applyShow(ui(), { persona: 'dex' }), 500), 'app narrow v-detail')
  assert.equal(applyShow(ui(), { state: 'kept' }).view, 'list')
})

test('Set up personas asks the worker and says whether the chat is new or already open', () => {
  const a = request(act({ do: 'setup' }))
  assert.deepEqual(a.request, { name: 'setup.start', input: { project: 'p1' } })
  assert.deepEqual(a.then!(ui(), { chat: 's1', existing: false }).notice, { text: 'Setup is open in the "Set up personas" chat. Your personas will appear here once they\'re saved.' })
  assert.deepEqual(a.then!(ui(), { chat: 's1', existing: true }).notice, { text: 'Setup is already open in your tabs as "Set up personas".' })
})

test('Discuss asks the worker for the open finding and says whether the chat is new or already open', () => {
  const u = ui({ open: 'a' })
  const a = request(act({ do: 'discuss' }, u))
  assert.deepEqual(a.request, { name: 'discuss.start', input: { project: 'p1', id: 'a' } })
  assert.deepEqual(a.then!(u, { chat: 's1', title: 'Discuss: A', existing: false }).notice, { text: 'Started a discussion. What you decide lands in the notes.' })
  assert.deepEqual(a.then!(u, { chat: 's1', title: 'Discuss: A', existing: true }).notice, { text: 'The discussion is open in your tabs as "Discuss: A".' })
  assert.equal(act({ do: 'discuss' }), null)
})

test('Start work asks for a draft, then sends the name and base, and says where the chat is', () => {
  const u = ui({ open: 'a' })
  const a = request(act({ do: 'start' }, u))
  assert.deepEqual(a.request, { name: 'work.draft', input: { project: 'p1', ids: ['a'] } })
  const d = a.then!(u, { name: 'fix-it', base: 'main', brief: 'B', autoBrief: 'A' }).dialog
  assert.deepEqual(d, { type: 'work', ids: ['a'], name: 'fix-it', base: 'main', brief: 'B', autoBrief: 'A' })
  const s = request(act({ do: 'submit' }, ui({ open: 'a', dialog: d }), { workName: ' other ', workBase: 'dev' }))
  assert.deepEqual(s.request, { name: 'work.start', input: { project: 'p1', ids: ['a'], name: 'other', base: 'dev' } })
  assert.deepEqual(s.then!(u, { ok: true }).notice, { text: "Started other. Its agent's chat is in the other worktree." })
  assert.deepEqual(request(act({ do: 'submit' }, ui({ open: 'a', dialog: d }), {})).request, { name: 'work.start', input: { project: 'p1', ids: ['a'], name: 'fix-it', base: 'main' } })
  assert.deepEqual(request(act({ do: 'submit' }, ui({ open: 'a', dialog: d }), { autoPr: 'true' })).request, { name: 'work.start', input: { project: 'p1', ids: ['a'], name: 'fix-it', base: 'main', autoPr: true } })
})

test('Start work on several picked findings drafts them together, then sends together or each as chosen', () => {
  const u = ui({ tab: 'kept', picked: ['a', 'b'] })
  const a = request(act({ do: 'bulk-work' }, u))
  assert.deepEqual(a.request, { name: 'work.draft', input: { project: 'p1', ids: ['a', 'b'] } })
  const d = a.then!(u, { name: 'fix-a-b', base: 'main', brief: 'B', autoBrief: 'A' }).dialog
  assert.deepEqual(d, { type: 'work', ids: ['a', 'b'], name: 'fix-a-b', base: 'main', brief: 'B', autoBrief: 'A' })
  const together = request(act({ do: 'submit' }, { ...u, dialog: d }, { workHow: 'together' }))
  assert.deepEqual(together.request, { name: 'work.start', input: { project: 'p1', ids: ['a', 'b'], name: 'fix-a-b', base: 'main' } })
  assert.deepEqual(together.then!(u, { ok: true }).picked, [])
  const each = request(act({ do: 'submit' }, { ...u, dialog: d }, { workHow: 'each' }))
  assert.deepEqual(each.request, { name: 'work.start', input: { project: 'p1', ids: ['a', 'b'], name: 'fix-a-b', base: 'main', each: true } })
  assert.deepEqual(each.then!(u, { ok: true }).notice, { text: "Starting 2 worktrees, one per finding. Each agent's chat is in its own worktree." })
  assert.equal(act({ do: 'bulk-work' }, ui({ tab: 'kept' })), null)
})

test('clear-q empties the search', () => {
  const u = ui({ q: 'export' })
  assert.equal(uiOf(act({ do: 'clear-q' }, u), u).q, '')
})

test('isDarkColor tells a dark terminal background from a light one, in either hex length', () => {
  assert.deepEqual(['#1c1c1c', '#151515', '#000', '#fff', '#fafafa', '#3b5bdb'].map(isDarkColor), [true, true, true, false, false, true])
})
