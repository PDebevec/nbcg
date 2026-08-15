import inquirer from "inquirer"
import fs from "node:fs"
import { parseEnvFile, ROOT_ENV_PATH } from "./env-utils.js"
import { UsageError } from "./runner.js"

const WIDTH = 54
const BORDER = "─".repeat(WIDTH)
/** Column where menu hints and disabled reasons start, so they line up. */
const HINT_COLUMN = 34

/** Outcome glyphs, used by every menu so the vocabulary is the same everywhere. */
export const GLYPH = { ok: "✓", fail: "✗", noop: "–" }

/**
 * Reads and returns the current environment state from process or root .env
 * @returns {{ env: string, isInitialized: boolean, raw: Record<string, string> }}
 */
export function getCurrentState() {
  let envVars = {}

  if (fs.existsSync(ROOT_ENV_PATH)) {
    try {
      envVars = parseEnvFile(ROOT_ENV_PATH)
    } catch {
      // Fallback if file isn't created yet or unreadable
    }
  }

  const env = process.env.ENV || envVars.ENV || "none"
  const isInitialized = env !== "none"

  return { env, isInitialized, raw: envVars }
}

/** Truncates to the card's inner width so the border never breaks. */
function fit(text, width = WIDTH - 2) {
  const s = String(text)
  return s.length > width ? `${s.slice(0, width - 1)}…` : s.padEnd(width)
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Renders the result of the action that just ran. Because every menu redraw
 * clears the screen, this banner is the only way a successful action leaves
 * any trace — without it, doing something and doing nothing look identical.
 * @param {{ ok: boolean, noop?: boolean, label: string, message: string, ms: number }} result
 */
function formatResult(result) {
  const glyph = !result.ok ? GLYPH.fail : result.noop ? GLYPH.noop : GLYPH.ok
  const head = `  ${glyph} ${result.label}`
  const body = result.message ? ` — ${result.message}` : ""
  const time = result.ms === undefined ? "" : `  (${formatDuration(result.ms)})`
  return `${head}${body}${time}`
}

/**
 * Clears the screen and renders the header card, optional status rows, and the
 * banner for the previous action.
 * @param {{ title?: string, statusLines?: string[], lastResult?: object|null }} options
 */
export function printScreen({ title = "INFRASTRUCTURE CONTROL", statusLines = [], lastResult = null } = {}) {
  console.clear()
  const state = getCurrentState()

  const envLabel = `ENV: [${state.env.toUpperCase()}]`
  const statusLabel = `STATUS: ${state.isInitialized ? "INITIALIZED" : "NOT INITIALIZED"}`

  console.log(`┌${BORDER}┐`)
  console.log(`│ ${fit(title)} │`)
  console.log(`├${BORDER}┤`)
  console.log(`│ ${fit(`${envLabel.padEnd(23)} ${statusLabel}`)} │`)
  for (const line of statusLines.filter(Boolean)) {
    console.log(`├${BORDER}┤`)
    console.log(`│ ${fit(line)} │`)
  }
  console.log(`└${BORDER}┘`)

  console.log(lastResult ? `\n${formatResult(lastResult)}\n` : "")
}

/**
 * Renders a one-shot list selection. Used for nested target pickers (which
 * service, which app); menus themselves use runMenu().
 * @param {string} message - Menu prompt description
 * @param {Array<{ name: string, value: any, disabled?: boolean|Function, disabledReason?: string }>} choices
 * @returns {Promise<any>} Selected value
 */
export async function promptMenu(message, choices) {
  const resolvedChoices = choices.map((choice) => {
    const isDisabled = typeof choice.disabled === "function"
      ? choice.disabled()
      : !!choice.disabled;

    return {
      name: choice.name,
      value: choice.value !== undefined ? choice.value : choice,
      disabled: isDisabled
        ? (typeof choice.disabledReason === "string" ? choice.disabledReason : true)
        : false
    };
  });
  if (message !== "Main Menu")
    resolvedChoices.push({ name: "< back", value: "BACK" })

  const { selected } = await inquirer.prompt([
    {
      type: "select",
      name: "selected",
      message,
      choices: resolvedChoices
    }
  ]);

  return selected;
}

/**
 * Prompts user to select an environment ("dev" | "prod")
 * @returns {Promise<"dev" | "prod">}
 */
export async function promptEnvSelection() {
  const { env } = await inquirer.prompt([
    {
      type: "select",
      name: "env",
      message: "Select environment:",
      choices: [
        { name: "Development (dev)", value: "dev" },
        { name: "Production (prod)", value: "prod" }
      ]
    }
  ])
  return env
}

/**
 * Prompts user for a yes/no confirmation
 * @param {string} message
 * @param {boolean} defaultYes
 * @returns {Promise<boolean>}
 */
export async function promptConfirm(message, defaultYes = false) {
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message,
      default: defaultYes
    }
  ])
  return confirm
}

