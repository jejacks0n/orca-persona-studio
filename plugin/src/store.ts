import type { JsonValue } from 'orca'
import type { PersonaRecord, ProjectFindings } from './model'
import type { Project } from './types'

/** The part of storage this module uses; both `orca.storage` and `memStorage()` fit it. */
type KV = { get(key: string): Promise<JsonValue | null>; set(key: string, value: JsonValue): Promise<void> }

export async function loadProjects(storage: KV): Promise<Project[]> {
  return ((await storage.get('projects')) as unknown as Project[] | null) ?? []
}

export async function saveProjects(storage: KV, projects: Project[]): Promise<void> {
  await storage.set('projects', projects as unknown as JsonValue)
}

export const findingsKey = (project: string) => `findings:${project}`
/** The hash of what a run runs (config.ts runsWhat) that the owner last approved for the project. */
export const approvalKey = (project: string) => `approval:${project}`
export const recordKey = (project: string, persona: string) => `record:${project}:${persona}`

/** Null when never stored. */
export async function loadFindings(storage: KV, project: string): Promise<ProjectFindings | null> {
  return (await storage.get(findingsKey(project))) as unknown as ProjectFindings | null
}

export async function saveFindings(storage: KV, pf: ProjectFindings): Promise<void> {
  // Through JSON, so an undefined field never reaches storage.
  await storage.set(findingsKey(pf.project), JSON.parse(JSON.stringify(pf)) as JsonValue)
}

export async function loadRecord(storage: KV, project: string, persona: string): Promise<PersonaRecord> {
  const stored = await storage.get(recordKey(project, persona))
  return (stored as unknown as PersonaRecord | null) ?? { v: 2, project, persona, runs: [] }
}

export async function saveRecord(storage: KV, r: PersonaRecord): Promise<void> {
  await storage.set(recordKey(r.project, r.persona), JSON.parse(JSON.stringify(r)) as JsonValue)
}
