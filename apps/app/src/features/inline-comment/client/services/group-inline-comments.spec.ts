import type {
  ICommentCreator,
  ICommentListItem,
} from '~/features/comment/interfaces';

import { groupInlineComments } from './group-inline-comments';

const baseItem = (id: string): ICommentListItem => ({
  _id: id,
  id,
  page: 'page1',
  pageId: 'page1',
  creator: null,
  creatorId: 'user1',
  revision: 'rev1',
  revisionId: 'rev1',
  replyTo: null,
  replyToId: null,
  comment: `comment ${id}`,
  commentPosition: -1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  isInline: false,
  quote: null,
  prefix: null,
  suffix: null,
  approxOffset: null,
  anchorOriginRevisionId: null,
  resolvedById: null,
  resolvedAt: null,
});

const originItem = (
  id: string,
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem => ({
  ...baseItem(id),
  isInline: true,
  quote: 'quote',
  prefix: 'prefix',
  suffix: 'suffix',
  approxOffset: 3,
  anchorOriginRevisionId: 'rev1',
  ...overrides,
});

const replyItem = (
  id: string,
  replyToId: string,
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem => ({
  ...baseItem(id),
  isInline: true,
  replyTo: replyToId,
  replyToId,
  ...overrides,
});

describe('groupInlineComments', () => {
  it('nests replies under their origin comment and exposes the anchor', () => {
    const result = groupInlineComments([
      originItem('o1'),
      replyItem('r1', 'o1'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'o1',
      pageId: 'page1',
      creatorId: 'user1',
      comment: 'comment o1',
      anchorOriginRevisionId: 'rev1',
      anchor: {
        quote: 'quote',
        prefix: 'prefix',
        suffix: 'suffix',
        approxOffset: 3,
      },
      resolvedById: null,
      resolvedAt: null,
    });
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0]).toMatchObject({
      id: 'r1',
      replyToId: 'o1',
      comment: 'comment r1',
      creatorId: 'user1',
    });
  });

  it('keeps the input order for origins and for replies within each origin', () => {
    const result = groupInlineComments([
      replyItem('r3', 'o2'),
      originItem('o2'),
      replyItem('r2', 'o1'),
      originItem('o1'),
      replyItem('r1', 'o1'),
    ]);

    expect(result.map((o) => o.id)).toEqual(['o2', 'o1']);
    expect(result[0].replies.map((r) => r.id)).toEqual(['r3']);
    expect(result[1].replies.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('keeps resolved state and does not convert dates', () => {
    const resolvedAt = new Date('2026-02-01T00:00:00Z');
    const createdAt = new Date('2026-01-01T00:00:00Z');

    const [origin] = groupInlineComments([
      originItem('o1', { resolvedById: 'user2', resolvedAt, createdAt }),
    ]);

    expect(origin.resolvedById).toBe('user2');
    expect(origin.resolvedAt).toBe(resolvedAt);
    expect(origin.createdAt).toBe(createdAt);
  });

  it.each([
    ['creatorId', { creatorId: null }],
    ['quote', { quote: null }],
    ['prefix', { prefix: null }],
    ['suffix', { suffix: null }],
    ['approxOffset', { approxOffset: null }],
    ['anchorOriginRevisionId', { anchorOriginRevisionId: null }],
  ])('drops an origin whose %s is missing, along with its replies', (_, overrides) => {
    const result = groupInlineComments([
      originItem('bad', overrides),
      replyItem('r1', 'bad'),
      originItem('ok'),
    ]);

    expect(result.map((o) => o.id)).toEqual(['ok']);
    expect(result[0].replies).toEqual([]);
  });

  it('drops replies whose parent is not in the list or that have no creator', () => {
    const result = groupInlineComments([
      originItem('o1'),
      replyItem('orphan', 'missing'),
      replyItem('anonymous', 'o1', { creatorId: null }),
      replyItem('r1', 'o1'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].replies.map((r) => r.id)).toEqual(['r1']);
  });

  it('ignores ordinary (non-inline) comments and their replies', () => {
    const result = groupInlineComments([
      baseItem('c1'),
      { ...baseItem('c2'), replyTo: 'c1', replyToId: 'c1' },
      originItem('o1'),
    ]);

    expect(result.map((o) => o.id)).toEqual(['o1']);
    expect(result[0].replies).toEqual([]);
  });

  it('does not attach a reply to an ordinary comment even when ids match', () => {
    const result = groupInlineComments([baseItem('c1'), replyItem('r1', 'c1')]);

    expect(result).toEqual([]);
  });

  it('does not attach a non-inline row as a reply to an inline origin', () => {
    const result = groupInlineComments([
      originItem('o1'),
      {
        ...baseItem('n1'),
        isInline: false,
        replyTo: 'o1',
        replyToId: 'o1',
        creatorId: 'user1',
      },
    ]);

    expect(result.map((o) => o.id)).toEqual(['o1']);
    expect(result[0].replies).toEqual([]);
  });

  it('does not treat a non-inline row with every anchor field filled as an origin', () => {
    const result = groupInlineComments([
      { ...originItem('n2'), isInline: false },
    ]);

    expect(result).toEqual([]);
  });

  it('returns an empty list for an empty input', () => {
    expect(groupInlineComments([])).toEqual([]);
  });

  describe('creator', () => {
    it('is kept as is when the list item carries the creator object', () => {
      const creator: ICommentCreator = {
        _id: 'user1',
        id: 'user1',
        __v: 0,
        v: 0,
        userId: null,
        image: null,
        imageAttachmentId: null,
        imageUrlCached: '/images/user1.png',
        isGravatarEnabled: false,
        isEmailPublished: false,
        googleId: null,
        name: null,
        username: 'alice',
        slackMemberId: null,
        introduction: null,
        lang: 'en_US',
        status: 2,
        lastLoginAt: null,
        contributionsMigratedAt: null,
        admin: false,
        readOnly: false,
        isInvitationEmailSended: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      };

      const result = groupInlineComments([
        originItem('o1', { creator }),
        replyItem('r1', 'o1', { creator }),
      ]);

      expect(result[0].creator).toEqual(creator);
      expect(result[0].replies[0].creator).toEqual(creator);
    });

    it('is null when the list item carries only the creator id string', () => {
      const result = groupInlineComments([
        originItem('o1', { creator: 'user1' }),
        replyItem('r1', 'o1', { creator: 'user1' }),
      ]);

      expect(result[0].creator).toBeNull();
      expect(result[0].replies[0].creator).toBeNull();
    });

    it('is null when the list item has no creator', () => {
      const [origin] = groupInlineComments([
        originItem('o1', { creator: null }),
      ]);

      expect(origin.creator).toBeNull();
    });
  });
});
