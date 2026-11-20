// The phone page: the Persona Studio tab in a browser on the Mac, streamed to Orca's phone app. src/app-glue.ts runs the
// page; this gives it the worker over fetch (src/web-env.ts), its posts over server-sent events, and a project picker.
// Only browser APIs here: nothing of Orca's reaches this page.
import { mountGlue } from './app-glue'
import { failureOf } from './app-logic'
import { focusWords } from './protocol'
import { pickProject, reconnects, requestOver } from './web-env'

// The tab's styles follow Orca's html.dark; here the browser's colour scheme sets it.
const dark = matchMedia('(prefers-color-scheme: dark)')
const theme = (): void => { document.documentElement.classList.toggle('dark', dark.matches) }
theme()
dark.addEventListener('change', theme)

const KEY = 'studio.project'
const kept = (): string | null => { try { return localStorage.getItem(KEY) } catch { return null } }
const keep = (id: string): void => { try { localStorage.setItem(KEY, id) } catch { /* not kept: the next visit opens the first */ } }

const request = requestOver(fetch)
let projects: { id: string; name: string }[] = []

const glue = mountGlue({
  request,
  // The same place the desktop tab keeps, through the worker.
  placeGet: async (project) => (await request('place.get', { project })).place,
  placeSet: async (project, place) => { await request('place.set', { project, place }) },
  // Called before any await, so the browser counts it as the click's.
  openLink: async (url) => { window.open(url, '_blank', 'noopener') },
  phone: true,
  projects: () => projects,
})

/** Ask for the projects, and open the kept one (or the first) when the one showing isn't listed; with `redraw`, the
 *  one showing is drawn again when it stays, so new names show. */
async function loadProjects(redraw = false): Promise<void> {
  try {
    projects = (await request('projects.list', undefined)).projects
  } catch (e) {
    const f = failureOf(e)
    // Timed out: the worker is still at it, so ask again.
    if (f.slow) return loadProjects(redraw)
    // With a project showing, it stays; the next reconnect asks again.
    if (!glue.project()) await glue.open(null, `Persona Studio can't load this project: ${f.problem}`)
    return
  }
  const pick = pickProject(glue.project() ?? kept(), projects)
  if (!pick) return glue.open(null, focusWords({ kind: 'none' }))
  if (pick !== glue.project()) return glue.open(pick)
  if (redraw) glue.refresh()
}

document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-do="projects"], [data-do="project"]')
  // The project list opens itself (popovertarget); asking again catches a project added since.
  if (el?.dataset.do === 'projects') return void loadProjects(true)
  const id = el?.dataset.id
  if (!id || id === glue.project()) return
  keep(id)
  void glue.open(id)
})

const events = new EventSource('/api/events')
// Back after losing the stream: what changed meanwhile wasn't heard, so fetch it all again.
const stream = reconnects(() => { glue.refresh(); void loadProjects() })
events.addEventListener('error', stream.error)
events.addEventListener('open', stream.open)
events.addEventListener('changed', (e) => glue.changed(JSON.parse((e as MessageEvent<string>).data)))
events.addEventListener('landed', (e) => glue.landed(JSON.parse((e as MessageEvent<string>).data)))
// `show` and `focus` posts are the desktop tab's.

void loadProjects()
