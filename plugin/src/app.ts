// The Persona Studio tab: one project's findings, in Orca's main area. Its file is the project's committed persona.studio,
// which holds the project's config; the tab's project is the focused one. src/app-glue.ts runs the page; this works out
// which project the tab belongs to, takes the shows asked of it, and gives the glue Orca's worker, storage and links.
import type { JsonValue } from 'orca'
import { mountGlue, type Env } from './app-glue'
import { failureOf, isDarkColor } from './app-logic'
import { STYLES } from './app-styles'
import { focusWords, type Show } from './protocol'

let loaded = false
/** This tab's checkout, when it loaded where it was focused; a project's tabs in its QA worktrees share its id. */
let at: string | undefined

// A custom editor has no page shell to carry the styles; the phone page's shell does (src/web-files.ts).
document.head.insertAdjacentHTML('beforeend', `<style>${STYLES}</style>`)
const glue = mountGlue({
  request: orca.plugin.request.bind(orca.plugin) as unknown as Env['request'],
  // The tab's place, kept per project in the plugin's storage.
  placeGet: async (project) => orca.storage.get(`place:${project}`),
  placeSet: async (project, place) => orca.storage.set(`place:${project}`, place as JsonValue),
  openLink: async (url) => {
    if (!orca.shell) throw new Error('Links open only in the Orca desktop app.')
    await orca.shell.openExternal(url)
  },
  phone: false,
  loaded: (here) => void takeShow(here),
})

/** What the tab.open that opened this tab asked to show: posted before this script listened, so asked for once loaded.
 *  A show also heard as a post is applied twice, which changes nothing. */
async function takeShow(here: string): Promise<void> {
  const { show } = await orca.plugin.request('show.take', { project: here, at }).catch(() => ({ show: null }))
  if (!show || here !== glue.project()) return
  glue.show(show)
}

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
  let project: string | null = null, whyNone = '', show: Show | undefined
  try {
    const f = await orca.plugin.request('focus.get')
    const own = await owners().catch(() => [] as string[])
    // In a persona's QA worktree the focus is its project already, whatever that worktree's persona.studio says.
    if (f.kind === 'project' && (f.persona || own.length === 0 || own.includes(f.id))) { project = f.id; at = f.path }
    else if (own.length > 0) project = own[0]
    else if (f.kind !== 'project') whyNone = focusWords(f)
    // A persona's QA worktree opens on that persona: its run's status.
    if (f.kind === 'project' && f.persona && project === f.id) show = { persona: f.persona }
  } catch (e) {
    const f = failureOf(e)
    // Timed out: the worker is still at it, so ask again.
    if (f.slow) return loadProject()
    whyNone = `Persona Studio can't load this project: ${f.problem}`
  }
  await glue.open(project, whyNone, show)
  loaded = true
}

/** Sit on the owner's terminal colour when its lightness suits the theme; else the stylesheet's chat-canvas mix stays. */
async function matchCanvas(): Promise<void> {
  const { canvas } = await orca.plugin.request('theme.get').catch(() => ({ canvas: null }))
  const root = document.documentElement
  if (canvas && isDarkColor(canvas) === root.classList.contains('dark')) root.style.setProperty('--ps-canvas', canvas)
  else root.style.removeProperty('--ps-canvas')
}

void loadProject()
void matchCanvas()
orca.on('theme', () => void matchCanvas())
// The tab stays on its own project. It moves only off one whose persona.studio isn't its file (it loaded while another
// workspace was focused), onto the focused one that is; or onto the focused project when it has none yet.
orca.plugin.on('focus', async (f) => {
  if (!loaded || f.kind !== 'project' || f.id === glue.project()) return
  const own = await owners().catch(() => [] as string[])
  const project = glue.project()
  if (f.id === project || (project && (own.length === 0 || own.includes(project))) || (own.length > 0 && !own.includes(f.id))) return
  at = f.path
  void glue.open(f.id)
})
orca.plugin.on('changed', (posted) => glue.changed(posted))
orca.plugin.on('landed', (l) => glue.landed(l))
orca.plugin.on('show', (s) => {
  const project = glue.project()
  if (s.project !== project || (at && s.at !== at)) return
  // Heard it: take it too, so a later reload of this tab doesn't apply it again.
  void orca.plugin.request('show.take', { project, at: s.at }).catch(() => undefined)
  glue.show(s)
})
