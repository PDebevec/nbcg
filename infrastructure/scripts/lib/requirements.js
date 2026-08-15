import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import dns from 'node:dns/promises';
import path from 'node:path';
import fsp from "node:fs/promises"
import { constants as fsConstants } from "node:fs"

const execFileAsync = promisify(execFile);

/**
 * Check if a binary exists and is executable without spawning subprocesses.
 * @param {string} binary Binary name (e.g., 'docker', 'git', 'make')
 */
export async function checkBinaryNative(binary) {
  // Split system PATH into array of directory paths
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    const fullPath = path.join(dir, binary);
    try {
      // Verify file exists AND is executable by current process
      await fsp.access(fullPath, fsConstants.X_OK);
      return { binary, installed: true, path: fullPath };
    } catch {
      // Continue to next directory if not found or not executable
    }
  }

  return { binary, installed: false, error: `Binary '${binary}' not found in PATH` };
}

/**
 * Specifically check Docker Compose v2 plugin availability ('docker compose version').
 */
export async function checkDockerCompose() {
  const { stdout } = await execFileAsync('docker', ['compose', 'version'], { timeout: 4000 });
  return { binary: 'docker compose', installed: true, version: stdout.trim().split('\n')[0] };
}

/**
 * Check if Docker engine daemon is running and accessible (checks socket permissions).
 */
export async function checkDockerDaemon() {
  await execFileAsync('docker', ['info'], { timeout: 5000 });
}

/**
 * Test if a specific host TCP port is available (unbound).
 * @param {number} port TCP port number
 * @param {string} host Host bind target (default '0.0.0.0')
 */
export function checkPort(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', (err) => {
      resolve({
        port,
        available: false,
        code: err.code,
        reason: err.code === 'EADDRINUSE' ? 'Port is already bound by another process' : err.message
      });
    });

    server.once('listening', () => {
      server.close(() => {
        resolve({ port, available: true });
      });
    });

    server.listen(port, host);
  });
}

/**
 * Test a port, treating one already published by this project's own
 * containers as fine rather than as a conflict — otherwise every check run
 * while the stack is up reports each published port as taken.
 * @param {number} port
 * @param {Set<number>} ownPorts host ports published by our own containers
 * @param {string} host
 */
export async function checkPortAvailability(port, ownPorts = new Set(), host = '0.0.0.0') {
  const result = await checkPort(port, host);
  if (result.available) return result;
  if (ownPorts.has(port))
    return { port, available: true, own: true, reason: 'in use by this project' };

  // Binding a privileged port (<1024) needs root, which this CLI is not — but
  // docker binds them as root and will succeed. EACCES therefore says nothing
  // about whether the port is free, so fall back to asking whether anything is
  // listening on it. Only prod hits this, and only for 80/443.
  if (result.code === 'EACCES') return checkNothingListening(port);

  return result;
}

/**
 * Whether a connection to the port is refused, i.e. nothing is listening.
 * Used where binding is not permitted; connecting needs no privilege.
 */
function checkNothingListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (available, reason) => {
      socket.destroy();
      resolve({ port, available, reason });
    };

    socket.setTimeout(1000);
    socket.once('connect', () => done(false, 'Port is already bound by another process'));
    socket.once('timeout', () => done(false, 'Timed out probing the port'));
    socket.once('error', (err) =>
      err.code === 'ECONNREFUSED'
        ? done(true, 'nothing listening (privileged port, not bindable by this user)')
        : done(false, err.message));

    socket.connect(port, host);
  });
}

/**
 * Test domain / FQDN DNS resolution.
 * @param {string} hostname Domain name to resolve
 */
export async function checkDns(hostname) {
  try {
    const res = await dns.lookup(hostname);
    return { hostname, resolved: true, address: res.address };
  } catch (err) {
    return { hostname, resolved: false, error: err.message };
  }
}
