import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import crypto from "node:crypto"
import { spawn } from "node:child_process"
import { getContainerStates } from "./docker-utils.js"
import { classifyStates } from "./wait-healthy.js"
import { parseEnvFile, ROOT_ENV_PATH } from "./env-utils.js"
import { loadMasterConfig } from "./config-utils.js"
import { __root, __docker, __backend, __frontend } from "./path.js"

// Same files docker-utils.js uses for every compose call.
const COMPOSE_FLAGS = ["-f", "docker-compose.yml", "-f", "docker-compose.ext.yml"]

/**
 * The verification subsystem: independent probes of everything `docker compose
 * ps` cannot see — HTTP endpoints, database readiness and migration drift,
 * keycloak reachability, certificate expiry, disk headroom — plus an optional
 * end-to-end smoke suite (token issuance → authenticated API call → anonymous
 * rejection).
 *
 * Everything here is read-only. `runVerify()` assembles a report with a
 * three-level exit code (0 clean / 1 degraded / 2 down) that the CLI, cron and
 * the Ansible deploy gate all consume from the same code path.
 */

// ---------------------------------------------------------------------------
// Low-level probes
// ---------------------------------------------------------------------------

/**
 * HTTP(S) GET with timeout and optional self-signed tolerance.
 * Never throws; resolves {ok, status, body, headers, ms} or {ok:false, error}.
 */
export function httpProbe(url, options = {}) {
  const { method = "GET", headers = {}, timeoutMs = 8000, insecure = false, body = null } = options
  return new Promise((resolve) => {
    const started = Date.now()
    let lib
    try {
      lib = new URL(url).protocol === "https:" ? https : http
    } catch (error) {
      return resolve({ ok: false, error: `bad url: ${error.message}`, ms: 0 })
    }

    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve({ ...r, ms: Date.now() - started }) } }

    const req = lib.request(url, {
      method,
      headers,
      rejectUnauthorized: !insecure,
      timeout: timeoutMs,
    }, (res) => {
      let data = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => { if (data.length < 128 * 1024) data += chunk })
      res.on("end", () => done({ ok: true, status: res.statusCode, headers: res.headers, body: data }))
      res.on("error", (error) => done({ ok: false, error: error.message || error.code || "response error" }))
    })
    req.on("timeout", () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)) })
    req.on("error", (error) => done({ ok: false, error: error.message || error.code || "connection error" }))
    if (body) req.write(body)
    req.end()
  })
}

/** TCP connect test. Never throws. */
export function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = net.connect({ host, port })
    const done = (result) => { socket.destroy(); resolve({ ...result, ms: Date.now() - started }) }
    socket.setTimeout(timeoutMs)
    socket.on("connect", () => done({ ok: true }))
    socket.on("timeout", () => done({ ok: false, error: `timeout after ${timeoutMs}ms` }))
    socket.on("error", (error) => done({ ok: false, error: error.message }))
  })
}

/**
 * Runs a command inside a service's container with a hard timeout. Secrets go
 * in via `-e NAME` (value taken from this process's environment) — never argv.
 * Never throws; resolves {ok, code, stdout, stderr, ms}.
 */
export function execProbe(service, argv, options = {}) {
  const { env = {}, timeoutMs = 15000 } = options
  return new Promise((resolve) => {
    const started = Date.now()
    const envFlags = Object.keys(env).flatMap(name => ["-e", name])
    const proc = spawn("docker", [
      "compose", ...COMPOSE_FLAGS, "exec", "-T", ...envFlags, service, ...argv,
    ], {
      cwd: __root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = "", stderr = ""
    proc.stdout.on("data", (c) => { stdout += c })
    proc.stderr.on("data", (c) => { stderr += c })

    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    const done = (r) => {
      clearTimeout(timer)
      resolve({ ...r, stdout: stdout.trim(), stderr: stderr.trim(), ms: Date.now() - started })
    }
    proc.on("close", (code) => done({ ok: code === 0, code }))
    proc.on("error", (error) => done({ ok: false, code: -1, error: error.message }))
  })
}

/** `docker compose config -q` against the generated root files. */
function composeConfigValid() {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["compose", ...COMPOSE_FLAGS, "config", "-q"], {
      cwd: __root, stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    proc.stderr.on("data", (c) => { stderr += c })
    const timer = setTimeout(() => proc.kill("SIGKILL"), 20000)
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, detail: code === 0 ? "" : stderr.trim().split("\n")[0] || `exit ${code}` })
    })
    proc.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, detail: error.message }) })
  })
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Resolves URLs and credentials for a probe run.
 *
 * dev  — everything is published on localhost by the compose files, apps run
 *        under pm2 (frontend 3080, backend 3000).
 * prod — nginx is the only published surface and it rejects unknown Host
 *        headers with 444, so probes go to 127.0.0.1 with the canonical
 *        hostname as the Host header and the internal CA tolerated (-k).
 */
