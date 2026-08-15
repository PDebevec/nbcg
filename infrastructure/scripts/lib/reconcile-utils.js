import fs from 'node:fs';
import { execInContainer, getContainerStates, upContainers, restartContainers } from './docker-utils.js';
import { waitForPostgresContainer } from './health-utils.js';
import { parseEnvFile, ROOT_ENV_PATH } from './env-utils.js';
import { configureSecurity } from './opensearch-utils.js';
import { consoleLog } from './logger.js';
import { UsageError } from './runner.js';

/**
 * `docker compose up`, self-healing stale prod credentials around it.
 *
 * Reconciling only *after* a successful `up` is not enough: a service whose
 * Postgres password is stale can make the whole `up` exit non-zero before
 * that point is ever reached. Postgres itself (db, keycloak-db) comes up
 * "healthy" regardless — its healthcheck is just `pg_isready`, which does
 * not check any particular password — but a service that depends on it
 * (keycloak) fails its own healthcheck trying to authenticate with the
 * *current* .env password against a database that still holds an older one,
 * and compose reports the whole `up` as failed.
 *
 * So this reconciles first against whatever is running regardless of
 * outcome, then retries once. reconcileProdCredentials() only ever touches
 * services that are actually up, so it is always safe to call after a
 * failed attempt.
 *
 * Reconciling alone is not quite enough, though: a container that already
 * exists and crash-looped on the old password is not restarted by `up` on
 * its own — nothing about *its own* image or config changed, only what it
 * connects to, which compose has no way to see. So anything left unhealthy
 * gets an explicit restart before the retry, to force a fresh connection
 * attempt with the credentials just fixed.
 *
 * Dev is untouched: it does not carry this class of bug (static,
 * non-rotating secrets; OpenSearch security disabled), so `up` there is the
 * plain compose call with no retry overhead.
 *
 * @param {string[]} services
 * @param {"dev"|"prod"} env
 */
export async function startStack(services, env) {
  if (env !== "prod") return upContainers(services);

  try {
    await upContainers(services);
    await reconcileProdCredentials();
    await restartUnhealthy();
    return;
  } catch (err) {
    // Nothing here is optional: reconcile whatever came up regardless of the
    // failure, restart whatever that leaves unhealthy, then retry once.
    consoleLog("WARN", "up failed — reconciling credentials with the current .env and retrying...");
  }

  await reconcileProdCredentials();
  await restartUnhealthy();
  await upContainers(services);
  await reconcileProdCredentials(); // e.g. opensearch-node only just became healthy
  await restartUnhealthy();
}

/**
 * Restarts anything currently unhealthy. Covers two distinct cases with one
 * mechanism: a service that crash-looped on a stale password before this ran
 * (keycloak), and — on a first-ever prod boot — pgsync/Dashboards, which
 * start before configureSecurity() has created their OpenSearch accounts and
 * so crash-loop regardless of any password ever being stale. Neither
 * self-clears; both need a fresh connection attempt now that the credentials
 * behind them are correct.
 */
async function restartUnhealthy() {
  const states = await getContainerStates().catch(() => []);
  const unhealthy = states.filter(s => s.health === 'unhealthy').map(s => s.service);
  if (unhealthy.length === 0) return;

  consoleLog("INFO", `restarting (unhealthy, likely on credentials predating this run): ${unhealthy.join(", ")}`);
  await restartContainers(unhealthy);
}

/**
 * Makes every already-initialised, credential-bearing prod service agree
 * with the *current* root .env — unconditionally, regardless of whether this
 * is a first boot, a restart, or a boot after prod secrets were regenerated.
 *
 * Two things never self-heal on their own when `.env` changes under an
 * already-provisioned volume/cluster:
 *
 *   - Postgres (db, keycloak-db) only applies POSTGRES_PASSWORD when it
 *     initialises an *empty* data directory (docker-compose.prod.yml has the
 *     same note for the dev/prod volume-collision case). A volume created
 *     under an older secret keeps that secret forever, silently, until
 *     something fails to authenticate.
 *   - OpenSearch's internal user database is set once by configureSecurity()
 *     and never revisited on its own; it does not watch `.env`.
 *
 * Both operations are idempotent — re-applying the password/config a service
 * already has is a safe no-op — so running this unconditionally on every
 * prod `up`, rather than only when something is known to be stale, is what
 * actually guarantees no misconfiguration, instead of relying on state
 * tracking to notice drift after the fact.
 *
 * Silently skips any service that is not currently running, so a scoped
 * `up SVC=frontend` never fails because db/keycloak-db/opensearch happen not
 * to be up.
 */
