/**
 * Tests for config history: snapshot/restore round-trips and the diff
 * summary, against scratch directories (the real .config-history and repo
 * files are never touched).
 *
 *   node scripts/lib/config-history.spec.js
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { snapshotConfig, restoreSnapshot, historyEntries, diffSummary } from './config-history.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbcg-hist-'))
  const live = path.join(root, 'live')
  fs.mkdirSync(live, { recursive: true })
  return { root, live, history: path.join(root, 'history') }
}

const write = (dir, rel, content) => {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return full
}

test('snapshot copies only existing files and writes a manifest', () => {
  const { live, history } = scratch()
  const files = [
    write(live, '.env', 'A=1'),
    write(live, 'frontend/.env', 'B=2'),
    path.join(live, 'missing/.env'), // never created
  ]
  const dir = snapshotConfig('unit-test', { files, root: live, historyRoot: history, dir: path.join(history, 'one') })

  assert.equal(fs.readFileSync(path.join(dir, 'files', '.env'), 'utf8'), 'A=1')
  assert.equal(fs.readFileSync(path.join(dir, 'files', 'frontend/.env'), 'utf8'), 'B=2')
  assert.equal(fs.existsSync(path.join(dir, 'files', 'missing/.env')), false)

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.label, 'unit-test')
  assert.deepEqual(manifest.files.sort(), ['.env', 'frontend/.env'])
})

test('restore puts the old contents back over changed files', () => {
  const { live, history } = scratch()
  const files = [write(live, '.env', 'A=1'), write(live, 'frontend/.env', 'B=2')]
  const dir = snapshotConfig('before', { files, root: live, historyRoot: history, dir: path.join(history, 'one') })

  write(live, '.env', 'A=CHANGED')
  fs.rmSync(path.join(live, 'frontend/.env'))

  const restored = restoreSnapshot(dir, { root: live })
  assert.deepEqual(restored.sort(), ['.env', 'frontend/.env'])
  assert.equal(fs.readFileSync(path.join(live, '.env'), 'utf8'), 'A=1')
  assert.equal(fs.readFileSync(path.join(live, 'frontend/.env'), 'utf8'), 'B=2')
})

test('historyEntries lists newest first with manifest metadata', () => {
  const { live, history } = scratch()
  const files = [write(live, '.env', 'A=1')]
  snapshotConfig('first', { files, root: live, historyRoot: history, dir: path.join(history, '2026-01-01T00-00-00-000Z') })
  snapshotConfig('second', { files, root: live, historyRoot: history, dir: path.join(history, '2026-02-01T00-00-00-000Z') })

  const entries = historyEntries({ dir: history })
  assert.equal(entries.length, 2)
  assert.equal(entries[0].label, 'second')
  assert.equal(entries[1].label, 'first')
})

test('snapshot pruning keeps the newest entries only', () => {
  const { live, history } = scratch()
  const files = [write(live, '.env', 'A=1')]
  for (let i = 1; i <= 12; i++) {
    snapshotConfig(`n${i}`, { files, root: live, historyRoot: history, dir: path.join(history, `2026-01-${String(i).padStart(2, '0')}T00-00-00-000Z`) })
  }
  const entries = historyEntries({ dir: history })
  assert.equal(entries.length, 10, 'pruneHistory(10) keeps the newest 10')
  assert.equal(entries[0].label, 'n12')
})

test('diffSummary classifies changed/created/deleted and counts lines', () => {
  const { live, history } = scratch()
  const files = [write(live, '.env', 'A=1\nB=2\n'), write(live, 'gone.conf', 'x\n')]
  const dir = snapshotConfig('base', { files, root: live, historyRoot: history, dir: path.join(history, 'one') })

  write(live, '.env', 'A=1\nB=CHANGED\nC=3\n')       // 1 removed, 2 added
  fs.rmSync(path.join(live, 'gone.conf'))            // deleted
  write(live, 'new.conf', 'n\n')                      // created

  const changes = diffSummary(dir, { files: [...files, path.join(live, 'new.conf')], root: live })
  const byRel = Object.fromEntries(changes.map(c => [c.rel, c.summary]))

  assert.equal(byRel['gone.conf'], 'deleted')
  assert.equal(byRel['new.conf'], 'created')
  assert.match(byRel['.env'], /^\+2 -1$/)
})

test('diffSummary reports nothing for identical trees', () => {
  const { live, history } = scratch()
  const files = [write(live, '.env', 'A=1')]
  const dir = snapshotConfig('base', { files, root: live, historyRoot: history, dir: path.join(history, 'one') })
  assert.deepEqual(diffSummary(dir, { files, root: live }), [])
})

// ---------------------------------------------------------------------------
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
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
