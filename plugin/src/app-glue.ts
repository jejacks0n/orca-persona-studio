// The glue between the page and the Persona Studio tab's drawing (src/app-view.ts) and controls (src/app-logic.ts):
// drawing, the kept place, fetching, running actions, notes and the dialog. It reaches the worker, the kept place and
// links only through its Env, so it runs in Orca's tab (src/app.ts) and in a plain browser alike.
import type { PluginPanelEvents, PluginRequestInput, PluginRequestOutput, PluginRequests } from 'orca'
import { actionOf, applyShow, failureOf, fieldOf, findingRefused, focusOf, notesRefused, refetchesFinding, refusedOf, rootClass, saveOf, settle, showsPersona, withDetail, type Act } from './app-logic'
import { detailPane, dialog, freshUi, header, listPane, message, noticeBar, personaPane, zeroPane, type Ui } from './app-view'
import type { Row } from './findings-view'
import type { Detail, Overview, Show } from './protocol'

export interface Env {
  request<K extends keyof PluginRequests>(name: K, input: PluginRequestInput<K>): Promise<PluginRequestOutput<K>>
  placeGet(project: string): Promise<unknown>
  placeSet(project: string, place: Record<string, unknown>): Promise<void>
  openLink(url: string): Promise<void>
  phone: boolean
  /** The projects the phone's picker lists; the desktop tab has none. */
  projects?(): { id: string; name: string }[]
  /** The first overview after opening a project has arrived. */
  loaded?(project: string): void
}

export interface Glue {
  /** Show `project` at its kept place; or no project, saying `why`. `show` applies once the place is loaded. */
  open(project: string | null, why?: string, show?: Show): Promise<void>
  project(): string | null
  show(s: Show): void
  changed(p: PluginPanelEvents['changed']): void
  landed(l: PluginPanelEvents['landed']): void
  refresh(): void
}

