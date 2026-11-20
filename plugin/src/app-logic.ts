// What the Persona Studio tab does, apart from drawing: which request a control sends, what typing changes, and what
// survives a refetch. Pure, so it runs in tests; src/app.ts wires it to the page and src/app-view.ts draws it.
import type { PluginPanelEvents, PluginRequestInput, PluginRequestOutput, PluginRequests } from 'orca'
import type { RunAgain, Ui } from './app-view'
import type { Action } from './finding'
import { rows as listed, type Row } from './findings-view'
import { reasonWord, STATES, type CloseReason, type FindingState, type Kind } from './model'
import { setupWords, uncommittedWords, type Detail, type PersonaRow, type Show } from './protocol'

type Request = { [K in keyof PluginRequests]: { name: K; input: PluginRequestInput<K> } }[keyof PluginRequests]
/** A control's effect: a request to the worker (`then` changes the tab once it worked), a change to the tab alone, or a link to open. */
export type Act = { request: Request; then?: (ui: Ui, output: unknown) => Ui } | { ui: (ui: Ui) => Ui } | { link: string } | null
export interface Ctx { project: string; rows: readonly Row[]; form?: Record<string, string>; shots?: Record<string, string | null> }

const ask = <K extends keyof PluginRequests>(name: K, input: PluginRequestInput<K>, then?: (ui: Ui, out: PluginRequestOutput<K>) => Ui): Act =>
  ({ request: { name, input } as Request, ...(then && { then: then as (ui: Ui, out: unknown) => Ui }) })
const change = (f: (ui: Ui) => Ui): Act => ({ ui: f })
const say = (text: string, undo?: string | null) => (ui: Ui): Ui => ({ ...ui, notice: undo ? { text, undo } : { text } })
const started = (name: string) => say(`${name} is running in its own copy. Carry on with the others.`)
/** Start a run; uncommitted changes hold it back, and the notice offers Run anyway. */
const startRun = (project: string, again: RunAgain, anyway = false): Act =>
  ask('run.start', { project, persona: again.persona, ...(again.focus && { focus: again.focus }), ...(anyway && { anyway }) },
    (u, out) => ('uncommitted' in out ? { ...u, notice: { text: uncommittedWords(out.uncommitted), anyway: again } } : started(again.name)(u)))
