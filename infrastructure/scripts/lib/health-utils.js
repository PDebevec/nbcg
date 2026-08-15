import { execInContainer } from './docker-utils.js';

/**
 * Wait for PostgreSQL inside a Docker container using pg_isready.
 *
 * Readiness is taken from pg_isready's *exit code* (0 = accepting
 * connections), not from its stdout: runCommand resolves with a string and
 * captures nothing under inherited stdio, so the previous `result.out` check
 * could never be true and this function always timed out.
 *
 * @param {string} containerName compose service name
 * @param {string} user
 * @param {string} db
 * @param {number} timeoutMs
 * @param {(waitedMs: number) => void} [onWait] progress callback between attempts
 */
export async function waitForPostgresContainer(containerName, user, db, timeoutMs = 60000, onWait) {
  const startTime = Date.now();
  let lastError;

  while (Date.now() - startTime < timeoutMs) {
    try {
      await execInContainer(containerName, ['pg_isready', '-U', user, '-d', db], {
        stdio: ['inherit', 'pipe', 'pipe'], // silence pg_isready's chatter while polling
      });
      return true;
    } catch (error) {
      lastError = error; // not ready yet, or the container isn't up
    }
    onWait?.(Date.now() - startTime);
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for PostgreSQL in '${containerName}'` +
    (lastError ? ` (last attempt: ${lastError.message})` : '')
  );
}