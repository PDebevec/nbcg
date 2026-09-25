import { BadRequestException } from '@nestjs/common';

/**
 * `400 PARENT_NOT_FOUND` — a parent the caller named does not exist (deleted,
 * or a wrong id). One shape for `POST /items` (`parentIds`) and
 * `POST /relations/connect`, so a client shows one message for both.
 */
export function parentNotFound(parentIds: string[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'PARENT_NOT_FOUND',
    message: `Parent not found: ${parentIds.join(', ')}`,
    parentIds,
  });
}
