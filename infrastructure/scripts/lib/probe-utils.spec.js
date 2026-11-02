/**
 * Tests for the verification subsystem's pure/self-contained parts:
 * httpProbe, tcpProbe, summariseProbes, formatVerifyReport.
 *
 *   node scripts/lib/probe-utils.spec.js
 *
 * Probes that need the running stack (containers, docker exec, the full
 * runVerify set) are exercised by `make verify` itself, not here — these
 * tests only cover the transport and policy logic with throwaway servers.
 */

import http from 'node:http'
import net from 'node:net'
import assert from 'node:assert/strict'
import {
  httpProbe, tcpProbe, summariseProbes, formatVerifyReport,
} from './probe-utils.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

function withServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        port,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

test('httpProbe passes a 200 through with body and status', async () => {
  const s = await withServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') })
  try {
    const r = await httpProbe(`http://127.0.0.1:${s.port}/`)
    assert.equal(r.ok, true)
    assert.equal(r.status, 200)
    assert.equal(r.body, '{"ok":true}')
    assert.ok(Number.isFinite(r.ms))
  } finally { await s.close() }
})

test("httpProbe reports non-2xx as ok:true with the status (verdict is the caller's)", async () => {
  const s = await withServer((req, res) => { res.writeHead(503); res.end('nope') })
  try {
    const r = await httpProbe(`http://127.0.0.1:${s.port}/`)
    assert.equal(r.ok, true)
    assert.equal(r.status, 503)
  } finally { await s.close() }
})

test('httpProbe reports refused connections as ok:false with a message', async () => {
  // Bind then close to get a guaranteed-free port.
  const s = await withServer((req, res) => res.end())
  const port = s.port
  await s.close()
  const r = await httpProbe(`http://127.0.0.1:${port}/`, { timeoutMs: 2000 })
  assert.equal(r.ok, false)
  assert.ok(r.error && r.error.length > 0, 'error message must not be empty')
})

test('httpProbe times out on a hanging server', async () => {
  const s = await withServer(() => { /* never respond */ })
  try {
    const r = await httpProbe(`http://127.0.0.1:${s.port}/`, { timeoutMs: 300 })
    assert.equal(r.ok, false)
    assert.match(r.error, /timeout/)
  } finally { await s.close() }
})

test('httpProbe sends the given method, headers and body', async () => {
  let seen = null
  const s = await withServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen = { method: req.method, header: req.headers['x-test'], body }
      res.end('ok')
    })
  })
  try {
    await httpProbe(`http://127.0.0.1:${s.port}/`, {
      method: 'POST',
      headers: { 'x-test': 'yes' },
      body: 'a=1',
    })
    assert.deepEqual(seen, { method: 'POST', header: 'yes', body: 'a=1' })
  } finally { await s.close() }
})

test('tcpProbe succeeds on a listening port', async () => {
  const server = net.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    const open = await tcpProbe('127.0.0.1', port)
    assert.equal(open.ok, true)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('summariseProbes: clean is 0/OK, warn-only is 1/DEGRADED, any fail is 2/DOWN', () => {
  const p = (status) => ({ status })
  assert.deepEqual(summariseProbes([p('pass'), p('skip')]), { exitCode: 0, verdict: 'OK', failCount: 0, warnCount: 0 })
  assert.deepEqual(summariseProbes([p('pass'), p('warn')]), { exitCode: 1, verdict: 'DEGRADED', failCount: 0, warnCount: 1 })
  assert.deepEqual(summariseProbes([p('warn'), p('fail')]), { exitCode: 2, verdict: 'DOWN', failCount: 1, warnCount: 1 })
})

test('formatVerifyReport renders layers, icons and the verdict line', () => {
  const text = formatVerifyReport({
    env: 'dev', verdict: 'DEGRADED', exitCode: 1, failCount: 0, warnCount: 1,
    probes: [
      { layer: 'config', name: 'root-env', status: 'pass', detail: 'fine', ms: 1 },
      { layer: 'data', name: 'migrations', status: 'warn', detail: '1 pending', ms: 2 },
    ],
  })
  assert.match(text, /VERIFY {2}env=dev/)
  assert.match(text, /✓ root-env\s+fine/)
  assert.match(text, /! migrations\s+1 pending/)
  assert.match(text, /DEGRADED: 1 pass · 1 warn {2}\(exit 1\)/)
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
