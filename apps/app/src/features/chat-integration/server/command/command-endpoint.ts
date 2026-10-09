// Handling the 5 commands the proxy sends over the `command` op (design.md
// `CommandEndpoint`): search / link-preview / help (task 5.1, read-only) and
// create-page / keep (task 5.2, writes -- see `performWriteCommand` below).
//
// Three invariants design.md states for `CommandEndpoint.handle`, all
// enforced here, in this order, before any command-specific work runs:
//
//   1. **Never throw.** Every path below returns a `CommandResponse`; the
//      one `try`/`catch` at the very top of `handle` is the backstop for a
//      genuinely unexpected failure (a bug, a DB outage), not a substitute
//      for handling the known cases below explicitly.
//   2. **Channel permission is judged first**, with `@growi/chat`'s `judge`,
//      before anything else -- including before resolving who the actor is.
//      A command this channel may not run gets refused without ever
//      touching `chat_account_links` or the search index (Requirement 11.3).
//   3. **A processed `(relationId, requestId)` replays its stored response
//      verbatim**, rather than recomputing (Requirement 10.4). This
//      includes a channel-permission refusal or a read-denial answer, not
//      only a "successful" one -- design.md draws no such exception, and
//      the proxy has no way to tell "this failed" from "this hasn't been
//      tried yet" apart from getting the same answer back both times.
//
// A response that reaches `chat_processed_requests` is deliberately never
// one produced by the top-level catch: an unexpected failure (a transient DB
// hiccup, a bug) is exactly the kind of outcome the proxy's retry SHOULD get
// a fresh attempt at, not the one answer entombed for 24 hours (task 1.2's
// TTL). Only a resolved, deliberate `CommandResponse` -- computed inside
// `computeResponse` -- is persisted.

import {
  type ChannelRef,
  type ChatAccountRef,
  COMMAND_NAMES,
  type CommandRequest,
  type CommandResponse,
  judge,
  type PermissionVerdict,
  RESPONSE_KINDS,
  type RelationSettings,
} from '@growi/chat';
import type { IUserHasId, PageGrant } from '@growi/core';
import { isCreatablePage } from '@growi/core/dist/utils/page-path-utils';
import mongoose from 'mongoose';
import urljoin from 'url-join';

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
import { growiInfoService } from '~/server/service/growi-info';
import loggerFactory from '~/utils/logger';

import {
  buildAccountLinkUrl,
  findOrCreatePendingAccountLinkOrder,
} from '../account-link/create-link-order';
import {
  buildConversationPageBody,
  buildHelpContent,
  buildLinkPreview,
  filterPagesForViewer,
  mapToSearchResultItems,
  overFetchCount,
  type ViewerFilterActor,
} from '../content';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { toWireAllowedChannels } from '../settings/allowed-channels';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import {
  type ResolvedActor,
  resolveActor,
  resolveReadDenial,
} from './resolve-actor';

const logger = loggerFactory(
  'growi:features:chat-integration:command-endpoint',
);

/**
 * The resolved GROWI user permitted to perform a write -- `ResolvedActor`'s
 * `user` field, narrowed to non-null. `resolveActor`/`handleWriteCommand`
 * below is what guarantees a value reaching `performWriteCommand` is never
 * null: `writeDenied` gates every path that would otherwise leave `user`
 * empty (not-linked, inactive) before it gets this far.
 */
