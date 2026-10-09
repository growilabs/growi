// Proves the routing-level contract of Requirement 2.2's save-time picker:
// the channel list is reachable by an ORDINARY logged-in editor (not only
// an administrator -- the person choosing a destination here is whoever is
// saving the page), and not reachable at all without a session.
//
// Uses the REAL `loginRequiredFactory`, same convention as
// `manage-account-links-router.spec.ts`.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { ChatRelation } from '../models/chat-relation';
import * as proxyClient from '../proxy-client';
import { createSaveTimeChannelsRouter } from './save-time-channels-router';

vi.mock('../proxy-client', async (importOriginal) => {
  const actual = await importOriginal<typeof proxyClient>();
  return { ...actual, fetchChannels: vi.fn() };
});

const MOUNT_PATH = '/_api/v3/chat-integration/notification-channels';

const nonAdminUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'editor',
  status: 2, // UserStatus.STATUS_ACTIVE -- loginRequiredFactory gates on this
  admin: false,
} as IUserHasId;

const readOnlyUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'read-only-editor',
  status: 2,
  admin: false,
  readOnly: true,
} as IUserHasId;

const buildApp = (injectUser?: IUserHasId): Express => {
  const responseHelpers: { response: Record<string, unknown> } = {
    response: {},
  };
  addCustomFunctionToResponse(responseHelpers);

  const app = express();
  app.use(express.json());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    Object.assign(res, responseHelpers.response);
    next();
  });
  if (injectUser != null) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: IUserHasId }).user = injectUser;
      next();
    });
  }
  app.use(MOUNT_PATH, createSaveTimeChannelsRouter(mock<Crowi>()));
  return app;
};

const seedRelation = () =>
  ChatRelation.create({
    relationId: 'relation-under-test',
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: 'workspace-0001',
    workspaceName: 'Test Workspace',
    label: null,
    state: 'active',
    settingsVersion: 0,
    createdAt: new Date(),
  });

describe('save-time-channels-router', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_save_time_channels_router',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await ChatRelation.deleteMany({});
  });

  it('gives an ordinary logged-in editor the channels to pick from', async () => {
    await seedRelation();
    vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
      ok: true,
      response: {
        channels: [
          {
            platform: 'slack',
            channelId: 'C0001',
            channelName: 'general',
            isPrivate: false,
          },
        ],
      },
    });

    const response = await request(buildApp(nonAdminUser)).get(MOUNT_PATH);

    expect(response.status).toBe(200);
    expect(response.body.channels).toEqual([
      {
        relationId: 'relation-under-test',
        workspaceName: 'Test Workspace',
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
    ]);
  });

  it('refuses a request with no logged-in user', async () => {
    await seedRelation();

    const response = await request(buildApp()).get(MOUNT_PATH);

    expect(response.status).toBe(403);
    expect(proxyClient.fetchChannels).not.toHaveBeenCalled();
  });

  it('refuses a read-only user -- they cannot save a page either, so they must not be able to enumerate paired channels', async () => {
    await seedRelation();

    const response = await request(buildApp(readOnlyUser)).get(MOUNT_PATH);

    expect(response.status).toBe(400);
    expect(proxyClient.fetchChannels).not.toHaveBeenCalled();
  });
});
