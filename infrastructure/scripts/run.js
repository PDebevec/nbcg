/**
 * Non-interactive entry point. Every action the interactive CLI offers is
 * reachable here as a one-shot command, so a failing step can be re-run in
 * isolation with its error left on screen.
 *
 *   node scripts/run.js list
 *   node scripts/run.js check
 *   node scripts/run.js setup dev
 *   node scripts/run.js step config dev
 *   node scripts/run.js step fbEnd --force
 *   node scripts/run.js docker up db redis
 *   node scripts/run.js app start backend
 *
 * State bookkeeping goes through the same executeStep() the menus use, so
 * .cli-state.json ends up identical whichever entry point you drive.
 */
import path from "node:path"
import { state } from "./lib/state.js"
import { selfRun, parseArgs, parseEnvArg, UsageError } from "./lib/runner.js"
import { checkRequirements } from "./requirements.js"
import { getAppConfig } from "./init-env.js"
import { runMigrations, runHealthChecks } from "./lib/db-utils.js"
import { configureSecurity } from "./lib/opensearch-utils.js"
import { startStack } from "./lib/reconcile-utils.js"
import { CLEAR_TARGETS, describeArtifacts, describeClearTarget } from "./lib/clear-utils.js"
import { findMissingKeys, findExtraKeys, mergeTemplateDefaults, auditSecrets } from "./lib/config-utils.js"
import { snapshotConfig, historyEntries, restoreSnapshot, diffSummary } from "./lib/config-history.js"
import {
  SETUP_STEPS, getStep, getApplicableSteps, getStepDeps, getUnmetDeps, executeStep, getStepTitle,
  isStepCurrent, stalenessReason, resolveEnv
} from "./lib/steps.js"
import {
  stopContainers, restartContainers, buildContainers,
  pullContainers, createContainers, downContainers,
  getContainerLogs, getContainerStatuses, getContainerStates, getDefinedServices
} from "./lib/docker-utils.js"
import {
  runSetupCommands, startApp, stopApp, restartApp, deleteApp, listApps, viewLogs
} from "./lib/app-utils.js"
import { acquireLock, tryAcquireLock } from "./lib/lock.js"
import { syncDockerFlags } from "./lib/truth.js"
import { waitForHealthy } from "./lib/wait-healthy.js"
import { runVerify, formatVerifyReport, httpProbe, verifyContext } from "./lib/probe-utils.js"
import { doctorReport, formatDoctorReport, doctorRepair, doctorExitCode } from "./lib/doctor-utils.js"

const DOCKER_ACTIONS = {
  // Reconciles Postgres/OpenSearch credentials with the current .env around
  // every prod up — cheap and idempotent, so the stack can never end up
  // running on stale credentials after secrets are regenerated, and a
  // dependent service failing its healthcheck over exactly that self-heals
  // on retry instead of leaving `up` failed. See reconcile-utils.js.
  up: (services) => startStack(services, currentEnv()),
  stop: (services) => stopContainers(services),
  restart: (services) => restartContainers(services),
  create: (services) => createContainers(services),
  build: (services) => buildContainers(services),
  pull: (services) => pullContainers(services),
  logs: (services) => getContainerLogs(services),
  ps: () => getContainerStatuses(),
  services: async () => { console.log((await getDefinedServices()).join("\n")) },
  down: () => downContainers(false),
  "down-v": () => downContainers(true),
  migrate: () => runMigrations(currentEnv()),
  health: () => runHealthChecks(),
  "os-secure": () => configureSecurity()
}

const APP_ACTIONS = {
  setup: async (app) => {
    await runSetupCommands(app, getAppConfig(app).setup)
    state.setAppSetup(app, true)
  },
  start: (app) => startApp(app, getAppConfig(app).run),
  stop: (app) => stopApp(app),
  restart: (app) => restartApp(app),
  delete: (app) => deleteApp(app),
  logs: (app) => viewLogs(app),
  list: async () => {
    const list = await listApps()
    if (list.length === 0) console.log("No frontend/backend processes running.")
    else for (const p of list) console.log(`${p.name}: ${p.pm2_env?.status ?? "unknown"} (pid ${p.pid ?? "-"})`)
  }
}

