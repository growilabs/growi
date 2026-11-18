import type { EffectiveCatalog } from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';

import type { AiUsageWindowSum } from '../models/ai-usage-log';

const { sumUsageSince, resolveEffectiveCatalog, getConfig } = vi.hoisted(
  () => ({
    sumUsageSince:
      vi.fn<
        (sinces: readonly Date[]) => Promise<readonly AiUsageWindowSum[]>
      >(),
    resolveEffectiveCatalog: vi.fn<() => Promise<EffectiveCatalog>>(),
    getConfig: vi.fn<(key: string) => unknown>(),
  }),
);

vi.mock('~/utils/prisma', () => ({
  prisma: { aiusagelogs: { sumUsageSince } },
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog',
  () => ({ resolveEffectiveCatalog }),
);

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

import { buildAiUsageReport } from './build-ai-usage-report';

const FORBIDDEN_KEYS = [
  'userId',
  'user',
  'users',
  'estimatedCostUsd',
  'cost',
  'price',
  'pricing',
  'models',
];

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value != null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...collectKeys(v)]);
  }
  return [];
};

describe('buildAiUsageReport', () => {
  const since1 = new Date('2026-10-01T00:00:00.000Z');
  const since2 = new Date('2026-09-15T09:00:00.000Z');
  const fetchedAt = new Date('2026-10-05T12:34:56.000Z');

  beforeEach(() => {
    vi.resetAllMocks();
    resolveEffectiveCatalog.mockResolvedValue({
      source: 'refreshed',
      contentFetchedAt: fetchedAt,
      models: { anthropic: [], google: [], openai: [] },
    });
    getConfig.mockReturnValue(undefined);
  });

  it('returns windows in request order with ISO since, plus the catalog freshness', async () => {
    sumUsageSince.mockResolvedValue([
      { since: since1, weightedUnits: 12.5, unweightedTokens: 300 },
      { since: since2, weightedUnits: 40, unweightedTokens: 0 },
    ]);

    const report = await buildAiUsageReport([since1, since2]);

    expect(sumUsageSince).toHaveBeenCalledWith([since1, since2]);
    expect(report).toEqual({
      windows: [
        {
          since: '2026-10-01T00:00:00.000Z',
          weightedUnits: 12.5,
          unweightedTokens: 300,
        },
        {
          since: '2026-09-15T09:00:00.000Z',
          weightedUnits: 40,
          unweightedTokens: 0,
        },
      ],
      catalog: {
        source: 'refreshed',
        contentFetchedAt: '2026-10-05T12:34:56.000Z',
      },
    });
  });

  it('includes growiAppIdForCloud when configured', async () => {
    sumUsageSince.mockResolvedValue([
      { since: since1, weightedUnits: 0, unweightedTokens: 0 },
    ]);
    getConfig.mockImplementation((key) =>
      key === 'app:growiAppIdForCloud' ? 4242 : undefined,
    );

    const report = await buildAiUsageReport([since1]);

    expect(report.growiAppIdForCloud).toBe(4242);
  });

  it('omits growiAppIdForCloud entirely when not configured', async () => {
    sumUsageSince.mockResolvedValue([
      { since: since1, weightedUnits: 0, unweightedTokens: 0 },
    ]);

    const report = await buildAiUsageReport([since1]);

    expect('growiAppIdForCloud' in report).toBe(false);
  });

  it('never exposes per-user, cost, or price information even if the sources carry extra data', async () => {
    const noisyWindow = {
      since: since1,
      weightedUnits: 1,
      unweightedTokens: 2,
      userId: 'u1',
      estimatedCostUsd: 3.2,
      price: { input: 1, output: 2 },
    };
    sumUsageSince.mockResolvedValue([noisyWindow]);
    resolveEffectiveCatalog.mockResolvedValue({
      source: 'bundled',
      contentFetchedAt: fetchedAt,
      models: {
        anthropic: [],
        google: [],
        openai: [
          {
            id: 'gpt-x',
            name: 'GPT X',
            pricing: { input: 1, output: 2 },
          },
        ],
      },
    });

    const report = await buildAiUsageReport([since1]);

    expect(report).toEqual({
      windows: [
        {
          since: '2026-10-01T00:00:00.000Z',
          weightedUnits: 1,
          unweightedTokens: 2,
        },
      ],
      catalog: {
        source: 'bundled',
        contentFetchedAt: '2026-10-05T12:34:56.000Z',
      },
    });
    const keys = collectKeys(report);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
