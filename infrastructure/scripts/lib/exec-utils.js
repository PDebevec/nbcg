import { spawn } from 'node:child_process';

/**
 * Execute a system command with live terminal output (stdio: 'inherit' by default).
 * If stdout is piped via options, resolves with the collected stdout string.
 *
 * `options.interruptible` is for foreground commands the user is expected to
 * end with Ctrl+C (`docker compose logs -f`, `pm2 logs`). With inherited stdio
 * the SIGINT reaches the whole process group, so without this the CLI itself
 * dies. While the child runs, SIGINT is redirected into killing the child
 * (a second Ctrl+C escalates to SIGKILL, so this can never trap the user);
 * that exit is then treated as success rather than a command failure. The
 * handler is removed once the child is gone, restoring Node's default SIGINT
 * behaviour for the menus.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions & { interruptible?: boolean }} options
 * @returns {Promise<string|void>}
 */
export function runCommand(command, args = [], options = {}) {
  const { interruptible = false, onStdout, ...spawnOptions } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      ...spawnOptions,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        ...spawnOptions.env,
      },
    });

    let interruptCount = 0;
    const onSigint = () => {
      interruptCount += 1;
      proc.kill(interruptCount > 1 ? 'SIGKILL' : 'SIGINT');
    };
    if (interruptible) process.on('SIGINT', onSigint);
    const release = () => {
      if (interruptible) process.removeListener('SIGINT', onSigint);
    };

    let stdout = '';
    if (proc.stdout) {
      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        // `onStdout` lets a caller echo piped output live while still
        // receiving the full text to summarise afterwards.
        onStdout?.(text);
      });
    }

    proc.on('close', (code, signal) => {
      release();
      const interrupted = interruptCount > 0 || signal === 'SIGINT' || signal === 'SIGKILL' || code === 130;
      if (code === 0 || (interruptible && interrupted)) resolve(stdout);
      else reject(new Error(`Command '${command} ${args.join(' ')}' failed with exit code ${code}`));
    });

    proc.on('error', (err) => {
      release();
      reject(err);
    });
  });
}
