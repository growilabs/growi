import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { IActivity, SupportedActionType } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';
import type CommentService from '~/server/service/comment';
import type { PrismaClient } from '~/utils/prisma';

import type { InlineCommentServiceDeps } from './inline-comment-service';
import { InlineCommentService } from './inline-comment-service';

// ---------------------------------------------------------------------------
// Test helpers
//
// Row/result fixtures below mirror the real `comments`/`pages` Prisma models
// (prisma/schema.prisma) rather than a hand-written subset — the service
// under test is now typed directly against the generated `PrismaClient`
// (see inline-comment-service.ts), so a fixture missing a real column would
// not be a meaningful stand-in for what Prisma actually returns.
// ---------------------------------------------------------------------------

function makeId(): string {
  return new Types.ObjectId().toString();
}

type CommentsRow =
  ReturnType<PrismaClient['comments']['create']> extends Promise<infer R>
    ? R
    : never;
type PagesRow =
  ReturnType<PrismaClient['pages']['create']> extends Promise<infer R>
    ? R
    : never;

function makePageRow(overrides: Partial<PagesRow> = {}): PagesRow {
  const now = new Date();
  return {
    id: makeId(),
    v: 0,
    commentCount: 0,
    createdAt: now,
    creatorId: null,
    deletedAt: null,
    deleteUserId: null,
    descendantCount: 0,
    expandContentWidth: null,
    grant: 1,
    grantedGroups: null,
    grantedUsers: [],
    isEmpty: false,
    lastUpdateUserId: null,
    latestRevisionBodyLength: null,
    liker: [],
    parentId: null,
    path: '/test-page',
    revisionId: null,
    seenUsers: [],
    status: 'published',
    ttlTimestamp: null,
    updatedAt: now,
    wip: null,
    ...overrides,
  } as PagesRow;
}

function makeCommentRow(overrides: Partial<CommentsRow> = {}): CommentsRow {
  const now = new Date();
  return {
    id: makeId(),
    v: 0,
    pageId: makeId(),
    creatorId: makeId(),
    revisionId: null,
    comment: 'nice point',
    commentPosition: -1,
    replyToId: null,
    createdAt: now,
    updatedAt: now,
    isInline: true,
    quote: null,
    prefix: null,
    suffix: null,
    approxOffset: null,
    anchorOriginRevisionId: null,
    resolvedById: null,
    resolvedAt: null,
    ...overrides,
  } as CommentsRow;
}

/** An origin (anchored) inline comment row, as `create()` inserts it. */
function makeCreatedRow(
  overrides: Partial<CommentsRow> & { page?: Partial<PagesRow> } = {},
) {
  const { page, ...rest } = overrides;
  const row = makeCommentRow({
    quote: 'the quoted text',
    prefix: 'preceding context',
    suffix: 'following context',
    approxOffset: 10,
    anchorOriginRevisionId: makeId(),
    ...rest,
  });
  return { ...row, page: makePageRow({ id: row.pageId, ...page }) };
}

/** A reply row, as `createReply()` inserts it (no `page` relation included). */
function makeReplyRow(overrides: Partial<CommentsRow> = {}): CommentsRow {
  return makeCommentRow({
    comment: 'thanks for pointing this out',
    replyToId: makeId(),
    ...overrides,
  });
}

/** An origin (anchored) inline comment row, as `listByPageId()`'s `findMany()` reads it back (no `page` relation). */
function makeOriginRow(overrides: Partial<CommentsRow> = {}): CommentsRow {
  return makeCommentRow({
    quote: 'the quoted text',
    prefix: 'preceding context',
    suffix: 'following context',
    approxOffset: 10,
    anchorOriginRevisionId: makeId(),
    replyToId: null,
    ...overrides,
  });
}

/** The `findUnique` row used to validate a `createReply()` `parentId`. */
function makeParentRow(
  overrides: Partial<CommentsRow> & { page?: Partial<PagesRow> } = {},
) {
  const { page, ...rest } = overrides;
  const row = makeCommentRow({
    isInline: true,
    replyToId: null,
    ...rest,
  });
  return { ...row, page: makePageRow({ id: row.pageId, ...page }) };
}

