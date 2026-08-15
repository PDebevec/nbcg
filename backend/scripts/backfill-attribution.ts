/**
 * Rewrite attribution snapshots from the current user directory.
 *
 * Two jobs, one script:
 *
 * 1. **The initial backfill.** Rows written before the snapshot columns existed
 *    carry the placeholder `'Unknown user'` from the migration. This resolves
 *    each distinct `userId` to a real name. Must run **before** the OpenSearch
 *    reindex, or the index ships a column full of placeholders.
 *
 * 2. **The correction escape hatch.** Snapshots do not self-heal, by design — a
 *    typo fixed in Keycloak does not propagate to rows already written. Pass
 *    `--user <sub>` to rewrite one person's rows after a genuine correction.
 *
 * Names come from `user_profiles`, so run a sync first (`POST /api/users/sync`,
 * or just restart the API). An id with no directory row is left alone rather than
 * stamped `'Unknown user'`: an unresolvable id usually means the directory has
 * not synced yet, and overwriting a real name with a placeholder is worse than
 * leaving the placeholder in place.
 *
 * Plain `pg` and explicit SQL rather than the Prisma client — the generated
 * client cannot be required under ts-node, and for five UPDATE statements the
 * SQL is the clearer artefact anyway.
 *
 * Usage:
 *   npx ts-node scripts/backfill-attribution.ts --dry-run
 *   npx ts-node scripts/backfill-attribution.ts
 *   npx ts-node scripts/backfill-attribution.ts --user f6bf0426-...
 */
import 'dotenv/config';
import { Pool } from 'pg';

/** Must match SYSTEM_USER_ID / SYSTEM_USER_NAME in src/shared/util/display-name.ts. */
const SYSTEM_USER_ID = 'system';
const SYSTEM_USER_NAME = 'System (import)';

/** Each target as (table, id column, name column). */
const TARGETS: Array<{ table: string; idColumn: string; nameColumn: string }> = [
  { table: 'drafts', idColumn: 'createdByUserId', nameColumn: 'createdByName' },
  { table: 'drafts', idColumn: 'updatedByUserId', nameColumn: 'updatedByName' },
  { table: 'records', idColumn: 'createdByUserId', nameColumn: 'createdByName' },
  { table: 'records', idColumn: 'updatedByUserId', nameColumn: 'updatedByName' },
  { table: 'item_revisions', idColumn: 'userId', nameColumn: 'userName' },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const at = argv.indexOf('--user');
  const only = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && !only) throw new Error('--user requires a Keycloak sub');

  const ids = only ? [only] : await distinctUserIds();

  const { rows: profiles } = await pool.query<{ userId: string; displayName: string }>(
    'SELECT "userId", "displayName" FROM user_profiles WHERE "userId" = ANY($1)',
    [ids],
  );
  const names = new Map(profiles.map((p) => [p.userId, p.displayName]));
  names.set(SYSTEM_USER_ID, SYSTEM_USER_NAME);

  const unresolved = ids.filter((id) => !names.has(id));
  if (unresolved.length > 0) {
    console.warn(
      `${unresolved.length} id(s) have no directory row and will be left untouched:\n` +
        unresolved.map((id) => `  ${id}`).join('\n') +
        '\nRun a sync first if you expected these to resolve.\n',
    );
  }

  const resolvable = ids.filter((id) => names.has(id));
  console.log(
    `Resolving ${resolvable.length} of ${ids.length} id(s)${dryRun ? ' (dry run — nothing will be written)' : ''}`,
  );

  let total = 0;
  for (const id of resolvable) {
    const name = names.get(id)!;
    let changed = 0;

    for (const { table, idColumn, nameColumn } of TARGETS) {
      // `IS DISTINCT FROM` rather than `<>` so a NULL name is counted as a
      // change — updatedByName is nullable and starts out unset.
      const where = `WHERE "${idColumn}" = $1 AND "${nameColumn}" IS DISTINCT FROM $2`;
      const sql = dryRun
        ? `SELECT count(*)::int AS n FROM "${table}" ${where}`
        : `UPDATE "${table}" SET "${nameColumn}" = $2 ${where}`;
      const result = await pool.query(sql, [id, name]);
      changed += dryRun ? (result.rows[0] as { n: number }).n : (result.rowCount ?? 0);
    }

    if (changed > 0) {
      console.log(`  ${id} -> "${name}": ${changed} row(s)${dryRun ? ' would change' : ''}`);
    }
    total += changed;
  }

  console.log(
    dryRun
      ? `\n${total} row(s) would be rewritten. Re-run without --dry-run to apply.`
      : `\n${total} row(s) rewritten.`,
  );

  if (!dryRun && total > 0) {
    // Touching drafts/records is CDC-visible, so pgsync re-indexes those
    // documents. Worth saying out loud — it is the expensive part.
    console.log(
      'Note: drafts/records are CDC-tracked, so pgsync will re-index the affected\n' +
        'documents, nested extractedText included.',
    );
  }
}

/** Every id referenced by any attribution column, in any of the three tables. */
async function distinctUserIds(): Promise<string[]> {
  const { rows } = await pool.query<{ uid: string }>(`
    SELECT DISTINCT uid FROM (
      SELECT "createdByUserId" AS uid FROM drafts
      UNION SELECT "updatedByUserId" FROM drafts
      UNION SELECT "createdByUserId" FROM records
      UNION SELECT "updatedByUserId" FROM records
      UNION SELECT "userId" FROM item_revisions
    ) t WHERE uid IS NOT NULL
    ORDER BY uid
  `);
  return rows.map((r) => r.uid);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
