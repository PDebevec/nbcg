/**
 * Tests for the run lock (lib/lock.js): acquisition, contention, staleness
 * stealing, release ownership, and the --wait deadline.
 *
 *   node scripts/lib/lock.spec.js
 *
 * Every test uses its own lock file in a scratch directory — the real
 * infrastructure/.cli-lock is never touched.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { acquireLock, tryAcquireLock } from './lock.js'
import { UsageError } from './runner.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

let scratch
const lockFile = () => path.join(scratch, `lock-${Math.random().toString(36).slice(2)}.json`)
const writeLock = (file, record) => fs.writeFileSync(file, JSON.stringify(record))
const ownHost = () => os.hostname()
const now = () => new Date().toISOString()
/** Resolves once `child` has exited, safe to call before OR after the exit. */
const waitExit = (child) =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once('exit', resolve))

test('acquire creates the lock with our pid and a release that removes it', async () => {
  const file = lockFile()
  const handle = await acquireLock({ path: file, command: 'unit-test' })
  const owner = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(owner.pid, process.pid)
  assert.equal(owner.command, 'unit-test')
  assert.equal(typeof owner.token, 'string')
  handle.release()
  assert.equal(fs.existsSync(file), false)
})

test('release is idempotent and never throws', async () => {
  const file = lockFile()
  const handle = await acquireLock({ path: file })
  handle.release()
  handle.release()
  assert.equal(fs.existsSync(file), false)
})

test('a live same-host holder makes acquisition fail with a UsageError naming it', async () => {
  const file = lockFile()
  writeLock(file, { pid: process.pid, host: ownHost(), at: now(), command: 'other-op' })
  await assert.rejects(
    () => acquireLock({ path: file }),
    (error) => error instanceof UsageError && /other-op/.test(error.message) && /pid/.test(error.message)
  )
  fs.rmSync(file, { force: true })
})

test('tryAcquireLock returns null instead of throwing when held', async () => {
  const file = lockFile()
  writeLock(file, { pid: process.pid, host: ownHost(), at: now(), command: 'other-op' })
  assert.equal(await tryAcquireLock({ path: file }), null)
  fs.rmSync(file, { force: true })
})

test('releasing does not remove a lock that someone else replaced', async () => {
  const file = lockFile()
  const handle = await acquireLock({ path: file })
  // Simulate: our record was replaced by a fresh acquisition (different token)
  writeLock(file, { pid: process.pid, host: ownHost(), at: now(), command: 'impostor', token: 'different' })
  handle.release()
  assert.equal(fs.existsSync(file), true, 'foreign-token lock must survive our release')
  fs.rmSync(file, { force: true })
})

test('a dead same-host pid is stale: the lock is stolen', async () => {
  const file = lockFile()
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1)'])
  await waitExit(child)
  writeLock(file, { pid: child.pid, host: ownHost(), at: now(), command: 'crashed-op' })
  const handle = await acquireLock({ path: file })
  const owner = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(owner.pid, process.pid, 'stale lock replaced by ours')
  handle.release()
})

test('malformed lock content is treated as stale', async () => {
  const file = lockFile()
  fs.writeFileSync(file, 'not json {')
  const handle = await acquireLock({ path: file })
  handle.release()
  assert.equal(fs.existsSync(file), false)
})

test('a fresh foreign-host lock is held; an expired one is stolen', async () => {
  const fresh = lockFile()
  writeLock(fresh, { pid: 12345, host: 'some-other-host', at: now(), command: 'remote-op' })
  assert.equal(await tryAcquireLock({ path: fresh }), null, 'fresh foreign lock must be respected')
  fs.rmSync(fresh, { force: true })

  const expired = lockFile()
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  writeLock(expired, { pid: 12345, host: 'some-other-host', at: twoHoursAgo, command: 'remote-op' })
  const handle = await acquireLock({ path: expired })
  handle.release()
})

test('--wait queues behind a live holder until it releases', async () => {
  const file = lockFile()
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'])
  writeLock(file, { pid: child.pid, host: ownHost(), at: now(), command: 'slow-op' })
  const started = Date.now()
  // Queue with a deadline comfortably above the child's 400ms lifetime.
  const handle = await acquireLock({ path: file, wait: true, waitMs: 5000 })
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 200, `expected to have waited for the holder, waited ${elapsed}ms`)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid)
  handle.release()
  await waitExit(child)
})

test('--wait gives up at its deadline with a UsageError', async () => {
  const file = lockFile()
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'])
  writeLock(file, { pid: child.pid, host: ownHost(), at: now(), command: 'long-op' })
  await assert.rejects(
    () => acquireLock({ path: file, wait: true, waitMs: 300 }),
    (error) => error instanceof UsageError && /long-op/.test(error.message)
  )
  child.kill()
  await waitExit(child)
  fs.rmSync(file, { force: true })
})

// ---------------------------------------------------------------------------
scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nbcg-lock-'))

let passed = 0
let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed++
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n').join('\n       ')}`)
  }
}

fs.rmSync(scratch, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
