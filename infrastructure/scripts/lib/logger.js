import fs from "node:fs"
import path from "node:path"
import { __infra } from "./path.js"

const LOG_DIR = path.join(__infra, "log")

/**
 * Renders a log payload as a single line. Errors keep their stack, plain
 * objects are serialized — the old `${message}` interpolation turned both
 * into "[object Object]".
 * @param {string|object|Array|Error} message
 */
function formatMessage(message) {
  if (message instanceof Error) return message.stack || message.message
  if (typeof message === "string") return message
  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

/**
 *
 * @param {"DEBUG" | "INFO" | "WARN" | "ERROR"} type
 * @param {string|object|Array|Error} message
 */
export function consoleLog(type, message, fsLog=true) {
  const newDate = new Date
  const log = `\n[${newDate.toISOString()}] [${type}] [${formatMessage(message)}]`

  if (type === "ERROR")
    console.error(log)
  else
    console.log(log)

  if (fsLog && type !== "DEBUG") {
    // log/ is gitignored, so it is absent on a fresh clone
    fs.mkdirSync(LOG_DIR, { recursive: true })
    const logPath = path.join(LOG_DIR, `${newDate.getFullYear()}-${newDate.getMonth() + 1}.log`)
    fs.appendFileSync(logPath, log, { encoding:"utf-8", flag:"a" })
  }
}
