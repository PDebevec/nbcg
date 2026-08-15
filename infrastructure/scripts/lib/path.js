import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
export const __lib = path.dirname(filename);
export const __infra = path.resolve(__lib, '../..');
export const __root = path.resolve(__infra, '..');
export const __frontend = path.resolve(__root, 'frontend');
export const __backend = path.resolve(__root, 'backend');
export const __env = path.resolve(__infra, 'env');
export const __docker = path.resolve(__infra, 'docker');

export const ROOT_ENV_PATH = path.join(__root, '.env');

/**
 * Resolves a config-supplied path: absolute paths are used as-is, relative
 * ones resolve against the repo root. Lets env_routing targets live outside
 * this repository.
 * @param {string} target
 */
export function resolveFromRoot(target) {
  return path.isAbsolute(target) ? target : path.resolve(__root, target);
}