type WriteActor = NonNullable<ResolvedActor['user']>;

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
 * Optional so the many read-only-command call sites (this file's own
 * `.spec.ts`, task 5.1's tests) do not need to fabricate one; a write
 * command reaching `handle` with no context still gets a (less precise, but
 * safe) `new Date()` fallback rather than throwing -- see `handle` below.
 */
export interface CommandAuditContext {
  readonly ip?: string;
  readonly endpoint?: string;
  readonly requestArrivedAt: Date;
}

export interface CommandEndpoint {
  handle(
    request: CommandRequest,
    auditContext?: CommandAuditContext,
  ): Promise<CommandResponse>;
}

/**
 * GROWI's `Activity` schema (`server/models/activity.ts`) has no
 * generic metadata/details field -- only `user` / `ip` / `endpoint` /
 * `targetModel` / `target` / `eventModel` / `event` / `action` / `snapshot`.
 * design.md's audit-logging section requires the row to retain "that this
 * came via chat, and the originating channel" (`CommandEnvelope.channel`,
 * task 5.3), and `endpoint` is the only free-form string available to carry
 * it -- appending a readable, parseable tag here is the least invasive
 * option; extending GROWI's core `Activity` model for one additional string
 * would be a much larger, unnecessary change for this task's boundary.
 *
 * `channelId` (not the mutable, display-only `channelName`) is the part
 * that must survive verbatim, matching `ChannelRef`'s own contract
 * (`packages/chat/src/contract/common.ts`: "must never be used for
 * matching/authorization decisions" applies to matching, not to recording,
 * but the identifier is still `channelId`, so that is what is recorded);
 * `channelName` is appended too, in parentheses, purely so a human reading
 * the row does not have to cross-reference the id.
 */
const CHAT_CHANNEL_TAG_PREFIX = 'chat-channel';

const withChatChannelTag = (
  endpoint: string | undefined,
  channel: ChannelRef,
): string =>
  `${endpoint ?? ''} ${CHAT_CHANNEL_TAG_PREFIX}=${channel.platform}:${channel.channelId} (${channel.channelName})`;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

type CommandErrorCode = Extract<
  CommandResponse,
  { kind: typeof RESPONSE_KINDS.error }
>['code'];

const errorResponse = (
  code: CommandErrorCode,
  message: string,
): CommandResponse => ({ kind: RESPONSE_KINDS.error, code, message });

const permissionDeniedResponse = (
  verdict: Extract<PermissionVerdict, { allowed: false }>,
): CommandResponse =>
  errorResponse(
    verdict.reason,
    verdict.reason === 'no-settings'
      ? 'This command has no channel permission configured for this connection yet.'
      : 'This command is not allowed in this channel.',
  );

/** design.md's "冒頭で `judge` を通す" (Requirement 11.3). */
const checkChannelPermission = async (
  request: CommandRequest,
): Promise<PermissionVerdict> => {
  const rows = await ChatChannelPermission.find({
    relationId: request.relationId,
  }).lean();

  const settings: RelationSettings = {
    relationId: request.relationId,
    channelPermissions: rows.map((row) => ({
      commandName: row.commandName,
      // Read through the shared translation, never straight off the row:
      // 'all'/'none' are stored as a scope with an empty channel list, so
      // taking `allowedChannels` at face value would turn "allowed
      // everywhere" into "allowed nowhere".
      allowedChannels: toWireAllowedChannels(row),
    })),
  };

  return judge(settings, request.kind, request.channel);
};

/**
 * design.md's read-denial guidance (Requirement 7.6): an inactive user is
 * already linked, so "go link your account" would change nothing for them;
 * only a genuinely unlinked chat account gets the account-link response.
 */
const buildReadDenialResponse = async (
  denial: 'not-linked' | 'inactive',
  relationId: string,
  actor: ChatAccountRef,
  crowi: Crowi,
): Promise<CommandResponse> => {
  if (denial === 'inactive') {
    return errorResponse(
      'forbidden',
      'Your GROWI user is currently unavailable. Contact your GROWI administrator.',
    );
  }

  const order = await findOrCreatePendingAccountLinkOrder(relationId, actor);
  return {
    kind: RESPONSE_KINDS.accountLinkRequired,
    growiLabel: crowi.appService.getAppTitle(),
    linkUrl: buildAccountLinkUrl(order.token),
  };
};

/** Candidate shape carried from the raw search hit through the viewer filter to the mapper. */
interface SearchCandidate {
  readonly pageId: string;
  readonly path: string;
  readonly updatedAt: Date;
  readonly commentCount: number;
}

const handleSearch = async (
  request: Extract<CommandRequest, { kind: typeof COMMAND_NAMES.search }>,
  resolved: ResolvedActor,
  crowi: Crowi,
): Promise<CommandResponse> => {
  if (!crowi.searchService.isReachable) {
    return errorResponse('invalid', 'Search is not available right now.');
  }

  // Gen 1's flaw (design.md's Testing Strategy item 2, task 3.3's own
  // hand-off note): `searchKeyword` reads an unresolved searcher as
  // `userGroups: null`, not `[]`. Passing `[]` here would silently change
  // "anonymous" into "a user with no groups", which is a different
  // permission shape to the search delegator.
  const userGroupsForSearch =
    resolved.user != null ? [...resolved.userGroups] : null;

  const [searchResult, delegatorName] = await crowi.searchService.searchKeyword(
    request.keyword,
    null,
    resolved.user,
    userGroupsForSearch,
    { limit: overFetchCount(request.limit), offset: 0 },
  );

  const formatted = await crowi.searchService.formatSearchResult(
    searchResult,
    delegatorName,
    resolved.user,
    userGroupsForSearch,
  );

  const candidates: SearchCandidate[] = formatted.data.map(({ data }) => ({
    pageId: data._id.toString(),
    path: data.path,
    updatedAt: data.updatedAt,
    commentCount: data.commentCount,
  }));

  const viewerActor: ViewerFilterActor = {
    user: resolved.user,
    userGroups: resolved.userGroups,
  };
  const filtered = await filterPagesForViewer(
    candidates,
    viewerActor,
    request.limit,
  );

  const items = mapToSearchResultItems(
    filtered.map((page) => ({
      rank: page.rank,
      path: page.path,
      updatedAt: page.updatedAt,
      commentCount: page.commentCount,
    })),
    growiInfoService.getSiteUrl(),
  );

  return {
    kind: RESPONSE_KINDS.search,
    items,
    appliedAs: resolved.user != null ? 'linked-user' : 'anonymous',
  };
};

/** A 24-hex Mongo ObjectId, matched the same way Gen 1's link-shared handler tells a permalink from a path. */
const PAGE_ID_PATTERN = /^[0-9a-f]{24}$/;

interface ResolvedLinkPreviewPage {
  readonly path: string;
  readonly grant: PageGrant | null | undefined;
  readonly body: string;
  readonly updatedAt: Date;
  readonly commentCount: number;
}

/**
 * `resolvePageFromUrl`'s result once a pathname could be extracted from the
 * pasted URL (design.md's `ResolvedUrlTarget`). `isPermalink` travels
 * alongside `page` -- rather than being re-derived later from `page` alone
 * -- so that a "not found" result still carries whether the URL was a
 * permalink (Requirement 6.8: an unresolvable permalink must be
 * indistinguishable from a resolved-but-private one).
 */
export interface ResolvedUrlTarget {
  /** Whether the trailing URL segment was a 24-hex-char permalink identifier, rather than a path. */
  readonly isPermalink: boolean;
  /** The resolved page, or null if no page matched. */
  readonly page: ResolvedLinkPreviewPage | null;
}

/**
 * Resolves a pasted GROWI URL to a page, keeping no view-permission filter
 * (design.md: authorization is decided later, by `buildLinkPreview`).
 *
 * Returns a top-level `null` ONLY when `pageUrl`'s pathname cannot be
 * extracted (an invalid URL) -- that path is unchanged from before this
 * function grew `isPermalink`. Once a pathname is extracted, this always
 * returns a `ResolvedUrlTarget`, even when no page matches (`page: null`).
 */
export const resolvePageFromUrl = async (
  pageUrl: string,
): Promise<ResolvedUrlTarget | null> => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(pageUrl).pathname);
  } catch (_error) {
    return null;
  }

  const maybeId = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const isPermalink = PAGE_ID_PATTERN.test(maybeId);
  const query = isPermalink ? { _id: maybeId } : { path: pathname };

  const Page = mongoose.model<PageDocument>('Page');
  const page = await Page.findOne(query).populate('revision').lean();
  if (page == null) {
    return { isPermalink, page: null };
  }

  const revision = page.revision as { body?: string } | null | undefined;

  return {
    isPermalink,
    page: {
      path: page.path,
      grant: page.grant,
      body: revision?.body ?? '',
      updatedAt: page.updatedAt,
      commentCount: page.commentCount,
    },
  };
};

