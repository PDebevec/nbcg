import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { RequireScopes } from '../../core/auth/scopes.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { UsersQueryDto } from './dto/users-query.dto';
import { UserSyncQueueService } from './queue/user-sync-queue.service';
import { UserSyncService } from './user-sync.service';
import { UsersService } from './users.service';

/**
 * The local user directory.
 *
 * A `users` module rather than `tasks/assignable-users`: the directory outlives
 * task delegation, and "filter search by cataloguer" and "who can publish this"
 * want the same list.
 *
 * Reads require at least one write capability (`assertIsStaff`), not merely
 * authentication. The directory exists to serve the task-delegation picker, and
 * only people who can be given or can hand out work need it — a `reader` gets a
 * 403. That is also why `email` is returned unconditionally: everyone who can
 * reach this endpoint is internal staff who can see each other in Keycloak.
 *
 * Writing is not an endpoint at all: the sync job is the only writer, and
 * `POST /users/sync` only asks it to run.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly sync: UserSyncService,
    private readonly queue: UserSyncQueueService,
    private readonly access: ResourceAccessService,
  ) {}

  // Above :id, so "sync" is never captured as a user id.
  @Post('sync')
  @RequireScopes('users:manage')
  triggerSync() {
    return this.queue.enqueue();
  }

  /**
   * Exists because a sync that has been silently failing for a week is otherwise
   * invisible until the picker is mysteriously empty.
   */
  @Get('sync/status')
  @RequireScopes('users:manage')
  syncStatus() {
    return this.sync.status();
  }

  @Get()
  list(@GetPrincipal() principal: Principal, @Query() dto: UsersQueryDto) {
    this.access.assertIsStaff(principal);
    return this.users.list(dto);
  }

  @Get(':id')
  get(@GetPrincipal() principal: Principal, @Param('id') id: string) {
    this.access.assertIsStaff(principal);
    return this.users.get(id);
  }
}
