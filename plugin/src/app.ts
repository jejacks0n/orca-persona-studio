// The Persona Studio tab: one project's findings, in Orca's main area. Its file is the project's committed persona.studio,
// which holds the project's config; the tab's project is the focused one. src/app-view.ts draws the page and src/app-logic.ts says what each control does;
// this is only the glue between them and the page.
import { actionOf, applyShow, failureOf, isDarkColor, fieldOf, findingRefused, focusOf, notesRefused, refetchesFinding, refusedOf, rootClass, saveOf, settle, showsPersona, withDetail, type Act } from './app-logic'
import { STYLES } from './app-styles'
import { detailPane, dialog, freshUi, header, listPane, message, noticeBar, personaPane, zeroPane, type Ui } from './app-view'
import type { Row } from './findings-view'
import { focusWords, type Detail, type Overview } from './protocol'

document.head.insertAdjacentHTML('beforeend', `<style>${STYLES}</style>`)
// The body is the root. The one dialog sits in it, outside what each redraw replaces, so it survives them.
const body = document.body
body.innerHTML = '<dialog id="dlg"></dialog>'
const dlg = body.querySelector('dialog')!

let project: string | null = null, loaded = false
/** This tab's checkout, when it loaded where it was focused; a project's tabs in its QA worktrees share its id. */
let at: string | undefined
/** Why there's no project to show, once loaded without one. */
let whyNone = ''
let ui: Ui = freshUi()
let overview: Overview | null = null, rows: Row[] = [], detail: Detail | null = null, loadProblem = ''
/** The open finding's screenshots by `<report id>:<index>`, filled as they arrive. */
let shots: Record<string, string | null> = {}, asked = new Set<string>()
let listSeq = 0, findingSeq = 0, personSeq = 0, wantFinding = false
/** The dialog now filled into `dlg`; it's filled again only when `ui.dialog` becomes another one. */
let shown: Ui['dialog'] = null
/** Where keyboard focus goes back to after a redraw. Kept while no control holds focus (a redraw can drop the
 *  focused control and draw it again later, as the detail does while the next finding loads); a pointer press clears it. */
let wanted: string[] = []

const send = orca.plugin.request.bind(orca.plugin) as unknown as (name: string, input: unknown) => Promise<unknown>

function page(): string {
  if (!loaded) return message('Loading…')
  if (!project) return message(whyNone)
  if (!overview) return message(loadProblem ? `Persona Studio can't load this project: ${loadProblem}` : 'Loading…')
  if (overview.personas.length === 0 && overview.configError === null && Object.values(overview.counts).every((n) => n === 0)) return zeroPane() + noticeBar(ui)
  const d = detail?.finding.id === ui.open ? detail : null
  const side = showsPersona(ui) ? personaPane(ui.personaDetail?.row.id === ui.persona ? ui.personaDetail : null, rows) : detailPane(d, overview, ui, shots)
  return header(overview, ui) + listPane(rows, overview, ui) + side + noticeBar(ui)
}

/** The tab's place, kept per project in the plugin's storage: Orca reloads a tab you move away from, which loses memory. */
const PLACE = ['tab', 'persona', 'kind', 'q', 'open', 'view', 'opened'] as const
let placed = ''
function keepPlace(): void {
  if (!project || !overview) return
  const place = Object.fromEntries(PLACE.map((k) => [k, ui[k]]))
  const json = JSON.stringify(place)
  if (json === placed) return
  placed = json
  void orca.storage.set(`place:${project}`, place).catch(() => undefined)
}
/** The project's kept place over a fresh one; settle() drops a finding or persona that's gone since. */
async function placeOf(here: string): Promise<Ui> {
  const kept = await orca.storage.get(`place:${here}`).catch(() => null)
  placed = JSON.stringify(kept)
  if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return freshUi()
  return { ...freshUi(), ...Object.fromEntries(PLACE.filter((k) => k in kept).map((k) => [k, kept[k]])) } as Ui
}

