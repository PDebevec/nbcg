import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { __infra, __lib, __docker } from "./path.js";
import { ROOT_ENV_PATH } from "./path.js";

/**
 * Fingerprinting: how the CLI decides that a recorded "done" still describes
 * the files on disk.
 *
 * The problem this solves: `.cli-state.json` used to store a bare boolean per
 * step, so "ran once" was indistinguishable from "is current". A `git pull`
 * that changed a compose template, a template renderer or the master config
 * left every step flagged done, and the documented deploy procedure
 * (`git pull` → `make cli` → run everything remaining) silently did nothing.
 * A human-edited or deleted generated file looked equally fine.
 *
 * A step is therefore recorded with a fingerprint over everything that
 * determines its output:
 *
 *   1. its environment and key        — so dev and prod never share progress
 *   2. its own implementation         — `step.run.toString()` plus the shared
 *                                      library tree, so an edit to the code
 *                                      that produces the output invalidates it
 *   3. its declared inputs            — config, templates, env sources
 *   4. its declared outputs           — so a deleted or hand-edited generated
 *                                      file is detected as drift, not trusted
 *
 * Deliberately coarse. Hashing the whole shared library means an edit to any of
 * it re-runs every step. That is the safe direction: re-running a step
 * regenerates its output from its inputs, whereas a false "done" leaves a
 * machine quietly wrong. Correctness wins over avoiding a rebuild.
 *
 * A file that does not exist hashes to the literal string "missing" rather
 * than being omitted, so "was never there" and "was there and is now gone"
 * produce different fingerprints.
 */

/** Marker recorded in place of a hash for a path that does not exist. */
const MISSING = "missing";

/** Hashes a string. */
function hashString(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Hashes one file's contents, or MISSING. Unreadable is treated as MISSING so
 * a permission problem invalidates rather than silently passing.
 * @param {string} filePath
 */
export function hashFile(filePath) {
  try {
    return hashString(fs.readFileSync(filePath));
  } catch {
    return MISSING;
  }
}

/**
 * Hashes a directory as the sorted list of its relative paths with each file's
 * contents folded in. Used for steps whose output is a tree (certificates),
 * where "the directory exists" is not enough — a removed leaf must show up.
 *
 * Hashes file *names and contents*, deliberately not mtimes: `git checkout`
 * rewrites mtimes without changing content, and keying on mtime would make
 * every step permanently stale after a pull.
 *
 * @param {string} dir
 */
export function hashTree(dir) {
  const parts = [];
  const walk = (current, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      parts.push(`${prefix}\0${MISSING}`);
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else parts.push(`${prefix}${entry.name}\0${hashFile(full).slice(7)}`);
    }
  };
  walk(dir, "");
  return hashString(parts.join("\n"));
}

/**
 * Hash of a { path: hash } map, with paths included so a rename is a change.
 * @param {Record<string, string>} map
 */
function hashPathMap(map) {
  return hashString(
    Object.keys(map)
      .sort()
      .map((key) => `${key}\0${map[key]}`)
      .join("\n")
  );
}

/** Hashes each path, tolerating a null/undefined list. */
function hashPaths(paths) {
  const map = {};
  for (const filePath of paths || []) map[filePath] = hashFile(filePath);
  return map;
}

/**
 * Hashes a mixed list of output paths. A step's output may be a file (a
 * rendered config) or a directory (the certificate tree), and hashing a
 * directory with readFile would always yield MISSING — which would make every
 * run look stale. Each path is therefore hashed according to what it is.
 *
 * `mode` is "content" for almost every step: the output is fully owned by that
 * step, so a changed digest means real drift. The exception is "existence",
 * used by a step whose output a later step legitimately rewrites — `env`
 * produces the root .env, and `config` then merges the master config into it.
 * Content-hashing .env for `env` would make that step permanently stale, since
 * the digest recorded at the end of `env` could never match the content
 * `config` goes on to write. For such a step, only presence is checked.
 *
 * @param {string[]} paths
 * @param {"content"|"existence"} [mode]
 */
function hashOutputs(paths, mode = "content") {
  const map = {};
  for (const target of paths || []) {
    if (mode === "existence") {
      map[target] = fs.existsSync(target) ? "present" : "missing";
    } else {
      map[target] = isDir(target) ? hashTree(target) : hashFile(target);
    }
  }
  return map;
}

/**
 * The flags that are not setup steps but are still recorded and go stale.
 * Exported so state.js can tell them apart: setStep() gives them a fingerprint
 * automatically, which is what keeps `osSecured`/`migrate`/`health` honest
 * without every call site having to remember to ask for one.
 */