export function verifyContext(env) {
  const rootEnv = fs.existsSync(ROOT_ENV_PATH) ? parseEnvFile(ROOT_ENV_PATH) : {}
  let master = {}
  try { master = loadMasterConfig() } catch { master = {} }
  const canonical = master.available_hostnames?.[0] || "localhost"
  const realm = rootEnv.KEYCLOAK_REALM || "nbcg"
  const num = (v, fallback) => Number(v) || fallback

  if (env === "prod") {
    return {
      env, rootEnv, canonical, realm,
      frontendUrl: "https://127.0.0.1/",
      backendBase: "https://127.0.0.1/api",
      keycloakBase: "https://127.0.0.1/auth",
      httpOpts: { insecure: true, headers: { Host: canonical } },
      publishedPorts: [80, 443],
    }
  }

  return {
    env, rootEnv, canonical, realm,
    frontendUrl: `http://localhost:${num(rootEnv.FRONTEND_PORT, 3080)}/`,
    backendBase: `http://localhost:${num(rootEnv.BACKEND_PORT, 3000)}/api`,
    keycloakBase: `http://localhost:${num(rootEnv.KEYCLOAK_PORT, 8082)}`,
    httpOpts: {},
    publishedPorts: [
      num(rootEnv.POSTGRES_PORT, 15432),
      num(rootEnv.REDIS_PORT, 6379),
      num(rootEnv.KEYCLOAK_PORT, 8082),
      num(rootEnv.OPENSEARCH_NODE_P1, 9200),
    ],
  }
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

const pass = (detail) => ({ status: "pass", detail })
const warn = (detail) => ({ status: "warn", detail })
const fail = (detail) => ({ status: "fail", detail })
const skip = (detail) => ({ status: "skip", detail })

export function probeDefinitions(ctx, { smoke = false } = {}) {
  const { env, rootEnv, realm } = ctx
  const probes = []

  // --- config layer --------------------------------------------------------
  probes.push(["config", "compose-files", () => {
    const files = ["docker-compose.yml", "docker-compose.ext.yml"].map(f => path.join(__root, f))
    const missing = files.filter(f => !fs.existsSync(f))
    return missing.length
      ? fail(`missing at repo root: ${missing.map(f => path.basename(f)).join(", ")} — run setup`)
      : pass("both compose files present at repo root")
  }])

  probes.push(["config", "compose-valid", async () => {
    const r = await composeConfigValid()
    return r.ok ? pass("docker compose config parses") : fail(`compose config invalid: ${r.detail}`)
  }])

  probes.push(["config", "root-env", () => {
    if (!fs.existsSync(ROOT_ENV_PATH)) return fail(".env missing at repo root — run setup")
    const envFile = parseEnvFile(ROOT_ENV_PATH)
    return envFile.ENV ? pass(`root .env rendered (ENV=${envFile.ENV})`) : warn("root .env has no ENV= key")
  }])

  probes.push(["config", "app-envs", () => {
    if (env !== "dev") return skip("apps are containers in prod")
    const missing = [path.join(__frontend, ".env"), path.join(__backend, ".env")].filter(f => !fs.existsSync(f))
    return missing.length ? warn(`missing: ${missing.map(f => path.basename(path.dirname(f)) + "/" + path.basename(f)).join(", ")} (run the fbEnd step)`) : pass("frontend/.env and backend/.env present")
  }])

  // --- containers layer ----------------------------------------------------
  probes.push(["containers", "containers", async () => {
    let states
    try { states = await getContainerStates() } catch (error) {
      return fail(`could not query compose: ${error.message}`)
    }
    if (states.length === 0) return fail("no containers exist — start the stack (make up)")
    const { failed, pending } = classifyStates(states)
    if (failed.length) {
      return fail(failed.map(s => `${s.service} (${s.state}${s.health ? `/${s.health}` : ""})`).join(", "))
    }
    if (pending.length) {
      return warn(`starting: ${pending.map(s => s.service).join(", ")}`)
    }
    return pass(`${states.length}/${states.length} running, all healthy`)
  }])

  // --- services layer ------------------------------------------------------
  probes.push(["services", "redis", async () => {
    const r = await execProbe("redis", ["redis-cli", "ping"], { timeoutMs: 8000 })
    return r.ok && /PONG/.test(r.stdout) ? pass("PING → PONG") : fail(`redis-cli ping: ${r.stdout || r.stderr || r.error || `exit ${r.code}`}`)
  }])

  probes.push(["services", "postgres", async () => {
    const user = rootEnv.POSTGRES_USER || "nbcg"
    const db = rootEnv.POSTGRES_DB || "nbcg"
    const r = await execProbe("db", ["pg_isready", "-U", user, "-d", db], { timeoutMs: 8000 })
    return r.ok ? pass(`pg_isready (${user}@${db})`) : fail(`pg_isready: ${r.stdout || r.stderr || r.error || `exit ${r.code}`}`)
  }])

  probes.push(["services", "opensearch", async () => {
    if (env === "dev") {
      const r = await httpProbe("http://localhost:9200/_cluster/health", { ...ctx.httpOpts, timeoutMs: 8000 })
      if (!r.ok) return fail(`cluster health unreachable: ${r.error}`)
      if (r.status !== 200) return fail(`cluster health HTTP ${r.status}`)
      try {
        const health = JSON.parse(r.body)
        const status = health.status
        return status === "red" ? fail(`cluster status: red`) : pass(`cluster status: ${status}`)
      } catch { return fail("cluster health returned non-JSON") }
    }
    const pw = rootEnv.OPENSEARCH_INITIAL_ADMIN_PASSWORD
    if (!pw) return warn("no admin password in .env — cannot probe cluster")
    const r = await execProbe("opensearch-node",
      ["sh", "-c", 'curl -s -k -u "admin:$PW" https://localhost:9200/_cluster/health'],
      { env: { PW: pw }, timeoutMs: 12000 })
    if (!r.ok) return fail(`in-container probe failed: ${r.stderr || r.error || `exit ${r.code}`}`)
    try {
      const health = JSON.parse(r.stdout)
      return health.status === "red" ? fail("cluster status: red") : pass(`cluster status: ${health.status}`)
    } catch { return fail(`non-JSON response: ${r.stdout.slice(0, 80)}`) }
  }])

  probes.push(["services", "keycloak", async () => {
    const url = `${ctx.keycloakBase}/realms/${realm}/.well-known/openid-configuration`
    const r = await httpProbe(url, { ...ctx.httpOpts, timeoutMs: 10000 })
    if (!r.ok) return fail(`discovery unreachable: ${r.error}`)
    if (r.status !== 200) return fail(`discovery HTTP ${r.status}`)
    try {
      const doc = JSON.parse(r.body)
      return typeof doc.issuer === "string" ? pass(`realm "${realm}" reachable (issuer ${doc.issuer})`) : warn("discovery document has no issuer")
    } catch { return fail("discovery returned non-JSON") }
  }])

  probes.push(["services", "backend-health", async () => {
    const r = await httpProbe(`${ctx.backendBase}/health`, { ...ctx.httpOpts, timeoutMs: 8000 })
    if (!r.ok) return fail(`unreachable: ${r.error}`)
    if (r.status !== 200) return fail(`HTTP ${r.status}`)
    try {
      const body = JSON.parse(r.body)
      return body.status === "ok" ? pass(`status: ok`) : warn(`unexpected body: ${r.body.slice(0, 60)}`)
    } catch { return fail("non-JSON response") }
  }])

  probes.push(["services", "frontend", async () => {
    const r = await httpProbe(ctx.frontendUrl, { ...ctx.httpOpts, timeoutMs: 8000 })
    if (!r.ok) return fail(`unreachable: ${r.error}`)
    if (r.status < 200 || r.status >= 400) return fail(`HTTP ${r.status}`)
    return pass(`HTTP ${r.status}`)
  }])

  probes.push(["services", "published-ports", async () => {
    const results = []
    for (const port of ctx.publishedPorts) {
      const r = await tcpProbe("localhost", port)
      results.push({ port, ok: r.ok, error: r.error })
    }
    const dead = results.filter(r => !r.ok)
    if (dead.length > 0)
      return fail(`not accepting connections: ${dead.map(d => `${d.port} (${d.error})`).join(", ")}`)
    return pass(results.map(r => r.port).join(", "))
  }])

  // --- data layer ----------------------------------------------------------
  probes.push(["data", "migrations", async () => {
    const dir = path.join(__backend, "prisma", "migrations")
    let local = 0
    try { local = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).length }
    catch { return warn("backend/prisma/migrations not readable") }

    const user = rootEnv.POSTGRES_USER || "nbcg"
    const db = rootEnv.POSTGRES_DB || "nbcg"
    const pw = rootEnv.POSTGRES_PASSWORD
    if (!pw) return warn("no POSTGRES_PASSWORD in .env — cannot check applied migrations")
    const r = await execProbe("db",
      ["psql", "-U", user, "-d", db, "-tAc", "select count(*) from _prisma_migrations where finished_at is not null"],
      { env: { PGPASSWORD: pw }, timeoutMs: 10000 })
    if (!r.ok) return warn(`could not query _prisma_migrations: ${r.stderr || r.error || `exit ${r.code}`}`)
    const applied = Number(r.stdout.trim())
    if (!Number.isFinite(applied)) return warn(`unexpected psql output: ${r.stdout.slice(0, 60)}`)
    if (applied < local) return warn(`${local - applied} migration(s) pending — run make migrate`)
    if (applied > local) return warn(`database has ${applied - local} migration(s) the repo does not know about`)
    return pass(`${applied}/${local} applied`)
  }])

  probes.push(["data", "disk-space", () => {
    try {
      const st = fs.statfsSync(__root)
      const freePct = Math.round((st.bfree / st.blocks) * 100)
      const freeGb = Math.round((st.bfree * st.bsize) / 1e9)
      if (freePct < 10) return fail(`only ${freePct}% (${freeGb} GB) free`)
      if (freePct < 20) return warn(`${freePct}% (${freeGb} GB) free`)
      return pass(`${freePct}% (${freeGb} GB) free`)
    } catch (error) { return warn(`statfs failed: ${error.message}`) }
  }])

  if (env === "prod") {
    probes.push(["data", "htpasswd", () => {
      const file = path.join(__docker, "nginx", "htpasswd")
      if (!fs.existsSync(file)) return fail("nginx/htpasswd missing — admin UIs would be exposed or broken")
      const content = fs.readFileSync(file, "utf8").trim()
      return content.includes(":")
        ? pass(`${content.split("\n").filter(Boolean).length} credential row(s)`)
        : fail("htpasswd is credential-less — set ADMIN_UI_HTPASSWD in prod env")
    }])

    probes.push(["data", "cert-expiry", () => {
      const file = path.join(__docker, "certs", "nginx", "server.crt")
      if (!fs.existsSync(file)) return warn("nginx server.crt not found (external cert expected?)")
      try {
        const cert = new crypto.X509Certificate(fs.readFileSync(file))
        const days = Math.floor((Date.parse(cert.validTo) - Date.now()) / 86400000)
        if (days < 14) return fail(`nginx certificate expires in ${days} day(s) (${cert.validTo})`)
        if (days < 30) return warn(`nginx certificate expires in ${days} day(s)`)
        return pass(`${days} day(s) until expiry`)
      } catch (error) { return fail(`could not parse certificate: ${error.message}`) }
    }])
  }

  // --- smoke suite ---------------------------------------------------------
  if (smoke) {
    const tokenUrl = `${ctx.keycloakBase}/realms/${realm}/protocol/openid-connect/token`
    const smokeToken = async () => {
      const secret = rootEnv.KEYCLOAK_WORKER_CLIENT_SECRET
      if (!secret) return { error: "KEYCLOAK_WORKER_CLIENT_SECRET not in .env" }
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "nbcg-worker",
        client_secret: secret,
      }).toString()
      const r = await httpProbe(tokenUrl, {
        ...ctx.httpOpts,
        method: "POST",
        headers: { ...(ctx.httpOpts.headers || {}), "Content-Type": "application/x-www-form-urlencoded" },
        body,
        timeoutMs: 10000,
      })
      if (!r.ok) return { error: `token endpoint unreachable: ${r.error}` }
      if (r.status !== 200) return { error: `token endpoint HTTP ${r.status}: ${r.body.slice(0, 120)}` }
      try { return { token: JSON.parse(r.body).access_token } }
      catch { return { error: "token response non-JSON" } }
    }

    probes.push(["smoke", "token-issued", async () => {
      const r = await smokeToken()
      return r.token ? pass("client_credentials token issued (nbcg-worker)") : fail(r.error)
    }])

    probes.push(["smoke", "authenticated-accepted", async () => {
      const r = await smokeToken()
      if (!r.token) return fail(`no token to test with: ${r.error}`)
      const url = `${ctx.backendBase}/import/jobs/00000000-smoke-nonexistent`
      const res = await httpProbe(url, {
        ...ctx.httpOpts,
        headers: { ...(ctx.httpOpts.headers || {}), Authorization: `Bearer ${r.token}` },
        timeoutMs: 10000,
      })
      if (!res.ok) return fail(`unreachable: ${res.error}`)
      if (res.status === 401 || res.status === 403)
        return fail(`backend rejected a valid worker token (HTTP ${res.status}) — Keycloak/JWKS or scope mapping broken`)
      return pass(`accepted (HTTP ${res.status}; JWT validated against Keycloak)`)
    }])

    probes.push(["smoke", "anonymous-rejected", async () => {
      const url = `${ctx.backendBase}/import/jobs/00000000-smoke-nonexistent`
      const res = await httpProbe(url, { ...ctx.httpOpts, timeoutMs: 10000 })
      if (!res.ok) return fail(`unreachable: ${res.error}`)
      return (res.status === 401 || res.status === 403)
        ? pass(`scope guard rejects anonymous (HTTP ${res.status})`)
        : fail(`anonymous request was NOT rejected (HTTP ${res.status}) — scope enforcement broken`)
    }])
  }

  return probes
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Exit-code policy in one place (tested directly): fail→2, warn→1, clean→0. */
export function summariseProbes(probes) {
  const fails = probes.filter(p => p.status === "fail")
  const warns = probes.filter(p => p.status === "warn")
  const exitCode = fails.length > 0 ? 2 : warns.length > 0 ? 1 : 0
  const verdict = exitCode === 2 ? "DOWN" : exitCode === 1 ? "DEGRADED" : "OK"
  return { exitCode, verdict, failCount: fails.length, warnCount: warns.length }
}

