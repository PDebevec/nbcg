import { consoleLog } from "./lib/logger.js";
import { loadMasterConfig, findMissingKeys } from "./lib/config-utils.js";
import { getPublishedPorts } from "./lib/docker-utils.js";
import {
  checkBinaryNative, checkDns, checkDockerCompose, checkDockerDaemon, checkPortAvailability
} from "./lib/requirements.js";
import { UsageError } from "./lib/runner.js";

/**
 * Binaries the CLI itself shells out to.
 *
 * "docker compose" is deliberately absent — it is a subcommand, not a file on
 * PATH, and checkDockerCompose() covers it. `make` is absent too: nothing in
 * this CLI invokes it, it belongs to the legacy Makefile flow.
 */
export const BINARIES = {
  shared: ["node", "npm", "docker"],
  dev: ["pm2"],      // dev runs frontend/backend as pm2 processes on the host
  prod: ["openssl"], // the prod-only certs step shells out to openssl
};

/**
 * Builds the requirement set for an environment from master.config.json, so
 * what gets checked always tracks what the config will actually create:
 * hostnames become DNS checks, published ports become port checks.
 * @param {"dev"|"prod"} env
 */
export function requirementsFor(env = "dev") {
  const config = loadMasterConfig();

  // Dev publishes every service to the host, so every external port matters.
  // Prod publishes only what nginx listens on — everything else is reached
  // inside the compose network, so checking the rest would report twenty
  // irrelevant conflicts while missing the two that would actually stop the
  // stack from starting.
  //
  // Dev then drops the ports docker never binds there at all. The backend runs
  // as a pm2 host process, so nothing in the dev compose stack claims port
  // 3000 — there is no conflict to detect, but the port *is* occupied as soon
  // as the app is running, and reporting that as "already bound by another
  // process" made `make check` and the Setup menu fail on any dev machine that
  // had its backend up. Same reasoning as prod_published_ports, inverted: that
  // list narrows what prod checks, this one carves out what dev cannot check.
  const entries = Object.entries(config.ports || {});
  const excluded = config.dev_unpublished_ports?.names || [];
  const wanted = env === "prod"
    ? entries.filter(([name]) => (config.prod_published_ports?.names || []).includes(name))
    : entries.filter(([name]) => !excluded.includes(name));

  const ports = wanted
    .map(([, p]) => Number(p?.external))
    .filter(p => Number.isInteger(p) && p > 0);

  return {
    binary: [...BINARIES.shared, ...(BINARIES[env] || [])],
    dns: config.available_hostnames || [],
    ports: [...new Set(ports)].sort((a, b) => a - b),
  };
}

/**
 * Checks every requirement, reports each result, and throws if any failed.
 * Every underlying check *resolves* with a result object rather than throwing,
 * so results are inspected rather than relying on try/catch.
 *
 * @param {{binary?: string[], dns?: string[], ports?: number[]}} [require]
 *        defaults to requirementsFor(env)
 * @param {"dev"|"prod"} [env]
 * @returns {Promise<Record<string, string>>} fails, keyed by what failed
 */
export async function checkRequirements(require, env = "dev") {
  const spec = require ?? requirementsFor(env);
  const fails = {};

  const fail = (key, reason) => {
    fails[key] = reason;
    consoleLog("ERROR", `MISSING: ${key} — ${reason}`);
  };

  // master.config.json is only created when absent, so a config written by an
  // older version keeps its old values and any newly-shipped setting is
  // silently absent. Surface that rather than letting a step no-op.
  const missingKeys = findMissingKeys();
  if (missingKeys.length > 0) {
    fail(
      "master.config.json",
      `${missingKeys.length} setting(s) missing vs the template: ${missingKeys.join(", ")}. ` +
      `Run "make config A=merge" to add them (existing values are kept).`
    );
  } else {
    consoleLog("INFO", "SUCCESS: master.config.json matches the template");
  }

  for (const binary of spec.binary ?? []) {
    const res = await checkBinaryNative(binary);
    if (res.installed) consoleLog("INFO", `SUCCESS: ${binary} (${res.path})`);
    else fail(binary, res.error);
  }

  try {
    await checkDockerDaemon();
    consoleLog("INFO", "SUCCESS: docker daemon");
  } catch (error) {
    fail("docker daemon", error.message);
  }

  try {
    const { version } = await checkDockerCompose();
    consoleLog("INFO", `SUCCESS: ${version}`);
  } catch (error) {
    fail("docker compose", error.message);
  }

  for (const hostname of spec.dns ?? []) {
    const res = await checkDns(hostname);
    if (res.resolved) consoleLog("INFO", `SUCCESS: ${hostname} -> ${res.address}`);
    else fail(`dns ${hostname}`, res.error);
  }

  const ports = spec.ports ?? [];
  if (ports.length > 0) {
    // Ports our own containers already publish are not conflicts
    const ownPorts = await getPublishedPorts();
    for (const port of ports) {
      const res = await checkPortAvailability(port, ownPorts);
      if (res.own) consoleLog("INFO", `SUCCESS: port ${port} (in use by this project)`);
      else if (res.available) consoleLog("INFO", `SUCCESS: port ${port} is free`);
      else fail(`port ${port}`, res.reason);
    }
  }

  const failed = Object.keys(fails);
  // UsageError, not a bare Error: every individual failure has already been
  // reported cleanly above, so what is left is a summary line an operator needs
  // to read — not a crash. runAction and the dispatcher both print a
  // UsageError's message alone; anything else dumps a stack trace over the top
  // of it, which buries the useful part.
  if (failed.length > 0)
    throw new UsageError(`Unmet prerequisites: ${failed.join(", ")} — see the failures listed above`);

  return fails;
}
