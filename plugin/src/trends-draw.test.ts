import { assert, test } from 'orca/testing'
import { drawTrend, type Trend } from './trends-draw'

const size = { w: 300, h: 120 }
const goal = (points: Trend['points'], text = 'Sign up fast'): Trend => ({ text, target: 3, better: 'lower', points })
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

test('one input: one polyline with a pair per point, one dashed target line, loop numbers on the axis', () => {
  const svg = drawTrend(goal([{ runId: 'a', loop: 1, value: 9 }, { runId: 'b', loop: 2, value: 6 }, { runId: 'c', loop: 3, value: 4 }]), size)
  assert.equal(count(svg, /<polyline/g), 1)
  const pts = /<polyline[^>]*points="([^"]*)"/.exec(svg)![1].trim().split(/\s+/)
  assert.equal(pts.length, 3)
  assert.ok(pts.every((p) => /^-?[\d.]+,-?[\d.]+$/.test(p)))
  assert.equal(count(svg, /<line/g), 1)
  assert.ok(/<line[^>]*stroke-dasharray/.test(svg))
  assert.ok(svg.includes('>1<') && svg.includes('>3<'))
})

test('the newest value, the target and the run axis are labelled, so a single run reads too', () => {
  const svg = drawTrend(goal([{ runId: 'a', loop: 1, value: 9 }, { runId: 'b', loop: 2, value: 6 }]), size)
  assert.ok(svg.includes('>6<') && !svg.includes('>9<'))
  assert.ok(svg.includes('>target 3<') && svg.includes('>run<'))
  assert.ok(drawTrend(goal([{ runId: 'a', loop: 1, value: 3 }]), size).includes('>3<'))
})

test('two inputs: two polylines, named', () => {
  const svg = drawTrend(goal([
    { runId: 'a', loop: 1, value: 9, input: 'mouse' }, { runId: 'b', loop: 2, value: 6, input: 'mouse' },
    { runId: 'c', loop: 1, value: 8, input: 'touch' }, { runId: 'd', loop: 2, value: 5, input: 'touch' }]), size)
  assert.equal(count(svg, /<polyline/g), 2)
  assert.ok(svg.includes('mouse') && svg.includes('touch'))
})

test('no points: says so, draws no line', () => {
  const svg = drawTrend(goal([]), size)
  assert.ok(svg.includes('No runs yet'))
  assert.equal(count(svg, /<polyline/g), 0)
})

test('goal text and input names are escaped', () => {
  const svg = drawTrend(goal([{ runId: 'a', loop: 1, value: 9, input: '<img src=x onerror=1>' }], '<script>alert("x")</script> & more'), size)
  assert.ok(!svg.includes('<script') && !svg.includes('<img'))
  assert.ok(svg.includes('&lt;script&gt;') && svg.includes('&amp; more') && svg.includes('&lt;img'))
  assert.ok(!drawTrend(goal([], '<b>'), size).includes('<b>'))
})