/**
 * Normalises whatever an action returned into a banner message.
 * Actions may return nothing, a string, an array (summarised by length), or
 * `{ message, noop }` to say "I ran, but there was nothing to do".
 */
function summarise(value) {
  if (value === undefined || value === null) return { message: "done" }
  if (typeof value === "string") return { message: value }
  if (Array.isArray(value)) {
    return value.length === 0
      ? { message: "nothing to do", noop: true }
      : { message: `${value.length} item${value.length === 1 ? "" : "s"}` }
  }
  if (typeof value === "object") {
    return { message: value.message ?? "done", noop: !!value.noop }
  }
  return { message: String(value) }
}

/**
 * Runs one menu action and turns its outcome into a banner. The single place
 * where "what just happened" is decided, so every menu reports identically.
 *
 * Failures always pause: an error would otherwise be erased by the next
 * redraw. A UsageError prints its message only — a stack trace for "start the
 * containers first" is noise, while a stack from a genuine failure is the
 * point.
 *
 * @param {string} label
 * @param {() => Promise<any>} fn
 * @param {{ pause?: boolean }} options pause even on success (output-heavy actions)
 */
export async function runAction(label, fn, { pause = false } = {}) {
  const started = Date.now()
  try {
    const value = await fn()
    const ms = Date.now() - started
    const { message, noop } = summarise(value)
    if (pause) await pauseTerminal("\nPress Enter to return to menu...")
    return { ok: true, noop, label, message, ms }
  } catch (error) {
    // Ctrl+C is the user quitting, not the action failing — let it reach the
    // top-level handler instead of reporting it as an error and pausing
    if (isExitPrompt(error)) throw error

    const ms = Date.now() - started
    if (error instanceof UsageError) console.error(`\n${error.message}`)
    else console.error(error)
    await pauseTerminal("\nPress Enter to return to menu...")
    return { ok: false, label, message: error.message, ms }
  }
}

/** inquirer signals Ctrl+C at a prompt by rejecting with ExitPromptError. */
export function isExitPrompt(error) {
  return error?.name === "ExitPromptError"
}

/**
 * Runs a menu loop: redraw, prompt, dispatch, remember the outcome.
 *
 * `build()` returns choices as
 *   { name, hint?, disabled?, disabledReason?, pause?, run? }
 * or `{ separator: "text" }`. Choices are rebuilt every redraw so disabled
 * states track the current state of the world.
 *
 * @param {{ title: string, status?: () => Promise<string[]>|string[], build: () => Promise<any[]>|any[] }} options
 */
export async function runMenu({ title, status, build, allowBack = true }) {
  let lastResult = null

  while (true) {
    const statusLines = status ? await status() : []
    printScreen({ title, statusLines, lastResult })

    const entries = await build()
    const actionable = entries.filter(e => !e.separator)

    const choices = entries.map((entry) => {
      if (entry.separator) return new inquirer.Separator(`  ${entry.separator}`)

      const isDisabled = typeof entry.disabled === "function" ? entry.disabled() : !!entry.disabled
      // Pad whenever something will be appended (a hint, or inquirer's
      // disabled reason) so the second column lines up down the menu.
      // Names longer than the column still get a separating space.
      const padded = entry.name.padEnd(Math.max(HINT_COLUMN, entry.name.length + 2))
      const label = entry.hint ? `${padded}${entry.hint}`
        : isDisabled ? padded
        : entry.name

      return {
        name: label,
        value: entry,
        disabled: isDisabled ? (entry.disabledReason || true) : false
      }
    })
    if (allowBack) choices.push({ name: "< back", value: "BACK" })

    const { selected } = await inquirer.prompt([
      { type: "select", name: "selected", message: title, choices }
    ])

    if (selected === "BACK") return
    if (!actionable.includes(selected) || typeof selected.run !== "function") continue

    // Navigation into a submenu is not an action: it has no outcome worth
    // reporting, so it neither produces a banner nor pauses
    if (selected.submenu) {
      await selected.run()
      continue
    }

    lastResult = await runAction(selected.name.trim(), selected.run, { pause: selected.pause })
  }
}

/**
 * Pauses terminal execution until user hits Enter
 * @param {string} message
 */
export async function pauseTerminal(message = "Press Enter to return...") {
  await inquirer.prompt([
    {
      type: "input",
      name: "pause",
      message
    }
  ])
}
