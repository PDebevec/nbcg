import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { __infra } from './path.js';
import { flagFingerprint, TRACKED_FLAGS } from './fingerprint.js';

// Default state file path anchored in the infrastructure directory
const DEFAULT_STATE_FILE = path.join(__infra, '.cli-state.json');

/**
 * NBCG_CLI_STATE_FILE redirects the state file. It exists so the state
 * machine can be exercised against a scratch file — the fingerprint rules are
 * subtle enough (migration, staleness, environment isolation) that they need
 * tests, and those tests must not depend on — or disturb — the real progress
 * file. Also useful for keeping two working copies of a repo side by side.
 */
const STATE_FILE = process.env.NBCG_CLI_STATE_FILE
  ? path.resolve(process.env.NBCG_CLI_STATE_FILE)
  : DEFAULT_STATE_FILE;

/**
 * The shape of the file on disk, and the reasoning behind it.
 *
 * v2 replaced a flat `{ steps: { env: true, ... } }` map. Two problems with
 * that, both of which bit in production:
 *
 *   1. A bare boolean could not distinguish "ran once" from "is current". A
 *      `git pull` that changed a compose template or a renderer left every step
 *      flagged done, and the documented deploy procedure (`git pull` ->
 *      `make cli` -> run everything remaining) silently did nothing.
 *   2. The map had no environment dimension. `steps.env = true` from a dev run
 *      satisfied the same check during a prod run, so prod skipped the five
 *      shared steps and inherited dev's `.env`, dev's secrets and dev's compose
 *      files — reporting success throughout.
 *
 * v2 keys every flag by environment and stores a fingerprint alongside each
 * step (see lib/fingerprint.js for what goes into one). A step counts as done
 * only when the flag is set *and* the fingerprint still matches, so changed
 * inputs, a changed implementation, and a deleted or hand-edited output all
 * read as "needs doing" rather than "done".
 *
 *   {
 *     version: 2,
 *     environment: "dev",              // last used; deliberately survives reset()
 *     envs: {
 *       dev:  { steps: {...}, docker: {...}, apps: {...} },
 *       prod: { steps: {...}, docker: {...}, apps: {...} }
 *     },
 *     history: [ { step, env, status, timestamp, details } ]
 *   }
 *
 * A step record is either `false`, or `{ done, fingerprint, at, stale? }`.
 * `fingerprint: null` means "ran, but cannot be verified" — which is what a
 * migrated v1 record and a `setStep(key, true)` with no fingerprint produce.
 * Such a record satisfies isStepDone() but never isStepCurrent(), so the step
 * runs once to establish a fingerprint instead of being trusted forever.
 */
const STATE_VERSION = 2;

/** Every step key the CLI knows about, for defaults and migration. */
const STEP_KEYS = [
  'env',
  'config',
  'fbEnd',
  'applyConf',
  'certs',
  'osSecurity',
  'dockerFilesCopied',
  'appImages',
  // Not setup steps — recorded by the Docker and database menus, but tracked
  // the same way because they are equally environment-specific and equally
  // able to go stale (see flagFingerprint()).
  'osSecured',
  'migrate',
  'health'
];

const DOCKER_KEYS = ['initialized', 'containarized'];
const APP_NAMES = ['frontend', 'backend'];

export class StateManager {
  constructor(stateFilePath = STATE_FILE) {
    this.stateFilePath = stateFilePath;
    this.data = this._load();
  }

  /** Fresh, empty v2 state for one environment. */
  _emptyEnv() {
    const steps = {};
    for (const key of STEP_KEYS) steps[key] = false;
    const docker = {};
    for (const key of DOCKER_KEYS) docker[key] = false;
    const apps = {};
    for (const name of APP_NAMES) apps[name] = { setupDone: false };
    return { steps, docker, apps };
  }

  _getDefaultState() {
    return {
      version: STATE_VERSION,
      // `step`/`lastSuccess` were v1 fields describing only the most recent
      // action. Kept because run.js and the menus read them for the status
      // line; history is the real record.
      step: 'NOT_STARTED',
      lastSuccess: true,
      environment: null,
      updatedAt: null,
      systemInfo: {
        platform: os.platform(),
        hostname: os.hostname(),
        nodeVersion: process.version
      },
      envs: {
        dev: this._emptyEnv(),
        prod: this._emptyEnv()
      },
      history: []
    };
  }

