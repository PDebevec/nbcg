import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChangeAction,
  ItemType,
  TaskAction,
  TaskKind,
  TaskStatus,
  VisibilityStatus,
} from '../../../generated/prisma/enums';
import { EDITABLE_BASE_METADATA_SHAPE } from '../../core/types/metadata.types';
import type { FieldChange } from '../../core/types/revision.types';
import { DOMAIN_RECORD_SHAPE, FieldValidator } from '../import/cobiss/cobiss-util/cobiss.types';
import type { Actor } from '../../core/auth/actor.type';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevisionsService } from '../../core/revisions/revisions.service';
import { SeaweedfsService } from '../../core/seaweedfs/seaweedfs.service';
import { TaskHistoryService } from '../../core/task-history/task-history.service';
import { diffMetadata } from '../../shared/util/diff-metadata';
import { generateDeterministicId } from '../../shared/util/generateUuidFromCobissId';

// Derived at module load from the type shapes — automatically stays in sync
// with DomainRecord and BaseMetadata. Maps key → sanitizer function.
// Unknown keys are dropped; known keys with wrong types throw 400.
const METADATA_VALIDATORS = new Map<string, FieldValidator>([
  ...Object.entries(EDITABLE_BASE_METADATA_SHAPE),
  ...Object.entries(DOMAIN_RECORD_SHAPE),
]);

