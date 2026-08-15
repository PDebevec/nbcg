import { initEnvironment, initDocker, applyMasterConfig, generateAppEnvs, applyConfTemplates } from "../init-env.js"
import { generateCertificates } from "./cert-utils.js"
import { generateNodeConfig } from "./opensearch-utils.js"
import { buildContainers } from "./docker-utils.js"
import { state } from "./state.js"
import { UsageError } from "./runner.js"

/**
 * The setup pipeline. This is the single source of truth: the interactive
 * menus (scripts/cli-handle.js) and the non-interactive dispatcher
 * (scripts/run.js) both read it, so a step behaves identically either way.
 *
 * key        stable identifier, also the .cli-state.json flag name
 * label      shown in the interactive menu
 * describe   shown by `run.js list`
 * takesEnv   whether run() consumes the "dev"|"prod" argument
 * prodOnly   step is skipped entirely in dev
 * dependsOn  step keys that must be done first (or a fn of env)
 * run        (env, options) => Promise. `options` carries dispatcher flags
 *            such as --rotate, and is empty when driven from the menus.
 */
export const SETUP_STEPS = [
  {
    key: "env",
    label: "Environment",
    describe: "Compose root .env from .env.shared + .env.<env> (+ generated secrets in prod)",
    takesEnv: true,
    prodOnly: false,
    dependsOn: [],
    run: async (env, options) => { await initEnvironment(env, options) }
  },
  {
    key: "config",
    label: "Config",
    describe: "Merge master.config.json ports + allowed hostnames into root .env",
    takesEnv: true,
    prodOnly: false,
    dependsOn: ["env"],
    run: async (env) => { await applyMasterConfig(env) }
  },
  // fbEnd, applyConf and certs are peers: each only needs the finished root
  // .env, and none consumes another's output. Chaining them would make
  // getDependentSteps() invalidate siblings that are still perfectly valid.
  {
    key: "fbEnd",
    label: "App env files",
    describe: "Write a .env for every master.config.json env_routing target",
    takesEnv: false,
    prodOnly: false,
    dependsOn: ["config"],
    run: async () => { await generateAppEnvs() }
  },
  {
    key: "applyConf",
    label: "Config templates",
    describe: "Render conf_templates (pgadmin servers.json, keycloak realm) against root .env",
    takesEnv: false,
    prodOnly: false,
    dependsOn: ["config"],
    run: async () => { await applyConfTemplates() }
  },
  {
    key: "certs",
    label: "Certificates (prod only)",
    describe: "Create the private CA and issue the nginx + OpenSearch certificates",
    takesEnv: false,
    prodOnly: true,
    dependsOn: ["config"],
    run: async () => { await generateCertificates() }
  },
  {
    key: "osSecurity",
    label: "OpenSearch config (prod only)",
    describe: "Write opensearch.yml (TLS + admin DN). Users are configured after the cluster starts",
    takesEnv: false,
    prodOnly: true,
    // Needs the CA to exist: the config names the certificate files and the
    // DNs are derived from the same subject the certs were issued with.
    dependsOn: ["certs"],
    run: async () => { generateNodeConfig() }
  },
  // Everything the compose files bind-mount must exist before they are copied
  {
    key: "dockerFilesCopied",
    label: "Docker files",
    describe: "Copy docker-compose.yml + docker-compose.<env>.yml into the repo root",
    takesEnv: true,
    prodOnly: false,
    dependsOn: (env) => env === "prod"
      ? ["fbEnd", "applyConf", "certs", "osSecurity"]
      : ["fbEnd", "applyConf"],
    run: async (env) => { await initDocker(env) }
  },
  {
    key: "appImages",
    label: "Build app images (prod only)",
    describe: "docker compose build frontend backend",
    takesEnv: false,
    prodOnly: true,
    // fbEnd because Quasar bakes VITE_* into the bundle at build time, so the
    // image is only valid for the frontend/.env that produced it — re-running
    // fbEnd correctly marks this stale. dockerFilesCopied because the build
    // definitions live in the compose files.
    dependsOn: ["fbEnd", "dockerFilesCopied"],
    run: async () => { await buildContainers(["frontend", "backend"]) }
  }
]

