import path from "node:path"
import { fileURLToPath } from "node:url"
import { consoleLog } from "./logger.js"

/**
 * True when `importMetaUrl`'s module is the file node was invoked with, i.e.
 * `node scripts/foo.js` rather than `import`ed by something else.
 * @param {string} importMetaUrl the module's import.meta.url
 */
export function isMain(importMetaUrl) {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.resolve(invoked) === path.resolve(fileURLToPath(importMetaUrl))
}

/**
 * A mistake in the command line rather than a failure of the work itself
 * (unknown step, unmet dependency, bad environment name). Reported as a plain
 * message — a stack trace here is noise, while a stack from a genuinely
 * failing step is exactly what you want to see.
 */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = "UsageError"
  }
}

/**
 * Runs `fn(argv)` only when the module is being executed directly, exiting
 * non-zero on failure. Lets every script be both an importable module and a
 * standalone command, which is what makes step-by-step debugging possible.
 * @param {string} importMetaUrl the module's import.meta.url
 * @param {(argv: string[]) => Promise<unknown>} fn
 */
export function selfRun(importMetaUrl, fn) {
  if (!isMain(importMetaUrl)) return

  Promise.resolve()
    .then(() => fn(process.argv.slice(2)))
    .catch((error) => {
      if (error instanceof UsageError) console.error(`\n${error.message}\n`)
      else consoleLog("ERROR", error instanceof Error ? error : String(error))
      process.exit(1)
    })
}

/**
 * Splits argv into flags and positional arguments.
 * `--force` becomes `{ force: true }`, `--env=dev` becomes `{ env: "dev" }`.
 * @param {string[]} argv
 * @returns {{ positional: string[], flags: Record<string, string|boolean> }}
 */
export function parseArgs(argv) {
  const positional = []
  const flags = {}

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const [name, value] = arg.slice(2).split("=")
    flags[name] = value === undefined ? true : value
  }

  return { positional, flags }
}

/**
 * Validates an environment argument, defaulting when absent.
 * @param {string|undefined} value
 * @param {"dev"|"prod"} fallback
 */
export function parseEnvArg(value, fallback = "dev") {
  const env = value || fallback
  if (env !== "dev" && env !== "prod")
    throw new UsageError(`Invalid environment "${env}" — expected "dev" or "prod"`)
  return env
}
