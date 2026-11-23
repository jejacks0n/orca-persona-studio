// A persona's run, end to end: its QA copy and app, the run chat, an optional reviewer, matching one run at a time
// per project, and landing on the findings list. Everything lives in storage, so a reload picks the run back up.
// `start`, `stop` and `ended` take the worker's chain themselves; `watch` and `recover` run inside it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { JsonValue, PluginPanelEvents } from 'orca'
import type { HostApi, StorageApi } from 'orca/host'
import { inPlace, listPersonas, promptOf, readConfig, type Config } from './config'
import { landRun, landedWords } from './land'
import type { ActiveRun, PersonaRecord, ProjectFindings, RunTask } from './model'
import { closedText, fill, goalsText, MATCH_PROMPT, recheckText, RUN_PROMPT } from './prompts'
import { say } from './protocol'
import { parseResults, type Results } from './results'
import { advance, nextToMatch } from './run'
import { alive, copyInto, freePort, startApp, stopApp, waitForUrl } from './serve'
import { loadProjects, loadRecord, saveRecord } from './store'
import { doneFilePath, progressLines, progressNote, promptFile, readDone } from './tasks'
import { ToolError, type Runner, type Tools } from './tools'
import type { Project } from './types'

export interface RunCtx { storage: StorageApi; host: HostApi<'worker'>; tools(): Promise<Tools>; agent(): Promise<string>
  filesOf(p: Project): string; serial<T>(fn: () => Promise<T>): Promise<T>; findingsOf(p: Project): Promise<ProjectFindings>
  saveFindings(p: Project, before: ProjectFindings, after: ProjectFindings): Promise<void>
  post<K extends 'changed' | 'landed'>(event: K, payload: PluginPanelEvents[K]): void; log(line: string): void; now(): number
  /** Runs `prepare` commands. */
  runner: Runner }

export const NO_START = `Persona Studio doesn't know how to start this app yet. Set "start" in persona.studio, or set up personas.`
/** An error the panels show as a refusal of what was asked. */
export const invalid = (message: string) => Object.assign(new Error(message), { code: 'invalid_params' })
/** The branch `p`'s checkout is on now, read from git: it can change after the project is first seen. Refuses when it's on none. */
export async function branchNow(tools: Tools, p: Project, again = 'run again') {
  const branch = await tools.branchOf(p.path)
  if (branch === null) throw invalid(`${p.name}'s checkout isn't on a branch. Check out a branch and ${again}.`)
  return branch
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** For the chain: SIGTERM the app's group now, so a reload can't lose it, and finish stopping it after the chain moves on. */
function halt(pid: number) {
  try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ }
  void stopApp(pid).catch(() => {})
}

/** Why this project's runs can't start, or null. */
export function canRun(projectPath: string): string | null {
  try {
    const config = readConfig(projectPath)
    return config.start || config.runPrompt ? null : NO_START
  } catch (err) {
    return say(err)
  }
}

/** The fixes a persona's next run checks again: Fixed, not yet Confirmed, and reported by it. */
export const recheckOf = (pf: ProjectFindings, persona: string): string[] => pf.findings
  .filter((f) => f.state === 'fixed' && !f.confirmed && f.reports.some((r) => r.persona === persona)).map((f) => f.id)

/** The local workspace on `branch` whose repo's main checkout is `root`, looking `tries` times 1 s apart. */
export async function findWorkspace(host: HostApi<'worker'>, tools: Tools, branch: string, root: string, tries: number) {
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(1000)
    for (const w of (await host.call('workspace.list')).workspaces) {
      // Orca's CLI names branches as refs/heads/<name>; the host API may too.
      if ((w.hostId ?? 'local') === 'local' && w.branch?.replace(/^refs\/heads\//, '') === branch && (await tools.mainCheckout(w.path)) === root) return w
    }
  }
  return undefined
}

/** The results file, checked; a file that doesn't read throws in words the owner sees, never quoting the file. */
function loadResults(path: string): Results {
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    // The parser's message quotes the file's first characters.
    throw new Error(err instanceof SyntaxError ? `The results file ${path} isn't JSON.` : `The results file ${path} doesn't read: ${say(err)}`)
  }
  try {
    return parseResults(json)
  } catch (err) {
    throw new Error(`The results file ${path} doesn't read: ${say(err)}`)
  }
}

