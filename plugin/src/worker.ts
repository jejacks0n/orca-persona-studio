// The plugin's own worker. Orca starts it on the panel's first plugin.request and transpiles
// this file when it loads: no build step. A save restarts it and drops its in-memory state, so
// anything that must last lives in orca.storage.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type { PluginPanelEvents } from 'orca'
import type { OrcaWorkerApi } from 'orca/worker'
import { CONFIG_FILE, listPersonas, parseConfig, portraitOf, promptOf, readConfig } from './config'
import { isMet, series } from './goals'
import { act } from './finding'
import { findingDir, mergeNotes, notesChangedSince, readNotes, writeBrief, writeNotes } from './finding-files'
import { DISCUSS_PROMPT, PR_WHEN, SETUP_PROMPT, WORK_PROMPT, fill, workList } from './prompts'
import { counts, toRow } from './findings-view'
import { makeFocus, worktreeOf, type Focused } from './focus'
import { CANDIDATES, findTool, repoOf } from './local'
import { STATES, emptyFindings, stateWord, type Finding, type ProjectFindings, type Work } from './model'
import { focusWords, say, type Focus, type PersonaRow, type Show } from './protocol'
import { stageWord } from './run'
import { freePort } from './serve'
import { canRun, findWorkspace, invalid, makeRuns, recheckOf } from './runs'
import { parseSheet } from './sheet'
import { loadFindings, loadProjects, loadRecord, saveFindings, saveProjects } from './store'
import { progressLines, promptFile } from './tasks'
import { NO_GH, makeTools, nodeRunner, type Runner, type Tools } from './tools'
import type { Project } from './types'
import { NAME, slugOf, watchWork, type Seen } from './work'

let runner: Runner = nodeRunner
/** Tests swap in a fake so no real orca, gh or git runs. */
export function setRunner(r: Runner): void { runner = r }
let exists: (path: string) => boolean = existsSync
/** Tests swap in a fake so tool lookup doesn't depend on what is installed. */
export function setExists(fn: (path: string) => boolean): void { exists = fn }
let now = () => Date.now()
/** Tests move time for the runs. */
export function setNow(fn: () => number): void { now = fn }
let timer: ReturnType<typeof setInterval> | undefined
/** Where each project's finding files (briefs, notes) live: outside its checkout, so a project only ever gets persona.studio.
 *  ponytail: a fixed folder in the home directory; Orca giving plugins a files folder would be the upgrade. */
let filesRoot = join(homedir(), '.persona-studio')
/** Tests point it at a temp folder. */
export function setFilesRoot(dir: string): void { filesRoot = dir }
const filesOf = (p: { id: string }) => join(filesRoot, p.id)

const ok = { ok: true } as const

