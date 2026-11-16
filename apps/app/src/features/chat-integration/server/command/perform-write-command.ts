// Page creation for the chat commands that write (`create-page`, and the
// summary page of `agent`): the reserved-path and path-conflict gates, the
// creation itself, and the audit record of every attempt.

import type { IUserHasId, PageGrant } from '@growi/core';
import { isCreatablePage } from '@growi/core/dist/utils/page-path-utils';
import mongoose from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
// `service/activity.ts` (a legacy file) shadows the `service/activity/`
// directory's barrel -- `~/server/service/activity` alone resolves to that
// file, not `index.ts`. Explicit `/index` is required (see
// `~/server/middlewares/add-activity.ts` for the same pattern).
import {
  beginActivity,
  type PendingActivityContext,
  pendingActivityContext,
  recordFailsafeAttempt,
} from '~/server/service/activity/index';
import loggerFactory from '~/utils/logger';

import type { ResolvedActor } from './resolve-actor';

const logger = loggerFactory(
  'growi:features:chat-integration:perform-write-command',
);

/**
 * The request-time facts `beginActivity`'s context needs that only the
 * Express layer has (`req.ip` / `req.originalUrl`) or that must be captured
 * before any async work runs (`requestArrivedAt`). `peer-router.ts`'s
 * `commandHandler` captures `requestArrivedAt = new Date()` as the very
 * first statement of the request, before even reading `chatPeer.body`, and
 * passes it through here -- design.md is explicit that the Activity row's
 * `createdAt` must be the request's arrival time, not whenever `handle`
 * happens to reach the write-command branch deep inside `computeResponse`.
 *
 * Optional at `CommandEndpoint.handle` so the many read-only-command call
 * sites (`command-endpoint.spec.ts`, task 5.1's tests) do not need to
 * fabricate one; a write command reaching `handle` with no context still
 * gets a (less precise, but safe) `new Date()` fallback rather than
 * throwing -- see `handle` in `command-endpoint.ts`.
 */
export interface CommandAuditContext {
  readonly ip?: string;
  readonly endpoint?: string;
  readonly requestArrivedAt: Date;
}

/**
 * The resolved GROWI user permitted to perform a write -- `ResolvedActor`'s
 * `user` field, narrowed to non-null. `resolveActor`/`resolveWriter` (in
 * `command-endpoint.ts`) is what guarantees a value reaching
 * `performWriteCommand` is never null: `writeDenied` gates every path that
 * would otherwise leave `user` empty (not-linked, inactive) before it gets
 * this far.
 */
export type WriteActor = NonNullable<ResolvedActor['user']>;

export interface PageCreateOptions {
  readonly wip?: boolean;
  readonly grant?: PageGrant;
}

export type WriteCommandResult =
  | {
      readonly kind: 'created';
      readonly pageId: string;
      readonly path: string;
    }
  | { readonly kind: 'path-conflict' }
  | {
      readonly kind: 'forbidden';
      /** `create-failed` covers GROWI refusing the creation (grant validation) and unexpected errors alike. */
      readonly reason: 'reserved-path' | 'create-failed';
    };

/**
 * Performs a write command's page creation (design.md: "書き込みを行うコマンド...
 * はそのまま要る"),
 * checking permission and path conflict, and recording an Activity for every
 * outcome once past that point.
 *
 * `beginActivity` runs BEFORE the `isCreatablePage` / path-existence checks,
 * not after: by the time `performWriteCommand` is called, `resolveActor`
 * has already determined the actor is real and permitted to write
 * (`resolveWriter` gates `writeDenied` before this function is ever
 * reached) -- so `isCreatablePage` failing and a path conflict are both
 * "the handler's own validation, run for an authenticated operator", the
 * same category `activity-recording.md`'s Rule 2 records as
 * `ACTION_UNSETTLED` for a normal apiv3 route (validators/handler errors
 * that run after `addActivity`). Only `writeDenied` (not-linked / inactive /
 * read-only -- resolved before this function runs) is the "no operator yet"
 * category that skips recording (design.md: "断った要求... は記録しない").
 *
 * `isCreatablePage` is the one gate GROWI's own `determinePath` applies that
 * `pageService.create` itself does not (design.md's "既存の機能を呼ぶだけ
 * では要件を満たせない" > "ページ作成"). The path-existence check runs
 * BEFORE `pageService.create`, so a duplicate answers with a DISTINCT
 * `path-conflict` code rather than being routed through
 * `pageService.create`'s generic `Error('Cannot process create')`, which
 * does not distinguish "path taken" from any other failure
 * (design.md: "他の失敗と区別できない").
 *
 * `createOptions` is passed to `pageService.create` as is; without it the
 * page gets `pageService.create`'s defaults (`create-page`).
 * `clearWipExpiry` removes the auto-delete expiry `pageService.create` puts on
 * a WIP page (research.md: "要約のページは、作った直後に自動削除の期限を外す").
 *
 * Requirements: 4.2, 4.5, 4.6, 5.9, 5.11, 5.18.
 */
