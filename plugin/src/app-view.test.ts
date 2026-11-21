import { assert, test } from 'orca/testing'
import { detailPane, dialog, freshUi, header, listPane, noticeBar, personaPane, zeroPane, type Ui } from './app-view'
import type { Row } from './findings-view'
import type { FindingState } from './model'
import { statusOf, stepOf, type Detail, type Overview, type PersonaDetail, type PersonaRow, type ReportView } from './protocol'

const overview = (over: Partial<Overview> = {}): Overview => ({
  hasGh: true, canRun: null, configError: null,
  personas: [{ id: 'priya', name: 'Priya', tag: 'animates with vector shapes', state: 'idle', fresh: 2, runs: 3, recheck: 0 },
    { id: 'dex', name: 'Dex', tag: 'draws by hand', state: 'idle', fresh: 0, runs: 1, recheck: 0 }],
  counts: { new: 0, kept: 0, progress: 0, fixed: 0, closed: 0 }, ...over })
const row = (id: string, over: Partial<Row> = {}): Row => ({ id, title: `Title ${id}`, kind: 'bug', severity: 'major', state: 'new',
  personas: ['priya'], runs: 1, reopened: false, fresh: false, members: 0, reports: 1, latest: 1, ...over })
const ui = (over: Partial<Ui> = {}): Ui => ({ ...freshUi(), ...over })
const report = (id: string, over: Partial<ReportView> = {}): ReportView => ({ id, persona: 'priya', personaName: 'Priya', runId: 'run1', at: 1,
  saw: `What ${id} saw`, steps: ['Open a drawing', 'Scrub the timeline'], shots: [], severity: 'major', step: 's1', ...over })
const detail = (state: FindingState, over: Partial<Detail['finding']> = {}, notes = ''): Detail => ({
  finding: { id: 'f1', title: 'Scrubbing drops the shape', kind: 'bug', labels: [], severity: 'major', state,
    reports: [report('r1')], history: [{ at: 1, text: 'Reported by Priya' }], members: [], ...over },
  notes: { text: notes, mtime: 1 } })

/** Each button: its label (tags gone), its inner HTML and its attributes. */
const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map((m) => ({ inner: m[2],
  label: m[2].replace(/<[^>]*>/g, '').trim(),
  attrs: Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((x) => [x[1], x[2] ?? ''])) }))
const labels = (html: string) => buttons(html).map((b) => b.label)
const button = (html: string, label: string) => buttons(html).find((b) => b.label === label)
/** The words a person reads, tags gone. */
const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
/** The opening tag of the element carrying a data-field. */
const field = (html: string, name: string) => new RegExp(`<[^>]*data-field="${name}"[^>]*>`).exec(html)?.[0] ?? null

test('the five lists show their counts, and the chosen one is marked selected', () => {
  const all = [row('a'), row('b'), row('c', { state: 'kept' }), row('d', { state: 'fixed' }), row('e', { state: 'fixed', personas: ['dex'] })]
  const html = listPane(all, overview(), ui({ tab: 'fixed' }))
  const tabs = buttons(html).filter((b) => b.attrs['data-do'] === 'tab')
  assert.deepEqual(tabs.map((b) => [b.label, b.attrs['data-tab'], b.attrs['aria-selected']]), [['New2', 'new', 'false'], ['Kept1', 'kept', 'false'],
    ['Working0', 'progress', 'false'], ['Fixed2', 'fixed', 'true'], ['Closed0', 'closed', 'false']])
  assert.ok(tabs.every((b) => b.attrs.role === 'tab'))
  // The counts follow the persona filter.
  const only = buttons(listPane(all, overview(), ui({ tab: 'fixed', persona: 'dex' }))).filter((b) => b.attrs['data-do'] === 'tab')
  assert.deepEqual(only.map((b) => b.label), ['New0', 'Kept0', 'Working0', 'Fixed1', 'Closed0'])
})

test('a row shows kind, severity (polish as "low"), who saw it, "seen in N runs", a Reopened chip and its PR or issue', () => {
  const all = [row('a', { kind: 'polish', severity: 'polish', personas: ['priya', 'dex'], runs: 3, reopened: true, issue: 12 }),
    row('b', { kind: 'missing', severity: 'minor', state: 'new', pr: { number: 231, state: 'open' } })]
  const html = listPane(all, overview(), ui({ open: 'a' }))
  const chunk = (id: string) => html.split('class="row').find((c) => c.includes(`data-id="${id}"`))!
  const [a, b] = [chunk('a'), chunk('b')]
  assert.ok(words(a).includes('Polish') && words(a).includes('low') && !words(a).includes('polish'))
  assert.ok(words(a).includes('Priya, Dex'))
  assert.ok(words(a).includes('seen in 3 runs'))
  assert.ok(words(a).includes('Reopened'))
  assert.ok(words(a).includes('Issue #12'))
  assert.ok(words(b).includes('Missing') && words(b).includes('minor') && words(b).includes('PR #231 open'))
  assert.ok(!words(b).includes('seen in') && !words(b).includes('Reopened'))
  const opens = buttons(html).filter((x) => x.attrs['data-do'] === 'open')
  // Minor sorts above low.
  assert.deepEqual(opens.map((x) => [x.attrs['data-id'], x.attrs['aria-current']]), [['b', undefined], ['a', 'true']])
  assert.ok(!html.includes('type="checkbox"'), 'rows select by ⌘- and Shift-click, not checkboxes')
})