const currentEnv = () => state.current.environment || "dev"

/**
 * Does this invocation mutate shared state — .cli-state.json, generated
 * files, or the stack itself — and therefore need the run lock?
 *
 * Read-only commands (list, check, help, docker ps/logs/services, app
 * logs/list, config diff) stay lock-free so status checks never queue behind
 * a long op. `docker health` and `migrate` count as mutating: they write
 * state flags. Dry-runs never mutate, so they never take the lock.
 */
function needsLock(command, rest, flags) {
  if (flags["dry-run"]) return false
  switch (command) {
    case "setup":
    case "step":
    case "verify":
      return true
    case "doctor":
      return flags.repair === true && flags["dry-run"] !== true
    case "clear":
      return Boolean(rest[0]) && rest[0] !== "list"
    case "config": {
      const action = rest[0] || "diff"
      if (action === "apply" && flags["dry-run"]) return false
      return ["merge", "apply", "revert"].includes(action)
    }
    case "docker": {
      const action = rest[0]
      return Boolean(action) && !["ps", "logs", "services"].includes(action)
    }
    case "app": {
      const action = rest[0]
      return Boolean(action) && !["logs", "list"].includes(action)
    }
    default:
      return false
  }
}

function printUsage() {
  console.log(`
Usage: node scripts/run.js <command> [args] [--flags]

  list                       Show every runnable step and action
  check                      Verify prerequisites (binaries, docker daemon)
  verify [env]               Probe the running stack (config, containers, HTTP,
                             db/migrations, disk) — exit 0 clean / 1 degraded / 2 down
  doctor [env]               Repairability report: stale steps, container and
                             image drift, probe failures — FLAGS=--repair runs
                             the safe Tier-1 fixes and re-verifies
  setup [env]                Run the whole pipeline for env (default: ${currentEnv()})
  step <key> [env]           Run a single setup step
  docker <action> [svc...]   ${Object.keys(DOCKER_ACTIONS).join(" | ")}
  app <action> [target]      ${Object.keys(APP_ACTIONS).join(" | ")}
  clear [target|list]        ${Object.keys(CLEAR_TARGETS).join(" | ")}
  config diff|merge          master.config vs template / add new template keys
  config apply [env]         Re-render master-derived files + compose, snapshot
                             history first, re-apply services, verify
                             (FLAGS=--dry-run plans without changing anything)
  config revert [n]          Restore generated files from history entry n
                             (default latest; master.config.json untouched)
                             and re-apply/verify — no re-render
  config audit [env]         Where every secret-looking key comes from

Flags:
  --force                    Run a step even if its dependencies are unmet
  --yes                      Confirm a destructive clear target
  --rotate                   step env prod: generate fresh secrets instead of
                             reusing the ones already in the root .env
  --dry-run                  Print what setup/step/docker/app/clear/config-merge
                             would do and exit without changing anything
  --wait                     Queue behind another operation holding the CLI
                             lock instead of failing immediately (60s max)
  --no-wait                  docker up: return as soon as compose exits,
                             without waiting for services to become healthy
  --json                     verify: machine-readable report on stdout
  --smoke                    verify: also run the end-to-end smoke suite
                             (token issuance → authenticated API → anon rejection)
  --gate                     verify: exit 0 unless a probe FAILED (warnings
                             tolerated) — the form deploy gates should use
`.trim())
}

// Three states, not two. A step that ran once but whose inputs, outputs or
// implementation have moved is "stale" — it is not done, and saying "done"
// here is exactly what made a git pull look like a successful deploy.
function stepMarker(step, env) {
  if (isStepCurrent(step, env)) return "done"
  return state.isStepDone(step.key, env) ? "stale" : "    "
}

function cmdList() {
  const env = currentEnv()
  console.log(`Setup steps (env: ${env})\n`)
  for (const step of SETUP_STEPS) {
    const marker = stepMarker(step, env)
    const tags = [
      step.prodOnly ? "prod-only" : null,
      step.takesEnv ? "takes <env>" : null,
      `after: ${getStepDeps(step, env).join(", ") || "nothing"}`
    ].filter(Boolean).join("; ")
    console.log(`  [${marker}] ${step.key.padEnd(18)} ${step.describe}`)
    console.log(`           ${" ".repeat(18)} (${tags})`)
    if (marker === "stale") {
      const reason = stalenessReason(step, env)
      if (reason) console.log(`           ${" ".repeat(18)} stale: ${reason}`)
    }
  }
  console.log(`\nDocker actions: ${Object.keys(DOCKER_ACTIONS).join(", ")}`)
  console.log(`App actions:    ${Object.keys(APP_ACTIONS).join(", ")}`)
}