/** A minimal `IActivity` — the real declared return shape of `createByParameters`. */
function makeActivity(
  action: SupportedActionType = SupportedAction.ACTION_INLINE_COMMENT_CREATE,
): IActivity {
  return { action, createdAt: new Date() };
}

type PickedCommentService = Pick<CommentService, 'prepareMentionNotifications'>;

/**
 * Builds a fully-mocked `InlineCommentServiceDeps` whose happy-path calls
 * resolve immediately, `prisma.comments.create` resolving with `createdRow`.
 */
function makeDeps(
  createdRow: ReturnType<typeof makeCreatedRow>,
): InlineCommentServiceDeps {
  const prisma = mock<PrismaClient>({
    comments: {
      create: vi.fn().mockResolvedValue(createdRow),
      findUnique: vi.fn(),
    },
    activities: {
      createByParameters: vi.fn().mockResolvedValue(makeActivity()),
    },
  });
  const commentService = mock<PickedCommentService>({
    prepareMentionNotifications: vi.fn().mockResolvedValue({
      generatePreNotify: vi.fn(),
      notify: vi.fn().mockResolvedValue(undefined),
    }),
  });
  return { prisma, commentService };
}

/**
 * Builds a fully-mocked `InlineCommentServiceDeps` for `createReply()`
 * happy-path calls: `findUnique` resolves with `parentRow` (an eligible
 * origin comment) and `create` resolves with `replyRow`.
 */
function makeReplyDeps(
  parentRow: ReturnType<typeof makeParentRow>,
  replyRow: CommentsRow,
): InlineCommentServiceDeps {
  const prisma = mock<PrismaClient>({
    comments: {
      findUnique: vi.fn().mockResolvedValue(parentRow),
      create: vi.fn().mockResolvedValue(replyRow),
    },
    activities: {
      createByParameters: vi.fn().mockResolvedValue(makeActivity()),
    },
  });
  const commentService = mock<PickedCommentService>({
    prepareMentionNotifications: vi.fn().mockResolvedValue({
      generatePreNotify: vi.fn(),
      notify: vi.fn().mockResolvedValue(undefined),
    }),
  });
  return { prisma, commentService };
}

/**
 * Builds a fully-mocked `InlineCommentServiceDeps` for `setResolved()`:
 * `findUnique` resolves with `targetRow` (the precondition check's lookup)
 * and `update` resolves with `updatedRow`.
 */
function makeSetResolvedDeps(
  targetRow: CommentsRow | null,
  updatedRow: CommentsRow,
): InlineCommentServiceDeps {
  const prisma = mock<PrismaClient>({
    comments: {
      findUnique: vi.fn().mockResolvedValue(targetRow),
      update: vi.fn().mockResolvedValue(updatedRow),
    },
    activities: {
      createByParameters: vi.fn().mockResolvedValue(makeActivity()),
    },
  });
  const commentService = mock<PickedCommentService>({});
  return { prisma, commentService };
}

/**
 * Builds a fully-mocked `InlineCommentServiceDeps` for `listByPageId()`:
 * `findMany` is stubbed to answer the origin-comment query with
 * `originRows` and the replies query with `replyRows`, distinguished by
 * `where.replyToId` (`null` for origins, `{ in: [...] }` for replies) —
 * mirroring the two distinct `findMany` calls `listByPageId()` makes.
 */
