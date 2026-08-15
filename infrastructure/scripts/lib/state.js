import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { __infra } from './path.js';

// Default state file path anchored in the infrastructure directory
const DEFAULT_STATE_FILE = path.join(__infra, '.cli-state.json');

/**
 * StateManager handles persistent execution state, step history,
 * and diagnostic data for CLI workflows.
 */
// ...keep existing imports...

export class StateManager {
  constructor(stateFilePath = DEFAULT_STATE_FILE) {
    this.stateFilePath = stateFilePath;
    this.data = this._load();
  }

  _getDefaultState() {
    return {
      step: 'NOT_STARTED',
      lastSuccess: true,
      environment: null,
      updatedAt: null,
      systemInfo: {
        platform: os.platform(),
        hostname: os.hostname(),
        nodeVersion: process.version
      },
      // NEW: per-step completion flags, gates menu visibility in the CLI
      steps: {
        env: false,
        config: false,
        fbEnd: false,
        applyConf: false,
        certs: false,
        osSecurity: false,
        dockerFilesCopied: false,
        appImages: false,
        osSecured: false,
        migrate: false,
        health: false
      },
      // NEW: docker lifecycle flags
      docker: {
        initialized: false,   // docker files copied / first build done
        containarized: false  // containers currently up
      },
      apps: {
        frontend: { setupDone: false },
        backend: { setupDone: false }
      },
      history: []
    };
  }

  _load() {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        // deep-merge nested defaults so old state files gain new fields safely
        const defaults = this._getDefaultState();
        return {
          ...defaults,
          ...parsed,
          steps: { ...defaults.steps, ...(parsed.steps || {}) },
          docker: { ...defaults.docker, ...(parsed.docker || {}) },
          apps: {
            frontend: { ...defaults.apps.frontend, ...(parsed.apps?.frontend || {}) },
            backend: { ...defaults.apps.backend, ...(parsed.apps?.backend || {}) }
          },
          systemInfo: { ...defaults.systemInfo, ...(parsed.systemInfo || {}) }
        };
      } catch {
        return this._getDefaultState();
      }
    }
    return this._getDefaultState();
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.stateFilePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  setEnvironment(env) {
    this.data.environment = env;
    this.save();
  }

  /** Mark a setup/docker step complete or incomplete (used for menu gating) */
  setStep(name, done = true) {
    this.data.steps[name] = done;
    this.save();
  }

  /** Check whether a step is marked complete */
  isStepDone(name) {
    return !!this.data.steps[name];
  }

  /** Set a docker lifecycle flag ("initialized" | "containarized") */
  setDocker(key, value) {
    this.data.docker[key] = value;
    this.save();
  }

  /** Mark an app's one-off setup (npm install etc.) as done/not done */
  setAppSetup(appName, done = true) {
    this.data.apps[appName].setupDone = done;
    this.save();
  }

  isAppSetupDone(appName) {
    return !!this.data.apps[appName]?.setupDone;
  }

  recordStep(stepName, status, details = null) {
    const isSuccess = status === 'SUCCESS';
    this.data.step = stepName;
    this.data.lastSuccess = isSuccess;

    const entry = {
      step: stepName,
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
   * Wipes recorded progress back to defaults.
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