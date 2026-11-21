// The Persona Studio sidebar: counts of findings by list, the project's personas, and ways to open the tab (src/app.ts).
// No build step: Orca strips the types and compiles the JSX when the panel loads.
import { Box, Button, Image, Callout, Link, Row, Separator, Skeleton, Spinner, Stack, Text, atom, plugin, read, set, type PanelContext } from 'orca'
import { focusWords, say, setupWords, statusOf, stepOf, uncommittedWords, type Focus, type Overview, type PersonaRow, type Show } from './protocol'
import { stateWord } from './model'

const focus = atom<Focus | null>(null)
const overview = atom<Overview | null>(null)
/** A refusal of something the owner pressed: stays until the next press or focus. */
const problem = atom('')
/** A failed refresh: the next successful one clears it. */
const stale = atom('')
/** The last request timed out: the worker is still on it, and its post brings the result. */
const slow = atom(false)
/** Runs held back because the project has uncommitted changes, until Run anyway or Cancel. */
const held = atom<{ project: string; ids: string[]; n: number } | null>(null)
/** Where setup is, after pressing Set up personas. */
const notice = atom<{ project: string; text: string } | null>(null)

let latest = 0

/** Fetch the focus and, for a project, its overview. A newer fetch wins over an older one still in flight. */
async function refresh(keepProblem = false): Promise<void> {
  const mine = ++latest
  try {
    const f = await plugin.request('focus.get')
    const o = f.kind === 'project' ? await plugin.request('overview.get', { project: f.id }) : null
    if (mine !== latest) return
    set(focus, f); set(overview, o)
    set(stale, ''); set(slow, false)
    if (!keepProblem) set(problem, '')
  } catch (e) {
    if (mine === latest) set(stale, say(e))
  }
}

/** Open the tab. A refusal shows; a timeout isn't one, the worker carries on. */
async function open(project: string, show?: Show): Promise<void> {
  set(problem, ''); set(slow, false)
  try { await plugin.request('tab.open', show ? { project, show } : { project }) } catch (e) {
    if ((e as { code?: string }).code === 'timeout') set(slow, true)
    else set(problem, say(e))
  }
}

/** Start the setup chat and say where it is. A refusal shows; a timeout isn't one, the worker carries on. */
async function startSetup(project: string): Promise<void> {
  set(problem, ''); set(slow, false); set(notice, null)
  try {
    const out = await plugin.request('setup.start', { project })
    set(notice, { project, text: setupWords(out.existing) })
  } catch (e) {
    if ((e as { code?: string }).code === 'timeout') set(slow, true)
    else set(problem, say(e))
  }
}

/** Start or stop a run. A refusal shows and returns its message; a run held back by uncommitted changes returns how many
 *  files have them; a timeout isn't a refusal, the worker carries on. */
async function runCall(name: 'run.start' | 'run.stop', project: string, persona: string, anyway = false): Promise<string | number> {
  try {
    const out = name === 'run.start' ? await plugin.request(name, { project, persona, ...(anyway && { anyway }) })
      : await plugin.request(name, { project, persona })
    return 'uncommitted' in out ? out.uncommitted : ''
  } catch (e) {
    if ((e as { code?: string }).code === 'timeout') { set(slow, true); return '' }
    return say(e)
  }
}
/** Start or stop the given personas in turn: one refused doesn't stop the rest, and each refusal shows. Runs held back by
 *  uncommitted changes wait together for Run anyway. */
async function runSome(project: string, ids: string[], name: 'run.start' | 'run.stop' = 'run.start', anyway = false): Promise<void> {
  set(problem, ''); set(slow, false); set(held, null)
  const said: string[] = [], waiting: string[] = []
  let n = 0
  for (const id of ids) {
    const out = await runCall(name, project, id, anyway)
    if (typeof out === 'number') { waiting.push(id); n = Math.max(n, out) } else if (out) said.push(out)
  }
  // Personas that take turns are each refused in the same words: those show once.
  set(problem, [...new Set(said)].join(' '))
  if (waiting.length) set(held, { project, ids: waiting, n })
}

