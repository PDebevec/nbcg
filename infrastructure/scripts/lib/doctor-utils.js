import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { state } from "./state.js"
import { getContainerStates, restartContainers } from "./docker-utils.js"
import { classifyStates, waitForHealthy } from "./wait-healthy.js"
import { runVerify } from "./probe-utils.js"
import { getApplicableSteps, getStep, isStepCurrent, stalenessReason, executeStep } from "./steps.js"
import { consoleLog } from "./logger.js"
import { __root } from "./path.js"

/**
 * `doctor` — one screen that answers "what diverged, and what can the CLI
 * safely put back?".
 *
 * Two tiers, and the line between them is hard:
 *
 *   REPORT (default) — staleness with reasons, live container state, orphan
 *   image inventory, and the verify verdict. Reads only.
 *
 *   REPAIR (--repair) — Tier 1 actions only, every one reversible and none
 *   touching data: re-run stale steps (regenerates outputs from inputs),
 *   restart containers whose healthcheck is failing, then wait for healthy
 *   and re-verify. It will never `down`, remove a volume, rotate a secret,
 *   or start a stack the operator deliberately stopped — a stopped container
 *   is a state, not a fault (Tier 2/3 items are printed with instructions
 *   instead).
 */

/** Steps that are not current, in pipeline order, with their reasons. */
export function findStaleSteps(env) {
  return getApplicableSteps(env)
    .filter(step => !isStepCurrent(step, env))
    .map(step => ({
      key: step.key,
      label: step.label,
      reason: stalenessReason(step, env) ?? "not run yet for this environment",
    }))
}

const COMPOSE_FLAGS = ["-f", "docker-compose.yml", "-f", "docker-compose.ext.yml"]

function dockerOut(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const proc = spawn("docker", args, { cwd: __root, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    proc.stdout.on("data", (c) => { stdout += c })
    proc.stderr.on("data", (c) => { stderr += c })
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }) })
    proc.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, stderr: error.message }) })
  })
}

/**
 * Which container problems could a restart plausibly fix?
 *
 * Only `unhealthy` health — a crash-looped or wedged process. Everything in
 * another bad state (exited, created, paused) is reported but NOT touched:
 * those usually mean a human stopped or paused something on purpose, and
 * silently undoing that is exactly the class of surprise self-repair must
 * not cause.
 */
export async function planContainerRepairs() {
  let states
  try {
    states = await getContainerStates()
  } catch (error) {
    return { error: error.message, restartable: [], manual: [] }
  }
  if (states.length === 0) return { error: null, restartable: [], manual: [], none: true }

  const { failed, pending } = classifyStates(states)
  const restartable = failed.filter(s => s.health === "unhealthy")
  const manual = failed.filter(s => s.health !== "unhealthy")
  return { error: null, restartable, manual, pending }
}

/**
 * Images on disk that no compose service references — the orphan left behind
 * by a removed service (the audit found a 1.5 GB `nbcg-tika` this way).
 * Report-only: deleting images is Tier 2.
 */
export async function orphanImages() {
  const compose = await dockerOut(["compose", ...COMPOSE_FLAGS, "config", "--images"])
  const referenced = new Set(compose.ok ? compose.stdout.split("\n").map(s => s.trim()).filter(Boolean) : [])

  const all = await dockerOut(["images", "--format", "{{.Repository}}:{{.Tag}}"])
  if (!all.ok) return { referenced: false, dangling: 0, orphans: [] }

  const images = all.stdout.split("\n").map(s => s.trim()).filter(Boolean)
  const orphans = images.filter(img => /^nbcg[-/]/.test(img) && !referenced.has(img))

  const danglingRes = await dockerOut(["images", "-q", "-f", "dangling=true"])
  const dangling = danglingRes.ok ? danglingRes.stdout.split("\n").filter(Boolean).length : 0

  return { referenced: referenced.size > 0, dangling, orphans }
}

/** Full read-only report. `verify` runs without smoke (fast, no tokens). */
export async function doctorReport(env) {
  const stale = findStaleSteps(env)
  const container = await planContainerRepairs()
  const images = await orphanImages()
  const verify = await runVerify({ env })
  return { env, stale, container, images, verify }
}

const ICONS = { pass: "✓", warn: "!", fail: "✗", skip: "-" }

