// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host.
import { defineCheck } from 'orca/testing'

const project = { kind: 'project' as const, id: 'app', name: 'app · ux', personas: 2 }
const counts = { new: 3, kept: 1, progress: 0, fixed: 4, closed: 9 }
const info = { hasGh: false, canRun: null, configError: null }

export default defineCheck({
  empty: { requests: { 'focus.get': { kind: 'none' } } },
  'no-personas': { requests: { 'focus.get': project,
    'overview.get': { ...info, personas: [], counts: { new: 0, kept: 0, progress: 0, fixed: 0, closed: 0 } } } },
  'with-findings': { requests: { 'focus.get': project,
    'overview.get': { ...info, counts, personas: [
      { id: 'dex', name: 'Dex', tag: 'draws by hand', state: 'idle', fresh: 2, runs: 1, recheck: 0 },
      { id: 'maya', name: 'Maya', tag: '', state: 'idle', fresh: 0, runs: 0, recheck: 0 }] } } },
  running: { requests: { 'focus.get': project,
    'overview.get': { ...info, counts, personas: [
      { id: 'dex', name: 'Dex', tag: 'draws by hand', state: 'running', stage: 'Using the app', line: 'Step 4 of 9: Opening the editor', fresh: 0, runs: 3, recheck: 0 },
      { id: 'maya', name: 'Maya', tag: 'keyboard only', state: 'idle', fresh: 2, runs: 2, recheck: 0 },
      { id: 'lea', name: 'Lea', tag: 'first visit', state: 'idle', fresh: 0, runs: 0, recheck: 0 },
      { id: 'walt', name: 'Walt', tag: '', state: 'idle', fresh: 0, runs: 1, recheck: 0, error: 'The app would not start.' }] } } }
})
