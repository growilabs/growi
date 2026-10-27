import type { EffectiveCatalog } from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';

import type { AiUsageLogInput } from '../models/ai-usage-log';
import type { TokenUsage } from './token-usage';
import type { UsageBaseModel } from './usage-base-model';

const { createLog, resolveEffectiveCatalog, readUsageBaseModel, loggerError } =
  vi.hoisted(() => ({
    createLog: vi.fn<(input: AiUsageLogInput) => Promise<void>>(),
    resolveEffectiveCatalog: vi.fn<() => Promise<EffectiveCatalog>>(),
    readUsageBaseModel: vi.fn<() => UsageBaseModel | null>(),
    loggerError: vi.fn(),
  }));

vi.mock('~/utils/prisma', () => ({
  prisma: { aiusagelogs: { createLog } },
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog')
      >();
    return {
      ...actual,
      resolveEffectiveCatalog,
    };
  },
);

vi.mock('./usage-base-model', () => ({ readUsageBaseModel }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { recordAiUsage } from './record-ai-usage';

const usage = (
  inputTokens: number,
  outputTokens: number,
  extra: Partial<TokenUsage> = {},
): TokenUsage => ({
  inputTokens,
  outputTokens,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  ...extra,
});

// Prices are USD per 1M tokens.
const catalogWith = (
  openaiModels: EffectiveCatalog['models']['openai'],
): EffectiveCatalog => ({
  source: 'bundled',
  contentFetchedAt: new Date('2026-01-01T00:00:00Z'),
  models: { openai: openaiModels, anthropic: [], google: [] },
});

const USED = { id: 'gpt-used', name: 'Used', pricing: { input: 2, output: 8 } };
const BASE = { id: 'gpt-base', name: 'Base', pricing: { input: 1, output: 4 } };

const lastRecord = (): AiUsageLogInput => {
  const call = createLog.mock.calls.at(-1);
  if (call == null) throw new Error('createLog was not called');
  return call[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  createLog.mockResolvedValue(undefined);
  resolveEffectiveCatalog.mockResolvedValue(catalogWith([USED, BASE]));
  readUsageBaseModel.mockReturnValue({
    provider: 'openai',
    modelId: 'gpt-base',
  });
});

describe('recordAiUsage', () => {
  it('stores the summed cost and its multiplier against the base output price', async () => {
    // call 1: 1000*2 + 500*8 = 6000 / 1e6 = 0.006 USD
    // call 2: 2000*2 + 250*8 = 6000 / 1e6 = 0.006 USD
    // total 0.012 USD ÷ (4 / 1e6 USD per base output token) = 3000
    await recordAiUsage({
      userId: 'user-1',
      feature: 'chat',
      modelKey: 'openai/gpt-used',
      calls: [usage(1000, 500, { reasoningTokens: 100 }), usage(2000, 250)],
    });

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(resolveEffectiveCatalog).toHaveBeenCalledTimes(1);
    const record = lastRecord();
    expect(record).toMatchObject({
      userId: 'user-1',
      feature: 'chat',
      provider: 'openai',
      modelId: 'gpt-used',
      callCount: 2,
      usage: {
        inputTokens: 3000,
        outputTokens: 750,
        reasoningTokens: 100,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
      baseModelKey: 'openai/gpt-base',
    });
    expect(record.estimatedCostUsd).toBeCloseTo(0.012, 12);
    expect(record.weightedUnits).toBeCloseTo(3000, 6);
  });

  it('gives a multiplier of 1 per output token when the used model is the base model', async () => {
    readUsageBaseModel.mockReturnValue({
      provider: 'openai',
      modelId: 'gpt-used',
    });

    await recordAiUsage({
      userId: 'user-1',
      feature: 'suggest-path',
      modelKey: 'openai/gpt-used',
      calls: [usage(0, 1000)],
    });

    expect(lastRecord().weightedUnits).toBeCloseTo(1000, 6);
    expect(lastRecord().baseModelKey).toBe('openai/gpt-used');
  });

  describe('weightedUnits is unknown (null) but the cost is kept', () => {
    it('when the base model is unset', async () => {
      readUsageBaseModel.mockReturnValue(null);

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord()).toMatchObject({
        weightedUnits: null,
        baseModelKey: null,
      });
      expect(lastRecord().estimatedCostUsd).toBeCloseTo(0.006, 12);
    });

    it('when the base model is not in the catalog', async () => {
      readUsageBaseModel.mockReturnValue({
        provider: 'openai',
        modelId: 'gpt-missing',
      });

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord()).toMatchObject({
        weightedUnits: null,
        baseModelKey: 'openai/gpt-missing',
      });
      expect(lastRecord().estimatedCostUsd).toBeCloseTo(0.006, 12);
    });

    it('when the base model output price is unknown', async () => {
      resolveEffectiveCatalog.mockResolvedValue(
        catalogWith([
          USED,
          { id: 'gpt-base', name: 'Base', pricing: { input: 1 } },
        ]),
      );

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord().weightedUnits).toBeNull();
      expect(lastRecord().estimatedCostUsd).toBeCloseTo(0.006, 12);
    });

    it('when the base model has no pricing at all', async () => {
      resolveEffectiveCatalog.mockResolvedValue(
        catalogWith([USED, { id: 'gpt-base', name: 'Base' }]),
      );

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord().weightedUnits).toBeNull();
    });

    it('when the base model output price is 0', async () => {
      resolveEffectiveCatalog.mockResolvedValue(
        catalogWith([
          USED,
          { id: 'gpt-base', name: 'Base', pricing: { input: 1, output: 0 } },
        ]),
      );

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord().weightedUnits).toBeNull();
      expect(lastRecord().estimatedCostUsd).toBeCloseTo(0.006, 12);
    });
  });

  describe('both cost and weightedUnits are unknown (null) while tokens are still recorded', () => {
    it('when only some calls can be priced', async () => {
      // The second call crosses a tier whose output price is unknown.
      resolveEffectiveCatalog.mockResolvedValue(
        catalogWith([
          {
            id: 'gpt-used',
            name: 'Used',
            pricing: {
              input: 2,
              output: 8,
              tiers: [{ inputTokensAbove: 100_000, input: 4 }],
            },
          },
          BASE,
        ]),
      );

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500), usage(200_000, 100)],
      });

      expect(lastRecord()).toMatchObject({
        callCount: 2,
        usage: { inputTokens: 201_000, outputTokens: 600 },
        estimatedCostUsd: null,
        weightedUnits: null,
        baseModelKey: 'openai/gpt-base',
      });
    });

    it('when the used model is not in the catalog', async () => {
      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-unknown',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord()).toMatchObject({
        provider: 'openai',
        modelId: 'gpt-unknown',
        usage: { inputTokens: 1000, outputTokens: 500 },
        estimatedCostUsd: null,
        weightedUnits: null,
      });
    });

    it('when the used model has no pricing', async () => {
      resolveEffectiveCatalog.mockResolvedValue(
        catalogWith([{ id: 'gpt-used', name: 'Used' }, BASE]),
      );

      await recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      });

      expect(lastRecord()).toMatchObject({
        estimatedCostUsd: null,
        weightedUnits: null,
      });
    });

    it('when the provider has no catalog (azure-openai)', async () => {
      await recordAiUsage({
        userId: 'user-1',
        feature: 'thread-title',
        modelKey: 'azure-openai/my-deployment',
        calls: [usage(10, 5)],
      });

      expect(lastRecord()).toMatchObject({
        feature: 'thread-title',
        provider: 'azure-openai',
        modelId: 'my-deployment',
        usage: { inputTokens: 10, outputTokens: 5 },
        estimatedCostUsd: null,
        weightedUnits: null,
      });
    });

    it('when the catalog read fails', async () => {
      resolveEffectiveCatalog.mockRejectedValue(new Error('catalog down'));

      await expect(
        recordAiUsage({
          userId: 'user-1',
          feature: 'chat',
          modelKey: 'openai/gpt-used',
          calls: [usage(1000, 500)],
        }),
      ).resolves.toBeUndefined();

      expect(lastRecord()).toMatchObject({
        usage: { inputTokens: 1000, outputTokens: 500 },
        estimatedCostUsd: null,
        weightedUnits: null,
      });
      expect(loggerError).toHaveBeenCalled();
    });

    it('when the catalog entries are corrupt', async () => {
      resolveEffectiveCatalog.mockResolvedValue({
        source: 'refreshed',
        contentFetchedAt: new Date(),
        // A persisted snapshot that slipped past validation: a non-iterable provider entry.
        models: JSON.parse('{"openai": 5, "anthropic": [], "google": []}'),
      });

      await expect(
        recordAiUsage({
          userId: 'user-1',
          feature: 'chat',
          modelKey: 'openai/gpt-used',
          calls: [usage(1000, 500)],
        }),
      ).resolves.toBeUndefined();

      expect(lastRecord()).toMatchObject({
        usage: { inputTokens: 1000, outputTokens: 500 },
        estimatedCostUsd: null,
        weightedUnits: null,
      });
      expect(loggerError).toHaveBeenCalled();
    });
  });

  it('does not throw and logs an error when the write fails', async () => {
    createLog.mockRejectedValue(new Error('db down'));

    await expect(
      recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      }),
    ).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
      }),
      expect.any(String),
    );
  });

  it('still records tokens and cost when the base model cannot be read', async () => {
    readUsageBaseModel.mockImplementation(() => {
      throw new Error('config not loaded');
    });

    await expect(
      recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
        calls: [usage(1000, 500)],
      }),
    ).resolves.toBeUndefined();

    expect(lastRecord()).toMatchObject({
      usage: { inputTokens: 1000, outputTokens: 500 },
      weightedUnits: null,
      baseModelKey: null,
    });
    expect(lastRecord().estimatedCostUsd).toBeCloseTo(0.006, 12);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'openai/gpt-used',
      }),
      expect.any(String),
    );
  });

  it('writes nothing when there are no calls', async () => {
    await recordAiUsage({
      userId: 'user-1',
      feature: 'chat',
      modelKey: 'openai/gpt-used',
      calls: [],
    });

    expect(createLog).not.toHaveBeenCalled();
  });

  it('does not throw and writes nothing for a malformed model key', async () => {
    await expect(
      recordAiUsage({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'not-a-key',
        calls: [usage(1000, 500)],
      }),
    ).resolves.toBeUndefined();

    expect(createLog).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        feature: 'chat',
        modelKey: 'not-a-key',
      }),
      expect.any(String),
    );
  });
});