const SCROLLERS = ['.list .scroll', '.detail .scroll', '#ps-notes']
let drawnFinding: string | null = null
/** Draw the page anew, keeping the focus, the caret and where each pane was scrolled. */
function draw(): void {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  const field = el && !dlg.contains(el) ? el.dataset?.field : undefined, from = el?.selectionStart, to = el?.selectionEnd
  if (el && el !== body && !dlg.contains(el)) wanted = field ? [] : focusOf({ ...el.dataset })
  const same = drawnFinding === ui.open
  const scrolled = SCROLLERS.map((s) => body.querySelector(s)?.scrollTop ?? 0)
  // The page is drawn anew, so an open Personas list would close under the owner (a running persona redraws often).
  const popOpen = body.querySelector('#personas')?.matches(':popover-open') ?? false
  for (const n of Array.from(body.childNodes)) if (n !== dlg) n.remove()
  dlg.insertAdjacentHTML('beforebegin', page())
  if (popOpen) body.querySelector<HTMLElement>('#personas')?.showPopover()
  body.className = rootClass(ui, innerWidth)
  drawnFinding = ui.open
  // Another finding opens at its top.
  SCROLLERS.forEach((s, i) => { const x = body.querySelector(s); if (x && (i === 0 || same)) x.scrollTop = scrolled[i] })
  const next = field ? body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${CSS.escape(field)}"]`) : null
  if (next && (field !== 'notes' || same)) {
    next.focus({ preventScroll: true })
    if (typeof from === 'number') next.setSelectionRange(from, to ?? from)
  } else if (!field) {
    for (const s of wanted) {
      const x = body.querySelector<HTMLElement>(s)
      if (x) { x.focus({ preventScroll: true }); break }
    }
  }
  syncDialog()
  keepPlace()
}

function syncDialog(): void {
  if (ui.dialog === shown) return
  shown = ui.dialog
  if (!shown) { if (dlg.open) dlg.close(); return }
  const t = document.createElement('template')
  t.innerHTML = dialog(ui, rows)
  const src = t.content.querySelector('dialog')!
  for (const a of Array.from(dlg.attributes)) if (a.name !== 'id' && a.name !== 'open') dlg.removeAttribute(a.name)
  for (const a of Array.from(src.attributes)) dlg.setAttribute(a.name, a.value)
  dlg.replaceChildren(...Array.from(src.childNodes))
  if (!dlg.open) dlg.showModal()
}

/** Make `next` the tab's state: settled against the rows, the open finding fetched when it changed, then drawn. */
function update(next: Ui, fetchFinding = false): void {
  if (overview) next = settle(next, rows)
  const moved = next.open !== ui.open
  // The notes being typed belong to the finding being left.
  if (moved) flushNotes()
  const person = showsPersona(next) && (!showsPersona(ui) || next.persona !== ui.persona)
  ui = next
  if (ui.open && (moved || fetchFinding)) void loadFinding(ui.open)
  if (person) void loadPerson()
  draw()
}

/** Fetch the overview and rows. A newer fetch wins over an older one still in flight, and inherits its finding refetch. */
async function refresh(withFinding: boolean): Promise<void> {
  const here = project, mine = ++listSeq
  wantFinding ||= withFinding
  if (!here) return draw()
  try {
    const [o, l] = await Promise.all([orca.plugin.request('overview.get', { project: here }), orca.plugin.request('findings.list', { project: here })])
    if (mine !== listSeq || here !== project) return
    const first = !overview
    overview = o; rows = l.rows; loadProblem = ''
    const w = wantFinding
    wantFinding = false
    update(ui, w)
    if (showsPersona(ui)) void loadPerson()
    if (first) void takeShow(here)
  } catch (e) {
    if (mine !== listSeq || here !== project) return
    const f = failureOf(e)
    if (overview) return update(refusedOf(ui, e))
    loadProblem = f.problem
    draw()
    // Timed out: the worker is still at it, so ask again.
    if (f.slow) void refresh(true)
  }
}

/** What the tab.open that opened this tab asked to show: posted before this script listened, so asked for once loaded.
 *  A show also heard as a post is applied twice, which changes nothing. */
async function takeShow(here: string): Promise<void> {
  const { show } = await orca.plugin.request('show.take', { project: here, at }).catch(() => ({ show: null }))
  if (!show || here !== project) return
  flushNotes()
  ui = applyShow(ui, show, overview?.personas.find((p) => p.id === show.persona))
  void refresh(true)
}

/** The chosen persona's pane data. A newer fetch, or a pane no longer showing, drops the answer. */
async function loadPerson(): Promise<void> {
  const here = project!, id = ui.persona!, mine = ++personSeq
  try {
    const d = await orca.plugin.request('persona.get', { project: here, persona: id })
    if (mine !== personSeq || here !== project || !showsPersona(ui) || ui.persona !== id) return
    ui = { ...ui, personaDetail: d }
    draw()
  } catch (e) {
    if (mine === personSeq && here === project && showsPersona(ui) && ui.persona === id) update(refusedOf(ui, e))
  }
}

