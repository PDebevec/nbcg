import { Injectable, Logger } from '@nestjs/common';
import { ChangeAction } from '../../../generated/prisma/enums';
import type { Prisma } from '../../../generated/prisma/client';
import type { FieldChange } from '../types/revision.types';
import { PrismaService } from '../prisma/prisma.service';

/** The root client or a `$transaction` client — callers pass whichever they hold. */
type RevisionWriter = PrismaService | Prisma.TransactionClient;

export interface RevisionInput {
  itemId: string;
  /** The item's version *after* the change. */
  version: number;
  action: ChangeAction;
  /** Omitted for CREATE/DELETE, where the diff would just restate the item. */
  changes?: FieldChange[];
  userId: string;
}

@Injectable()
export class RevisionsService {
  private readonly logger = new Logger(RevisionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append revisions.
   *
   * Pass the transaction client as `tx` for item writes: history that is not
   * written in the same transaction as the item can disagree with it, and a
   * timeline that disagrees with the record is worse than no timeline.
   *
   * File and relation writes are not transactional in this codebase, so those
   * callers use {@link recordDetached} instead.
   */
  async record(inputs: RevisionInput | RevisionInput[], tx?: RevisionWriter): Promise<void> {
    // `changes` is omitted rather than set to null when empty — the column is
    // nullable, and omitting keeps Prisma out of its DbNull/JsonNull dance.
    const rows = (Array.isArray(inputs) ? inputs : [inputs]).map((i) => ({
      itemId: i.itemId,
      version: i.version,
      action: i.action,
      ...(i.changes && i.changes.length > 0 ? { changes: i.changes } : {}),
      userId: i.userId,
    }));
    if (rows.length === 0) return;

    await (tx ?? this.prisma).itemRevision.createMany({ data: rows });
  }

  /**
   * Append revisions outside any transaction, swallowing failures.
   *
   * For writes whose primary effect has already been committed (a file blob
   * stored, a relation row inserted): losing the timeline entry is a cosmetic
   * gap, whereas turning a successful upload into a 500 is not.
   */
  async recordDetached(inputs: RevisionInput | RevisionInput[]): Promise<void> {
    try {
      await this.record(inputs);
    } catch (err) {
      this.logger.error(
        'Failed to write item revision — the change itself succeeded, only history is missing',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Current version of an item, whichever table it lives in.
   * File and relation writes do not bump `version`, so their revisions record
   * the version the item already had.
   */
  async currentVersion(itemId: string): Promise<number> {
    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id: itemId }, select: { version: true } }),
      this.prisma.record.findUnique({ where: { id: itemId }, select: { version: true } }),
    ]);
    return (draft ?? record)?.version ?? 0;
  }
}