function resolveDeps(step, env) {
  return typeof step.dependsOn === "function" ? step.dependsOn(env) : step.dependsOn
}

export function getStepDeps(step, env) {
  return resolveDeps(step, env)
}

/** Look up a step by key. Throws with the valid keys listed, for CLI arg errors. */
export function getStep(key) {
  const step = SETUP_STEPS.find(s => s.key === key)
  if (!step)
    throw new UsageError(`Unknown step "${key}". Valid steps: ${SETUP_STEPS.map(s => s.key).join(", ")}`)
  return step
}

/**
 * 1-based position of a step among those applicable to `env`. Numbers are
 * derived rather than baked into the labels, so skipping the prod-only step
 * in dev doesn't leave a gap in the sequence.
 */
export function getStepNumber(step, env) {
  return getApplicableSteps(env).findIndex(s => s.key === step.key) + 1
}

/** `label` prefixed with its position, e.g. "3. App env files". */
export function getStepTitle(step, env) {
  return `${getStepNumber(step, env)}. ${step.label}`
}

export function getApplicableSteps(env) {
  return SETUP_STEPS.filter(s => !s.prodOnly || env === "prod")
}

/** Dependency keys of `step` that are not yet marked done. */
export function getUnmetDeps(step, env, stateObj = state) {
  return resolveDeps(step, env).filter(dep => !stateObj.isStepDone(dep))
}

/**
 * All steps (transitively) depending on `stepKey`, for the given env.
 * Used to invalidate downstream progress when an earlier step re-runs.
 */
export function getDependentSteps(stepKey, env) {
  const steps = getApplicableSteps(env)
  const dependents = new Set()
  let changed = true

  while (changed) {
    changed = false
    for (const step of steps) {
      if (dependents.has(step.key) || step.key === stepKey) continue
      const deps = resolveDeps(step, env)
      if (deps.includes(stepKey) || deps.some(d => dependents.has(d))) {
        dependents.add(step.key)
        changed = true
      }
    }
  }

  return [...dependents]
}

/**
 * Marks every step (transitively) depending on `stepKey` as not-done, and
 * clears the docker "initialized" flag if `dockerFilesCopied` is among them.
 *
 * This is the single place that turns "stepKey's output is gone/stale" into
 * state changes. It is shared by executeStep() (a step re-ran) and by
 * clear-utils.js (a step's output was deleted) so the two can never drift —
 * they previously each hand-maintained their own partial version of this.
 *
 * @param {string} stepKey
 * @param {"dev"|"prod"} env
 * @returns {string[]} the step keys that were invalidated
 */
export function invalidateDependents(stepKey, env) {
  const dependents = getDependentSteps(stepKey, env)
  for (const depKey of dependents) state.setStep(depKey, false)
  if (dependents.includes("dockerFilesCopied")) state.setDocker("initialized", false)
  return dependents
}

/**
 * Runs a step and records the resulting state. Shared by the interactive menu
 * and the dispatcher so both leave .cli-state.json in the same shape — the
 * state bookkeeping must not drift between the two entry points.
 *
 * Throws on failure; callers decide whether to pause (menu) or exit non-zero
 * (dispatcher).
 * @param {typeof SETUP_STEPS[number]} step
 * @param {"dev"|"prod"} env
 * @param {object} [options] step-specific flags, passed straight to run()
 */
export async function executeStep(step, env, options = {}) {
  state.setEnvironment(env)

  try {
    await step.run(env, options)
  } catch (error) {
    state.recordStep(step.key, "FAILED", error)
    throw error
  }

  state.setStep(step.key, true)
  state.recordStep(step.key, "SUCCESS")

  // The docker menu gates on this flag rather than on the step flag, so the
  // two must move together — including when the step is invalidated below.
  if (step.key === "dockerFilesCopied") state.setDocker("initialized", true)

  const invalidated = invalidateDependents(step.key, env)

  if (invalidated.length > 0) {
    console.log(`Re-running "${step.label}" invalidated: ${invalidated.join(", ")} — these need to be redone.`)
  }

  return invalidated
}