async function cmdStep(positional, flags) {
  const [key, envArg] = positional
  if (!key) throw new UsageError("step requires a step key — try `node scripts/run.js list`")

  const step = getStep(key)
  const env = parseEnvArg(envArg, currentEnv())

  if (step.prodOnly && env !== "prod")
    throw new UsageError(`Step "${key}" only applies to the prod environment`)

  if (flags["dry-run"]) {
    const status = isStepCurrent(step, env)
      ? "done and current"
      : state.isStepDone(step.key, env)
        ? `stale (${stalenessReason(step, env) ?? "changed since it last ran"})`
        : "not run yet"
    console.log(`[dry-run] would run step "${key}" for env "${env}" — currently: ${status}`)
    const unmet = getUnmetDeps(step, env)
    if (unmet.length > 0)
      console.log(`[dry-run] unmet dependencies: ${unmet.join(", ")}${flags.force ? " (bypassed by --force)" : " (would refuse without --force)"}`)
    console.log(`[dry-run] inputs:  ${(typeof step.inputs === "function" ? step.inputs(env) : step.inputs || []).map(f => path.relative(process.cwd(), f)).join(", ") || "(none)"}`)
    const outputs = typeof step.outputs === "function" ? step.outputs(env) : step.outputs || []
    console.log(`[dry-run] outputs: ${outputs.map(f => path.relative(process.cwd(), f)).join(", ") || "(none)"}`)
    console.log("[dry-run] no changes made.")
    return
  }

  const unmet = getUnmetDeps(step, env)
  if (unmet.length > 0 && !flags.force)
    throw new UsageError(`Step "${key}" needs these first: ${unmet.join(", ")} (use --force to run anyway)`)
  if (unmet.length > 0)
    console.log(`--force: running "${key}" with unmet dependencies: ${unmet.join(", ")}`)

  if (flags.rotate && key !== "env")
    throw new UsageError(`--rotate only applies to the "env" step`)

  await executeStep(step, env, { rotate: flags.rotate })
  console.log(`\nStep "${key}" complete.`)
}

async function cmdSetup(positional, flags = {}) {
  const env = parseEnvArg(positional[0], currentEnv())
  const steps = getApplicableSteps(env)

  if (flags["dry-run"]) {
    console.log(`[dry-run] setup for env "${env}" would execute, in order:`)
    steps.forEach((step, i) => {
      const status = isStepCurrent(step, env)
        ? "done (would re-run: outputs regenerated from current inputs)"
        : state.isStepDone(step.key, env)
          ? `stale — ${stalenessReason(step, env) ?? "changed since it last ran"}`
          : "not run yet"
      console.log(`  ${i + 1}. ${step.key.padEnd(18)} ${status}`)
    })
    console.log(`[dry-run] ${steps.length} step(s); no changes made.`)
    return
  }

  for (const step of steps) {
    console.log(`\n=== ${getStepTitle(step, env)} ===`)
    await executeStep(step, env)
  }
  console.log(`\nSetup complete for env "${env}".`)
}

// Actions that create or recreate containers from the compose files must not
// run against stale copies: the interactive menu has always gated this way,
// the dispatcher had not, so a scripted `up` could start the stack from
// hand-edited or outdated root compose files (the exact failure mode behind
// the valkey image change living only in the generated root file). --force is
// the explicit escape hatch.
const GATED_DOCKER_ACTIONS = new Set(["up", "create", "build"])

function gateDockerAction(action, flags) {
  if (!GATED_DOCKER_ACTIONS.has(action) || flags.force) return
  const env = currentEnv()
  const step = getStep("dockerFilesCopied")
  if (isStepCurrent(step, env)) return
  const reason = stalenessReason(step, env) ?? "not run yet for this environment"
  throw new UsageError(
    `Refusing to "${action}": the docker files are not current for env "${env}" (${reason}).\n` +
    `Run "make step STEP=dockerFilesCopied ENV=${env}" to re-sync them, ` +
    `or pass --force to proceed against the stale copies anyway.`
  )
}