export function mountGlue(env: Env): Glue {
  // The body is the root. The one dialog sits in it, outside what each redraw replaces, so it survives them.
  const body = document.body
  body.innerHTML = '<dialog id="dlg"></dialog>'
  const dlg = body.querySelector('dialog')!

  let project: string | null = null, loaded = false
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

  const send = env.request as unknown as (name: string, input: unknown) => Promise<unknown>

  function page(): string {
    if (!loaded) return message('Loading…')
    if (!project) return message(whyNone)
    if (!overview) return message(loadProblem ? `Persona Studio can't load this project: ${loadProblem}` : 'Loading…')
    const picker = env.phone && env.projects ? { project, projects: env.projects() } : undefined
    // A project with no personas and no findings yet: what Persona Studio does, and Set up personas. The phone keeps its
    // header above it, so another project can still be picked.
    if (overview.personas.length === 0 && overview.configError === null && Object.values(overview.counts).every((n) => n === 0))
      return (picker ? header(overview, ui, picker) : '') + zeroPane() + noticeBar(ui)
    const d = detail?.finding.id === ui.open ? detail : null
    const side = showsPersona(ui) ? personaPane(ui.personaDetail?.row.id === ui.persona ? ui.personaDetail : null, rows) : detailPane(d, overview, ui, shots, env.phone)
    return header(overview, ui, picker) + listPane(rows, overview, ui) + side + noticeBar(ui)
  }

  /** The tab's place, kept per project: Orca reloads a tab you move away from, which loses memory. */
  const PLACE = ['tab', 'persona', 'kind', 'q', 'open', 'view', 'opened'] as const
  let placed = ''
  function keepPlace(): void {
    if (!project || !overview) return
    const place = Object.fromEntries(PLACE.map((k) => [k, ui[k]]))
    const json = JSON.stringify(place)
    if (json === placed) return
    placed = json
    void env.placeSet(project, place).catch(() => undefined)
  }
  /** The project's kept place over a fresh one; settle() drops a finding or persona that's gone since. */
  async function placeOf(here: string): Promise<Ui> {
    const kept = await env.placeGet(here).catch(() => null)
    placed = JSON.stringify(kept)
    if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return freshUi()
    return { ...freshUi(), ...Object.fromEntries(PLACE.filter((k) => k in kept).map((k) => [k, (kept as Record<string, unknown>)[k]])) } as Ui
  }

  const SCROLLERS = ['.list .scroll', '.detail .scroll', '#ps-notes']
  const POPS = ['#personas', '#projects']
  let drawnFinding: string | null = null
  /** Draw the page anew, keeping the focus, the caret and where each pane was scrolled. */
  function draw(): void {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const field = el && !dlg.contains(el) ? el.dataset?.field : undefined, from = el?.selectionStart, to = el?.selectionEnd
    if (el && el !== body && !dlg.contains(el)) wanted = field ? [] : focusOf({ ...el.dataset })
    const same = drawnFinding === ui.open
    const scrolled = SCROLLERS.map((s) => body.querySelector(s)?.scrollTop ?? 0)
    // The page is drawn anew, so an open Personas or project list would close under the owner (a running persona redraws often).
    const pops = POPS.filter((s) => body.querySelector(s)?.matches(':popover-open'))
    for (const n of Array.from(body.childNodes)) if (n !== dlg) n.remove()
    dlg.insertAdjacentHTML('beforebegin', page())
    for (const s of pops) body.querySelector<HTMLElement>(s)?.showPopover()
    body.className = rootClass(ui, innerWidth, env.phone)
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
    // The phone's sheets sit at the top of the page.
    if (env.phone) scrollTo(0, 0)
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
      const [o, l] = await Promise.all([env.request('overview.get', { project: here }), env.request('findings.list', { project: here })])
      if (mine !== listSeq || here !== project) return
      const first = !overview
      overview = o; rows = l.rows; loadProblem = ''
      const w = wantFinding
      wantFinding = false
      update(ui, w)
      if (showsPersona(ui)) void loadPerson()
      if (first) env.loaded?.(here)
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

  /** The chosen persona's pane data. A newer fetch, or a pane no longer showing, drops the answer. */
  async function loadPerson(): Promise<void> {
    const here = project!, id = ui.persona!, mine = ++personSeq
    try {
      const d = await env.request('persona.get', { project: here, persona: id })
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
      const d = await env.request('finding.get', { project: here, id })
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
          env.request('shot.get', { project: here, id, report: r.id, index }).then((s) => mark(s.url), () => mark(null))
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
      // Called before any await, so a browser still counts it as the click's.
      await env.openLink(a.link).catch((e: unknown) => update(refusedOf(ui, e)))
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
    // Opening a list on the phone shows its sheet, at the top of the page. (The click comes before the popover toggles.)
    const opener = (e.target as Element | null)?.closest('[popovertarget]')
    if (env.phone && opener && !document.getElementById(opener.getAttribute('popovertarget')!)?.matches(':popover-open')) scrollTo(0, 0)
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-do]')
    if (!el || !project) return
    if (el.tagName === 'A') e.preventDefault()
    // Picking from the Personas or project list closes it.
    el.closest<HTMLElement>(POPS.join(','))?.hidePopover()
    // Cancel and Done only close the dialog; its close event says what that does.
    if (el.dataset.do === 'cancel') return dlg.close()
    flushNotes()
    void run(actionOf({ ...el.dataset }, ui, { project, rows, shots, phone: env.phone }))
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
    const a = actionOf({ do: dlg.returnValue === 'ok' ? 'submit' : 'cancel' }, ui, { project, rows, form, shots, phone: env.phone })
    dlg.returnValue = ''
    shown = null
    ui = { ...ui, dialog: null }
    draw()
    void run(a)
  })
  addEventListener('resize', () => { body.className = rootClass(ui, innerWidth, env.phone) })
  addEventListener('pagehide', flushNotes)
  document.addEventListener('pointerdown', () => { wanted = [] })

  draw()
  return {
    async open(p, why, show) {
      flushNotes()
      shown = null
      if (dlg.open) dlg.close()
      project = p; whyNone = why ?? ''
      overview = null; rows = []; detail = null; loadProblem = ''; shots = {}; asked = new Set()
      ui = p ? await placeOf(p) : freshUi()
      // A newer open wins over this one, still loading its place.
      if (project !== p) return
      if (show) ui = applyShow(ui, show)
      loaded = true
      draw()
      void refresh(true)
    },
    project: () => project,
    show(s) {
      flushNotes()
      // A show is a fresh place to look: a dialog left open would act on what it replaced.
      // Forgotten first, so its close event doesn't send or wipe what the show opens; and dropped, so the next draw doesn't reopen it.
      shown = null
      if (dlg.open) dlg.close()
      ui = applyShow({ ...ui, dialog: null }, s, overview?.personas.find((p) => p.id === s.persona))
      void refresh(true)
    },
    changed(p) { if (p.project === project) void refresh(refetchesFinding(ui, p)) },
    // A run that landed: its words stay until dismissed.
    landed(l) { if (l.project === project) update({ ...ui, notice: { text: l.text } }) },
    refresh() { void refresh(true) },
  }
}