function makeListDeps(
  originRows: CommentsRow[],
  replyRows: CommentsRow[] = [],
): InlineCommentServiceDeps {
  const prisma = mock<PrismaClient>({
    comments: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        if (where.replyToId === null) {
          return Promise.resolve(originRows);
        }
        return Promise.resolve(replyRows);
      }),
    },
  });
  const commentService = mock<PickedCommentService>({});
  return { prisma, commentService };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InlineCommentService.create', () => {
  it('保存されるクオート・前後文脈は選択時の原文のまま正規化されない（結合文字を含むケース）', async () => {
    // "é" as "e" + U+0301 COMBINING ACUTE ACCENT — NFC-normalizing this
    // string changes it to a single U+00E9 codepoint, so this reliably
    // detects an unwanted `.normalize()` call anywhere in the write path.
    // Written as explicit \u escapes (base letter + combining mark) — a
    // plain literal here risks being silently NFC-normalized by tooling
    // (editors, some file-write paths) before it ever reaches the test.
    const decomposedQuote = 'éclair';
    const decomposedPrefix = 'á la carte ';
    const decomposedSuffix = ' menu item';

    const pageId = makeId();
    const creatorId = makeId();
    const anchorOriginRevisionId = makeId();

    const createdRow = makeCreatedRow({
      pageId,
      creatorId,
      anchorOriginRevisionId,
      quote: decomposedQuote,
      prefix: decomposedPrefix,
      suffix: decomposedSuffix,
    });
    const deps = makeDeps(createdRow);
    const service = new InlineCommentService(deps);

    const result = await service.create(
      {
        pageId,
        anchorOriginRevisionId,
        comment: 'nice point',
        anchor: {
          quote: decomposedQuote,
          prefix: decomposedPrefix,
          suffix: decomposedSuffix,
          approxOffset: 5,
        },
      },
      creatorId,
    );

    // What was actually sent to persistence must be byte-for-byte the
    // original decomposed form.
    const createArgs = vi.mocked(deps.prisma.comments.create).mock
      .calls[0][0] as {
      data: { quote: string; prefix: string; suffix: string };
    };
    expect(createArgs.data.quote).toBe(decomposedQuote);
    expect(createArgs.data.prefix).toBe(decomposedPrefix);
    expect(createArgs.data.suffix).toBe(decomposedSuffix);
    expect(createArgs.data.quote.normalize('NFC')).not.toBe(
      createArgs.data.quote,
    );

    // And the returned domain object reflects the same unnormalized values.
    expect(result.anchor.quote).toBe(decomposedQuote);
    expect(result.anchor.prefix).toBe(decomposedPrefix);
    expect(result.anchor.suffix).toBe(decomposedSuffix);
  });

  it('クオートが空文字の場合はエラーとし、永続化を一切呼び出さない', async () => {
    const createdRow = makeCreatedRow();
    const deps = makeDeps(createdRow);
    const service = new InlineCommentService(deps);

    await expect(
      service.create(
        {
          pageId: makeId(),
          anchorOriginRevisionId: makeId(),
          comment: 'x',
          anchor: { quote: '', prefix: '', suffix: '', approxOffset: 0 },
        },
        makeId(),
      ),
    ).rejects.toThrow();

    expect(deps.prisma.comments.create).not.toHaveBeenCalled();
    expect(deps.prisma.activities.createByParameters).not.toHaveBeenCalled();
    expect(
      deps.commentService.prepareMentionNotifications,
    ).not.toHaveBeenCalled();
  });

  it('作成時に渡された anchorOriginRevisionId をそのまま設定する', async () => {
    const anchorOriginRevisionId = makeId();
    const pageId = makeId();
    const creatorId = makeId();
    const createdRow = makeCreatedRow({
      pageId,
      creatorId,
      anchorOriginRevisionId,
    });
    const deps = makeDeps(createdRow);
    const service = new InlineCommentService(deps);

    const result = await service.create(
      {
        pageId,
        anchorOriginRevisionId,
        comment: 'x',
        anchor: { quote: 'q', prefix: 'p', suffix: 's', approxOffset: 0 },
      },
      creatorId,
    );

    const createArgs = vi.mocked(deps.prisma.comments.create).mock
      .calls[0][0] as {
      data: { anchorOriginRevisionId: string };
    };
    expect(createArgs.data.anchorOriginRevisionId).toBe(anchorOriginRevisionId);
    expect(result.anchorOriginRevisionId).toBe(anchorOriginRevisionId);
  });

  it('挿入する data に replyToId: null を明示的に含める（省略しない）', async () => {
    // Regression test for a real defect found while wiring the apiv3 routes
    // (task 3.5): omitting `replyToId` here leaves the field entirely absent
    // on the underlying MongoDB document (rather than stored as `null`), and
    // Prisma's MongoDB connector's `where: { replyToId: null }` filter —
    // exactly what listByPageId() uses to select origin comments — does not
    // match a document where the field is absent. A mock can't reproduce
    // that Mongo-connector-specific null-vs-absent distinction (this test
    // only locks the field-presence contract so it can't silently regress
    // again); the real regression coverage for the Mongo semantics lives in
    // list.integ.ts's "lists only the isInline:true origin comments..." test
    // (real DB, no mocks).
    const createdRow = makeCreatedRow();
    const deps = makeDeps(createdRow);
    const service = new InlineCommentService(deps);

    await service.create(
      {
        pageId: makeId(),
        anchorOriginRevisionId: makeId(),
        comment: 'x',
        anchor: { quote: 'q', prefix: 'p', suffix: 's', approxOffset: 0 },
      },
      makeId(),
    );

    const createArgs = vi.mocked(deps.prisma.comments.create).mock
      .calls[0][0] as { data: { replyToId?: string | null } };
    expect(createArgs.data).toHaveProperty('replyToId');
    expect(createArgs.data.replyToId).toBeNull();
  });

  it('Activity レコードを発行してから prepareMentionNotifications を呼び出す', async () => {
    const createdRow = makeCreatedRow();
    const deps = makeDeps(createdRow);

    const callOrder: string[] = [];
    vi.mocked(deps.prisma.activities.createByParameters).mockImplementation(
      () => {
        callOrder.push('activity-created');
        return Promise.resolve(makeActivity());
      },
    );
    vi.mocked(
      deps.commentService.prepareMentionNotifications,
    ).mockImplementation(() => {
      callOrder.push('prepare-mention-notifications');
      return Promise.resolve({
        generatePreNotify: vi.fn(),
        notify: vi.fn().mockResolvedValue(undefined),
      });
    });

    const service = new InlineCommentService(deps);
    await service.create(
      {
        pageId: createdRow.pageId,
        anchorOriginRevisionId: createdRow.anchorOriginRevisionId as string,
        comment: 'x',
        anchor: { quote: 'q', prefix: 'p', suffix: 's', approxOffset: 0 },
      },
      createdRow.creatorId as string,
    );

    expect(callOrder).toEqual([
      'activity-created',
      'prepare-mention-notifications',
    ]);
  });

  it('作成した Activity の id を prepareMentionNotifications に渡す', async () => {
    const createdRow = makeCreatedRow();
    const deps = makeDeps(createdRow);

    const service = new InlineCommentService(deps);
    await service.create(
      {
        pageId: createdRow.pageId,
        anchorOriginRevisionId: createdRow.anchorOriginRevisionId as string,
        comment: 'x',
        anchor: { quote: 'q', prefix: 'p', suffix: 's', approxOffset: 0 },
      },
      createdRow.creatorId as string,
    );

    // The activity id is minted by the service (createByParameters' real
    // declared return type carries no `id`), so the id it sent as the
    // create-payload's `id` field is what must reach
    // prepareMentionNotifications — not anything read off the return value.
    const [sentActivityParams] = vi.mocked(
      deps.prisma.activities.createByParameters,
    ).mock.calls[0];
    const [, , passedActivityId] = vi.mocked(
      deps.commentService.prepareMentionNotifications,
    ).mock.calls[0];
    expect(passedActivityId.toString()).toBe(sentActivityParams.id);
  });
});