// Required metadata field validators.
// Add entries here to enforce more required fields without changing service logic.
const REQUIRED_METADATA_VALIDATORS: Array<{
  key: string;
  validate: (v: unknown) => boolean;
  message: string;
}> = [
  {
    key: 'title',
    validate: (v) => typeof v !== 'string' || v.trim().length > 0,
    message: 'title must not be empty',
  },
];

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seaweedfs: SeaweedfsService,
    private readonly revisions: RevisionsService,
    private readonly taskHistory: TaskHistoryService,
  ) {}

  async stats(): Promise<{
    records: Record<VisibilityStatus, number>;
    drafts: Record<VisibilityStatus, number>;
  }> {
    const [recordGroups, draftGroups] = await Promise.all([
      this.prisma.record.groupBy({ by: ['visibilityStatus'], _count: { _all: true } }),
      this.prisma.draft.groupBy({ by: ['visibilityStatus'], _count: { _all: true } }),
    ]);

    const empty = (): Record<VisibilityStatus, number> => ({
      [VisibilityStatus.PUBLIC]: 0,
      [VisibilityStatus.PRIVATE]: 0,
      [VisibilityStatus.HIDDEN]: 0,
    });

    const records = empty();
    for (const g of recordGroups) records[g.visibilityStatus] = g._count._all;
    const drafts = empty();
    for (const g of draftGroups) drafts[g.visibilityStatus] = g._count._all;

    return { records, drafts };
  }

  async create(
    visibilityStatus: VisibilityStatus,
    targetState: ItemType,
    rawMetadata: Record<string, unknown> | undefined,
    actor: Actor,
  ) {
    const sanitizedMetadata = this.sanitizeMetadata(rawMetadata ?? {});

    for (const { key, validate, message } of REQUIRED_METADATA_VALIDATORS) {
      if (!sanitizedMetadata[key] || !validate(sanitizedMetadata[key])) {
        throw new BadRequestException(message);
      }
    }

    const cobissId = sanitizedMetadata.cobissId as string | undefined;
    let id: string | undefined;
    let _source: string;

    if (cobissId) {
      id = generateDeterministicId(cobissId);
      const [existingDraft, existingRecord] = await Promise.all([
        this.prisma.draft.findUnique({ where: { id }, select: { id: true } }),
        this.prisma.record.findUnique({ where: { id }, select: { id: true } }),
      ]);
      if (existingDraft || existingRecord) {
        throw new ConflictException('Item with this COBISS ID already exists');
      }
      _source = 'cobiss';
    } else {
      _source = 'nbcg';
    }

    const finalMetadata = {
      collectionType: 0,
      ...sanitizedMetadata,
      _source,
      childrenInDrafts: 0,
      childrenInRecords: 0,
      jeGlavnoGradivo: true,
    };

    const data = {
      ...(id ? { id } : {}),
      visibilityStatus,
      metadata: finalMetadata,
      createdByUserId: actor.userId,
      createdByName: actor.userName,
      updatedByUserId: actor.userId,
      updatedByName: actor.userName,
    };

    // The item and its opening revision are written together: a timeline that
    // can disagree with the item it describes is worse than no timeline.
    return this.prisma.$transaction(async (tx) => {
      const item =
        targetState === ItemType.RECORD
          ? await tx.record.create({ data: data as any })
          : await tx.draft.create({ data: data as any });

      // No `changes` on CREATE — the diff against nothing is just the item's
      // own metadata, which is already readable from the item.
      await this.revisions.record(
        { itemId: item.id, version: item.version, action: ChangeAction.CREATE, actor },
        tx,
      );

      return item;
    });
  }

  /**
   * Revision timeline for one item, newest first. `itemId` survives a
   * DRAFT <-> RECORD transition, so this covers drafting and post-publication
   * edits as one continuous history.
   */
  async history(itemId: string, limit: number, offset: number) {
    const [total, revisions] = await Promise.all([
      this.prisma.itemRevision.count({ where: { itemId } }),
      this.prisma.itemRevision.findMany({
        where: { itemId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return { itemId, total, limit, offset, revisions };
  }

  async update(
    id: string,
    visibilityStatus: VisibilityStatus | undefined,
    rawMetadata: Record<string, unknown> | undefined,
    actor: Actor,
    expectedVersion: number,
  ) {
    const metadataUpdate = rawMetadata ? this.sanitizeMetadata(rawMetadata) : undefined;

    // Validate required fields only when they are present in the incoming payload.
    if (metadataUpdate) {
      for (const { key, validate, message } of REQUIRED_METADATA_VALIDATORS) {
        if (key in metadataUpdate && !validate(metadataUpdate[key])) {
          throw new BadRequestException(message);
        }
      }
    }

    const hasMetadataChanges =
      metadataUpdate !== undefined && Object.keys(metadataUpdate).length > 0;

    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id } }),
      this.prisma.record.findUnique({ where: { id } }),
    ]);

    if (!draft && !record) {
      throw new NotFoundException(`Item not found: ${id}`);
    }

    const existing = draft ?? record!;

    if (existing.version !== expectedVersion) {
      throw new ConflictException(
        `Version conflict: expected ${expectedVersion}, current ${existing.version}. Re-fetch the item and retry.`,
      );
    }

    // Nothing to write. Checked only after the existence and version guards
    // above, so an empty payload is validated exactly as strictly as a real
    // one. Returns the unchanged version to keep the response shape uniform.
    if (!visibilityStatus && !hasMetadataChanges) {
      return { version: existing.version };
    }

    const existingMetadata =
      (existing.metadata as unknown as Record<string, unknown>) ?? {};

    const data: Record<string, unknown> = {
      updatedByUserId: actor.userId,
      updatedByName: actor.userName,
      version: existing.version + 1,
    };
    if (visibilityStatus) data.visibilityStatus = visibilityStatus;
    if (hasMetadataChanges) {
      data.metadata = { ...existingMetadata, ...metadataUpdate };
    }

    const changes: FieldChange[] = hasMetadataChanges
      ? diffMetadata(existingMetadata, data.metadata as Record<string, unknown>)
      : [];
    if (visibilityStatus && visibilityStatus !== existing.visibilityStatus) {
      changes.push({
        path: 'visibilityStatus',
        before: existing.visibilityStatus,
        after: visibilityStatus,
      });
    }

    // A PATCH that only moves PUBLIC -> HIDDEN reads better on a timeline as
    // its own action than as a generic edit.
    const action =
      changes.length > 0 && changes.every((c) => c.path === 'visibilityStatus')
        ? ChangeAction.VISIBILITY_CHANGE
        : ChangeAction.UPDATE;

    await this.prisma.$transaction(async (tx) => {
      // Use a WHERE clause that includes version to guard against races
      // between the read above and this write.
      const result = draft
        ? await tx.draft.updateMany({ where: { id, version: existing.version }, data })
        : await tx.record.updateMany({ where: { id, version: existing.version }, data });

      if (result.count === 0) {
        throw new ConflictException(
          'Version conflict: the item was modified by another request. Re-fetch and retry.',
        );
      }

      await this.revisions.record(
        { itemId: id, version: existing.version + 1, action, changes, actor },
        tx,
      );
    });

    return { version: existing.version + 1 };
  }

  async delete(ids: string[], actor: Actor): Promise<void> {
    const attachments = await this.prisma.fileAttachment.findMany({
      where: { OR: [{ draft_id: { in: ids } }, { record_id: { in: ids } }] },
      select: { originalFid: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const [allDrafts, allRecords] = await Promise.all([
        tx.draft.findMany({ where: { id: { in: ids } } }),
        tx.record.findMany({ where: { id: { in: ids } } }),
      ]);

      const draftIds = new Set(allDrafts.map((d) => d.id));
      const recordIds = new Set(allRecords.map((r) => r.id));

      const notFound = ids.filter((id) => !draftIds.has(id) && !recordIds.has(id));
      if (notFound.length > 0) {
        throw new NotFoundException(`Items not found: ${notFound.join(', ')}`);
      }

      // Delete relations first so the DELETE trigger can update parent counts
      // before the items themselves are removed.
      // Note: file_attachments are deleted automatically via ON DELETE CASCADE.
      await tx.itemRelation.deleteMany({
        where: { OR: [{ parentId: { in: ids } }, { childId: { in: ids } }] },
      });

      // Live tasks die with the item: one pointing at a deleted item is
      // unactionable noise in someone's inbox forever, and deleting them keeps
      // the invariant that every task points at a real item, so no read path
      // needs a missing-item branch.
      //
      // `task_history` deliberately does NOT die with it. It is the audit
      // record, it has no FK to block or cascade, and its rows carry `itemId`
      // so "what happened around this record" stays answerable once both the
      // task and the item are gone — which is the whole reason the log is a
      // separate table. Same call, and the same reasoning, as item_revisions.
      await tx.task.deleteMany({ where: { itemId: { in: ids } } });

      const fromDrafts = ids.filter((id) => draftIds.has(id));
      const fromRecords = ids.filter((id) => recordIds.has(id));

      // Written before the rows go away, but still inside the transaction, so
      // a failed delete leaves no phantom DELETE on the timeline. Revisions
      // have no FK to drafts/records precisely so they can outlive the item.
      await this.revisions.record(
        [...allDrafts, ...allRecords].map((item) => ({
          itemId: item.id,
          version: item.version,
          action: ChangeAction.DELETE,
          actor,
        })),
        tx,
      );

      if (fromDrafts.length > 0) {
        await tx.draft.deleteMany({ where: { id: { in: fromDrafts } } });
      }
      if (fromRecords.length > 0) {
        await tx.record.deleteMany({ where: { id: { in: fromRecords } } });
      }
    });

    // Delete files from SeaweedFS after DB commit succeeds.
    // If this fails, we get orphaned blobs (wasted storage) but DB stays consistent.
    await Promise.all(attachments.map((a) => this.seaweedfs.delete(a.originalFid).catch(() => {})));
  }

  async transition(
    ids: string[],
    targetState: ItemType,
    actor: Actor,
  ): Promise<Array<{ id: string; version: number }>> {
    return this.prisma.$transaction(async (tx) => {
      const [allDrafts, allRecords] = await Promise.all([
        tx.draft.findMany({ where: { id: { in: ids } } }),
        tx.record.findMany({ where: { id: { in: ids } } }),
      ]);

      const draftsMap = new Map(allDrafts.map((d) => [d.id, d]));
      const recordsMap = new Map(allRecords.map((r) => [r.id, r]));

      const notFound: string[] = [];
      const conflict: string[] = [];
      const alreadyInState: string[] = [];

      for (const id of ids) {
        const inDraft = draftsMap.has(id);
        const inRecord = recordsMap.has(id);

        if (!inDraft && !inRecord) {
          notFound.push(id);
        } else if (inDraft && inRecord) {
          conflict.push(id);
        } else if (
          (inRecord && targetState === ItemType.RECORD) ||
          (inDraft && targetState === ItemType.DRAFT)
        ) {
          alreadyInState.push(id);
        }
      }

      if (notFound.length > 0) {
        throw new NotFoundException(`Items not found: ${notFound.join(', ')}`);
      }
      if (conflict.length > 0) {
        throw new ConflictException(
          `Items exist in both tables (data corruption): ${conflict.join(', ')}`,
        );
      }
      if (alreadyInState.length > 0) {
        throw new BadRequestException(
          `Items already in state ${targetState}: ${alreadyInState.join(', ')}`,
        );
      }

      const fromDrafts = ids.filter((id) => draftsMap.has(id));
      const fromRecords = ids.filter((id) => recordsMap.has(id));
      const now = new Date();

      if (targetState === ItemType.RECORD) {
        await tx.record.createMany({
          data: fromDrafts.map((id) => {
            const d = draftsMap.get(id)!;
            return {
              id: d.id,
              visibilityStatus: d.visibilityStatus,
              metadata: d.metadata ?? undefined,
              version: d.version + 1,
              createdAt: d.createdAt,
              createdByUserId: d.createdByUserId,
              createdByName: d.createdByName,
              updatedAt: now,
              updatedByUserId: actor.userId,
              updatedByName: actor.userName,
            };
          }),
        });
      } else {
        await tx.draft.createMany({
          data: fromRecords.map((id) => {
            const r = recordsMap.get(id)!;
            return {
              id: r.id,
              visibilityStatus: r.visibilityStatus,
              metadata: r.metadata ?? undefined,
              version: r.version + 1,
              createdAt: r.createdAt,
              createdByUserId: r.createdByUserId,
              createdByName: r.createdByName,
              updatedAt: now,
              updatedByUserId: actor.userId,
              updatedByName: actor.userName,
            };
          }),
        });
      }

      // Update childType on relations where moved items are children.
      // The UPDATE trigger fires here and atomically swaps childrenInDrafts ↔ childrenInRecords
      // on the affected parent items.
      await tx.itemRelation.updateMany({
        where: { childId: { in: ids } },
        data: { childType: targetState },
      });

      // Update parentType on relations where moved items are parents.
      // No count change needed — parent metadata was copied to the new table.
      await tx.itemRelation.updateMany({
        where: { parentId: { in: ids } },
        data: { parentType: targetState },
      });

      // Re-link file attachments before cascade fires on delete.
      // IDs are identical after transition so record_id/draft_id = id directly.
      // Per-id loop is required because Prisma can't set column = different value per row.
      if (fromDrafts.length > 0 && targetState === ItemType.RECORD) {
        await Promise.all(fromDrafts.map((id) =>
          tx.fileAttachment.updateMany({
            where: { draft_id: id },
            data: { record_id: id, draft_id: null },
          }),
        ));
      }
      if (fromRecords.length > 0 && targetState === ItemType.DRAFT) {
        await Promise.all(fromRecords.map((id) =>
          tx.fileAttachment.updateMany({
            where: { record_id: id },
            data: { draft_id: id, record_id: null },
          }),
        ));
      }

      if (fromDrafts.length > 0) {
        await tx.draft.deleteMany({ where: { id: { in: fromDrafts } } });
      }
      if (fromRecords.length > 0) {
        await tx.record.deleteMany({ where: { id: { in: fromRecords } } });
      }

      // Read the versions back rather than returning the ones written above:
      // a transitioned item that is itself a parent may have been bumped again
      // by the children-count trigger when its children's childType changed.
      const result =
        targetState === ItemType.RECORD
          ? await tx.record.findMany({
              where: { id: { in: ids } },
              select: { id: true, version: true },
            })
          : await tx.draft.findMany({
              where: { id: { in: ids } },
              select: { id: true, version: true },
            });

      // The id is preserved across the move, so these land on the same timeline
      // as the item's draft-era edits.
      await this.revisions.record(
        result.map(({ id, version }) => ({
          itemId: id,
          version,
          action: targetState === ItemType.RECORD ? ChangeAction.PUBLISH : ChangeAction.UNPUBLISH,
          changes: [
            {
              path: 'itemType',
              before: targetState === ItemType.RECORD ? ItemType.DRAFT : ItemType.RECORD,
              after: targetState,
            },
          ],
          actor,
        })),
        tx,
      );

      // A published item's review task is done, however it got published. This
      // endpoint is also reachable via bulk publish, import and admin action, so
      // the task list cannot rely on anyone going through the task itself — an
      // observer here is the correctness mechanism, and a task-driven publish
      // endpoint would be ergonomics on top rather than a replacement.
      //
      // RETURNED is included deliberately: if the item went out anyway, the goal
      // was reached and the task should not linger with the cataloguer.
      //
      // FIX_METADATA and GENERAL are untouched — publishing is not evidence that
      // a metadata fix was made, and there is no signal that would tell us.
      //
      // Not symmetric: RECORD -> DRAFT does NOT reopen completed tasks. That
      // would be spooky action at a distance months later; file a new task.
      if (targetState === ItemType.RECORD) {
        const closing = await tx.task.findMany({
          where: {
            itemId: { in: ids },
            kind: TaskKind.REVIEW_PUBLISH,
            status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.RETURNED] },
          },
          select: { id: true, itemId: true, status: true },
        });

        if (closing.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: closing.map((t) => t.id) } },
            data: { status: TaskStatus.COMPLETED, completedAt: now },
          });
          // So a task never appears to close by itself. Attributed to the real
          // publisher rather than to `system`: "closed by Ana publishing it" is
          // more use than "closed by system", and a human genuinely did it.
          await this.taskHistory.record(
            closing.map((t) => ({
              taskId: t.id,
              itemId: t.itemId,
              action: TaskAction.CLOSED_ON_PUBLISH,
              changes: [
                { path: 'status', before: t.status, after: TaskStatus.COMPLETED },
              ],
              actor,
            })),
            tx,
          );
        }
      }

      return result;
    });
  }

  private sanitizeMetadata(
    rawMetadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const entries: [string, unknown][] = [];
    for (const [k, v] of Object.entries(rawMetadata)) {
      const sanitize = METADATA_VALIDATORS.get(k);
      if (!sanitize) continue; // unknown field — silently drop
      try {
        entries.push([k, sanitize(v)]);
      } catch (e) {
        throw new BadRequestException(
          `Invalid value for metadata field "${k}": ${(e as Error).message}`,
        );
      }
    }
    return Object.fromEntries(entries);
  }
}