/**
 * Runs every probe, sequentially (they hit the same stack; a parallel run
 * would add load without adding signal). Returns the full report object.
 *
 * exitCode: 2 = any fail (stack down/broken), 1 = warnings only (degraded),
 * 0 = clean.
 */
export async function runVerify({ env = "dev", smoke = false } = {}) {
  const ctx = verifyContext(env)
  const probes = []
  for (const [layer, name, fn] of probeDefinitions(ctx, { smoke })) {
    const started = Date.now()
    let result
    try {
      result = await fn()
    } catch (error) {
      result = { status: "fail", detail: `probe crashed: ${error.message}` }
    }
    probes.push({ layer, name, ...result, ms: result?.ms ?? Date.now() - started })
  }

  return { env, probes, ...summariseProbes(probes) }
}

const ICONS = { pass: "✓", warn: "!", fail: "✗", skip: "-" }

export function formatVerifyReport(result) {
  const lines = [`VERIFY  env=${result.env}`, ""]
  let layer = null
  for (const p of result.probes) {
    if (p.layer !== layer) {
      layer = p.layer
      lines.push(`  ${layer}`)
    }
    lines.push(`    ${ICONS[p.status] ?? "?"} ${p.name.padEnd(24)} ${p.detail}${p.ms > 200 ? ` (${p.ms}ms)` : ""}`)
  }
  const counts = ["pass", "warn", "fail", "skip"]
    .map(s => ({ s, n: result.probes.filter(p => p.status === s).length }))
    .filter(x => x.n > 0)
    .map(x => `${x.n} ${x.s}`)
    .join(" · ")
  lines.push("")
  lines.push(`  ${result.verdict}: ${counts}  (exit ${result.exitCode})`)
  return lines.join("\n")
}
