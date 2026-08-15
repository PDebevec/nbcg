import { initDocker, getAppConfig } from "./init-env.js"
import { runMigrations, runHealthChecks } from "./lib/db-utils.js"
import { configureSecurity } from "./lib/opensearch-utils.js"
import { state } from "./lib/state.js"
import {
  printScreen, promptEnvSelection, promptMenu, promptConfirm,
  runAction, runMenu, pauseTerminal
} from "./lib/cli-util.js"
import { checkRequirements } from "./requirements.js"
import {
  SETUP_STEPS, getApplicableSteps, getUnmetDeps, executeStep, getStepTitle
} from "./lib/steps.js"
import {
  stopContainers, restartContainers, buildContainers,
  pullContainers, createContainers, downContainers,
  getContainerLogs, getContainerStatuses, getDefinedServices,
  getContainerStates, summariseStates
} from "./lib/docker-utils.js"
import { runSetupCommands, startApp, stopApp, restartApp, listApps, viewLogs } from "./lib/app-utils.js"
import { CLEAR_TARGETS, describeArtifacts, describeClearTarget } from "./lib/clear-utils.js"
import { startStack } from "./lib/reconcile-utils.js"

const currentEnv = () => state.current.environment || ""
const isProd = () => currentEnv() === "prod"

/**
 * //////////
 * SETUP STEPS MENU
 * //////////
 */
export async function handleSetup() {
  const prereq = await runAction("Checking prerequisites", () => checkRequirements(undefined, currentEnv() || "dev"))
  if (!prereq.ok) return

  await runMenu({
    title: "SETUP",
    status: () => {
      const env = currentEnv() || "dev"
      const steps = getApplicableSteps(env)
      const done = steps.filter(s => state.isStepDone(s.key)).length
      return [`${done}/${steps.length} steps done · env: ${env}`]
    },
    build: () => {
      const env = currentEnv() || "dev"
      const steps = getApplicableSteps(env)
      const remaining = steps.filter(s => !state.isStepDone(s.key))

      return [
        {
          name: "▶  Run all remaining steps",
          hint: remaining.length > 0 ? remaining.map(s => s.key).join(" → ") : "",
          disabled: remaining.length === 0,
          disabledReason: "all steps done — pick an individual step to re-run",
          run: async () => {
            const chosenEnv = await promptEnvSelection()
            state.setEnvironment(chosenEnv)

            const todo = getApplicableSteps(chosenEnv).filter(s => !state.isStepDone(s.key))
            for (const step of todo) {
              console.log(`\n=== ${getStepTitle(step, chosenEnv)} ===`)
              await executeStep(step, chosenEnv)
            }
            return `${todo.length} step${todo.length === 1 ? "" : "s"} completed`
          }
        },
        { separator: "─".repeat(46) },
        // Steps with unmet dependencies stay visible but disabled, so the
        // shape of the pipeline is legible instead of items appearing later
        ...steps.map(step => {
          const unmet = getUnmetDeps(step, env, state)
          const done = state.isStepDone(step.key)
          // "stale" = ran successfully before, but something it depends on has
          // since been cleared or re-run, so its output can't be trusted
          const status = done ? (unmet.length > 0 ? "stale" : "done") : (unmet.length > 0 ? "" : "ready")
          return {
            name: `${done ? "✓" : " "} ${getStepTitle(step, env)}`,
            hint: status,
            disabled: unmet.length > 0,
            disabledReason: `needs: ${unmet.join(", ")}`,
            run: async () => {
              const stepEnv = step.key === "env" ? await promptEnvSelection() : env
              await executeStep(step, stepEnv)
              return `${step.key} complete`
            }
          }
        }),
      ]
    }
  })
}

/**
 * //////////
 * DOCKER MENU
 * //////////
 */
async function promptServiceTarget(actionLabel, services) {
  const target = await promptMenu(`Select target for ${actionLabel}`, [
    { name: "All", value: [] },
    ...services.map(s => ({ name: s, value: [s] }))
  ])
  return target === "BACK" ? null : target
}