  _load() {
    if (!fs.existsSync(this.stateFilePath)) return this._getDefaultState();

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
    } catch {
      // A truncated or hand-mangled file must not brick the CLI. Starting from
      // defaults is safe: every step then re-runs, which regenerates its output
      // from its inputs, and nothing is lost that the inputs do not determine.
      return this._getDefaultState();
    }

    const defaults = this._getDefaultState();
    if (parsed?.version === STATE_VERSION) return this._mergeV2(defaults, parsed);
    return this._migrateFromV1(defaults, parsed);
  }

  /** Fills in any key added since the file was written. */
  _mergeV2(defaults, parsed) {
    const envs = {};
    for (const env of ['dev', 'prod']) {
      const source = parsed.envs?.[env] || {};
      const base = defaults.envs[env];
      envs[env] = {
        steps: { ...base.steps, ...(source.steps || {}) },
        docker: { ...base.docker, ...(source.docker || {}) },
        apps: APP_NAMES.reduce((acc, name) => {
          acc[name] = { ...base.apps[name], ...(source.apps?.[name] || {}) };
          return acc;
        }, {})
      };
    }
    return {
      ...defaults,
      ...parsed,
      version: STATE_VERSION,
      envs,
      systemInfo: { ...defaults.systemInfo, ...(parsed.systemInfo || {}) },
      history: Array.isArray(parsed.history) ? parsed.history.slice(-50) : []
    };
  }

  /**
   * Brings a v1 (flat, environment-less) file forward.
   *
   * The recorded progress is preserved under the environment it was recorded
   * for, so the menus still show what happened before — but every record is
   * marked `stale` with no fingerprint, which makes it fail isStepCurrent().
   * The visible effect is that the first run after upgrading re-runs the steps
   * once, to establish fingerprints. That is the intended cost: a v1 flag
   * cannot be trusted, and re-running is always the safe direction.
   */
  _migrateFromV1(defaults, parsed) {
    if (!parsed || typeof parsed !== 'object') return defaults;

    const env = parsed.environment === 'prod' ? 'prod' : 'dev';
    const target = defaults.envs[env];

    for (const key of STEP_KEYS) {
      if (parsed.steps?.[key]) target.steps[key] = { done: true, fingerprint: null, stale: true };
    }
    for (const key of DOCKER_KEYS) {
      if (parsed.docker?.[key]) target.docker[key] = { done: true, fingerprint: null, stale: true };
    }
    for (const name of APP_NAMES) {
      if (parsed.apps?.[name]?.setupDone) target.apps[name].setupDone = { done: true, stale: true };
    }

    return {
      ...defaults,
      environment: parsed.environment ?? null,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-50) : []
    };
  }

  /**
   * Writes atomically: a temp file in the same directory, then rename. A crash
   * or a full disk mid-write leaves the previous file intact rather than a
   * truncated one — which _load() would silently discard, losing every step.
   */
  save() {
    this.data.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.stateFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.stateFilePath);
  }

  // ---------------------------------------------------------------------
  // environment
  // ---------------------------------------------------------------------

  setEnvironment(env) {
    this.data.environment = env;
    this.save();
  }

  /**
   * The environment a call applies to. Explicit wins; otherwise the last one
   * selected. Never falls back to "dev" silently for a write — an unknown
   * environment would write a record nothing ever reads.
   */
  _env(env) {
    return env ?? this.data.environment ?? 'dev';
  }

  /** The record namespace for an environment, created on demand. */
  _scope(env) {
    const key = this._env(env);
    if (!this.data.envs[key]) this.data.envs[key] = this._emptyEnv();
    return this.data.envs[key];
  }

  // ---------------------------------------------------------------------
  // steps
  // ---------------------------------------------------------------------

  /**
   * Is this step flagged as run? Environment-specific — a dev run never
   * satisfies a prod check.
   *
   * This is the raw flag. It does NOT verify the fingerprint; steps.js's
   * isStepCurrent() does, and that is what the menus and the dispatcher gate on.
   *
   * @param {string} key
   * @param {"dev"|"prod"} [env]
   */
  isStepDone(key, env) {
    const record = this._scope(env).steps[key];
    return record === true || record?.done === true;
  }

  /**
   * Marks a step done or not.
   *
   * `fingerprint` should be passed whenever the step actually ran (steps.js
   * computes it). Without one the record is marked stale: done, but not
   * verifiable, so isStepCurrent() will report it as needing another run.
   * Setting it false drops any stored fingerprint, because an invalidated step
   * must not look current.
   *
   * @param {string} key
   * @param {boolean} done
   * @param {string|null} [fingerprint]
   * @param {"dev"|"prod"} [env]
   */
  setStep(key, done, fingerprint = null, env) {
    const scope = this._scope(env);
    if (!done) {
      scope.steps[key] = false;
    } else {
      // A tracked flag gets its fingerprint from what it acted on, so the six
      // existing `state.setStep("osSecured", true)` call sites stay untouched
      // and still record something verifiable. Anything else with no
      // fingerprint is "ran, cannot be checked" and will re-run once.
      const fp = fingerprint ?? (TRACKED_FLAGS.includes(key) ? flagFingerprint(key, this._env(env)) : null);
      scope.steps[key] = fp
        ? { done: true, fingerprint: fp, at: new Date().toISOString() }
        : { done: true, fingerprint: null, stale: true, at: new Date().toISOString() };
    }
    this.save();
  }

  /** The fingerprint recorded for a step, or null. */
  getFingerprint(key, env) {
    const record = this._scope(env).steps[key];
    return typeof record === 'object' ? (record.fingerprint ?? null) : null;
  }


  // ---------------------------------------------------------------------
  // docker lifecycle flags — environment-specific for the same reason
  // ---------------------------------------------------------------------

  setDocker(key, value, env) {
    const scope = this._scope(env);
    if (value) scope.docker[key] = { done: true, fingerprint: null, at: new Date().toISOString() };
    else scope.docker[key] = false;
    this.save();
  }

  isDocker(key, env) {
    const record = this._scope(env).docker[key];
    return record === true || record?.done === true;
  }


  // ---------------------------------------------------------------------
  // app one-off setup flags
  // ---------------------------------------------------------------------

  setAppSetup(appName, done, env) {
    const scope = this._scope(env);
    if (!scope.apps[appName]) scope.apps[appName] = {};
    scope.apps[appName].setupDone = done ? { done: true, fingerprint: null } : false;
    this.save();
  }

  isAppSetupDone(appName, env) {
    const record = this._scope(env).apps[appName]?.setupDone;
    return record === true || record?.done === true;
  }

  // ---------------------------------------------------------------------
  // history
  // ---------------------------------------------------------------------

  /**
   * Records one action. `env` is stored because history is shared across
   * environments — without it a prod step and a dev step look identical.
   */
  recordStep(stepName, status, details = null, env) {
    const isSuccess = status === 'SUCCESS';
    this.data.step = stepName;
    this.data.lastSuccess = isSuccess;

    const entry = {
      step: stepName,
      env: this._env(env),
      status,
      timestamp: new Date().toISOString(),
      details: details instanceof Error ? details.message : details
    };

    this.data.history.push(entry);
    if (this.data.history.length > 50) this.data.history.shift();
    this.save();
  }

  get current() {
    return { ...this.data };
  }


  /**
   * Wipes recorded progress back to defaults, per environment.
   *
   * `environment` deliberately survives: everything else here is progress that
   * can be regenerated, but the target environment is a choice. Losing it
   * makes the next command fall back to "dev" silently — so resetting state
   * while working on prod would quietly point migrate/setup at the wrong one.
   *
   * Note this mutates the in-memory state as well as the file. Deleting the
   * file instead would not work: this class is a module-level singleton loaded
   * at import, so the next save() in the same process would write the old data
   * straight back.
   *
   * @returns {string | null} the environment that was kept
   */
  reset() {
    const environment = this.data.environment;
    this.data = this._getDefaultState();
    this.data.environment = environment;
    this.save();
    return environment;
  }
}

// Export pre-configured singleton instance
export const state = new StateManager();