// Read-only-ish plans for --dry-run. Deliberately textual: the plan's job is
// to say what would happen, not to be re-executed.
function dockerPlan(action, services) {
  const scope = services.length ? ` ${services.join(" ")}` : ""
  const files = "-f docker-compose.yml -f docker-compose.ext.yml"
  const plans = {
    up: `docker compose ${files} up -d${scope}\n         then wait until the target services are running and healthy (--no-wait skips the wait)`,
    stop: `docker compose ${files} stop${scope}`,
    restart: `docker compose ${files} restart${scope}`,
    create: `docker compose ${files} up --no-start${scope}`,
    build: `docker compose ${files} build${scope}`,
    pull: `docker compose ${files} pull${scope}`,
    down: `docker compose ${files} down          (containers + networks, volumes kept)`,
    "down-v": `docker compose ${files} down -v      (DESTRUCTIVE: removes volumes, i.e. all data)`,
    migrate: `prisma migrate deploy${scope} against the running db (${currentEnv()}); records the migrate flag`,
    health: "run the health checks and record the health flag only if they pass",
    "os-secure": "configure OpenSearch security (prod only); records the osSecured flag on success",
    logs: `docker compose ${files} logs -f${scope}  (read-only)`,
    ps: `docker compose ${files} ps -a  (read-only)`,
    services: "docker compose config --services  (read-only)",
  }
  return plans[action] ?? action
}

async function cmdDocker(positional, flags = {}) {
  const [action, ...services] = positional
  const handler = DOCKER_ACTIONS[action]
  if (!handler)
    throw new UsageError(`Unknown docker action "${action ?? ""}". Valid: ${Object.keys(DOCKER_ACTIONS).join(", ")}`)

  gateDockerAction(action, flags)

  const READ_ONLY = new Set(["ps", "logs", "services"])
  if (flags["dry-run"] && !READ_ONLY.has(action)) {
    console.log(`[dry-run] would run:\n         ${dockerPlan(action, services)}`)
    console.log("[dry-run] no changes made.")
    return
  }

  const result = await handler(services)

  // Flag bookkeeping — each flag is only set when its meaning actually
  // happened. `containarized` is no longer written here at all: it is
  // derived from live compose state on every entry point (lib/truth.js).
  if (action === "migrate") state.setStep("migrate", true)
  // Health is a point-in-time verdict: recording it on a run that reported
  // "no containers" or found failures made `make list` claim health done
  // while the stack was down.
  if (action === "health" && result?.ok === true) state.setStep("health", true)
  if (action === "os-secure") state.setStep("osSecured", true)
  // Only when security was actually applied during this prod up (i.e. the
  // opensearch-node was up and configureSecurity() completed) — not on every
  // prod `up` regardless of what ran.
  if (action === "up" && result?.securityApplied === true) state.setStep("osSecured", true)

  // Actions that summarise themselves (migrate, health) report it; the rest
  // already stream docker's own output to the terminal.
  const message = typeof result === "string" ? result : result?.message
  if (message) console.log(`\n${message}`)

  // The dispatcher is also a health *probe* for scripts and cron: a failing
  // verdict (including "no containers") must be visible in the exit code,
  // not just in the printed table. The interactive menu uses the same
  // function but never reads this exit code.
  if (action === "health" && result?.ok !== true) process.exitCode = 1

  // Verified up: compose exiting ≠ stack working (containers can still be
  // starting or crash-looping). Waits only for the scoped services.
  if (action === "up" && !flags["no-wait"]) {
    const wait = await waitForHealthy({
      services,
      onStatus: (note) => console.log(note),
    })
    if (wait.ok) {
      console.log(`\n${wait.total} service(s) healthy after ${wait.waitedSec}s.`)
    } else {
      console.log(`\nNot healthy after ${wait.waitedSec}s:\n${wait.report}`)
      console.log("Inspect with `make health`; recent changes with `make docker A=logs SVC=<svc>`.")
      process.exitCode = 1
    }
  }
}

