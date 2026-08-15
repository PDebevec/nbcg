import { state } from "./scripts/lib/state.js"
import { runMenu } from "./scripts/lib/cli-util.js"
import { handleApps, handleClearENV, handleDocker, handleSetup } from "./scripts/cli-handle.js"
import { existingPaths, describeArtifacts } from "./scripts/lib/clear-utils.js"
import { consoleLog } from "./scripts/lib/logger.js"

// Seed state from process.env.ENV once, if state doesn't already know the env
if (process.env.ENV && !state.current.environment) {
  if (process.env.ENV !== "dev" && process.env.ENV !== "prod")
    consoleLog("WARN", `Ignoring ENV="${process.env.ENV}" — expected "dev" or "prod"`)
  else
    state.setEnvironment(process.env.ENV)
}

export async function mainMenu() {
  await runMenu({
    title: "MAIN MENU",
    allowBack: false,
    status: () => [describeArtifacts()],
    build: () => {
      const env = state.current.environment || ""
      // Gate on the compose files actually being present rather than on the
      // step flag: re-running an earlier step invalidates dockerFilesCopied
      // while the files remain on disk, and hiding the menus then would
      // strand the user with no way back to Docker or Clear.
      const composeReady = existingPaths("compose").length > 0

      return [
        { name: "Start Setup", submenu: true, run: handleSetup },
        {
          name: "Docker Menu",
          disabled: !composeReady,
          disabledReason: "run setup first (no compose files)",
          submenu: true,
          run: () => handleDocker(state.current.docker.initialized ? undefined : "SETUP")
        },
        {
          name: "App Menu (frontend/backend)",
          hint: env === "dev" ? "" : "dev only",
          disabled: env !== "dev" || !state.isStepDone("fbEnd"),
          disabledReason: env !== "dev" ? "dev environment only" : "run the App env files step first",
          submenu: true,
          run: handleApps
        },
        // Never gated — this is the escape hatch when things are broken
        { name: "Clear Environment", submenu: true, run: handleClearENV },
        { name: "Exit CLI", run: () => process.exit(0) },
      ]
    }
  })
}

/** Ctrl+C at a prompt is a normal way to quit, not a crash — inquirer signals
 * it by rejecting with ExitPromptError, which otherwise prints a stack trace. */
function isExitPrompt(error) {
  return error?.name === "ExitPromptError"
}

;(async () => {
  try {
    await mainMenu()
  } catch (error) {
    if (isExitPrompt(error)) {
      console.log("\nExiting.")
      process.exit(0)
    }
    consoleLog("ERROR", error instanceof Error ? error : String(error))
    process.exit(1)
  }
})()