test('an empty New list says "Nothing new"; a search with no hits says "Nothing matches"', () => {
  const all = [row('a', { state: 'kept' })]
  assert.ok(words(listPane(all, overview(), ui())).includes('Nothing new'))
  assert.ok(words(listPane(all, overview(), ui({ persona: 'dex' }))).includes('Nothing new from Dex'))
  const miss = words(listPane(all, overview(), ui({ tab: 'kept', q: 'zzz' })))
  assert.ok(miss.includes('Nothing matches') && !miss.includes('Nothing new'))
  assert.ok(words(listPane(all, overview(), ui({ tab: 'kept', kind: 'polish' }))).includes('Nothing matches'))
  assert.ok(!words(listPane(all, overview(), ui({ tab: 'kept' }))).includes('Nothing'))
})

test('ticking rows shows "N selected" with Group, Keep (New only), Start work… (Kept only) and Close…', () => {
  const all = [row('a'), row('b'), row('c', { state: 'kept' }), row('d', { state: 'kept' })]
  assert.ok(!words(listPane(all, overview(), ui())).includes('selected'))
  const html = listPane(all, overview(), ui({ picked: ['a', 'b'] }))
  assert.ok(words(html).includes('2 selected'))
  const bulk = (h: string) => buttons(h).filter((b) => ['group', 'bulk-keep', 'bulk-work', 'bulk-close', 'unpick'].includes(b.attrs['data-do']))
  assert.deepEqual(bulk(html).map((b) => [b.label, b.attrs['data-do']]), [['Group', 'group'], ['Keep', 'bulk-keep'], ['Close…', 'bulk-close'], ['', 'unpick']])
  assert.equal(button(html, '')!.attrs['aria-label'], 'Clear selection')
  assert.equal((html.match(/class="row picked"/g) ?? []).length, 2)
  assert.equal((html.match(/<span class="sr">Selected<\/span>/g) ?? []).length, 2)
  const kept = listPane(all, overview(), ui({ tab: 'kept', picked: ['c', 'd'] }))
  assert.deepEqual(bulk(kept).map((b) => b.label), ['Group', 'Start work…', 'Close…', ''])
})

test('each state\'s detail offers exactly its actions', () => {
  const acts = (d: Detail, o = overview()) => labels(detailPane(d, o, ui({ open: 'f1' }), {})).filter((l) => !['Findings', 'Ungroup'].includes(l))
  assert.deepEqual(acts(detail('new')), ['Discuss', 'Keep', 'Group with…', 'Close…'])
  assert.deepEqual(acts(detail('kept')), ['Discuss', 'Start work', 'Make an issue', 'Close…'])
  assert.deepEqual(acts(detail('kept'), overview({ hasGh: false })), ['Discuss', 'Start work', 'Close…'])
  assert.deepEqual(acts(detail('kept', { issue: { number: 9, url: 'https://github.com/o/r/issues/9' } })), ['Discuss', 'Start work', 'Close…'])
  assert.deepEqual(acts(detail('progress')), ['Discuss'])
  assert.deepEqual(acts(detail('fixed')), ['Discuss', 'Reopen'])
  assert.deepEqual(acts(detail('closed', { closed: { reason: 'notABug', at: 1 } })), ['Discuss', 'Reopen'])
  const html = detailPane(detail('new'), overview(), ui(), {})
  assert.deepEqual(['Discuss', 'Keep', 'Group with…', 'Close…'].map((l) => button(html, l)!.attrs['data-do']), ['discuss', 'keep', 'group-with', 'close'])
  assert.equal(button(detailPane(detail('kept'), overview(), ui(), {}), 'Make an issue')!.attrs['data-do'], 'issue')
  assert.equal(button(detailPane(detail('fixed'), overview(), ui(), {}), 'Reopen')!.attrs['data-do'], 'reopen')
  assert.equal(button(html, 'Findings')!.attrs['data-do'], 'back')
  for (const l of ['Start work', 'Run again', 'Run']) assert.ok(!labels(html).includes(l), l)
})