async function loadFinding(id: string): Promise<void> {
  const here = project!, mine = ++findingSeq
  try {
    const d = await orca.plugin.request('finding.get', { project: here, id })
    if (mine !== findingSeq || here !== project || ui.open !== id) return
    if (detail?.finding.id !== id) { shots = {}; asked = new Set() }
    detail = d
    ui = withDetail(ui, d)
    draw()
    for (const r of d.finding.reports) {
      r.shots.forEach((_, index) => {
        const key = `${r.id}:${index}`, mark = (url: string | null) => { if (detail?.finding.id === id) { shots[key] = url; draw() } }
        if (asked.has(key)) return
        asked.add(key)
        orca.plugin.request('shot.get', { project: here, id, report: r.id, index }).then((s) => mark(s.url), () => mark(null))
      })
    }
  } catch (e) {
    if (mine !== findingSeq || here !== project || ui.open !== id) return
    ui = findingRefused(ui, id, e)
    if (ui.open) return draw()
    // Gone: drop what was shown of it, and fetch the list without it.
    detail = null
    draw()
    void refresh(false)
  }
}

/** Run a control's effect. A refusal shows in the notice; `then` runs only once the request worked. */
async function run(a: Act): Promise<void> {
  if (!a) return
  if ('ui' in a) return update(a.ui(ui))
  if ('link' in a) {
    if (!orca.shell) return update({ ...ui, notice: { text: 'Links open only in the Orca desktop app.' } })
    await orca.shell.openExternal(a.link).catch((e: unknown) => update(refusedOf(ui, e)))
    return
  }
  try {
    const out = await send(a.request.name, a.request.input)
    if (a.then) update(a.then(ui, out))
  } catch (e) {
    update(refusedOf(ui, e))
  }
}

// Notes save 800 ms after the last keystroke, one save at a time. Each starts from the newest file time known
// for its finding: the one it was typed against, or the previous save's, whichever is later.
let saveTimer: ReturnType<typeof setTimeout> | undefined, saving = Promise.resolve()
/** By project and finding. */
const savedAt = new Map<string, number>()
function flushNotes(): void {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  const from = ui, here = project
  if (here) saving = saving.then(() => save(from, here))
}
async function save(from: Ui, here: string): Promise<void> {
  const id = from.open, n = from.notes
  if (!id || !n) return
  const a = saveOf({ ...from, notes: { ...n, base: Math.max(n.base, savedAt.get(`${here}/${id}`) ?? 0) } }, here)
  if (!a || !('request' in a)) return
  try {
    const out = await send(a.request.name, a.request.input)
    savedAt.set(`${here}/${id}`, (out as { mtime: number }).mtime)
    if (here === project) ui = a.then!(ui, out)
  } catch (e) {
    if (here === project) ui = notesRefused(ui, id, e)
  }
  draw()
}

document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-do]')
  if (!el || !project) return
  if (el.tagName === 'A') e.preventDefault()
  // Picking from the Personas list closes it.
  el.closest<HTMLElement>('#personas')?.hidePopover()
  // Cancel and Done only close the dialog; its close event says what that does.
  if (el.dataset.do === 'cancel') return dlg.close()
  flushNotes()
  const mod = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : undefined
  void run(actionOf({ ...el.dataset, ...(mod && { mod }) }, ui, { project, rows, shots }))
})
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement, field = el.dataset?.field
  // The dialog's fields are read when it closes.
  if (!field || dlg.contains(el)) return
  const next = fieldOf(ui, field, el.value)
  if (field === 'notes') {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flushNotes, 800)
    // The field already shows the text: redraw only to show it's unsaved.
    if (ui.notes?.dirty) { ui = next; return }
  }
  // Mid-composition (an IME), a redraw would lose what's being composed.
  if ((e as InputEvent).isComposing) { ui = next; return }
  update(next)
})
dlg.addEventListener('close', () => {
  if (!shown || !project) return
  const form: Record<string, string> = {}
  for (const el of Array.from(dlg.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]'))) {
    const k = el.dataset.field!
    if (el.type === 'radio') { if ((el as HTMLInputElement).checked) form[k] = el.value } else form[k] = el.type === 'checkbox' ? String((el as HTMLInputElement).checked) : el.value
  }
  // The dialog's own button (value "ok") sends it; Cancel, Escape or a click outside close it unsent.
  const a = actionOf({ do: dlg.returnValue === 'ok' ? 'submit' : 'cancel' }, ui, { project, rows, form, shots })
  dlg.returnValue = ''
  shown = null
  ui = { ...ui, dialog: null }
  draw()
  void run(a)
})
addEventListener('resize', () => { body.className = rootClass(ui, innerWidth) })
addEventListener('pagehide', flushNotes)
document.addEventListener('pointerdown', () => { wanted = [] })