export const TRACKED_FLAGS = ["osSecured", "migrate", "health"];

/** True when the path exists and is a directory. */
function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The shared implementation: every file under lib/, plus the two top-level
 * modules whose logic reaches the outputs. Editing any of these can change
 * what any step produces, so any of them invalidates every step.
 *
 * Memoised per process — the menus re-render on every keystroke and would
 * otherwise re-read the tree for each step on each repaint.
 */
let implCache = null;
function sharedImplHash() {
  if (implCache) return implCache;
  const files = [
    path.join(__lib, "app-utils.js"),
    path.join(__lib, "cert-utils.js"),
    path.join(__lib, "clear-utils.js"),
    path.join(__lib, "cli-util.js"),
    path.join(__lib, "config-utils.js"),
    path.join(__lib, "db-utils.js"),
    path.join(__lib, "docker-utils.js"),
    path.join(__lib, "env-utils.js"),
    path.join(__lib, "exec-utils.js"),
    path.join(__lib, "health-utils.js"),
    path.join(__lib, "logger.js"),
    path.join(__lib, "opensearch-utils.js"),
    path.join(__lib, "reconcile-utils.js"),
    path.join(__lib, "requirements.js"),
    path.join(__lib, "runner.js"),
    // steps.js holds the inputs/outputs declarations and executeStep itself, so
    // an edit to what a step reads or writes has to invalidate it. It was
    // missing from this list at first, which meant changing a step's declared
    // inputs silently invalidated nothing.
    path.join(__lib, "steps.js"),
    // Deliberately NOT hashed, each for a reason:
    //   state.js     — records the fingerprint; hashing it would change every
    //                  fingerprint the moment this file is edited, and a record
    //                  could never equal the fingerprint that produced it.
    //   fingerprint.js — a change here alters the digest, so every recorded
    //                  fingerprint stops matching on the next check anyway.
    //   path.js      — only path constants; a change alters the hashed paths.
    //   state.spec.js — tests must not invalidate production steps.
    //   cli-handle.js, cli-util.js — presentation and prompts; they change no
    //                  step's output, and invalidating on a UI tweak would
    //                  make the pipeline re-run for nothing.
    path.join(__infra, "scripts", "init-env.js"),
    path.join(__infra, "scripts", "requirements.js")
  ];
  implCache = hashPaths(files);
  return implCache;
}

/**
 * The fingerprint of a setup step.
 *
 * `step` needs `key`, `run`, and the `inputs`/`outputs` declarations added in
 * steps.js. `env` is part of the digest, which is what keeps a prod run from
 * ever satisfying a dev check.
 *
 * @param {{ key: string, run: Function, inputs?: Function, outputs?: Function }} step
 * @param {"dev"|"prod"} env
 * @returns {string}
 */
export function stepFingerprint(step, env) {
  const inputs = typeof step.inputs === "function" ? step.inputs(env) : step.inputs || [];
  const outputs = typeof step.outputs === "function" ? step.outputs(env) : step.outputs || [];
  return hashString(
    [
      `env\0${env}`,
      `step\0${step.key}`,
      // The step's own body, so an inline edit is caught even if no shared file
      // changed.
      `body\0${hashString(String(step.run))}`,
      `impl\0${hashPathMap(sharedImplHash())}`,
      `inputs\0${hashPathMap(hashPaths(inputs))}`,
      `outputs\0${hashPathMap(hashOutputs(outputs, step.outputCheck))}`
    ].join("\n")
  );
}

/**
 * Fingerprints for the flags that are not setup steps — `osSecured`, `migrate`
 * and `health`. They are recorded by the Docker and database menus rather than
 * by the pipeline, but they are still environment-specific and still go stale.
 *
 * `health` deliberately has none: it is a point-in-time observation with no
 * artifact behind it, so "already checked once" is the honest reading.
 *
 * @param {"osSecured"|"migrate"|"health"} name
 * @param {"dev"|"prod"} env
 * @returns {string|null}
 */
export function flagFingerprint(name, env) {
  switch (name) {
    case "osSecured":
      // What configureSecurity() acts on: the node config it wrote, and the
      // root .env holding the app user and password it installs. Either
      // changing means the cluster's user store must be rebuilt.
      return hashPathMap(
        hashPaths([path.join(__docker, "opensearch", "opensearch.yml"), ROOT_ENV_PATH])
      );
    case "migrate":
      // A new migration file means the database is behind.
      return hashString(
        [
          hashTree(path.join(__infra, "..", "backend", "prisma", "migrations")),
          hashFile(path.join(__infra, "..", "backend", "prisma", "schema.prisma"))
        ].join("\n")
      );
    case "health":
    default:
      return null;
  }
}