// The steps whose outputs derive from master.config.json (+ the env files it
// merges into). `config apply` re-runs these; `config revert` deliberately
// stops short of certs/osSecurity — re-running those would REISSUE
// certificates rather than restore them, and a reverting operator wants the
// old config back, not fresh certs. If master.config changed something
// cert-related, the staleness shows up in `make doctor` instead of being
// silently re-issued.
const APPLY_RENDER_CHAIN = ["env", "config", "fbEnd", "applyConf", "certs", "osSecurity", "dockerFilesCopied"]

/**
 * Re-runs stale steps from `chain` until the chain settles (dependents go
 * stale when a step re-runs, so one pass is not enough). Capped so nothing
 * can loop. With dryRun, lists what would re-run without executing.
 */
async function renderChain(env, chain, { dryRun = false, actions = [] } = {}) {
  for (let pass = 0; pass < 4; pass++) {
    const stale = getApplicableSteps(env)
      .filter(s => chain.includes(s.key) && !isStepCurrent(s, env))
    if (stale.length === 0) break
    for (const step of stale) {
      if (dryRun) {
        actions.push(`would re-run step "${step.key}" (${stalenessReason(step, env) ?? "not run yet"})`)
        continue
      }
      await executeStep(step, env)
      actions.push(`re-ran step "${step.key}"`)
    }
    if (dryRun) break
  }
  return actions
}

/** `up -d` + wait, only when the stack was already running. Shared by apply/revert. */
async function reapplyIfRunning(env, realChanges) {
  let states
  try { states = await getContainerStates() } catch { states = [] }
  if (states.length === 0) {
    console.log("\n  Stack is not running — skipping container re-apply.")
    return
  }
  if (!realChanges) {
    console.log("\n  No file changed — no services need recreating.")
    return
  }
  console.log("\n  Re-applying compose configuration (compose recreates only services whose configuration changed)...")
  await startStack([], env)
  const wait = await waitForHealthy({ onStatus: (note) => console.log(note) })
  if (wait.ok) console.log(`  All ${wait.total} service(s) healthy.`)
  else console.log(`\n  Not healthy after ${wait.waitedSec}s:\n${wait.report}`)
}

/** Restarts the dev pm2 apps when their .env changed (dev apps are host processes). */
async function restartDevAppsIfNeeded(env, changedRels) {
  if (env !== "dev") return []
  const affected = ["frontend", "backend"].filter(app => changedRels.includes(`${app}/.env`))
  if (affected.length === 0) return []
  let apps = []
  try { apps = await listApps() } catch { apps = [] }
  const names = apps.map(a => (typeof a === "string" ? a : a.name))
  const restarted = []
  for (const app of affected) {
    if (names.includes(app)) {
      await restartApp(app)
      console.log(`  - restarted pm2 app "${app}" (its .env changed)`)
      restarted.push(app)
    }
  }
  return restarted
}

/**
 * Waits until freshly restarted dev apps answer again. Without this, verify
 * runs during the app's boot (nest/quasar take seconds to tens of seconds)
 * and reports a transient, false DOWN — exactly what happened the first time
 * config revert restarted both apps.
 */
