import { describe, expect, it } from 'vitest';

import {
  ChatNotificationOutbox,
  NOTIFICATION_OUTBOX_SENT_TTL_SECONDS,
} from './chat-notification-outbox';

describe('ChatNotificationOutbox schema', () => {
  const allFields = [
    'requestId',
    'relationId',
    'targets',
    'markdown',
    'containsRestrictedPage',
    'state',
    'attempts',
    'claimedAt',
    'result',
    'createdAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatNotificationOutbox.schema.path(field)).toBeDefined();
  });

  it('claimedAt defaults to null', () => {
    const path = ChatNotificationOutbox.schema.path('claimedAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('attempts defaults to 0', () => {
    const path = ChatNotificationOutbox.schema.path('attempts');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  const getIndexes = () =>
    ChatNotificationOutbox.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a (state, claimedAt) index for the drain-claim access pattern', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('state') &&
        keys.includes('claimedAt')
      );
    });
    expect(found).toBeDefined();
  });

  it('declares a SEPARATE (relationId, requestId) index for the result write-back access pattern', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('relationId') &&
        keys.includes('requestId')
      );
    });
    expect(found).toBeDefined();
  });

  it('these are two distinct indexes, not one combined index', () => {
    const indexes = getIndexes();
    const claimIndex = indexes.find(([fields]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('state') &&
        keys.includes('claimedAt')
      );
    });
    const writeBackIndex = indexes.find(([fields]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('relationId') &&
        keys.includes('requestId')
      );
    });
    expect(claimIndex).not.toBe(writeBackIndex);
  });

  it('declares a TTL index on createdAt, scoped to state: sent, equal to 30 days', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 &&
        keys[0] === 'createdAt' &&
        typeof options.expireAfterSeconds === 'number'
      );
    });
    expect(found).toBeDefined();
    if (found == null) return;
    const [, options] = found;
    expect(options.expireAfterSeconds).toBe(
      NOTIFICATION_OUTBOX_SENT_TTL_SECONDS,
    );
    expect(options.partialFilterExpression).toEqual({ state: 'sent' });
  });

  it('NOTIFICATION_OUTBOX_SENT_TTL_SECONDS equals 30 days in seconds', () => {
    expect(NOTIFICATION_OUTBOX_SENT_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('uses collection name chat_notification_outbox', () => {
    const collectionName = (
      ChatNotificationOutbox.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_notification_outbox');
  });
});