export function setup(ctx: PanelContext) {
  void refresh()
  ctx.subscriptions.push(plugin.on('focus', () => void refresh()))
  ctx.subscriptions.push(plugin.on('changed', (at) => {
    const f = read(focus)
    if (f?.kind === 'project' && f.id === at.project) void refresh(true)
  }))
}

/** Running: what it's doing; idle: its tag. Why a run failed shows on the persona's page in the tab; here it's the Failed badge. */
/** The tab's sample portraits (src/samples.ts) as PNGs: the sidebar's Image shows only those. */
// Panel images can't overlap or be smaller than 48px, so the tab's three overlapping faces are one PNG (96px wide at size sm).
const FACES = 'assets/samples/faces.png'
/** How setup and persona runs work, one line each. */
const SETUP_STEPS = [
  "The agent learns what your app does and who it's for.",
  'You keep, rename, or tweak the personas it suggests.',
  'The agent makes sure your app starts cleanly.',
  'Each persona is saved as a file in your project.',
  'Run your personas to test your app from their perspective.',
]

const describe = (p: PersonaRow) => (p.state === 'running' ? statusOf(p, false) : p.tag === '' ? undefined : p.tag)

/** Uncommitted changes held a run back: say so, with Run anyway. */
function heldView(project: string) {
  const h = read(held)
  if (h?.project !== project) return null
  return (
    <Callout tone="warning">
      <Stack gap="sm">
        <Text size="sm">{uncommittedWords(h.n)}</Text>
        <Row gap="sm">
          <Button size="xs" variant="outline" onPress={() => runSome(project, h.ids, 'run.start', true)}>Run anyway</Button>
          <Button size="xs" variant="ghost" onPress={() => set(held, null)}>Cancel</Button>
        </Row>
      </Stack>
    </Callout>
  )
}

const problemView = () => (read(slow) ? <Callout tone="neutral">Still working on it; this will update when it's done.</Callout>
  : read(problem) + read(stale) === '' ? null : <Callout tone="danger" title="That didn't work">{read(problem) || read(stale)}</Callout>)