async function waitForDevApps(env, apps, timeoutSec = 120) {
  if (env !== "dev" || apps.length === 0) return
  const ctx = verifyContext(env)
  const targets = {
    backend: `${ctx.backendBase}/health`,
    frontend: ctx.frontendUrl,
  }
  const started = Date.now()
  for (const app of apps) {
    let ok = false
    while (Date.now() - started < timeoutSec * 1000) {
      const r = await httpProbe(targets[app], { timeoutMs: 3000 })
      if (r.ok && r.status >= 200 && r.status < 400) { ok = true; break }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    console.log(ok
      ? `  - ${app} answered after ${Math.round((Date.now() - started) / 1000)}s`
      : `  - ${app} did NOT come back within ${timeoutSec}s — see "make app A=logs T=${app}"`)
  }
}

async function configApply(env, flags, positional) {
  console.log(`Config apply (env=${env}) — re-rendering everything derived from master.config.json.`)

  if (env === "prod") {
    const audit = auditSecrets("prod")
    const staticSecrets = audit.findings.filter(f => !f.generated)
    if (staticSecrets.length > 0)
      console.log(`  [preflight] ${staticSecrets.length} static (non-generated) secret key(s) in the prod env sources: ${staticSecrets.map(f => f.key).join(", ")}`)
  }

  if (flags["dry-run"]) {
    const actions = await renderChain(env, APPLY_RENDER_CHAIN, { dryRun: true })
    console.log(`\n[dry-run] config apply plan:`)
    if (actions.length === 0) console.log("  all render steps are current — nothing to apply")
    for (const a of actions) console.log(`  - ${a}`)
    console.log("  - snapshot current outputs to .config-history/<timestamp>/ (for config revert)")
    console.log("  - re-apply compose (recreates only services whose configuration changed) and verify")
    console.log("[dry-run] no changes made.")
    return
  }

  const historyDir = snapshotConfig(`config apply (env=${env})`)
  console.log(`  Snapshot saved: ${path.relative(process.cwd(), historyDir)}`)

  const actions = await renderChain(env, APPLY_RENDER_CHAIN)
  if (actions.length === 0) console.log("  All render steps were already current.")
  for (const a of actions) console.log(`  - ${a}`)

  const changes = diffSummary(historyDir)
  if (changes.length > 0) {
    console.log("\n  Changed:")
    for (const c of changes) console.log(`    ${c.summary.padEnd(12)} ${c.rel}`)
  } else {
    console.log("\n  No rendered file changed.")
  }

  await reapplyIfRunning(env, changes.length > 0)
  const restarted = await restartDevAppsIfNeeded(env, changes.map(c => c.rel))
  await waitForDevApps(env, restarted)

  const verify = await runVerify({ env })
  console.log(`\n${formatVerifyReport(verify)}\n`)
  if (verify.exitCode !== 0)
    console.log(`Config was applied but verify reports problems — inspect, then ` +
      `"node infrastructure/scripts/run.js config revert" restores ${path.relative(process.cwd(), historyDir)}.`)
  process.exitCode = verify.exitCode
}

async function configRevert(env, flags, positional) {
  const back = Number(positional[1] ?? "1")
  const entries = historyEntries()
  if (entries.length === 0)
    throw new UsageError("No config history yet — `config apply` creates entries to revert to.")
  if (!Number.isInteger(back) || back < 1 || back > entries.length)
    throw new UsageError(`History has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}; asked for #${back}.`)

  const entry = entries[back - 1]
  console.log(`Reverting to ${entry.name}${entry.label ? ` (${entry.label})` : ""}:`)

  // Generated files only — master.config.json is the operator's input and is
  // deliberately NOT restored (see restoreSnapshot's `skip`). And no
  // re-render afterwards: re-running the chain would read the current master
  // and immediately reproduce the very state being reverted from.
  const restored = restoreSnapshot(entry.dir, { skip: ["infrastructure/master.config.json"] })
  for (const rel of restored) console.log(`  restored ${rel}`)

  await reapplyIfRunning(env, restored.length > 0)
  const restarted = await restartDevAppsIfNeeded(env, restored.filter(rel => rel.endsWith(".env")))
  await waitForDevApps(env, restarted)

  const verify = await runVerify({ env })
  console.log(`\n${formatVerifyReport(verify)}\n`)
  console.log("Note: rendered files no longer match their recorded fingerprints, so the render steps")
  console.log("read stale now — the honest state until you fix master.config.json and re-run `config apply`.")
  process.exitCode = verify.exitCode
}

async function cmdConfig(positional, flags = {}) {
  const [action = "diff"] = positional

  if (action === "diff") {
    const missing = findMissingKeys()
    const extra = findExtraKeys()

    if (missing.length === 0 && extra.length === 0) {
      console.log("master.config.json matches the template.")
      return
    }

    if (missing.length > 0) {
      console.log(`Missing ${missing.length} setting(s) the template defines:\n`)
      for (const key of missing) console.log(`  - ${key}`)
      console.log(`\nRun "make config A=merge" to add them. Existing values are kept.`)
    }

    if (extra.length > 0) {
      console.log(`\n${extra.length} setting(s) present that the template does not define:\n`)
      for (const key of extra) console.log(`  + ${key}`)
      console.log(`\nThese are either your own additions or leftovers from a removed setting.`)
      console.log(`A merge never deletes anything — remove them by hand if they are stale.`)
    }
    return
  }

  if (action === "merge") {
    if (flags["dry-run"]) {
      const missing = findMissingKeys()
      if (missing.length === 0) {
        console.log("[dry-run] nothing to merge — master.config.json already matches the template.")
        return
      }
      console.log(`[dry-run] would add ${missing.length} setting(s) to master.config.json:`)
      for (const key of missing) console.log(`  + ${key}`)
      console.log("[dry-run] existing values are kept; nothing is deleted. No changes made.")
      return
    }
    const { added, path: configPath } = mergeTemplateDefaults()
    if (added.length === 0) {
      console.log("Nothing to merge — master.config.json already matches the template.")
      return
    }
    for (const key of added) console.log(`  added ${key}`)
    console.log(`\n${added.length} setting(s) merged into ${configPath}`)
    console.log(`Re-run the affected steps (e.g. make step STEP=fbEnd) to regenerate from the new values.`)
    return
  }

  if (action === "apply")
    return configApply(parseEnvArg(positional[1], currentEnv()), flags, positional)

  if (action === "revert")
    return configRevert(currentEnv(), flags, positional)

  if (action === "audit") {
    const env = parseEnvArg(positional[1], currentEnv())
    const { generated, findings } = auditSecrets(env)
    console.log(`Secrets audit (env=${env}) — key names only, no values.\n`)
    if (findings.length === 0) console.log("  no secret-looking keys in the env sources")
    for (const f of findings)
      console.log(`  ${f.generated ? "✓" : "!"} ${f.key.padEnd(36)} ${f.source}${f.generated ? "  (auto-generated in prod)" : "  static value"}`)
    console.log(`\nAuto-generated prod secrets (${generated.length}): ${generated.join(", ")}`)
    if (env === "prod") {
      const staticSecrets = findings.filter(f => !f.generated)
      if (staticSecrets.length > 0)
        console.log(`\n${staticSecrets.length} static secret(s) in prod sources — these must come from the vault and be rotatable by hand.`)
    }
    return
  }

  throw new UsageError(`Unknown config action "${action}". Valid: diff, merge, apply, revert, audit`)
}

async function cmdVerify(positional, flags = {}) {
  const env = parseEnvArg(positional[0], currentEnv())
  const result = await runVerify({ env, smoke: flags.smoke === true })

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`\n${formatVerifyReport(result)}\n`)
  }

  // Same rule as `docker health`: the flag records a genuinely passing
  // verdict, never a degraded or failing one.
  if (result.exitCode === 0) state.setStep("health", true)

  // --gate is the deploy/CI form: warnings tolerated, a FAIL is fatal and
  // normalised to exit 1 (the raw 0/1/2 codes stay available without it).
  if (flags.gate) process.exitCode = result.failCount > 0 ? 1 : 0
  else process.exitCode = result.exitCode
}

