// `InboundFlow` -- the four things a GROWI asks this proxy to do
// (design.md's 「GROWI から届く口」): post a notification, take a settings
// push, register a peer key, revoke a peer key.
//
// **The HTTP edge is not here.** Verifying the signature, reading the raw
// bytes, running the body through `@growi/chat`'s parse function and checking
// the envelope's `relationId`/`op` against the key the signature resolved to
// all belong to `routes/`. Every request below arrives already verified and
// already parsed, as a plain value. Re-parsing here would be a second, weaker
// copy of a boundary that is unambiguous.
//
// The three decisions this file holds:
//
//  - **A notification destination is judged from the saved channel inventory
//    alone**, never by asking the chat service when the notification arrives.
//    design.md is explicit about why: a compromised GROWI that could make
//    this proxy call out per notification could drive it into the chat
//    service's rate limit and decide the judgement from outside. The
//    inventory is refreshed on this proxy's own schedule (`ChannelDirectory`),
//    and that is the only material read here.
//  - **Three answers are kept apart, because they ask the operator to do
//    three different things**: the channel is not this workspace's
//    (`channel-not-in-installation`), the bot has not been invited to it
//    (`bot-not-in-channel`, which only `post()` can report), and the
//    inventory has never been fetched (`inventory-not-ready`).
//  - **A retry posts only where the first attempt failed.** The record is per
//    destination, so a destination that already succeeded is skipped -- and
//    still reported, because the answer always covers the whole of the
//    original `targets` list.
//  - **The answer is bounded in time, per destination and as a whole.** A
//    destination that goes quiet is answered `timeout` and the next one is
//    started; once the whole request's budget is gone, the destinations left
//    are answered `timeout` without being posted to at all. This is what
//    `NotificationResult`'s `timeout` was declared for -- 「宛先が多いときに
//    GROWI の 1 リクエストが待たされないよう proxy 側にも締め切りを設ける」 --
//    and without it one unresponsive chat service holds GROWI's request open
//    for as long as it stays quiet.
import type {
  KeyOperationResult,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  NotificationRequest,
  NotificationResult,
  SettingsPushRequest,
} from '@growi/chat';
import {
  isValidKeyIdShape,
  isValidPublicKeyMaterial,
  judgeKeyRevocation,
} from '@growi/chat/server';

import {
  type InventoryIndex,
  indexInventory,
  resolveNotificationTarget,
} from '../capabilities/index.js';
import {
  createChannelPermissionRepository,
  createInstallationChannelRepository,
  createInstallationRepository,
  createPeerKeyRepository,
  createProcessedNotificationRepository,
  createRelationRepository,
  type PermittedChannels,
  type PrismaClient,
} from '../db/index.js';
import type { PlatformFacade } from '../platform/index.js';
import type {
  OutboundMessage,
  SdkChannelRef,
  SecretCipher,
} from '../types/index.js';

/**
 * The one facade operation an inbound request uses. Narrowed with `Pick` for
 * the reason `CommandFlowPlatform` is: a reader can see from the type alone
 * that nothing a GROWI sends can make this proxy open a modal, read a
 * channel's history or list its channels.
 */
export type InboundFlowPlatform = Pick<PlatformFacade, 'post'>;

export interface InboundFlowDeps {
  /**
   * The client rather than a `DbClient`: a settings push OPENS the
   * transaction that moves the version and the permission rows together,
   * which a transaction handle cannot do. Same reason as
   * `PairingServiceDeps.db`.
   */
  readonly db: PrismaClient;
  /**
   * Asked for only by `createInstallationRepository`'s signature, which
   * encrypts and decrypts the `credentials` column. Nothing here reads
   * credentials -- the only installation fact this file wants is
   * `channelsSyncedAt` -- so it is never called. (`UnpairServiceDeps.cipher`
   * carries the same note for the same reason.)
   */
  readonly cipher: SecretCipher;
  readonly platform: InboundFlowPlatform;
  readonly now?: () => Date;
  /** See {@link PROCESSED_NOTIFICATION_TTL_MS}. */
  readonly processedNotificationTtlMs?: number;
  /** See {@link NOTIFICATION_TARGET_TIMEOUT_MS}. */
  readonly notificationTargetTimeoutMs?: number;
  /** See {@link NOTIFICATION_DEADLINE_MS}. */
  readonly notificationDeadlineMs?: number;
}

