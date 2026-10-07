import path from "node:path"
import fs from "node:fs"
import { initEnvironment, initDocker, applyMasterConfig, generateAppEnvs, applyConfTemplates, appEnvOutputs, confTemplateOutputs, confTemplateInputs } from "../init-env.js"
import { generateCertificates, certDirectories, CA_CERT } from "./cert-utils.js"
import { generateNodeConfig } from "./opensearch-utils.js"
import { buildContainers } from "./docker-utils.js"
import { state } from "./state.js"
import { stepFingerprint, flagFingerprint } from "./fingerprint.js"
import { UsageError } from "./runner.js"
import { __infra, __docker, __env, __root, __frontend, __backend, ROOT_ENV_PATH } from "./path.js"

/**
 * The setup pipeline. This is the single source of truth: the interactive
 * menus (scripts/cli-handle.js) and the non-interactive dispatcher
 * (scripts/run.js) both read it, so a step behaves identically either way.
 *
 * key        stable identifier, also the .cli-state.json record name
 * label      shown in the interactive menu
 * describe   shown by `run.js list`
 * takesEnv   whether run() consumes the "dev"|"prod" argument
 * prodOnly   step is skipped entirely in dev
 * dependsOn  step keys that must be current first (or a fn of env)
 * inputs     paths whose contents determine the output; hashed into the
 *            step's fingerprint so changing one invalidates the step
 * outputs    paths the step writes; hashed too, so a deleted or hand-edited
 *            output reads as drift instead of being trusted
 * run        (env, options) => Promise. `options` carries dispatcher flags
 *            such as --rotate, and is empty when driven from the menus.
 *
 * On `inputs`: a step must never declare a file it also writes. `config` reads
 * and writes the root .env, so the .env is not one of its inputs — it is `env`'s
 * output, and the dependsOn edge is what makes config stale when .env changes.
 * (Hashing a file a step mutates would also make the step permanently stale,
 * since the recorded digest would never match the post-run content.)
 */