const handleLinkPreview = async (
  request: Extract<CommandRequest, { kind: typeof COMMAND_NAMES.linkPreview }>,
  crowi: Crowi,
): Promise<CommandResponse> => {
  // `target === null` means `pageUrl`'s pathname could not even be
  // extracted (an invalid URL) -- unrelated to whether a page was found.
  const target = await resolvePageFromUrl(request.pageUrl);
  if (target == null) {
    return errorResponse(
      'invalid',
      'This URL does not match any page on this GROWI.',
    );
  }

  // `target` is passed through unchanged (design.md precondition for
  // buildLinkPreview). `buildLinkPreview` alone decides whether this
  // resolves to a real response or `null` -- it returns `null` only for a
  // path-form URL that matched no page (Requirement 6.8: a permalink that
  // matched no page must answer the same shape as a found-but-private one,
  // which buildLinkPreview handles internally).
  const preview = buildLinkPreview(
    target,
    crowi.aclService.isGuestAllowedToRead(),
  );
  if (preview == null) {
    return errorResponse(
      'invalid',
      'This URL does not match any page on this GROWI.',
    );
  }
  return { kind: RESPONSE_KINDS.linkPreview, ...preview };
};

/**
 * Performs a write command's page creation (`create-page` and `keep` both go
 * through this -- design.md: "書き込みを行うコマンド... はそのまま要る"),
 * checking permission and path conflict, and recording an Activity for every
 * outcome once past that point.
 *
 * `beginActivity` runs BEFORE the `isCreatablePage` / path-existence checks,
 * not after: by the time `performWriteCommand` is called, `resolveActor`
 * has already determined the actor is real and permitted to write
 * (`handleWriteCommand` gates `writeDenied` before this function is ever
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
 * Requirements: 4.2, 4.5, 4.6, 5.2.
 */
