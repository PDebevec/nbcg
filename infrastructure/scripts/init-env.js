import { __env, __docker, __root, __infra, resolveFromRoot } from "./lib/path.js"
import fsp from "node:fs/promises"
import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import { loadMasterConfig } from "./lib/config-utils.js"
import { APP_USER, DASHBOARDS_USER } from "./lib/opensearch-utils.js"
import { consoleLog } from "./lib/logger.js"
import { formatEnvFile, generateSecret, interpolateString, renderConfTemplate, parseEnvFile, ROOT_ENV_PATH, SHARED_ENV_PATH } from "./lib/env-utils.js"

/**
 * Where generated production secrets live between runs.
 *
 * Deliberately not the root .env: that file belongs to whichever environment
 * ran last, so it cannot be the store for something that has to outlive a
 * switch to dev and back. Gitignored — these are the production credentials.
 */
export const SECRETS_PATH = path.join(__infra, ".secrets.prod.json")

function readStoredSecrets() {
  if (!fs.existsSync(SECRETS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, "utf8"))
  } catch {
    // A corrupt store must not silently become "generate everything new",
    // which would look like it worked and break every volume in the stack.
    throw new Error(
      `${SECRETS_PATH} is not valid JSON. Fix or delete it — deleting means new secrets, ` +
      `which existing volumes will reject.`
    )
  }
}

