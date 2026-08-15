import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __docker } from './path.js';
import { runCommand } from './exec-utils.js';
import { loadMasterConfig } from './config-utils.js';
import { consoleLog } from './logger.js';
import { UsageError } from './runner.js';

/**
 * Certificates for the production stack, issued by a private CA.
 *
 * Everything hangs off one trust root so that a single file — ca.crt — can be
 * handed to the containers that must verify the others. That is what lets the
 * backend reach Keycloak over the same public HTTPS URL a browser uses, which
 * is the only arrangement where the token issuer and the JWKS endpoint agree.
 *
 * The leaves carry subject alternative names. The previous certificates had a
 * CN and nothing else; every current TLS client ignores CN entirely, so they
 * would have been rejected no matter what else was configured.
 *
 * Replacing the nginx leaf with a certificate from a real authority means
 * dropping their fullchain/privkey into the nginx directory (see
 * `certificates.nginx_external` below) — the topology does not change,
 * because a real certificate verifies the same way this one does.
 *
 * NODE_EXTRA_CA_CERTS stays set on the backend regardless: OpenSearch's node
 * and admin certificates are always issued by this CA, independent of
 * whatever nginx's own leaf is. Unsetting it would not affect nginx trust at
 * all — it would only break the backend's TLS connection to OpenSearch.
 */

const CERT_ROOT = path.join(__docker, 'certs');

export const CA_DIR = path.join(CERT_ROOT, 'ca');
export const CA_CERT = path.join(CA_DIR, 'ca.crt');
export const CA_KEY = path.join(CA_DIR, 'ca.key');

const NGINX_DIR = path.join(CERT_ROOT, 'nginx');
const OPENSEARCH_DIR = path.join(CERT_ROOT, 'opensearch');

/** Directories holding generated certificates, for cleanup. */
export function certDirectories() {
  return [CA_DIR, NGINX_DIR, OPENSEARCH_DIR];
}

/**
 * The leaf certificates the compose files mount, and the names each must be
 * valid for. nginx's list comes from master.config.json, so adding a hostname
 * there is all it takes for the certificate to cover it.
 *
 * `client` marks a certificate used to authenticate TO a server rather than to
 * identify one — OpenSearch's securityadmin tool needs one of those.
 */
function leafSpecs() {
  const hostnames = loadMasterConfig().available_hostnames || [];
  const external = loadMasterConfig().certificates?.nginx_external === true;

  return [
    // Omitted entirely when a real certificate is externally managed — see
    // requireExternalNginxCert() below. Excluding it here (rather than
    // issuing-then-skipping) is what makes the stamp comparison in
    // leavesAreCurrent() correctly detect the flag being toggled back off:
    // the spec list itself changes, so the stamp no longer matches.
    ...(external ? [] : [{
      name: 'nginx',
      dir: NGINX_DIR,
      base: 'server',
      cn: hostnames[0] || 'localhost',
      // localhost is always included so a probe from inside the container works
      altNames: [...new Set([...hostnames, 'localhost', 'nginx'])],
    }]),
    {
      name: 'opensearch-node',
      dir: OPENSEARCH_DIR,
      base: 'node',
      cn: OPENSEARCH_NODE_CN,
      altNames: [OPENSEARCH_NODE_CN, 'localhost'],
    },
    {
      name: 'opensearch-admin',
      dir: OPENSEARCH_DIR,
      base: 'admin',
      cn: OPENSEARCH_ADMIN_CN,
      altNames: [],
      client: true,
    },
  ];
}

/** Certificate subject fields, from master.config.json's `certificates` block. */
function subjectFields() {
  const { subject } = loadMasterConfig().certificates || {};
  return { C: 'ME', ST: 'State', L: 'City', O: 'NBCG', OU: 'IT', ...(subject || {}) };
}

/** openssl `-subj` form: /C=…/ST=…/…/CN=<cn> */
function subject(cn) {
  const f = subjectFields();
  return `/C=${f.C}/ST=${f.ST}/L=${f.L}/O=${f.O}/OU=${f.OU}/CN=${cn}`;
}