const performWriteCommand = async (params: {
  readonly path: string;
  readonly actor: WriteActor;
  readonly crowi: Crowi;
  readonly auditContext: CommandAuditContext;
  readonly buildBody: () => Promise<string>;
  readonly importedMessageCount?: number;
}): Promise<CommandResponse> => {
  const { path, actor, crowi, auditContext, buildBody, importedMessageCount } =
    params;

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
    response: CommandResponse,
  ): Promise<CommandResponse> => {
    // `recordFailsafeAttempt` normally fires from `registerFailsafeFinalizer`,
    // watching `res`'s status code -- this endpoint always answers 200, so
    // that path never triggers, and this is called directly instead
    // (design.md: "失敗した書き込み（path-conflict など）は
    // ACTION_UNSETTLED として残す").
    await recordFailsafeAttempt(activityId, context);
    return response;
  };

  try {
    if (!isCreatablePage(path)) {
      return await respondWithFailedAttempt(
        errorResponse(
          'forbidden',
          'This path is reserved and cannot be used for a page.',
        ),
      );
    }

    const Page = mongoose.model<PageDocument>('Page');
    const alreadyExists = (await Page.exists({ path, isEmpty: false })) != null;
    if (alreadyExists) {
      return await respondWithFailedAttempt(
        errorResponse('path-conflict', 'A page already exists at this path.'),
      );
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
      {},
    );

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
      kind: RESPONSE_KINDS.created,
      pageUrl: urljoin(growiInfoService.getSiteUrl(), createdPage.path),
      ...(importedMessageCount != null ? { importedMessageCount } : {}),
    };
  } catch (error) {
    // An unexpected failure (e.g. pageService.create's own grant validation)
    // by a resolved, permitted actor -- same "failed write attempt" bucket
    // as path-conflict above.
    logger.error('Failed to create a page for a chat write command', error);
    return await respondWithFailedAttempt(
      errorResponse(
        'forbidden',
        'Could not create the page (insufficient permission, or an unexpected error).',
      ),
    );
  } finally {
    // Unconditional: emit already took the context via
    // `pendingActivityContext.take()` on the success path, making this a
    // no-op there; on every other path this is what actually clears it.
    // Skipping this would leak the entry for the life of the process
    // (`pending-activity-context.ts`: no time-based sweep).
    pendingActivityContext.clear(activityId);
  }
};

const handleCreatePage = (
  request: Extract<CommandRequest, { kind: typeof COMMAND_NAMES.createPage }>,
  actor: WriteActor,
  crowi: Crowi,
  auditContext: CommandAuditContext,
): Promise<CommandResponse> =>
  performWriteCommand({
    path: request.path,
    actor,
    crowi,
    auditContext,
    buildBody: async () => request.body,
  });

const handleKeep = (
  request: Extract<CommandRequest, { kind: typeof COMMAND_NAMES.keep }>,
  actor: WriteActor,
  crowi: Crowi,
  auditContext: CommandAuditContext,
): Promise<CommandResponse> =>
  performWriteCommand({
    path: request.path,
    actor,
    crowi,
    auditContext,
    // design.md "会話の取り込み": the page body is built from the imported
    // messages, resolving each speaker's GROWI username in one batched
    // query (task 4.3) -- NOT from `actor`, who only ran the `keep` command
    // and may not be quoted in the transcript at all.
    buildBody: () =>
      buildConversationPageBody(request.relationId, request.messages),
    importedMessageCount: request.messages.length,
  });

/**
 * `create-page` / `keep` share 3 requirements with every other write
 * (design.md: "書き込みを行うコマンド... はそのまま要る"): the permission
 * judgment `resolveActor` already makes, the path-conflict pre-check, and
 * idempotent resend -- the last of which `handleWithIdempotency` below
 * already gives every command kind, write or not.
 *
 * `resolveActor`'s `writeDenied` gates ALL writes (design.md invariant):
 * `user: null` (not-linked / inactive) reuses `buildReadDenialResponse`'s
 * exact denial mapping (Requirement 7.6's account-link guidance for
 * not-linked, the "currently unavailable" message for inactive); a resolved
 * but read-only user is refused with `forbidden`. Neither refusal reaches
 * `performWriteCommand`, so neither creates an Activity row (design.md:
 * "断った要求... は記録しない").
 */
