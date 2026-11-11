/**
 * Unit tests for buildUserActivityPipeline's pipeline-shape contract.
 *
 * Regression: `user` was previously matched with a raw `mongoose.Types.ObjectId`
 * instance, which serializes to a plain JSON string when sent through
 * `aggregateRaw` -- that does NOT match a stored ObjectId-typed field, so
 * `GET /api/v3/user-activities` silently returned zero results for every
 * user (verified against a real MongoDB replica set). `user` must be
 * wrapped via `toRawObjectId` (the MongoDB Extended JSON `$oid` form)
 * instead.
 */
import type { IUserHasId } from '@growi/core';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { aggregateUserActivities } from '~/server/service/activity/aggregate-user-activities';
import { buildListablePageFilter } from '~/server/service/activity/build-listable-page-filter';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import addCustomFunctionToResponse from './response';
import { buildUserActivityPipeline, setup } from './user-activities';

const mocks = vi.hoisted(() => ({ findUserById: vi.fn() }));

// Stands in for the real login check: rejects a request without a user.
vi.mock('~/server/middlewares/login-required', () => ({
  default:
    () =>
    (
      req: express.Request & { user?: IUserHasId },
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.user == null) {
        res.sendStatus(401);
        return;
      }
      next();
    },
}));

vi.mock('mongoose', async (importOriginal) => {
  const original = await importOriginal<typeof import('mongoose')>();
  return {
    ...original,
    default: {
      ...original.default,
      model: () => ({ findById: mocks.findUserById }),
    },
  };
});

vi.mock('~/server/service/activity/build-listable-page-filter', () => ({
  buildListablePageFilter: vi.fn(),
}));