export async function handleDocker(setupState = "") {
  // `docker compose config/ps` shell out, so both are resolved once per
  // redraw and dropped whenever an action changes the world
  let services = null
  let states = null

  const filesReady = () => state.isStepDone("dockerFilesCopied")
  const invalidate = () => { states = null }

  const loadStates = async () => {
    if (states === null) {
      try { states = await getContainerStates() } catch { states = [] }
    }
    return states
  }

  /** Wraps a compose action with target selection + cache invalidation. */
  const dockerRun = (label, fn) => async () => {
    const target = await promptServiceTarget(label, services || [])
    if (target === null) return { message: "cancelled", noop: true }
    await fn(target)
    invalidate()
    const scope = target.length === 0 ? "all services" : target.join(", ")
    return `${label}: ${scope}`
  }

  await runMenu({
    title: "DOCKER",
    status: async () => {
      if (!filesReady()) return ["compose files not copied yet"]
      if (services === null) {
        try { services = await getDefinedServices() } catch { services = [] }
      }
      const s = summariseStates(await loadStates())
      if (s.total === 0) return [`${services.length} services defined · none created`]
      return [`${services.length} services · ${s.running} running · ${s.stopped} stopped · ${s.healthy} healthy`]
    },
    build: async () => {
      const ready = filesReady()
      const current = await loadStates()
      const anyRunning = current.some(c => c.running)
      const anyExist = current.length > 0

      const needsFiles = { disabled: !ready, disabledReason: "copy the docker-compose files first" }
      const needsRunning = {
        disabled: !ready || !anyRunning,
        disabledReason: ready ? "no containers are running" : "copy the docker-compose files first"
      }

      return [
        ...(setupState === "SETUP" ? [{
          name: "Setup Docker Files",
          hint: "copy compose files",
          run: async () => {
            await initDocker(currentEnv() || "dev")
            state.setStep("dockerFilesCopied", true)
            state.setDocker("initialized", true)
            services = null
            invalidate()
            return "compose files copied to repo root"
          }
        }] : []),
        // Building frontend/backend specifically is the "appImages" setup step
        // (Setup Menu); the generic "Build" entry below covers ad-hoc rebuilds
        // — it builds every service with a build: block, which in prod is
        // exactly frontend+backend. A dedicated "Build front/back-end" entry
        // here would just be a third way to do the same thing.
        {
          name: "Start (up)", ...needsFiles,
          run: dockerRun("up", async (target) => {
            // Reconciles Postgres/OpenSearch credentials with the current
            // .env around every prod up — cheap and idempotent, so this is
            // what actually guarantees the stack never runs on stale
            // credentials after secrets are regenerated, instead of relying
            // on someone remembering to also run "Configure OpenSearch
            // security". See reconcile-utils.js.
            await startStack(target, currentEnv())
            if (isProd()) state.setStep("osSecured", true)
          })
        },
        { name: "Stop", ...needsRunning, run: dockerRun("stop", stopContainers) },
        { name: "Restart", ...needsRunning, run: dockerRun("restart", restartContainers) },
        { name: "Create (no start)", ...needsFiles, run: dockerRun("create", createContainers) },
        { name: "Build", ...needsFiles, run: dockerRun("build", buildContainers) },
        { name: "Pull", ...needsFiles, run: dockerRun("pull", pullContainers) },
        { name: "Logs (follow)", ...needsRunning, hint: anyRunning ? "Ctrl+C to return" : "", run: dockerRun("logs", getContainerLogs) },
        { separator: "─".repeat(46) },
        {
          name: "Status (ps)",
          disabled: !ready || !anyExist,
          disabledReason: ready ? "no containers exist yet" : "copy the docker-compose files first",
          pause: true,
          run: async () => {
            await getContainerStatuses()
            return `${current.length} containers`
          }
        },
        {
          name: "Health Checks",
          ...needsFiles,
          pause: true,
          run: async () => {
            const result = await runHealthChecks()
            state.setStep("health", true)
            return result
          }
        },
        {
          name: "Migrate Database",
          disabled: !anyRunning,
          disabledReason: "start the containers first",
          hint: isProd() ? "applied on backend start too" : "",
          run: async () => {
            const result = await runMigrations(currentEnv() || "dev")
            state.setStep("migrate", true)
            return result
          }
        },
        {
          // Prod only: dev runs OpenSearch with the security plugin disabled,
          // so there are no accounts to configure.
          name: "Configure OpenSearch security",
          disabled: !isProd() || !anyRunning,
          disabledReason: isProd() ? "start the containers first" : "prod only — dev runs OpenSearch unsecured",
          hint: isProd() ? (state.isStepDone("osSecured") ? "already configured" : "replaces the shipped demo accounts") : "",
          pause: true,
          run: async () => {
            const result = await configureSecurity()
            state.setStep("osSecured", true)
            return result
          }
        },
        { separator: "─".repeat(46) },
        {
          name: "Down",
          disabled: !ready || !anyExist,
          disabledReason: ready ? "no containers exist yet" : "copy the docker-compose files first",
          run: async () => {
            await downContainers(false)
            state.setDocker("containarized", false)
            invalidate()
            return "containers and networks removed"
          }
        },
        {
          name: "Down -v (remove volumes)",
          disabled: !ready || !anyExist,
          disabledReason: ready ? "no containers exist yet" : "copy the docker-compose files first",
          run: async () => {
            const ok = await promptConfirm("Remove all volumes? Database contents will be lost.", false)
            if (!ok) return { message: "cancelled", noop: true }
            await downContainers(true)
            state.setDocker("containarized", false)
            invalidate()
            return "containers, networks and volumes removed"
          }
        },
      ]
    }
  })
}

/**
 * //////////
 * APP MENU (frontend/backend via pm2, dev only)
 * //////////
 */
const APPS = ["frontend", "backend"]