describe('InlineCommentService.createReply', () => {
  it('返信でないコメントID（起点コメント自体ではない）を親に指定するとエラーになり、永続化を一切呼び出さない', async () => {
    // Covers all three "not an origin comment" shapes the precondition
    // rejects: a regular non-inline comment, a reply's own id, and a
    // nonexistent id — each must fail the same way.
    const nonOriginParents: (ReturnType<typeof makeParentRow> | null)[] = [
      makeParentRow({ isInline: false, replyToId: null }), // regular comment
      makeParentRow({ isInline: true, replyToId: makeId() }), // a reply itself
      null, // nonexistent id
    ];

    await Promise.all(
      nonOriginParents.map(async (parentRow) => {
        const prisma = mock<PrismaClient>({
          comments: {
            findUnique: vi.fn().mockResolvedValue(parentRow),
            create: vi.fn(),
          },
          activities: { createByParameters: vi.fn() },
        });
        const commentService = mock<PickedCommentService>({
          prepareMentionNotifications: vi.fn(),
        });
        const service = new InlineCommentService({ prisma, commentService });

        await expect(
          service.createReply({ parentId: makeId(), comment: 'x' }, makeId()),
        ).rejects.toThrow();

        expect(prisma.comments.create).not.toHaveBeenCalled();
        expect(prisma.activities.createByParameters).not.toHaveBeenCalled();
        expect(
          commentService.prepareMentionNotifications,
        ).not.toHaveBeenCalled();
      }),
    );
  });

  it('起点コメントへの返信を作成すると、アンカー関連フィールドを持たず isInline: true・replyToId が親IDの行として永続化される', async () => {
    const parentId = makeId();
    const pageId = makeId();
    const creatorId = makeId();
    const parentRow = makeParentRow({ id: parentId, pageId });
    const replyRow = makeReplyRow({ pageId, creatorId, replyToId: parentId });
    const deps = makeReplyDeps(parentRow, replyRow);
    const service = new InlineCommentService(deps);

    const result = await service.createReply(
      { parentId, comment: replyRow.comment },
      creatorId,
    );

    const createArgs = vi.mocked(deps.prisma.comments.create).mock
      .calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data).toMatchObject({
      pageId,
      creatorId,
      comment: replyRow.comment,
      isInline: true,
      replyToId: parentId,
    });
    // No anchor-related field is present on the insert payload — the
    // returned domain object mirrors this by not carrying anchor fields at
    // all (design.md Postconditions, requirement 1.9).
    expect(createArgs.data).not.toHaveProperty('quote');
    expect(createArgs.data).not.toHaveProperty('prefix');
    expect(createArgs.data).not.toHaveProperty('suffix');
    expect(createArgs.data).not.toHaveProperty('approxOffset');
    expect(createArgs.data).not.toHaveProperty('anchorOriginRevisionId');
    // No `page` relation is requested on the reply insert — see
    // inline-comment-service.ts's createReply() doc.
    expect(createArgs).not.toHaveProperty('include');

    expect(result).toEqual({
      id: replyRow.id,
      pageId,
      creatorId,
      comment: replyRow.comment,
      replyToId: parentId,
      createdAt: replyRow.createdAt,
      updatedAt: replyRow.updatedAt,
    });
  });

  it('返信作成先のページIDは親コメントのpageIdを用いる（リクエスト側からは受け取らない）', async () => {
    const parentId = makeId();
    const parentPageId = makeId();
    const parentRow = makeParentRow({ id: parentId, pageId: parentPageId });
    const replyRow = makeReplyRow({
      pageId: parentPageId,
      replyToId: parentId,
    });
    const deps = makeReplyDeps(parentRow, replyRow);
    const service = new InlineCommentService(deps);

    await service.createReply({ parentId, comment: 'x' }, makeId());

    const createArgs = vi.mocked(deps.prisma.comments.create).mock
      .calls[0][0] as {
      data: { pageId: string };
    };
    expect(createArgs.data.pageId).toBe(parentPageId);
  });

  it('Activity レコードを発行してから prepareMentionNotifications を呼び出す', async () => {
    const parentId = makeId();
    const parentRow = makeParentRow({ id: parentId });
    const replyRow = makeReplyRow({
      pageId: parentRow.pageId,
      replyToId: parentId,
    });

    const deps = makeReplyDeps(parentRow, replyRow);

    const callOrder: string[] = [];
    vi.mocked(deps.prisma.activities.createByParameters).mockImplementation(
      () => {
        callOrder.push('activity-created');
        return Promise.resolve(
          makeActivity(SupportedAction.ACTION_INLINE_COMMENT_REPLY),
        );
      },
    );
    vi.mocked(
      deps.commentService.prepareMentionNotifications,
    ).mockImplementation(() => {
      callOrder.push('prepare-mention-notifications');
      return Promise.resolve({
        generatePreNotify: vi.fn(),
        notify: vi.fn().mockResolvedValue(undefined),
      });
    });

    const service = new InlineCommentService(deps);
    await service.createReply({ parentId, comment: 'x' }, makeId());

    expect(callOrder).toEqual([
      'activity-created',
      'prepare-mention-notifications',
    ]);
  });
});

