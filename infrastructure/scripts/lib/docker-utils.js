import { runCommand } from './exec-utils.js';
import { __root } from './path.js';
import { UsageError } from './runner.js';

const defaultConfig = ["docker-compose.yml", "docker-compose.ext.yml"];

/**
 * Internal helper to run `docker compose` with default configs and cwd
 * @param {string[]} args Arguments passed to `docker compose`
 * @param {object} [options]
 */
function compose(args, options = {}) {
  const cwd = options.cwd || __root;
  const config = options.config || defaultConfig;
  const configFlags = config.flatMap(file => ['-f', file]);

  return runCommand('docker', ['compose', ...configFlags, ...args], {
    cwd,
    ...options,
  });
}

/**
 * Start containers (docker compose up)
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function upContainers(containers = [], options = {}) {
  return compose(['up', ...containers, "-d"], options);
}

/**
 * Stop containers without removing them (docker compose stop)
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function stopContainers(containers = [], options = {}) {
  return compose(['stop', ...containers], options);
}

/**
 * Restart containers (docker compose restart)
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function restartContainers(containers = [], options = {}) {
  return compose(['restart', ...containers], options);
}

/**
 * Follow container logs (docker compose logs -f) until the user hits Ctrl+C,
 * which ends the log stream rather than the CLI.
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function getContainerLogs(containers = [], options = {}) {
  return compose(['logs', ...containers, "-f"], { interruptible: true, ...options });
}

/**
 * Execute a command inside a running container (docker compose exec).
 *
 * Defaults to `-T` (no TTY allocation): every programmatic caller here either
 * captures output or only cares about the exit code, and TTY allocation fails
 * outright when stdio is not a terminal. Pass `{ tty: true }` for an
 * interactive shell.
 *
 * `options.env` is forwarded into the container with `-e NAME`, taking the
 * value from this process's environment. That is how a secret reaches the
 * command without ever appearing in argv, and so without appearing in the
 * container's process list.
 *
 * @param {string} container Container/service name
 * @param {string|string[]} command Command to execute inside container
 * @param {object} [options]
 */
export async function execInContainer(container, command, options = {}) {
  const { tty = false, env, ...rest } = options;
  const cmdArgs = Array.isArray(command) ? command : command.split(' ');
  const envFlags = Object.keys(env || {}).flatMap(name => ['-e', name]);

  return compose(['exec', ...(tty ? [] : ['-T']), ...envFlags, container, ...cmdArgs], {
    ...rest,
    ...(env ? { env: { ...process.env, ...env, ...rest.env } } : {}),
  });
}

/**
 * Get defined service names from compose configuration
 * @param {object} [options]
 */
export async function getDefinedServices(options = {}) {
  const output = await compose(['config', '--services'], {
    ...options,
    stdio: ['inherit', 'pipe', 'inherit'], // Pipes stdout so runCommand captures service list
  });
  return output ? output.trim().split('\n').map(s => s.trim()).filter(Boolean) : [];
}

/**
 * Get container statuses (docker compose ps)
 * @param {object} [options]
 */
export async function getContainerStatuses(options = {}) {
  return compose(['ps', '-a'], options);
}

/**
 * Machine-readable per-service container state, used to gate menu entries and
 * to report health. Compose has emitted `ps --format json` as both a JSON
 * array and as newline-delimited objects depending on version, so both are
 * accepted.
 *
 * `health` is empty for services that declare no healthcheck — that is
 * "unknown", not "unhealthy", and is reported separately.
 *
 * @param {object} [options]
 * @returns {Promise<Array<{ service: string, name: string, state: string, health: string, running: boolean }>>}
 */
export async function getContainerStates(options = {}) {
  const raw = await compose(['ps', '-a', '--format', 'json'], {
    ...options,
    stdio: ['inherit', 'pipe', 'pipe'], // capture stdout; keep stderr off the screen
  });

  const text = (raw || '').trim();
  if (!text) return [];

  let rows;
  try {
    rows = JSON.parse(text);
    if (!Array.isArray(rows)) rows = [rows];
  } catch {
    rows = text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  }

  return rows.map(r => {
    const state = r.State ?? r.state ?? '';
    return {
      service: r.Service ?? r.service ?? r.Name ?? '',
      name: r.Name ?? r.name ?? '',
      state,
      health: r.Health ?? r.health ?? '',
      running: String(state).toLowerCase() === 'running',
      publishers: r.Publishers ?? r.publishers ?? [],
    };
  });
}

/**
 * Throws a clear error unless `service` exists and is running; otherwise
 * returns its getContainerStates() entry.
 *
 * Extracted after the same three-step check — find the service, throw if
 * absent, throw if not running, near-identical wording — turned up
 * independently in db-utils.js (twice) and opensearch-utils.js.
 *
 * @param {string} service compose service name
 * @param {string} [hint] appended to both error messages after the state
 *        description, e.g. "Start it first (make up SVC=db)."
 */
export async function requireRunningService(service, hint = `Start it first (make up SVC=${service}).`) {
  const found = (await getContainerStates().catch(() => [])).find(c => c.service === service);
  if (!found)
    throw new UsageError(`The "${service}" container does not exist. ${hint}`);
  if (!found.running)
    throw new UsageError(`The "${service}" container is ${found.state || 'not running'}. ${hint}`);
  return found;
}

/**
 * Host ports currently published by this project's containers.
 *
 * Used to tell a genuine port conflict from our own stack already running:
 * without it, every requirement check performed while the stack is up would
 * report each published port as taken.
 *
 * Resolves to an empty set when compose cannot be queried (no compose files,
 * no .env) — callers treat "unknown" as "not ours".
 * @returns {Promise<Set<number>>}
 */
export async function getPublishedPorts(options = {}) {
  let states;
  try {
    states = await getContainerStates(options);
  } catch {
    return new Set();
  }

  const ports = new Set();
  for (const s of states) {
    for (const p of s.publishers) {
      const port = Number(p.PublishedPort ?? p.publishedPort);
      if (Number.isInteger(port) && port > 0) ports.add(port);
    }
  }
  return ports;
}

/**
 * Counts for the Docker menu status line.
 * @param {Array<{running: boolean, health: string}>} states
 */
export function summariseStates(states) {
  const running = states.filter(s => s.running).length;
  const healthy = states.filter(s => s.health === 'healthy').length;
  const unhealthy = states.filter(s => s.health === 'unhealthy').length;
  const starting = states.filter(s => s.health === 'starting').length;
  return { total: states.length, running, stopped: states.length - running, healthy, unhealthy, starting };
}

/**
 * Remove containers/networks (docker compose down), optionally with volumes
 * @param {boolean} [removeVolumes=false]
 * @param {object} [options]
 */
export async function downContainers(removeVolumes = false, options = {}) {
  const args = ['down', ...(removeVolumes ? ['-v'] : [])];
  return compose(args, options);
}

/**
 * Build service images (docker compose build)
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function buildContainers(containers = [], options = {}) {
  return compose(['build', ...containers], options);
}

/**
 * Pull service images (docker compose pull)
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function pullContainers(containers = [], options = {}) {
  return compose(['pull', ...containers], options);
}

/**
 * Create containers without starting them (docker compose up --no-start)
 * @param {string[]} [containers=[]]
 * @param {object} [options]
 */
export async function createContainers(containers = [], options = {}) {
  return compose(['up', '--no-start', ...containers], options);
}