async function promptAppTarget(actionLabel, eligible = APPS) {
  const target = await promptMenu(`Select target for ${actionLabel}`, [
    ...eligible.map(a => ({ name: a[0].toUpperCase() + a.slice(1), value: [a] })),
    ...(eligible.length > 1 ? [{ name: "Both", value: [...eligible] }] : [])
  ])
  return target === "BACK" ? null : target
}

export async function handleApps() {
  let processes = null
  const invalidate = () => { processes = null }

  const load = async () => {
    if (processes === null) {
      try { processes = await listApps() } catch { processes = [] }
    }
    return processes
  }

  const statusOf = (list, app) => list.find(p => p.name === app)?.pm2_env?.status ?? "stopped"
  const isRunning = (list, app) => statusOf(list, app) === "online"

  await runMenu({
    title: "APPS (pm2)",
    status: async () => {
      const list = await load()
      return [APPS.map(a => {
        const proc = list.find(p => p.name === a)
        const pid = proc?.pid ? ` (pid ${proc.pid})` : ""
        return `${a}: ${statusOf(list, a)}${pid}`
      }).join(" · ")]
    },
    build: async () => {
      const list = await load()
      const notSetUp = APPS.filter(a => !state.isAppSetupDone(a))
      const startable = APPS.filter(a => state.isAppSetupDone(a) && !isRunning(list, a))
      const running = APPS.filter(a => isRunning(list, a))

      return [
        ...APPS.map(app => ({
          name: `Setup ${app[0].toUpperCase() + app.slice(1)}`,
          hint: state.isAppSetupDone(app) ? "done" : "install deps",
          disabled: state.isAppSetupDone(app),
          disabledReason: "already set up",
          run: async () => {
            const { setup } = getAppConfig(app)
            await runSetupCommands(app, setup)
            state.setAppSetup(app, true)
            return `${app} dependencies installed`
          }
        })),
        { separator: "─".repeat(46) },
        {
          name: "Start",
          disabled: startable.length === 0,
          disabledReason: notSetUp.length === APPS.length
            ? "run Setup first"
            : "already running",
          run: async () => {
            const targets = await promptAppTarget("start", startable)
            if (!targets) return { message: "cancelled", noop: true }
            for (const app of targets) await startApp(app, getAppConfig(app).run)
            invalidate()
            return `started ${targets.join(", ")}`
          }
        },
        {
          name: "Stop",
          disabled: running.length === 0,
          disabledReason: "nothing is running",
          run: async () => {
            const targets = await promptAppTarget("stop", running)
            if (!targets) return { message: "cancelled", noop: true }
            for (const app of targets) await stopApp(app)
            invalidate()
            return `stopped ${targets.join(", ")}`
          }
        },
        {
          name: "Restart",
          disabled: running.length === 0,
          disabledReason: "nothing is running",
          run: async () => {
            const targets = await promptAppTarget("restart", running)
            if (!targets) return { message: "cancelled", noop: true }
            for (const app of targets) await restartApp(app)
            invalidate()
            return `restarted ${targets.join(", ")}`
          }
        },
        {
          name: "Logs (follow)",
          hint: running.length > 0 ? "Ctrl+C to return" : "",
          disabled: running.length === 0,
          disabledReason: "nothing is running",
          run: async () => {
            const targets = await promptAppTarget("logs", running)
            if (!targets) return { message: "cancelled", noop: true }
            await viewLogs(targets[0])
            return `viewed ${targets[0]} logs`
          }
        },
        {
          name: "List",
          pause: true,
          run: async () => {
            invalidate()
            const fresh = await load()
            if (fresh.length === 0) {
              console.log("  No frontend/backend processes running.")
              return { message: "no processes", noop: true }
            }
            for (const p of fresh) console.log(`  ${p.name}: ${p.pm2_env?.status ?? "unknown"} (pid ${p.pid ?? "-"})`)
            return `${fresh.length} process${fresh.length === 1 ? "" : "es"}`
          }
        },
      ]
    }
  })
}

/**
 * //////////
 * CLEAR ENV MENU
 * //////////
 */
export async function handleClearENV() {
  await runMenu({
    title: "CLEAR ENVIRONMENT",
    status: () => [describeArtifacts()],
    build: async () => {
      // Distinguish "no containers" from "could not look": compose needs the
      // root .env and the compose files, so clearing those makes the query
      // fail — reporting that as "none exist" would be a lie
      let containers = null
      try { containers = await getContainerStates() } catch { containers = null }

      return Object.entries(CLEAR_TARGETS).map(([, entry]) => {
        const { disabled, disabledReason, hint } = describeClearTarget(entry, containers)

        return {
          name: entry.label,
          hint,
          disabled,
          disabledReason,
          run: async () => {
            // Each destructive target carries its own warning text, so adding
            // one never silently reuses another's wording
            if (entry.confirm) {
              const ok = await promptConfirm(entry.confirm, false)
              if (!ok) return { message: "cancelled", noop: true }
            }
            return entry.run()
          }
        }
      })
    }
  })
}
