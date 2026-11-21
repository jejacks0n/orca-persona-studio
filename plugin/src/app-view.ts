// The Persona Studio tab's screens as HTML strings. Pure: the tab's glue sets them into the page and acts on each control's
// `data-do` (with the ids it carries in `data-*`) and on each field's `data-field`. The root they fill has class `app`;
// src/app-styles.ts lays its children out (header, list, detail, notice bar) wherever they sit in it.
import { counts, rows, type Filter, type Row } from './findings-view'
import { reasonWord, severityWord, stateWord, STATES, type CloseReason, type FindingState, type Kind } from './model'
import { CONTRACT_URL, statusOf, type Detail, type Overview, type PersonaDetail, type ReportView } from './protocol'
import { SAMPLE_PORTRAITS } from './samples'
import { drawTrend, esc, type Trend } from './trends-draw'

/** A run that uncommitted changes held back, to start anyway. */
export type RunAgain = { persona: string; name: string; focus?: string }
/** What the owner chose or typed on the tab. It outlives refetches. `notes`: the open finding's draft, `base` the mtime it started from. */
export interface Ui { tab: FindingState; persona: string | null; kind: Kind | 'all'; q: string; open: string | null
  /** `anchor`: the row a Shift-click selects from, the last one clicked. */
  picked: string[]; anchor?: string; view: 'list' | 'detail'; notice: { text: string; undo?: string; anyway?: RunAgain } | null
  /** `opened`: a finding was opened from the list, so it shows instead of the chosen persona's pane (`personaDetail`). */
  opened: boolean; personaDetail: PersonaDetail | null
  dialog: null | { type: 'run'; persona: string; name: string; recheck: number } | { type: 'close'; ids: string[] } | { type: 'group'; ids: string[] } | { type: 'issue'; title: string; body: string; notes: string } | { type: 'work'; ids: string[]; name: string; base: string; brief: string; autoBrief: string } | { type: 'shot'; url: string }
  notes: { text: string; base: number; dirty: boolean } | null; problem: string }
export const freshUi = (): Ui => ({ tab: 'new', persona: null, kind: 'all', q: '', open: null, picked: [], view: 'list',
  opened: false, personaDetail: null, notice: null, dialog: null, notes: null, problem: '' })

const PATHS = {
  bug: '<path d="M8.5 7a3.5 3.5 0 0 1 7 0"/><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 20l3-2M20 20l-3-2"/>',
  missing: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 3"/><path d="M12 8v8M8 12h8"/>',
  polish: '<path d="M11 3l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z"/><path d="M19 15v5M16.5 17.5h5"/>',
  check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', back: '<path d="M15 5l-7 7 7 7"/>', down: '<path d="M6 9l6 6 6-6"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-6 3-6 7"/>',
  group: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', issue: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', play: '<path d="M8 5v14l11-7z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>', right: '<path d="M9 6l6 6-6 6"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 3.8-6 7-6s6 2 7 6"/>', chart: '<path d="M4 19h16"/><path d="M6 16l4-5 3 3 5-7"/>' }
const icon = (n: keyof typeof PATHS, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n]}</svg>`
// Theater masks: Lucide's "drama" icon (lucide.dev, ISC license).
const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11h.01"/><path d="M14 6h.01"/><path d="M18 6h.01"/><path d="M6.5 13.1h.01"/><path d="M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"/><path d="M17.4 9.9c-.8.8-2 .8-2.8 0"/><path d="M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"/><path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"/></svg>'
const kindWord: Record<Kind, string> = { bug: 'Bug', missing: 'Missing', polish: 'Polish' }
const KINDS: [Kind | 'all', string][] = [['all', 'All'], ['bug', 'Bugs'], ['missing', 'Missing'], ['polish', 'Polish']]
const REASONS = Object.keys(reasonWord) as CloseReason[]

// Small pieces. `inner` is HTML the caller already escaped; every attribute value goes through esc here.
type Attrs = Record<string, string | undefined>
const attrs = (a: Attrs) => Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(v!)}"`).join('')
const btn = (inner: string, a: Attrs, cls = 'btn') => `<button type="button" class="${cls}"${attrs(a)}>${inner}</button>`
const chip = (inner: string, cls = '') => `<span class="chip${cls ? ` ${cls}` : ''}">${inner}</span>`
const span = (text: string, cls = '') => `<span${cls ? ` class="${cls}"` : ''}>${esc(text)}</span>`
/** Only http(s) links: anything else could run in the page. Otherwise the words alone. */
const link = (label: string, url: string | undefined) => (url && /^https?:\/\//i.test(url)
  ? `<a href="${esc(url)}" data-do="link" data-url="${esc(url)}">${esc(label)}</a>` : esc(label))