/** The projects whose persona.studio is this tab's file. Orca doesn't tell an editor its workspace, so the file says. */
async function owners(): Promise<string[]> {
  const d = await orca.document?.get()
  if (d?.content.kind !== 'text') return []
  return (await orca.plugin.request('tab.projects', { text: d.content.text })).projects
}

/** The tab's project: the one whose persona.studio it shows. Usually the focused one; but a tab can load while another
 *  workspace is focused (Orca restoring tabs, or switching projects), and then its file picks.
 *  ponytail: two projects with the same persona.studio (two `{}`) can't be told apart; the focused one wins. */
async function loadProject(): Promise<void> {
  try {
    const f = await orca.plugin.request('focus.get')
    const own = await owners().catch(() => [] as string[])
    // In a persona's QA worktree the focus is its project already, whatever that worktree's persona.studio says.
    if (f.kind === 'project' && (f.persona || own.length === 0 || own.includes(f.id))) { project = f.id; at = f.path }
    else if (own.length > 0) project = own[0]
    else if (f.kind !== 'project') whyNone = focusWords(f)
    if (project) ui = await placeOf(project)
    // A persona's QA worktree opens on that persona: its run's status.
    if (f.kind === 'project' && f.persona && project === f.id) ui = applyShow(ui, { persona: f.persona })
  } catch (e) {
    const f = failureOf(e)
    // Timed out: the worker is still at it, so ask again.
    if (f.slow) return loadProject()
    whyNone = `Persona Studio can't load this project: ${f.problem}`
  }
  loaded = true
  draw()
  void refresh(true)
}

/** Sit on the owner's terminal colour when its lightness suits the theme; else the stylesheet's chat-canvas mix stays. */
async function matchCanvas(): Promise<void> {
  const { canvas } = await orca.plugin.request('theme.get').catch(() => ({ canvas: null }))
  const root = document.documentElement
  if (canvas && isDarkColor(canvas) === root.classList.contains('dark')) root.style.setProperty('--ps-canvas', canvas)
  else root.style.removeProperty('--ps-canvas')
}

draw()
void loadProject()
void matchCanvas()
orca.on('theme', () => void matchCanvas())
// The tab stays on its own project. It moves only off one whose persona.studio isn't its file (it loaded while another
// workspace was focused), onto the focused one that is; or onto the focused project when it has none yet.
orca.plugin.on('focus', async (f) => {
  if (!loaded || f.kind !== 'project' || f.id === project) return
  const own = await owners().catch(() => [] as string[])
  if (f.id === project || (project && (own.length === 0 || own.includes(project))) || (own.length > 0 && !own.includes(f.id))) return
  flushNotes()
  shown = null
  if (dlg.open) dlg.close()
  project = f.id; at = f.path; whyNone = ''
  overview = null; rows = []; detail = null; loadProblem = ''; shots = {}; asked = new Set()
  ui = await placeOf(f.id)
  if (project !== f.id) return
  draw()
  void refresh(true)
})
orca.plugin.on('changed', (posted) => { if (posted.project === project) void refresh(refetchesFinding(ui, posted)) })
// A run that landed: its words stay until dismissed.
orca.plugin.on('landed', (l) => { if (l.project === project) update({ ...ui, notice: { text: l.text } }) })
orca.plugin.on('show', (s) => {
  if (s.project !== project || (at && s.at !== at)) return
  // Heard it: take it too, so a later reload of this tab doesn't apply it again.
  void orca.plugin.request('show.take', { project, at: s.at }).catch(() => undefined)
  flushNotes()
  // A show is a fresh place to look: a dialog left open would act on what it replaced.
  // Forgotten first, so its close event doesn't send or wipe what the show opens.
  shown = null
  if (dlg.open) dlg.close()
  ui = applyShow(ui, s, overview?.personas.find((p) => p.id === s.persona))
  void refresh(true)
})