const handleWriteCommand = async (
  request: Extract<
    CommandRequest,
    { kind: typeof COMMAND_NAMES.createPage | typeof COMMAND_NAMES.keep }
  >,
  crowi: Crowi,
  auditContext: CommandAuditContext,
): Promise<CommandResponse> => {
  const resolved = await resolveActor(request.relationId, request.actor);

  if (resolved.user == null) {
    // `writeDenied` is always 'not-linked' or 'inactive' when `user` is
    // null (resolve-actor.ts never returns `user: null` with `writeDenied:
    // 'read-only'` or `null`).
    const denial =
      resolved.writeDenied === 'inactive' ? 'inactive' : 'not-linked';
    return buildReadDenialResponse(
      denial,
      request.relationId,
      request.actor,
      crowi,
    );
  }
  if (resolved.writeDenied === 'read-only') {
    return errorResponse(
      'forbidden',
      'Your GROWI user is read-only and cannot create pages.',
    );
  }

  // Fold the originating channel into the audit context's `endpoint` here,
  // once, for both write commands (design.md: "チャット経由であることと
  // 発言元のチャンネルを残す") -- see `withChatChannelTag` above for why
  // `endpoint` is where this goes.
  const auditContextWithChannel: CommandAuditContext = {
    ...auditContext,
    endpoint: withChatChannelTag(auditContext.endpoint, request.channel),
  };

  if (request.kind === COMMAND_NAMES.createPage) {
    return handleCreatePage(
      request,
      resolved.user,
      crowi,
      auditContextWithChannel,
    );
  }
  return handleKeep(request, resolved.user, crowi, auditContextWithChannel);
};

const computeResponse = async (
  request: CommandRequest,
  crowi: Crowi,
  auditContext: CommandAuditContext,
): Promise<CommandResponse> => {
  const verdict = await checkChannelPermission(request);
  if (!verdict.allowed) {
    return permissionDeniedResponse(verdict);
  }

  if (request.kind === COMMAND_NAMES.help) {
    return { kind: RESPONSE_KINDS.help, commands: buildHelpContent() };
  }

  if (
    request.kind === COMMAND_NAMES.createPage ||
    request.kind === COMMAND_NAMES.keep
  ) {
    return handleWriteCommand(request, crowi, auditContext);
  }

  const resolved = await resolveActor(request.relationId, request.actor);
  const denial = resolveReadDenial(
    resolved,
    crowi.aclService.isGuestAllowedToRead(),
  );
  if (denial != null) {
    return buildReadDenialResponse(
      denial,
      request.relationId,
      request.actor,
      crowi,
    );
  }

  if (request.kind === COMMAND_NAMES.search) {
    return handleSearch(request, resolved, crowi);
  }
  return handleLinkPreview(request, crowi);
};

/**
 * Runs `computeResponse`, replaying a previously-stored response verbatim
 * for a repeated `(relationId, requestId)` instead of recomputing
 * (Requirement 10.4). The unique index on `chat_processed_requests` --
 * not a read-then-write -- is what makes this safe against two identical
 * requests in flight at once: both call `create`, at most one succeeds, and
 * the other reads back what the winner just stored.
 */
const handleWithIdempotency = async (
  request: CommandRequest,
  crowi: Crowi,
  auditContext: CommandAuditContext,
): Promise<CommandResponse> => {
  const { relationId, requestId } = request;

  const alreadyProcessed = await ChatProcessedRequest.findOne({
    relationId,
    requestId,
  }).lean();
  if (alreadyProcessed != null) {
    return alreadyProcessed.response as CommandResponse;
  }

  const response = await computeResponse(request, crowi, auditContext);

  try {
    await ChatProcessedRequest.create({ relationId, requestId, response });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const winner = await ChatProcessedRequest.findOne({
        relationId,
        requestId,
      }).lean();
      if (winner != null) {
        return winner.response as CommandResponse;
      }
    }
    throw error;
  }

  return response;
};

/** Builds the `CommandEndpoint` this GROWI serves `command` requests with. */
export const createCommandEndpoint = (crowi: Crowi): CommandEndpoint => ({
  handle: async (
    request: CommandRequest,
    auditContext?: CommandAuditContext,
  ): Promise<CommandResponse> => {
    try {
      return await handleWithIdempotency(
        request,
        crowi,
        auditContext ?? { requestArrivedAt: new Date() },
      );
    } catch (error) {
      logger.error('Unexpected failure while handling a chat command', error);
      return errorResponse(
        'invalid',
        'Failed to process this command due to an unexpected error.',
      );
    }
  },
});
