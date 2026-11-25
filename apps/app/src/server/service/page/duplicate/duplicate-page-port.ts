import type { EventEmitter } from 'node:events';

import type ActivityService from '~/server/service/activity';
import type { IPageGrantService } from '~/server/service/page-grant';
import type { IPageOperationService } from '~/server/service/page-operation';

import type { IPageService } from '../page-service';

/** The narrow view of PageService that the duplicate module may call. */
export type DuplicatePagePort = Pick<
  IPageService,
  | 'create'
  | 'getParentAndFillAncestorsByUser'
  | 'normalizeParentRecursively'
  | 'updateDescendantCountOfSelfAndDescendants'
  | 'updateDescendantCountOfPagesWithPaths'
  | 'updateDescendantCountOfAncestors'
>;

export interface DuplicateDeps {
  readonly pageService: DuplicatePagePort;
  readonly pageGrantService: IPageGrantService;
  readonly pageOperationService: Pick<IPageOperationService, 'canOperate'>;
  readonly activityService: Pick<ActivityService, 'createActivity'>;
  readonly pageEvent: EventEmitter;
  readonly tagEvent: EventEmitter;
  readonly activityEvent: EventEmitter;
}