function writeStoredSecrets(secrets) {
  fs.writeFileSync(SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  fs.chmodSync(SECRETS_PATH, 0o600)
}

/**
 * "env" step. Composes the root .env from the shared defaults, the
 * environment-specific overrides and (in prod) generated secrets.
 *
 * Prod secrets are *reused* when the current root .env already holds them.
 * Regenerating them every run — which is what this did before — silently
 * destroys a working prod stack: the postgres, keycloak-db, opensearch and
 * pgadmin volumes keep the passwords they were initialised with, so the
 * services come back up unable to authenticate, with nothing pointing at the
 * cause. Pass { rotate: true } to deliberately generate a fresh set.
 *
 * @param {"dev" | "prod"} env
 * @param {{ rotate?: boolean }} [options]
 */
export async function initEnvironment(env = "dev", { rotate = false } = {}) {
  const sharedEnv = parseEnvFile(SHARED_ENV_PATH)
  const envEnv = parseEnvFile(path.join(__env, `.env.${env}`))
  const secrets = {}

  if (env === "prod") {
    const masterConfig = loadMasterConfig()

    // Kept in their own file rather than read back out of the root .env. The
    // root .env is rewritten by whichever environment ran last, so generating
    // a dev environment in between used to wipe every prod secret — and the
    // next prod run would mint new ones while the volumes still held the old,
    // breaking Postgres, Keycloak and OpenSearch auth all at once.
    const stored = rotate ? {} : readStoredSecrets()

    let reused = 0
    for (const key of masterConfig.secrets_to_generate) {
      if (stored[key]) { secrets[key] = stored[key]; reused += 1 }
      else secrets[key] = generateSecret()
    }

    writeStoredSecrets(secrets)

    const generated = masterConfig.secrets_to_generate.length - reused
    if (rotate)
      consoleLog("WARN", `--rotate: generated ${generated} new secrets. Existing volumes still hold the old ones — clear them or the services will fail to authenticate.`)
    else
      consoleLog("INFO", `Secrets: ${reused} reused, ${generated} generated (${SECRETS_PATH})`)
  }

  await fsp.writeFile(ROOT_ENV_PATH, formatEnvFile({ ENV:env, ...sharedEnv, ...envEnv, ...secrets }), { encoding:"utf-8" })
  consoleLog("INFO", `Wrote ${ROOT_ENV_PATH} for env "${env}"`)
}

/**
 * "dockerFilesCopied" step. Copies the base + env-specific docker-compose
 * files into the repo root, where compose picks up the root .env.
 * @param {"dev" | "prod"} env
 */
export async function initDocker(env = "dev") {
  await fsp.cp(path.join(__docker, "docker-compose.yml"), path.join(__root, "docker-compose.yml"))
  await fsp.cp(path.join(__docker, `docker-compose.${env}.yml`), path.join(__root, "docker-compose.ext.yml"))
  consoleLog("INFO", `Copied docker-compose.yml + docker-compose.${env}.yml into ${__root}`)
}

/**
 * "config" step. Writes per-env port variables, allowed hostnames and absolute
 * certificate paths into the root .env.
 *
 * Every port is emitted in three forms:
 *   X            environment-dependent: the host port in dev (where the apps
 *                run on the host), the container port in prod (where they run
 *                inside the network) — so app templates work unchanged in both
 *   X_INTERNAL   always the container port — use for in-network addresses
 *   X_EXTERNAL   always the host port — use for published/host addresses
 *
 * Emitting all three in both environments is what lets the shared
 * docker-compose.yml address other containers correctly: a reference like
 * KC_DB_URL must resolve to the container port regardless of environment, and
 * before this it silently picked up dev's host port.
 */
/** Emits X, X_INTERNAL and X_EXTERNAL for every master.config.json ports entry. */
function derivePortVars(masterConfig, env) {
  const portVars = {}
  for (const [name, { internal, external }] of Object.entries(masterConfig.ports || {})) {
    portVars[name] = env === "prod" ? internal : external
    portVars[`${name}_INTERNAL`] = internal
    portVars[`${name}_EXTERNAL`] = external
  }
  return portVars
}

/**
 * The canonical hostname and every hostname's browser-facing origin.
 *
 * The FIRST hostname is the canonical public host. Everything single-valued
 * (KEYCLOAK_URL) uses it; everything list-valued (CORS, redirect URIs) uses
 * all of them. Put the host you actually browse to first.
 *
 * Origins: where a browser reaches the frontend. In dev that is the Quasar
 * dev server on `frontendPort` over http; in prod nginx terminates TLS on
 * 443, so no port and https.
 */
function deriveOrigins(masterConfig, env, frontendPort) {
  const hostnames = masterConfig.available_hostnames || []
  if (hostnames.length === 0)
    throw new Error("master.config.json has no available_hostnames — nothing to derive origins from")

  const [canonicalHost] = hostnames

  // In prod the canonical hostname has to resolve to nginx from INSIDE the
  // compose network: the backend fetches Keycloak's JWKS over the same public
  // URL a browser uses, and reaches it through nginx's network alias. A
  // loopback name can never do that — every container resolves "localhost" to
  // itself via /etc/hosts, and no alias overrides that — so the backend would
  // fail to validate every token, with "fetch failed" as the only clue.
  if (env === "prod" && ["localhost", "127.0.0.1", "::1"].includes(canonicalHost))
    throw new Error(
      `available_hostnames starts with "${canonicalHost}", which cannot work in prod.\n` +
      `Containers resolve loopback names to themselves, so the backend could not reach Keycloak.\n` +
      `Put a real hostname first in master.config.json (a /etc/hosts entry on the host is enough for testing).`
    )

  const frontendOrigin = host => env === "prod" ? `https://${host}` : `http://${host}:${frontendPort}`
  const origins = hostnames.map(frontendOrigin)

  return { hostnames, canonicalHost, origins }
}

/**
 * The URL a browser uses to reach Keycloak. It is also the token issuer, so
 * the frontend and backend must agree on it — which is why both read this
 * one variable. In prod Keycloak is behind nginx, optionally under a path
 * such as /auth (KEYCLOAK_BASE_PATH); in dev it is published directly.
 */
function deriveKeycloakUrl(env, canonicalHost, portVars, pinned) {
  return env === "prod"
    ? `https://${canonicalHost}${pinned.KEYCLOAK_BASE_PATH || ""}`
    : `http://${canonicalHost}:${portVars.KEYCLOAK_PORT_EXTERNAL}`
}

/**
 * In prod the OpenSearch security plugin is on: TLS plus a real account. The
 * credentials ride in the URL because the client reads them from there
 * (BaseConnectionPool decodes url.username/url.password), which keeps the
 * backend free of any OpenSearch-specific configuration. Trust in the CA
 * comes from NODE_EXTRA_CA_CERTS, set on the container.
 */
function deriveOpensearchUrl(env, rootEnv, portVars) {
  const opensearchHost = `${rootEnv.OPENSEARCH_HOSTNAME}:${portVars.OPENSEARCH_NODE_P1}`
  return env === "prod"
    ? `https://${APP_USER}:${encodeURIComponent(rootEnv.OPENSEARCH_APP_PASSWORD || "")}@${opensearchHost}`
    : `http://${opensearchHost}`
}

/**
 * Basic-auth line for the provisional admin-UI routing in nginx.conf. {SHA}
 * is one of the forms nginx accepts and the only one Node can produce
 * unaided; it is unsalted, which is tolerable only because the password is
 * 32 random characters and the endpoint is behind TLS.
 */
function deriveAdminHtpasswd(rootEnv) {
  return rootEnv.ADMIN_UI_PASSWORD
    ? `admin:{SHA}${crypto.createHash("sha1").update(rootEnv.ADMIN_UI_PASSWORD).digest("base64")}`
    : ""
}

export async function applyMasterConfig(env = "dev") {
  const masterConfig = loadMasterConfig()
  const rootEnv = parseEnvFile(ROOT_ENV_PATH)

  // "Did you pin this by hand?" is answered from the SOURCE env files, not
  // from the root .env — the root .env already contains whatever this step
  // derived last time, so checking it there would make the first derived
  // value stick permanently and misreport itself as a manual override.
  const pinned = {
    ...parseEnvFile(SHARED_ENV_PATH),
    ...parseEnvFile(path.join(__env, `.env.${env}`)),
  }

  const portVars = derivePortVars(masterConfig, env)
  const { hostnames, canonicalHost, origins } = deriveOrigins(masterConfig, env, rootEnv.FRONTEND_PORT)
  const keycloakUrl = deriveKeycloakUrl(env, canonicalHost, portVars, pinned)
  const opensearchUrl = deriveOpensearchUrl(env, rootEnv, portVars)

  const merged = {
    ...rootEnv,
    ...portVars,
    OPENSEARCH_URL: opensearchUrl,

    // OpenSearch account names. Constants rather than settings, but they are
    // referenced from the compose file and from backend/.env, so they live in
    // the root .env like everything else those two read.
    OPENSEARCH_APP_USER: APP_USER,
    OPENSEARCH_DASHBOARDS_USER: DASHBOARDS_USER,

    ALLOWED_HOSTNAMES: hostnames.join(","),
    // nginx's server_name takes a space-separated list, not a comma one
    ALLOWED_HOSTNAMES_SPACED: hostnames.join(" "),
    // The one hostname single-valued things use. Also the network alias the
    // prod compose file gives nginx, which is what lets the backend reach the
    // public URL from inside the network — see docker-compose.prod.yml.
    PUBLIC_HOSTNAME: canonicalHost,

    // Derived, but overridable: a value already pinned in .env.<env> wins, so
    // an unusual deployment can still set these by hand.
    CORS_ORIGIN: pinned.CORS_ORIGIN || origins.join(","),
    KEYCLOAK_URL: pinned.KEYCLOAK_URL || keycloakUrl,

    // Consumed by the Keycloak realm template as complete JSON array literals,
    // so the realm's nbcg-web client accepts every hostname the rest of the
    // stack does. JSON.stringify guarantees valid escaping; the values contain
    // no newline and no "$", so they survive both the .env round-trip and
    // docker compose reading the same file.
    KEYCLOAK_WEB_ORIGINS: JSON.stringify(origins),
    KEYCLOAK_WEB_REDIRECT_URIS: JSON.stringify(origins.map(o => `${o}/*`)),
    // Same list again, but this one is a client *attribute* rather than a JSON
    // array, and Keycloak separates those with "##". Missing it is why logout
    // stayed pinned to localhost after the redirect URIs were already derived.
    KEYCLOAK_WEB_POST_LOGOUT_URIS: origins.map(o => `${o}/*`).join("##"),

    ADMIN_UI_HTPASSWD: deriveAdminHtpasswd(rootEnv),
  }

  await fsp.writeFile(ROOT_ENV_PATH, formatEnvFile(merged), { encoding: "utf-8" })
  consoleLog("INFO", `Merged ${Object.keys(portVars).length} port vars into ${ROOT_ENV_PATH}`)
  consoleLog("INFO", `Origins from available_hostnames (canonical: ${canonicalHost}): ${origins.join(", ")}`)
  consoleLog("INFO", `KEYCLOAK_URL = ${merged.KEYCLOAK_URL}${pinned.KEYCLOAK_URL ? ` (pinned by hand)` : ""}`)
  return masterConfig
}

/**
 * "fbEnd" step. Writes a .env for every target in master.config.json's
 * env_routing, substituting ${VAR} against the already-written root .env
 * (which by now has secrets + ports merged in).
 *
 * Each target declares its own `path`, resolved against the repo root when
 * relative and used as-is when absolute — so a target may live outside this
 * repository. A target whose directory does not exist is skipped with a
 * warning rather than failing the step, since an external app is not
 * necessarily checked out on every machine.
 */
export async function generateAppEnvs() {
  const masterConfig = loadMasterConfig()
  const rootEnv = parseEnvFile(ROOT_ENV_PATH)
  const routing = Object.entries(masterConfig.env_routing || {})

  if (routing.length === 0) throw new Error("master.config.json has no env_routing targets")

  const written = []
  for (const [target, definition] of routing) {
    const { path: targetPath, vars } = definition || {}
    if (!targetPath)
      throw new Error(`env_routing.${target} is missing a "path"`)

    const targetDir = resolveFromRoot(targetPath)
    if (!fs.existsSync(targetDir)) {
      consoleLog("WARN", `Skipping env_routing.${target}: directory does not exist: ${targetDir}`)
      continue
    }

    // A variable that resolves to nothing is omitted rather than written as
    // an empty value. Application defaults are usually written as
    // `process.env.X ?? fallback`, and `??` does not fall back on "" — so
    // emitting X= would silently defeat the app's own default instead of
    // leaving it in charge.
    const resolved = {}
    const omitted = []
    for (const [key, template] of Object.entries(vars || {})) {
      const value = interpolateString(template, rootEnv)
      if (value === "") omitted.push(key)
      else resolved[key] = value
    }

    if (omitted.length > 0)
      consoleLog("WARN", `${target}: no value for ${omitted.join(", ")} — omitted so the app's own default applies`)

    const outPath = path.join(targetDir, ".env")
    await fsp.writeFile(outPath, formatEnvFile(resolved), { encoding: "utf-8" })
    written.push(outPath)
    consoleLog("INFO", `Wrote ${outPath} (${Object.keys(resolved).length} vars)`)
  }

  if (written.length === 0)
    throw new Error("No env_routing target directories exist — nothing was generated")

  return written
}

/**
 * "applyConf" step. Renders every {template, output} pair in
 * master.config.json's conf_templates, substituting against the root .env.
 * These outputs are bind-mounted by docker-compose (pgadmin's server list,
 * the Keycloak realm import); without them Docker creates directories at
 * those mount points and the services come up misconfigured.
 */
export async function applyConfTemplates() {
  const masterConfig = loadMasterConfig()
  const rootEnv = parseEnvFile(ROOT_ENV_PATH)
  const templates = masterConfig.conf_templates || []

  if (templates.length === 0) {
    consoleLog("WARN", "master.config.json has no conf_templates — nothing to render")
    return []
  }

  const written = []
  for (const { template, output } of templates) {
    if (!template || !output)
      throw new Error(`conf_templates entry needs both "template" and "output": ${JSON.stringify({ template, output })}`)

    const templatePath = path.resolve(__infra, template)
    const outputPath = path.resolve(__infra, output)
    if (!fs.existsSync(templatePath))
      throw new Error(`conf template does not exist: ${templatePath}`)

    const raw = await fsp.readFile(templatePath, { encoding: "utf-8" })
    const { content, missing } = renderConfTemplate(raw, rootEnv)
    if (missing.length > 0)
      throw new Error(`${template}: no value in root .env for ${missing.map(k => `$(${k})`).join(", ")}`)

    // ADMIN_UI_HTPASSWD is only ever non-empty in prod (deriveAdminHtpasswd()
    // needs ADMIN_UI_PASSWORD, a generated-secrets-only value) — an empty
    // substitution passes renderConfTemplate's "missing" check since the key
    // does exist in rootEnv, just as "". In dev that silently writes a
    // credential-less htpasswd; harmless today (dev's compose defines no
    // nginx service to read it) but worth surfacing the same way
    // generateAppEnvs() already warns on an empty value elsewhere.
    if (template.includes("htpasswd") && rootEnv.ADMIN_UI_HTPASSWD === "")
      consoleLog("WARN", `${template}: ADMIN_UI_HTPASSWD is empty — wrote a credential-less htpasswd (expected outside prod)`)

    await fsp.mkdir(path.dirname(outputPath), { recursive: true })

    // Docker creates a *directory* at a bind-mount path whose source file is
    // missing, which is exactly what happens when this step has never run.
    // Writing over that would fail with EISDIR, so clear it first.
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
      consoleLog("WARN", `Replacing directory left by docker at ${outputPath}`)
      await fsp.rm(outputPath, { recursive: true, force: true })
    }

    await fsp.writeFile(outputPath, content, { encoding: "utf-8" })
    written.push(outputPath)
    consoleLog("INFO", `Rendered ${templatePath} -> ${outputPath}`)
  }

  return written
}

/** Absolute paths of everything applyConfTemplates() would write. */
export function confTemplateOutputs() {
  const masterConfig = loadMasterConfig()
  return (masterConfig.conf_templates || [])
    .filter(t => t?.output)
    .map(t => path.resolve(__infra, t.output))
}

/** Absolute paths of every .env that generateAppEnvs() would write. */
export function appEnvOutputs() {
  const masterConfig = loadMasterConfig()
  return Object.values(masterConfig.env_routing || {})
    .filter(d => d?.path)
    .map(d => path.join(resolveFromRoot(d.path), ".env"))
}

/** Returns { setup, run } for "frontend" or "backend" from master.config.json */
export function getAppConfig(appName) {
  const masterConfig = loadMasterConfig()
  const appConfig = masterConfig.apps?.[appName]
  if (!appConfig) throw new Error(`No apps.${appName} config found in master.config.json`)
  return appConfig
}

// runMigrations / runHealthChecks live in lib/db-utils.js — this module is
// about generating environment files, not operating the database.