export const SETUP_STEPS = [
  {
    key: "env",
    label: "Environment",
    describe: "Compose root .env from .env.shared + .env.<env> (+ generated secrets in prod)",
    takesEnv: true,
    prodOnly: false,
    dependsOn: [],
    inputs: (env) => [path.join(__env, ".env.shared"), path.join(__env, `.env.${env}`)],
    outputs: (env) => [
      ROOT_ENV_PATH,
      // prod only: the stored production credentials. Written here, so listed
      // as an output rather than an input.
      ...(env === "prod" ? [path.join(__env, "..", ".secrets.prod.json")] : [])
    ],
    // Presence only. `config` runs immediately after this step and merges the
    // master config into the same root .env, so the content `env` leaves
    // behind is not the content that survives. Content-hashing it here would
    // leave this step permanently stale, a step behind. What `config` owns —
    // the final content — is content-hashed by `config`.
    outputCheck: "existence",
    run: async (env, options) => { await initEnvironment(env, options) }
  },
  {
    key: "config",
    label: "Config",
    describe: "Merge master.config.json ports + allowed hostnames into root .env",
    takesEnv: true,
    prodOnly: false,
    dependsOn: ["env"],
    inputs: () => [path.join(__infra, "master.config.json")],
    // Reads and writes the root .env — see the note above on why that rules it
    // out of `inputs`.
    outputs: () => [ROOT_ENV_PATH],
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
    inputs: () => [path.join(__infra, "master.config.json"), ROOT_ENV_PATH],
    outputs: () => appEnvOutputs(),
    run: async () => { await generateAppEnvs() }
  },
  {
    key: "applyConf",
    label: "Config templates",
    describe: "Render conf_templates (pgadmin servers.json, keycloak realm) against root .env",
    takesEnv: false,
    prodOnly: false,
    dependsOn: ["config"],
    inputs: () => [path.join(__infra, "master.config.json"), ROOT_ENV_PATH, ...confTemplateInputs()],
    outputs: () => confTemplateOutputs(),
    run: async () => { await applyConfTemplates() }
  },
  {
    key: "certs",
    label: "Certificates (prod only)",
    describe: "Create the private CA and issue the nginx + OpenSearch certificates",
    takesEnv: false,
    prodOnly: true,
    dependsOn: ["config"],
    inputs: () => [path.join(__infra, "master.config.json")],
    // Directories, so the fingerprint hashes their contents: dropping one of
    // the leaves has to read as drift. .issued.json is the SAN/expiry stamp.
    outputs: () => [...certDirectories(), path.join(__docker, "certs", ".issued.json")],
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
    inputs: () => [path.join(__infra, "master.config.json"), CA_CERT],
    outputs: () => [path.join(__docker, "opensearch", "opensearch.yml")],
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
    inputs: (env) => [
      path.join(__docker, "docker-compose.yml"),
      path.join(__docker, `docker-compose.${env}.yml`)
    ],
    // The generated copies are hashed, so hand-editing docker-compose.yml at
    // the repo root is detected and overwritten rather than silently diverging
    // from the template it came from.
    outputs: () => [path.join(__root, "docker-compose.yml"), path.join(__root, "docker-compose.ext.yml")],
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
    inputs: () => [
      path.join(__root, "docker-compose.yml"),
      path.join(__root, "docker-compose.ext.yml"),
      path.join(__frontend, ".env"),
      path.join(__backend, ".env"),
      path.join(__frontend, "Dockerfile"),
      path.join(__backend, "Dockerfile")
    ],
    // KNOWN GAP: a source-only change (editing frontend/src or backend/src and
    // nothing else) leaves this fingerprint untouched, so the step still reads
    // as current and a rebuild is not offered. Fingerprinting the whole source
    // tree would mean re-hashing thousands of files on every menu repaint.
    // Until that is addressed: after changing application code, re-run this
    // step explicitly (or `make app A=build`) rather than relying on staleness.
    outputs: () => [],
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

/**
 * The environment a status question is about. Falls back to the last one
 * selected, then to dev — the same precedence the dispatcher uses, so the
 * menus and `run.js list` can never disagree about what they are showing.
 */
export function resolveEnv(env) {
  return env ?? state.current.environment ?? "dev"
}



/**
 * Is this step done AND still current?
 *
 * This — not state.isStepDone() — is what every menu and the dispatcher must
 * gate on. A step that ran once against different inputs is not done.
 */
export function isStepCurrent(step, env) {
  const target = resolveEnv(env)
  if (!state.isStepDone(step.key, target)) return false
  const recorded = state.getFingerprint(step.key, target)
  if (!recorded) return false
  return recorded === stepFingerprint(step, target)
}

/**
 * Why a step is not current, for a status line or an actionable error. Null
 * when it is current.
 *
 * Distinguishes the cases an operator needs to tell apart: never run, ran for a
 * different environment, migrated from the old state format with nothing to
 * verify, an output that has since been deleted, and a genuine input or code
 * change. "Rerun it" is only correct advice for the last of those.
 */
export function stalenessReason(step, env) {
  const target = resolveEnv(env)
  if (state.isStepDone(step.key, target) && !state.getFingerprint(step.key, target)) {
    return "recorded before fingerprinting was introduced — runs once to re-establish it"
  }
  if (!state.isStepDone(step.key, target)) return null

  const recorded = state.getFingerprint(step.key, target)
  if (recorded === stepFingerprint(step, target)) return null

  // A recorded output that no longer exists is the actionable case: someone
  // deleted or moved a generated file, and re-running would put it back.
  const outputs = typeof step.outputs === "function" ? step.outputs(target) : step.outputs || []
  const lost = outputs.filter((file) => {
    try {
      return !fs.existsSync(file)
    } catch {
      return true
    }
  })
  if (lost.length > 0) {
    // Relative to the repo root, not basename: several steps write files that
    // share a name (frontend/.env and backend/.env), and "missing: .env, .env"
    // tells an operator nothing about where to look.
    const shown = lost.map((file) => path.relative(__root, file) || file);
    return `generated file(s) missing: ${shown.join(", ")}`;
  }

  return "inputs or implementation changed since it last ran"
}

/** Dependency keys of `step` that are not yet current. */
export function getUnmetDeps(step, env) {
  return resolveDeps(step, env).filter((dep) => !isStepCurrent(getStep(dep), env))
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
 * Clearing a step drops its stored fingerprint (state.setStep(key, false) does
 * that), so an invalidated step cannot look current afterwards.
 *
 * @param {string} stepKey
 * @param {"dev"|"prod"} env
 * @returns {string[]} the step keys that were invalidated
 */
export function invalidateDependents(stepKey, env) {
  const dependents = getDependentSteps(stepKey, env)
  for (const depKey of dependents) state.setStep(depKey, false, null, resolveEnv(env))
  if (dependents.includes("dockerFilesCopied")) state.setDocker("initialized", false, resolveEnv(env))
  return dependents
}


/** Is a non-step flag set AND still matching what it was recorded against? */
export function isFlagCurrent(name, env) {
  const target = resolveEnv(env)
  if (!state.isStepDone(name, target)) return false
  const expected = flagFingerprint(name, target)
  if (expected === null) return true
  return state.getFingerprint(name, target) === expected
}

/**
 * Runs a step and records the resulting state. Shared by the interactive menu
 * and the dispatcher so both leave .cli-state.json in the same shape — the
 * state bookkeeping must not drift between the two entry points.
 *
 * The fingerprint is taken AFTER run(), so it describes what is actually on
 * disk now rather than what was there beforehand.
 *
 * Throws on failure; callers decide whether to pause (menu) or exit non-zero
 * (dispatcher).
 * @param {typeof SETUP_STEPS[number]} step
 * @param {"dev"|"prod"} env
 * @param {object} [options] step-specific flags, passed straight to run()
 */
export async function executeStep(step, env, options = {}) {
  // Deliberately NOT state.setEnvironment(env) here. The environment is
  // committed only after the step succeeds, because `environment` is the
  // fallback every env-less invocation resolves against — `node scripts/run.js
  // docker migrate` with no argument follows it. Switching it up front meant a
  // step that *failed* still repointed the machine: trying a prod step on a dev
  // box and having it fail (say, because dev's compose files are at the root)
  // left every later env-less command aiming at prod.
  try {
    await step.run(env, options)
  } catch (error) {
    state.recordStep(step.key, "FAILED", error, env)
    throw error
  }

  state.setEnvironment(env)
  state.setStep(step.key, true, stepFingerprint(step, env), env)
  state.recordStep(step.key, "SUCCESS", null, env)

  // The docker menu gates on this flag rather than on the step flag, so the
  // two must move together — including when the step is invalidated below.
  if (step.key === "dockerFilesCopied") state.setDocker("initialized", true, null, env)

  const invalidated = invalidateDependents(step.key, env)

  if (invalidated.length > 0) {
    console.log(`Re-running "${step.label}" invalidated: ${invalidated.join(", ")} — these need to be redone.`)
  }

  return invalidated
}
