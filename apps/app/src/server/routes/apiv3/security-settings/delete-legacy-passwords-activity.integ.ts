/**
 * Drift guard for rules/activity-recording.md Rule 1: the delete-legacy-passwords
 * handler must emit its activity before the response finishes, so the settled
 * ADMIN_LEGACY_PASSWORD_DELETE row keeps its operator.
 *
 * The fake `res` fires 'finish' synchronously from `apiv3()`, so the failsafe
 * finalizer clears the pending context the instant the response is sent; only
 * an emit that precedes `apiv3()` can preserve the operator. The emit, the
 * ActivityService listener, settle and prisma are all real.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import { EventEmitter } from 'node:events';
import type { IUserHasId } from '@growi/core';
import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { deleteLegacyPasswordsHandlersFactory } from './delete-legacy-passwords';

const TEST_IP = '10.0.0.113';
const TEST_ENDPOINT = '/_api/v3/security-setting/legacy-passwords-integ';
const TEST_USERNAME = 'delete-legacy-passwords-integ-admin';

async function waitForActivityRows(
  where: { id: string },
  maxWaitMs = 5000,
): Promise<Awaited<ReturnType<typeof prisma.activities.findMany>>> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    // biome-ignore lint/performance/noAwaitInLoops: polling must be sequential
    const rows = await prisma.activities.findMany({ where });
    if (rows.length > 0) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `no activity row appeared within ${maxWaitMs}ms for ${JSON.stringify(where)}`,
  );
}

describe('delete-legacy-passwords — emits the delete activity before the response', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();

    testUser = await crowi.models.User.create({
      name: 'Delete Legacy Passwords Integ Admin',
      username: TEST_USERNAME,
      email: 'delete-legacy-passwords-integ@example.com',
      admin: true,
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });

    // ADMIN_LEGACY_PASSWORD_DELETE is in LargeActionGroup only.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  it('settles the ADMIN_LEGACY_PASSWORD_DELETE activity with the operator even when the response finishes immediately', async () => {
    const emitter = new EventEmitter();
    const resState = { statusCode: 200 };
    const apiv3 = vi.fn(() => {
      emitter.emit('finish');
    });
    const res = {
      locals: {} as Record<string, unknown>,
      writableFinished: false,
      get statusCode() {
        return resState.statusCode;
      },
      on: emitter.on.bind(emitter),
      apiv3,
      apiv3Err: vi.fn(),
    } as unknown as ApiV3Response;

    const req = mock<Request & { user?: IUserHasId }>({
      method: 'DELETE',
      ip: TEST_IP,
      originalUrl: TEST_ENDPOINT,
      // Not the mongoose User document: wrapping it in vitest-mock-extended's proxy breaks its getters
      user: mock<IUserHasId>({
        _id: testUserId.toHexString(),
        username: TEST_USERNAME,
      }),
    });

    const addActivity = generateAddActivityMiddleware();
    addActivity(req, res, () => {});
    const activityId = res.locals.activity._id as string;

    const handlers = deleteLegacyPasswordsHandlersFactory(crowi);
    const terminalHandler = handlers[handlers.length - 1] as RequestHandler;
    await terminalHandler(req, res, () => {});

    expect(apiv3).toHaveBeenCalledTimes(1);
    const rows = await waitForActivityRows({ id: activityId });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(
      SupportedAction.ACTION_ADMIN_LEGACY_PASSWORD_DELETE,
    );
    expect(rows[0].userId).toBe(testUserId.toHexString());
  });
});
