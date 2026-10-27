import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';

import type {
  CreatableOperationType,
  FailureReason,
  OperationRecord,
  WaitingReason,
} from '../../interfaces';
import {
  checkEditingPresence,
  type EditingPresenceSource,
} from './editing-presence';
import type { ChangeProposalSettings } from './settings';

export type PageOperationWait = {
  readonly timeoutMs: number;
  readonly intervalMs: number;
};

export const PAGE_OPERATION_WAIT_MS = 30_000;

export const DEFAULT_PAGE_OPERATION_WAIT: PageOperationWait = {
  timeoutMs: PAGE_OPERATION_WAIT_MS,
  intervalMs: 500,
};

export type CanOperate = (
  isRecursively: boolean,
  fromPathToOp: string | null,
  toPathToOp: string | null,
) => Promise<boolean>;

type PageOperationScope = Parameters<CanOperate>;

type PageFacts = {
  readonly path: string;
  readonly descendantCount: number;
};

const CREATABLE_TYPES: Readonly<Record<CreatableOperationType, true>> = {
  edit: true,
  create: true,
  move: true,
};

const isCreatableType = (
  type: OperationRecord['type'],
): type is CreatableOperationType => Object.hasOwn(CREATABLE_TYPES, type);

// Not applied to revert proposals (requirement 5.13); the caller decides that.
export const checkWritesEnabled = (
  op: OperationRecord,
  settings: ChangeProposalSettings,
): Extract<
  FailureReason,
  'feature-disabled' | 'operation-type-disabled'
> | null => {
  if (!settings.isEnabled) {
    return 'feature-disabled';
  }
  return isCreatableType(op.type) && settings.enabledOperationTypes.has(op.type)
    ? null
    : 'operation-type-disabled';
};

export const isRequesterAllowed = (
  requester: IUserHasId | null,
): requester is IUserHasId =>
  requester != null &&
  requester.status === UserStatus.STATUS_ACTIVE &&
  !requester.readOnly;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Mirrors the canOperate arguments pageService passes for the same kind of write
// (create / renamePage / deletePage / revertDeletedPage). updatePage has no
// canOperate call of its own, so an edit is checked against the page's path.
const toPageOperationScope = (
  op: OperationRecord,
  page: PageFacts | null,
): PageOperationScope => {
  const fromPath = page?.path ?? null;
  switch (op.type) {
    case 'create':
      return [false, null, op.path];
    case 'move':
      return [(page?.descendantCount ?? 0) > 0, fromPath, op.toPath];
    case 'restore':
      return [false, fromPath, op.toPath];
    case 'edit':
    case 'trash':
      return [false, fromPath, null];
  }
};

const waitUntilOperable = async (
  canOperate: CanOperate,
  scope: PageOperationScope,
  wait: PageOperationWait,
): Promise<boolean> => {
  const deadline = Date.now() + wait.timeoutMs;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling until the overlapping operation ends
    if (await canOperate(...scope)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(wait.intervalMs);
  }
};

export type PageBlockerDeps = {
  readonly presenceSource: EditingPresenceSource;
  readonly canOperate: CanOperate;
  readonly wait: PageOperationWait;
};

const findPageFacts = (pageId: string): Promise<PageFacts | null> =>
  mongoose
    .model<PageDocument, PageModel>('Page')
    .findById(pageId, { path: 1, descendantCount: 1 })
    .lean<PageFacts>()
    .exec();

// Returns why the operation's page cannot be written now, or null when it can.
// A missing page is not a blocker: the handler reports it as target-unavailable.
export const findPageBlocker = async (
  op: OperationRecord,
  deps: PageBlockerDeps,
): Promise<WaitingReason | null> => {
  let page: PageFacts | null = null;
  if (op.type !== 'create') {
    const presence = await checkEditingPresence(deps.presenceSource, op.pageId);
    if (presence.isBeingEdited) {
      return 'page-being-edited';
    }
    page = await findPageFacts(op.pageId);
    if (page == null) {
      return null;
    }
  }
  const operable = await waitUntilOperable(
    deps.canOperate,
    toPageOperationScope(op, page),
    deps.wait,
  );
  return operable ? null : 'page-operation-in-progress';
};
