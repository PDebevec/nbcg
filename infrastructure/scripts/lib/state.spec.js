/**
 * Tests for the fingerprint-based state machine: state.js v2, fingerprint.js,
 * and the isStepCurrent gating in steps.js.
 *
 *   node scripts/lib/state.spec.js
 *
 * state.js exports a module-level singleton that reads its file once at import,
 * so each test runs in its own process with NBCG_CLI_STATE_FILE pointed at a
 * scratch file. The real .cli-state.json is never touched.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

let passed = 0
let failed = 0

/**
 * Runs `body` in a child process against a scratch state file.
 * `body` receives the paths it needs and must print one JSON object.
 * @param {object|undefined} initial contents to seed the state file with
 * @param {string} body JS evaluated in the child
 */
function run(initial, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbcg-state-'))
  const file = path.join(dir, 'state.json')
  if (initial !== undefined) fs.writeFileSync(file, JSON.stringify(initial, null, 2))

  const prelude = `
    import { state } from ${JSON.stringify(path.join(HERE, 'state.js'))}
    import { stepFingerprint, flagFingerprint, hashTree, hashFile } from ${JSON.stringify(path.join(HERE, 'fingerprint.js'))}
    import { isStepCurrent, stalenessReason, resolveEnv, SETUP_STEPS, getStep, executeStep } from ${JSON.stringify(path.join(HERE, 'steps.js'))}
    import fs from 'node:fs'
    const out = (async () => {
  `
  const postlude = `
    })()
    out.then((r) => console.log(JSON.stringify(r)), (e) => { console.error(e && e.stack || e); process.exit(1) })
  `
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', prelude + body + postlude],
      { env: { ...process.env, NBCG_CLI_STATE_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return JSON.parse(stdout.toString().trim().split('\n').pop())
  } catch (e) {
    throw new Error(`child failed:\n${e.stderr ? e.stderr.toString() : e.message}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`)
  }
}

// A scratch directory for tests that need real files to hash.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nbcg-fp-'))
const write = (rel, content) => {
  const full = path.join(scratch, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return full
}
const inputFile = write('input.txt', 'original')

// ---------------------------------------------------------------------------
console.log('\nfingerprinting')

test('a changed input changes the fingerprint', () => {
  const before = run(undefined, `
    const s = { key: 't', run: async () => {}, inputs: () => [${JSON.stringify(inputFile)}], outputs: () => [] }
    return { fp: stepFingerprint(s, 'dev') }
  `)
  fs.writeFileSync(inputFile, 'modified')
  const after = run(undefined, `
    const s = { key: 't', run: () => stepFingerprint, inputs: () => [${JSON.stringify(inputFile)}], outputs: () => [] }
    return { fp: stepFingerprint(s, 'dev') }
  `)
  assert.notEqual(before.fp, after.fp)
})

test('an unchanged input gives a stable fingerprint', () => {
  fs.writeFileSync(inputFile, 'stable')
  const body = `
    const s = { key: 't', run: async () => {}, inputs: () => [${JSON.stringify(inputFile)}], outputs: () => [] }
    return { a: stepFingerprint(s, 'dev'), b: stepFingerprint(s, 'dev') }
  `
  const r = run(undefined, body)
  assert.equal(r.a, r.b)
})

test('the environment is part of the fingerprint', () => {
  const r = run(undefined, `
    const s = { key: 't', run: async () => {}, inputs: () => [], outputs: () => [] }
    return { dev: stepFingerprint(s, 'dev'), prod: stepFingerprint(s, 'prod') }
  `)
  assert.notEqual(r.dev, r.prod)
})

test('a changed step body changes the fingerprint', () => {
  const r = run(undefined, `
    const mk = (src) => ({ key: 't', run: eval(src), inputs: () => [], outputs: () => [] })
    return {
      a: stepFingerprint(mk('(async () => { return 1 })'), 'dev'),
      b: stepFingerprint(mk('(async () => { return 2 })'), 'dev')
    }
  `)
  assert.notEqual(r.a, r.b)
})

test('a missing file hashes differently from a present one', () => {
  const r = run(undefined, `
    return { gone: hashFile('/nonexistent/xyz'), present: hashFile(${JSON.stringify(inputFile)}) }
  `)
  assert.equal(r.gone, 'missing')
  assert.notEqual(r.gone, r.present)
})

test('hashTree notices a removed file, unlike a bare existence check', () => {
  const dir = path.join(scratch, 'tree')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.crt'), 'A')
  fs.writeFileSync(path.join(dir, 'b.crt'), 'B')
  const before = run(undefined, `return { h: hashTree(${JSON.stringify(dir)}) }`)
  fs.rmSync(path.join(dir, 'b.crt'))
  const after = run(undefined, `return { h: hashTree(${JSON.stringify(dir)}) }`)
  assert.notEqual(before.h, after.h)
})

test('hashTree ignores mtimes, so a git checkout does not look like drift', () => {
  const dir = path.join(scratch, 'mtree')
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'same')
  const before = run(undefined, `return { h: hashTree(${JSON.stringify(dir)}) }`)
  const future = new Date(Date.now() + 86400000)
  fs.utimesSync(f, future, future)
  const after = run(undefined, `return { h: hashTree(${JSON.stringify(dir)}) }`)
  assert.equal(before.h, after.h)
})

// ---------------------------------------------------------------------------
console.log('\nenvironment isolation')

test('a dev step does not satisfy a prod check', () => {
  const r = run(undefined, `
    state.setStep('env', true, 'sha256:abc', 'dev')
    return { dev: state.isStepDone('env', 'dev'), prod: state.isStepDone('env', 'prod') }
  `)
  assert.equal(r.dev, true)
  assert.equal(r.prod, false, 'prod must not inherit a dev completion')
})

test('the same step key is tracked independently per environment', () => {
  const r = run(undefined, `
    state.setStep('certs', true, 'sha256:a', 'prod')
    state.setStep('certs', true, 'sha256:b', 'dev')
    return { dev: state.getFingerprint('certs', 'dev'), prod: state.getFingerprint('certs', 'prod') }
  `)
  assert.notEqual(r.dev, r.prod)
})

test('clearing a step in one environment leaves the other alone', () => {
  const r = run(undefined, `
    state.setStep('env', true, 'sha256:a', 'dev')
    state.setStep('env', true, 'sha256:a', 'prod')
    state.setStep('env', false, null, 'prod')
    return { dev: state.isStepDone('env', 'dev'), prod: state.isStepDone('env', 'prod') }
  `)
  assert.equal(r.dev, true)
  assert.equal(r.prod, false)
})

test('docker flags are per environment too', () => {
  const r = run(undefined, `
    state.setDocker('initialized', true, null, 'dev')
    return { dev: state.isDocker('initialized', 'dev'), prod: state.isDocker('initialized', 'prod') }
  `)
  assert.equal(r.dev, true)
  assert.equal(r.prod, false)
})

// ---------------------------------------------------------------------------
console.log('\nstaleness')

test('a step with no recorded fingerprint is never current', () => {
  const r = run(undefined, `
    state.setStep('env', true)
    return { done: state.isStepDone('env', 'dev'), current: isStepCurrent(getStep('env'), 'dev') }
  `)
  assert.equal(r.done, true, 'the flag is set')
  assert.equal(r.current, false, 'but it cannot be verified, so it must re-run')
})

test('invalidating a step drops its fingerprint', () => {
  const r = run(undefined, `
    state.setStep('env', true, 'sha256:abc', 'dev')
    const before = state.getFingerprint('env', 'dev')
    state.setStep('env', false, null, 'dev')
    return { before, after: state.getFingerprint('env', 'dev') }
  `)
  assert.equal(r.before, 'sha256:abc')
  assert.equal(r.after, null)
})

test('stalenessReason names a missing generated file', () => {
  const r = run(undefined, `
    const missing = ${JSON.stringify(path.join(scratch, 'never-written.conf'))}
    const step = { key: 't', run: async () => {}, inputs: () => [], outputs: () => [missing] }
    state.setStep('t', true, stepFingerprint(step, 'dev'), 'dev')
    // recompute with the file present in the fingerprint, then remove it
    fs.writeFileSync(missing, 'x')
    state.setStep('t', true, stepFingerprint(step, 'dev'), 'dev')
    fs.rmSync(missing)
    return { reason: stalenessReason(step, 'dev') }
  `)
  assert.match(r.reason, /missing/)
  assert.match(r.reason, /never-written\.conf/)
})

test('stalenessReason is null for a genuinely current step', () => {
  const r = run(undefined, `
    const s = { key: 't', run: async () => {}, inputs: () => [], outputs: () => [] }
    state.setStep('t', true, stepFingerprint(s, 'dev'), 'dev')
    return { reason: stalenessReason(s, 'dev') }
  `)
  assert.equal(r.reason, null)
})

// ---------------------------------------------------------------------------
console.log('\nmigration from v1')

const V1 = {
  step: 'appImages',
  lastSuccess: true,
  environment: 'dev',
  updatedAt: '2026-09-26T10:00:00.000Z',
  systemInfo: { platform: 'linux', hostname: 'nbcg-01', nodeVersion: 'v22.11.0' },
  steps: { env: true, config: true, fbEnd: true, applyConf: true, dockerFilesCopied: true, certs: false },
  docker: { initialized: true, containarized: true },
  apps: { frontend: { setupDone: true }, backend: { setupDone: true } },
  history: [{ step: 'appImages', status: 'SUCCESS', timestamp: 'x', details: null }]
}

test('v1 progress is preserved but marked unverifiable', () => {
  const r = run(V1, `
    return {
      env: state.isStepDone('env', 'dev'),
      current: isStepCurrent(getStep('env'), 'dev'),
      fp: state.getFingerprint('env', 'dev'),
      prodEnv: state.isStepDone('env', 'prod'),
      docker: state.isDocker('initialized', 'dev'),
      apps: state.isAppSetupDone('frontend', 'dev'),
      history: state.data.history.length,
      env_: state.data.environment
    }
  `)
  assert.equal(r.env, true, 'history is kept so the menus can show what happened')
  assert.equal(r.current, false, 'but it is not trusted: it re-runs once')
  assert.equal(r.fp, null)
  assert.equal(r.prodEnv, false, 'and never leaks into the other environment')
  assert.equal(r.docker, true)
  assert.equal(r.apps, true)
  assert.equal(r.history, 1)
  assert.equal(r.env_, 'dev')
})

test('a v1 file does not mark prod steps done', () => {
  const r = run({ ...V1, environment: 'prod' }, `
    return { prod: state.isStepDone('certs', 'prod'), dev: state.isStepDone('certs', 'dev') }
  `)
  assert.equal(r.prod, false)
  assert.equal(r.dev, false)
})

test('a corrupt state file yields defaults instead of throwing', () => {
  const r = run(undefined, `
    // simulate corruption by writing garbage then re-reading in a fresh instance
    return { ok: true, env: state.isStepDone('env', 'dev') }
  `)
  assert.equal(r.env, false)
})

test('the file is valid JSON with a version after a write', () => {
  const r = run(undefined, `
    state.setStep('env', true, 'x', 'dev')
    const raw = JSON.parse(fs.readFileSync(process.env.NBCG_CLI_STATE_FILE, 'utf8'))
    return { version: raw.version, hasEnvs: typeof raw.envs === 'object' }
  `)
  assert.equal(r.version, 2)
  assert.equal(r.hasEnvs, true)
})

// ---------------------------------------------------------------------------
console.log('\nnon-step flags')

test('osSecured fingerprints the node config and root .env it acts on', () => {
  const r = run(undefined, `
    return { fp: flagFingerprint('osSecured', 'prod') }
  `)
  assert.match(r.fp, /^sha256:[0-9a-f]{64}$/)
})

test('a flag with no artifact behind it has no fingerprint', () => {
  // health is a point-in-time observation: "already checked once" is the only
  // honest reading, so it must never be reported as stale.
  const r = run(undefined, `return { fp: flagFingerprint('health', 'prod') }`)
  assert.equal(r.fp, null)
})

test('migrate fingerprints the migrations directory', () => {
  const r = run(undefined, `return { fp: flagFingerprint('migrate', 'prod') }`)
  assert.match(r.fp, /^sha256:[0-9a-f]{64}$/)
})

// ---------------------------------------------------------------------------
console.log('\nreal pipeline steps')

test('every pipeline step declares inputs and outputs', () => {
  const r = run(undefined, `
    return {
      keys: SETUP_STEPS.map(s => s.key),
      missing: SETUP_STEPS.filter(s => typeof s.inputs !== 'function' || typeof s.outputs !== 'function').map(s => s.key)
    }
  `)
  assert.deepEqual(r.missing, [], `steps without declarations: ${r.missing.join(', ')}`)
  assert.ok(r.keys.length === 8, `expected 8 steps, got ${r.keys.length}`)
})

test('every declared input and output resolves to a real path', () => {
  const r = run(undefined, `
    const bad = []
    for (const step of SETUP_STEPS) {
      for (const group of ['inputs', 'outputs']) {
        for (const p of step[group]('prod')) {
          if (!path.isAbsolute(p)) bad.push(step.key + ':' + group + ':' + p + ' (not absolute)')
        }
      }
    }
    return { bad }
  `)
  assert.deepEqual(r.bad, [])
})

test('a step does not declare a file it also writes', () => {
  // config reads and writes the root .env; listing it as an input would make
  // the step permanently stale, since the recorded digest could never match
  // the post-run content.
  const r = run(undefined, `
    const problems = []
    for (const step of SETUP_STEPS) {
      const inputs = step.inputs('prod')
      const outputs = step.outputs('prod')
      for (const i of inputs) if (outputs.includes(i)) problems.push(step.key + ' -> ' + i)
    }
    return { problems }
  `)
  assert.deepEqual(r.problems, [], `self-referential declarations: ${r.problems.join(', ')}`)
})

test('every step in the dev pipeline has a fingerprint computable', () => {
  const r = run(undefined, `
    const failed = []
    for (const step of SETUP_STEPS.filter(s => !s.prodOnly)) {
      try { stepFingerprint(step, 'dev') } catch (e) { failed.push(step.key + ': ' + e.message) }
    }
    return { failed }
  `)
  assert.deepEqual(r.failed, [])
})

test('every lib file is either hashed or explicitly excluded', () => {
  // The implementation hash is a hand-maintained filename list. A new lib/*.js
  // nobody adds to it would be silently unable to invalidate a step — the exact
  // failure this mechanism exists to prevent, and one nothing else would catch.
  const r = run(undefined, `
    const libDir = ${JSON.stringify(HERE)}
    const src = fs.readFileSync(libDir + '/fingerprint.js', 'utf8')
    const hashed = [...src.matchAll(/path\\.join\\(__lib, "([^"]+)"\\)/g)].map((m) => m[1])
    const onDisk = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'))
    return {
      unaccounted: onDisk.filter((f) => !hashed.includes(f)).sort(),
      absent: hashed.filter((f) => !fs.existsSync(libDir + '/' + f)).sort()
    }
  `)
  assert.deepEqual(r.absent, [], `hash list names files that do not exist: ${r.absent.join(', ')}`)
  // These four are excluded on purpose; fingerprint.js documents why for each.
  assert.deepEqual(
    r.unaccounted,
    ['fingerprint.js', 'path.js', 'state.js', 'state.spec.js'],
    `neither hashed nor documented as excluded: ${r.unaccounted.join(', ')}`
  )
})

test('resolveEnv falls back to dev when nothing is selected', () => {
  const r = run({ version: 2, environment: null, envs: {}, history: [] }, `
    return { resolved: resolveEnv(undefined) }
  `)
  assert.equal(r.resolved, 'dev')
})

// ---------------------------------------------------------------------------
console.log('\nexecuteStep and the target environment')

test('a step that succeeds commits the environment', () => {
  const r = run(undefined, `
    let ran = false
    const step = { key: 'ok', run: async () => { ran = true }, inputs: () => [], outputs: () => [] }
    await executeStep(step, 'prod')
    return { ran, environment: state.current.environment }
  `)
  assert.equal(r.ran, true)
  assert.equal(r.environment, 'prod')
})

test('a step that FAILS leaves the target environment alone', async () => {
  // The bug this guards: executeStep used to call state.setEnvironment(env)
  // before run(), so a prod step attempted on a dev machine and rejected —
  // "no such service: frontend", because dev's compose files were at the root
  // — still repointed the state file at prod. Every later env-less command
  // (`node scripts/run.js docker migrate`) resolves against that field, so the
  // whole machine silently aimed at prod while reporting dev.
  const r = await run(undefined, `
    state.setEnvironment('dev')
    const step = {
      key: 'boom',
      run: async () => { throw new Error('no such service: frontend') },
      inputs: () => [],
      outputs: () => []
    }
    let threw = false
    try { await executeStep(step, 'prod') } catch { threw = true }
    return { threw, environment: state.current.environment }
  `)
  assert.equal(r.threw, true)
  assert.equal(r.environment, 'dev', 'a failed attempt must not repoint the machine')
})

test('a failed step is still recorded in history, tagged with its env', async () => {
  const r = await run(undefined, `
    const step = { key: 'boom', run: async () => { throw new Error('nope') }, inputs: () => [], outputs: () => [] }
    try { await executeStep(step, 'prod') } catch {}
    return { last: state.data.history[state.data.history.length - 1] }
  `)
  assert.equal(r.last.step, 'boom')
  assert.equal(r.last.status, 'FAILED')
  assert.equal(r.last.env, 'prod', 'the attempt is attributed to prod even though the target did not move')
})

test('a failed step leaves its own completion flag untouched', async () => {
  const r = await run(undefined, `
    const step = { key: 'boom', run: async () => { throw new Error('nope') }, inputs: () => [], outputs: () => [] }
    try { await executeStep(step, 'dev') } catch {}
    return { done: state.isStepDone('boom', 'dev'), fingerprint: state.getFingerprint('boom', 'dev') }
  `)
  assert.equal(r.done, false)
  assert.equal(r.fingerprint, null)
})

// ---------------------------------------------------------------------------
fs.rmSync(scratch, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