/** Only image data URLs are drawn: the worker sends nothing else, and anything else isn't safe as a src. */
const isImage = (url: string | null | undefined): url is string => typeof url === 'string' && /^data:image\//i.test(url)
/** The persona's portrait in a circle, or its initial when it has none. */
const avatar = (p: { name: string; portrait?: string }) => isImage(p.portrait) ? `<img class="avatar" src="${esc(p.portrait)}" alt="">`
  : `<span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1))}</span>`
const nameOf = (o: Overview, id: string) => o.personas.find((p) => p.id === id)?.name ?? id
const namesOf = (o: Overview, ids: readonly string[]) => ids.map((id) => nameOf(o, id)).join(', ')
const severityChip = (s: Row['severity']) => chip(esc(severityWord[s]), s === 'blocker' || s === 'major' ? 'strong' : '')
const filterOf = (ui: Ui): Omit<Filter, 'state'> =>
  ({ persona: ui.persona ?? undefined, kind: ui.kind === 'all' ? undefined : ui.kind, q: ui.q.trim() || undefined })

/** The brand, the Personas list (a popover that filters by persona; the chosen one shows on its button, with a clear
 *  beside it), the search and the kinds. */
export function header(o: Overview, ui: Ui): string {
  const on = o.personas.find((p) => p.id === ui.persona), chev = icon('down', 'chev')
  const pick = on ? '<div class="pick on">' + btn(avatar(on)
      + `${on.state === 'running' ? '<i class="dot"></i>' : ''}<span class="name">${esc(on.name)}</span>${chev}`,
    { popovertarget: 'personas', 'aria-label': `Active persona: ${on.name}. Switch persona`, title: `Showing only ${on.name}'s findings` })
    + btn(icon('x'), { 'data-do': 'everyone', 'aria-label': 'Clear the active persona', title: "Clear: show everyone's findings" }) + '</div>'
    : `<div class="pick">${btn(`Personas${chev}`, { popovertarget: 'personas' })}</div>`
  const people = o.configError !== null && o.personas.length === 0 ? `<p class="empty">${esc(`Persona Studio can't load this project: ${o.configError}`)}</p>`
    : o.personas.length === 0 ? `<div class="empty"><p>No personas yet.</p>${btn('Set up personas', { 'data-do': 'setup' }, 'btn primary')}</div>` : o.personas.map((p) =>
    btn(`${avatar(p)}<span class="name">${esc(p.name)}</span>`
      + `${p.fresh ? `<span class="badge">${p.fresh} new</span>` : ''}`
      + (p.state === 'running' ? `<span class="what live"><i class="dot"></i>${esc(statusOf(p))}</span>` : `<span class="what">${esc(p.tag)}</span>`),
    { 'data-do': 'persona', 'data-persona': p.id, 'aria-pressed': String(ui.persona === p.id) }, 'persona')).join('')
  return `<header class="top"><div class="brand">${LOGO}Persona Studio</div>`
    + pick
    + `<div class="pop" id="personas" popover><div class="colhead">Personas</div>${people}</div>`
    + `<label class="search">${icon('search')}<input type="search" data-field="q" value="${esc(ui.q)}" placeholder="Search findings" aria-label="Search findings">${ui.q ? btn('&times;', { 'data-do': 'clear-q', 'aria-label': 'Clear the search' }, 'clear') : ''}</label>`
    + `<div class="seg" role="group" aria-label="Kind">${KINDS.map(([k, label]) =>
      btn(esc(label), { 'data-do': 'kind', 'data-kind': k, 'aria-pressed': String(ui.kind === k) }, '')).join('')}</div></header>`
}

