import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Finding } from './model'

/** A finding's files (its brief and notes) under `dir`, the project's folder outside its checkout. */
export const findingDir = (dir: string, id: string): string => join(dir, 'findings', id)
const notesPath = (dir: string, id: string) => join(findingDir(dir, id), 'notes.md')
const mtimeOf = (path: string) => (existsSync(path) ? statSync(path).mtimeMs : 0)

/** The brief agents read; rewritten whole each time so it always matches the finding. */
export function writeBrief(dir: string, f: Finding, names: Record<string, string>): string {
  const reports = f.reports.map((r) => [
    `## ${names[r.persona] ?? r.persona}, ${new Date(r.at).toISOString()}`, '',
    r.saw, '',
    ...(r.steps.length ? ['Steps:', ...r.steps.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    ...(r.shots.length ? ['Screenshots:', ...r.shots.map((s) => `- ${s}`), ''] : []),
  ].join('\n'))
  const text = [`# ${f.title}`, '', `Kind: ${f.kind}`, `Severity: ${f.severity}`, `State: ${f.state}`, '', ...reports].join('\n')
  mkdirSync(findingDir(dir, f.id), { recursive: true })
  const path = join(findingDir(dir, f.id), 'finding.md')
  writeFileSync(path, text)
  return path
}

export function readNotes(dir: string, id: string): { text: string; mtime: number } {
  const path = notesPath(dir, id)
  return existsSync(path) ? { text: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs } : { text: '', mtime: 0 }
}

/** An agent may edit notes.md too, so a write is refused unless the file is still as the writer last saw it. */
export function writeNotes(dir: string, id: string, text: string, base: number): { mtime: number } {
  const path = notesPath(dir, id)
  if (mtimeOf(path) !== base) {
    throw Object.assign(new Error('The notes changed while you were typing. Copy your text, then reload them.'), { code: 'conflict' })
  }
  mkdirSync(findingDir(dir, id), { recursive: true })
  writeFileSync(path, text)
  return { mtime: statSync(path).mtimeMs }
}

export const notesChangedSince = (dir: string, ids: readonly string[], since: number): string[] =>
  ids.filter((id) => mtimeOf(notesPath(dir, id)) > since)

export function mergeNotes(dir: string, lead: string, others: readonly { id: string; title: string }[]): void {
  const parts = others.map((o) => ({ title: o.title, text: readNotes(dir, o.id).text.trim() })).filter((p) => p.text)
  if (!parts.length) return
  const mine = readNotes(dir, lead).text.trim()
  const text = [...(mine ? [mine] : []), ...parts.map((p) => `From ${p.title}:\n${p.text}`)].join('\n\n') + '\n'
  mkdirSync(findingDir(dir, lead), { recursive: true })
  writeFileSync(notesPath(dir, lead), text)
}