// Orca pads a panel 12px; xs and md bring it to 16px by 24px, as Orca's own Checks panel has.
export default function Panel() {
  const f = read(focus)
  if (f === null) return <Box paddingX="xs" paddingY="md" gap="md">{problemView()}<Skeleton shape="block" label="Loading" /></Box>
  if (f.kind !== 'project') {
    return <Box paddingX="xs" paddingY="md" gap="md">{problemView()}<Text muted>{focusWords(f)}</Text></Box>
  }
  const o = read(overview)
  if (o === null) return <Box paddingX="xs" paddingY="md" gap="md">{problemView()}<Skeleton shape="block" label="Loading" /></Box>
  const states = ['new', 'kept', 'progress', 'fixed'] as const
  // Findings can outlive personas (a persona file removed), so they show whenever there are any.
  const hasFindings = states.some((s) => o.counts[s] > 0)
  const idle = o.personas.filter((p) => p.state === 'idle')
  return (
    <Box paddingX="xs" paddingY="md" gap="md">
      {o.configError !== null && <Callout tone="danger" title="Persona Studio can't load this project">{o.configError}</Callout>}
      {problemView()}
      {heldView(f.id)}
      {read(notice)?.project === f.id && o.personas.length === 0 && <Callout tone="neutral">{read(notice)!.text}</Callout>}
      {(hasFindings || o.personas.length > 0) && (
        // Orca's Button takes only text, so each count is a tile whose label is the press target.
        <Box columns={4} gap="xs">
          {states.map((s) => (
            <Box key={s} border radius="md" paddingY="sm" align="center" gap="none">
              <Text weight="semibold">{String(o.counts[s])}</Text>
              <Link onPress={() => open(f.id, { state: s })}>{stateWord[s]}</Link>
            </Box>
          ))}
        </Box>
      )}
      {o.configError !== null && o.personas.length === 0 ? null : o.personas.length === 0 ? (
        // The tab's zero state, short: the same faces, headline, setup steps and button.
        <Stack gap="md">
          <Image src={FACES} alt="" size="sm" />
          <Stack gap="xs">
            <Text weight="semibold">See your app through your users' eyes</Text>
            <Text size="sm" muted>Personas explore your app the way real people do, reporting the bugs, missing pieces, and rough edges that get in their way.</Text>
          </Stack>
          <Stack gap="xs">
            <Text size="sm">Setup is a quick chat with an agent.</Text>
            {SETUP_STEPS.map((step, n) => (
              <Row key={step} gap="sm" align="center">
                <Box border radius="full" paddingX="sm" shrink={false}><Text size="xs" muted>{String(n + 1)}</Text></Box>
                <Text size="sm" muted>{step}</Text>
              </Row>
            ))}
          </Stack>
          <Row gap="sm" align="center">
            <Button variant="solid" tone="accent" size="xs" onPress={() => startSetup(f.id)}>Set up personas</Button>
            <Text size="xs" muted>Takes a few minutes</Text>
          </Row>
          <Text size="xs" muted>Works with web apps out of the box, and can be set up with your own harness · <Link onPress={() => open(f.id, { persona: null })}>How it works</Link></Text>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Row justify="between" align="center">
            <Text size="xs" muted weight="semibold">Personas</Text>
            <Row gap="xs" align="center">
              {idle.length > 0 && o.canRun === null && <Button size="xs" variant="ghost" icon="play" onPress={() => runSome(f.id, idle.map((p) => p.id))}>Run all idle</Button>}
              <Button size="xs" variant="solid" tone="accent" onPress={() => open(f.id, { persona: null })}>Open Studio</Button>
            </Row>
          </Row>
          {o.canRun !== null && <Text size="sm" muted>{o.canRun}</Text>}
          <Stack gap="none">
            {o.personas.map((p, i) => (
              <Stack key={p.id} gap="none">
                {i > 0 && <Separator />}
                <Box direction="row" align="center" gap="sm" paddingY="sm">
                  <Box grow minWidth={0} gap="none">
                    <Row gap="xs" align="center">
                      {p.state === 'running' && <Spinner label="Running" labelHidden />}
                      <Link onPress={() => open(f.id, { persona: p.id })}>{p.name}</Link>
                      {p.state === 'running' && stepOf(p) && <Box border radius="full" background="card" paddingX="sm" shrink={false}><Text size="xs">{stepOf(p)}</Text></Box>}
                      {p.fresh > 0 && <Box border radius="full" background="card" paddingX="sm" shrink={false}><Text size="xs">{`${p.fresh} New`}</Text></Box>}
                      {p.error !== undefined && p.state === 'idle' && <Box border radius="full" background="card" paddingX="sm" shrink={false}><Text size="xs" tone="danger">Failed</Text></Box>}
                    </Row>
                    <Row gap="xs" align="center">
                      {describe(p) !== undefined && <Text size="xs" muted truncate>{describe(p)}</Text>}
                    </Row>
                  </Box>
                  <Button size="xs" variant="outline" onPress={() => open(f.id, { persona: p.id })}>View</Button>
                  {p.state === 'running' ? <Button size="xs" variant="outline" icon="stop" onPress={() => runSome(f.id, [p.id], 'run.stop')}>Stop</Button>
                    : o.canRun !== null ? null
                    : p.runs === 0 ? <Button size="xs" variant="outline" icon="play" onPress={() => runSome(f.id, [p.id])}>Run</Button>
                    : <Button size="xs" variant="outline" icon="refresh" onPress={() => open(f.id, { persona: p.id, run: true })}>Run again</Button>}
                </Box>
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
      {/* Styled as Orca's own Publish Branch button; setup can mend a persona.studio that doesn't load. */}
      {o.personas.length === 0 && o.configError !== null && <Row><Button variant="solid" tone="accent" size="xs" onPress={() => startSetup(f.id)}>Set up personas</Button></Row>}
    </Box>
  )
}
