/**
 * Integration test for POST /app-settings/repair-page-tree.
 *
 * Contract under test (HTTP response + whether the repair is started):
 *  - it refuses outside maintenance mode, because the repair deletes pages and
 *    rewrites descendantCount across the collection while edits are live;
 *  - it refuses to stack a second run on one already in progress (the admin UI
 *    disables its button, but that state is per-browser and a reload clears it);
 *  - when both gates pass it starts the repair and answers immediately.
 *
 * The service is mocked at the module boundary — whether it *ran* is the outcome
 * the gates control. Its own behaviour is covered by
 * service/page/repair-page-tree/index.integ.ts.
 */
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

const mockActivityId = '507f1f77bcf86cd799439011';

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

const mockAddActivityMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.locals = res.locals || {};
  res.locals.activity = { _id: mockActivityId };
  next();
};

// Auth is not what these tests are about; the route's own gates are.
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));
vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));
vi.mock('../../../middlewares/add-activity', () => ({
  generateAddActivityMiddleware: () => mockAddActivityMiddleware,
}));

const mockRepairPageTree = vi.fn();
const mockIsRepairPageTreeRunning = vi.fn();
const activityEmit = vi.fn();
vi.mock('~/server/service/page/repair-page-tree', () => ({
  repairPageTree: (...args: unknown[]) => mockRepairPageTree(...args),
  isRepairPageTreeRunning: () => mockIsRepairPageTreeRunning(),
}));

describe('POST /app-settings/repair-page-tree', () => {
  let app: express.Application;
  let isMaintenanceMode = true;

  // Mounted ONCE: app-settings/index.ts creates its Router at module scope, so a
  // second setup() call stacks another copy of every handler and the first copy —
  // closed over the first crowi mock — is what serves requests. Per-test state has
  // to reach the handler through mutable closures, not a rebuilt crowi.
  beforeAll(async () => {
    const s2sMessagingServiceMock = mock<S2sMessagingService>();
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
    await configManager.loadConfigs();

    const crowiMock = mock<Crowi>({
      events: { activity: { emit: activityEmit } },
      appService: { isMaintenanceMode: () => isMaintenanceMode },
    });

    app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      const apiRes = res as ApiV3Response;
      apiRes.apiv3 = (data) => res.json(data);
      apiRes.apiv3Err = (error, statusCode = 400) =>
        res.status(statusCode).json({ error });
      next();
    });

    const { setup } = await import('./index');
    app.use('/', setup(crowiMock));
  });

  beforeEach(() => {
    isMaintenanceMode = true;
    activityEmit.mockReset();
    mockRepairPageTree.mockReset().mockResolvedValue({ removedEmptyPages: 0 });
    mockIsRepairPageTreeRunning.mockReset().mockReturnValue(false);
  });

  it('starts the repair when in maintenance mode and nothing is running', async () => {
    const res = await request(app).post('/repair-page-tree').expect(200);

    expect(res.body.isStarted).toBe(true);
    expect(mockRepairPageTree).toHaveBeenCalledTimes(1);
  });

  it('refuses to start outside maintenance mode', async () => {
    isMaintenanceMode = false;

    const res = await request(app).post('/repair-page-tree').expect(400);

    expect(res.body.error.code).toBe('not_maintenance_mode');
    expect(mockRepairPageTree).not.toHaveBeenCalled();
  });

  it('refuses to stack a second run on a repair already in progress', async () => {
    mockIsRepairPageTreeRunning.mockReturnValue(true);

    const res = await request(app).post('/repair-page-tree').expect(400);

    expect(res.body.error.code).toBe('repair_already_running');
    expect(mockRepairPageTree).not.toHaveBeenCalled();
  });

  it('answers without waiting for the repair to finish', async () => {
    // It walks the whole collection; holding the request open would time out.
    let finishRepair: () => void = () => {};
    mockRepairPageTree.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRepair = resolve;
      }),
    );

    await request(app).post('/repair-page-tree').expect(200);

    finishRepair();
  });

  it('records the activity for the started repair', async () => {
    await request(app).post('/repair-page-tree').expect(200);

    // The exact action, not expect.any(String): this row is the operator-facing
    // record of what was run, so emitting some other action must fail here.
    expect(activityEmit).toHaveBeenCalledWith(
      'update',
      mockActivityId,
      expect.objectContaining({
        action: SupportedAction.ACTION_ADMIN_PAGE_TREE_REPAIR,
      }),
    );
  });
});