/** One row: its kind, and a button over the rest of it that opens it; ⌘/Ctrl- and Shift-click select (src/app-logic.ts). */
function rowHtml(r: Row, o: Overview, ui: Ui): string {
  const meta = [r.reopened ? chip('Reopened', 'k-polish') : '', severityChip(r.severity), span(kindWord[r.kind]), span(namesOf(o, r.personas)),
    r.runs > 1 ? span(`seen in ${r.runs} runs`) : '', r.members ? chip(`${icon('group')}${r.members} reports`) : '',
    r.pr ? span(`PR #${r.pr.number} ${r.pr.state}`) : r.state === 'progress' ? span('no PR yet') : '',
    r.confirmedBy ? span(`Confirmed by ${nameOf(o, r.confirmedBy)}`, 'ok') : '', r.issue ? span(`Issue #${r.issue}`) : '',
    r.closedReason ? span(reasonWord[r.closedReason]) : ''].join('')
  const on = ui.picked.includes(r.id)
  return `<div class="row${on ? ' picked' : ''}"><span class="k k-${r.kind}" title="${kindWord[r.kind]}">${icon(r.kind)}</span>`
    + btn(`<span class="title">${esc(r.title)}</span><span class="meta">${meta}</span>${on ? '<span class="sr">Selected</span>' : ''}`,
      { 'data-do': 'open', 'data-id': r.id, 'aria-current': ui.open === r.id ? 'true' : undefined }, 'open') + '</div>'
}

/** The five lists as tabs with their counts, the persona filter, the bulk bar for selected rows, and the chosen list. */
export function listPane(all: readonly Row[], o: Overview, ui: Ui): string {
  const f = filterOf(ui), n = counts(all, f), shown = rows(all, { state: ui.tab, ...f })
  const tabs = `<div class="tabs" role="tablist">${STATES.map((s) => btn(`${esc(stateWord[s])}<b>${n[s]}</b>`,
    { role: 'tab', 'aria-selected': String(ui.tab === s), 'data-do': 'tab', 'data-tab': s }, '')).join('')}</div>`
  const who = ui.persona ? nameOf(o, ui.persona) : ''
  const k = ui.picked.length
  const bulk = k ? `<div class="bulk"><span>${k} selected</span>${btn(`${icon('group')}Group`, { 'data-do': 'group' }, 'btn small')}`
    + (ui.tab === 'new' ? btn('Keep', { 'data-do': 'bulk-keep' }, 'btn small') : '')
    // Only New and Kept findings can be closed.
    + (ui.tab === 'kept' ? btn('Start work…', { 'data-do': 'bulk-work' }, 'btn small') : '')
    + (ui.tab === 'new' || ui.tab === 'kept' ? btn('Close…', { 'data-do': 'bulk-close' }, 'btn small') : '')
    + btn(icon('x'), { 'data-do': 'unpick', 'aria-label': 'Clear selection' }, 'btn small ghost') + '</div>' : ''
  const empty = f.q || f.kind ? 'Nothing matches' : ui.tab === 'new' ? `Nothing new${who ? ` from ${who}` : ''}` : 'Nothing here yet'
  const body = shown.length ? shown.map((r) => rowHtml(r, o, ui)).join('') : `<div class="empty"><b>${esc(empty)}</b></div>`
  return `<section class="list" aria-label="Findings">${tabs}${bulk}<div class="scroll">${body}</div></section>`
}