export async function reconcileProdCredentials() {
  const rootEnv = fs.existsSync(ROOT_ENV_PATH) ? parseEnvFile(ROOT_ENV_PATH) : {};
  const states = await getContainerStates().catch(() => []);
  const isUp = (service) => states.some(s => s.service === service && s.running);

  const postgresServices = [
    { service: 'db', userKey: 'POSTGRES_USER', dbKey: 'POSTGRES_DB', passKey: 'POSTGRES_PASSWORD' },
    { service: 'keycloak-db', userKey: 'KEYCLOAK_POSTGRES_USER', dbKey: 'KEYCLOAK_POSTGRES_DB', passKey: 'KEYCLOAK_POSTGRES_PASSWORD' },
  ];

  for (const { service, userKey, dbKey, passKey } of postgresServices) {
    if (!isUp(service)) continue;

    const user = rootEnv[userKey], db = rootEnv[dbKey], password = rootEnv[passKey];
    if (!user || !db || !password) continue; // env step never ran for prod yet

    await waitForPostgresContainer(service, user, db, 30000);
    await reconcilePostgresPassword(service, user, db, password);
    consoleLog('INFO', `${service}: password reconciled with the current .env`);
  }

  if (isUp('opensearch-node')) await configureSecurity();
  if (isUp('keycloak')) await reconcileKeycloakClient(rootEnv);
}

const KEYCLOAK_REALM = 'nbcg';
const KEYCLOAK_WEB_CLIENT_ID = 'nbcg-web';
// Keycloak's own image ships neither curl nor wget (confirmed live: `docker
// exec` into it fails to find either — matches docker-compose.prod.yml's own
// healthcheck comment, which falls back to bash's /dev/tcp for exactly this
// reason). opensearch-node is confirmed to have real curl (configureSecurity()
// already depends on it) and, unlike keycloak/backend/frontend, starts
// independently of everything this exists to fix — so it stays reachable even
// while keycloak itself is unhealthy. It's just the HTTP vehicle; nothing here
// is OpenSearch-specific.
const HTTP_VEHICLE = 'opensearch-node';

async function keycloakCurl(script, env = {}) {
  return execInContainer(HTTP_VEHICLE, ['sh', '-c', script], {
    stdio: ['inherit', 'pipe', 'inherit'],
    env,
  });
}

/**
 * Keeps the `nbcg-web` client's redirectUris/webOrigins in sync with the
 * current root .env.
 *
 * The actual fix for the realm-import staleness this project's own README
 * already documents but never wires up: Keycloak's `--import-realm` skips a
 * realm that already exists (confirmed live — `Strategy: IGNORE_EXISTING`),
 * so a changed hostname never reaches an already-provisioned deployment on
 * its own. The README's suggested remedy, `KC_IMPORT_STRATEGY=OVERWRITE_EXISTING`,
 * turns out to not apply to `--import-realm` at all (that override belongs to
 * a separate, offline `kc.sh import` command) — and confirmed via Keycloak's
 * own docs, actually overwriting a realm wipes real user credentials and MFA
 * state along with the client config it was meant to refresh.
 *
 * This does the narrow thing instead: authenticate as the realm admin, fetch
 * the client's *current* full representation, mutate only redirectUris and
 * webOrigins, PUT the whole thing back. Every other client setting (secret,
 * protocol mappers, everything) is preserved untouched, and nothing in this
 * code path can reach a user, session or credential — only
 * /admin/realms/{realm}/clients/{id}, never /admin/realms/{realm}/users.
 *
 * JSON is parsed and rebuilt in JS, not shell — curl only ever moves bytes,
 * the same division of labour as everywhere else credentials get handled in
 * this file.
 */
