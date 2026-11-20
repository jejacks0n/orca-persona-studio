// Shared by tests only: the file name keeps `orca plugin test` (which runs *.test.ts(x)) from running it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { JsonValue } from 'orca'

/** An in-memory stand-in for orca.storage. Clones on set and get, as real storage does. */
export function memStorage() {
  const map = new Map<string, JsonValue>()
  return {
    map,
    async get(key: string): Promise<JsonValue | null> { return map.has(key) ? structuredClone(map.get(key)!) : null },
    async set(key: string, value: JsonValue): Promise<void> { map.set(key, structuredClone(value)) }
  }
}

/** A path under plugin/fixtures. */
export const fixture = (rel: string): string => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url))
export const read = (path: string): string => readFileSync(path, 'utf8')
export const readJson = (path: string): unknown => JSON.parse(read(path))

/** Waits for `cond` to hold, checking every 20 ms; fails naming `what` after 5 s. */
export async function until(cond: () => unknown | Promise<unknown>, what: string): Promise<void> {
  const end = Date.now() + 5000
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`Timed out after 5 s waiting for ${what}.`)
    await new Promise((r) => setTimeout(r, 20))
  }
}
