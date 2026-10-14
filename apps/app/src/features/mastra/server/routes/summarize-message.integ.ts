/**
 * Drift guard (rules/activity-recording.md Rule 1): the PAGE_AI_SUMMARIZE row
 * must settle with its operator. The emit runs inside the stream's `execute`,
 * before the response ends; moved after the response finishes, the fail-safe
 * finalizer clears the pending context first and the row settles with
 * `user: null`.
 *
 * Real: addActivity, the ActivityService listener, settle, prisma, and the
 * route's HTTP stream. Mocked: the Mastra registry barrel and toAISdkStream
 * (cannot load under vitest), model-key resolution, and the Page lookup.
 */

import type { IUserHasId } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import type { PageDocument, PageModel } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

const mocks = vi.hoisted(() => ({ getAgent: vi.fn() }));

vi.mock('~/features/mastra/server/services/mastra-modules', () => ({
  mastra: { getAgent: mocks.getAgent },
}));

vi.mock('@mastra/ai-sdk', () => ({
  toAISdkStream: (stream: { uiChunks: unknown[] }) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of stream.uiChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
}));

vi.mock('../services/ai-sdk-modules/llm-providers/effective-model-key', () => ({
  resolveEffectiveModelKey: () => 'openai/test-model',
}));
vi.mock('../services/ai-sdk-modules/resolve-provider-options', () => ({
  getProviderOptionsForModel: () => ({}),
}));

const TEST_USERNAME = 'summarize-message-integ-user';

const SUMMARY_CHUNKS = [
  { type: 'start' },
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', delta: 'A summary.' },
  { type: 'text-end', id: 'text-1' },
  { type: 'finish' },
];

async function waitForActivityRows(
  where: { id: string },
  maxWaitMs = 5000,
): Promise<Awaited<ReturnType<typeof prisma.activities.findMany>>> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    // biome-ignore lint/performance/noAwaitInLoops: polling until the async settle lands
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

describe('POST /summary — settles PAGE_AI_SUMMARIZE with its operator (drift guard)', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  const activityIds: string[] = [];

  beforeAll(async () => {
    crowi = await getInstance();
    testUser = await crowi.models.User.create({
      name: 'Summarize Message Integ User',
      username: TEST_USERNAME,
      email: 'summarize-message-integ@example.com',
    });
  }, 120_000);

  beforeEach(async () => {
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { id: { in: activityIds } } });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  it('records the summarize row with the requesting user', async () => {
    const page = {
      _id: new Types.ObjectId(),
      path: '/summarize-message-integ-target',
      revision: new Types.ObjectId(),
    };
    vi.spyOn(
      mongoose.model<PageDocument, PageModel>('Page'),
      'findByIdAndViewer',
    ).mockResolvedValue(page as unknown as HydratedDocument<PageDocument>);

    const memory = {
      createThread: vi.fn(
        async ({ resourceId, threadId }: Record<string, string>) => ({
          id: threadId,
          resourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    };
    mocks.getAgent.mockReturnValue({
      getMemory: async () => memory,
      stream: async () => ({
        uiChunks: SUMMARY_CHUNKS,
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        steps: Promise.resolve([]),
      }),
    });

    const { summarizeMessageHandlersFactory } = await import(
      './summarize-message'
    );
    const handlers = summarizeMessageHandlersFactory(crowi);
    const terminalHandler = handlers[handlers.length - 1];

    addCustomFunctionToResponse(express);
    const app = express();
    app.use(express.json());
    app.post(
      '/summary',
      (req: Request, _res: Response, next: NextFunction) => {
        Object.assign(req, { user: testUser });
        next();
      },
      generateAddActivityMiddleware(),
      (_req: Request, res: Response, next: NextFunction) => {
        activityIds.push(res.locals.activity._id);
        next();
      },
      terminalHandler,
    );

    await request(app)
      .post('/summary')
      .send({ pageId: page._id.toString() })
      .expect(200);

    const [activityId] = activityIds;
    const rows = await waitForActivityRows({ id: activityId });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(SupportedAction.ACTION_PAGE_AI_SUMMARIZE);
    expect(rows[0].userId).toBe(testUser._id.toString());
  });
});
