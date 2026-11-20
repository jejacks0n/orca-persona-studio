import type { Goal, Metric } from './types'

export interface Sheet { who: string[]; goals: Goal[] }

const metrics = ['keys', 'clicks', 'taps', 'tabs', 'dialogs', 'ms']
const counted = /^\s+Counted:\s*(\w+) on (\S+), target (\d+(?:\.\d+)?), (lower|higher) is better\.?\s*$/

/** Read the sections the plugin shows; the rest of the persona file is the persona agent's business. Never throws. */
export function parseSheet(md: string): Sheet {
  const sheet: Sheet = { who: [], goals: [] }
  let para: string[] = []
  const endPara = () => { if (para.length) sheet.who.push(para.join(' ')); para = [] }
  let section = ''
  for (const line of md.split(/\r?\n/)) {
    const heading = /^## +(.+?)\s*$/.exec(line)
    if (heading) { endPara(); section = heading[1].toLowerCase(); continue }
    if (section === 'who') {
      if (line.trim()) para.push(line.trim())
      else endPara()
    } else if (section === 'goals') {
      const bullet = /^[-*] +(.+?)\s*$/.exec(line)
      if (bullet) { sheet.goals.push({ text: bullet[1] }); continue }
      // A Counted line that doesn't read is left out, so the goal is judged instead.
      const m = sheet.goals.length ? counted.exec(line) : null
      if (m && metrics.includes(m[1])) {
        sheet.goals[sheet.goals.length - 1].measure = { metric: m[1] as Metric, task: m[2], target: Number(m[3]), better: m[4] as 'lower' | 'higher' }
      }
    }
  }
  endPara()
  return sheet
}