vi.mock('~/server/service/activity/aggregate-user-activities', () => ({
  aggregateUserActivities: vi.fn(),
  aggregateUserActivitiesLegacy: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/utils/prisma', () => ({ prisma: {} }));

describe('buildUserActivityPipeline', () => {
  const targetUserId = '507f1f77bcf86cd799439011';

  it('matches `user` with the $oid Extended JSON form, not a raw ObjectId/string', () => {
    const pipeline = buildUserActivityPipeline(targetUserId, {
      limit: 10,
      offset: 0,
    });

    const matchStage = pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match.user).toEqual({ $oid: targetUserId });
  });

  it('applies the requested limit/offset inside the docs facet', () => {
    const pipeline = buildUserActivityPipeline(targetUserId, {
      limit: 5,
      offset: 15,
    });

    const facetStage = pipeline[1] as {
      $facet: { docs: Record<string, unknown>[] };
    };
    expect(facetStage.$facet.docs).toContainEqual({ $skip: 15 });
    expect(facetStage.$facet.docs).toContainEqual({ $limit: 5 });
  });

  it('produces a totalCount facet via $count', () => {
    const pipeline = buildUserActivityPipeline(targetUserId, {
      limit: 10,
      offset: 0,
    });

    const facetStage = pipeline[1] as {
      $facet: { totalCount: Record<string, unknown>[] };
    };
    expect(facetStage.$facet.totalCount).toEqual([{ $count: 'count' }]);
  });
});

describe('GET /user-activities', () => {
  const VIEWER_ID = '507f1f77bcf86cd799439011';
  const TARGET_ID = '507f1f77bcf86cd799439022';
  const PAGE_FILTER = { $and: [{ grant: 1 }] };

  const viewer = mock<IUserHasId>({ _id: VIEWER_ID, username: 'viewer' });

  // A stored user carries far more than the response may expose.
  const storedUser = (id: string) => ({
    _id: id,
    username: `user-${id}`,
    name: `Name ${id}`,
    imageUrlCached: '/images/icons/user.svg',
    email: 'secret@example.com',
    password: 'hashed-password',
    apiToken: 'api-token',
    admin: true,
  });

  const row = (n: number) => ({
    _id: `65a000000000000000000${100 + n}`,
    action: 'PAGE_UPDATE' as const,
    createdAt: new Date(Date.UTC(2026, 0, n)),
    target: { _id: `65b000000000000000000${100 + n}`, path: `/page-${n}` },
  });

  const buildApp = (user?: IUserHasId) => {
    addCustomFunctionToResponse(express);
    const app = express();
    app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
      req.user = user;
      next();
    });
    app.use('/user-activities', setup(mock<Crowi>()));
    return app;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findUserById.mockImplementation(async (id: string) => storedUser(id));
    vi.mocked(buildListablePageFilter).mockResolvedValue(PAGE_FILTER);
    vi.mocked(aggregateUserActivities).mockResolvedValue({
      docs: [],
      totalCount: 0,
    });
    vi.mocked(configManager.getConfig).mockReturnValue(20);
  });

  it('rejects a request that is not logged in without querying anything', async () => {
    const res = await request(buildApp()).get('/user-activities');

    expect(res.status).toBe(401);
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(aggregateUserActivities).not.toHaveBeenCalled();
  });

  it("asks for the caller's own activities when targetUserId is omitted", async () => {
    const res = await request(buildApp(viewer)).get('/user-activities');

    expect(res.status).toBe(200);
    expect(aggregateUserActivities).toHaveBeenCalledExactlyOnceWith(
      prisma,
      expect.objectContaining({ targetUserId: VIEWER_ID }),
    );
  });

  it('asks for the specified user, limited to the pages listable for the caller', async () => {
    const res = await request(buildApp(viewer))
      .get('/user-activities')
      .query({ targetUserId: TARGET_ID, limit: 100, offset: 40 });

    expect(res.status).toBe(200);
    expect(vi.mocked(buildListablePageFilter).mock.calls).toHaveLength(1);
    expect(vi.mocked(buildListablePageFilter).mock.calls[0][0]).toBe(viewer);
    expect(aggregateUserActivities).toHaveBeenCalledExactlyOnceWith(prisma, {
      targetUserId: TARGET_ID,
      pageFilter: PAGE_FILTER,
      limit: 100,
      offset: 40,
    });
  });

  it.each([
    ['targetUserId is not an ObjectId', { targetUserId: 'not-an-object-id' }],
    ['limit is 101', { limit: 101 }],
    ['limit is 0', { limit: 0 }],
    ['limit is not an integer', { limit: 'abc' }],
    ['offset is negative', { offset: -1 }],
    ['offset is not an integer', { offset: '1.5' }],
  ])('responds 400 without querying when %s', async (_label, query) => {
    const res = await request(buildApp(viewer))
      .get('/user-activities')
      .query(query);

    expect(res.status).toBe(400);
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(aggregateUserActivities).not.toHaveBeenCalled();
  });

  it('uses the configured default page size when limit is omitted', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(30);

    const res = await request(buildApp(viewer)).get('/user-activities');

    expect(aggregateUserActivities).toHaveBeenCalledExactlyOnceWith(
      prisma,
      expect.objectContaining({ limit: 30, offset: 0 }),
    );
    expect(res.body.serializedPaginationResult.limit).toBe(30);
  });

  it('falls back to 10 when limit is omitted and no default is configured', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(undefined);

    const res = await request(buildApp(viewer)).get('/user-activities');

    expect(res.body.serializedPaginationResult.limit).toBe(10);
  });

  it('returns an empty list without running the activity queries when the target user does not exist', async () => {
    mocks.findUserById.mockResolvedValue(null);

    const res = await request(buildApp(viewer))
      .get('/user-activities')
      .query({ targetUserId: TARGET_ID, limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.serializedPaginationResult).toMatchObject({
      docs: [],
      totalDocs: 0,
      limit: 5,
      offset: 0,
      totalPages: 0,
      hasPrevPage: false,
      hasNextPage: false,
    });
    expect(buildListablePageFilter).not.toHaveBeenCalled();
    expect(aggregateUserActivities).not.toHaveBeenCalled();
  });

  it('returns each row with its page and only the four public fields of the user', async () => {
    vi.mocked(aggregateUserActivities).mockResolvedValue({
      docs: [row(2), row(1)],
      totalCount: 2,
    });

    const res = await request(buildApp(viewer))
      .get('/user-activities')
      .query({ targetUserId: TARGET_ID });

    const expectedUser = {
      _id: TARGET_ID,
      username: `user-${TARGET_ID}`,
      name: `Name ${TARGET_ID}`,
      imageUrlCached: '/images/icons/user.svg',
    };
    expect(res.body.serializedPaginationResult.docs).toEqual([
      {
        _id: row(2)._id,
        action: 'PAGE_UPDATE',
        createdAt: row(2).createdAt.toISOString(),
        target: row(2).target,
        user: expectedUser,
      },
      {
        _id: row(1)._id,
        action: 'PAGE_UPDATE',
        createdAt: row(1).createdAt.toISOString(),
        target: row(1).target,
        user: expectedUser,
      },
    ]);
  });

  it('computes the paging values from the total count, limit and offset', async () => {
    vi.mocked(aggregateUserActivities).mockResolvedValue({
      docs: [row(1)],
      totalCount: 45,
    });

    const res = await request(buildApp(viewer))
      .get('/user-activities')
      .query({ limit: 20, offset: 20 });

    expect(res.body.serializedPaginationResult).toMatchObject({
      totalDocs: 45,
      limit: 20,
      offset: 20,
      page: 2,
      totalPages: 3,
      hasPrevPage: true,
      hasNextPage: true,
      prevPage: 1,
      nextPage: 3,
      pagingCounter: 21,
    });
  });

  it.each([
    [
      'the activity queries fail',
      () =>
        vi
          .mocked(aggregateUserActivities)
          .mockRejectedValue(
            new Error(
              'unexpected activity row {"target":"65b000000000000000000101","path":"/secret/plan"}',
            ),
          ),
    ],
    [
      'building the page filter fails',
      () =>
        vi
          .mocked(buildListablePageFilter)
          .mockRejectedValue(new Error('group 65b000000000000000000101')),
    ],
  ])('responds 500 with a fixed message only when %s', async (_label, arrange) => {
    arrange();

    const res = await request(buildApp(viewer)).get('/user-activities');

    expect(res.status).toBe(500);
    expect(res.body.errors).toEqual([
      { message: 'Failed to get user activities.', status: 500 },
    ]);
    expect(res.text).not.toContain('65b000000000000000000101');
    expect(res.text).not.toContain('/secret/plan');
  });
});
