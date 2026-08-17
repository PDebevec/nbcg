import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { RequireScopes } from '../../core/auth/scopes.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { HistoryQueryDto } from '../items/dto/history-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { TasksQueryDto } from './dto/tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/**
 * Handoffs between members of staff.
 *
 * Every route is gated on `assertIsStaff` — holding at least one write
 * capability — rather than on a scope: `@RequireScopes` is AND-only and cannot
 * express `drafts:manage OR records:manage`, and `assertAuthenticated` would let
 * `reader` assign work to colleagues.
 *
 * There is no `GET /tasks/assignable-users`. The picker is
 * `GET /api/users?capability=publish|staff&q=…`, in the users module, because
 * the directory outlives task delegation.
 */
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly access: ResourceAccessService,
  ) {}

  @Post()
  async create(@GetPrincipal() principal: Principal, @Body() dto: CreateTaskDto) {
    this.access.assertIsStaff(principal);
    // 404 rather than 403 for an item they cannot see, so filing a task cannot
    // be used to probe for hidden records. Also covers "does this item exist".
    //
    // Deliberately NOT assertCanManage: a cataloguer who spots a typo in a
    // published record cannot fix it, which is precisely why they need to be
    // able to file FIX_METADATA against it. A task is a request, not a mutation.
    await this.access.assertCanView(principal, dto.itemId);
    return this.tasks.create(dto, principal);
  }

  @Get()
  list(@GetPrincipal() principal: Principal, @Query() dto: TasksQueryDto) {
    this.access.assertIsStaff(principal);
    return this.tasks.list(dto, principal);
  }

  /**
   * What happened around an item, across every task ever filed against it —
   * **including tasks that no longer exist.**
   *
   * This is the query the delete asymmetry exists to make possible: `tasks` dies
   * with the item, `task_history` does not. Two segments, so it can never be
   * captured by the `:id` route below.
   *
   * Gated exactly like `GET /items/:id/history`, which is the same kind of
   * thing: a log naming who did what and when, readable by anyone who can see
   * every item regardless of that item's own visibility. That includes the
   * cataloguer and excludes the reader.
   */
  @Get('item/:itemId/history')
  @RequireScopes('records:view:hidden', 'drafts:view:hidden')
  historyForItem(@Param('itemId') itemId: string, @Query() dto: HistoryQueryDto) {
    return this.tasks.historyForItem(itemId, dto.limit ?? 50, dto.offset ?? 0);
  }

  @Get(':id')
  get(@GetPrincipal() principal: Principal, @Param('id') id: string) {
    this.access.assertIsStaff(principal);
    return this.tasks.get(id);
  }

  @Patch(':id')
  update(
    @GetPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    this.access.assertIsStaff(principal);
    return this.tasks.update(id, dto, principal);
  }

  @Post(':id/comments')
  addComment(
    @GetPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    this.access.assertIsStaff(principal);
    return this.tasks.addComment(id, dto, principal);
  }
}