export interface InboundFlow {
  /**
   * Posts one notification to every destination of the relation, and answers
   * for every destination in the request -- including ones an earlier attempt
   * already posted to. design.md: 「応答は常に `targets` 全件ぶんを返し、前回
   * `posted` だった宛先はその結果をそのまま載せる」.
   *
   * Bounded in time twice over: a destination that does not answer within
   * {@link NOTIFICATION_TARGET_TIMEOUT_MS} is answered `timeout` and the next
   * one is started, and once {@link NOTIFICATION_DEADLINE_MS} has passed the
   * destinations left are answered `timeout` without being posted to. Both
   * caps are overridable through `InboundFlowDeps`.
   */
  notify(request: NotificationRequest): Promise<NotificationResult>;
  /** Takes a settings push, or discards it as older than what is stored. */
  pushSettings(request: SettingsPushRequest): Promise<void>;
  registerPeerKey(request: KeyRegistrationRequest): Promise<KeyOperationResult>;
  revokePeerKey(request: KeyRevocationRequest): Promise<KeyOperationResult>;
}

/**
 * How long a per-destination notification record is kept.
 *
 * design.md declares no number. It has to outlive GROWI's retries -- the
 * record is the only thing that stops a retry posting twice -- and there is
 * nothing to gain from keeping it longer, since a request id is never reused
 * after its outbox row is settled. A week covers a GROWI that was down over a
 * weekend and comes back retrying.
 */
export const PROCESSED_NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long one destination's post may take before it is answered `timeout`.
 *
 * **Reporting `timeout` for a post that in fact landed costs a duplicate
 * message**: the call is abandoned, never cancelled, so a late success still
 * reaches the channel while GROWI -- which retries everything that is not
 * `posted` -- posts there a second time. That asymmetry is why this cap is
 * generous rather than tight: posting to a chat service normally answers well
 * inside a second, so three seconds is far past "slow" and only reached by a
 * service that has actually gone quiet.
 */
export const NOTIFICATION_TARGET_TIMEOUT_MS = 3_000;

/**
 * How long the whole `notify()` call may take before the destinations left
 * are answered `timeout` unposted.
 *
 * **No GROWI-side wait cap for this request is written down anywhere**; the
 * only number either spec states is the umbrella's 10 second search deadline
 * (Gen 1's `REQUEST_TIMEOUT_FOR_GTOP`). This sits under it, so the answer is
 * back before a GROWI holding to that same figure would stop listening -- and
 * a GROWI that gives up first loses the whole answer, including the
 * destinations that did succeed, since the record of those lives in its own
 * outbox row.
 */
export const NOTIFICATION_DEADLINE_MS = 8_000;

type NotificationTarget = NotificationRequest['targets'][number];
type NotificationOutcome = NotificationResult['outcomes'][number];
type NotificationStatus = NotificationOutcome['status'];

/** What every destination of one notification is posted with. */
interface NotificationPosting {
  readonly message: OutboundMessage;
  /**
   * The relation's installation. A notification is handled outside any chat
   * event, so nothing else tells the platform layer whose bot speaks.
   */
  readonly installationId: string;
}

/** `(platform, channelId)`, as one comparable value. */
const destinationKey = (platform: string, channelId: string): string =>
  `${platform} ${channelId}`;

/**
 * What a post that ran out of time resolves to. A sentinel rather than a
 * rejection for the reason `growi/fan-out-collector.ts` gives for its own:
 * running out of time is an ordinary outcome, not a failure, and rejecting
 * would send it down whatever path a genuine exception takes.
 *
 * The shape below is that module's deliberately, and is deliberately not
 * shared with it. Its wait cap is one part of a bounded-concurrency pool
 * built around `GrowiClient` and `Relation`, and neither half fits here:
 * posting is sequential on purpose (a burst is what a chat service's rate
 * limit answers to), and what this needs on top -- a budget for the request
 * AS A WHOLE, which stops later destinations from being started at all --
 * has no counterpart there. Exporting a `Promise.race` out of the `growi/`
 * layer, whose subject is talking to GROWI rather than posting to chat, would
 * tie two unrelated mechanisms together to save a dozen lines.
 */
const TIMED_OUT = Symbol('notification deadline reached');

const withDeadline = async <T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
      }),
    ]);
  } finally {
    // On every path, including the one where the post won: a timer left
    // running holds the process awake for the rest of the cap.
    clearTimeout(timer);
  }
};