async function reconcileKeycloakClient(rootEnv) {
  const adminUser = rootEnv.KEYCLOAK_ADMIN;
  const adminPassword = rootEnv.KEYCLOAK_ADMIN_PASSWORD;
  const keycloakUrl = rootEnv.KEYCLOAK_URL;
  if (!adminUser || !adminPassword || !keycloakUrl) return; // env step never ran for prod yet

  const basePath = new URL(keycloakUrl).pathname.replace(/\/$/, '');
  const base = `http://keycloak:${rootEnv.KEYCLOAK_PORT_INTERNAL}${basePath}`;

  const desiredRedirects = JSON.parse(rootEnv.KEYCLOAK_WEB_REDIRECT_URIS || '[]');
  const desiredOrigins = JSON.parse(rootEnv.KEYCLOAK_WEB_ORIGINS || '[]');

  const tokenOut = await keycloakCurl(
    `curl -s -X POST "${base}/realms/master/protocol/openid-connect/token" ` +
    `-d grant_type=password -d client_id=admin-cli ` +
    `--data-urlencode "username=$KC_ADMIN_USER" --data-urlencode "password=$KC_ADMIN_PASS"`,
    { KC_ADMIN_USER: adminUser, KC_ADMIN_PASS: adminPassword },
  );

  let token;
  try { token = JSON.parse(tokenOut).access_token; } catch { /* falls through to the throw below */ }
  if (!token) {
    throw new UsageError(
      `Could not authenticate to Keycloak's admin API as "${adminUser}". ` +
      `If KEYCLOAK_ADMIN_PASSWORD was regenerated after Keycloak's master realm ` +
      `admin was already created, this cannot self-heal — Keycloak only ever applies ` +
      `KC_BOOTSTRAP_ADMIN_PASSWORD once, on first boot. Reset it manually (kcadm.sh, ` +
      `or clear the keycloak-data volume for a fresh bootstrap).`
    );
  }

  const clientsOut = await keycloakCurl(
    `curl -s "${base}/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${KEYCLOAK_WEB_CLIENT_ID}" ` +
    `-H "Authorization: Bearer $KC_TOKEN"`,
    { KC_TOKEN: token },
  );

  let client;
  try { client = JSON.parse(clientsOut)[0]; } catch { /* client stays undefined */ }
  if (!client) {
    throw new Error(`Keycloak admin API: client "${KEYCLOAK_WEB_CLIENT_ID}" not found in realm "${KEYCLOAK_REALM}"`);
  }

  const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(v => b.includes(v));
  if (sameSet(client.redirectUris, desiredRedirects) && sameSet(client.webOrigins, desiredOrigins)) {
    return; // already current
  }

  const updated = { ...client, redirectUris: desiredRedirects, webOrigins: desiredOrigins };
  const clientB64 = Buffer.from(JSON.stringify(updated), 'utf8').toString('base64');

  const putStatus = (await keycloakCurl(
    `echo "$KC_CLIENT_B64" | base64 -d > /tmp/nbcg-web-client.json && ` +
    `curl -s -o /dev/null -w '%{http_code}' -X PUT "${base}/admin/realms/${KEYCLOAK_REALM}/clients/${client.id}" ` +
    `-H "Authorization: Bearer $KC_TOKEN" -H 'Content-Type: application/json' ` +
    `--data-binary @/tmp/nbcg-web-client.json; rm -f /tmp/nbcg-web-client.json`,
    { KC_TOKEN: token, KC_CLIENT_B64: clientB64 },
  )).trim();

  if (!putStatus.startsWith('2')) {
    throw new Error(`Keycloak admin API: updating client "${KEYCLOAK_WEB_CLIENT_ID}" failed (HTTP ${putStatus})`);
  }

  consoleLog('INFO', `keycloak: "${KEYCLOAK_WEB_CLIENT_ID}" redirectUris/webOrigins synced with the current .env`);
}

/**
 * Sets `user`'s password to `password` via the container's local trust-auth
 * socket (no password needed to connect), so this works whether the
 * container's current password matches `.env` or not — which is the whole
 * point: it never needs to know the old value.
 *
 * The password reaches psql only through the container's own environment,
 * read back with `\getenv` and bound with psql's `:'var'` quoting — never
 * interpolated into the shell command or SQL text — so no password
 * character (quotes included) can break the command or leak into argv.
 *
 * `\getenv` and the ALTER have to run as one piped-in script, not as two
 * separate `-c` flags: each `-c` is its own psql invocation, so a variable
 * set by one is gone before the next runs. Piping avoids that, and — as in
 * configureSecurity()'s script — base64 keeps the SQL out of shell quoting
 * entirely.
 */
async function reconcilePostgresPassword(service, user, db, password) {
  const sql = `\\getenv pass PGPASSWORD_NEW\nALTER USER "${user}" WITH PASSWORD :'pass';\n`;
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  const script = `echo '${b64}' | base64 -d | psql -U ${user} -d ${db} -v ON_ERROR_STOP=1`;

  await execInContainer(service, ['sh', '-c', script], {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { PGPASSWORD_NEW: password },
  });
}
