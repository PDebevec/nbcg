import fs from "node:fs"
import path from "node:path"
import { __backend } from "./path.js"
import { runCommand } from "./exec-utils.js"
import { parseEnvFile, ROOT_ENV_PATH } from "./env-utils.js"
import { waitForPostgresContainer } from "./health-utils.js"
import { getContainerStates, summariseStates, execInContainer, requireRunningService } from "./docker-utils.js"
import { UsageError } from "./runner.js"
import { consoleLog } from "./logger.js"

const PRISMA_BIN = path.join(__backend, "node_modules", ".bin", "prisma")
const BACKEND_ENV = path.join(__backend, ".env")

/**
 * Checks everything the dev migration needs before touching the database, so
 * a missing prerequisite reports itself instead of surfacing as an opaque
 * Prisma connection error.
 */
function preflightDev() {
  if (!fs.existsSync(BACKEND_ENV))
    throw new UsageError(
      `backend/.env is missing, so Prisma has no DATABASE_URL.\n` +
      `Run the "App env files" setup step first (make step STEP=fbEnd).`
    )

  if (!fs.existsSync(PRISMA_BIN))
    throw new UsageError(
      `Prisma is not installed in backend/.\n` +
      `Run App Menu -> Setup Backend first (make app A=setup T=backend).`
    )
}

/**
 * Summarises `prisma migrate deploy` output. Prisma reports "No pending
 * migrations to apply." when there is nothing to do, which is a genuine no-op
 * and should read differently from having actually migrated.
 * @param {string} output
 */
function summariseMigrateOutput(output) {
  const text = output || ""

  if (/No pending migrations to apply/i.test(text))
    return { message: "already up to date", noop: true }

  const applied = text.match(/Applying migration `([^`]+)`/g)
  if (applied && applied.length > 0)
    return { message: `${applied.length} migration${applied.length === 1 ? "" : "s"} applied` }

  const count = text.match(/(\d+)\s+migrations?\s+found/i)
  if (count) return { message: `schema up to date (${count[1]} migrations found)` }

  return { message: "migrate deploy completed" }
}

/**
 * Applies pending database migrations.
 *
 * Mirrors scripts/migrate.sh for dev: wait for PostgreSQL to accept
 * connections, then run `prisma migrate deploy` against the host-published
 * port. The prod branch of that script execs into a `backend` container that
 * docker-compose.prod.yml does not define, so prod fails fast with an
 * explanation rather than waiting on a health check that can never pass.
 *
 * @param {"dev"|"prod"} env
 */
export async function runMigrations(env = "dev") {
  if (env === "prod") return runProdMigrations()

  preflightDev()

  const rootEnv = fs.existsSync(ROOT_ENV_PATH) ? parseEnvFile(ROOT_ENV_PATH) : {}
  const user = rootEnv.POSTGRES_USER
  const db = rootEnv.POSTGRES_DB
  if (!user || !db)
    throw new UsageError(`POSTGRES_USER / POSTGRES_DB are missing from the root .env — re-run the "Environment" step.`)

  // Only wait when the container is actually up and still starting. Polling
  // for 60s against a container that does not exist is a pointless hang.
  await requireRunningService("db")

  console.log(`Waiting for PostgreSQL (db) to accept connections...`)
  await waitForPostgresContainer("db", user, db, 60000, (waited) => {
    console.log(`  still waiting... ${Math.round(waited / 1000)}s`)
  })
  console.log(`PostgreSQL is ready.\n`)

  // Captured as well as echoed: the operator sees Prisma's own output, and the
  // banner gets a summary of what actually changed.
  let output = ""
  await runCommand(PRISMA_BIN, ["migrate", "deploy"], {
    cwd: __backend,
    stdio: ["inherit", "pipe", "inherit"],
    onStdout: (chunk) => { process.stdout.write(chunk); output += chunk },
  })

  const summary = summariseMigrateOutput(output)
  consoleLog("INFO", `migrate: ${summary.message}`)
  return summary
}

/**
 * Applies migrations in production.
 *
 * The backend container already does this on every start — its start:prod is
 * `prisma migrate deploy && node dist/src/main.js` — so this exists for
 * applying a migration without a restart, and for confirming the state.
 * Running it against a running container is therefore always safe.
 */
async function runProdMigrations() {
  // In prod migrations run inside the backend container itself, so it must
  // already be up — the hint says why, not just what to do.
  await requireRunningService("backend", "In prod migrations run inside it — start it first (make up SVC=backend).")

  let output = ""
  await execInContainer("backend", ["npx", "prisma", "migrate", "deploy"], {
    stdio: ["inherit", "pipe", "inherit"],
    onStdout: (chunk) => { process.stdout.write(chunk); output += chunk },
  })

  const summary = summariseMigrateOutput(output)
  consoleLog("INFO", `migrate: ${summary.message}`)
  return summary
}

/**
 * Reports the state and health of every compose service, using the
 * healthchecks already declared in the compose files.
 */
export async function runHealthChecks() {
  let states
  try {
    states = await getContainerStates()
  } catch (error) {
    throw new UsageError(
      `Could not read container status — are the compose files in place?\n(${error.message})`
    )
  }

  if (states.length === 0)
    return { message: "no containers exist yet", noop: true }

  const nameWidth = Math.max(...states.map(s => s.service.length), 10)
  console.log(`  ${"SERVICE".padEnd(nameWidth)}  ${"STATE".padEnd(10)}  HEALTH`)
  console.log(`  ${"-".repeat(nameWidth)}  ${"-".repeat(10)}  ${"-".repeat(14)}`)
  for (const s of [...states].sort((a, b) => a.service.localeCompare(b.service))) {
    // Docker only reports health for a running container, so an absent value
    // means "no healthcheck" only while it is up — otherwise it means nothing
    const health = s.health || (s.running ? "(no healthcheck)" : "—")
    console.log(`  ${s.service.padEnd(nameWidth)}  ${(s.state || "?").padEnd(10)}  ${health}`)
  }

  const { total, running, healthy, unhealthy, starting } = summariseStates(states)
  // Only meaningful for running containers, for the reason above
  const noCheck = states.filter(s => s.running && !s.health).length

  const parts = [
    `${running}/${total} running`,
    healthy ? `${healthy} healthy` : null,
    starting ? `${starting} starting` : null,
    unhealthy ? `${unhealthy} unhealthy` : null,
    noCheck ? `${noCheck} without healthcheck` : null,
  ].filter(Boolean)

  // The table above is the detail; the summary is the reported result, shown
  // once by whichever caller ran this (menu banner or dispatcher echo).
  return { message: parts.join(" · ") }
}
