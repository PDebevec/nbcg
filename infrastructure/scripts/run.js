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
import { state } from "./lib/state.js"
import { selfRun, parseArgs, parseEnvArg, UsageError } from "./lib/runner.js"
import { checkRequirements } from "./requirements.js"
import { getAppConfig } from "./init-env.js"
import { runMigrations, runHealthChecks } from "./lib/db-utils.js"
import { configureSecurity } from "./lib/opensearch-utils.js"
import { startStack } from "./lib/reconcile-utils.js"
import { CLEAR_TARGETS, describeArtifacts, describeClearTarget } from "./lib/clear-utils.js"
import { findMissingKeys, findExtraKeys, mergeTemplateDefaults } from "./lib/config-utils.js"
import {
  SETUP_STEPS, getStep, getApplicableSteps, getStepDeps, getUnmetDeps, executeStep, getStepTitle
} from "./lib/steps.js"
import {
  stopContainers, restartContainers, buildContainers,
  pullContainers, createContainers, downContainers,
  getContainerLogs, getContainerStatuses, getContainerStates, getDefinedServices
} from "./lib/docker-utils.js"
import {
  runSetupCommands, startApp, stopApp, restartApp, deleteApp, listApps, viewLogs
} from "./lib/app-utils.js"

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

function printUsage() {
  console.log(`
Usage: node scripts/run.js <command> [args] [--flags]

  list                       Show every runnable step and action
  check                      Verify prerequisites (binaries, docker daemon)
  setup [env]                Run the whole pipeline for env (default: ${currentEnv()})
  step <key> [env]           Run a single setup step
  docker <action> [svc...]   ${Object.keys(DOCKER_ACTIONS).join(" | ")}
  app <action> [target]      ${Object.keys(APP_ACTIONS).join(" | ")}
  clear [target|list]        ${Object.keys(CLEAR_TARGETS).join(" | ")}
  config [diff|merge]        Compare master.config.json against the template

Flags:
  --force                    Run a step even if its dependencies are unmet
  --yes                      Confirm a destructive clear target
  --rotate                   step env prod: generate fresh secrets instead of
                             reusing the ones already in the root .env
`.trim())
}

function cmdList() {
  const env = currentEnv()
  console.log(`Setup steps (env: ${env})\n`)
  for (const step of SETUP_STEPS) {
    const done = state.isStepDone(step.key) ? "done" : "    "
    const tags = [
      step.prodOnly ? "prod-only" : null,
      step.takesEnv ? "takes <env>" : null,
      `after: ${getStepDeps(step, env).join(", ") || "nothing"}`
    ].filter(Boolean).join("; ")
    console.log(`  [${done}] ${step.key.padEnd(18)} ${step.describe}`)
    console.log(`           ${" ".repeat(18)} (${tags})`)
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

async function cmdSetup(positional) {
  const env = parseEnvArg(positional[0], currentEnv())
  for (const step of getApplicableSteps(env)) {
    console.log(`\n=== ${getStepTitle(step, env)} ===`)
    await executeStep(step, env)
  }
  console.log(`\nSetup complete for env "${env}".`)
}

async function cmdDocker(positional) {
  const [action, ...services] = positional
  const handler = DOCKER_ACTIONS[action]
  if (!handler)
    throw new UsageError(`Unknown docker action "${action ?? ""}". Valid: ${Object.keys(DOCKER_ACTIONS).join(", ")}`)

  const result = await handler(services)

  if (action === "up" || action === "create") state.setDocker("containarized", true)
  if (action === "stop" || action === "down" || action === "down-v") state.setDocker("containarized", false)
  if (action === "migrate") state.setStep("migrate", true)
  if (action === "health") state.setStep("health", true)
  if (action === "os-secure" || (action === "up" && currentEnv() === "prod")) state.setStep("osSecured", true)

  // Actions that summarise themselves (migrate, health) report it; the rest
  // already stream docker's own output to the terminal.
  const message = typeof result === "string" ? result : result?.message
  if (message) console.log(`\n${message}`)
}

async function cmdConfig(positional) {
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
    const { added, path } = mergeTemplateDefaults()
    if (added.length === 0) {
      console.log("Nothing to merge — master.config.json already matches the template.")
      return
    }
    for (const key of added) console.log(`  added ${key}`)
    console.log(`\n${added.length} setting(s) merged into ${path}`)
    console.log(`Re-run the affected steps (e.g. make step STEP=fbEnd) to regenerate from the new values.`)
    return
  }

  throw new UsageError(`Unknown config action "${action}". Valid: diff, merge`)
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

  // Destructive targets need --yes here; the menu asks interactively instead.
  if (entry.destructive && !flags.yes)
    throw new UsageError(`"${target}" is destructive (data loss). Re-run with --yes to confirm.`)

  const result = await entry.run()
  const message = typeof result === "string" ? result : result?.message ?? "done"
  console.log(`\n${message}`)
}

async function cmdApp(positional) {
  const [action, target] = positional
  const handler = APP_ACTIONS[action]
  if (!handler)
    throw new UsageError(`Unknown app action "${action ?? ""}". Valid: ${Object.keys(APP_ACTIONS).join(", ")}`)

  if (action === "list") return handler()

  if (!target) throw new UsageError(`app ${action} requires a target: frontend or backend`)
  const targets = target === "both" ? ["frontend", "backend"] : [target]
  for (const app of targets) await handler(app)
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv)
  const [command, ...rest] = positional

  switch (command) {
    case "list": return cmdList()
    case "check": {
      await checkRequirements(undefined, parseEnvArg(rest[0], currentEnv()))
      console.log("\nAll prerequisites satisfied.")
      return
    }
    case "setup": return cmdSetup(rest)
    case "step": return cmdStep(rest, flags)
    case "docker": return cmdDocker(rest)
    case "app": return cmdApp(rest)
    case "clear": return cmdClear(rest, flags)
    case "config": return cmdConfig(rest)
    case undefined:
    case "help":
      return printUsage()
    default:
      throw new UsageError(`Unknown command "${command}" — run without arguments for usage`)
  }
}

selfRun(import.meta.url, main)
