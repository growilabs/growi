import os from 'node:os';
import express, { type Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import { BUNDLED_CATALOG_MODELS } from '~/features/mastra/server/services/ai-sdk-modules/model-catalog';
import { refreshModelCatalog } from '~/features/mastra/server/services/ai-sdk-modules/refresh-model-catalog';
import { isAiReady } from '~/features/mastra/server/services/is-ai-configured';
import { middlewareFactory as rateLimiterFactory } from '~/features/rate-limiter';
import type { SessionConfig } from '~/interfaces/session-config';
import type Crowi from '~/server/crowi';
import { setup as setupExpressInit } from '~/server/crowi/express-init';
import {
  createSessionIdGenerator,
  FIXED_SESSION_ID_PATHS,
} from '~/server/crowi/session-id';
import { generateUnavailableWhenMaintenanceModeMiddlewareForApi } from '~/server/middlewares/unavailable-when-maintenance-mode';
import { setup as setupApiV3 } from '~/server/routes/apiv3';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { AiUsageReport } from '../../../interfaces/ai-usage-report';
import { buildAiUsageReport } from '../../services/build-ai-usage-report';

// Building the real apiv3 routers runs every route's setup; these two read
// singletons that only a full server boot instantiates.
vi.mock('~/server/service/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/service/import')>()),
  getImportService: () => ({}),
}));
vi.mock('~/server/service/export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/service/export')>()),
  exportService: {},
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/fetch-model-catalog',
  () => ({
    fetchModelsDevCatalog: vi.fn(async () => BUNDLED_CATALOG_MODELS),
  }),
);

// Pass-through spy: the catalog case needs the real report.
vi.mock('../../services/build-ai-usage-report', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../services/build-ai-usage-report')
    >();
  return { ...actual, buildAiUsageReport: vi.fn(actual.buildAiUsageReport) };
});

// RateLimiterMongo's default collection on the mongoose connection.
const RATE_LIMIT_COLLECTION = 'rlflx';
const SESSION_COLLECTION = 'sessions_ai_usage_integ';

const ENDPOINT = '/_api/v3/ai-usage';
// A path that only the main apiv3 router (behind the maintenance check) could serve.
const PATH_BEHIND_MAINTENANCE_CHECK = '/_api/v3/ai-usage-probe-unmounted';

const sinceOneHourAgo = (): string =>
  new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe('GET /_api/v3/ai-usage behind the real middleware order', () => {
  const crowi = mockDeep<Crowi>();
  let app: Express;

  beforeAll(async () => {
    await configManager.loadConfigs();
    // apiv3 route setups look the User model up by name.
    const { default: userModelFactory } = await import('~/server/models/user');
    userModelFactory(crowi);

    const { default: MongoStore } = await import('connect-mongo');
    const sessionConfig: SessionConfig = {
      rolling: true,
      secret: 'ai-usage-integ-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 60_000 },
      genid: createSessionIdGenerator(FIXED_SESSION_ID_PATHS),
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: SESSION_COLLECTION,
      }),
    };
    // A deep mock types every field as a mock, so plain values go in via assign.
    Object.assign(crowi, {
      node_env: 'test',
      publicDir: os.tmpdir(),
      sessionConfig,
    });

    app = express();
    // Session, CSRF protection and passport, as at server boot.
    setupExpressInit(crowi, app);

    // The apiv3 routers are module-level singletons, so build them only once.
    const [router, routerForAdmin] = setupApiV3(crowi, app);

    // Same order as server/routes/index.js.
    app.use(rateLimiterFactory());
    app.use('/_api/v3', routerForAdmin);
    app.use(
      '/_api/v3',
      generateUnavailableWhenMaintenanceModeMiddlewareForApi(crowi),
      router,
    );
  });

  beforeEach(async () => {
    crowi.appService.isMaintenanceMode.mockReturnValue(false);
    vi.mocked(buildAiUsageReport).mockClear();
    await prisma.mastrarefreshedmodelcatalogs.deleteMany();
    // Every case shares the loopback address, hence one rate-limit bucket.
    await mongoose.connection.collection(RATE_LIMIT_COLLECTION).deleteMany({});
    await mongoose.connection.collection(SESSION_COLLECTION).deleteMany({});
  });

  afterEach(async () => {
    await prisma.mastrarefreshedmodelcatalogs.deleteMany();
  });

  afterAll(async () => {
    await mongoose.connection.collection(SESSION_COLLECTION).drop();
  });

  it('answers 200 without any credentials', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ since: sinceOneHourAgo() });

    expect(res.status).toBe(200);
    expect(res.body.windows).toHaveLength(1);
  });

  it('answers 200 while maintenance mode is on', async () => {
    crowi.appService.isMaintenanceMode.mockReturnValue(true);

    const blocked = await request(app).get(PATH_BEHIND_MAINTENANCE_CHECK);
    const res = await request(app)
      .get(ENDPOINT)
      .query({ since: sinceOneHourAgo() });

    expect(blocked.status).toBe(503);
    expect(res.status).toBe(200);
  });

  it('answers 200 while AI is not ready', async () => {
    expect(isAiReady()).toBe(false);

    const res = await request(app)
      .get(ENDPOINT)
      .query({ since: sinceOneHourAgo() });

    expect(res.status).toBe(200);
  });

  it('reports the refreshed catalog fetch time after a catalog refresh', async () => {
    const before = await request(app)
      .get(ENDPOINT)
      .query({ since: sinceOneHourAgo() });
    const beforeCatalog = (before.body as AiUsageReport).catalog;

    const { fetchedAt } = await refreshModelCatalog();

    const after = await request(app)
      .get(ENDPOINT)
      .query({ since: sinceOneHourAgo() });
    const afterCatalog = (after.body as AiUsageReport).catalog;

    expect(beforeCatalog.source).toBe('bundled');
    expect(afterCatalog).toEqual({
      source: 'refreshed',
      contentFetchedAt: fetchedAt.toISOString(),
    });
    expect(afterCatalog.contentFetchedAt).not.toBe(
      beforeCatalog.contentFetchedAt,
    );
  });

  it('answers 429 to the 6th request within a minute from the same address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: requests must be sequential to count against the limit in order
      const res = await request(app)
        .get(ENDPOINT)
        .query({ since: sinceOneHourAgo() });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it.each([
    '/_API/V3/AI-Usage',
    '/_api/v3/ai-usage/',
    '/_api/v3//ai-usage',
  ])('answers 404 to %s without aggregating', async (path) => {
    const res = await request(app)
      .get(path)
      .query({ since: sinceOneHourAgo() });

    expect(res.status).toBe(404);
    expect(buildAiUsageReport).not.toHaveBeenCalled();
  });

  it('answers 405 to HEAD without aggregating', async () => {
    const res = await request(app)
      .head(ENDPOINT)
      .query({ since: sinceOneHourAgo() });

    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
    expect(buildAiUsageReport).not.toHaveBeenCalled();
  });

  it('keeps a single session however many cookie-less requests arrive', async () => {
    const sessions = mongoose.connection.collection(SESSION_COLLECTION);

    for (let i = 0; i < 8; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose, past the rate limit as well
      await request(app).get(ENDPOINT).query({ since: sinceOneHourAgo() });
    }

    expect(await sessions.countDocuments()).toBe(1);
  });
});