test('the detail shows each report under its persona\'s name, steps numbered, and screenshots as images or as links when the data is null', () => {
  const d = detail('new', { reports: [report('r1', { shots: ['a.png', 'b.png', 'c.png'] }),
    report('r2', { persona: 'dex', personaName: 'Dex', saw: 'Dex saw it too', steps: ['Press Enter'], shots: [] })] })
  const html = detailPane(d, overview(), ui(), { 'r1:0': 'data:image/png;base64,AAAA', 'r1:1': null })
  const w = words(html)
  assert.ok(w.includes('What Priya saw What r1 saw') && w.includes('What Dex saw Dex saw it too'))
  assert.ok(/<ol[^>]*><li>Open a drawing<\/li><li>Scrub the timeline<\/li><\/ol>/.test(html))
  const zoom = buttons(html).find((b) => b.attrs['data-do'] === 'shot-zoom')!
  assert.deepEqual([zoom.attrs['data-report'], zoom.attrs['data-index']], ['r1', '0'])
  assert.ok(zoom.attrs['aria-label'])
  assert.ok(/<img[^>]*src="data:image\/png;base64,AAAA"[^>]*alt="[^"]+"/.test(html))
  const open = buttons(html).find((b) => b.attrs['data-do'] === 'shot-open')!
  assert.deepEqual([open.attrs['data-report'], open.attrs['data-index']], ['r1', '1'])
  // r1:2 isn't loaded yet: a placeholder, neither image nor link.
  assert.ok(/class="shot-wait"[^>]*data-report="r1" data-index="2"/.test(html))
  assert.equal(buttons(html).filter((b) => /^shot-/.test(b.attrs['data-do'] ?? '')).length, 2)
})

test('text with markup in a title, a report and the notes is escaped', () => {
  const x = '<img src=x>'
  const all = [row('a', { title: x })]
  assert.ok(listPane(all, overview(), ui()).includes('&lt;img src=x&gt;') && !listPane(all, overview(), ui()).includes(x))
  const d = detail('new', { title: x, reports: [report('r1', { saw: x, steps: [x], personaName: x })] }, x)
  const html = detailPane(d, overview(), ui(), {})
  assert.ok(!html.includes(x))
  assert.ok(html.split('&lt;img src=x&gt;').length - 1 >= 5)
  assert.ok(/<textarea[^>]*data-field="notes"[^>]*>&lt;img src=x&gt;<\/textarea>/.test(html))
  assert.ok(!dialog(ui({ dialog: { type: 'group', ids: ['a', 'b'] } }), [row('a', { title: x }), row('b')]).includes(x))
  assert.ok(!dialog(ui({ dialog: { type: 'issue', title: x, body: x, notes: x } }), []).includes(x))
  assert.ok(!dialog(ui({ dialog: { type: 'work', ids: ['a'], name: x, base: x, brief: x, autoBrief: x } }), []).includes(x))
})

test('the close dialog offers the four reasons with "Won\'t fix" checked; the group dialog lists the picked titles; the issue dialog has an editable body and an unticked "Include my notes"', () => {
  assert.equal(dialog(ui(), []), '')
  const close = dialog(ui({ dialog: { type: 'close', ids: ['a'] } }), [row('a')])
  assert.ok(close.startsWith('<dialog id="dlg"') && close.includes('<form method="dialog">'))
  const radios = [...close.matchAll(/<label class="radio"><input([^>]*)>([^<]*)<\/label>/g)]
  assert.deepEqual(radios.map((m) => m[2]), ['Won&#39;t fix', 'Not a bug', 'Duplicate', 'Can&#39;t reproduce'])
  assert.deepEqual(radios.map((m) => /\schecked/.test(m[1])), [true, false, false, false])
  assert.ok(radios.every((m) => m[1].includes('data-field="reason"')))
  assert.ok(field(close, 'why'))
  assert.deepEqual([button(close, 'Cancel')!.attrs.type, button(close, 'Cancel')!.attrs['data-do']], ['button', 'cancel'])
  assert.ok(button(close, 'Close'))
  assert.ok(words(close).includes('Close this finding'))
  // Runs don't exist yet, so nothing claims a persona is told or what later runs do.
  assert.ok(!/is told|later runs/.test(words(close)))
  assert.ok(words(dialog(ui({ dialog: { type: 'close', ids: ['a', 'b'] } }), [row('a'), row('b')])).includes('Close 2 findings'))

  const group = dialog(ui({ dialog: { type: 'group', ids: ['a', 'b'] } }), [row('a'), row('b'), row('c')])
  const leads = [...group.matchAll(/<label class="radio"><input([^>]*)>([^<]*)<\/label>/g)]
  assert.deepEqual(leads.map((m) => m[2]), ['Title a', 'Title b'])
  assert.ok(leads[0][1].includes('value="a"') && /\schecked/.test(leads[0][1]) && leads[1][1].includes('data-field="lead"'))
  assert.ok(field(group, 'title') && words(group).includes('Group 2 findings') && button(group, 'Group'))

  const issue = dialog(ui({ dialog: { type: 'issue', title: 'T', body: 'The body', notes: 'my notes' } }), [])
  assert.ok(field(issue, 'issueTitle')!.includes('value="T"'))
  assert.ok(/<textarea[^>]*data-field="issueBody"[^>]*>The body<\/textarea>/.test(issue))
  const inc = field(issue, 'includeNotes')!
  assert.ok(inc.includes('type="checkbox"') && !/\schecked/.test(inc))
  assert.ok(words(issue).includes('Include my notes'))
  assert.ok(button(issue, 'Open the issue') && button(issue, 'Cancel'))
})

