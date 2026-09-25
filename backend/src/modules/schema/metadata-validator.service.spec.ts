import { BadRequestException } from '@nestjs/common';
import { MetadataValidatorService } from './metadata-validator.service';
import { SchemaService } from './schema.service';

const BOOK = { code: 'am', en: 'Book', cnr: 'Knjiga' };
const SERIAL = { code: 'as', en: 'Journal / Serial', cnr: 'Časopis / Serijska publikacija' };

/** A fake Prisma client: one relation table, a drafts and a records table. */
function fakeDb(
  relations: Array<{ childId: string; parentId: string }>,
  drafts: Record<string, unknown>,
  records: Record<string, unknown> = {},
) {
  const calls = { relations: 0, drafts: 0, records: 0 };
  const rows = (table: Record<string, unknown>, ids: string[]) =>
    ids.filter((id) => id in table).map((id) => ({ id, metadata: table[id] }));
  const db = {
    itemRelation: {
      findMany: jest.fn(async ({ where }: any) => {
        calls.relations++;
        return relations.filter((r) => where.childId.in.includes(r.childId));
      }),
    },
    draft: {
      findMany: jest.fn(async ({ where }: any) => {
        calls.drafts++;
        return rows(drafts, where.id.in);
      }),
    },
    record: {
      findMany: jest.fn(async ({ where }: any) => {
        calls.records++;
        return rows(records, where.id.in);
      }),
    },
  };
  return { db, calls };
}

describe('MetadataValidatorService', () => {
  const schema = new SchemaService();

  it('loads every parent in one query per table and applies parent rules', async () => {
    const { db, calls } = fakeDb(
      [
        { childId: 'issue-1', parentId: 'serial' },
        { childId: 'issue-2', parentId: 'serial' },
      ],
      { serial: { title: 'Serial', collectionType: 4 } },
    );
    const service = new MetadataValidatorService(db as any, schema);
    const issue = { title: 'No. 1', collectionType: 0, materialType: SERIAL, extent: { value: 8, unit: 'pages' } };

    const results = await service.validate([
      { id: 'issue-1', metadata: issue, itemState: 'DRAFT', targetState: 'RECORD' },
      { id: 'issue-2', metadata: { ...issue, issue: { number: '2', date: '1905-03' } }, itemState: 'DRAFT', targetState: 'RECORD' },
      { id: 'orphan', metadata: issue, itemState: 'DRAFT', targetState: 'RECORD' },
    ]);

    expect(calls).toEqual({ relations: 1, drafts: 1, records: 1 });
    expect(results.map((r) => [r.id, r.state, r.ok, r.missing.map((m) => m.path)])).toEqual([
      ['issue-1', 'RECORD', false, ['issue.number', 'issue.date']],
      ['issue-2', 'RECORD', true, []],
      ['orphan', 'RECORD', true, []],
    ]);
  });

  it('checks an issue saved as a draft without its issue data', async () => {
    const { db } = fakeDb([{ childId: 'issue', parentId: 'serial' }], { serial: { collectionType: 4 } });
    const service = new MetadataValidatorService(db as any, schema);
    const [result] = await service.validate([
      { id: 'issue', metadata: { title: 'No. 1', collectionType: 0, materialType: SERIAL }, itemState: 'DRAFT', targetState: 'DRAFT' },
    ]);
    expect(result).toMatchObject({ state: 'DRAFT', ok: true });
  });

  it('skips the relation query for an item that does not exist yet', async () => {
    const { db, calls } = fakeDb([], {});
    const service = new MetadataValidatorService(db as any, schema);
    const [result] = await service.validate([
      { id: null, metadata: { title: 'T', collectionType: 0 }, itemState: 'NEW', targetState: 'DRAFT' },
    ]);
    expect(calls.relations).toBe(0);
    expect(result).toMatchObject({ id: null, state: 'DRAFT', ok: false, missing: [{ path: 'materialType' }] });
  });

  it('uses the parents it is given instead of reading item_relations', async () => {
    const { db, calls } = fakeDb([], {});
    const service = new MetadataValidatorService(db as any, schema);
    const [result] = await service.validate([
      {
        id: 'new-issue',
        metadata: { title: 'No. 1', collectionType: 0, materialType: BOOK, extent: { value: 8, unit: 'pages' } },
        itemState: 'NEW',
        targetState: 'RECORD',
        parents: [{ collectionType: 4 }],
      },
    ]);
    expect(calls.relations).toBe(0);
    expect(result.missing.map((m) => m.path)).toEqual(['issue.number', 'issue.date']);
  });

  it('throws METADATA_VALIDATION_FAILED listing only the failing items, with their state', async () => {
    const { db } = fakeDb([], {});
    const service = new MetadataValidatorService(db as any, schema);
    const good = { title: 'Good', collectionType: 0, materialType: BOOK, extent: { value: 100, unit: 'pages' } };
    const bad = { title: 'Bad', collectionType: 0, materialType: BOOK };

    const error = await service
      .assertValid([
        { id: 'good', metadata: good, itemState: 'DRAFT', targetState: 'RECORD' },
        { id: 'bad', metadata: bad, itemState: 'DRAFT', targetState: 'RECORD' },
      ])
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      code: 'METADATA_VALIDATION_FAILED',
      message: '1 of 2 items are not ready to publish',
      items: [
        {
          id: 'bad',
          state: 'RECORD',
          missing: [{ path: 'extent', label: { en: 'Number of pages', cnr: 'Broj strana' } }],
          violations: [],
        },
      ],
    });
  });

  it('says "cannot be saved" when a draft fails', async () => {
    const { db } = fakeDb([], {});
    const service = new MetadataValidatorService(db as any, schema);
    const error = await service
      .assertValid([{ id: null, metadata: { title: 'T', collectionType: 0 }, itemState: 'NEW', targetState: 'DRAFT' }])
      .catch((e) => e);
    expect(error.getResponse()).toMatchObject({
      code: 'METADATA_VALIDATION_FAILED',
      message: '1 of 1 item cannot be saved',
      items: [{ id: null, state: 'DRAFT', missing: [{ path: 'materialType' }] }],
    });
  });

  it('passes silently when everything is complete', async () => {
    const { db } = fakeDb([], {});
    const service = new MetadataValidatorService(db as any, schema);
    await expect(
      service.assertValid([
        { id: 'x', metadata: { title: 'T', collectionType: 3, materialType: BOOK }, itemState: 'DRAFT', targetState: 'RECORD' },
        { id: 'y', metadata: { title: 'T', collectionType: 0, materialType: BOOK }, itemState: 'NEW', targetState: 'DRAFT' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('re-checks stored items in their current state, with the parents the transaction sees', async () => {
    const { db } = fakeDb(
      [
        { childId: 'draft-issue', parentId: 'serial' },
        { childId: 'record-issue', parentId: 'serial' },
      ],
      { serial: { collectionType: 4 }, 'draft-issue': { title: 'D', collectionType: 0, materialType: BOOK } },
      { 'record-issue': { title: 'R', collectionType: 0, materialType: BOOK, extent: { value: 8, unit: 'pages' } } },
    );
    const service = new MetadataValidatorService(db as any, schema);

    const error = await service.assertStoredValid(['draft-issue', 'record-issue', 'gone']).catch((e) => e);

    expect(error.getResponse()).toMatchObject({
      message: '1 of 2 items are not ready to publish',
      items: [{ id: 'record-issue', state: 'RECORD', missing: [{ path: 'issue.number' }, { path: 'issue.date' }] }],
    });
  });
});