export function formatDoctorReport(report) {
  const { env, stale, container, images, verify } = report
  const lines = [`DOCTOR  env=${env}`, ""]

  lines.push("  steps")
  if (stale.length === 0) lines.push("    ✓ all steps current")
  for (const s of stale) lines.push(`    ✗ ${s.key.padEnd(18)} ${s.reason}  → re-run: make step STEP=${s.key}`)

  lines.push("  containers")
  if (container.error) lines.push(`    ! could not query compose: ${container.error}`)
  else if (container.none) lines.push("    - no containers exist (stack never started or was brought down)")
  else {
    if (container.restartable.length === 0 && container.manual.length === 0) lines.push("    ✓ all running and healthy")
    for (const s of container.restartable)
      lines.push(`    ! ${s.service.padEnd(18)} unhealthy — repairable: doctor --repair restarts it`)
    for (const s of container.manual)
      lines.push(`    - ${s.service.padEnd(18)} ${s.state} — left alone (may be intentional; start it yourself if not)`)
    for (const s of container.pending ?? [])
      lines.push(`    ! ${s.service.padEnd(18)} still starting`)
  }

  if (images.referenced || images.dangling > 0 || images.orphans.length > 0) {
    lines.push("  images")
    if (images.orphans.length === 0 && images.dangling === 0) lines.push("    ✓ no orphan or dangling images")
    for (const img of images.orphans)
      lines.push(`    ! ${img} not referenced by the active compose config (delete with: docker rmi ${img})`)
    if (images.dangling > 0)
      lines.push(`    ! ${images.dangling} dangling layer set(s) (docker image prune)`)
  }

  lines.push("  verify")
  const bad = verify.probes.filter(p => p.status === "fail" || p.status === "warn")
  if (bad.length === 0) lines.push("    ✓ all probes pass")
  for (const p of bad) lines.push(`    ${ICONS[p.status]} ${p.name.padEnd(18)} ${p.detail}`)
  if (bad.length > 0) lines.push("    (full detail: make verify)")

  lines.push("")
  const repairable = stale.length + (container.restartable?.length ?? 0)
  lines.push(
    repairable > 0
      ? `  ${repairable} issue(s) the CLI can repair safely: make doctor FLAGS=--repair`
      : "  nothing the CLI can repair on its own"
  )
  return lines.join("\n")
}

/**
 * Repair exit code: 0 = nothing to do, 1 = repairable drift exists (or
 * warnings), 2 = a real failure the safe tier cannot fix.
 */
export function doctorExitCode(report) {
  const repairable = report.stale.length > 0 || (report.container.restartable?.length ?? 0) > 0
  return Math.max(report.verify.exitCode, repairable ? 1 : 0)
}

/**
 * Executes the Tier-1 repair set and re-verifies. Returns
 * { actions, verify } — `actions` is the log of what was done.
 */
export async function doctorRepair(env) {
  const actions = []

  // 1. Stale steps, in pipeline order. Iterated: re-running a step cascades
  //    staleness to its dependents (fbEnd re-run invalidates
  //    dockerFilesCopied), so one pass is not enough — each outer pass
  //    recomputes the stale set until it settles. Capped so a step that
  //    somehow re-stales itself can never loop.
  for (let pass = 0; pass < 4; pass++) {
    const stale = findStaleSteps(env)
    if (stale.length === 0) break
    for (const s of stale) {
      await executeStep(getStep(s.key), env)
      actions.push(`re-ran step "${s.key}"`)
    }
  }

  // 2. Restart unhealthy containers (the one container action that is safe:
  //    the service is failing its own healthcheck, and restart is what an
  //    operator would do first).
  const plan = await planContainerRepairs()
  if (plan.restartable?.length > 0) {
    const services = plan.restartable.map(s => s.service)
    await restartContainers(services)
    actions.push(`restarted unhealthy: ${services.join(", ")}`)
  }

  // 3. Wait for the stack to settle, then give an honest verdict.
  let wait = null
  if (plan.restartable?.length > 0 || plan.pending?.length > 0) {
    wait = await waitForHealthy({ onStatus: (note) => console.log(note) })
    actions.push(wait.ok ? `healthy after ${wait.waitedSec}s` : `still failing after ${wait.waitedSec}s`)
  }

  const verify = await runVerify({ env })
  if (verify.exitCode === 0) state.setStep("health", true)
  return { actions, wait, verify }
}
