import { describe, expect, it, vi } from 'vitest';

import {
  type CommentListRow,
  toCommentListItem,
  toLegacyCommentListItem,
} from './to-comment-list-item';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

const creatorRow: NonNullable<CommentListRow['creator']> = {
  _id: 'user-1',
  id: 'user-1',
  __v: 0,
  v: 0,
  userId: null,
  image: null,
  imageAttachmentId: null,
  imageUrlCached: null,
  isGravatarEnabled: false,
  isEmailPublished: false,
  googleId: null,
  name: 'Alice',
  username: 'alice',
  email: 'alice@example.com',
  slackMemberId: null,
  introduction: null,
  password: 'hashed-password',
  apiToken: 'secret-token',
  lang: 'en_US',
  status: 2,
  lastLoginAt: null,
  contributionsMigratedAt: null,
  admin: false,
  readOnly: false,
  isInvitationEmailSended: false,
  createdAt,
  updatedAt: createdAt,
  serializeSecurely: vi.fn(),
  updateLastLoginAt: vi.fn(),
};

const baseRow: CommentListRow = {
  _id: 'comment-1',
  id: 'comment-1',
  __v: 0,
  v: 0,
  pageId: 'page-1',
  creatorId: 'user-1',
  revisionId: 'rev-1',
  comment: 'hello',
  commentPosition: -1,
  replyToId: null,
  createdAt,
  updatedAt: createdAt,
  isInline: false,
  quote: null,
  prefix: null,
  suffix: null,
  approxOffset: null,
  anchorOriginRevisionId: null,
  resolvedById: null,
  resolvedAt: null,
  creator: creatorRow,
};

describe('toCommentListItem', () => {
  it('exposes the legacy alias fields for a normal comment', () => {
    const item = toCommentListItem({ ...baseRow, replyToId: 'comment-0' });

    expect(item).toMatchObject({
      _id: 'comment-1',
      id: 'comment-1',
      page: 'page-1',
      pageId: 'page-1',
      revision: 'rev-1',
      revisionId: 'rev-1',
      replyTo: 'comment-0',
      replyToId: 'comment-0',
      comment: 'hello',
      commentPosition: -1,
      isInline: false,
      quote: null,
      resolvedAt: null,
    });
  });

  it('keeps null aliases when revision and replyTo are absent', () => {
    const item = toCommentListItem({ ...baseRow, revisionId: null });

    expect(item.revision).toBeNull();
    expect(item.replyTo).toBeNull();
  });

  it('carries the inline fields of an inline comment', () => {
    const resolvedAt = new Date('2026-02-01T00:00:00.000Z');
    const item = toCommentListItem({
      ...baseRow,
      isInline: true,
      quote: 'selected',
      prefix: 'before ',
      suffix: ' after',
      approxOffset: 12,
      anchorOriginRevisionId: 'rev-0',
      resolvedById: 'user-2',
      resolvedAt,
    });

    expect(item).toMatchObject({
      page: 'page-1',
      revision: 'rev-1',
      isInline: true,
      quote: 'selected',
      prefix: 'before ',
      suffix: ' after',
      approxOffset: 12,
      anchorOriginRevisionId: 'rev-0',
      resolvedById: 'user-2',
      resolvedAt,
    });
  });

  it('returns only the creator fields the screens use', () => {
    const item = toCommentListItem({
      ...baseRow,
      creator: {
        ...creatorRow,
        googleId: 'google-sentinel',
        slackMemberId: 'slack-sentinel',
        lastLoginAt: createdAt,
        admin: true,
        imageUrlCached: '/images/alice.png',
      },
    });

    expect(item.creator).toEqual({
      _id: 'user-1',
      username: 'alice',
      name: 'Alice',
      imageUrlCached: '/images/alice.png',
    });
  });

  it('does not return the creator email even when the user publishes it', () => {
    const item = toCommentListItem({
      ...baseRow,
      creator: { ...creatorRow, isEmailPublished: true },
    });

    expect(item.creator).not.toHaveProperty('email');
  });

  it('falls back to the creator id when the creator row is missing', () => {
    const item = toCommentListItem({ ...baseRow, creator: null });

    expect(item.creator).toBe('user-1');
  });
});

describe('toLegacyCommentListItem', () => {
  it('formats the common fields the same way as toCommentListItem', () => {
    expect(toLegacyCommentListItem(baseRow)).toEqual({
      ...toCommentListItem(baseRow),
      creator: expect.any(Object),
    });
  });

  it('returns every creator column except the credentials and the private email', () => {
    const item = toLegacyCommentListItem(baseRow);

    expect(item.creator).toMatchObject({
      username: 'alice',
      name: 'Alice',
      googleId: null,
      slackMemberId: null,
      lastLoginAt: null,
      admin: false,
      status: 2,
    });
    expect(item.creator).not.toHaveProperty('email');
    expect(item.creator).not.toHaveProperty('password');
    expect(item.creator).not.toHaveProperty('apiToken');
  });

  it('exposes the creator email when the user publishes it', () => {
    const item = toLegacyCommentListItem({
      ...baseRow,
      creator: { ...creatorRow, isEmailPublished: true },
    });

    expect(item.creator).toMatchObject({ email: 'alice@example.com' });
    expect(item.creator).not.toHaveProperty('password');
    expect(item.creator).not.toHaveProperty('apiToken');
  });

  it('keeps a null email key when the user publishes a missing email', () => {
    const item = toLegacyCommentListItem({
      ...baseRow,
      creator: { ...creatorRow, isEmailPublished: true, email: null },
    });

    expect(item.creator).toHaveProperty('email', null);
  });

  it('falls back to the creator id when the creator row is missing', () => {
    const item = toLegacyCommentListItem({ ...baseRow, creator: null });

    expect(item.creator).toBe('user-1');
  });
});
