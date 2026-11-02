import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { ROOT_ENV_PATH, __root, __infra } from "./path.js"
import { appEnvOutputs, confTemplateOutputs } from "../init-env.js"

/**
 * Config history: before `config apply` renders anything, every file the
 * render chain can touch is copied into infrastructure/.config-history/<ts>/.
 * That snapshot is what `config revert` restores, so a bad configuration
 * change (or a change that only breaks at runtime) has a one-command way
 * back — including the master.config.json the change came from.
 */

export const HISTORY_DIR = path.join(__infra, ".config-history")

/** Every file the render chain reads or writes (root .env, master, outputs). */
export function configTrackedFiles() {
  return [
    path.join(__infra, "master.config.json"),
    ROOT_ENV_PATH,
    ...appEnvOutputs(),
    ...confTemplateOutputs(),
    path.join(__root, "docker-compose.yml"),
    path.join(__root, "docker-compose.ext.yml"),
  ]
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")

/**
 * Copies every existing tracked file into a new history directory and writes
 * a manifest. Returns the directory path. Prunes older entries beyond 10 —
 * always under `historyRoot`, never the entry being written.
 * @param {string} label human-readable reason, kept in the manifest
 * @param {object} [options] { files, root, historyRoot, dir } overrides (tests)
 */
export function snapshotConfig(label = "", options = {}) {
  const {
    files = configTrackedFiles(),
    root = __root,
    historyRoot = HISTORY_DIR,
    dir = path.join(historyRoot, stamp()),
  } = options

  fs.mkdirSync(dir, { recursive: true })
  const manifest = []
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const rel = path.relative(root, file)
    const dest = path.join(dir, "files", rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(file, dest)
    manifest.push(rel)
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    at: new Date().toISOString(), label, files: manifest,
  }, null, 2))
  pruneHistory(10, historyRoot)
  return dir
}

/** Newest-first history entries: { dir, name, at, label, files }. */
export function historyEntries(options = {}) {
  const { dir = HISTORY_DIR } = options
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith("."))
    .map(e => {
      const full = path.join(dir, e.name)
      let manifest = {}
      try { manifest = JSON.parse(fs.readFileSync(path.join(full, "manifest.json"), "utf8")) } catch { /* legacy/partial */ }
      return { dir: full, name: e.name, at: manifest.at ?? e.name, label: manifest.label ?? "", files: manifest.files ?? [] }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * Copies a snapshot's files back over their originals.
 * @param {string} historyDir
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {string[]} [options.skip] repo-relative paths to leave untouched
 *        (revert uses this for master.config.json: it is the operator's input
 *        file, and restoring generated outputs must never discard edits the
 *        operator made after the apply)
 * @returns {string[]} repo-relative paths restored
 */
export function restoreSnapshot(historyDir, options = {}) {
  const { root = __root, skip = [] } = options
  const manifestPath = path.join(historyDir, "manifest.json")
  if (!fs.existsSync(manifestPath))
    throw new Error(`history entry has no manifest: ${historyDir}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))

  const restored = []
  for (const rel of manifest.files) {
    if (skip.includes(rel)) continue
    const src = path.join(historyDir, "files", rel)
    if (!fs.existsSync(src)) continue
    const dest = path.join(root, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
    restored.push(rel)
  }
  return restored
}

function pruneHistory(keep, historyRoot) {
  const entries = historyEntries({ dir: historyRoot })
  for (const entry of entries.slice(keep)) {
    fs.rmSync(entry.dir, { recursive: true, force: true })
  }
}

/**
 * Per-file change summary between a history snapshot and the working tree:
 * [{ rel, summary: "+A -B" | "created" | "deleted" | "changed" }].
 * Line counts come from `git diff --no-index --numstat` (git exits 1 when
 * files differ — the numbers are still on stdout).
 */
export function diffSummary(historyDir, options = {}) {
  const { files = configTrackedFiles(), root = __root } = options
  const changes = []
  for (const file of files) {
    const rel = path.relative(root, file)
    const oldFile = path.join(historyDir, "files", rel)
    const oldExists = fs.existsSync(oldFile)
    const newExists = fs.existsSync(file)
    if (!oldExists && !newExists) continue
    if (oldExists && !newExists) { changes.push({ rel, summary: "deleted" }); continue }
    if (!oldExists && newExists) { changes.push({ rel, summary: "created" }); continue }
    if (fs.readFileSync(oldFile).equals(fs.readFileSync(file))) continue

    let summary = "changed"
    try {
      const out = execFileSync("git", ["diff", "--no-index", "--numstat", oldFile, file], { encoding: "utf8" })
      const [add, del] = out.trim().split("\n")[0].split("\t")
      if (add !== undefined) summary = `+${add} -${del}`
    } catch (error) {
      const out = String(error.stdout || "").trim()
      const [add, del] = (out.split("\n")[0] || "").split("\t")
      if (add !== undefined && del !== undefined) summary = `+${add} -${del}`
    }
    changes.push({ rel, summary })
  }
  return changes
}
