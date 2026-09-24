import { BadRequestException } from '@nestjs/common';
import { PublishValidatorService } from './publish-validator.service';
import { SchemaService } from './schema.service';

const BOOK = { code: 'am', en: 'Book', cnr: 'Knjiga' };
const SERIAL = { code: 'as', en: 'Journal / Serial', cnr: 'Časopis / Serijska publikacija' };

/** A fake Prisma client: one relation table, one drafts table, no records. */
function fakeDb(relations: Array<{ childId: string; parentId: string }>, drafts: Record<string, unknown>) {
  const calls = { relations: 0, drafts: 0, records: 0 };
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
        return where.id.in.filter((id: string) => id in drafts).map((id: string) => ({ id, metadata: drafts[id] }));
      }),
    },
    record: {
      findMany: jest.fn(async () => {
        calls.records++;
        return [];
      }),
    },
  };
  return { db, calls };
}

describe('PublishValidatorService', () => {
  const schema = new SchemaService();

  it('loads every parent in one query per table and applies parent rules', async () => {
    const { db, calls } = fakeDb(
      [
        { childId: 'issue-1', parentId: 'serial' },
        { childId: 'issue-2', parentId: 'serial' },
      ],
      { serial: { title: 'Serial', collectionType: 4 } },
    );
    const service = new PublishValidatorService(db as any, schema);
    const issue = { title: 'No. 1', collectionType: 0, materialType: SERIAL, extent: { value: 8, unit: 'pages' } };

    const results = await service.validate([
      { id: 'issue-1', metadata: issue, itemState: 'DRAFT' },
      { id: 'issue-2', metadata: { ...issue, issue: { number: '2', date: '1905-03' } }, itemState: 'DRAFT' },
      { id: 'orphan', metadata: issue, itemState: 'DRAFT' },
    ]);

    expect(calls).toEqual({ relations: 1, drafts: 1, records: 1 });
    expect(results.map((r) => [r.id, r.ok, r.missing.map((m) => m.path)])).toEqual([
      ['issue-1', false, ['issue.number', 'issue.date']],
      ['issue-2', true, []],
      ['orphan', true, []],
    ]);
  });

  it('skips the relation query for an item that does not exist yet', async () => {
    const { db, calls } = fakeDb([], {});
    const service = new PublishValidatorService(db as any, schema);
    const [result] = await service.validate([
      { id: null, metadata: { title: 'T', collectionType: 0 }, itemState: 'NEW' },
    ]);
    expect(calls.relations).toBe(0);
    expect(result).toMatchObject({ id: null, ok: false, missing: [{ path: 'materialType' }] });
  });

  it('throws PUBLISH_VALIDATION_FAILED listing only the failing items', async () => {
    const { db } = fakeDb([], {});
    const service = new PublishValidatorService(db as any, schema);
    const good = { title: 'Good', collectionType: 0, materialType: BOOK, extent: { value: 100, unit: 'pages' } };
    const bad = { title: 'Bad', collectionType: 0, materialType: BOOK };

    const error = await service
      .assertPublishable([
        { id: 'good', metadata: good, itemState: 'DRAFT' },
        { id: 'bad', metadata: bad, itemState: 'DRAFT' },
      ])
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      code: 'PUBLISH_VALIDATION_FAILED',
      message: '1 of 2 items are not ready to publish',
      items: [
        {
          id: 'bad',
          missing: [{ path: 'extent', label: { en: 'Number of pages', cnr: 'Broj strana' } }],
          violations: [],
        },
      ],
    });
  });

  it('passes silently when everything is complete', async () => {
    const { db } = fakeDb([], {});
    const service = new PublishValidatorService(db as any, schema);
    await expect(
      service.assertPublishable([
        { id: 'x', metadata: { title: 'T', collectionType: 3, materialType: BOOK }, itemState: 'DRAFT' },
      ]),
    ).resolves.toBeUndefined();
  });
});
