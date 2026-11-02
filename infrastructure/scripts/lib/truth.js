import fs from "node:fs"
import path from "node:path"
import { state } from "./state.js"
import { getContainerStates } from "./docker-utils.js"
import { __root } from "./path.js"

/**
 * Recomputes the docker bookkeeping flags from what compose actually reports,
 * so .cli-state.json can never contradict `docker compose ps`.
 *
 * The stored `containarized` flag used to be write-only bookkeeping: it was
 * flipped by CLI actions (`up` → true, `stop` → false) and read by nothing,
 * which meant every out-of-band docker command (`docker compose down`, a
 * hand-run `stop`, a stack restarted by the docker daemon) left it lying —
 * observed in the wild as `containarized: false` while containers were
 * demonstrably up (docs/infrastructure/plans/infrastructure-todo.md).
 *
 * Semantics after this change — `containarized` means "this project's
 * containers exist" (running OR stopped), derived at every entry point:
 *   - `up` / `create`        → containers exist → true
 *   - `stop`                 → containers still exist → true (was: false — wrong)
 *   - `down` / `clear`       → containers removed → false
 * Nothing behavioural keys off this flag today; it exists so status output
 * and future drift reporting can trust it.
 *
 * Failure policy: unknown stays untouched. If the compose files are absent or
 * the daemon cannot be queried, the live state is unknowable — overwriting
 * the flag then would just replace one lie with another.
 *
 * @returns {Promise<{ synced: boolean, value?: boolean, changed?: boolean }>}
 */
export async function syncDockerFlags() {
  if (!fs.existsSync(path.join(__root, "docker-compose.yml")))
    return { synced: false, reason: "no compose files at repo root" }

  let states
  try {
    states = await getContainerStates()
  } catch {
    return { synced: false, reason: "compose not queryable (daemon down?)" }
  }

  const env = state.current.environment || "dev"
  const exist = states.length > 0
  const previous = state.isDocker("containarized", env)
  if (previous !== exist) {
    state.setDocker("containarized", exist, env)
    return { synced: true, value: exist, changed: true }
  }
  return { synced: true, value: exist, changed: false }
}
