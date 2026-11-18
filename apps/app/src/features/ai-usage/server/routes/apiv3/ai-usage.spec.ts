import express from 'express';
import request from 'supertest';

import type { EffectiveCatalog } from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import type { AiUsageWindowSum } from '../../models/ai-usage-log';

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

import { setup } from './ai-usage';

const ENDPOINT = '/_api/v3/ai-usage';
const NOW = new Date('2026-10-12T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Mounted the same way production mounts it (a sub-router under /_api/v3),
// so originalUrl and Express's lenient path matching behave as in the server.
const buildApp = (): express.Express => {
  addCustomFunctionToResponse(express);
  const app = express();
  const apiV3Router = express.Router();
  apiV3Router.use('/ai-usage', setup());
  app.use('/_api/v3', apiV3Router);
  return app;
};

const getWithSinces = (sinces: readonly string[]) => {
  const query = sinces.map((s) => `since=${encodeURIComponent(s)}`).join('&');
  return request(buildApp()).get(`${ENDPOINT}?${query}`);
};

describe('GET /_api/v3/ai-usage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    sumUsageSince.mockImplementation(async (sinces) =>
      sinces.map((since) => ({
        since,
        weightedUnits: 1.5,
        unweightedTokens: 7,
      })),
    );
    resolveEffectiveCatalog.mockResolvedValue({
      source: 'bundled',
      contentFetchedAt: new Date('2026-10-01T00:00:00.000Z'),
      models: { anthropic: [], google: [], openai: [] },
    });
    getConfig.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('valid requests', () => {
    it('accepts a single since (arrives as a string) and returns the report', async () => {
      const res = await getWithSinces(['2026-10-01T00:00:00Z']);

      expect(res.status).toBe(200);
      expect(sumUsageSince).toHaveBeenCalledTimes(1);
      expect(sumUsageSince).toHaveBeenCalledWith([
        new Date('2026-10-01T00:00:00.000Z'),
      ]);
      expect(res.body).toEqual({
        windows: [
          {
            since: '2026-10-01T00:00:00.000Z',
            weightedUnits: 1.5,
            unweightedTokens: 7,
          },
        ],
        catalog: {
          source: 'bundled',
          contentFetchedAt: '2026-10-01T00:00:00.000Z',
        },
      });
    });

    it('accepts repeated since values (arrive as an array) in request order, with any timezone offset', async () => {
      const res = await getWithSinces([
        '2026-10-01T00:00:00+09:00',
        '2026-09-15T12:30:00.250-05:00',
        '2026-10-11T23:59Z',
      ]);

      expect(res.status).toBe(200);
      expect(sumUsageSince).toHaveBeenCalledWith([
        new Date('2026-09-30T15:00:00.000Z'),
        new Date('2026-09-15T17:30:00.250Z'),
        new Date('2026-10-11T23:59:00.000Z'),
      ]);
      expect(res.body.windows.map((w: { since: string }) => w.since)).toEqual([
        '2026-09-30T15:00:00.000Z',
        '2026-09-15T17:30:00.250Z',
        '2026-10-11T23:59:00.000Z',
      ]);
    });

    it('accepts exactly 10 values', async () => {
      const sinces = Array.from({ length: 10 }, (_, i) =>
        new Date(NOW.getTime() - (i + 1) * DAY_MS).toISOString(),
      );

      const res = await getWithSinces(sinces);

      expect(res.status).toBe(200);
      expect(res.body.windows).toHaveLength(10);
    });

    it('accepts the boundaries: exactly now and exactly 90 days ago', async () => {
      const res = await getWithSinces([
        NOW.toISOString(),
        new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
      ]);

      expect(res.status).toBe(200);
    });

    it('marks the response as not cacheable', async () => {
      const res = await getWithSinces(['2026-10-01T00:00:00Z']);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('never exposes per-user, cost, or price information even if the sources carry extra data', async () => {
      const noisyCatalog = {
        source: 'refreshed' as const,
        contentFetchedAt: new Date('2026-10-05T00:00:00.000Z'),
        models: { anthropic: [], google: [], openai: [] },
        pricing: { input: 3 },
      };
      resolveEffectiveCatalog.mockResolvedValue(noisyCatalog);
      sumUsageSince.mockImplementation(async (sinces) =>
        sinces.map((since) => {
          const noisyWindow = {
            since,
            weightedUnits: 2,
            unweightedTokens: 0,
            userId: 'user-1',
            estimatedCostUsd: 0.42,
          };
          return noisyWindow;
        }),
      );

      const res = await getWithSinces(['2026-10-01T00:00:00Z']);

      expect(res.status).toBe(200);
      const keys = collectKeys(res.body);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

  describe('invalid since → 400 without aggregating', () => {
    const tooOld = new Date(NOW.getTime() - 90 * DAY_MS - 1).toISOString();
    const future = new Date(NOW.getTime() + 1).toISOString();

    it.each<[string, string]>([
      ['missing', ENDPOINT],
      ['empty value', `${ENDPOINT}?since=`],
      ['not a date', `${ENDPOINT}?since=yesterday`],
      ['date only', `${ENDPOINT}?since=2026-10-01`],
      ['no timezone designator', `${ENDPOINT}?since=2026-10-01T00:00:00`],
      [
        "unencoded '+' turned into a space",
        `${ENDPOINT}?since=2026-10-01T00:00:00+09:00`,
      ],
      ['non-existent calendar date', `${ENDPOINT}?since=2026-09-31T00:00:00Z`],
      ['day zero', `${ENDPOINT}?since=2026-10-00T00:00:00Z`],
      ['out-of-range month', `${ENDPOINT}?since=2026-13-01T00:00:00Z`],
      ['out-of-range hour', `${ENDPOINT}?since=2026-10-01T24:00:00Z`],
      ['out-of-range minute', `${ENDPOINT}?since=2026-10-01T00:60:00Z`],
      ['out-of-range second', `${ENDPOINT}?since=2026-10-01T00:00:60Z`],
      [
        'out-of-range offset hour',
        `${ENDPOINT}?since=2026-10-01T00:00:00%2B24:00`,
      ],
      [
        'out-of-range offset minute',
        `${ENDPOINT}?since=2026-10-01T00:00:00%2B09:60`,
      ],
      ['lowercase designator', `${ENDPOINT}?since=2026-10-01t00:00:00z`],
      ['object instead of string', `${ENDPOINT}?since[a]=2026-10-01T00:00:00Z`],
      ['in the future', `${ENDPOINT}?since=${encodeURIComponent(future)}`],
      ['older than 90 days', `${ENDPOINT}?since=${encodeURIComponent(tooOld)}`],
      [
        'one bad value among good ones',
        `${ENDPOINT}?since=2026-10-01T00:00:00Z&since=bad`,
      ],
    ])('%s', async (_label, url) => {
      const res = await request(buildApp()).get(url);

      expect(res.status).toBe(400);
      expect(res.body.errors?.[0]?.code).toBe('validation_failed');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });

    it('more than 10 values', async () => {
      const sinces = Array.from({ length: 11 }, (_, i) =>
        new Date(NOW.getTime() - (i + 1) * DAY_MS).toISOString(),
      );

      const res = await getWithSinces(sinces);

      expect(res.status).toBe(400);
      expect(res.body.errors?.[0]?.code).toBe('validation_failed');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });
  });

  describe('entry checks run before validation and never aggregate', () => {
    it.each([
      ['/_API/V3/AI-Usage'],
      ['/_api/v3/AI-USAGE'],
      [`${ENDPOINT}/`],
      ['/_api/v3//ai-usage'],
      [`${ENDPOINT}/extra`],
    ])('%s → 404', async (path) => {
      const res = await request(buildApp()).get(
        `${path}?since=2026-10-01T00:00:00Z`,
      );

      expect(res.status).toBe(404);
      // The guard's own error, not Express's fallback 404 for an unrouted path
      expect(res.body.errors?.[0]?.code).toBe('not_found');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });

    it('rejects a wrong spelling with 404 even when the method is also wrong and the input is invalid', async () => {
      const res = await request(buildApp()).post(`${ENDPOINT}/`);

      expect(res.status).toBe(404);
      expect(res.body.errors?.[0]?.code).toBe('not_found');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });

    it.each([
      'post',
      'put',
      'patch',
      'delete',
    ] as const)('%s → 405 with Allow: GET', async (method) => {
      const res = await request(buildApp())[method](
        `${ENDPOINT}?since=2026-10-01T00:00:00Z`,
      );

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(res.body.errors?.[0]?.code).toBe('method_not_allowed');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });

    it('HEAD → 405 with Allow: GET (Express would otherwise run the GET handler)', async () => {
      const res = await request(buildApp()).head(
        `${ENDPOINT}?since=2026-10-01T00:00:00Z`,
      );

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });

    it('rejects a wrong spelling with 404 even when since is invalid, without aggregating', async () => {
      const res = await request(buildApp()).get(`${ENDPOINT}/?since=bad`);

      expect(res.status).toBe(404);
      expect(res.body.errors?.[0]?.code).toBe('not_found');
      expect(sumUsageSince).not.toHaveBeenCalled();
    });

    it('answers 405 before validating the input', async () => {
      const res = await request(buildApp()).post(ENDPOINT);

      expect(res.status).toBe(405);
    });
  });

  it('answers 500 without leaking details when the report cannot be built', async () => {
    sumUsageSince.mockRejectedValue(new Error('db down: secret detail'));

    const res = await getWithSinces(['2026-10-01T00:00:00Z']);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });
});
