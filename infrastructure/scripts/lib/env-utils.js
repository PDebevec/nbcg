import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { __env } from './path.js';

// path.js is the authority on every path constant; re-exported here rather
// than redefined, since most of this file's callers already import it from
// this module and two independent `path.join(__root, '.env')` definitions is
// exactly the kind of thing that quietly drifts apart.
export { ROOT_ENV_PATH } from './path.js';
export const SHARED_ENV_PATH = path.join(__env, '.env.shared');


/**
 * Parse a standard .env file string into a Key-Value Map.
 * @param {string} filePath 
 * @returns {Record<string, string>}
 */
export function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    result[key] = val;
  }
  return result;
}

/**
 * Convert a Key-Value Map into .env formatted string.
 * @param {Record<string, string>} envMap 
 * @returns {string}
 */
export function formatEnvFile(envMap) {
  return Object.entries(envMap)
    .map(([key, val]) => `${key}=${val}`)
    .join('\n') + '\n';
}

const SECRET_CLASSES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  // Punctuation that is safe *inside a URL's userinfo component*, because
  // these secrets get interpolated straight into connection strings such as
  // DATABASE_URL. That rules out more than it looks like:
  //   @ : ends the userinfo    % : starts a percent-escape
  //   : ends the username      # ? : end the path
  //   $ : docker compose interpolates it when reading the .env
  //   + : some parsers decode it as a space
  // What is left is RFC 3986 unreserved plus the harmless sub-delims, all of
  // which also survive a .env file and a shell unquoted.
  '!*-.=_~',
];
const SECRET_ALPHABET = SECRET_CLASSES.join('');

/** Uniform random index without modulo bias. */
function randomIndex(bound) {
  const limit = Math.floor(256 / bound) * bound;
  let byte;
  do {
    byte = crypto.randomBytes(1)[0];
  } while (byte >= limit);
  return byte % bound;
}

/**
 * Generate a cryptographically strong random secret containing at least one
 * upper-case letter, lower-case letter, digit and special character.
 *
 * The guarantee matters: OpenSearch enforces a password policy and rejects
 * anything weaker, so a plain base64url secret — whose only non-alphanumerics
 * are `-` and `_`, and which often contains neither — made prod bring-up fail
 * intermittently, depending on the bytes drawn.
 *
 * Punctuation is restricted to characters that are safe unquoted in a .env
 * file, a shell, and a URL, so generated secrets can be interpolated into
 * connection strings without escaping.
 *
 * @param {number} length
 */
export function generateSecret(length = 32) {
  if (length < SECRET_CLASSES.length)
    throw new Error(`Secret length must be at least ${SECRET_CLASSES.length}`);

  // one guaranteed character per class, then fill, then shuffle so the
  // guaranteed ones aren't always in the same positions
  const chars = SECRET_CLASSES.map(set => set[randomIndex(set.length)]);
  while (chars.length < length) {
    chars.push(SECRET_ALPHABET[randomIndex(SECRET_ALPHABET.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  // The first character must be alphanumeric. Several images turn environment
  // variables into command-line flags — OpenSearch Dashboards passes
  // OPENSEARCH_PASSWORD through as --opensearch.password — and a value
  // starting with "-" is then read as the next flag rather than as the value,
  // failing with 'Extra serve options "--opensearch.password" must have a
  // value'. The swap keeps every character class and the full length.
  const alnum = /[A-Za-z0-9]/;
  if (!alnum.test(chars[0])) {
    const swap = chars.findIndex(c => alnum.test(c));
    [chars[0], chars[swap]] = [chars[swap], chars[0]];
  }

  return chars.join('');
}

/**
 * Interpolate `${VAR_NAME}` placeholders using a lookup map. Used for
 * master.config.json's env_routing templates.
 *
 * An unknown key is left in place rather than blanked, so a typo or a missing
 * variable shows up as a literal `${FOO}` in the generated .env instead of
 * silently becoming an empty value.
 * @param {string} template
 * @param {Record<string, string>} lookupMap
 */
export function interpolateString(template, lookupMap) {
  return String(template).replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, key) =>
    lookupMap[key] !== undefined ? lookupMap[key] : match
  );
}

/**
 * Renders a docker `.conf.json` template, substituting ONLY `$(VAR_NAME)`.
 *
 * `${VAR_NAME}` is deliberately left untouched: Keycloak realm exports are
 * full of Keycloak's own `${role_impersonation}` / `${authBaseUrl}` runtime
 * placeholders which must reach Keycloak verbatim. (The previous envsubst
 * based apply-env.sh blanked them, corrupting the realm import.)
 *
 * @param {string} template
 * @param {Record<string, string>} lookupMap
 * @returns {{ content: string, missing: string[] }}
 */
export function renderConfTemplate(template, lookupMap) {
  const missing = new Set();

  const content = String(template).replace(/\$\(([A-Za-z0-9_]+)\)/g, (_, key) => {
    if (lookupMap[key] === undefined) {
      missing.add(key);
      return '';
    }
    return lookupMap[key];
  });

  return { content, missing: [...missing] };
}