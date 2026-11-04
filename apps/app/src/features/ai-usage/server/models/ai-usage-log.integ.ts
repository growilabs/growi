import mongoose, { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import type { AiUsageLogInput } from './ai-usage-log';

const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;

const readRawRecordsOf = (userId: string) =>
  mongoose.connection
    .collection('aiusagelogs')
    .find({ userId: new Types.ObjectId(userId) })
    .toArray();

describe('aiusagelogs collection', () => {
  it('has a TTL index on createdAt that expires records after 90 days', async () => {
    const AiUsageLog = mongoose.model('AiUsageLog');
    await AiUsageLog.init();

    const indexes = await AiUsageLog.collection.indexes();
    const ttlIndex = indexes.find((index) => index.key.createdAt === 1);

    expect(ttlIndex?.expireAfterSeconds).toBe(NINETY_DAYS_IN_SECONDS);
  });
});

describe('prisma.aiusagelogs.createLog', () => {
  const userId = new Types.ObjectId().toString();

  afterEach(async () => {
    await prisma.aiusagelogs.deleteMany({ where: { userId } });
  });

  it('writes one record carrying every input field and the record time', async () => {
    const input: AiUsageLogInput = {
      userId,
      feature: 'chat',
      provider: 'openai',
      modelId: 'gpt-4.1',
      callCount: 3,
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        reasoningTokens: 40,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
      },
      estimatedCostUsd: 0.0123,
      weightedUnits: 12.5,
      baseModelKey: 'openai/gpt-4.1-mini',
    };
    const before = new Date();

    await prisma.aiusagelogs.createLog(input);

    const records = await readRawRecordsOf(userId);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({
      feature: 'chat',
      provider: 'openai',
      modelId: 'gpt-4.1',
      callCount: 3,
      inputTokens: 1200,
      outputTokens: 340,
      reasoningTokens: 40,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      estimatedCostUsd: 0.0123,
      weightedUnits: 12.5,
      baseModelKey: 'openai/gpt-4.1-mini',
    });
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(record.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('stores absent values as explicit nulls instead of omitting the fields', async () => {
    await prisma.aiusagelogs.createLog({
      userId,
      feature: 'thread-title',
      provider: 'anthropic',
      modelId: 'claude-haiku',
      callCount: 1,
      usage: {
        inputTokens: 50,
        outputTokens: 10,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
      estimatedCostUsd: null,
      weightedUnits: null,
      baseModelKey: null,
    });

    const [record] = await readRawRecordsOf(userId);
    // `toHaveProperty(key, null)` fails for a missing key, so this proves the
    // field was written rather than omitted.
    for (const field of [
      'reasoningTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'estimatedCostUsd',
      'weightedUnits',
      'baseModelKey',
    ]) {
      expect(record).toHaveProperty(field, null);
    }
  });
});

describe('prisma.aiusagelogs.sumUsageSince', () => {
  const userId = new Types.ObjectId().toString();

  // Far-future times keep other files' records (written at "now") out of
  // every window, since the collection is shared across test files.
  const at = (iso: string) => new Date(`3000-01-${iso}Z`);

  const insertRecordAt = (
    createdAt: Date,
    fields: {
      inputTokens: number;
      outputTokens: number;
      weightedUnits: number | null;
    },
  ) =>
    mongoose.connection.collection('aiusagelogs').insertOne({
      userId: new Types.ObjectId(userId),
      feature: 'chat',
      provider: 'openai',
      modelId: 'gpt-4.1',
      callCount: 1,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      estimatedCostUsd: null,
      baseModelKey: null,
      ...fields,
      createdAt,
    });

  afterEach(async () => {
    await prisma.aiusagelogs.deleteMany({ where: { userId } });
  });

  it('returns, per start time, the sums over records created at or after it', async () => {
    await insertRecordAt(at('01T00:00:00'), {
      inputTokens: 1,
      outputTokens: 1,
      weightedUnits: 1000,
    });
    await insertRecordAt(at('10T00:00:00'), {
      inputTokens: 100,
      outputTokens: 20,
      weightedUnits: 1.5,
    });
    await insertRecordAt(at('20T00:00:00'), {
      inputTokens: 300,
      outputTokens: 40,
      weightedUnits: 2.25,
    });
    await insertRecordAt(at('20T00:00:00'), {
      inputTokens: 7,
      outputTokens: 3,
      weightedUnits: null,
    });

    const sums = await prisma.aiusagelogs.sumUsageSince([
      at('20T00:00:00'),
      at('05T00:00:00'),
    ]);

    expect(sums).toEqual([
      { since: at('20T00:00:00'), weightedUnits: 2.25, unweightedTokens: 10 },
      { since: at('05T00:00:00'), weightedUnits: 3.75, unweightedTokens: 10 },
    ]);
  });

  it('counts unknown-multiplier records only in the raw token sum', async () => {
    await insertRecordAt(at('10T00:00:00'), {
      inputTokens: 500,
      outputTokens: 60,
      weightedUnits: null,
    });
    await insertRecordAt(at('11T00:00:00'), {
      inputTokens: 40,
      outputTokens: 2,
      weightedUnits: null,
    });
    await insertRecordAt(at('12T00:00:00'), {
      inputTokens: 900,
      outputTokens: 900,
      weightedUnits: 4,
    });

    const [sum] = await prisma.aiusagelogs.sumUsageSince([at('10T00:00:00')]);

    expect(sum).toEqual({
      since: at('10T00:00:00'),
      weightedUnits: 4,
      unweightedTokens: 602,
    });
  });

  it('returns zero sums for every start time when no record falls in any window', async () => {
    await insertRecordAt(at('01T00:00:00'), {
      inputTokens: 10,
      outputTokens: 10,
      weightedUnits: 1,
    });

    const sums = await prisma.aiusagelogs.sumUsageSince([
      at('15T00:00:00'),
      at('02T00:00:00'),
    ]);

    expect(sums).toEqual([
      { since: at('15T00:00:00'), weightedUnits: 0, unweightedTokens: 0 },
      { since: at('02T00:00:00'), weightedUnits: 0, unweightedTokens: 0 },
    ]);
  });
});
