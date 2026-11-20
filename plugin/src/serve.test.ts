import { assert, test } from 'orca/testing'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alive, copyInto, freePort, startApp, stopApp, waitForUrl } from './serve'

const BASE = 47310
const server = `"${process.execPath}" -e "require('http').createServer((q,s)=>s.end('ok')).listen(+process.argv[1])" {port}`
const tmp = () => mkdtempSync(join(tmpdir(), 'serve-test-'))
const listening = (port: number) => new Promise<boolean>((done) => {
  const s = createServer()
  s.once('error', () => done(true))
  s.listen(port, '127.0.0.1', () => s.close(() => done(false)))
})

test('freePort skips taken ports and ports something listens on', async () => {
  assert.equal(await freePort(BASE, [BASE]), BASE + 1)
  const s = createServer()
  await new Promise<void>((r) => s.listen(BASE + 10, '127.0.0.1', () => r()))
  try {
    assert.equal(await freePort(BASE + 10, []), BASE + 11)
  } finally {
    await new Promise<void>((r) => s.close(() => r()))
  }
})

test('startApp, waitForUrl, alive and stopApp run a real server and leave the port free', async () => {
  const dir = tmp(), port = BASE + 20
  const pid = startApp({ cwd: dir, command: server, port, log: join(dir, 'app.log') })
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 15000, pid)
    assert.equal(alive(pid), true)
  } finally {
    await stopApp(pid)
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(alive(pid), false)
  assert.equal(await listening(port), false)
})

test('waitForUrl throws when the app exits first', async () => {
  const dir = tmp(), port = BASE + 30
  const pid = startApp({ cwd: dir, command: 'exit 3', port, log: join(dir, 'app.log') })
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 15000, pid)
    assert.equal('resolved', 'threw')
  } catch (e) {
    assert.ok(String((e as Error).message).includes('stopped before it answered'))
  } finally {
    await stopApp(pid)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('copyInto copies by path, reports missing files, and refuses paths outside the project', () => {
  const from = tmp(), to = tmp()
  try {
    mkdirSync(join(from, 'a'), { recursive: true })
    writeFileSync(join(from, 'a', '.env.test'), 'X=1')
    assert.deepEqual(copyInto(from, to, ['a/.env.test', 'missing.txt']), ['missing.txt'])
    assert.equal(readFileSync(join(to, 'a', '.env.test'), 'utf8'), 'X=1')
    for (const bad of ['../x', '/etc/hosts']) {
      assert.throws(() => copyInto(from, to, [bad]), /"copy" must name files inside the project/)
    }
    assert.equal(existsSync(join(to, 'x')), false)
  } finally {
    rmSync(from, { recursive: true, force: true })
    rmSync(to, { recursive: true, force: true })
  }
})

test('waitForUrl times out on a server that accepts but never answers', async () => {
  const dir = tmp(), port = BASE + 40
  const hang = `"${process.execPath}" -e "require('net').createServer(()=>{}).listen(+process.argv[1])" {port}`
  const pid = startApp({ cwd: dir, command: hang, port, log: join(dir, 'app.log') })
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 1500, pid)
    assert.equal('resolved', 'threw')
  } catch (e) {
    assert.ok(String((e as Error).message).includes("didn't answer"), String((e as Error).message))
  } finally {
    await stopApp(pid)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stopApp kills a child that ignores SIGTERM after the shell has gone', async () => {
  const dir = tmp(), port = BASE + 50
  const command = `trap "" TERM; ${server} & wait`
  const pid = startApp({ cwd: dir, command, port, log: join(dir, 'app.log') })
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 15000, pid)
  } finally {
    await stopApp(pid)
    rmSync(dir, { recursive: true, force: true })
  }
  for (let i = 0; i < 20 && (await listening(port)); i++) await new Promise<void>((r) => setTimeout(r, 100))
  assert.equal(await listening(port), false)
})

test('startApp throws instead of crashing when the folder is missing', () => {
  const dir = tmp()
  try {
    assert.throws(() => startApp({ cwd: join(dir, 'nope'), command: 'true', port: BASE + 60, log: join(dir, 'app.log') }), /Couldn't start the app/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