test('closing a finding that has an issue adds a ticked "Also close its GitHub issue" box, and no box otherwise', () => {
  const all = [row('a', { issue: 4 }), row('b')]
  const withIssue = dialog(ui({ dialog: { type: 'close', ids: ['b', 'a'] } }), all)
  const box = field(withIssue, 'closeIssue')!
  assert.ok(box.includes('type="checkbox"') && /\schecked/.test(box))
  assert.ok(words(withIssue).includes('Also close its GitHub issue'))
  const without = dialog(ui({ dialog: { type: 'close', ids: ['b'] } }), all)
  assert.equal(field(without, 'closeIssue'), null)
  assert.ok(!words(without).includes('GitHub issue'))
})

test('the notice bar shows Undo only when the notice carries a token', () => {
  assert.ok(/^<div class="notice"[^>]*><\/div>$/.test(noticeBar(ui())))
  const plain = noticeBar(ui({ notice: { text: 'Kept <1>.' } }))
  assert.ok(words(plain).includes('Kept &lt;1&gt;.'))
  assert.ok(!labels(plain).includes('Undo'))
  assert.equal(buttons(plain).find((b) => b.attrs['data-do'] === 'dismiss')!.attrs['aria-label'], 'Dismiss')
  const undo = noticeBar(ui({ notice: { text: 'Kept.', undo: 'tok' } }))
  assert.equal(button(undo, 'Undo')!.attrs['data-do'], 'undo')
})

test('the active persona shows in the header, with its switcher and a clear button; the list has no banner', () => {
  const none = header(overview(), ui())
  assert.ok(button(none, 'Personas')!.attrs.popovertarget)
  assert.ok(!buttons(none).some((b) => b.attrs['data-do'] === 'everyone'))
  const o = overview()
  o.personas[0] = { ...o.personas[0], name: 'Pri<y>a', state: 'running' }
  const html = header(o, ui({ persona: 'priya' }))
  assert.ok(!labels(html).includes('Personas'))
  const pick = buttons(html).find((b) => b.attrs.popovertarget === 'personas')!
  assert.ok(pick.label.includes('Pri&lt;y&gt;a') && pick.inner.includes('class="dot"'), 'its name, escaped, and that it runs')
  assert.equal(pick.attrs['aria-label'], 'Active persona: Pri&lt;y&gt;a. Switch persona')
  assert.equal(buttons(html).find((b) => b.attrs['data-do'] === 'everyone')!.attrs['aria-label'], 'Clear the active persona')
  assert.ok(!header(overview(), ui({ persona: 'gone' })).includes('data-do="everyone"'), 'a persona that has gone shows as none')
  assert.ok(!words(listPane([row('a')], overview(), ui({ persona: 'priya' }))).includes('Only'))
})

test('stepOf: the script step as n/total, or nothing when the line has none', () => {
  const run = (line?: string): PersonaRow => ({ id: 'dex', name: 'Dex', tag: '', state: 'running', fresh: 0, runs: 0, recheck: 0, line })
  assert.equal(stepOf(run('Step 2 of 3: Export my .ans')), '2/3')
  assert.equal(stepOf(run('  step 10 of 12  ')), '10/12')
  assert.equal(stepOf(run('Reproducing F8')), undefined)
  assert.equal(stepOf(run()), undefined)
})

test('statusOf: the stage, the script step as n/total and what it is doing; or the stage and the line', () => {
  const run = (o: Partial<PersonaRow>): PersonaRow => ({ id: 'dex', name: 'Dex', tag: '', state: 'running', fresh: 0, runs: 0, recheck: 0, ...o })
  assert.equal(statusOf(run({ stage: 'Using the app', line: 'Step 4 of 9: Export my .ans' })), 'Using the app · 4/9 · Export my .ans')
  assert.equal(statusOf(run({ stage: 'Using the app', line: 'step 4 of 9' })), 'Using the app · 4/9')
  assert.equal(statusOf(run({ stage: 'Using the app', line: 'Step 4 of 9: Export my .ans' }), false), 'Using the app · Export my .ans')
  assert.equal(statusOf(run({ stage: 'Writing up', line: 'Reproducing F8' })), 'Writing up · Reproducing F8')
  assert.equal(statusOf(run({ stage: 'Writing up', line: 'Writing up the review' })), 'Writing up the review')
  assert.equal(statusOf(run({ stage: 'Preparing' })), 'Preparing')
  assert.equal(statusOf(run({ line: 'Opening the editor' })), 'Running · Opening the editor')
})

