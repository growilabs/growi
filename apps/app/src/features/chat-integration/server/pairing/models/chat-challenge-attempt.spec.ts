import { describe, expect, it } from 'vitest';

import {
  CHALLENGE_ATTEMPT_WINDOW_TTL_SECONDS,
  ChatChallengeAttempt,
} from './chat-challenge-attempt';

describe('ChatChallengeAttempt schema', () => {
  const allFields = [
    'registrationCode',
    'sourceKey',
    'windowStartedAt',
    'count',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatChallengeAttempt.schema.path(field)).toBeDefined();
  });

  it('count defaults to 0', () => {
    const path = ChatChallengeAttempt.schema.path('count');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  const getIndexes = () =>
    ChatChallengeAttempt.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares the primary-key compound unique index on (registrationCode, sourceKey)', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('registrationCode') &&
        keys.includes('sourceKey') &&
        options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  it('declares a TTL index on windowStartedAt', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 &&
        keys[0] === 'windowStartedAt' &&
        typeof options.expireAfterSeconds === 'number'
      );
    });
    expect(found).toBeDefined();
    if (found == null) return;
    expect(found[1].expireAfterSeconds).toBe(
      CHALLENGE_ATTEMPT_WINDOW_TTL_SECONDS,
    );
  });

  it('uses collection name chat_challenge_attempts', () => {
    const collectionName = (
      ChatChallengeAttempt.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_challenge_attempts');
  });
});
