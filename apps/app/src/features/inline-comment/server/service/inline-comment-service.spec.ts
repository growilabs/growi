import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep } from 'vitest-mock-extended';

import type {
  InlineCommentCreateResult,
  InlineCommentServiceDeps,
} from './inline-comment-service';
import { InlineCommentService } from './inline-comment-service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  return new Types.ObjectId().toString();
}

function makeCreatedRow(
  overrides: Partial<InlineCommentCreateResult> = {},
): InlineCommentCreateResult {
  const now = new Date();
  return {
    id: makeId(),
    pageId: makeId(),
    creatorId: makeId(),
    comment: 'nice point',
    quote: 'the quoted text',
    prefix: 'preceding context',
    suffix: 'following context',
    approxOffset: 10,
    anchorOriginRevisionId: makeId(),
    resolvedById: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    page: { id: makeId(), path: '/test-page' },
    ...overrides,
  };
}

/**
 * Builds a fully-mocked `InlineCommentServiceDeps` whose happy-path calls
 * resolve immediately, `prisma.comments.create` resolving with `createdRow`.
 */
function makeDeps(
  createdRow: InlineCommentCreateResult,
): DeepMockProxy<InlineCommentServiceDeps> {
  const deps = mockDeep<InlineCommentServiceDeps>();
  deps.prisma.comments.create.mockResolvedValue(createdRow);
  deps.prisma.activities.createByParameters.mockResolvedValue({
    id: makeId(),
  });
  deps.commentService.prepareMentionNotifications.mockResolvedValue({
    generatePreNotify: vi.fn(),
    notify: vi.fn().mockResolvedValue(undefined),
  });
  return deps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InlineCommentService.create', () => {
  it('保存されるクオート・前後文脈は選択時の原文のまま正規化されない（結合文字を含むケース）', async () => {
    // "é" as "e" + U+0301 COMBINING ACUTE ACCENT — NFC-normalizing this
    // string changes it to a single U+00E9 codepoint, so this reliably
    // detects an unwanted `.normalize()` call anywhere in the write path.
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
    const createArgs = deps.prisma.comments.create.mock.calls[0][0];
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

    const createArgs = deps.prisma.comments.create.mock.calls[0][0];
    expect(createArgs.data.anchorOriginRevisionId).toBe(anchorOriginRevisionId);
    expect(result.anchorOriginRevisionId).toBe(anchorOriginRevisionId);
  });

  it('Activity レコードを発行してから prepareMentionNotifications を呼び出す', async () => {
    const createdRow = makeCreatedRow();
    const deps = mockDeep<InlineCommentServiceDeps>();
    deps.prisma.comments.create.mockResolvedValue(createdRow);

    const callOrder: string[] = [];
    deps.prisma.activities.createByParameters.mockImplementation(() => {
      callOrder.push('activity-created');
      return Promise.resolve({ id: makeId() });
    });
    deps.commentService.prepareMentionNotifications.mockImplementation(() => {
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
    const activityId = makeId();
    deps.prisma.activities.createByParameters.mockResolvedValue({
      id: activityId,
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

    const [, , passedActivityId] =
      deps.commentService.prepareMentionNotifications.mock.calls[0];
    expect(passedActivityId.toString()).toBe(activityId);
  });
});