async function cmdDoctor(positional, flags = {}) {
  const env = parseEnvArg(positional[0], currentEnv())

  if (flags.repair && flags["dry-run"]) {
    const report = await doctorReport(env)
    console.log(`\n${formatDoctorReport(report)}\n`)
    console.log("[dry-run] --repair would execute the repairable actions listed above; nothing was changed.")
    process.exitCode = doctorExitCode(report)
    return
  }

  if (flags.repair) {
    const result = await doctorRepair(env)
    console.log("\nRepair completed:")
    if (result.actions.length === 0) console.log("  (nothing needed repairing)")
    for (const action of result.actions) console.log(`  - ${action}`)
    console.log(`\n${formatVerifyReport(result.verify)}\n`)
    if (result.verify.exitCode !== 0)
      console.log("Still failing after repair — see the probe detail above (make verify for the full report).")
    process.exitCode = result.verify.exitCode
    return
  }

  const report = await doctorReport(env)
  console.log(`\n${formatDoctorReport(report)}\n`)
  process.exitCode = doctorExitCode(report)
}

async function cmdClear(positional, flags) {
  const [target] = positional

  if (!target || target === "list") {
    // Distinguish "no containers" from "could not look" — same reasoning as
    // the interactive Clear menu: compose needs the root .env and the
    // compose files, so clearing those makes the query fail.
    let containers = null
    try { containers = await getContainerStates() } catch { containers = null }

    console.log(`Generated artifacts: ${describeArtifacts()}\n`)
    for (const [key, entry] of Object.entries(CLEAR_TARGETS)) {
      const { hint } = describeClearTarget(entry, containers)
      console.log(`  ${key.padEnd(12)} ${entry.label.padEnd(46)} ${hint}${entry.destructive ? "  [destructive]" : ""}`)
    }
    return
  }

  const entry = CLEAR_TARGETS[target]
  if (!entry)
    throw new UsageError(`Unknown clear target "${target}". Valid: ${Object.keys(CLEAR_TARGETS).join(", ")}, list`)

  // Dry-run first: inspection must work without --yes, which is why the
  // destructive confirmation below is skipped when nothing will be removed.
  if (flags["dry-run"]) {
    let containers = null
    try { containers = await getContainerStates() } catch { containers = null }
    const { hint } = describeClearTarget(entry, containers)
    console.log(`[dry-run] would clear "${target}" — ${entry.label}`)
    console.log(`         ${hint}`)
    if (entry.destructive)
      console.log("         destructive (data loss): executing requires --yes")
    console.log("[dry-run] no changes made.")
    return
  }

  // Destructive targets need --yes here; the menu asks interactively instead.
  if (entry.destructive && !flags.yes)
    throw new UsageError(`"${target}" is destructive (data loss). Re-run with --yes to confirm.`)

  const result = await entry.run()
  const message = typeof result === "string" ? result : result?.message ?? "done"
  console.log(`\n${message}`)
}

