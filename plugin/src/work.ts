// The pure pieces of Start work: the worktree name, and what watching a branch decides.
import type { Action } from './finding'
import type { Finding, Work } from './model'

// The mockup's stop words, and "on", which the spec's example drops.
const STOP = new Set(['the', 'on', 'and', 'with', 'not', 'its', 'had', 'has', 'instead', 'does', 'doesn', 'that', 'then', 'under', 'from', 'one', 'only', 'which', 'though', 'says'])
/** A short worktree and branch name from a finding's title. */
export const slugOf = (title: string): string =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter((w) => w.length > 1 && !STOP.has(w)).slice(0, 4).join('-') || 'work'
export const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

/** What one look at an Working finding's branch found: its newest PR, whether it merged (by git), and whether its worktree is gone. */
export interface Seen { pr: NonNullable<Work['pr']> | null | undefined; merged: boolean; gone: boolean }

/** The change a look calls for, or null. Merged wins over gone: a merged branch's worktree is usually removed. */
export function watchWork(f: Finding, s: Seen): Action | null {
  if (!f.work) return null
  if (s.pr?.state === 'merged') return { type: 'merged', id: f.id, pr: s.pr }
  if (s.merged) return { type: 'merged', id: f.id }
  if (s.pr?.state === 'closed') return { type: 'unwork', id: f.id, why: `PR #${s.pr.number} closed without merging` }
  if (s.gone) return { type: 'unwork', id: f.id, why: 'The worktree was removed with nothing merged' }
  const was = f.work.pr
  if (s.pr && (was?.number !== s.pr.number || was.state !== s.pr.state)) return { type: 'pr', id: f.id, pr: s.pr }
  return null
}
