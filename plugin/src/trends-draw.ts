// Draws one goal's trend as an SVG string, without the goal's text (the page shows it). Pure: a page only sets it into place.
export interface Trend { text: string; target: number; better: 'lower' | 'higher'; unit?: string
  points: { runId: string; loop: number; value: number; input?: string }[] }

const entity: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Text made safe to put in HTML or SVG, attributes included. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => entity[c])
const colors = ['var(--orca-primary)', '#d97706', '#0d9488', '#9333ea', '#dc2626']
const pad = { l: 34, r: 10, t: 34, b: 22 }

export function drawTrend(goal: Trend, size: { w: number; h: number }): string {
  const { w, h } = size
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><title>${esc(goal.text)}</title>`
  if (goal.points.length === 0) {
    return `${open}<text x="${pad.l}" y="${h / 2}" font-size="12" fill="var(--orca-muted-foreground)">No runs yet</text></svg>`
  }
  const loops = goal.points.map((p) => p.loop)
  const [x0, x1] = [Math.min(...loops), Math.max(...loops)]
  const vals = [goal.target, ...goal.points.map((p) => p.value)]
  const [y0, y1] = [Math.min(...vals), Math.max(...vals)]
  const x = (l: number) => (x1 === x0 ? (pad.l + w - pad.r) / 2 : pad.l + ((l - x0) / (x1 - x0)) * (w - pad.l - pad.r))
  const y = (v: number) => (y1 === y0 ? (pad.t + h - pad.b) / 2 : h - pad.b - ((v - y0) / (y1 - y0)) * (h - pad.t - pad.b))
  const n = (v: number) => Math.round(v * 10) / 10

  const names = [...new Set(goal.points.map((p) => p.input ?? ''))]
  const lines = names.map((name, i) => {
    const mine = goal.points.filter((p) => (p.input ?? '') === name)
    const color = colors[i % colors.length]
    const dots = mine.map((p) => `<circle cx="${n(x(p.loop))}" cy="${n(y(p.value))}" r="3" fill="${color}"/>`).join('')
    const label = name === '' ? '' : `<text x="${w - pad.r}" y="${14 + i * 12}" font-size="10" text-anchor="end" fill="${color}">${esc(name)}</text>`
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${mine.map((p) => `${n(x(p.loop))},${n(y(p.value))}`).join(' ')}"/>${dots}${label}`
  }).join('')
  const last = goal.points[goal.points.length - 1]
  const newest = `<text x="${n(x(last.loop))}" y="${n(y(last.value) - 7)}" font-size="11" font-weight="600" text-anchor="middle" fill="var(--orca-foreground)">${n(last.value)}</text>`
  const ticks = [...new Set(loops)].sort((a, b) => a - b)
    .map((l) => `<text x="${n(x(l))}" y="${h - 6}" font-size="10" text-anchor="middle" fill="var(--orca-muted-foreground)">${l}</text>`).join('')
    + `<text x="${pad.l - 4}" y="${h - 6}" font-size="10" text-anchor="end" fill="var(--orca-muted-foreground)">run</text>`
  const ty = n(y(goal.target))
  return open
    + `<path d="M${pad.l} ${pad.t}V${h - pad.b}H${w - pad.r}" fill="none" stroke="var(--orca-border)"/>`
    + `<line x1="${pad.l}" y1="${ty}" x2="${w - pad.r}" y2="${ty}" stroke="var(--orca-muted-foreground)" stroke-dasharray="4 3"/>`
    + `<text x="${pad.l + 4}" y="${n(ty - 4)}" font-size="10" fill="var(--orca-muted-foreground)">target ${goal.target}</text>`
    + `${lines}${newest}${ticks}</svg>`
}
