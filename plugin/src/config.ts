import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface Config { personas: string; runsDir: string; resultsFile: string; setup: 'run' | 'skip' | 'inherit'; port: number
  repo?: string; start?: string; url: string; prepare: string[]; copy: string[]; runPrompt?: string; reviewPrompt?: string; builderBrief?: string }

/** The project's config, committed at its root. It's also the file that opens the Persona Studio tab. */
export const CONFIG_FILE = 'persona.studio'
const PROMPTS = ['runPrompt', 'reviewPrompt', 'builderBrief'] as const

const defaults: Config = { personas: 'docs/personas', runsDir: 'qa-runs', resultsFile: 'results.json', setup: 'run', port: 4210,
  url: 'http://localhost:{port}', prepare: [], copy: [] }
const setups = ['run', 'skip', 'inherit']
const bad = (key: string, what: string) => new Error(`${CONFIG_FILE}: "${key}" must be ${what}`)

/** Every field optional. `undefined` (no file) gives the defaults. A wrong type is refused, naming the field. */
export function parseConfig(json: unknown): Config {
  if (json === undefined) return structuredClone(defaults)
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`${CONFIG_FILE} must be an object`)
  const raw = json as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, dflt] of Object.entries(defaults)) {
    const v = raw[key] ?? dflt
    if (typeof dflt === 'number' ? typeof v !== 'number' || !Number.isFinite(v) : Array.isArray(dflt) ? !Array.isArray(v) || v.some((x) => typeof x !== 'string') : typeof v !== 'string' || v === '') {
      throw bad(key, typeof dflt === 'number' ? 'a number' : Array.isArray(dflt) ? 'a list of strings' : 'a string')
    }
    out[key] = v
  }
  for (const key of ['repo', 'start', ...PROMPTS]) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string' || raw[key] === '') throw bad(key, 'a non-empty string')
    out[key] = raw[key]
  }
  if (!setups.includes(out.setup as string)) throw new Error(`${CONFIG_FILE}: "setup" must be one of ${setups.join(', ')}`)
  return out as unknown as Config
}

/** A prompt field's text. One line ending in .md is a file in the project, read now; anything else is the prompt itself. */
export function promptOf(projectPath: string, key: typeof PROMPTS[number], value: string): string {
  if (value.includes('\n') || !value.trim().endsWith('.md')) return value
  const path = value.trim(), file = resolve(projectPath, path), rel = relative(projectPath, file)
  if (rel.startsWith('..') || resolve(rel) === rel) throw new Error(`${CONFIG_FILE}: "${key}" must name a file inside the project`)
  if (!existsSync(file)) throw new Error(`${CONFIG_FILE}: "${key}" names ${path}, which isn't there`)
  return readFileSync(file, 'utf8')
}

/** Reads <path>/persona.studio from the working copy; missing or blank is the defaults; a broken one, or a prompt file
 *  that isn't there, throws with the path. */
export function readConfig(projectPath: string): Config {
  const file = join(projectPath, CONFIG_FILE)
  if (!existsSync(file)) return parseConfig(undefined)
  try {
    const text = readFileSync(file, 'utf8')
    const config = parseConfig(text.trim() === '' ? undefined : JSON.parse(text))
    for (const key of PROMPTS) if (config[key] !== undefined) promptOf(projectPath, key, config[key])
    return config
  } catch (err) {
    throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** A persona's portrait: the .svg beside its file (`dex.md`, `dex.svg`), as a data URL. The tab draws it as an <img>,
 *  where nothing in an SVG runs. None, or one over 64 KB, is no portrait. */
export function portraitOf(sheetPath: string): string | undefined {
  const path = sheetPath.replace(/\.md$/, '.svg')
  try {
    return statSync(path).size <= 64 * 1024 ? `data:image/svg+xml;base64,${readFileSync(path, 'base64')}` : undefined
  } catch {
    return undefined
  }
}

/** The persona files in the personas folder, minus files starting with _, sorted by id. A heading `# Name: tag` gives both. */
export function listPersonas(projectPath: string, config: Config): { id: string; name: string; tag: string; sheetPath: string }[] {
  const dir = join(projectPath, config.personas)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const id = f.slice(0, -3)
      const sheetPath = join(dir, f)
      const heading = /^# +(.+?)\s*$/m.exec(readFileSync(sheetPath, 'utf8'))?.[1] ?? id
      const colon = heading.indexOf(':')
      return { id, name: colon < 0 ? heading : heading.slice(0, colon).trim(), tag: colon < 0 ? '' : heading.slice(colon + 1).trim(), sheetPath }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