/**
 * The same subject as an RFC 2253 distinguished name — the form OpenSearch's
 * `plugins.security.authcz.admin_dn` / `nodes_dn` expect, which is the reverse
 * order of the openssl one.
 *
 * Derived from the same config as the certificate itself rather than written
 * out anywhere: a DN that disagrees with the issued certificate does not fail
 * loudly, it just rejects the admin, so the two must come from one source.
 *
 * @param {string} cn
 */
export function distinguishedName(cn) {
  const f = subjectFields();
  return `CN=${cn},OU=${f.OU},O=${f.O},L=${f.L},ST=${f.ST},C=${f.C}`;
}

export const OPENSEARCH_ADMIN_CN = 'opensearch-admin';
export const OPENSEARCH_NODE_CN = 'opensearch-node';

/**
 * An openssl extension file for one leaf. Written to a temporary directory
 * rather than next to the certificate, so nothing that is not a credential
 * ends up in the mounted cert directories.
 */
function writeExtFile(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbcg-cert-'));
  const file = path.join(dir, `${spec.base}.ext`);

  const san = spec.altNames
    .map((name, i) => (/^\d+\.\d+\.\d+\.\d+$/.test(name) ? `IP.${i} = ${name}` : `DNS.${i} = ${name}`))
    .join('\n');

  fs.writeFileSync(file, [
    'basicConstraints = CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    `extendedKeyUsage = ${spec.client ? 'clientAuth' : 'serverAuth, clientAuth'}`,
    san ? `subjectAltName = @alt_names\n\n[alt_names]\n${san}` : '',
  ].filter(Boolean).join('\n') + '\n', 'utf8');

  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const openssl = (args) => runCommand('openssl', args, { stdio: ['inherit', 'pipe', 'pipe'] });

/**
 * Enforces `certificates.nginx_external`: fails loudly if the files it
 * promises aren't actually there, rather than letting nginx fail obscurely
 * at container start with a bind-mount-created-a-directory error.
 *
 * Without this guard, re-running the certs step after a hostname change would
 * silently reissue and overwrite a manually-installed real certificate — the
 * flag exists precisely so that can't happen, so it has to be enforced, not
 * just trusted.
 */
function requireExternalNginxCert() {
  const keyPath = path.join(NGINX_DIR, 'server.key');
  const certPath = path.join(NGINX_DIR, 'server.crt');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    throw new UsageError(
      `certificates.nginx_external is set, but the certificate is missing.\n` +
      `Place your real certificate at:\n  ${certPath}\n  ${keyPath}\n` +
      `then re-run this step.`
    );
  }

  consoleLog('INFO', `Using externally-provided nginx certificate, not touching it: ${certPath}`);
}

/**
 * Creates the certificate authority, unless it already exists.
 *
 * Reused rather than regenerated for the same reason prod secrets are: every
 * leaf and every trust store in the stack chains to it, so replacing it
 * invalidates all of them at once.
 */
async function ensureCa(days) {
  fs.mkdirSync(CA_DIR, { recursive: true });

  if (fs.existsSync(CA_KEY) && fs.existsSync(CA_CERT)) return false;

  // genpkey, not genrsa: it emits PKCS#8 ("BEGIN PRIVATE KEY"), which is the
  // only form OpenSearch's security plugin accepts. nginx and Keycloak read
  // either, so PKCS#8 everywhere keeps one format across the stack.
  await openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:4096', '-out', CA_KEY]);
  await openssl([
    'req', '-x509', '-new', '-nodes', '-sha256',
    '-key', CA_KEY,
    '-days', String(days),
    '-subj', subject(loadMasterConfig().certificates?.ca_common_name || 'NBCG Internal CA'),
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-out', CA_CERT,
  ]);

  fs.chmodSync(CA_KEY, 0o600);
  fs.chmodSync(CA_CERT, 0o644);
  return true;
}

