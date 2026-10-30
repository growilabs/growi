import { describe, expect, it } from 'vitest';

import {
  ChatProcessedRequest,
  PROCESSED_REQUEST_TTL_SECONDS,
} from './chat-processed-request';

describe('ChatProcessedRequest schema', () => {
  const allFields = [
    'relationId',
    'requestId',
    'response',
    'processedAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatProcessedRequest.schema.path(field)).toBeDefined();
  });

  const getIndexes = () =>
    ChatProcessedRequest.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique compound index on (relationId, requestId)', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('relationId') &&
        keys.includes('requestId') &&
        options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  it('declares a TTL index on processedAt equal to 24 hours', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 &&
        keys[0] === 'processedAt' &&
        typeof options.expireAfterSeconds === 'number'
      );
    });
    expect(found).toBeDefined();
    if (found == null) return;
    expect(found[1].expireAfterSeconds).toBe(PROCESSED_REQUEST_TTL_SECONDS);
  });

  it('PROCESSED_REQUEST_TTL_SECONDS equals 24 hours in seconds', () => {
    expect(PROCESSED_REQUEST_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it('uses collection name chat_processed_requests', () => {
    const collectionName = (
      ChatProcessedRequest.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_processed_requests');
  });
});