describe('InlineCommentService.listByPageId', () => {
  it('起点コメントに、対応する返信をネストした配列として、双方とも作成日時順に並べて返す', async () => {
    const pageId = makeId();
    const now = Date.now();

    // Two origin comments, newest first — the order listByPageId must
    // preserve at the top level.
    const originNewer = makeOriginRow({
      pageId,
      comment: 'origin newer',
      createdAt: new Date(now),
    });
    const originOlder = makeOriginRow({
      pageId,
      comment: 'origin older',
      createdAt: new Date(now - 10_000),
    });

    // Two replies to originOlder, newest first — the order listByPageId
    // must preserve within that origin's nested `replies` array. A reply to
    // originNewer confirms replies are matched to the correct parent, not
    // just concatenated.
    const replyToOlderNewer = makeReplyRow({
      pageId,
      comment: 'reply to older, newer',
      replyToId: originOlder.id,
      createdAt: new Date(now - 1_000),
    });
    const replyToOlderOlder = makeReplyRow({
      pageId,
      comment: 'reply to older, older',
      replyToId: originOlder.id,
      createdAt: new Date(now - 5_000),
    });
    const replyToNewer = makeReplyRow({
      pageId,
      comment: 'reply to newer',
      replyToId: originNewer.id,
      createdAt: new Date(now - 500),
    });

    const deps = makeListDeps(
      [originNewer, originOlder],
      [replyToOlderNewer, replyToOlderOlder, replyToNewer],
    );
    const service = new InlineCommentService(deps);

    const result = await service.listByPageId(pageId);

    expect(result.map((c) => c.comment)).toEqual([
      'origin newer',
      'origin older',
    ]);
    expect(
      result
        .find((c) => c.id === originNewer.id)
        ?.replies.map((r) => r.comment),
    ).toEqual(['reply to newer']);
    expect(
      result
        .find((c) => c.id === originOlder.id)
        ?.replies.map((r) => r.comment),
    ).toEqual(['reply to older, newer', 'reply to older, older']);

    // The nested-order assertions above only prove the assembly step
    // preserves whatever order `findMany` happens to return — they say
    // nothing about whether the service actually asked Prisma to sort by
    // `createdAt`. Assert on the query arguments directly (requirement
    // 2.6), the same way create()'s tests inspect `.mock.calls[0][0].data`
    // for requirement 1.4.
    const findManyCalls = vi.mocked(deps.prisma.comments.findMany).mock.calls;
    const originCall = findManyCalls.find(
      (call) => call[0]?.where?.replyToId === null,
    );
    const replyCall = findManyCalls.find((call) => {
      const replyToId = call[0]?.where?.replyToId;
      return replyToId != null && typeof replyToId === 'object';
    });
    expect(originCall?.[0]?.orderBy).toEqual({ createdAt: 'desc' });
    expect(replyCall?.[0]?.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('返信を持たない起点コメントは空の replies 配列を返す（undefined/null にはしない）', async () => {
    const pageId = makeId();
    const originRow = makeOriginRow({ pageId, comment: 'no replies here' });
    const deps = makeListDeps([originRow], []);
    const service = new InlineCommentService(deps);

    const result = await service.listByPageId(pageId);

    expect(result).toHaveLength(1);
    expect(result[0].replies).toEqual([]);
  });

  it('ページにインラインコメントが1件もない場合は空配列を返し、返信の取得は行わない', async () => {
    const deps = makeListDeps([], []);
    const service = new InlineCommentService(deps);

    const result = await service.listByPageId(makeId());

    expect(result).toEqual([]);
    // Only the origin-comment query ran — no wasted second round trip when
    // there is nothing to look up replies for.
    expect(deps.prisma.comments.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('InlineCommentService.setResolved', () => {
  it('未解決の起点コメントを解決済みにすると、操作者と日時を記録し ACTION_INLINE_COMMENT_RESOLVE の Activity を発行する', async () => {
    const id = makeId();
    const actorId = makeId();
    const targetRow = makeOriginRow({
      id,
      resolvedById: null,
      resolvedAt: null,
    });
    const updatedRow = makeOriginRow({
      id,
      pageId: targetRow.pageId,
      resolvedById: actorId,
      resolvedAt: new Date(),
    });
    const deps = makeSetResolvedDeps(targetRow, updatedRow);
    const service = new InlineCommentService(deps);

    const result = await service.setResolved(id, true, actorId);

    const updateArgs = vi.mocked(deps.prisma.comments.update).mock
      .calls[0][0] as { where: { id: string }; data: Record<string, unknown> };
    expect(updateArgs.where).toEqual({ id });
    expect(updateArgs.data.resolvedById).toBe(actorId);
    expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);

    expect(result.resolvedById).toBe(actorId);
    expect(result.resolvedAt).toBeInstanceOf(Date);

    const [activityParams] = vi.mocked(
      deps.prisma.activities.createByParameters,
    ).mock.calls[0];
    expect(activityParams.action).toBe(
      SupportedAction.ACTION_INLINE_COMMENT_RESOLVE,
    );
    expect(activityParams.user).toBe(actorId);

    // Unlike create()/createReply(), the resolve toggle does not kick off
    // mention notifications — see setResolved()'s doc for why (design.md's
    // Requirements Traceability table lists no notification integration for
    // requirements 4.1-4.4).
    expect(
      deps.commentService.prepareMentionNotifications,
    ).not.toHaveBeenCalled();
  });

  it('解決済みの起点コメントを未解決に戻すと、resolvedById・resolvedAt を両方 null に戻し ACTION_INLINE_COMMENT_UNRESOLVE の Activity を発行する', async () => {
    const id = makeId();
    const actorId = makeId();
    const targetRow = makeOriginRow({
      id,
      resolvedById: makeId(),
      resolvedAt: new Date(),
    });
    const updatedRow = makeOriginRow({
      id,
      pageId: targetRow.pageId,
      resolvedById: null,
      resolvedAt: null,
    });
    const deps = makeSetResolvedDeps(targetRow, updatedRow);
    const service = new InlineCommentService(deps);

    const result = await service.setResolved(id, false, actorId);

    const updateArgs = vi.mocked(deps.prisma.comments.update).mock
      .calls[0][0] as { where: { id: string }; data: Record<string, unknown> };
    expect(updateArgs.data.resolvedById).toBeNull();
    expect(updateArgs.data.resolvedAt).toBeNull();

    expect(result.resolvedById).toBeNull();
    expect(result.resolvedAt).toBeNull();

    const [activityParams] = vi.mocked(
      deps.prisma.activities.createByParameters,
    ).mock.calls[0];
    expect(activityParams.action).toBe(
      SupportedAction.ACTION_INLINE_COMMENT_UNRESOLVE,
    );
  });

  it('未解決→解決→未解決と状態遷移できる（1つの行に対する2回の呼び出しの連鎖として検証する）', async () => {
    const id = makeId();
    const actorId = makeId();

    // A single mutable row backs both findUnique and update across both
    // calls, so the second call genuinely observes the first call's write —
    // not two independent, pre-scripted mocks that happen to assert the same
    // things as the two tests above.
    let row = makeOriginRow({ id, resolvedById: null, resolvedAt: null });

    const prisma = mock<PrismaClient>({
      comments: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(row)),
        update: vi.fn().mockImplementation(({ data }) => {
          row = { ...row, ...data };
          return Promise.resolve(row);
        }),
      },
      activities: {
        createByParameters: vi.fn().mockResolvedValue(makeActivity()),
      },
    });
    const commentService = mock<PickedCommentService>({});
    const service = new InlineCommentService({ prisma, commentService });

    const resolvedResult = await service.setResolved(id, true, actorId);
    expect(resolvedResult.resolvedById).toBe(actorId);
    expect(resolvedResult.resolvedAt).not.toBeNull();

    const unresolvedResult = await service.setResolved(id, false, actorId);
    expect(unresolvedResult.resolvedById).toBeNull();
    expect(unresolvedResult.resolvedAt).toBeNull();
  });

  it('起点コメントでないID（通常コメント／返信自身／存在しないID）を指定するとエラーになり、永続化を一切呼び出さない', async () => {
    // Mirrors createReply()'s precondition test above — the same three
    // non-origin shapes must all be rejected here too.
    const nonOriginTargets: (CommentsRow | null)[] = [
      makeOriginRow({ isInline: false, replyToId: null }), // regular comment
      makeOriginRow({ replyToId: makeId() }), // a reply itself
      null, // nonexistent id
    ];

    await Promise.all(
      nonOriginTargets.map(async (targetRow) => {
        const deps = makeSetResolvedDeps(targetRow, makeOriginRow());
        const service = new InlineCommentService(deps);

        await expect(
          service.setResolved(makeId(), true, makeId()),
        ).rejects.toThrow();

        expect(deps.prisma.comments.update).not.toHaveBeenCalled();
        expect(
          deps.prisma.activities.createByParameters,
        ).not.toHaveBeenCalled();
      }),
    );
  });
});
