/**
 * Tests for the doctor's pure logic: exit-code policy and report rendering.
 * The docker-dependent parts (planContainerRepairs, orphanImages,
 * doctorRepair) are exercised live via `make doctor` — see the plan's Phase-2
 * proofs.
 *
 *   node scripts/lib/doctor-utils.spec.js
 */

import assert from 'node:assert/strict'
import { doctorExitCode, formatDoctorReport } from './doctor-utils.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const cleanReport = () => ({
  env: 'dev',
  stale: [],
  container: { error: null, restartable: [], manual: [], pending: [] },
  images: { referenced: true, dangling: 0, orphans: [] },
  verify: { env: 'dev', verdict: 'OK', exitCode: 0, failCount: 0, warnCount: 0, probes: [] },
})

test('exit code: clean report → 0', () => {
  assert.equal(doctorExitCode(cleanReport()), 0)
})

test('exit code: stale steps → at least 1', () => {
  const r = cleanReport()
  r.stale = [{ key: 'fbEnd', label: 'App env files', reason: 'missing' }]
  assert.equal(doctorExitCode(r), 1)
})

test('exit code: restartable containers → at least 1', () => {
  const r = cleanReport()
  r.container.restartable = [{ service: 'redis', state: 'running', health: 'unhealthy' }]
  assert.equal(doctorExitCode(r), 1)
})

test('exit code: only manually-stopped containers → still 0 (nothing to repair, not a fault)', () => {
  const r = cleanReport()
  r.container.manual = [{ service: 'redis', state: 'exited', health: '' }]
  assert.equal(doctorExitCode(r), 0)
})

test('exit code: verify failure dominates (2 even when repairable)', () => {
  const r = cleanReport()
  r.stale = [{ key: 'config', label: 'Config', reason: 'inputs changed' }]
  r.verify = { env: 'dev', verdict: 'DOWN', exitCode: 2, failCount: 1, warnCount: 0, probes: [] }
  assert.equal(doctorExitCode(r), 2)
})

test('exit code: verify warnings survive when nothing else is wrong', () => {
  const r = cleanReport()
  r.verify = { env: 'dev', verdict: 'DEGRADED', exitCode: 1, failCount: 0, warnCount: 1, probes: [] }
  assert.equal(doctorExitCode(r), 1)
})

test('report renders stale steps with their repair hint', () => {
  const r = cleanReport()
  r.stale = [{ key: 'fbEnd', label: 'App env files', reason: 'generated file(s) missing: frontend/.env' }]
  const text = formatDoctorReport(r)
  assert.match(text, /✗ fbEnd\s+generated file\(s\) missing/)
  assert.match(text, /re-run: make step STEP=fbEnd/)
  assert.match(text, /1 issue\(s\) the CLI can repair safely/)
})

test('report distinguishes restartable from intentionally-stopped containers', () => {
  const r = cleanReport()
  r.container.restartable = [{ service: 'redis', state: 'running', health: 'unhealthy' }]
  r.container.manual = [{ service: 'pgadmin', state: 'exited', health: '' }]
  const text = formatDoctorReport(r)
  assert.match(text, /redis\s+unhealthy — repairable/)
  assert.match(text, /pgadmin\s+exited — left alone/)
})

test('report lists orphan images and the verify verdict', () => {
  const r = cleanReport()
  r.images = { referenced: true, dangling: 2, orphans: ['nbcg-tika:latest'] }
  r.verify = { env: 'dev', verdict: 'DEGRADED', exitCode: 1, failCount: 0, warnCount: 1, probes: [{ layer: 'data', name: 'migrations', status: 'warn', detail: '1 pending' }] }
  const text = formatDoctorReport(r)
  assert.match(text, /nbcg-tika:latest not referenced/)
  assert.match(text, /2 dangling layer set\(s\)/)
  assert.match(text, /! migrations\s+1 pending/)
})

test('report says "nothing to repair" when clean', () => {
  assert.match(formatDoctorReport(cleanReport()), /nothing the CLI can repair on its own/)
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
