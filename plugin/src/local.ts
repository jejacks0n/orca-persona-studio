import { existsSync } from 'node:fs'
import type { Tools } from './tools'

/** 'owner/name' from `git remote get-url origin` (https or ssh form), or null when there is no GitHub origin. */
export async function repoOf(tools: Tools, projectPath: string): Promise<string | null> {
  const url = await tools.remoteUrl(projectPath)
  return url?.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] ?? null
}

/** The override when set, else the first candidate that exists; null when none does. */
export function findTool(override: string, candidates: readonly string[], exists: (p: string) => boolean = existsSync): string | null {
  return override || candidates.find(exists) || null
}

export const CANDIDATES: Record<'orca' | 'gh' | 'git', readonly string[]> = {
  orca: ['/Applications/Orca.app/Contents/Resources/bin/orca', '/usr/local/bin/orca', '/opt/homebrew/bin/orca'],
  gh: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'],
  git: ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'],
}
