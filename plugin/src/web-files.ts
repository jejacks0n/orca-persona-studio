import { readFileSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import type { WebResponse } from './web-server'

const IMPORT = /(?:from|import)\s*['"]\.\/([A-Za-z0-9_-]+)['"]/g
const MODULE = /^\/src\/([A-Za-z0-9_-]+)\.js$/

// Orca's theme variables, which the tab's styles use and a plain browser lacks: the phone mockup's palette
// (docs/mockups/studio-phone.html). web.ts sets html.dark, which the tab's styles follow as they do in Orca.
const v = (bg: string, fg: string, panel: string, soft: string, dim: string, line: string, strong: string, onStrong: string, hover: string, red: string, focus: string) =>
  `--orca-background: ${bg}; --orca-foreground: ${fg}; --orca-card: ${panel}; --orca-card-foreground: ${fg}; --orca-muted: ${soft};
    --orca-muted-foreground: ${dim}; --orca-border: ${line}; --orca-input: ${line}; --orca-primary: ${strong}; --orca-primary-foreground: ${onStrong};
    --orca-accent: ${hover}; --orca-accent-foreground: ${fg}; --orca-secondary: ${soft}; --orca-secondary-foreground: ${fg}; --orca-destructive: ${red};
    --orca-ring: ${focus};`
export const THEME = `
  :root { color-scheme: light dark; --orca-radius: 10px;
    ${v('#ffffff', '#18181b', '#ffffff', '#f4f4f5', '#6b6b76', '#e4e4e7', '#18181b', '#fafafa', '#ececef', '#c81e1e', '#2563eb')} }
  @media (prefers-color-scheme: dark) { :root {
    ${v('#0b0b0c', '#f4f4f5', '#131315', '#1d1d20', '#a1a1aa', '#2a2a2e', '#f4f4f5', '#18181b', '#27272b', '#f87171', '#7aa7ff')} } }
  body { font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--orca-background); color: var(--orca-foreground); }
`

/**
 * Serves the page shell at / and the modules web.ts reaches through './x' imports
 * at /src/<name>.js, types stripped. Nothing else is served, and no path is built from a request.
 */
export function webFiles(srcDir: string, styles: string): (path: string) => WebResponse | null {
  const cache = new Map<string, { mtime: number; js: string; deps: string[] }>()

  // One module's stripped code and sibling imports, kept until its mtime changes. Null if it can't be read.
  const load = (name: string) => {
    try {
      const file = join(srcDir, `${name}.ts`)
      const mtime = statSync(file).mtimeMs
      let hit = cache.get(name)
      if (!hit || hit.mtime !== mtime) {
        const code = readFileSync(file, 'utf8')
        hit = { mtime, js: stripTypeScriptTypes(code), deps: [...code.matchAll(IMPORT)].map((m) => m[1]) }
        cache.set(name, hit)
      }
      return hit
    } catch { return null }
  }

  // ponytail: rescans from web.ts on every request; the file set is small.
  const reachable = (): Set<string> => {
    const seen = new Set<string>()
    const walk = (name: string) => {
      if (seen.has(name)) return
      const m = load(name)
      if (!m) return
      seen.add(name)
      m.deps.forEach(walk)
    }
    walk('web')
    return seen
  }

  const shell = (): WebResponse => {
    const imports = Object.fromEntries([...reachable()].map((n) => [`/src/${n}`, `/src/${n}.js`]))
    const map = JSON.stringify({ imports }).replace(/</g, '\\u003c')
    const body = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persona Studio</title>
<link rel="icon" href="data:,">
<style>${styles}</style>
<style>${THEME}</style>
<script type="importmap">${map}</script>
</head><body>
<script type="module" src="/src/web.js"></script>
</body></html>
`
    return { status: 200, type: 'text/html; charset=utf-8', body }
  }

  return (path) => {
    const p = path.split('?')[0]
    if (p === '/') return shell()
    const name = MODULE.exec(p)?.[1]
    if (!name || !reachable().has(name)) return null
    const m = load(name)
    return m ? { status: 200, type: 'text/javascript; charset=utf-8', body: m.js } : null
  }
}