test('the Personas list shows a running persona\'s status, escaped, where an idle one shows its tag', () => {
  const o = overview()
  o.personas[1] = { ...o.personas[1], state: 'running', stage: 'Using the app', line: 'Step 4 of 9: Open <b>it</b>' }
  const html = header(o, ui())
  const ps = buttons(html).filter((b) => b.attrs['data-do'] === 'persona')
  assert.ok(ps[1].label.includes('Using the app · 4/9 · Open &lt;b&gt;it&lt;/b&gt;'))
  assert.ok(html.includes('<span class="what live">'))
  assert.ok(ps[0].label.includes('animates with vector shapes'))
})

test('the header: the title alone, the personas with their new counts, the search and the kinds', () => {
  const html = header(overview(), ui({ persona: 'dex', kind: 'bug', q: 'tab <x>' }))
  const pop = buttons(html).find((b) => b.attrs.popovertarget)!
  const list = new RegExp(`id="${pop.attrs.popovertarget}" popover`).test(html)
  assert.ok(list)
  const ps = buttons(html).filter((b) => b.attrs['data-do'] === 'persona')
  assert.deepEqual(ps.map((b) => [b.attrs['data-persona'], b.attrs['aria-pressed']]), [['priya', 'false'], ['dex', 'true']])
  assert.ok(ps[0].label.includes('Priya') && ps[0].label.includes('2 new') && ps[0].label.includes('animates with vector shapes'))
  assert.ok(!ps[1].label.includes('new'))
  for (const l of ['Run', 'Run again', 'Stop']) assert.ok(!labels(html).includes(l), l)
  assert.ok(field(html, 'q')!.includes('value="tab &lt;x&gt;"'))
  const kinds = buttons(html).filter((b) => b.attrs['data-do'] === 'kind')
  assert.deepEqual(kinds.map((b) => [b.label, b.attrs['data-kind'], b.attrs['aria-pressed']]),
    [['All', 'all', 'false'], ['Bugs', 'bug', 'true'], ['Missing', 'missing', 'false'], ['Polish', 'polish', 'false']])
})

