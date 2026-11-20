// Which Orca worktree the owner's window is showing. Orca's focus (workspace.changed's context)
// names it by workspaceId, or on older Orcas only loosely, so this matches it against the workspace list.
import { basename } from 'node:path'
import type { PluginEvents } from 'orca'
import type { HostApi } from 'orca/host'
import type { Tools } from './tools'

export type Focused = { kind: 'none' } | { kind: 'notGit'; name: string } | { kind: 'git'; name: string; path: string; branch: string }
type Context = PluginEvents['workspace.changed']['context']

/** A worktree's name and id stem, from its repo folder: the main checkout is just the repo. Null outside git. */
export async function worktreeOf(tools: Tools, ws: { name: string; path: string }) {
  const root = await tools.mainCheckout(ws.path)
  if (root === null) return null
  const repo = basename(root), main = root === ws.path
  return { root, main, name: main ? repo : `${repo} · ${ws.name}`, id: main ? repo : `${repo}-${basename(ws.path)}` }
}

/** Which worktree Orca's window shows: by unique name and branch, then by a terminal's handle or pty, then the most recently active. */
export function makeFocus(deps: { host: HostApi<'worker'>; tools: () => Promise<Tools>; log: (line: string) => void }):
  { set(context: unknown): void; resolve(): Promise<Focused> } {
  const { host, log } = deps
  /** What workspace.changed said last. */
  let context: Context | undefined
  let saidTerminals = false

  /** The focused workspace: by Orca's workspaceId when it names a listed one, else by name and branch (plus its
   *  terminals' ids), which several can share. */
  async function focusedWorkspace(c: NonNullable<Context>, tools: Tools) {
    const all = (await host.call('workspace.list')).workspaces
    const byId = c.workspaceId === undefined ? undefined : all.find((w) => w.id === c.workspaceId)
    if (byId) return (byId.hostId ?? 'local') === 'local' ? byId : undefined
    const local = all.filter((w) => (w.hostId ?? 'local') === 'local')
    const matches = local.filter((w) => w.name === c.displayName && w.branch === c.branch)
    if (matches.length < 2) {
      if (!matches.length) log(`studio: no local workspace is "${c.displayName}" on ${c.branch} (${local.length} local)`)
      return matches[0]
    }
    // Which id Orca's focus gives a terminal isn't documented, so a handle and a pty id both count.
    const ids = (c.terminals ?? []).map((t) => t.id)
    if (ids.length) {
      const t = (await tools.terminals()).find((x) => ids.includes(x.handle) || ids.includes(x.ptyId))
      const ws = t && matches.find((w) => w.path === t.worktreePath)
      if (ws) return ws
      if (!saidTerminals) log(`studio: no terminal in orca terminal list has the focused ids ${ids.join(', ')}`)
      saidTerminals = true
    }
    // ponytail: a guess, the most recently active match, for an Orca whose focus doesn't name a workspaceId we can find.
    const active = new Map((await tools.worktrees()).map((x) => [x.path, x.lastActivityAt]))
    return matches.reduce((a, b) => ((active.get(b.path) ?? 0) > (active.get(a.path) ?? 0) ? b : a))
  }

  return {
    set(c) { context = c as Context },
    async resolve() {
      // Only this copy for the whole call: an event may set a new context while it waits.
      const c = context
      if (!c) return { kind: 'none' }
      const tools = await deps.tools()
      const ws = await focusedWorkspace(c, tools)
      if (!ws) return { kind: 'none' }
      const wt = await worktreeOf(tools, ws)
      if (!wt) return { kind: 'notGit', name: basename(ws.path) }
      return { kind: 'git', name: wt.name, path: ws.path, branch: c.branch }
    }
  }
}