const KINDS: readonly string[] = ['all', 'bug', 'missing', 'polish']
const toggle = (list: readonly string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
const counted = (word: string, n: number) => (n > 1 ? `${word} ${n}` : word)

/** What a click on a control with these data attributes does, given the dialog's form values when it closes one (`do: 'submit'`). Null for a control that can't act now. */
export function actionOf(d: Partial<Record<string, string>>, ui: Ui, ctx: Ctx): Act {
  const { project } = ctx, open = ui.open
  const finding = (action: Action, notice: (ui: Ui, undo: string | null) => Ui) =>
    ask('finding.act', { project, action }, (u, out) => notice(u, out.undo))
  switch (d.do) {
    case 'tab': return STATES.includes(d.tab as FindingState) ? change((u) => ({ ...u, tab: d.tab as FindingState })) : null
    case 'kind': return KINDS.includes(d.kind ?? '') ? change((u) => ({ ...u, kind: d.kind as Kind | 'all' })) : null
    // The chosen persona again shows everyone's.
    case 'persona': return d.persona ? change((u) => ({ ...u, persona: u.persona === d.persona ? null : d.persona!, opened: false,
      // Choosing a persona shows its pane, which in a narrow tab is the detail view.
      ...(u.persona !== d.persona && { view: 'detail' as const }) })) : null
    case 'everyone': return change((u) => ({ ...u, persona: null }))
    case 'clear-q': return change((u) => ({ ...u, q: '' }))
    case 'pick': return d.id ? change((u) => ({ ...u, picked: toggle(u.picked, d.id!) })) : null
    case 'unpick': return change((u) => ({ ...u, picked: [] }))
    // Opening another finding starts its notes afresh; the open one again only shows it.
    case 'open': return d.id ? change((u) => (u.open === d.id ? { ...u, view: 'detail', opened: true } : { ...u, open: d.id!, view: 'detail', opened: true, notes: null, problem: '' })) : null
    // Back to the list, and to the chosen persona's pane when a finding had replaced it.
    case 'back': return change((u) => ({ ...u, view: 'list', opened: false }))
    case 'dismiss': return change((u) => ({ ...u, notice: null }))
    case 'cancel': return change((u) => ({ ...u, dialog: null }))
    case 'link': return d.url && /^https?:\/\//i.test(d.url) ? { link: d.url } : null
    case 'group':
      return ui.picked.length < 2 ? change(say('Tick two or more findings in the list, then press Group.'))
        : change((u) => ({ ...u, dialog: { type: 'group', ids: [...ui.picked] } }))
    case 'bulk-keep': {
      const ids = [...ui.picked]
      return ids.length ? finding({ type: 'keep', ids }, (u, undo) => ({ ...say(counted('Kept', ids.length) + '.', undo)(u), picked: [] })) : null
    }
    case 'bulk-work': {
      const ids = [...ui.picked]
      return ids.length ? ask('work.draft', { project, ids }, (u, draft) => ({ ...u, dialog: { type: 'work', ids, ...draft } })) : null
    }
    case 'bulk-close': return ui.picked.length ? change((u) => ({ ...u, dialog: { type: 'close', ids: [...ui.picked] } })) : null
    case 'setup': return ask('setup.start', { project }, (u, out) => say(setupWords(out.existing))(u))
    // Undo acts on the notice, not the open finding.
    case 'run-anyway': return ui.notice?.anyway ? startRun(project, ui.notice.anyway, true) : null
    case 'undo': return ui.notice?.undo ? ask('findings.undo', { project, token: ui.notice.undo }, say('Undone.')) : null
    case 'submit': return submitted(ui, ctx)
    case 'run': {
      const row = ui.personaDetail?.row
      if (!row || row.id !== d.persona) return null
      // A first run has nothing to recheck: it starts at once.
      return row.runs === 0 ? startRun(project, { persona: row.id, name: row.name })
        : change((u) => ({ ...u, dialog: { type: 'run', persona: row.id, name: row.name, recheck: row.recheck } }))
    }
    case 'edit-persona': return d.persona ? ask('persona.open', { project, persona: d.persona }) : null
    case 'stop': {
      const row = ui.personaDetail?.row
      return row && row.id === d.persona ? ask('run.stop', { project, persona: row.id }, say(`${row.name} stopped. Nothing from that run was kept.`)) : null
    }
    case 'watch': {
      const pd = ui.personaDetail
      return pd && pd.row.id === d.persona && pd.row.chat
        ? ask('run.watch', { project, persona: pd.row.id }, say(`${pd.row.name}'s run is the chat "${pd.row.chat}" in the workspace that just opened.`)) : null
    }
  }
  if (!open) return null
  switch (d.do) {
    case 'keep': return finding({ type: 'keep', ids: [open] }, (u, undo) => say('Kept.', undo)(u))
    case 'close': return change((u) => ({ ...u, dialog: { type: 'close', ids: [open] } }))
    case 'reopen': return finding({ type: 'reopen', id: open }, say('Reopened.'))
    case 'ungroup': return finding({ type: 'ungroup', id: open }, say('Ungrouped.'))
    case 'group-with': return change((u) => ({ ...u, picked: u.picked.includes(open) ? u.picked : [...u.picked, open], view: 'list',
      notice: { text: 'Tick the findings that belong with this one, then press Group.' } }))
    case 'discuss': return ask('discuss.start', { project, id: open }, (u, out) => say(out.existing
      ? `The discussion is open in your tabs as "${out.title}".` : 'Started a discussion. What you decide lands in the notes.')(u))
    case 'start': return ask('work.draft', { project, ids: [open] }, (u, draft) => (u.open === open ? { ...u, dialog: { type: 'work', ids: [open], ...draft } } : u))
    case 'issue': return ask('issue.draft', { project, id: open }, (u, draft) => (u.open === open ? { ...u, dialog: { type: 'issue', ...draft } } : u))
    case 'shot-zoom': {
      const url = ctx.shots?.[`${d.report}:${d.index}`]
      return url ? change((u) => ({ ...u, dialog: { type: 'shot', url } })) : null
    }
    case 'shot-open': {
      const index = Number(d.index)
      return d.report && Number.isInteger(index) ? ask('shot.open', { project, id: open, report: d.report, index }) : null
    }
  }
  return null
}

/** The open dialog's form, sent. */
function submitted(ui: Ui, { project, rows, form = {} }: Ctx): Act {
  const g = ui.dialog, text = (k: string) => (form[k] ?? '').trim()
  if (!g) return null
  if (g.type === 'run') {
    const focus = text('focus')
    return startRun(project, { persona: g.persona, name: g.name, ...(focus && { focus }) })
  }
  if (g.type === 'close') {
    const reason = form.reason as CloseReason
    if (!(reason in reasonWord)) return null
    const why = text('why')
    return ask('finding.act', { project, action: { type: 'close', ids: g.ids, reason, ...(why && { why }), ...(form.closeIssue === 'true' && { closeIssue: true }) } },
      (u, out) => ({ ...say(`${counted('Closed', g.ids.length)} as "${reasonWord[reason]}".`, out.undo)(u), picked: u.picked.filter((id) => !g.ids.includes(id)) }))
  }
  if (g.type === 'group') {
    const lead = form.lead ?? '', title = text('title')
    if (!g.ids.includes(lead)) return null
    const named = title || (rows.find((r) => r.id === lead)?.title ?? '')
    return ask('finding.act', { project, action: { type: 'group', ids: g.ids, lead, ...(title && { title }) } },
      (u) => ({ ...say(`Grouped into "${named}".`)(u), picked: [] }))
  }
  if (g.type === 'work') {
    const name = text('workName') || g.name, base = text('workBase') || g.base, each = g.ids.length > 1 && form.workHow === 'each', autoPr = form.autoPr === 'true'
    const done = each ? `Starting ${g.ids.length} worktrees, one per finding. Each agent's chat is in its own worktree.`
      : `Started ${name}. Its agent's chat is in the ${name} worktree.`
    return ask('work.start', { project, ids: g.ids, name, base, ...(each && { each }), ...(autoPr && { autoPr }) },
      (u) => ({ ...say(done)(u), picked: u.picked.filter((id) => !g.ids.includes(id)) }))
  }
  if (g.type === 'issue' && ui.open) {
    const title = text('issueTitle'), body = form.issueBody ?? ''
    if (!title) return change(say('An issue needs a title.'))
    const notes = form.includeNotes === 'true' && g.notes ? `\n\nNotes:\n${g.notes}` : ''
    return ask('issue.create', { project, id: ui.open, title, body: body + notes }, (u, out) => say(`Opened issue #${out.number}.`)(u))
  }
  return null
}

/** What typing (or ticking) in field `field` does. Dialog fields change nothing: the dialog's form is read when it closes. */
export function fieldOf(ui: Ui, field: string, value: string | boolean): Ui {
  if (field === 'q') return { ...ui, q: String(value) }
  if (field === 'notes') return { ...ui, notes: { text: String(value), base: ui.notes?.base ?? 0, dirty: true } }
  return ui
}

/** A `show` post: the list, persona and finding it names. Naming a finding clears the search and kind, which could hide it. */
export function applyShow(ui: Ui, show: Show, row?: PersonaRow): Ui {
  let out: Ui = { ...ui, tab: show.state ?? ui.tab, persona: show.persona === undefined ? ui.persona : show.persona }
  // Naming a persona alone shows its pane.
  if (show.persona && !show.finding) out = { ...out, opened: false, view: 'detail' }
  if (show.run && show.persona) {
    const r = row ?? (ui.personaDetail?.row.id === show.persona ? ui.personaDetail.row : undefined)
    out = { ...out, dialog: { type: 'run', persona: show.persona, name: r?.name ?? show.persona, recheck: r?.recheck ?? 0 } }
  }
  if (!show.finding) return out
  return { ...out, q: '', kind: 'all', view: 'detail', opened: true, ...(show.finding !== ui.open && { open: show.finding, notes: null, problem: '' }) }
}

/** A refusal shows; a timeout isn't one: the worker carries on, and its `changed` post brings the result. */
export function failureOf(e: unknown): { problem: string; slow: boolean } {
  if ((e as { code?: string } | null)?.code === 'timeout') return { problem: '', slow: true }
  return { problem: e instanceof Error ? e.message : String(e), slow: false }
}

/** A request that didn't work: its refusal in the notice bar, or word that it's still going. */
export function refusedOf(ui: Ui, e: unknown): Ui {
  const f = failureOf(e)
  return { ...ui, notice: { text: f.slow ? "Still working on it. The list updates when it's done." : f.problem } }
}

const filterOf = (ui: Ui) => ({ persona: ui.persona ?? undefined, kind: ui.kind === 'all' ? undefined : ui.kind, q: ui.q.trim() || undefined })

/** After new rows arrive: keep the open finding if it's still in view, else the first row; drop picks that left the list. */
export function settle(ui: Ui, rows: readonly Row[]): Ui {
  const shown = listed(rows, { state: ui.tab, ...filterOf(ui) })
  // A pick stays while its finding is in this list, even when a search hides it.
  const picked = ui.picked.filter((id) => rows.some((r) => r.id === id && r.state === ui.tab))
  // While a dialog is open the owner is acting on the open finding (the issue dialog sends for it), so it stays.
  const open = ui.dialog || shown.some((r) => r.id === ui.open) ? ui.open : shown[0]?.id ?? null
  return open === ui.open ? { ...ui, picked } : { ...ui, picked, open, notes: null, problem: '' }
}

/** The open finding as fetched: its server notes replace the field unless the owner has unsaved text there. */
export function withDetail(ui: Ui, d: Detail): Ui {
  if (ui.open !== d.finding.id || ui.notes?.dirty) return ui
  return { ...ui, notes: { text: d.notes.text, base: d.notes.mtime, dirty: false } }
}

/** The save for the open finding's unsaved notes, made against the file time they started from. */
export function saveOf(ui: Ui, project: string): Act {
  const id = ui.open, n = ui.notes
  if (!id || !n?.dirty) return null
  return ask('notes.set', { project, id, text: n.text, base: n.base }, (u, out) => (u.open !== id || !u.notes ? u
    : { ...u, notes: { text: u.notes.text, base: out.mtime, dirty: u.notes.text !== n.text }, problem: '' }))
}

/** A refused save keeps the owner's text, still unsaved, and says why beside it; for a finding no longer open, in the notice. */
export function notesRefused(ui: Ui, id: string, e: unknown): Ui {
  const { problem } = failureOf(e)
  if (ui.open !== id) return problem ? { ...ui, notice: { text: `Your notes weren't saved: ${problem}` } } : ui
  return { ...ui, notes: ui.notes && { ...ui.notes, dirty: true }, problem }
}

/** A refused finding.get. `invalid_params` means the finding is gone: it closes, and the notice says so. */
export function findingRefused(ui: Ui, id: string, e: unknown): Ui {
  if (ui.open !== id) return ui
  if ((e as { code?: string } | null)?.code !== 'invalid_params') return refusedOf(ui, e)
  return { ...ui, open: null, opened: false, notes: null, problem: '', notice: { text: failureOf(e).problem } }
}

/** The chosen persona's pane shows until a finding is opened from the list. */
export const showsPersona = (ui: Ui): boolean => !!ui.persona && !ui.opened

/** The attributes that tell one control from others doing the same thing. */
const WHICH = ['id', 'tab', 'kind', 'persona', 'report', 'index']
const quoted = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`
/** Where focus goes back to after a redraw, given the focused control's data attributes: the same control, else
 *  the first that does the same (after Keep moves on, the next finding's Keep). Selectors, most specific first. */
export function focusOf(d: Partial<Record<string, string>>): string[] {
  if (!d.do) return []
  const any = `[data-do=${quoted(d.do)}]`
  const which = WHICH.filter((k) => d[k] !== undefined).map((k) => `[data-${k}=${quoted(d[k]!)}]`).join('')
  return which ? [any + which, any] : [any]
}

/** A `changed` post names the finding it touched; one naming none may have touched any. */
export const refetchesFinding = (ui: Ui, posted: PluginPanelEvents['changed']): boolean => !!ui.open && (!posted.finding || posted.finding === ui.open)

/** The root's classes: `narrow` under 700 px, where only the pane `ui.view` names shows. */
export const rootClass = (ui: Ui, width: number): string => `app${width < 700 ? ' narrow' : ''} v-${ui.view}`

/** Whether a #rgb or #rrggbb colour is dark: its luminance is under half. */
export function isDarkColor(hex: string): boolean {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
}
