import pm2 from 'pm2';
import { spawn } from 'node:child_process';
import { __frontend, __backend } from './path.js';
import { runCommand } from './exec-utils.js';

const APP_DIRS = { frontend: __frontend, backend: __backend };

function connect() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
}

function disconnect() {
  pm2.disconnect();
}

/**
 * Runs one-off setup commands sequentially (e.g. npm install) for an app.
 * Not pm2-managed — these are one-shot scripts, not long-running processes.
 * @param {"frontend"|"backend"} appName
 * @param {Array<{command:string, args?:string[], options?:object}>} commands
 */
export async function runSetupCommands(appName, commands) {
  const cwd = APP_DIRS[appName];
  if (!cwd) throw new Error(`Unknown app: ${appName}`);

  for (const { command, args = [], options = {} } of commands) {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit', ...options });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      });
    });
  }
}

/** Checks whether a pm2 process with this name already exists. */
async function processExists(name) {
  return new Promise((resolve, reject) => {
    pm2.describe(name, (err, desc) => {
      if (err) return reject(err);
      resolve(desc && desc.length > 0);
    });
  });
}

/**
 * Starts an app under pm2 using its "run" config. No-ops if a process with
 * this name already exists, so re-selecting "Start" never creates duplicates.
 * @param {"frontend"|"backend"} appName
 * @param {{command:string, args?:string[], options?:object}} runConfig
 */
export async function startApp(appName, runConfig) {
  await connect();
  try {
    if (await processExists(appName)) {
      console.log(`pm2 process "${appName}" already exists, skipping start.`);
      return;
    }
    const cwd = APP_DIRS[appName];
    await new Promise((resolve, reject) => {
      pm2.start(
        {
          name: appName,
          script: runConfig.command,
          args: runConfig.args || [],
          interpreter: 'none', // command is a binary (npm), not a JS entrypoint
          cwd,
          ...runConfig.options
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
  } finally {
    disconnect();
  }
}

export async function stopApp(appName) {
  await connect();
  try {
    await new Promise((resolve, reject) => {
      pm2.stop(appName, (err) => (err ? reject(err) : resolve()));
    });
  } finally {
    disconnect();
  }
}

export async function restartApp(appName) {
  await connect();
  try {
    await new Promise((resolve, reject) => {
      pm2.restart(appName, (err) => (err ? reject(err) : resolve()));
    });
  } finally {
    disconnect();
  }
}

/** Stops and removes the pm2 process entirely (used by Clear Env). */
export async function deleteApp(appName) {
  await connect();
  try {
    await new Promise((resolve) => {
      pm2.delete(appName, () => resolve()); // ignore "not found" errors
    });
  } finally {
    disconnect();
  }
}

/** Lists pm2 process statuses, filtered to frontend/backend only. */
export async function listApps() {
  await connect();
  try {
    const list = await new Promise((resolve, reject) => {
      pm2.list((err, res) => (err ? reject(err) : resolve(res)));
    });
    return list.filter((p) => APP_DIRS[p.name] !== undefined);
  } finally {
    disconnect();
  }
}

/**
 * Streams live logs for an app via the pm2 CLI until the user hits Ctrl+C,
 * then returns control to the menu.
 *
 * Rejects if pm2 cannot be spawned or exits non-zero — the previous version
 * resolved on both `exit` and `error`, so a missing pm2 looked like a
 * successful (but empty) log view. Callers must handle the rejection.
 * @param {"frontend"|"backend"} appName
 */
export async function viewLogs(appName) {
  if (!APP_DIRS[appName]) throw new Error(`Unknown app: ${appName}`);
  return runCommand('pm2', ['logs', appName], { interruptible: true });
}