export default function activate(orca: OrcaWorkerApi): void {
  const { host, storage } = orca
  // Orca refuses an answer holding `undefined` (an optional field left unset, say), so every answer goes out as plain JSON.
  const plain = (x: unknown) => (x === undefined ? x : JSON.parse(JSON.stringify(x)))
  const handle = ((name: string, fn: (input: never, context: never) => unknown) =>
    orca.panels.handle(name, async (input, context) => plain(await fn(input as never, context as never)))) as typeof orca.panels.handle
  // Every change (requests, ticks, focus) runs one at a time, so two never interleave on a project's findings.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn)
    chain = next.catch(() => {})
    return next
  }

  /** The agent that runs each role, from the settings. */
  const agentOf = async () => String((await orca.settings.get()).agent || 'claude')

  async function env() {
    const s = await orca.settings.get()
    const find = (name: 'orca' | 'gh' | 'git', override: unknown) => findTool(String(override ?? ''), CANDIDATES[name], exists)
    const orcaPath = find('orca', s.orcaPath), gitPath = find('git', s.gitPath)
    if (!orcaPath) throw new Error("Persona Studio can't find the orca command. Set its path in Persona Studio's settings.")
    if (!gitPath) throw new Error("Persona Studio can't find the git command. Set its path in Persona Studio's settings.")
    return { tools: makeTools(runner, { orca: orcaPath, gh: find('gh', s.ghPath), git: gitPath }) }
  }

  function post<K extends keyof PluginPanelEvents>(event: K, payload: PluginPanelEvents[K]) {
    try { orca.panels.post(event, payload) } catch (err) { orca.log(`studio: telling the panels: ${say(err)}`) }
  }

  async function projectOf(id: string): Promise<Project> {
    const p = (await loadProjects(storage)).find((x) => x.id === id)
    if (!p) throw invalid(`Persona Studio has no project "${id}".`)
    return p
  }
  const sheetsOf = (p: Project) => listPersonas(p.path, readConfig(p.path))
  /** Persona names by id. A broken persona.studio costs only the names, so triage still works. */
  function namesOf(p: Project): Record<string, string> {
    try {
      return Object.fromEntries(sheetsOf(p).map((s) => [s.id, s.name]))
    } catch (err) {
      orca.log(`studio: reading ${p.id}'s personas: ${say(err)}`)
      return {}
    }
  }

  /** The project's findings, stored empty the first time. Run it serially. */
  async function findingsOf(p: Project): Promise<ProjectFindings> {
    const pf = await loadFindings(storage, p.id)
    if (pf) return pf
    const empty = emptyFindings(p.id)
    await saveFindings(storage, empty)
    return empty
  }

  /** Save a changed record and rewrite the brief of every finding the change touched. */
  async function save(p: Project, before: ProjectFindings, after: ProjectFindings) {
    await saveFindings(storage, after)
    const was = new Map(before.findings.map((f) => [f.id, JSON.stringify(f)]))
    const names = namesOf(p)
    for (const f of after.findings) if (was.get(f.id) !== JSON.stringify(f)) writeBrief(filesOf(p), f, names)
  }

  /** The latest keep or close: its token, and the record before and (as JSON) after it. Only this one can be undone. */
  let undo: { token: string; project: string; before: ProjectFindings; after: string } | null = null
  let tokens = 0

  const findingIn = (pf: ProjectFindings, id: string): Finding => {
    const f = pf.findings.find((x) => x.id === id)
    if (!f) throw invalid('That finding is no longer on the list.')
    return f
  }
  /** The repo issues go to: the config's, else origin's. */
  async function repoFor(p: Project, tools: Awaited<ReturnType<typeof env>>['tools']): Promise<string> {
    const repo = readConfig(p.path).repo ?? await repoOf(tools, p.path)
    if (!repo) throw new Error('This project has no GitHub remote.')
    return repo
  }

  handle('finding.act', ({ project, action }) => serial(async () => {
    const p = await projectOf(project), before = await findingsOf(p)
    let after = act(before, action, Date.now())
    // Check what the issue close needs before anything changes.
    const toClose = action.type === 'close' && action.closeIssue
      ? before.findings.filter((f) => action.ids.includes(f.id) && f.issue) : []
    const gh = toClose.length ? { tools: (await env()).tools, repo: undefined as string | undefined } : null
    if (gh && !gh.tools.hasGh) throw new Error(NO_GH)
    // The finding is closed whatever happens to its issue: a failed close is told in its history, not by refusing.
    if (gh) {
      const closed = structuredClone(after)
      for (const f of toClose) {
        try {
          gh.repo ??= await repoFor(p, gh.tools)
          await gh.tools.closeIssue(gh.repo, f.issue!.number)
        } catch (err) {
          closed.findings.find((x) => x.id === f.id)!.history.push({ at: Date.now(), text: `Couldn't close issue #${f.issue!.number}: ${say(err)}` })
        }
      }
      after = closed
    }
    await save(p, before, after)
    if (action.type === 'group') mergeNotes(filesOf(p), action.lead, before.findings.filter((f) => f.id !== action.lead && action.ids.includes(f.id)))
    // Time in the token too, so a token from before a restart never matches one made after. `after` is read
    // back from storage, as undo's own read will be, so how storage orders keys can't make them differ.
    undo = action.type === 'keep' || action.type === 'close'
      ? { token: `${Date.now().toString(36)}-${++tokens}`, project, before, after: JSON.stringify(await loadFindings(storage, p.id)) } : null
    post('changed', { project })
    return { undo: undo?.token ?? null }
  }))

  handle('findings.undo', ({ project, token }) => serial(async () => {
    const p = await projectOf(project), now = await loadFindings(storage, p.id)
    if (!undo || undo.token !== token || undo.project !== project || JSON.stringify(now) !== undo.after) throw new Error('Too late to undo that.')
    const { before } = undo
    undo = null
    await save(p, now!, before)
    post('changed', { project })
    return ok
  }))

  handle('findings.list', ({ project }) => serial(async () =>
    ({ rows: (await findingsOf(await projectOf(project))).findings.map(toRow) })))

  // Opening a finding is seeing it, so it clears its fresh mark.
  handle('finding.get', ({ project, id }) => serial(async () => {
    const p = await projectOf(project), before = await findingsOf(p)
    // Gone since the tab listed it: refused as bad input, so the tab knows to let it go.
    const was = findingIn(before, id)
    const after = act(before, { type: 'seen', id }, Date.now())
    if (was.fresh) {
      await save(p, before, after)
      post('changed', { project, finding: id })
    }
    const names = namesOf(p)
    const { reports, members, ...rest } = after.findings.find((x) => x.id === id)!
    return { finding: { ...rest, reports: reports.map((r) => ({ ...r, personaName: names[r.persona] ?? r.persona })),
      members: (members ?? []).map((m) => ({ id: m.id, title: m.title, personas: [...new Set(m.reports.map((r) => r.persona))] })) },
    notes: readNotes(filesOf(p), id) }
  }))

  /** By project and finding: each notes file's time as the owner last saved it, so the tick never reports that save back. */
  const ownSaves = new Map<string, number>()
  handle('notes.set', ({ project, id, text, base }) => serial(async () => {
    const p = await projectOf(project)
    // The id names a folder, so only a finding's own is written.
    if (!(await findingsOf(p)).findings.some((f) => f.id === id)) throw new Error('That finding is no longer on the list.')
    const r = writeNotes(filesOf(p), id, text, base)
    ownSaves.set(`${project}/${id}`, r.mtime)
    return r
  }))

  /** A screenshot of one of the finding's reports, by report id and place in its `shots`. */
  async function shotPath(p: Project, id: string, report: string, index: number): Promise<string> {
    const r = findingIn(await findingsOf(p), id).reports.find((x) => x.id === report)
    if (!r) throw invalid('That report is no longer on the finding.')
    if (!Number.isInteger(index) || index < 0 || index >= r.shots.length) throw invalid('That screenshot is no longer on the report.')
    return resolve(p.path, r.shots[index])
  }
  const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
  // base64 is a third bigger, and a request answers in at most 1 MiB.
  const MAX_SHOT = 700_000

  handle('shot.get', ({ project, id, report, index }) => serial(async () => {
    const path = await shotPath(await projectOf(project), id, report, index), name = basename(path)
    const mime = MIME[extname(path).toLowerCase()]
    // The size is read first so a big file is never loaded.
    if (!mime || !existsSync(path) || statSync(path).size > MAX_SHOT) return { url: null, name }
    return { url: `data:${mime};base64,${readFileSync(path, 'base64')}`, name }
  }))

  /** Open a file in Orca's editor, in the open local workspace that holds it; the deepest wins (a QA copy over the checkout). */
  async function openFile(path: string, missing: string) {
    const ws = (await host.call('workspace.list')).workspaces
      .filter((w) => (w.hostId ?? 'local') === 'local' && path.startsWith(w.path.endsWith(sep) ? w.path : w.path + sep))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!ws) throw new Error(missing)
    await host.call('editor.open', { workspaceId: ws.id, path: relative(ws.path, path) })
    return ok
  }
  handle('shot.open', ({ project, id, report, index }) => serial(async () =>
    openFile(await shotPath(await projectOf(project), id, report, index), "That screenshot isn't in a workspace Orca has open.")))

  const list = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  handle('issue.draft', ({ project, id }) => serial(async () => {
    const p = await projectOf(project), f = findingIn(await findingsOf(p), id), names = namesOf(p)
    const first = f.reports[0], seen = [...new Set(f.reports.map((r) => names[r.persona] ?? r.persona))]
    const body = [first.saw, ...(first.steps.length ? [`Steps to reproduce:\n${first.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`] : []),
      `Seen by ${list(seen)}.`].join('\n\n')
    return { title: f.title, body, notes: readNotes(filesOf(p), id).text.trim() }
  }))

  handle('issue.create', ({ project, id, title, body }) => serial(async () => {
    const p = await projectOf(project), before = await findingsOf(p), f = findingIn(before, id)
    if (f.issue) throw new Error(`This finding already has issue #${f.issue.number}.`)
    const { tools } = await env()
    const issue = await tools.createIssue(await repoFor(p, tools), title, body)
    await save(p, before, act(before, { type: 'issue', id, ...issue }, Date.now()))
    post('changed', { project, finding: id })
    return issue
  }))

  /** By project and finding: discussions whose chat is still being launched. */
  const starting = new Set<string>()
  handle('discuss.start', async ({ project, id }) => {
    const key = `${project}/${id}`
    if (starting.has(key)) throw new Error('That discussion is already starting.')
    starting.add(key)
    try {
      const p = await projectOf(project)
      const { f, names } = await serial(async () => ({ f: findingIn(await findingsOf(p), id), names: namesOf(p) }))
      const title = `Discuss: ${f.title}`.replace(/^(.{59}).{2,}$/s, '$1…')
      const { tools } = await env()
      // A chat list that fails counts as "not listed".
      const open = f.discussion ? await tools.chats(p.path).catch(() => []) : []
      if (f.discussion && open.some((c) => c.session === f.discussion)) return { chat: f.discussion, title, existing: true }
      const dir = findingDir(filesOf(p), id)
      const briefPath = writeBrief(filesOf(p), f, names)
      const pointer = promptFile(filesOf(p), `discuss-${id}`, fill(DISCUSS_PROMPT, { title: f.title, briefPath, notesPath: join(dir, 'notes.md') }))
      const { session } = await tools.launchChat({ agent: await agentOf(), worktreePath: p.path, prompt: pointer, focus: true })
      await tools.renameChat(session, title).catch((err) => orca.log(`studio: naming the discussion of ${id}: ${say(err)}`))
      // Re-read: the finding may have changed, or gone, while the chat launched.
      await serial(async () => {
        const before = await findingsOf(p)
        findingIn(before, id)
        await save(p, before, act(before, { type: 'discussion', id, chat: session }, Date.now()))
      })
      post('changed', { project, finding: id })
      return { chat: session, title, existing: false }
    } finally {
      starting.delete(key)
    }
  })

  const runs = makeRuns({ storage, host, tools: async () => (await env()).tools,
    agent: agentOf, filesOf, serial, findingsOf, saveFindings: save,
    post, log: (line) => orca.log(line), now: () => now(), runner: (cmd, args, opts) => runner(cmd, args, opts) })

  /** The projects whose setup chat is being launched. */
  const settingUp = new Set<string>()
  handle('setup.start', async ({ project }) => {
    if (settingUp.has(project)) throw new Error('Setup is already starting.')
    settingUp.add(project)
    try {
      const p = await projectOf(project), { tools } = await env(), key = `setup:${p.id}`
      const was = (await storage.get(key)) as { chat?: string } | null
      // A chat list that fails counts as "not listed".
      if (was?.chat && (await tools.chats(p.path).catch(() => [])).some((c) => c.session === was.chat)) return { chat: was.chat, existing: true }
      // A persona.studio that doesn't load is what setup may be there to fix: it gets the defaults.
      let config = parseConfig(undefined)
      try { config = readConfig(p.path) } catch { /* defaults */ }
      const trialPort = await freePort(config.port, await runs.ports())
      const text = fill(SETUP_PROMPT, { project: p.name, root: p.path, config: join(p.path, CONFIG_FILE), personas: join(p.path, config.personas), trialPort: String(trialPort) })
      const { session } = await tools.launchChat({ agent: await agentOf(), worktreePath: p.path, prompt: promptFile(filesOf(p), 'setup', text), focus: true })
      await tools.renameChat(session, 'Set up personas').catch((err) => orca.log(`studio: naming the setup chat: ${say(err)}`))
      await storage.set(key, { chat: session })
      return { chat: session, existing: false }
    } finally {
      settingUp.delete(project)
    }
  })

  async function rowOf(p: Project, s: { id: string; name: string; tag: string; sheetPath: string }, pf: ProjectFindings): Promise<PersonaRow> {
    const { runs: past, run, error } = await loadRecord(storage, p.id, s.id)
    // ponytail: the portrait rides on every overview (a few KB each); a request of its own if overviews get heavy.
    const portrait = portraitOf(s.sheetPath)
    const fresh = pf.findings.filter((f) => f.state === 'new' && f.fresh && f.reports.some((r) => r.persona === s.id)).length
    const line = run && progressLines(filesOf(p), run.id, 1)?.lines[0]
    return { id: s.id, name: s.name, tag: s.tag, state: run ? 'running' : 'idle', fresh, runs: past.length, recheck: recheckOf(pf, s.id).length,
      ...(past.length > 0 && { lastRunAt: Math.max(...past.map((r) => r.at)) }), ...(portrait && { portrait }),
      ...(run && { stage: stageWord(run, line), chat: `${s.name}'s run`, ...(line && { line }) }), ...(error && { error: error.text }) }
  }

  /** By project: the config error last logged, so each is logged once. */
  const configLogged = new Map<string, string>()
  handle('overview.get', ({ project }) => serial(async () => {
    const p = await projectOf(project), { tools } = await env(), pf = await findingsOf(p)
    // A broken persona.studio costs the persona list; configError says why.
    let sheets: ReturnType<typeof sheetsOf> = [], configError: string | null = null
    try { sheets = sheetsOf(p) } catch (err) { configError = say(err) }
    if (configError === null) configLogged.delete(p.id)
    else if (configLogged.get(p.id) !== configError) {
      configLogged.set(p.id, configError)
      orca.log(`studio: ${p.name}'s persona.studio doesn't load: ${configError}`)
    }
    const personas = await Promise.all(sheets.map((s) => rowOf(p, s, pf)))
    return { personas, counts: counts(pf.findings.map(toRow), {}),
      hasGh: tools.hasGh, canRun: canRun(p.path), configError }
  }))

  handle('persona.get', ({ project, persona }) => serial(async () => {
    const p = await projectOf(project), pf = await findingsOf(p), s = sheetsOf(p).find((x) => x.id === persona)
    if (!s) throw invalid(`There's no persona "${persona}" in ${p.name}.`)
    const { runs: done, run } = await loadRecord(storage, p.id, persona)
    const file = parseSheet(readFileSync(s.sheetPath, 'utf8'))
    const goals = file.goals.map((g) => ({ text: g.text, met: isMet(g, done),
      ...(g.measure && { trend: { text: g.text, target: g.measure.target, better: g.measure.better, unit: g.measure.metric, points: series(g, done) } }) }))
    return { row: await rowOf(p, s, pf), lines: (run && progressLines(filesOf(p), run.id)?.lines) || [],
      branch: run?.qa?.branch ?? null, port: run?.port ?? null, who: file.who, goals }
  }))

  handle('persona.open', async ({ project, persona }) => {
    const p = await projectOf(project), s = sheetsOf(p).find((x) => x.id === persona)
    if (!s) throw invalid(`There's no persona "${persona}" in ${p.name}.`)
    return openFile(s.sheetPath, `${s.name}'s persona file isn't in a workspace Orca has open.`)
  })
  // A run tests the last commit, so uncommitted changes would silently miss it: say so first, unless told to run anyway.
  handle('run.start', async ({ project, persona, focus, anyway }) => {
    const p = await projectOf(project)
    if (!anyway) {
      const uncommitted = await (await env()).tools.uncommitted(p.path)
      if (uncommitted > 0) return { uncommitted }
    }
    await runs.start(p, persona, focus)
    return ok
  })
  handle('run.stop', async ({ project, persona }) => { await runs.stop(await projectOf(project), persona); return ok })
  // ponytail: Orca can't focus one chat tab, only show its workspace; the tab says which chat to look at.
  handle('run.watch', async ({ project, persona }) => {
    const { run } = await loadRecord(storage, (await projectOf(project)).id, persona)
    if (!run?.qa) throw invalid(`${persona} isn't running.`)
    await host.call('workspace.open', { workspaceId: run.qa.workspaceId })
    return ok
  })
  orca.events.on('agent.status.changed', async ({ paneKey, state }) => {
    if (state !== 'done') return
    await runs.ended(paneKey).catch((err) => orca.log(`studio: a chat's turn ended: ${say(err)}`))
    // The setup chat writes persona.studio and persona files: its project's tab reloads.
    await (async () => {
      for (const k of await storage.keys()) {
        if (k.startsWith('setup:') && paneKey.startsWith(`structured-agent-session-${((await storage.get(k)) as { chat?: string } | null)?.chat}:`)) post('changed', { project: k.slice(6) })
      }
    })().catch((err) => orca.log(`studio: a chat's turn ended: ${say(err)}`))
  })

  /** By the tab's checkout: what the last tab.open asked that tab to show, kept until it takes it. A tab just opened
   *  isn't listening yet when `show` is posted, so it asks with show.take once it has loaded. */
  const shows = new Map<string, { project: string; show: Show }>()
  handle('show.take', ({ project, at }) => {
    // A tab that doesn't know its checkout takes its project's.
    const key = at ?? [...shows.keys()].find((k) => shows.get(k)!.project === project)
    const kept = key === undefined ? undefined : shows.get(key)
    if (!kept || kept.project !== project) return { show: null }
    shows.delete(key!)
    return { show: kept.show }
  })
  /** Open the tab: the project's committed persona.studio, made empty when missing. Not serial: it changes no findings. */
  async function openTab(p: Project, show?: Show) {
    // In one of the project's persona QA worktrees, the tab opens there rather than in the main checkout.
    const focus = await focusNow().catch(() => undefined)
    const at = focus?.kind === 'project' && focus.id === p.id && focus.persona && focus.path ? focus.path : p.path
    const file = join(at, CONFIG_FILE)
    if (!existsSync(file)) writeFileSync(file, '{}\n')
    const ws = (await host.call('workspace.list')).workspaces.find((w) => w.path === at && (w.hostId ?? 'local') === 'local')
    if (!ws) throw new Error(`No workspace in Orca is ${p.name}'s own checkout (${at}).`)
    if (show) shows.set(at, { project: p.id, show })
    else shows.delete(at)
    await host.call('editor.open', { workspaceId: ws.id, path: CONFIG_FILE })
    post('show', { project: p.id, at, ...show })
  }
  handle('tab.projects', async ({ text }) => {
    const want = text.trim()
    const same = (p: Project) => { try { return readFileSync(join(p.path, CONFIG_FILE), 'utf8').trim() === want } catch { return false } }
    return { projects: (await loadProjects(storage)).filter(same).map((p) => p.id) }
  })
  handle('tab.open', async ({ project, show }) => { await openTab(await projectOf(project), show); return ok })

  const started = Date.now()
  /** By project: when the tick last looked at its notes files. */
  const looked = new Map<string, number>()
  /** Tell the tab about each notes file an agent changed since the last look. */
  async function tick() {
    for (const p of await loadProjects(storage)) {
      try {
        const pf = await loadFindings(storage, p.id)
        if (!pf) continue
        const now = Date.now()
        for (const id of notesChangedSince(filesOf(p), pf.findings.map((f) => f.id), looked.get(p.id) ?? started)) {
          if (ownSaves.get(`${p.id}/${id}`) !== readNotes(filesOf(p), id).mtime) post('changed', { project: p.id, finding: id })
        }
        looked.set(p.id, now)
      } catch (err) {
        orca.log(`studio: tick for ${p.id}: ${say(err)}`)
      }
    }
    await runs.watch().catch((err) => orca.log(`studio: watching runs: ${say(err)}`))
  }
  /** The brief an agent starting work on `f` is given, from `base`; with `autoPr`, it opens its PR without waiting for the owner. */
  function workBrief(p: Project, fs: Finding[], base: string, autoPr = false): string {
    const config = readConfig(p.path), one = fs.length === 1
    const findings = workList(fs.map((f) => ({ id: f.id, title: f.title, briefPath: join(findingDir(filesOf(p), f.id), 'finding.md'),
      notesPath: join(findingDir(filesOf(p), f.id), 'notes.md') })))
    const fixes = fs.flatMap((f) => (f.issue ? [`\`Fixes #${f.issue.number}\``] : [])).join(', ') || '(none)'
    return fill(WORK_PROMPT, { what: one ? 'one finding' : `${fs.length} findings`, these: one ? 'this finding' : 'these findings', findings, base, fixes,
      pr: fill(PR_WHEN[autoPr ? 'auto' : 'owner'], { base }),
      builderBrief: config.builderBrief === undefined ? '' : promptOf(p.path, 'builderBrief', config.builderBrief) })
  }
  /** A worktree name for several findings: their ids. */
  const workName = (fs: Finding[]) => (fs.length === 1 ? slugOf(fs[0].title) : `fix-${fs.map((f) => f.id).join('-')}`.slice(0, 63).replace(/-+$/, ''))

  handle('work.draft', ({ project, ids }) => serial(async () => {
    const p = await projectOf(project), pf = await findingsOf(p), fs = ids.map((id) => findingIn(pf, id))
    return { name: workName(fs), base: p.branch, brief: workBrief(p, fs, p.branch), autoBrief: workBrief(p, fs, p.branch, true) }
  }))

  /** By project and finding: work whose worktree is still being made. */
  const working = new Set<string>()
  handle('work.start', async ({ project, ids, name, base, each, autoPr }) => {
    const keys = ids.map((id) => `${project}/${id}`)
    if (!ids.length) throw invalid('Pick the findings to work on.')
    if (keys.some((k) => working.has(k))) throw invalid(ids.length === 1 ? "That finding's work is already starting." : 'Work on one of those findings is already starting.')
    for (const k of keys) working.add(k)
    const groups: { fs: Finding[]; name: string; pointer: string }[] = []
    let tools: Awaited<ReturnType<typeof env>>['tools'], p: Project, config: ReturnType<typeof readConfig>, agent: string
    try {
      p = await projectOf(project)
      const { fs, names } = await serial(async () => { const pf = await findingsOf(p); return { fs: ids.map((id) => findingIn(pf, id)), names: namesOf(p) } })
      if (fs.some((f) => f.state !== 'kept')) throw invalid(fs.length === 1 ? 'Only a kept finding can be started.' : 'Only kept findings can be started.')
      if (!each && !NAME.test(name)) throw invalid('A worktree name is lowercase letters, digits and dashes, and starts with a letter or digit.')
      if (!base.trim()) throw invalid('Say which branch the work starts from.')
      ;({ tools } = await env())
      config = readConfig(p.path)
      agent = await agentOf()
      const taken = new Set<string>()
      for (const g of each ? fs.map((f) => [f]) : [fs]) {
        // Two titles can make the same name: the later one gets a number.
        let n = each ? workName(g) : name
        for (let i = 2; taken.has(n); i++) n = `${workName(g)}-${i}`
        taken.add(n)
        for (const f of g) writeBrief(filesOf(p), f, names)
        groups.push({ fs: g, name: n, pointer: promptFile(filesOf(p), `work-${g.map((f) => f.id).join('-')}`, workBrief(p, g, base, autoPr === true)) })
      }
    } catch (err) {
      for (const k of keys) working.delete(k)
      throw err
    }
    for (const g of groups) startWork(p, g, base, tools, config, agent)
    return ok
  })
  /** Make one worktree and its briefed chat for `g.fs`, then move them all to Working; a failure lands in each one's history.
   *  The worktree can take minutes (its setup runs), so the chain is held only to record the result. */
  function startWork(p: Project, g: { fs: Finding[]; name: string; pointer: string }, base: string,
    tools: Awaited<ReturnType<typeof env>>['tools'], config: ReturnType<typeof readConfig>, agent: string) {
    const { name, pointer } = g, ids = g.fs.map((f) => f.id), project = p.id
    void (async () => {
      try {
        await tools.createWorktree({ projectPath: p.path, name, branch: name, base, setup: config.setup })
        const root = await tools.mainCheckout(p.path)
        const ws = root && await findWorkspace(host, tools, name, root, 10)
        if (!ws) throw new Error(`Orca made the worktree ${name} but doesn't list it.`)
        const start = await tools.headOf(ws.path, 'HEAD')
        const { session } = await tools.launchChat({ agent, worktreePath: ws.path, prompt: pointer, focus: true })
        await tools.renameChat(session, `Worktree: ${name}`).catch((err) => orca.log(`studio: naming the chat of ${name}: ${say(err)}`))
        const work: Work = { worktreePath: ws.path, branch: name, workspaceId: ws.id, chat: session, base, start }
        await serial(async () => {
          const before = await findingsOf(p)
          await save(p, before, ids.reduce((pf, id) => act(pf, { type: 'work', id, work }, Date.now()), before))
        })
      } catch (err) {
        await serial(async () => {
          const before = await findingsOf(p), after = structuredClone(before)
          for (const x of after.findings.filter((x) => ids.includes(x.id))) x.history.push({ at: Date.now(), text: `Couldn't start work: ${say(err)}` })
          await save(p, before, after)
        }).catch((e) => orca.log(`studio: recording that ${name}'s work didn't start: ${say(e)}`))
      } finally {
        for (const id of ids) working.delete(`${project}/${id}`)
        post('changed', ids.length === 1 ? { project, finding: ids[0] } : { project })
      }
    })()
  }

  /** When the branches were last watched. A reload watches on its first tick. */
  let watched = 0
  /** Look at every Working finding's branch, then record what changed. The slow calls run outside the chain. */
  async function watchWorks() {
    const minutes = Number((await orca.settings.get()).prPollMinutes) || 5
    if (watched && now() - watched < minutes * 60_000) return
    watched = now()
    for (const p of await loadProjects(storage)) {
      try {
        const live = (await serial(() => loadFindings(storage, p.id)))?.findings.filter((f) => f.state === 'progress' && f.work) ?? []
        if (!live.length) continue
        const { tools } = await env()
        const repo = tools.hasGh ? await repoFor(p, tools).catch((err) => { orca.log(`studio: no repo for watching ${p.id}, using git: ${say(err)}`); return null }) : null
        const here = new Set((await host.call('workspace.list')).workspaces.filter((w) => (w.hostId ?? 'local') === 'local').map((w) => w.path))
        const seen = new Map<string, { branch: string; seen: Seen }>()
        for (const f of live) {
          const w = f.work!
          // A finding with no start commit can only be told by its PR: with no gh, nothing can be said of it.
          if (!repo && !w.start) continue
          try {
            const pr = repo ? await tools.prForBranch(repo, w.branch) : undefined
            const merged = !repo && w.base && w.start ? await tools.mergedInto(p.path, { branch: w.branch, base: w.base, start: w.start }) : false
            seen.set(f.id, { branch: w.branch, seen: { pr, merged, gone: !here.has(w.worktreePath) } })
          } catch (err) {
            orca.log(`studio: watching ${w.branch}: ${say(err)}`)
          }
        }
        await serial(async () => {
          const before = await findingsOf(p)
          let after = before
          for (const [id, s] of seen) {
            const f = after.findings.find((x) => x.id === id)
            if (f?.state !== 'progress' || f.work?.branch !== s.branch) continue
            const a = watchWork(f, s.seen)
            if (a) after = act(after, a, Date.now())
          }
          if (after !== before) {
            await save(p, before, after)
            post('changed', { project: p.id })
          }
        })
      } catch (err) {
        orca.log(`studio: watching work in ${p.id}: ${say(err)}`)
      }
    }
  }
  /** One tick, then the slow watching of branches. */
  const poll = async () => { await serial(tick); await watchWorks() }
  // Used by tests only: the timer calls poll itself.
  handle('tick', async () => { await poll(); return ok })

  const focusing = makeFocus({ host, tools: async () => (await env()).tools, log: orca.log })
  let focus: Focus | undefined
  let focusRuns = 0
  let heard = false
  /** The newest refocus while it runs: what's focused is asked of it, not of the focus it's replacing. */
  let refocusing: Promise<Focus> | undefined
  const focusNow = () => refocusing ?? (focus ? Promise.resolve(focus) : refocus())

  /** A focused git worktree is a project: the stored one at its path, else a new one. Nothing is written into its
   * checkout. Run it serially. */
  async function projectAt(f: Extract<Focused, { kind: 'git' }>): Promise<Focus> {
    const { tools } = await env(), projects = await loadProjects(storage)
    const qa = await qaOwnerOf(f, projects, tools)
    if (qa) return { ...(await focusOf(qa.p)), path: f.path, persona: qa.persona }
    let p = projects.find((x) => x.path === f.path)
    if (!p) {
      const wt = await worktreeOf(tools, f)
      if (!wt) throw new Error(`${f.path} isn't a git repository.`)
      // The owner's stored data is keyed by this id, so it's made exactly as it always was.
      let id = wt.id
      for (let n = 2; projects.some((x) => x.id === id); n++) id = `${wt.id}-${n}`
      p = { id, name: f.name, path: f.path, branch: f.branch }
      await saveProjects(storage, [...projects, p])
    }
    return { ...(await focusOf(p)), path: f.path }
  }
  async function focusOf(p: Project): Promise<Extract<Focus, { kind: 'project' }>> {
    await findingsOf(p)
    return { kind: 'project', id: p.id, name: p.name, personas: Object.keys(namesOf(p)).length }
  }
  /** A persona's QA worktree belongs to the project its runs start from, whose records hold its status. Its branch is
   *  `studio/qa-<persona>` from the main checkout, or `studio/qa-<folder>-<persona>` from another worktree (see runs.ts). */
  async function qaOwnerOf(f: Extract<Focused, { kind: 'git' }>, projects: Project[], tools: Tools) {
    const m = /^studio\/qa-(.+)$/.exec(f.branch)
    if (!m) return null
    const root = await tools.mainCheckout(f.path)
    if (root === null) return null
    for (const p of projects) {
      if (p.path === f.path) continue
      const prefix = p.path === root ? '' : `${basename(p.path)}-`
      const persona = m[1].startsWith(prefix) ? m[1].slice(prefix.length) : ''
      if (!persona || !(persona in namesOf(p))) continue
      if (p.path !== root && await tools.mainCheckout(p.path) !== root) continue
      return { p, persona }
    }
    return null
  }

  /** Work out the focus again, and tell the panels when it changed. The newest run wins over one still going. */
  function refocus(): Promise<Focus> {
    const run = refocusOnce()
    refocusing = run
    const done = () => { if (refocusing === run) refocusing = undefined }
    run.then(done, done)
    return run
  }
  async function refocusOnce(): Promise<Focus> {
    const mine = ++focusRuns
    // Until workspace.changed first says, ask Orca for the context.
    if (!heard) {
      const read = await host.call('workspace.readContext')
      // An event that came while Orca answered is newer than the answer.
      if (!heard) focusing.set(read)
    }
    const found = await focusing.resolve()
    const f = found.kind === 'git' ? await serial(() => projectAt(found)) : found
    if (mine === focusRuns && JSON.stringify(f) !== JSON.stringify(focus)) {
      focus = f
      post('focus', f)
    }
    return f
  }

  orca.events.on('workspace.changed', async ({ context: c }) => {
    heard = true
    focusing.set(c)
    await refocus().catch((err) => orca.log(`studio: finding the focused project: ${say(err)}`))
  })
  handle('focus.get', () => focusNow())
  /** The terminal background the owner set in Orca, so the tab sits on the colour their terminals do.
   *  ponytail: reads Orca's private settings store with macOS's sqlite3; null (the tab keeps its chat-canvas mix) when either moves. */
  handle('theme.get', async () => {
    const db = join(homedir(), 'Library', 'Application Support', 'orca', 'profiles', 'local-default', 'profile-state.db')
    if (!existsSync(db)) return { canvas: null }
    const out = await runner('/usr/bin/sqlite3', ['-readonly', `file:${db}?mode=ro`,
      "select json_extract(payload, '$.terminalColorOverrides.background') from profile_state_documents where domain = 'settings'"], { timeoutMs: 5000 })
      .catch(() => null)
    const v = out?.code === 0 ? out.stdout.trim() : ''
    return { canvas: /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null }
  })

  orca.commands.register('open', async () => {
    try {
      const f = await focusNow()
      if (f.kind !== 'project') return focusWords(f)
      await openTab(await projectOf(f.id))
      return 'Opened the Persona Studio tab.'
    } catch (err) {
      return say(err)
    }
  })

  orca.commands.register('needs-you', async () => {
    try {
      const f = await focusNow()
      if (f.kind !== 'project') return focusWords(f)
      const n = await serial(async () => counts((await findingsOf(await projectOf(f.id))).findings.map(toRow), {}))
      return STATES.filter((s) => s !== 'closed' && n[s] > 0).map((s) => `${stateWord[s]}: ${n[s]}`).join('\n') || 'Nothing is waiting.'
    } catch (err) {
      return say(err)
    }
  })

  let ticking = false
  // One timer per module: a second activate (tests mount more than one worker) would otherwise leave the first running.
  clearInterval(timer)
  timer = setInterval(() => {
    // A slow tick never has more queued behind it.
    if (ticking) return
    ticking = true
    void poll().catch((err) => orca.log(`studio: tick: ${say(err)}`)).finally(() => { ticking = false })
  }, 15_000)
  // A run Orca's reload interrupted while preparing, or whose app died with the old worker, fails in plain words.
  void serial(() => runs.recover()).catch((err) => orca.log(`studio: picking runs back up: ${say(err)}`))
}

export function deactivate(): void {
  clearInterval(timer)
  timer = undefined
}
