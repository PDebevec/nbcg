import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { UsageError } from "./runner.js"
import { __infra } from "./path.js"

/**
 * Mutual exclusion between every entry point that mutates shared state: the
 * dispatcher (run.js), and the shell scripts (backup.sh / restore.sh, which
 * write the same JSON lock file with `noclobber`).
 *
 * Without this, two concurrent runs each load .cli-state.json once at import
 * and later write it back in full — last writer wins, silently dropping the
 * other run's flags. It also serialises docker operations that would
 * otherwise interleave (a `down` racing an `up`).
 *
 * Protocol (both implementations must agree):
 *   - lock = a file at NBCG_CLI_LOCK_FILE (default infrastructure/.cli-lock)
 *     created exclusively, containing { pid, host, at, command }.
 *   - held  = same-host owner whose pid is alive, or a foreign-host owner
 *     younger than STALE_MS (a remote pid cannot be probed; age is all we
 *     have).
 *   - stale = malformed content, a dead same-host pid, or an expired
 *     foreign-host lock — safe to steal. A steal re-reads the file and only
 *     unlinks if the stale record it judged is still the one on disk, so a
 *     lock released and re-acquired in between is not clobbered.
 *   - release = unlink only when the file still holds OUR record (pid + at
 *     token), so releasing never removes someone else's freshly-taken lock.
 */

export const LOCK_PATH = process.env.NBCG_CLI_LOCK_FILE || path.join(__infra, ".cli-lock")

/** Foreign-host locks are reclaimed after this long. */
const STALE_MS = 60 * 60 * 1000
const WAIT_INTERVAL_MS = 400
const DEFAULT_WAIT_MS = 60_000

/** Non-blocking sleep for the wait loop — the event loop must keep running
 * so child-process exits get reaped and pid liveness stays accurate. */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function readOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"))
  } catch {
    // Missing or malformed: malformed counts as stale (see protocol above).
    return null
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error.code === "EPERM"
  }
}

function isStale(owner) {
  if (!owner || typeof owner.pid !== "number" || !Number.isFinite(Date.parse(owner.at ?? "")))
    return true
  if (owner.host === os.hostname()) return !pidAlive(owner.pid)
  return Date.now() - Date.parse(owner.at) > STALE_MS
}

function describe(owner) {
  if (!owner) return "an unreadable lock file"
  const since = Number.isFinite(Date.parse(owner.at)) ? owner.at : "unknown time"
  const by = owner.command ? `: ${owner.command}` : ""
  return `pid ${owner.pid} on ${hostLabel(owner.host)} since ${since}${by}`
}

function hostLabel(host) {
  return host === os.hostname() ? "this machine" : host
}

/**
 * Creates the lock file exclusively. Resolves to a release function, or null
 * when the lock is held and `nowait` is set. Async because the --wait path
 * must not block the event loop (child exits are reaped there, and a
 * blocked loop would keep dead holders looking alive).
 *
 * @param {object} [options]
 * @param {boolean} [options.wait]    queue behind a live holder instead of failing
 * @param {number}  [options.waitMs]  how long --wait may queue (default 60s)
 * @param {boolean} [options.nowait]  return null instead of throwing when held
 * @param {string}  [options.path]    override the lock file (tests)
 * @param {string}  [options.command] recorded in the lock for diagnostics
 * @returns {Promise<{ release: () => void } | null>}
 */
export async function acquireLock(options = {}) {
  const { wait = false, waitMs = DEFAULT_WAIT_MS, nowait = false, path: lockPath = LOCK_PATH, command } = options
  const deadline = Date.now() + waitMs
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const record = () => JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    at: new Date().toISOString(),
    command: command ?? process.argv.slice(2).join(" "),
    token,
  })

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx")
      try {
        fs.writeSync(fd, record())
      } finally {
        fs.closeSync(fd)
      }
      return makeReleaser(lockPath, token)
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }

    const owner = readOwner(lockPath)
    if (isStale(owner)) {
      // Re-read immediately before unlink: if the stale record we judged was
      // already replaced by a fresh acquisition, leave it alone and retry.
      const current = readOwner(lockPath)
      if (current && JSON.stringify(current) !== JSON.stringify(owner)) continue
      try {
        fs.unlinkSync(lockPath)
      } catch {
        continue
      }
      continue
    }

    if (wait && Date.now() < deadline) {
      await sleep(Math.min(WAIT_INTERVAL_MS, Math.max(0, deadline - Date.now())))
      continue
    }
    if (nowait) return null

    throw new UsageError(
      `Another operation is already running (${describe(owner)}). ` +
      `Wait for it to finish, or pass --wait to queue behind it.`
    )
  }
}

/** Non-blocking variant: resolves to null when the lock is held. */
export async function tryAcquireLock(options = {}) {
  return acquireLock({ ...options, nowait: true })
}

function makeReleaser(lockPath, token) {
  let released = false
  const release = () => {
    if (released) return
    released = true
    try {
      const owner = readOwner(lockPath)
      if (owner && owner.token === token && owner.pid === process.pid) fs.unlinkSync(lockPath)
    } catch {
      // Already gone — releasing twice must never throw.
    }
  }
  // Last-resort cleanup: a crash path that skips the caller's finally must
  // not leave a lock behind for the full staleness window.
  process.once("exit", release)
  return { release }
}