/** One report: what its persona saw, the steps, and its screenshots as they load. */
function reportHtml(r: ReportView, shots: Record<string, string | null>): string {
  const pics = r.shots.map((_, i) => {
    const key = `${r.id}:${i}`, d = { 'data-report': r.id, 'data-index': String(i) }, n = i + 1
    if (!(key in shots)) return `<div class="shot-wait"${attrs(d)} role="img" aria-label="Screenshot ${n}, loading"></div>`
    const url = shots[key]
    return isImage(url)
      ? btn(`<img src="${esc(url)}" alt="Screenshot ${n} from ${esc(r.personaName)}&#39;s run">`, { 'data-do': 'shot-zoom', ...d, 'aria-label': `Enlarge screenshot ${n}` }, 'shot')
      : btn(`Open screenshot ${n}`, { 'data-do': 'shot-open', ...d }, 'linkish')
  }).join('')
  return `<h3>What ${esc(r.personaName)} saw</h3><p>${esc(r.saw)}</p>`
    + (r.steps.length ? `<h3>Steps to reproduce</h3><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '')
    + (pics ? `<h3>Screenshots</h3><div class="shots">${pics}</div>` : '')
}

const backbar = (always = false) => `<div class="backbar${always ? ' always' : ''}">${btn(`${icon('back')}Findings`, { 'data-do': 'back' }, 'btn small ghost')}</div>`

/** The open finding: what it is, where its work stands, each report, the notes and history, and what can be done with it now. */
export function detailPane(d: Detail | null, o: Overview, ui: Ui, shots: Record<string, string | null>): string {
  const back = backbar(!!ui.persona)
  if (!d) return `<section class="detail" aria-label="Finding">${back}<div class="empty"><b>No finding selected</b>Pick one from the list to read what the persona saw.</div></section>`
  const f = d.finding, pr = f.work?.pr, first = f.reports[0]?.personaName ?? 'The persona'
  const seenBy = [...new Set(f.reports.map((r) => r.personaName))].join(', '), runs = new Set(f.reports.map((r) => r.runId)).size
  const meta = chip(`${icon(f.kind)}${kindWord[f.kind]}`, `k-${f.kind}`) + severityChip(f.severity) + span(stateWord[f.state])
    + span(`Seen by ${seenBy}${runs > 1 ? `, in ${runs} runs` : ''}`) + (f.issue ? `<span>${link(`Issue #${f.issue.number}`, f.issue.url)}</span>` : '')
  const reopened = f.reopened ? `<div class="card warn"><b>Reopened${pr ? ` after PR #${pr.number}` : ''}</b><div>${esc(f.reopened.note)}</div></div>` : ''
  const work = f.work ? `<div class="card"><div class="line">${icon('branch')}<b>${esc(f.work.worktreePath.split(/[\\/]/).filter(Boolean).pop() ?? '')}</b>`
    + `${span(f.work.branch, 'dim mono')}</div><div class="line">${pr ? link(`PR #${pr.number} ${pr.state}`, pr.url) : span('No PR yet', 'dim')}</div></div>` : ''
  const fixed = f.state === 'fixed' ? `<div class="card"><div class="line">${icon('check', 'ok')}${pr ? `<span>Merged in ${link(`PR #${pr.number}`, pr.url)}.</span>` : ''}`
    + (f.confirmed ? span(`Confirmed by ${nameOf(o, f.confirmed.by)}.`, 'ok') : span(`${first} checks it again on the next run.`, 'dim')) + '</div></div>' : ''
  const closed = f.state === 'closed' && f.closed ? `<div class="card"><b>${esc(reasonWord[f.closed.reason])}</b>${f.closed.why ? `<div class="dim">${esc(f.closed.why)}</div>` : ''}</div>` : ''
  const members = f.members.length ? `<h3>Reports in this group</h3><ol>${f.members.map((m) => `<li>${esc(`${m.title} (${namesOf(o, m.personas)})`)}</li>`).join('')}</ol>`
    + `<div class="hint">${btn('Ungroup', { 'data-do': 'ungroup' }, 'btn small')}</div>` : ''
  const notes = (ui.problem ? `<div class="callout danger" role="alert">${esc(ui.problem)}</div>` : '')
    + `<h3><label for="ps-notes">Notes</label>${ui.notes?.dirty ? ' <span class="saving">Saving…</span>' : ''}</h3>`
    + `<textarea id="ps-notes" data-field="notes" placeholder="How to fix it, what it connects to, anything whoever does the work should know.">${esc(ui.notes?.text ?? d.notes.text)}</textarea>`
    + '<div class="hint">What you decide in Discuss lands here too. Whoever does the work starts from these.</div>'
  const history = f.history.length ? `<h3>History</h3><ul class="timeline">${f.history.map((h) => `<li>${esc(h.text)}</li>`).join('')}</ul>` : ''
  const close = btn('Close…', { 'data-do': 'close' }, 'btn push danger'), reopen = btn('Reopen', { 'data-do': 'reopen' }, 'btn push')
  const discuss = btn(`${icon('chat')}Discuss`, { 'data-do': 'discuss' })
  const acts: Record<FindingState, string> = {
    new: discuss + btn(`${icon('check')}Keep`, { 'data-do': 'keep' }, 'btn primary') + btn(`${icon('group')}Group with…`, { 'data-do': 'group-with' }) + close,
    kept: discuss + btn(`${icon('branch')}Start work`, { 'data-do': 'start' }, 'btn primary') + (o.hasGh && !f.issue ? btn(`${icon('issue')}Make an issue`, { 'data-do': 'issue' }) : '') + close,
    progress: discuss, fixed: discuss + reopen, closed: discuss + reopen }
  return `<section class="detail" aria-label="Finding">${back}<div class="scroll"><div class="dbody"><div class="meta">${meta}</div><h2>${esc(f.title)}</h2>`
    + `${reopened}${work}${fixed}${closed}${f.reports.map((r) => reportHtml(r, shots)).join('')}${members}${notes}${history}</div></div>`
    + (acts[f.state] ? `<div class="actions">${acts[f.state]}</div>` : '') + '</section>'
}

const STAGES = ['Preparing', 'Using the app', 'Writing up', 'Matching']
/** When it last ran: a date, as there's no relative-time helper here. */
const when = (at: number) => new Date(at).toLocaleString()

/** The chosen persona: its run (or when it last ran), its findings by list, who it is, its goals, and Run or Watch and Stop. `rows` are the project's findings. */
export function personaPane(d: PersonaDetail | null, rows: readonly Row[] = []): string {
  if (!d) return `<section class="detail" aria-label="Persona">${backbar()}<div class="empty"><b>Loading…</b></div></section>`
  const measured = (t: Trend) => { const v = t.points[t.points.length - 1].value, u = t.unit ? ` ${t.unit}` : ''
    return `${v}${u} · target: at ${t.better === 'lower' ? 'most' : 'least'} ${t.target}${u}` }
  const p = d.row, n = counts(rows, { persona: p.id }), running = p.state === 'running'
  const stage = STAGES.findIndex((s) => p.stage?.startsWith(s))
  const card = running
    ? `<div class="card"><div class="line"><i class="dot"></i><b>Running</b>${span(['in its own copy', d.branch, d.port !== null && `port ${d.port}`].filter(Boolean).join(' · '), 'dim')}</div>`
      + `<div class="stages">${STAGES.map((s, i) => `<span class="${i === stage ? 'on' : i < stage ? 'done' : ''}">${s}</span>`).join('')}</div>`
      + `<ul class="log">${d.lines.slice(-5).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`
    : p.error !== undefined ? `<div class="card bad"><div class="line"><b>The last run failed</b></div><p class="why">${esc(p.error)}</p></div>`
    : `<div class="card"><div class="line"><b>${p.runs ? 'Idle' : 'Never run'}</b>${span(p.runs
      ? `last ran ${p.lastRunAt ? when(p.lastRunAt) : 'earlier'} · ${p.runs} run${p.runs > 1 ? 's' : ''} so far` : 'Its first run starts from its persona file and goals.', 'dim')}</div></div>`
  const goals = d.goals.length ? `<h3>Goals</h3>${d.goals.map((g) => `<div class="card"><div class="line goal"><span>${esc(g.text)}</span>`
    + `${span(g.met ? 'Met' : 'Not met', g.met ? 'ok push' : 'dim push')}</div>${g.trend?.points.length ? `<div class="dim">${esc(measured(g.trend))}</div>` : ''}${g.trend?.points.length ? drawTrend(g.trend, { w: 480, h: 140 }) : ''}</div>`).join('')}` : ''
  const acts = running
    ? btn(`Watch the run`, { 'data-do': 'watch', 'data-persona': p.id }, 'btn small') + btn('Stop', { 'data-do': 'stop', 'data-persona': p.id }, 'btn small')
    : btn(icon('play') + esc(p.runs ? `Run ${p.name} again` : `Run ${p.name}`), { 'data-do': 'run', 'data-persona': p.id }, 'btn small primary')
  return `<section class="detail" aria-label="Persona">${backbar()}<div class="scroll"><div class="dbody"><div class="titled">${isImage(p.portrait) ? `<img class="portrait" src="${esc(p.portrait)}" alt="">` : ''}`
    + `<div class="named"><h1>${esc(p.name)}</h1><p class="sub">${esc(p.tag)}</p></div>${btn('Edit persona', { 'data-do': 'edit-persona', 'data-persona': p.id }, 'btn small')}${acts}</div>${card}<div class="meta stats"><span class="label">Findings:</span>${STATES.map((s) => chip(`${esc(stateWord[s])} ${n[s]}`)).join('')}</div>`
    + `${d.who.length ? `<h3>Who</h3><div class="who">${d.who.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : ''}`
    + `${goals}</div></div></section>`
}

const foot = (label: string) => `<div class="dfoot">${btn('Cancel', { 'data-do': 'cancel' })}<button class="btn primary" value="ok">${esc(label)}</button></div>`
const radio = (fieldName: string, value: string, label: string, checked: boolean) =>
  `<label class="radio"><input type="radio" name="${fieldName}" data-field="${fieldName}" value="${esc(value)}"${checked ? ' checked autofocus' : ''}>${esc(label)}</label>`
const check = (fieldName: string, label: string, checked: boolean) =>
  `<label class="check"><input type="checkbox" data-field="${fieldName}"${checked ? ' checked' : ''}>${esc(label)}</label>`
const text = (label: string, fieldName: string, value = '') =>
  `<label class="field"><span>${esc(label)}</span><input type="text" data-field="${fieldName}" value="${esc(value)}" autocomplete="off"></label>`

/** The open dialog, if any: Run again, Close, Group, Start work, Make an issue, or a screenshot enlarged. */
export function dialog(ui: Ui, all: readonly Row[]): string {
  const g = ui.dialog
  if (!g) return ''
  let body: string
  if (g.type === 'run') {
    const n = g.recheck
    body = `<h2 id="dlg-title">Run ${esc(g.name)} again</h2><p class="dim">${n ? `${esc(g.name)} first rechecks ${n} fix${n > 1 ? 'es' : ''} merged since the last run, then looks for what&#39;s new.`
      : `${esc(g.name)} looks for what&#39;s new since the last run.`}</p>`
      + `<label class="field"><span>Anything to focus on? (optional)</span><textarea data-field="focus" rows="3" autofocus></textarea></label>${foot('Run')}`
  } else if (g.type === 'close') {
    const n = g.ids.length, hasIssue = all.some((r) => g.ids.includes(r.id) && r.issue !== undefined)
    body = `<h2 id="dlg-title">${n > 1 ? `Close ${n} findings` : 'Close this finding'}</h2>`
      + REASONS.map((r, i) => radio('reason', r, reasonWord[r], i === 0)).join('') + text('Why? (optional)', 'why')
      + (hasIssue ? check('closeIssue', 'Also close its GitHub issue', true) : '')
      + foot('Close')
  } else if (g.type === 'group') {
    const picked = g.ids.map((id) => all.find((r) => r.id === id)).filter((r): r is Row => !!r)
    body = `<h2 id="dlg-title">Group ${picked.length} findings</h2><p class="dim">They become one finding that carries every report. Which title leads?</p>`
      + picked.map((r, i) => radio('lead', r.id, r.title, i === 0)).join('') + text('Or a new title', 'title') + foot('Group')
  } else if (g.type === 'issue') {
    body = `<h2 id="dlg-title">Make a GitHub issue</h2><p class="dim">You see the text before anything is public.</p>${text('Title', 'issueTitle', g.title)}`
      + `<label class="field"><span>Body</span><textarea data-field="issueBody" rows="8">${esc(g.body)}</textarea></label>`
      + check('includeNotes', "Include my notes (they're left out unless you tick this)", false)
      + (g.notes ? `<div class="brief">${esc(g.notes)}</div>` : '') + foot('Open the issue')
  } else if (g.type === 'work') {
    const many = g.ids.length > 1
    const pr = check('autoPr', many ? 'Each agent opens its PR when the work is done, without waiting for me' : 'The agent opens a PR when the work is done, without waiting for me', false)
    const told = (cls: string) => `<div class="field${cls}"><span>The agent is told</span><div class="brief pr-owner">${esc(g.brief)}</div><div class="brief pr-auto">${esc(g.autoBrief)}</div></div>`
    body = many
      ? `<h2 id="dlg-title">Start work on ${g.ids.length} findings</h2><p class="dim">Each worktree opens its agent as a chat, already briefed.</p>`
        + radio('workHow', 'each', 'A worktree for each, named from its title', true)
        + radio('workHow', 'together', 'One worktree for all of them, with one agent', false)
        + `<div class="one-only">${text('Worktree and branch', 'workName', g.name)}</div>${text('Starts from', 'workBase', g.base)}${pr}${told(' one-only')}${foot('Start work')}`
      : `<h2 id="dlg-title">Start work</h2><p class="dim">Makes a worktree and opens its agent as a chat, already briefed.</p>${text('Worktree and branch', 'workName', g.name)}${text('Starts from', 'workBase', g.base)}${pr}${told('')}${foot('Start work')}`
  } else {
    body = `<h2 id="dlg-title">Screenshot</h2>${isImage(g.url) ? `<img class="big" src="${esc(g.url)}" alt="Screenshot from the run">` : ''}`
      + `<div class="dfoot">${btn('Done', { 'data-do': 'cancel', autofocus: '' }, 'btn primary')}</div>`
  }
  return `<dialog id="dlg"${g.type === 'shot' ? ' class="wide"' : ''} closedby="any" aria-labelledby="dlg-title"><form method="dialog">${body}</form></dialog>`
}

/** The bar under the lists: the last thing that happened, with Undo when it can be undone. Empty (and hidden) with no notice. */
export function noticeBar(ui: Ui): string {
  const n = ui.notice
  return `<div class="notice" role="region" aria-label="Notifications" aria-live="polite">${n ? `<p>${esc(n.text)}</p>`
    + (n.undo ? btn('Undo', { 'data-do': 'undo' }, 'btn small') : '') + (n.anyway ? btn('Run anyway', { 'data-do': 'run-anyway' }, 'btn small') : '') + btn(icon('x'), { 'data-do': 'dismiss', 'aria-label': 'Dismiss' }, 'btn small ghost') : ''}</div>`
}

/** The whole tab before a project has personas: what a persona is, why they help, what setup is, and Set up personas.
 *  Its copy is the owner's; the layout is the zero-state mockup's. */
export function zeroPane(): string {
  const why = [['check', 'Personas go beyond your test suite, exploring the paths a real person takes and catching surprises you never thought to script.'],
    ['person', 'Test as real people, not "a user." Someone who never touches the mouse runs into very different walls than someone rushing on a phone.'],
    ['chart', 'Give a persona a measurable goal, like exporting in three keystrokes or fewer, and track your progress across every run.']] as const
  const steps = [
    "The agent learns what your app does and who it's for.",
    'You keep, rename, or tweak the personas it suggests.',
    'The agent makes sure your app starts cleanly.',
    'Each persona is saved as a file in your project.',
    'Run your personas to test your app from their perspective.',
  ]
  return `<main class="zero"><div class="zbody">`
    + `<header class="hero"><div class="faces">${SAMPLE_PORTRAITS.map((svg) => `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="">`).join('')}</div><h1>See your app through your users' eyes before they tell you what's broken</h1>`
    + `<p>Each persona is a distinct user with a real job to do. Persona Studio sends them into your app in Orca's browser and brings back the bugs, missing pieces, and rough edges that got in their way.</p></header>`
    + `<section class="part"><h2>Why personas</h2><ul class="rows">${why.map(([i, t]) => `<li><span class="mark">${icon(i)}</span><span>${esc(t)}</span></li>`).join('')}</ul></section>`
    + `<section class="part"><h2>Setup</h2><p class="intro">Setup happens in a quick chat. An agent handles the wiring while you shape the personas. Nothing gets committed until you decide it's ready.</p>`
    + `<ol class="rows">${steps.map((t, n) => `<li><span class="mark num">${n + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>`
    + `<div class="foot"><span class="dim">Works with web apps out of the box · Takes a few minutes</span>${btn('Set up personas', { 'data-do': 'setup' }, 'btn primary')}</div></section>`
    + `<details class="part"><summary><span class="mark">${icon('right', 'chev')}</span><b>Not a web app? Bring your own harness</b><span class="dim">CLI, desktop app, API</span></summary><div class="more"><ol class="rows">`
    + `<li><span class="mark num">1</span><div>Once you have personas (setup makes them for any app), set <code>runPrompt</code> in <code>persona.studio</code> to a <code>.md</code> path or inline prompt telling the agent how to start and drive your app, where to write its results, and to write <code>{doneFile}</code> when finished.</div></li>`
    + `<li><span class="mark num">2</span><div>Optionally set <code>reviewPrompt</code> for a second agent that turns raw run output into findings.</div></li></ol>`
    + `<p>See ${link('CONTRACT.md', CONTRACT_URL)} for the full spec (placeholders, results format, and done files).</p></div></details></div></main>`
}

/** The whole tab when there's no project to show. */
export const message = (text: string): string => `<main class="message"><p>${esc(text)}</p></main>`
