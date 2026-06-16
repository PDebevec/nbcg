import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { VisibilityStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { Principal, VisibilityFilter } from './principal.type';

@Injectable()
export class ResourceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Determine which collection an item belongs to.
   */
  async resolveCollection(id: string): Promise<'records' | 'drafts'> {
    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id }, select: { id: true } }),
      this.prisma.record.findUnique({ where: { id }, select: { id: true } }),
    ]);
    if (draft) return 'drafts';
    if (record) return 'records';
    throw new NotFoundException(`Item not found: ${id}`);
  }

  /**
   * §4.6 — Compute the maximum visibility set per collection for this principal.
   */
  visibilityFilter(principal: Principal): VisibilityFilter {
    const scopes = principal.scopes;

    // Records: PUBLIC is the implicit baseline for everyone, including anonymous
    let records: VisibilityStatus[];
    if (scopes.has('records:view:hidden') || scopes.has('records:manage')) {
      records = [VisibilityStatus.PUBLIC, VisibilityStatus.PRIVATE, VisibilityStatus.HIDDEN];
    } else if (scopes.has('records:view:private')) {
      records = [VisibilityStatus.PUBLIC, VisibilityStatus.PRIVATE];
    } else {
      records = [VisibilityStatus.PUBLIC];
    }

    // Drafts: no access by default — a principal sees no drafts unless granted a scope
    let drafts: VisibilityStatus[];
    if (scopes.has('drafts:view:hidden') || scopes.has('drafts:manage')) {
      drafts = [VisibilityStatus.PUBLIC, VisibilityStatus.PRIVATE, VisibilityStatus.HIDDEN];
    } else if (scopes.has('drafts:view:private')) {
      drafts = [VisibilityStatus.PUBLIC, VisibilityStatus.PRIVATE];
    } else if (scopes.has('drafts:view:public')) {
      drafts = [VisibilityStatus.PUBLIC];
    } else {
      drafts = [];
    }

    return { records, drafts };
  }

  /**
   * §4.3 — Assert the principal can manage a specific item (resolves collection first).
   */
  async assertCanManage(principal: Principal, id: string): Promise<void> {
    const collection = await this.resolveCollection(id);
    this.assertCanManageCollection(principal, collection);
  }

  /**
   * §4.3 — Assert the principal can manage a known collection.
   */
  assertCanManageCollection(principal: Principal, collection: 'records' | 'drafts'): void {
    if (principal.isAnonymous) {
      throw new UnauthorizedException();
    }
    const scope = collection === 'records' ? 'records:manage' : 'drafts:manage';
    if (!principal.scopes.has(scope)) {
      throw new ForbiddenException(`Missing scope: ${scope}`);
    }
  }

  /**
   * §4.3 — Batch delete: resolve all items, assert manage for every collection represented.
   * Rejects the whole request if any id's collection isn't covered.
   */
  async assertCanManageBatch(principal: Principal, ids: string[]): Promise<void> {
    if (principal.isAnonymous) {
      throw new UnauthorizedException();
    }

    const [drafts, records] = await Promise.all([
      this.prisma.draft.findMany({ where: { id: { in: ids } }, select: { id: true } }),
      this.prisma.record.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ]);

    const draftIds = new Set(drafts.map((d) => d.id));
    const recordIds = new Set(records.map((r) => r.id));
    const notFound = ids.filter((id) => !draftIds.has(id) && !recordIds.has(id));
    if (notFound.length > 0) {
      throw new NotFoundException(`Items not found: ${notFound.join(', ')}`);
    }

    if (draftIds.size > 0) this.assertCanManageCollection(principal, 'drafts');
    if (recordIds.size > 0) this.assertCanManageCollection(principal, 'records');
  }

  /**
   * §4.5 — View check for a single item. Returns 404 (not 403) if not visible,
   * so existence of hidden/private items isn't leaked.
   */
  async assertCanView(principal: Principal, id: string): Promise<void> {
    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id }, select: { id: true, visibilityStatus: true } }),
      this.prisma.record.findUnique({ where: { id }, select: { id: true, visibilityStatus: true } }),
    ]);

    if (!draft && !record) {
      throw new NotFoundException(`Item not found: ${id}`);
    }

    const filter = this.visibilityFilter(principal);

    if (draft && !filter.drafts.includes(draft.visibilityStatus)) {
      throw new NotFoundException(`Item not found: ${id}`);
    }
    if (record && !filter.records.includes(record.visibilityStatus)) {
      throw new NotFoundException(`Item not found: ${id}`);
    }
  }

  /**
   * §4.2 — File view check: resolve parent item, then check view permission.
   */
  async assertCanViewFile(principal: Principal, fileId: string): Promise<void> {
    const parentId = await this.resolveFileParent(fileId);
    await this.assertCanView(principal, parentId);
  }

  /**
   * §4.2 — File manage check: resolve parent item's collection, then check manage.
   * Safeguard: a principal holding only drafts:manage is rejected if the target is a record.
   */
  async assertCanManageFile(principal: Principal, fileId: string): Promise<void> {
    const parentId = await this.resolveFileParent(fileId);
    await this.assertCanManage(principal, parentId);
  }

  /**
   * §4.1 — Transition requires both records:manage AND drafts:manage.
   */
  assertCanTransition(principal: Principal): void {
    if (principal.isAnonymous) {
      throw new UnauthorizedException();
    }
    if (!principal.scopes.has('records:manage') || !principal.scopes.has('drafts:manage')) {
      throw new ForbiddenException(
        'Transition requires both records:manage and drafts:manage',
      );
    }
  }

  private async resolveFileParent(fileId: string): Promise<string> {
    const file = await this.prisma.fileAttachment.findUnique({
      where: { id: fileId },
      select: { draft_id: true, record_id: true },
    });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);

    const parentId = file.draft_id ?? file.record_id;
    if (!parentId) throw new NotFoundException(`File has no parent item: ${fileId}`);
    return parentId;
  }
}