async function cmdApp(positional, flags = {}) {
  const [action, target] = positional
  const handler = APP_ACTIONS[action]
  if (!handler)
    throw new UsageError(`Unknown app action "${action ?? ""}". Valid: ${Object.keys(APP_ACTIONS).join(", ")}`)

  if (action === "list") return handler()

  if (!target) throw new UsageError(`app ${action} requires a target: frontend or backend`)
  const targets = target === "both" ? ["frontend", "backend"] : [target]

  if (flags["dry-run"]) {
    const what = action === "setup"
      ? "run the setup commands (see getAppConfig().setup) and record the app as set up"
      : `${action} via pm2`
    console.log(`[dry-run] would ${what} for: ${targets.join(", ")}`)
    console.log("[dry-run] no changes made.")
    return
  }

  for (const app of targets) await handler(app)
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv)
  const [command, ...rest] = positional

  // Run lock: mutating invocations hold it for their whole execution;
  // read-only ones take it briefly (best effort) around the flag sync below,
  // so a status read never queues behind a long op and never skips the sync
  // just because one happens to be running.
  let heldLock = null
  if (needsLock(command, rest, flags)) {
    heldLock = await acquireLock({ wait: flags.wait === true, command: [command, ...rest].filter(Boolean).join(" ") })
  }

  try {
    if (command && command !== "help") {
      const syncLock = heldLock ?? (await tryAcquireLock())
      if (syncLock) {
        try {
          await syncDockerFlags()
        } catch {
          // Truth sync is best effort: an unqueryable daemon must not break
          // the command — the flag simply stays at its last known value.
        }
        if (syncLock !== heldLock) syncLock.release()
      }
    }

    switch (command) {
      case "list": return cmdList()
      case "check": {
        await checkRequirements(undefined, parseEnvArg(rest[0], currentEnv()))
        console.log("\nAll prerequisites satisfied.")
        return
      }
      case "verify": return cmdVerify(rest, flags)
      case "doctor": return cmdDoctor(rest, flags)
      case "setup": return cmdSetup(rest, flags)
      case "step": return cmdStep(rest, flags)
      case "docker": return cmdDocker(rest, flags)
      case "app": return cmdApp(rest, flags)
      case "clear": return cmdClear(rest, flags)
      case "config": return cmdConfig(rest, flags)
      case undefined:
      case "help":
        return printUsage()
      default:
        throw new UsageError(`Unknown command "${command}" — run without arguments for usage`)
    }
  } finally {
    heldLock?.release()
  }
}

selfRun(import.meta.url, main)