test('the detail: a group\'s reports, the work, fixed, closed and reopened cards, the issue link, and the notes', () => {
  const pr = { number: 224, url: 'https://github.com/o/r/pull/224', state: 'merged' as const }
  const group = detailPane(detail('new', { members: [{ id: 'f1', title: 'One', personas: ['priya'] }, { id: 'f2', title: 'Two', personas: ['dex', 'priya'] }] }), overview(), ui(), {})
  assert.ok(words(group).includes('Reports in this group') && words(group).includes('One (Priya)') && words(group).includes('Two (Dex, Priya)'))
  assert.equal(button(group, 'Ungroup')!.attrs['data-do'], 'ungroup')
  assert.ok(!labels(detailPane(detail('new'), overview(), ui(), {})).includes('Ungroup'))

  const work = detailPane(detail('progress', { work: { worktreePath: '/w/eraser-one-cell', branch: 'studio/eraser', pr: { ...pr, state: 'open' } } }), overview(), ui(), {})
  assert.ok(words(work).includes('eraser-one-cell') && words(work).includes('studio/eraser') && words(work).includes('PR #224 open'))
  assert.ok(/<a [^>]*data-do="link" data-url="https:\/\/github.com\/o\/r\/pull\/224"/.test(work))

  const fixed = detailPane(detail('fixed', { work: { worktreePath: '/w/x', branch: 'b', pr } }), overview(), ui(), {})
  assert.ok(/Merged in <a [^>]*data-do="link"[^>]*>PR #224<\/a>\./.test(fixed) && words(fixed).includes('Priya checks it again on the next run.'))
  const confirmed = words(detailPane(detail('fixed', { confirmed: { by: 'dex', runId: 'r', at: 1 } }), overview(), ui(), {}))
  assert.ok(confirmed.includes('Confirmed by Dex.') && !confirmed.includes('Merged in') && !confirmed.includes('checks it again'))

  const closed = words(detailPane(detail('closed', { closed: { reason: 'cantReproduce', why: 'Gone <now>', at: 1 } }), overview(), ui(), {}))
  assert.ok(closed.includes('Can&#39;t reproduce') && closed.includes('Gone &lt;now&gt;'))
  assert.ok(!/is told|later runs/.test(closed))

  const reopened = words(detailPane(detail('kept', { reopened: { by: 'priya', runId: 'r', note: 'Still drops it', at: 1 } }), overview(), ui(), {}))
  assert.ok(reopened.includes('Reopened') && reopened.includes('Still drops it'))

  const issue = detailPane(detail('kept', { issue: { number: 9, url: 'https://github.com/o/r/issues/9' } }), overview(), ui(), {})
  assert.ok(/<a [^>]*data-do="link" data-url="https:\/\/github.com\/o\/r\/issues\/9"[^>]*>Issue #9<\/a>/.test(issue))

  const plain = detailPane(detail('new', {}, 'saved'), overview(), ui(), {})
  assert.ok(/<textarea[^>]*data-field="notes"[^>]*>saved<\/textarea>/.test(plain))
  assert.ok(words(plain).includes('What you decide in Discuss lands here too. Whoever does the work starts from these.') && !words(plain).includes('Saving'))
  const typing = detailPane(detail('new', {}, 'saved'), overview(), ui({ notes: { text: 'typing', base: 1, dirty: true }, problem: 'Notes <failed>' }), {})
  assert.ok(/data-field="notes"[^>]*>typing<\/textarea>/.test(typing) && words(typing).includes('Saving…'))
  assert.ok(/class="callout danger"[^>]*>[^<]*Notes &lt;failed&gt;/.test(typing))
  assert.ok(typing.indexOf('callout danger') < typing.indexOf('data-field="notes"'))
  assert.ok(words(detailPane(null, overview(), ui(), {})).includes('No finding selected'))
})

test('a PR or issue URL that isn\'t http(s) is shown as words, and a screenshot that isn\'t an image data URL is never an image', () => {
  const bad = 'javascript:alert(1)'
  const html = detailPane(detail('progress', { issue: { number: 9, url: bad }, work: { worktreePath: '/w/x', branch: 'b', pr: { number: 3, url: bad, state: 'open' } },
    reports: [report('r1', { shots: ['a.png'] })] }), overview(), ui(), { 'r1:0': 'data:text/html,<script>alert(1)</script>' })
  assert.ok(!html.includes('<a') && !html.includes('data-url') && !html.includes('javascript:'))
  assert.ok(words(html).includes('Issue #9') && words(html).includes('PR #3 open'))
  assert.ok(!html.includes('<img') && !html.includes('data:text/html'))
  assert.equal(buttons(html).find((b) => b.attrs['data-do'] === 'shot-open')!.attrs['data-index'], '0')
  assert.ok(!dialog(ui({ dialog: { type: 'shot', url: 'data:text/html,x' } }), []).includes('<img'))
})

test('a quote in a title, the search or a persona can\'t leave its attribute or add markup', () => {
  const x = '"><b>x'
  const o = overview({ personas: [{ id: x, name: x, tag: x, state: 'idle', fresh: 1, runs: 1, recheck: 0 }] })
  const html = header(o, ui({ q: x })) + listPane([row(x, { title: x, personas: [x] })], o, ui({ persona: x, open: x }))
    + detailPane(detail('new', { title: x }), o, ui(), {})
  assert.ok(!html.includes('<b>x'))
  assert.ok(field(html, 'q')!.includes('value="&quot;&gt;&lt;b&gt;x"'))
  assert.ok(html.includes('data-id="&quot;&gt;&lt;b&gt;x"'))
  assert.equal(buttons(html).find((b) => b.attrs['data-do'] === 'persona')!.attrs['data-persona'], '&quot;&gt;&lt;b&gt;x')
})

const personDetail = (over: Partial<PersonaDetail> = {}, row: Partial<PersonaDetail['row']> = {}): PersonaDetail => ({
  row: { id: 'dex', name: 'Dex', tag: 'draws by hand', state: 'idle', fresh: 0, runs: 0, recheck: 0, ...row },
  lines: [], branch: 'studio/qa-dex', port: 4210, who: [], goals: [], ...over })
const trend = { text: 'Presses', target: 3, better: 'lower' as const, points: [{ runId: 'r1', loop: 1, value: 5 }] }

test('a running persona shows its copy, the stages with the current one on, and the last five lines, escaped', () => {
  const lines = ['one', 'two', 'three', 'four', 'five', '<b>six</b>']
  const html = personaPane(personDetail({ lines }, { state: 'running', stage: 'Writing up', runs: 1 }))
  assert.ok(words(html).includes('Running in its own copy · studio/qa-dex · port 4210'))
  const here = personaPane(personDetail({ branch: 'main', inPlace: true }, { state: 'running', stage: 'Using the app', runs: 1 }))
  assert.ok(words(here).includes('Running in your checkout · port 4210') && !words(here).includes('main'))
  assert.match(html, /<span class="done">Using the app<\/span><span class="on">Writing up<\/span><span class="">Matching<\/span>/)
  assert.ok(!html.includes('<li>one</li>') && html.includes('<li>two</li>') && html.includes('<li>&lt;b&gt;six&lt;/b&gt;</li>'))
  assert.ok(!html.includes('<b>six'))
  assert.deepEqual(labels(html), ['Findings', 'Edit persona', 'Watch the run', 'Stop'])
})

test('an idle persona says when it last ran, or that it never has, and offers Run or Run again', () => {
  const never = personaPane(personDetail())
  assert.ok(words(never).includes('Never run Its first run starts from its persona file and goals.'))
  assert.deepEqual(labels(never).slice(1), ['Edit persona', 'Run Dex'])
  const ran = personaPane(personDetail({}, { runs: 2, lastRunAt: Date.UTC(2026, 10, 1, 12) }), [row('a'), row('b', { state: 'kept' }), row('c', { personas: ['dex'] })])
  assert.ok(words(ran).includes('Idle last ran') && words(ran).includes('· 2 runs so far'))
  assert.deepEqual(labels(ran).slice(1), ['Edit persona', 'Run Dex again'])
  assert.equal(button(ran, 'Run Dex again')!.attrs['data-persona'], 'dex')
  // Counts per list are this persona's own.
  assert.ok(words(ran).includes('New 1') && words(ran).includes('Kept 0'))
})

test('Who shows its paragraphs, escaped, before Goals; neither heading shows when empty', () => {
  const html = personaPane(personDetail({ who: ['Dex draws <b>by hand</b>.', 'Every night.'], goals: [{ text: 'Few presses', met: false }] }))
  assert.ok(html.indexOf('<h3>Who</h3>') < html.indexOf('<h3>Goals</h3>'))
  assert.ok(html.includes('<p>Dex draws &lt;b&gt;by hand&lt;/b&gt;.</p><p>Every night.</p>'))
  const none = personaPane(personDetail())
  assert.ok(!none.includes('<h3>Who</h3>') && !none.includes('<h3>Goals</h3>'))
})

test('a counted goal says its newest value and target in words', () => {
  const html = personaPane(personDetail({ goals: [{ text: 'Few presses', met: false, trend: { ...trend, unit: 'keys' } }, { text: 'Calm', met: true }] }))
  assert.ok(words(html).includes('5 keys · target: at most 3'))
  const none = personaPane(personDetail({ goals: [{ text: 'Few presses', met: false, trend: { ...trend, points: [] } }] }))
  assert.ok(!words(none).includes('target:'))
})

test('a counted goal draws its trend, every goal says Met or Not met', () => {
  const html = personaPane(personDetail({ goals: [{ text: 'Few presses', met: false, trend }, { text: 'Feels <i>fast</i>', met: true }] }))
  assert.equal(html.match(/<svg xmlns/g)?.length, 1)
  assert.ok(words(html).includes('Few presses Not met') && words(html).includes('Feels &lt;i&gt;fast&lt;/i&gt; Met'))
  assert.ok(!html.includes('<i>fast</i>'))
  // A counted goal with no runs yet draws no empty chart.
  assert.ok(!personaPane(personDetail({ goals: [{ text: 'Few presses', met: false, trend: { ...trend, points: [] } }] })).includes('<svg xmlns'))
})

test('the Run again dialog says what gets rechecked, and has the focus field and Run', () => {
  const some = dialog(ui({ dialog: { type: 'run', persona: 'dex', name: 'Dex', recheck: 2 } }), [])
  assert.ok(words(some).includes('Run Dex again') && words(some).includes("Dex first rechecks 2 fixes merged since the last run, then looks for what&#39;s new."))
  assert.ok(field(some, 'focus') && words(some).includes('Anything to focus on? (optional)') && labels(some).includes('Run'))
  assert.ok(words(dialog(ui({ dialog: { type: 'run', persona: 'dex', name: 'Dex', recheck: 1 } }), [])).includes('rechecks 1 fix merged'))
  assert.ok(words(dialog(ui({ dialog: { type: 'run', persona: 'dex', name: 'Dex', recheck: 0 } }), [])).includes("Dex looks for what&#39;s new since the last run."))
})

test('several Kept findings can be started together; several New ones cannot', () => {
  const two = ['a', 'b']
  const d = dialog(ui({ dialog: { type: 'work', ids: two, name: 'fix-a-b', base: 'main', brief: 'Fix both', autoBrief: 'Fix both, then PR' } }), [])
  assert.ok(words(d).includes('Start work on 2 findings'))
  assert.ok(/data-field="workHow" value="each" checked/.test(d) && /data-field="workHow" value="together">/.test(d))
  assert.ok(words(d).includes('One worktree for all of them, with one agent') && words(d).includes('A worktree for each, named from its title'))
  assert.ok(/data-field="workName"[^>]*value="fix-a-b"/.test(d) && words(d).includes('Fix both'))
  assert.ok(/class="one-only"><label class="field"><span>Worktree and branch/.test(d) && /class="field one-only"><span>The agent is told/.test(d), 'one-worktree fields hide when each is picked')
  assert.ok(words(d).includes('Each agent opens its PR when the work is done, without waiting for me'))
  assert.ok(!words(dialog(ui({ dialog: { type: 'work', ids: ['a'], name: 'x', base: 'main', brief: 'B', autoBrief: 'A' } }), [])).includes('A worktree for each'))
})

test('the Start work dialog has its name and base fields filled and shows the brief', () => {
  assert.equal(button(detailPane(detail('kept'), overview(), ui(), {}), 'Start work')!.attrs['data-do'], 'start')
  const d = dialog(ui({ dialog: { type: 'work', ids: ['a'], name: 'enter-set-fg', base: 'main', brief: 'Fix it', autoBrief: 'Fix it, then PR' } }), [])
  assert.ok(words(d).includes('Start work') && words(d).includes('Makes a worktree and opens its agent as a chat, already briefed.'))
  assert.ok(/data-field="workName"[^>]*value="enter-set-fg"/.test(d) && /data-field="workBase"[^>]*value="main"/.test(d))
  assert.ok(words(d).includes('Worktree and branch') && words(d).includes('Starts from') && words(d).includes('The agent is told') && words(d).includes('Fix it'))
  assert.ok(button(d, 'Start work') && button(d, 'Cancel'))
  assert.ok(/data-field="autoPr"(?! checked)/.test(d) && words(d).includes('The agent opens a PR when the work is done, without waiting for me'), 'unticked by default')
  assert.ok(/class="brief pr-owner">Fix it</.test(d) && /class="brief pr-auto">Fix it, then PR</.test(d), 'ticking it swaps in the brief it sends')
})

test('with no personas the popover offers Set up personas', () => {
  const html = header(overview({ personas: [], configError: null }), ui())
  assert.ok(words(html).includes('No personas yet.'))
  assert.equal(button(html, 'Set up personas')!.attrs['data-do'], 'setup')
})

test('a persona.studio that does not load says why where the personas would be', () => {
  const html = header(overview({ personas: [], configError: 'persona.studio: "port" <must> be a number.' }), ui())
  assert.ok(words(html).includes("Persona Studio can&#39;t load this project: persona.studio: &quot;port&quot; &lt;must&gt; be a number."))
  assert.ok(!words(html).includes('No personas yet'))
})

test('a run still preparing lights Preparing and names no branch yet', () => {
  const html = personaPane(personDetail({ branch: null }, { state: 'running', stage: 'Preparing', runs: 1 }))
  assert.ok(words(html).includes('Running in its own copy · port 4210'))
  assert.match(html, /<span class="on">Preparing<\/span><span class="">Using the app<\/span>/)
})

test('a persona\'s portrait stands in for its initial in the Personas list, the header and its page; only an image URL is drawn', () => {
  const pic = 'data:image/svg+xml;base64,PHN2Zy8+', o = overview()
  o.personas[0] = { ...o.personas[0], portrait: pic }
  o.personas[1] = { ...o.personas[1], portrait: 'javascript:alert(1)' }
  const html = header(o, ui({ persona: 'priya' }))
  const img = `<img class="avatar" src="${pic}" alt="">`
  assert.ok(buttons(html).find((b) => b.attrs['data-persona'] === 'priya')!.inner.includes(img), 'in the list')
  assert.ok(buttons(html).find((b) => b.attrs.popovertarget === 'personas')!.inner.includes(img), 'in the header')
  const dex = buttons(html).find((b) => b.attrs['data-persona'] === 'dex')!.inner
  assert.ok(!dex.includes('<img') && !html.includes('javascript:') && dex.includes('>D</span>'), 'anything else: the initial')
  assert.ok(personaPane(personDetail({}, { portrait: pic })).includes(`<img class="portrait" src="${pic}" alt="">`))
  assert.ok(!personaPane(personDetail()).includes('<img'))
})

test('a persona whose last run failed says why on its page; its name and tag sit beside the portrait', () => {
  const h = personaPane(personDetail({}, { runs: 1, error: 'The app shows <only> an error.' }))
  assert.ok(h.includes('The last run failed') && h.includes('The app shows &lt;only&gt; an error.'))
  assert.ok(!h.includes('<b>Idle</b>'))
  assert.match(h, /<div class="named"><h1>Dex<\/h1><p class="sub">draws by hand<\/p><\/div>/)
})

test('a persona page puts Run after Edit persona at the top, with no action bar below', () => {
  const h = personaPane(personDetail())
  assert.ok(h.indexOf('Edit persona') < h.indexOf('Run Dex') && h.indexOf('Run Dex') < h.indexOf('class="card"'))
  assert.ok(!h.includes('class="actions"'))
})

test('the search shows its own clear button only while it has text', () => {
  assert.ok(!header(overview(), ui()).includes('data-do="clear-q"'))
  assert.ok(header(overview(), ui({ q: 'export' })).includes('data-do="clear-q" aria-label="Clear the search">&times;</button>'))
})

test('the zero state says why personas help, how setup goes, and offers Set up personas', () => {
  const h = zeroPane()
  assert.ok(h.includes("See your app through your users' eyes") && h.includes("Setup happens in a quick chat. An agent handles the wiring while you shape the personas. Nothing gets committed until you decide it's ready."))
  assert.ok(h.includes('Run your personas to test your app from their perspective.'))
  assert.ok(h.includes('data-do="setup"') && h.includes('Set up personas'))
  // The own-harness steps are for developers, so they name the files; the pitch above them doesn't.
  const pitch = h.slice(0, h.indexOf('<details'))
  assert.ok(!/start command|prepare|persona\.studio/i.test(pitch))
  assert.ok(h.includes('<details class="part"><summary>') && h.includes('data-url="https://github.com/jejacks0n/orca-persona-studio/blob/main/plugin/CONTRACT.md"'))
})
