import { getContainerStates } from "./docker-utils.js"

/**
 * Waits until compose reports the target services running and healthy.
 *
 * The CLI's `up` used to return the moment `docker compose up -d` exited,
 * which is not the same as the stack working: containers can still be
 * starting, health-checking, or crash-looping (the valkey/redis incident —
 * `up` "succeeded" while the service restarted every few seconds). This gives
 * `up` a verified outcome instead.
 *
 * Criteria are deliberately the same ones backup.sh's health wait uses
 * (infrastructure/scripts/backup.sh, "Waiting for all services"):
 *   failure   — state in {restarting, exited, dead, created, paused} or
 *               health == unhealthy
 *   pending   — health == starting, or not running yet
 *   no healthcheck declared + running counts as ready (parity with backup.sh)
 * A scoped `up SVC=db` waits only for the named services (their compose
 * dependencies may also start; their health is not gated here).
 */

export const BAD_STATES = new Set(["restarting", "exited", "dead", "created", "paused"])

/**
 * Split container states into failed / pending / ready for a scope.
 * @param {Array<{service: string, name: string, state: string, health: string, running: boolean}>} states
 * @param {string[]} scope empty = every service of the project
 */
export function classifyStates(states, scope = []) {
  const inScope = scope.length > 0 ? states.filter(s => scope.includes(s.service)) : states
  const failed = inScope.filter(
    s => BAD_STATES.has(String(s.state).toLowerCase()) || s.health === "unhealthy"
  )
  const pending = inScope.filter(s => !failed.includes(s) && (!s.running || s.health === "starting"))
  const ready = inScope.filter(s => !failed.includes(s) && !pending.includes(s))
  return { inScope, failed, pending, ready }
}

function reportLines(failed, pending) {
  const lines = []
  for (const s of failed)
    lines.push(`  - ${s.service} (state=${s.state || "?"}, health=${s.health || "none"})`)
  for (const s of pending)
    lines.push(`  - ${s.service} (waiting: ${s.running ? `health=${s.health || "starting"}` : s.state || "starting"})`)
  return lines
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Poll until everything in scope is ready, or `timeoutSec` elapses.
 *
 * @param {object} [options]
 * @param {string[]} [options.services]  scope; empty = whole stack
 * @param {number}   [options.timeoutSec] default 300
 * @param {number}   [options.intervalMs] default 5000
 * @param {(note: string) => void} [options.onStatus] called when the failing
 *        set changes (not every poll), so output stays readable
 * @returns {Promise<{ok: boolean, waitedSec: number, total: number,
 *                    failed: Array, pending: Array, report: string}>}
 */
export async function waitForHealthy(options = {}) {
  const { services = [], timeoutSec = 300, intervalMs = 5000, onStatus } = options
  const started = Date.now()
  let lastNote = null

  for (;;) {
    const states = await getContainerStates().catch(() => [])
    const { inScope, failed, pending } = classifyStates(states, services)
    const report = reportLines(failed, pending).join("\n")

    if (inScope.length > 0 && failed.length === 0 && pending.length === 0) {
      return {
        ok: true,
        waitedSec: Math.round((Date.now() - started) / 1000),
        total: inScope.length,
        failed,
        pending,
        report: "",
      }
    }

    const note = failed.length + pending.length === 0 && inScope.length === 0
      ? "  waiting: no containers registered yet"
      : reportLines(failed, pending).join("\n")
    if (note !== lastNote) {
      onStatus?.(note)
      lastNote = note
    }

    if (Date.now() - started >= timeoutSec * 1000) {
      return {
        ok: false,
        waitedSec: Math.round((Date.now() - started) / 1000),
        total: inScope.length,
        failed,
        pending,
        report: report || "  (no containers found)",
      }
    }
    await sleep(intervalMs)
  }
}