export const createInboundFlow = (deps: InboundFlowDeps): InboundFlow => {
  const { db, platform, cipher } = deps;
  const now = deps.now ?? (() => new Date());
  const ttlMs =
    deps.processedNotificationTtlMs ?? PROCESSED_NOTIFICATION_TTL_MS;
  const targetTimeoutMs =
    deps.notificationTargetTimeoutMs ?? NOTIFICATION_TARGET_TIMEOUT_MS;
  const deadlineMs = deps.notificationDeadlineMs ?? NOTIFICATION_DEADLINE_MS;

  const relations = createRelationRepository(db);
  const installations = createInstallationRepository(db, cipher);
  const installationChannels = createInstallationChannelRepository(db);
  const processed = createProcessedNotificationRepository(db);
  const peerKeys = createPeerKeyRepository(db);

  // -------------------------------------------------------------------------
  // notification
  // -------------------------------------------------------------------------

  /**
   * Whether this destination may be posted to, and why not when it may not.
   *
   * `bot-not-in-channel` is deliberately NOT among the answers: the saved
   * inventory records which channels exist, never which of them the bot was
   * invited to, so only `post()` can report that. Producing it from here
   * would be a guess, and it is the one answer an operator can act on.
   */
  const judgeDestination = (
    inventory: InventoryIndex | null,
    target: NotificationTarget,
  ):
    | { readonly ok: true; readonly channel: SdkChannelRef }
    | {
        readonly ok: false;
        readonly status: Exclude<
          NotificationStatus,
          'posted' | 'bot-not-in-channel' | 'timeout'
        >;
        readonly detail?: string;
      } => {
    // The channel posted to is the inventory row the target was judged
    // against, so what is posted to is exactly what was permitted.
    const resolved = resolveNotificationTarget(inventory, target);
    switch (resolved.kind) {
      case 'found':
        return { ok: true, channel: resolved.channel };
      case 'inventory-not-ready':
        // Answering `channel-not-in-installation` here would send the
        // operator off to re-create a channel that exists and is fine.
        return { ok: false, status: 'inventory-not-ready' };
      case 'not-in-installation':
        return { ok: false, status: 'channel-not-in-installation' };
      case 'unaddressable':
        return {
          ok: false,
          status: 'platform-error',
          detail: `${target.platform} channels cannot be posted to from a notification yet`,
        };
    }
  };

  const outcomeOfPost = (
    target: NotificationTarget,
    channel: SdkChannelRef,
    { message, installationId }: NotificationPosting,
  ): Promise<NotificationOutcome> =>
    platform.post(channel, message, { installationId }).then((posted) => {
      if (posted.ok) {
        return { ...target, status: 'posted' as const };
      }
      // `bot-not-in-channel` can only arrive here: the saved inventory records
      // which channels exist, never which of them the bot was invited to.
      return posted.reason === 'bot-not-in-channel'
        ? { ...target, status: posted.reason, remedy: posted.remedy }
        : { ...target, status: posted.reason, detail: posted.detail };
    });

  /**
   * The same post, given up on after `budgetMs`. The abandoned call is not
   * cancelled -- nothing in `PlatformFacade` can call a post off -- so a post
   * answered `timeout` here may still reach the channel afterwards.
   */
  const outcomeOfPostWithin = async (
    target: NotificationTarget,
    channel: SdkChannelRef,
    posting: NotificationPosting,
    budgetMs: number,
  ): Promise<NotificationOutcome> => {
    const posted = await withDeadline(
      outcomeOfPost(target, channel, posting),
      budgetMs,
    );
    return posted === TIMED_OUT ? { ...target, status: 'timeout' } : posted;
  };

  return {
    notify: async (request) => {
      // Taken before the reads below, not after them, so the time they take
      // is charged against the budget rather than free -- what this bounds is
      // a destination that goes quiet, not the reads themselves: none of
      // `relations.findById`, `installations.findById`,
      // `processed.findAllForRequest`, `judgeDestination` or `upsertTarget`
      // is itself wrapped in a deadline.
      //
      // **Two clocks in one function, on purpose.** The records are stamped
      // with `deps.now()`, which a caller may pin to a fixed instant, while
      // the budget is elapsed wall time -- a pinned clock would make the
      // budget never run out.
      const deadlineAt = Date.now() + deadlineMs;

      const relation = await relations.findById(request.relationId);
      if (relation == null) {
        // The signature named this relation moments ago, so it was removed in
        // between. Reported per destination like everything else rather than
        // thrown: GROWI records the answer, and an exception would leave it
        // with nothing to record.
        return {
          outcomes: request.targets.map((target) => ({
            ...target,
            status: 'platform-error' as const,
            detail: 'this relation no longer exists',
          })),
        };
      }

      const installation = await installations.findById(
        relation.installationId,
      );
      // Read once for the whole request: every destination is judged against
      // the same inventory. `null` when it has never been taken.
      const inventory =
        installation?.channelsSyncedAt == null
          ? null
          : indexInventory(
              await installationChannels.listByInstallation(
                relation.installationId,
              ),
            );

      const already = new Map(
        (
          await processed.findAllForRequest(
            relation.relationId,
            request.requestId,
          )
        ).map((record) => [
          destinationKey(record.platform, record.channelId),
          record,
        ]),
      );

      const posting: NotificationPosting = {
        message: { kind: 'markdown', markdown: request.markdown },
        installationId: relation.installationId,
      };
      const at = now();
      const expiresAt = new Date(at.getTime() + ttlMs);

      const outcomes: NotificationOutcome[] = [];
      for (const target of request.targets) {
        const previous = already.get(
          destinationKey(target.platform, target.channelId),
        );
        if (previous?.status === 'posted') {
          // Answered from the record without posting again. Dropping it from
          // the answer instead would erase the earlier success when GROWI
          // writes the result back into its outbox row.
          outcomes.push({ ...target, status: 'posted' });
          continue;
        }

        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
          // Not posted to at all, and no record written -- see below for why
          // a timeout leaves nothing behind.
          outcomes.push({ ...target, status: 'timeout' });
          continue;
        }

        const verdict = judgeDestination(inventory, target);
        // The smaller of the two budgets: without it, a destination started
        // just inside the deadline could still run the whole per-destination
        // cap past it, which is exactly the overshoot the request-wide budget
        // exists to prevent.
        const budgetForPost = Math.min(
          targetTimeoutMs,
          deadlineAt - Date.now(),
        );
        // Re-checked so a destination the deadline has already caught is
        // answered `timeout` WITHOUT starting `post()` -- `outcomeOfPostWithin`
        // cannot cancel a call once made (see its own doc comment), so a post
        // started with a near-zero or negative budget would still actually go
        // out and then be answered `timeout` regardless, which is the exact
        // duplicate-post risk this deadline exists to bound, not merely to
        // report on.
        const outcome: NotificationOutcome =
          verdict.ok && budgetForPost > 0
            ? // biome-ignore lint/performance/noAwaitInLoops: one destination at a time on purpose -- a burst of posts is what a chat service's rate limit answers to, and the answers are reported in the request's own order.
              await outcomeOfPostWithin(
                target,
                verdict.channel,
                posting,
                budgetForPost,
              )
            : verdict.ok
              ? { ...target, status: 'timeout' }
              : verdict.detail === undefined
                ? { ...target, status: verdict.status }
                : { ...target, status: verdict.status, detail: verdict.detail };
        outcomes.push(outcome);

        if (outcome.status === 'timeout') {
          // **A timeout writes no record.** A record says what is known about
          // a destination, and a post that went quiet leaves nothing known:
          // it may yet land, or never have arrived. The one thing the record
          // must never say is `posted`, since that is what a retry skips --
          // and the write itself is work done after the budget already ran
          // out, on behalf of a destination GROWI is about to retry anyway.
          continue;
        }

        await processed.upsertTarget({
          relationId: relation.relationId,
          requestId: request.requestId,
          platform: target.platform,
          channelId: target.channelId,
          status: outcome.status satisfies NotificationStatus,
          detail: outcome.remedy ?? outcome.detail ?? null,
          processedAt: at,
          expiresAt,
        });
      }

      return { outcomes };
    },

    // -----------------------------------------------------------------------
    // settings-push
    // -----------------------------------------------------------------------

    pushSettings: async (request) => {
      await db.$transaction(async (tx) => {
        const relationsTx = createRelationRepository(tx);
        // The version guard is the first thing inside the transaction, and the
        // rows are written only when it answered `true`: a push that is not
        // newer than what is stored changes nothing at all. Doing this as a
        // read followed by a write would let two pushes that both read the old
        // version both write, and the later-finishing one would win regardless
        // of its version.
        const isNewer = await relationsTx.bumpSettingsVersionIfNewer(
          request.relationId,
          request.version,
        );
        if (!isNewer) {
          return;
        }

        const permissions = createChannelPermissionRepository(tx);
        // GROWI sends the whole settings object every time, so a command whose
        // row is absent from the push is a permission that was REMOVED.
        // Upserting only what arrived would leave the removed one in force.
        await permissions.deleteByRelation(request.relationId);
        for (const row of request.settings.channelPermissions) {
          // `'none'` is stored as the empty list: `judge()` reaches the same
          // verdict from either, so a second spelling of one state would be
          // two representations to keep in step. `'all'` cannot be folded that
          // way -- the empty list already means its opposite -- so it travels
          // as itself.
          const stored: PermittedChannels =
            row.allowedChannels === 'all'
              ? 'all'
              : row.allowedChannels === 'none'
                ? []
                : row.allowedChannels;
          // biome-ignore lint/performance/noAwaitInLoops: one unit of work; the rows are written in the order they arrived.
          await permissions.upsert(
            request.relationId,
            row.commandName,
            stored,
            {
              allowedInDirectMessage: row.allowedInDirectMessage === true,
            },
          );
        }
      });
    },

    // -----------------------------------------------------------------------
    // keys
    // -----------------------------------------------------------------------

    registerPeerKey: async (request) => {
      // `JsonWebKey` is an interface, so it has no index signature and is not
      // assignable to the `Record<string, unknown>` the judgement reads. The
      // cast changes no value; `peer-key-repository` casts the same field for
      // the same reason.
      const material = isValidPublicKeyMaterial(
        request.key.publicKeyJwk as Record<string, unknown>,
      );
      if (!material.ok) {
        return { status: 'rejected', reason: 'invalid-key' };
      }
      if (!isValidKeyIdShape(request.key.keyId)) {
        // `:` separates the two halves of the signature header's `keyid`. A
        // keyId carrying one is accepted here but unresolvable later, and
        // every signed request from that GROWI is then refused with no visible
        // reason.
        return { status: 'rejected', reason: 'invalid-key' };
      }
      if (Number.isNaN(new Date(request.key.validFrom).getTime())) {
        return { status: 'rejected', reason: 'invalid-key' };
      }

      // Idempotent by the `(relation_id, key_id)` unique key: registering the
      // same key twice changes nothing and answers `ok` (design.md's
      // duplicate-handling table for this endpoint).
      await peerKeys.register(request.relationId, request.key);
      return { status: 'ok' };
    },

    // **Known gap: two revocations that overlap can still reach zero valid
    // keys.** This reads, judges, then writes, with nothing held in between,
    // so two `key-revoke-to-proxy` requests arriving together at a relation
    // with exactly two valid keys each see two, each judge that one remains,
    // and both revoke -- leaving the relation with no key to verify its
    // GROWI's signatures against, which is unrecoverable without editing the
    // database. The settings version's answer (make the comparison a
    // condition on the update) does not transfer: the judgement is
    // `@growi/chat`'s pure function and has no `WHERE`-clause form.
    //
    // What WOULD close it needs nothing new in `db/`: `deps.db` is a full
    // `PrismaClient`, so wrapping the read, the judgement and the write in
    // `db.$transaction(fn, { isolationLevel: 'Serializable' })` -- the same
    // `$transaction` call `pushSettings` above makes, with the isolation
    // level added on top (its own transaction runs at the default level,
    // which its plain conditional-update guard does not need) -- would have
    // PostgreSQL itself abort one of the two conflicting transactions with a
    // serialization failure (SQLSTATE `40001`).
    //
    // It is left out because the two things that would have to catch that
    // abort do not exist yet: **nothing in this codebase retries a `40001`**,
    // and `routes/` (task 8.x) is not built, so there is nowhere to turn one
    // into an answer the calling GROWI can act on. Adding the wrapper alone
    // would trade a rare silent race for a rare error that no one handles.
    // A later task must add the wrapper AND the retry-and-report handling
    // together -- until it does, this is not production-safe. See tasks.md's
    // note for 7.3.
    revokePeerKey: async (request) => {
      const at = now();
      // The judgement is `@growi/chat`'s, not this file's: GROWI runs the same
      // function over its own copy of the key list, and two implementations of
      // 「有効な鍵が 0 本になる要求は断る」 would be free to disagree -- with
      // the looser one deciding.
      const judgement = judgeKeyRevocation(
        await peerKeys.listKeys(request.relationId),
        request.keyId,
        at.toISOString(),
      );
      if (!judgement.ok) {
        return { status: 'rejected', reason: judgement.reason };
      }

      await peerKeys.revoke(
        { relationId: request.relationId, keyId: request.keyId },
        at,
      );
      return { status: 'ok' };
    },
  };
};