/** Issues one leaf certificate signed by the CA. */
async function issueLeaf(spec, days) {
  fs.mkdirSync(spec.dir, { recursive: true });

  const keyPath = path.join(spec.dir, `${spec.base}.key`);
  const certPath = path.join(spec.dir, `${spec.base}.crt`);
  const csrPath = path.join(spec.dir, `${spec.base}.csr`);

  const { file: extFile, cleanup } = writeExtFile(spec);
  try {
    await openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', keyPath]);
    await openssl(['req', '-new', '-key', keyPath, '-subj', subject(spec.cn), '-out', csrPath]);
    await openssl([
      'x509', '-req', '-sha256',
      '-in', csrPath,
      '-CA', CA_CERT, '-CAkey', CA_KEY, '-CAcreateserial',
      '-days', String(days),
      '-extfile', extFile,
      '-out', certPath,
    ]);
  } finally {
    cleanup();
    fs.rmSync(csrPath, { force: true });
  }

  // The containers that read these run as their own users, so the key has to
  // be group/other readable — it never leaves the host or the compose network.
  fs.chmodSync(keyPath, 0o644);
  fs.chmodSync(certPath, 0o644);

  return certPath;
}

/**
 * Records what the leaves were issued for. A certificate is only valid for the
 * names baked into it, so when available_hostnames changes the leaves must be
 * reissued — comparing against this file is what detects that.
 */
const STAMP = path.join(CERT_ROOT, '.issued.json');

function currentStamp(specs) {
  // The subject is part of the stamp because the OpenSearch DNs are derived
  // from it — editing it in master.config.json must reissue, or opensearch.yml
  // ends up naming a DN no certificate carries.
  return JSON.stringify({
    subject: subjectFields(),
    leaves: specs.map(s => ({ n: s.name, cn: s.cn, alt: s.altNames })),
  });
}

function leavesAreCurrent(specs) {
  if (!fs.existsSync(STAMP)) return false;
  const allPresent = specs.every(s =>
    fs.existsSync(path.join(s.dir, `${s.base}.key`)) &&
    fs.existsSync(path.join(s.dir, `${s.base}.crt`))
  );
  return allPresent && fs.readFileSync(STAMP, 'utf8') === currentStamp(specs);
}

/**
 * "certs" step. Creates the CA if absent and (re)issues every leaf whose set
 * of names has changed.
 *
 * Lifetimes come from master.config.json's `certificates` block; the arguments
 * are an override for callers that need one.
 *
 * @param {{ days?: number, caDays?: number }} [options]
 */
export async function generateCertificates({ days, caDays } = {}) {
  const settings = loadMasterConfig().certificates || {};
  days ??= settings.leaf_days ?? 825;
  caDays ??= settings.ca_days ?? 3650;

  if (settings.nginx_external === true) requireExternalNginxCert();

  const specs = leafSpecs();

  const caCreated = await ensureCa(caDays);
  if (caCreated) consoleLog('INFO', `Created certificate authority: ${CA_CERT}`);
  else consoleLog('INFO', `Reusing certificate authority: ${CA_CERT}`);

  // A new CA means the old leaves no longer chain to anything we trust
  if (!caCreated && leavesAreCurrent(specs)) {
    return { message: 'certificates already cover every configured hostname', noop: true };
  }

  for (const spec of specs) {
    const certPath = await issueLeaf(spec, days);
    const names = spec.altNames.length > 0 ? spec.altNames.join(', ') : spec.cn;
    consoleLog('INFO', `Issued ${spec.name} (${names}) -> ${certPath}`);
  }

  // OpenSearch needs the CA alongside its own pair, in the one directory the
  // compose file mounts. It cannot be a second mount: the certs directory is
  // mounted read-only, and docker cannot create a mountpoint inside that.
  // Copying is safe — a CA certificate is public material.
  fs.copyFileSync(CA_CERT, path.join(OPENSEARCH_DIR, 'ca.crt'));

  fs.writeFileSync(STAMP, currentStamp(specs), 'utf8');

  return {
    message: `${caCreated ? 'created CA and ' : ''}issued ${specs.length} certificates`,
  };
}