export const performWriteCommand = async (params: {
  readonly path: string;
  readonly actor: WriteActor;
  readonly crowi: Crowi;
  readonly auditContext: CommandAuditContext;
  readonly buildBody: () => Promise<string>;
  readonly createOptions?: PageCreateOptions;
  readonly clearWipExpiry?: boolean;
}): Promise<WriteCommandResult> => {
  const {
    path,
    actor,
    crowi,
    auditContext,
    buildBody,
    createOptions,
    clearWipExpiry,
  } = params;

  const context: PendingActivityContext = {
    ip: auditContext.ip,
    endpoint: auditContext.endpoint,
    userId: actor._id.toString(),
    username: actor.username,
    createdAt: auditContext.requestArrivedAt,
  };
  const { activityId } = beginActivity(context);

  // Every path below this point had `beginActivity` already called for it,
  // so every one of them must end in either an emit (success) or this
  // failsafe record (failure) -- this small helper is what keeps that
  // invariant from being restated (and risking drift) at each call site.
  const respondWithFailedAttempt = async (
    result: WriteCommandResult,
  ): Promise<WriteCommandResult> => {
    // `recordFailsafeAttempt` normally fires from `registerFailsafeFinalizer`,
    // watching `res`'s status code -- this endpoint always answers 200, so
    // that path never triggers, and this is called directly instead
    // (design.md: "失敗した書き込み（path-conflict など）は
    // ACTION_UNSETTLED として残す").
    await recordFailsafeAttempt(activityId, context);
    return result;
  };

  try {
    if (!isCreatablePage(path)) {
      return await respondWithFailedAttempt({
        kind: 'forbidden',
        reason: 'reserved-path',
      });
    }

    const Page = mongoose.model<PageDocument>('Page');
    const alreadyExists = (await Page.exists({ path, isEmpty: false })) != null;
    if (alreadyExists) {
      return await respondWithFailedAttempt({ kind: 'path-conflict' });
    }

    const body = await buildBody();
    // `pageService.create` declares `user: HasObjectId` (`_id: string`), but
    // every real caller -- including every apiv3 route's `req.user` -- passes
    // a Mongoose document whose `_id` is actually a `Types.ObjectId`; the
    // `Express.Request.user` augmentation types it as `IUserHasId` anyway
    // (see `create-page.ts`'s own `req.user: IUserHasId`). Same cast, same
    // reason: no type expresses "a hydrated document, but with `_id`
    // widened to `string`" without a much larger shim.
    const createdPage = await crowi.pageService.create(
      path,
      body,
      actor as unknown as IUserHasId,
      { ...createOptions },
    );

    if (clearWipExpiry) {
      await removeWipExpiry(createdPage._id);
    }

    // Emit before returning the response -- the intent of
    // `activity-recording.md` Rule 1 (emit before `res.apiv3()`) applied to
    // an endpoint with no `res` of its own: nothing may run between this
    // emit and the caller handing the response back that could let the
    // context be cleared first.
    crowi.events.activity.emit('update', activityId, {
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: createdPage,
      action: SupportedAction.ACTION_PAGE_CREATE,
      contributor: actor,
    });

    return {
      kind: 'created',
      pageId: createdPage._id.toString(),
      path: createdPage.path,
    };
  } catch (error) {
    // An unexpected failure (e.g. pageService.create's own grant validation)
    // by a resolved, permitted actor -- same "failed write attempt" bucket
    // as path-conflict above.
    logger.error('Failed to create a page for a chat write command', error);
    return await respondWithFailedAttempt({
      kind: 'forbidden',
      reason: 'create-failed',
    });
  } finally {
    // Unconditional: emit already took the context via
    // `pendingActivityContext.take()` on the success path, making this a
    // no-op there; on every other path this is what actually clears it.
    // Skipping this would leak the entry for the life of the process
    // (`pending-activity-context.ts`: no time-based sweep).
    pendingActivityContext.clear(activityId);
  }
};

/**
 * The state `unpublish()` leaves (`wip` stays true, no expiry), written with
 * one atomic update rather than a `save()` of the populated document.
 *
 * A failure here is logged, not returned: the page already exists, so
 * answering "not created" would be false, and a retry would only meet a
 * path conflict.
 */
const removeWipExpiry = async (pageId: PageDocument['_id']): Promise<void> => {
  try {
    await mongoose
      .model<PageDocument>('Page')
      .updateOne({ _id: pageId, wip: true }, { $unset: { wipExpiredAt: 1 } });
  } catch (error) {
    logger.error(
      'Created a WIP page but could not remove its auto-delete expiry',
      error,
    );
  }
};
