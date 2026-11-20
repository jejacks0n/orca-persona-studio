import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JsonValue } from 'orca'

/** Where a task's agent writes its done file. `dir` is the project's files folder (`filesOf(p)`), never the checkout. */
export const doneFilePath = (dir: string, taskId: string): string => join(dir, 'tasks', `${taskId}.json`)

/** Where a run's agents add a line each time they start something new; the panel shows the newest. */
export const progressFilePath = (dir: string, runId: string): string => join(dir, 'progress', `${runId}.log`)

/** The paragraph every run, review and match prompt ends with. Makes the progress folder for the agent. */
export function progressNote(dir: string, runId: string): string {
  const path = progressFilePath(dir, runId)
  mkdirSync(dirname(path), { recursive: true })
  return `As you work, add one short line to \`${path}\` whenever you start something new (for example \`Step 7 of 31: Export my .ans\`, `
    + 'or `Reproducing F8`). While you follow a script, begin each step\'s line with `Step <n> of <total>:`, counting its numbered steps. '
    + 'Add lines; never rewrite the file. Persona Studio shows the newest line to the owner.'
}

/** The last `n` non-empty lines of the run's progress file and when the file last changed. Reads only the last 4 KB. */
export function progressLines(dir: string, runId: string, n = 5): { lines: string[]; at: number } | undefined {
  let fd: number | undefined
  try {
    fd = openSync(progressFilePath(dir, runId), 'r')
    const { size, mtimeMs } = fstatSync(fd), tail = new Uint8Array(Math.min(size, 4096))
    readSync(fd, tail, 0, tail.length, size - tail.length)
    const lines = new TextDecoder().decode(tail).split('\n').map((l) => l.trim()).filter(Boolean).slice(-n)
    return lines.length ? { lines, at: Math.floor(mtimeMs) } : undefined
  } catch {
    // No file yet, most often.
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** The task's done file: not there yet, there but not a JSON object (perhaps half written), or done. */
export function readDone(dir: string, taskId: string): { status: 'waiting' } | { status: 'done'; output: JsonValue } | { status: 'bad' } {
  let text: string
  try {
    text = readFileSync(doneFilePath(dir, taskId), 'utf8')
  } catch (e) {
    // Reading without checking first means a file that vanishes mid-check is still just not there yet.
    return (e as { code?: string }).code === 'ENOENT' ? { status: 'waiting' } : { status: 'bad' }
  }
  try {
    const output = JSON.parse(text) as JsonValue
    if (output === null || typeof output !== 'object' || Array.isArray(output)) return { status: 'bad' }
    return { status: 'done', output }
  } catch {
    return { status: 'bad' }
  }
}

/** Orca refuses a launch prompt or terminal text over 4,096 characters, so the text goes in
 * `<dir>/prompts/<name>.md` and the agent gets a short pointer to it. */
export function promptFile(dir: string, name: string, text: string): string {
  const path = join(dir, 'prompts', `${name}.md`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return `Read \`${path}\` and follow it exactly.`
}
