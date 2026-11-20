import { assert, test } from 'orca/testing'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME, webFiles } from './web-files'

function src(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-files-'))
  writeFileSync(join(dir, 'web.ts'), `import { a } from './a'\nimport 'orca'\nexport const w = a\n`)
  writeFileSync(join(dir, 'a.ts'), `import type { T } from './b'\nexport const a: string = 'x'\n`)
  writeFileSync(join(dir, 'b.ts'), `export type T = number\n`)
  writeFileSync(join(dir, 'worker.ts'), `export const w = 1\n`)
  return dir
}

test('the shell has the styles, an import map for every reachable module, and loads web.js', () => {
  const r = webFiles(src(), 'body{color:red}')('/')
  assert.ok(r)
  assert.equal(r.status, 200)
  assert.equal(r.type, 'text/html; charset=utf-8')
  assert.ok(r.body.includes('<style>body{color:red}</style>'))
  assert.ok(r.body.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'))
  assert.ok(r.body.includes('<title>Persona Studio</title>'))
  for (const n of ['web', 'a', 'b']) assert.ok(r.body.includes(`"/src/${n}":"/src/${n}.js"`))
  assert.ok(!r.body.includes('/src/worker'))
  assert.ok(r.body.includes('<script type="module" src="/src/web.js"></script>'))
  // Orca's theme, which a plain browser lacks, after the styles; and no /favicon.ico to miss.
  assert.ok(r.body.indexOf(`<style>${THEME}</style>`) > r.body.indexOf('<style>body{color:red}</style>'))
  for (const name of ['background', 'foreground', 'border', 'primary', 'card', 'radius']) assert.ok(THEME.includes(`--orca-${name}:`), name)
  assert.ok(r.body.includes('<link rel="icon" href="data:,">'))
})

test('a reachable module is served with its types stripped', () => {
  const r = webFiles(src(), '')('/src/a.js')
  assert.ok(r)
  assert.equal(r.type, 'text/javascript; charset=utf-8')
  assert.ok(!r.body.includes(': string'))
  assert.ok(r.body.includes("'x'"))
})

test("a module web.ts can't reach, and a path outside src, are not served", () => {
  const f = webFiles(src(), '')
  for (const p of ['/src/worker.js', '/src/../x.js', '/src/a.ts', '/src/%2e%2e/x.js', 'http://localhost/src/a.js', '/nope']) assert.equal(f(p), null)
  assert.ok(f('/src/a.js?v=1'))
})

test('a changed file is served fresh, and without web.ts only the shell answers', () => {
  const dir = src()
  const f = webFiles(dir, '')
  assert.equal(f('/src/b.js')?.body.trim(), '')
  writeFileSync(join(dir, 'b.ts'), `export const b = 2\n`)
  utimesSync(join(dir, 'b.ts'), Date.now() / 1000 + 5, Date.now() / 1000 + 5)
  assert.ok(f('/src/b.js')?.body.includes('const b = 2'))
  writeFileSync(join(dir, 'web.ts'), `import { a } from './a'\nimport { c } from './c'\n`)
  writeFileSync(join(dir, 'c.ts'), `export const c = 3\n`)
  assert.ok(f('/src/c.js'))
  const empty = webFiles(mkdtempSync(join(tmpdir(), 'web-files-')), '')
  assert.ok(empty('/'))
  assert.equal(empty('/src/web.js'), null)
})

test("the real src serves every module in the shell's import map, web.js among them, with no TypeScript left", () => {
  const f = webFiles(fileURLToPath(new URL('.', import.meta.url)), '')
  const map = /<script type="importmap">(.*?)<\/script>/.exec(f('/')!.body)![1]
  const urls = Object.values(JSON.parse(map).imports as Record<string, string>)
  assert.ok(urls.includes('/src/web.js'))
  assert.ok(urls.length > 5)
  for (const url of urls) {
    // Null would mean the file is missing or stripTypeScriptTypes threw on it.
    const js = f(url)?.body
    assert.ok(js, url)
    assert.ok(!/^\s*(?:export\s+)?(?:type|interface)\s|import\s+type\s|\bas\s+const\b/m.test(js), url)
  }
})
