import fs from 'node:fs';
import path from 'node:path';
import { __infra } from './path.js';

const MASTER_CONFIG_PATH = path.join(__infra, 'master.config.json');
const MASTER_TEMPLATE_PATH = path.join(__infra, 'master.config.template.json');

/**
 * Ensures master.config.json exists. If missing, copies master.config.template.json.
 */
export function ensureMasterConfig() {
  if (!fs.existsSync(MASTER_CONFIG_PATH)) {
    if (!fs.existsSync(MASTER_TEMPLATE_PATH)) {
      throw new Error(`Master template missing at: ${MASTER_TEMPLATE_PATH}`);
    }
    fs.copyFileSync(MASTER_TEMPLATE_PATH, MASTER_CONFIG_PATH);
  }
}

/**
 * Read and return the master configuration object.
 * Auto-creates from template on first read if missing.
 */
export function loadMasterConfig() {
  ensureMasterConfig();
  try {
    const raw = fs.readFileSync(MASTER_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse master.config.json: ${err.message}`);
  }
}

/** Reads the shipped template, which is the source of truth for structure. */
export function loadMasterTemplate() {
  if (!fs.existsSync(MASTER_TEMPLATE_PATH))
    throw new Error(`Master template missing at: ${MASTER_TEMPLATE_PATH}`);
  return JSON.parse(fs.readFileSync(MASTER_TEMPLATE_PATH, 'utf8'));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Template array entries the live config lacks.
 *
 * Several settings are lists rather than objects — `secrets_to_generate`,
 * `conf_templates`. Recursing only into objects meant a template that gained a
 * secret or a rendered file was reported as "matching", so the setting
 * silently never reached an existing checkout. Elements are compared by their
 * JSON, which handles both the string lists and the {template, output} object
 * lists.
 *
 * @returns {string[]} the missing entries, as JSON
 */
function missingArrayEntries(live, template) {
  const present = new Set(live.map(v => JSON.stringify(v)));
  return template.map(v => JSON.stringify(v)).filter(v => !present.has(v));
}

/**
 * Dotted paths whose array *contents* are the user's own deployment data
 * rather than a CLI-shipped feature list, so a template entry missing from
 * the live value is an intentional edit, not drift.
 *
 * `available_hostnames` is the only one today: the template ships
 * "localhost"/"127.0.0.1" as illustrative starting values, and removing them
 * for a real deployment (README: "Put the host you actually browse to
 * first") is correct, expected editing — not something `make check` should
 * ever block Setup over. The key's mere *presence* is still checked above;
 * only its element-by-element diff is skipped.
 */
const ARRAY_CONTENTS_EXEMPT = new Set(['available_hostnames']);

/**
 * Keys the template defines that the live config lacks, as dotted paths.
 *
 * master.config.json is only created when absent, so a checkout whose config
 * predates a template change keeps running with the old values — silently,
 * because nothing reads what is not there. This makes that drift visible.
 *
 * @param {object} [live]
 * @param {object} [template]
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function findMissingKeys(live = loadMasterConfig(), template = loadMasterTemplate(), prefix = '') {
  const missing = [];

  for (const [key, templateValue] of Object.entries(template)) {
    const dotted = prefix ? `${prefix}.${key}` : key;

    if (!(key in live)) {
      missing.push(dotted);
      continue;
    }
    if (isPlainObject(templateValue) && isPlainObject(live[key])) {
      missing.push(...findMissingKeys(live[key], templateValue, dotted));
      continue;
    }
    if (Array.isArray(templateValue) && Array.isArray(live[key]) && !ARRAY_CONTENTS_EXEMPT.has(dotted)) {
      for (const entry of missingArrayEntries(live[key], templateValue))
        missing.push(`${dotted}[] ${entry}`);
    }
  }

  return missing;
}

/**
 * Keys the live config has that the template does not, as dotted paths.
 *
 * These are either your own additions (fine) or leftovers from a setting the
 * template has since dropped — a merge never removes anything, so they are
 * reported rather than deleted.
 *
 * @param {object} [live]
 * @param {object} [template]
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function findExtraKeys(live = loadMasterConfig(), template = loadMasterTemplate(), prefix = '') {
  const extra = [];

  for (const [key, liveValue] of Object.entries(live)) {
    const dotted = prefix ? `${prefix}.${key}` : key;

    if (!(key in template)) {
      extra.push(dotted);
      continue;
    }
    if (isPlainObject(liveValue) && isPlainObject(template[key])) {
      extra.push(...findExtraKeys(liveValue, template[key], dotted));
    }
  }

  return extra;
}

/**
 * Fills in keys the live config is missing from the template, leaving every
 * existing value untouched, and writes the result back.
 * @returns {{ added: string[], path: string }}
 */
export function mergeTemplateDefaults() {
  const template = loadMasterTemplate();
  const live = loadMasterConfig();
  const added = findMissingKeys(live, template);

  const merge = (target, source) => {
    for (const [key, value] of Object.entries(source)) {
      if (!(key in target)) target[key] = value;
      else if (isPlainObject(value) && isPlainObject(target[key])) merge(target[key], value);
      else if (Array.isArray(value) && Array.isArray(target[key])) {
        // Append only. An entry you removed on purpose comes back, which is
        // the same trade the object merge already makes: never delete, and
        // report anything unexpected through findExtraKeys instead.
        const present = new Set(target[key].map(v => JSON.stringify(v)));
        for (const entry of value)
          if (!present.has(JSON.stringify(entry))) target[key].push(entry);
      }
    }
    return target;
  };

  if (added.length > 0) {
    fs.writeFileSync(MASTER_CONFIG_PATH, `${JSON.stringify(merge(live, template), null, 2)}\n`, 'utf8');
  }

  return { added, path: MASTER_CONFIG_PATH };
}

/**
 * Whether the live config is byte-for-byte the template's content.
 *
 * Key order is significant to this comparison and that is fine: the live file
 * starts life as a copy of the template, and mergeTemplateDefaults() appends
 * rather than reorders, so a difference in order only ever means the file was
 * edited by hand — which is exactly what this reports.
 */
export function configMatchesTemplate() {
  if (!fs.existsSync(MASTER_CONFIG_PATH)) return false;
  try {
    return JSON.stringify(loadMasterConfig()) === JSON.stringify(loadMasterTemplate());
  } catch {
    return false; // unparseable counts as "differs" — resetting is the fix
  }
}

/**
 * Discards master.config.json and recreates it from the template.
 *
 * "Reset" rather than "remove": ensureMasterConfig() recreates the file on the
 * next read anyway, so leaving it absent is not a state this CLI can be in.
 * Saying so up front stops the clear menu from claiming a removal that
 * immediately undoes itself.
 *
 * @returns {{ message: string, noop?: boolean }}
 */
export function resetMasterConfig() {
  if (configMatchesTemplate())
    return { message: 'master.config.json already matches the template', noop: true };

  if (fs.existsSync(MASTER_CONFIG_PATH)) fs.rmSync(MASTER_CONFIG_PATH);
  ensureMasterConfig();
  console.log(`  reset ${MASTER_CONFIG_PATH}`);
  return { message: 'master.config.json reset to template defaults' };
}

/**
 * Safely access a nested property using dot notation (e.g. 'ports.dev.keycloak')
 * @param {string} pathKey
 * @param {any} [defaultValue=undefined]
 */
export function getConfigValue(pathKey, defaultValue = undefined) {
  const config = loadMasterConfig();
  const keys = pathKey.split('.');
  let current = config;

  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      return defaultValue;
    }
  }

  return current;
}