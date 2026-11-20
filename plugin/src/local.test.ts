import { assert, test } from 'orca/testing'
import { CANDIDATES, findTool, repoOf } from './local'
import type { Tools } from './tools'

const withRemote = (url: string | null) => ({ remoteUrl: async () => url }) as unknown as Tools

test('repoOf reads owner/name from https, scp-style and ssh GitHub remotes', async () => {
  for (const url of ['https://github.com/acme/app.git', 'https://github.com/acme/app', 'git@github.com:acme/app.git',
    'git@github.com:acme/app', 'ssh://git@github.com/acme/app.git']) {
    assert.equal(await repoOf(withRemote(url), '/p'), 'acme/app', url)
  }
})
test('repoOf is null for a non-GitHub remote or no remote', async () => {
  assert.equal(await repoOf(withRemote('https://gitlab.com/acme/app.git'), '/p'), null)
  assert.equal(await repoOf(withRemote('git@bitbucket.org:acme/app.git'), '/p'), null)
  assert.equal(await repoOf(withRemote(null), '/p'), null)
})

test('findTool: an override wins unchecked, else the first candidate that exists, else null', () => {
  const only = (x: string) => (p: string) => p === x
  assert.equal(findTool('', ['/a', '/b'], only('/b')), '/b')
  assert.equal(findTool('/mine', ['/a', '/b'], only('/b')), '/mine')
  assert.equal(findTool('', ['/a', '/b'], () => false), null)
  assert.equal(findTool('', ['/a', '/b'], () => true), '/a')
})
test('the candidate paths are the ones Persona Studio looks in', () => {
  assert.deepEqual(CANDIDATES.orca, ['/Applications/Orca.app/Contents/Resources/bin/orca', '/usr/local/bin/orca', '/opt/homebrew/bin/orca'])
  assert.deepEqual(CANDIDATES.gh, ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'])
  assert.deepEqual(CANDIDATES.git, ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'])
})
