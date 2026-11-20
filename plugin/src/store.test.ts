import { assert, test } from 'orca/testing'
import { emptyFindings } from './model'
import { findingsKey, loadFindings, loadRecord, recordKey, saveFindings, saveRecord } from './store'
import { memStorage } from './test-helpers'

test('findings never stored load as null', async () => {
  assert.equal(await loadFindings(memStorage(), 'app'), null)
})
test('findings save then load round-trips under findings:<project>, with no undefined fields stored', async () => {
  const storage = memStorage()
  const pf = { ...emptyFindings('app'), next: 3, fresh: undefined }
  await saveFindings(storage, pf)
  assert.equal(findingsKey('app'), 'findings:app')
  assert.ok(!('fresh' in (storage.map.get('findings:app') as object)))
  assert.deepEqual(await loadFindings(storage, 'app'), { v: 2, project: 'app', next: 3, findings: [] })
})
test('a record save then load round-trips under record:<project>:<persona>', async () => {
  const storage = memStorage()
  const r = { v: 2 as const, project: 'app', persona: 'dex', runs: [] }
  await saveRecord(storage, r)
  assert.equal(recordKey('app', 'dex'), 'record:app:dex')
  assert.ok(storage.map.has('record:app:dex'))
  assert.deepEqual(await loadRecord(storage, 'app', 'dex'), r)
})
test('a record never stored loads empty', async () => {
  assert.deepEqual(await loadRecord(memStorage(), 'app', 'dex'), { v: 2, project: 'app', persona: 'dex', runs: [] })
})