/** A match done file's entries; any other shape throws. */
function matchesOf(out: Record<string, JsonValue>, path: string): { finding: string; match: string | null }[] {
  const m = out.matches
  if (!Array.isArray(m) || !m.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x)
    && typeof x.finding === 'string' && (x.match === null || typeof x.match === 'string'))) {
    throw new Error(`The done file ${path} doesn't read.`)
  }
  return m as { finding: string; match: string | null }[]
}

export function makeRuns(c: RunCtx) {
  /** By run id: the newest progress line the panels were told about. The only run state kept in memory. */
  const lines = new Map<string, string>()
  /** `<project>:<persona>` while its `begin` is still going; it dies with a reload, as `begin` does. */
  const beginning = new Set<string>()
  /** Run ids whose review or matcher chat is being launched, so a tick never launches it twice. */
  const launching = new Set<string>()
  const nameOf = (p: Project, persona: string) => {
    try {
      return listPersonas(p.path, readConfig(p.path)).find((s) => s.id === persona)?.name ?? persona
    } catch {
      return persona
    }
  }
  /** Every persona record with a run, in every project. */
  async function active(): Promise<PersonaRecord[]> {
    const out: PersonaRecord[] = []
    for (const k of await c.storage.keys()) {
      if (!k.startsWith('record:')) continue
      const r = (await c.storage.get(k)) as unknown as PersonaRecord | null
      if (r?.run) out.push(r)
    }
    return out
  }
  /** In the chain: the record while its run is still `id`, else null. */
  async function current(p: Project, persona: string, id: string): Promise<PersonaRecord | null> {
    const r = await loadRecord(c.storage, p.id, persona)
    return r.run?.id === id ? r : null
  }
  /** Serially: change the record while its run is still `id`. False when it isn't. */
  const write = (p: Project, persona: string, id: string, fn: (r: PersonaRecord & { run: ActiveRun }) => void) => c.serial(async () => {
    const r = await current(p, persona, id)
    if (!r) return false
    fn(r as PersonaRecord & { run: ActiveRun })
    await saveRecord(c.storage, r)
    c.post('changed', { project: p.id })
    return true
  })

  /** In the chain: stop the run's app, drop it, say why and start the next match. */
  async function fail(p: Project, persona: string, id: string, text: string) {
    const r = await current(p, persona, id)
    if (!r) return
    c.log(`studio: ${persona}'s run ${id} failed: ${text}`)
    if (r.run!.app) halt(r.run!.app.pid)
    delete r.run
    r.error = { at: c.now(), text }
    await saveRecord(c.storage, r)
    c.post('changed', { project: p.id })
    await matchNext(p)
  }

  async function stopChat(session: string, name: string) {
    try {
      const tools = await c.tools()
      for (const step of [() => tools.renameChat(session, `Stopped: ${name}'s run`),
        () => tools.sendToChat(session, 'Stopped', 'Persona Studio stopped this run. Stop now and write nothing more.')]) {
        await step().catch((err) => c.log(`studio: telling ${name}'s chat it was stopped: ${say(err)}`))
      }
    } catch (err) {
      c.log(`studio: telling ${name}'s chat it was stopped: ${say(err)}`)
    }
  }

  /** In the chain: the filled run or review prompt for `run`, written to its file; the pointer the agent gets. */
  async function prompt(p: Project, persona: string, run: ActiveRun, role: 'run' | 'review'): Promise<string> {
    const config = readConfig(p.path), files = c.filesOf(p), taskId = `${run.id}-${role}`, qa = run.qa!.path
    const sheet = listPersonas(p.path, config).find((s) => s.id === persona)
    if (!sheet) throw new Error(`There's no persona "${persona}" in ${p.name} any more.`)
    const runDir = join(qa, config.runsDir, run.id), pf = await c.findingsOf(p)
    mkdirSync(runDir, { recursive: true })
    const vars = { persona, seed: String(run.seed), script: sheet.sheetPath, goals: goalsText(readFileSync(sheet.sheetPath, 'utf8')),
      runDir, resultsFile: config.resultsFile, doneFile: doneFilePath(files, taskId), port: String(run.port),
      url: config.url.split('{port}').join(String(run.port)), worktree: qa, recheck: recheckText(pf.findings, run.recheck),
      closed: closedText(pf.findings), focus: run.focus ?? '' }
    const template = role === 'run' ? (config.runPrompt ? promptOf(p.path, 'runPrompt', config.runPrompt) : RUN_PROMPT)
      : promptOf(p.path, 'reviewPrompt', config.reviewPrompt!)
    return promptFile(files, taskId, `${fill(template, vars)}\n\n${progressNote(files, run.id)}`)
  }

  /** From the chain, but not holding it: launch the review or matcher chat, then record it if the run is still `run`. */
  function launch(p: Project, persona: string, run: ActiveRun, task: Omit<RunTask, 'chat'>, pointer: string) {
    if (launching.has(run.id)) return
    launching.add(run.id)
    void (async () => {
      try {
        const { session } = await (await c.tools()).launchChat({ agent: await c.agent(), worktreePath: run.qa!.path, prompt: pointer })
        if (!(await write(p, persona, run.id, (r) => { r.run = advance(r.run, { type: 'launched', task: { ...task, chat: session } }) }))) {
          await stopChat(session, nameOf(p, persona))
        }
      } catch (err) {
        await c.serial(() => fail(p, persona, run.id, say(err))).catch((e) => c.log(`studio: failing ${persona}'s run: ${say(e)}`))
      } finally {
        launching.delete(run.id)
      }
    })()
  }

  /** In the chain: launch the matcher for the project's oldest waiting results, unless one is matching already. */
  async function matchNext(p: Project) {
    const recs = (await active()).filter((r) => r.project === p.id)
    const persona = nextToMatch(recs.map((r) => ({ persona: r.persona, run: r.run! })))
    if (!persona) return
    const r = recs.find((x) => x.persona === persona)! as PersonaRecord & { run: ActiveRun }, id = r.run.id
    if (launching.has(id)) return
    try {
      const files = c.filesOf(p), taskId = `${id}-match`, listPath = join(files, 'runs', id, 'findings.json')
      mkdirSync(dirname(listPath), { recursive: true })
      writeFileSync(listPath, JSON.stringify((await c.findingsOf(p)).findings.map((f) => ({ id: f.id, title: f.title, state: f.state,
        kind: f.kind, ...(f.closed && { closed: f.closed }), saw: (f.reports[0]?.saw ?? '').slice(0, 300) }))))
      const text = fill(MATCH_PROMPT, { resultsPath: r.run.results!.path, listPath, doneFile: doneFilePath(files, taskId) })
      launch(p, persona, r.run, { id: taskId, role: 'match' }, promptFile(files, taskId, `${text}\n\n${progressNote(files, id)}`))
    } catch (err) {
      await fail(p, persona, id, say(err))
    }
  }

  /** In the chain: put a matched run's results on the findings list and drop the run. */
  async function land(p: Project, r: PersonaRecord & { run: ActiveRun }, matches: { finding: string; match: string | null }[]) {
    const run = r.run, path = run.results!.path, results = loadResults(path), name = nameOf(p, r.persona)
    const before = await c.findingsOf(p), at = c.now()
    const { pf, landed } = landRun(before, { persona: r.persona, name, runId: run.id, startedAt: run.at, recheck: run.recheck,
      results, resultsDir: dirname(path), qaPath: run.qa!.path, matches }, at)
    await c.saveFindings(p, before, pf)
    r.runs.push({ runId: run.id, loop: r.runs.length + 1, seed: run.seed, resultsPath: path, at,
      goals: results.goals,
      ...(results.input !== undefined && { input: results.input }), landed })
    delete (r as PersonaRecord).run
    await saveRecord(c.storage, r)
    c.post('changed', { project: p.id })
    c.post('landed', { project: p.id, persona: r.persona, text: landedWords(name, landed) })
    await matchNext(p)
  }

  /** In the chain: act on the run's task's done file, or fail a task whose turn ended 30 s ago without one. */
  async function check(p: Project, persona: string) {
    const r = await loadRecord(c.storage, p.id, persona)
    const run = r.run, task = run?.task
    if (!run || !task || launching.has(run.id)) return
    const name = nameOf(p, persona), files = c.filesOf(p), path = doneFilePath(files, task.id)
    try {
      const done = readDone(files, task.id)
      if (done.status === 'waiting') {
        if (task.endedAt !== undefined && c.now() - task.endedAt > 30_000) {
          throw new Error(`${name}'s ${task.role} agent finished without writing its done file.`)
        }
        return
      }
      if (done.status === 'bad') throw new Error(`The done file ${path} doesn't read.`)
      const out = done.output as Record<string, JsonValue>, rr = r as PersonaRecord & { run: ActiveRun }
      if (task.role === 'match') return await land(p, rr, matchesOf(out, path))
      if (out.ok === true && typeof out.results === 'string' && out.results) {
        // A relative path is from the QA worktree's root.
        const results = resolve(run.qa!.path, out.results), dir = join(run.qa!.path, readConfig(p.path).runsDir, run.id)
        if (!results.startsWith(dir + sep)) throw new Error(`The results file ${results} isn't in this run's folder.`)
        loadResults(results)
        if (run.app) halt(run.app.pid)
        rr.run = advance(advance(run, { type: 'appStopped' }), { type: 'results', path: results, at: c.now() })
        await saveRecord(c.storage, rr)
        c.post('changed', { project: p.id })
        return await matchNext(p)
      }
      if (out.ok === false) throw new Error(typeof out.error === 'string' && out.error ? out.error : `${name}'s ${task.role} agent couldn't finish.`)
      if (task.role === 'run' && readConfig(p.path).reviewPrompt) {
        return launch(p, persona, run, { id: `${run.id}-review`, role: 'review' }, await prompt(p, persona, run, 'review'))
      }
      throw new Error(`${name}'s ${task.role} finished without naming its results file.`)
    } catch (err) {
      await fail(p, persona, run.id, say(err))
    }
  }

  /** Outside the chain: the QA copy, the app and the run chat. Never rejects; a throw fails the run. */
  async function begin(p: Project, persona: string, run: ActiveRun, base: string) {
    const id = run.id
    let pid: number | undefined, chat: string | undefined
    const name = nameOf(p, persona)
    /** Serially: whether the run is still this one. */
    const still = () => c.serial(async () => (await current(p, persona, id)) !== null)
    const gone = async () => {
      if (pid !== undefined) await stopApp(pid)
      if (chat !== undefined) await stopChat(chat, name)
      c.log(`studio: ${persona}'s run ${id} was stopped while it was being prepared; dropped what it started`)
    }
    try {
      const config: Config = readConfig(p.path), tools = await c.tools(), here = inPlace(config)
      let qa: NonNullable<ActiveRun['qa']>
      if (here) {
        // In the owner's own checkout, as it is: nothing is made, reset or copied there.
        const ws = (await c.host.call('workspace.list')).workspaces.find((w) => w.path === p.path && (w.hostId ?? 'local') === 'local')
        if (!ws) throw new Error(`No workspace in Orca is ${p.name}'s checkout (${p.path}).`)
        qa = { path: p.path, branch: p.branch, workspaceId: ws.id }
      } else {
        const root = await tools.mainCheckout(p.path)
        if (!root) throw new Error(`${p.path} isn't a git repository.`)
        const slug = root === p.path ? `qa-${persona}` : `qa-${basename(p.path)}-${persona}`, branch = `studio/${slug}`
        let ws = await findWorkspace(c.host, tools, branch, root, 1)
        if (!ws) {
          await tools.createWorktree({ projectPath: p.path, name: slug, branch, base, setup: config.setup })
          ws = await findWorkspace(c.host, tools, branch, root, 10)
          if (!ws) throw new Error(`Orca made ${name}'s copy, ${branch}, but doesn't list it.`)
        }
        qa = { path: ws.path, branch, workspaceId: ws.id }
        if (!(await still())) return await gone()
        // A reset would wipe edits made in the copy, so it only clears what the last run left there once prepared.
        // New files survive a reset, and git diff leaves them out.
        const { files, print } = await tools.changes(qa.path)
        if (print && print !== (await loadRecord(c.storage, p.id, persona)).prepared) {
          throw new Error(`${name}'s copy (${qa.path}) has changes that aren't committed in ${files === 1 ? '1 file' : `${files} files`}. Commit or discard them there, then run again.`)
        }
        await tools.resetQa(qa.path, base)
      }
      if (!(await still())) return await gone()
      if (!config.runPrompt) {
        const missing = here ? [] : copyInto(p.path, qa.path, config.copy)
        if (missing.length) c.log(`studio: ${persona}'s copy is missing ${missing.join(', ')}`)
        // The owner's own checkout is already prepared, and a prepare like `npm ci` would pull files out from under their work.
        for (const cmd of here ? [] : config.prepare) {
          if (!(await still())) return await gone()
          const out = await c.runner('sh', ['-c', cmd], { cwd: qa.path, timeoutMs: 15 * 60_000 })
          if (out.code !== 0) throw new ToolError(cmd, out.stderr || out.stdout, out.code)
        }
        // What preparing left in the copy (a rewritten lockfile, say) is the next run's to reset, even if this one fails.
        if (!here) {
          const { print } = await tools.changes(qa.path)
          if (!(await write(p, persona, id, (r) => { r.prepared = print }))) return await gone()
        }
        if (!config.start) throw new Error(NO_START)
        if (!(await still())) return await gone()
        const dir = join(c.filesOf(p), 'runs', id)
        mkdirSync(dir, { recursive: true })
        pid = startApp({ cwd: qa.path, command: config.start, port: run.port, log: join(dir, 'app.log') })
        const started = pid
        if (!(await write(p, persona, id, (r) => { r.run.app = { pid: started } }))) return await gone()
        await waitForUrl(config.url.split('{port}').join(String(run.port)), 120_000, pid)
      }
      // Again once the app is up, for what it writes as it starts, and for a run prompt that starts the app itself.
      const prepared = here ? undefined : (await tools.changes(qa.path)).print
      const pointer = await c.serial(async () => {
        const r = await current(p, persona, id)
        if (!r) return null
        if (prepared !== undefined) r.prepared = prepared
        r.run = advance(r.run!, { type: 'prepared', qa, ...(pid !== undefined && { app: { pid } }) })
        await saveRecord(c.storage, r)
        return prompt(p, persona, r.run, 'run')
      })
      if (pointer === null) return await gone()
      chat = (await tools.launchChat({ agent: await c.agent(), worktreePath: qa.path, prompt: pointer })).session
      await tools.renameChat(chat, `${name}'s run`).catch((err) => c.log(`studio: naming ${name}'s run chat: ${say(err)}`))
      const session = chat
      if (!(await write(p, persona, id, (r) => { r.run = advance(r.run, { type: 'launched', task: { id: `${id}-run`, role: 'run', chat: session } }) }))) {
        return await gone()
      }
    } catch (err) {
      // The app is stopped even when its pid never reached storage.
      if (pid !== undefined) await stopApp(pid)
      await c.serial(() => fail(p, persona, id, say(err))).catch((e) => c.log(`studio: failing ${persona}'s run: ${say(e)}`))
    } finally {
      beginning.delete(`${p.id}:${persona}`)
    }
  }

  return {
    /** The ports of every active run, in every project. */
    ports: async () => (await active()).map((x) => x.run!.port),
    start: (p: Project, persona: string, focus?: string) => c.serial(async () => {
      let config: Config
      try {
        config = readConfig(p.path)
      } catch (err) {
        throw invalid(say(err))
      }
      const sheet = listPersonas(p.path, config).find((s) => s.id === persona)
      if (!sheet) throw invalid(`There's no persona "${persona}" in ${p.name}.`)
      const r = await loadRecord(c.storage, p.id, persona)
      if (r.run) throw invalid(`${sheet.name} is already running.`)
      // A stopped run's preparing may still be at work in the same QA copy.
      if (beginning.has(`${p.id}:${persona}`)) throw invalid(`${sheet.name}'s last run is still stopping. Try again in a moment.`)
      if (!config.start && !config.runPrompt) throw invalid(NO_START)
      // In its own copy, a run starts from the branch the checkout is on now. In the checkout itself, nothing is reset.
      const base = inPlace(config) ? p.branch : await branchNow(await c.tools(), p)
      const runs = await active()
      const other = runs.find((x) => x.project === p.id)
      if (other && inPlace(config)) throw invalid(`Runs use ${p.name}'s own checkout, so personas take turns. ${nameOf(p, other.persona)} is running.`)
      if (other && config.runPrompt && !promptOf(p.path, 'runPrompt', config.runPrompt).includes('{port}')) {
        throw invalid(`${p.name}'s run prompt doesn't use {port}, so its personas run one at a time. ${nameOf(p, other.persona)} is running.`)
      }
      const at = c.now()
      const run: ActiveRun = { id: `${persona}-${at.toString(36)}`, stage: 'preparing', at, seed: 1 + Math.floor(Math.random() * (2 ** 31 - 1)),
        port: await freePort(config.port, runs.map((x) => x.run!.port)), ...(focus && { focus }), recheck: recheckOf(await c.findingsOf(p), persona) }
      r.run = run
      delete r.error
      await saveRecord(c.storage, r)
      c.post('changed', { project: p.id })
      beginning.add(`${p.id}:${persona}`)
      void begin(p, persona, run, base)
    }),

    /** Drops the run at once; the chat is told and the next match starts after the request has answered. */
    stop: async (p: Project, persona: string) => {
      const run = await c.serial(async () => {
        const r = await loadRecord(c.storage, p.id, persona), was = r.run
        if (!was) return null
        if (was.app) halt(was.app.pid)
        delete r.run
        await saveRecord(c.storage, r)
        c.post('changed', { project: p.id })
        return was
      })
      if (!run) return
      void (async () => {
        if (run.task) await stopChat(run.task.chat, nameOf(p, persona))
        await c.serial(() => matchNext(p))
      })().catch((err) => c.log(`studio: after stopping ${persona}'s run: ${say(err)}`))
    },

    /** Orca says a chat's turn ended: note when, and read its done file now. */
    ended: (paneKey: string) => c.serial(async () => {
      const projects = await loadProjects(c.storage)
      for (const r of await active()) {
        const task = r.run!.task, p = projects.find((x) => x.id === r.project)
        if (!p || !task || !paneKey.startsWith(`structured-agent-session-${task.chat}:`)) continue
        r.run = advance(r.run!, { type: 'ended', chat: task.chat, at: c.now() })
        await saveRecord(c.storage, r)
        await check(p, r.persona)
      }
    }),

    /** On the tick: done files, turns that ended without one, the next match, and a changed newest line. */
    async watch() {
      const projects = await loadProjects(c.storage), recs = await active()
      for (const p of projects.filter((x) => recs.some((r) => r.project === x.id))) {
        for (const r of recs.filter((x) => x.project === p.id)) {
          await check(p, r.persona)
          const line = progressLines(c.filesOf(p), r.run!.id, 1)?.lines[0]
          if (line !== undefined && lines.get(r.run!.id) !== line) {
            lines.set(r.run!.id, line)
            c.post('changed', { project: p.id })
          }
        }
        await matchNext(p)
      }
    },

    /** Once on activate: a run whose preparing died with the old worker, or whose app died with it, fails. */
    async recover() {
      const projects = await loadProjects(c.storage)
      for (const r of await active()) {
        const p = projects.find((x) => x.id === r.project), run = r.run!
        if (!p) continue
        if (run.stage === 'preparing') await fail(p, r.persona, run.id, `Persona Studio restarted while preparing ${nameOf(p, r.persona)}'s run. Run it again.`)
        else if (run.stage === 'using' && run.app && !alive(run.app.pid)) await fail(p, r.persona, run.id, `${nameOf(p, r.persona)}'s app stopped during the run.`)
      }
      // A turn that ended while no worker was listening sends no `done`: a chat Orca no longer lists, or lists as done,
      // counts as ended now, so the check reads its done file or fails it after 30 s. Outside the chain.
      const open = (await active()).filter((r) => r.run!.task && r.run!.task.endedAt === undefined && r.run!.qa)
      void (async () => {
        for (const r of open) {
          const run = r.run!, task = run.task!, p = projects.find((x) => x.id === r.project)
          if (!p) continue
          try {
            const chat = (await (await c.tools()).chats(run.qa!.path)).find((x) => x.session === task.chat)
            if (chat && chat.state !== 'done') continue
            await write(p, r.persona, run.id, (x) => { x.run = advance(x.run, { type: 'ended', chat: task.chat, at: c.now() }) })
          } catch (err) {
            c.log(`studio: looking for ${r.persona}'s chat: ${say(err)}`)
          }
        }
      })()
    },
  }
}
