import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { createChatIntegrationRouter } from './index';

/**
 * `createChatIntegrationRouter` threads `crowi` through to the `command`
 * op's handler (task 5.1). Neither test below exercises a route that reads
 * `crowi`, so an auto-stubbed mock is enough.
 */
const buildMockCrowi = (): Crowi => mock<Crowi>();

describe('chat-integration feature entry point statically wires all 11 models', () => {
  // Task 1.2 completion criterion: "起動すると 11 個のコレクションと索引が
  // 実際に作られる" -- importing this entry point (as `server/routes/apiv3`
  // does at boot) must be sufficient, by itself, to register every model
  // this spec owns with Mongoose. If a model were only reachable via a
  // lazy/dynamic import, this test would fail because `mongoose.models`
  // would be missing it even though `./index` was already imported above.
  const expectedModelNames = [
    'ChatRelation',
    'ChatNotificationDestination',
    'ChatProcessedRequest',
    'ChatRequestNonce',
    'ChatAccountLink',
    'ChatAccountLinkOrder',
    'ChatIntegrationKey',
    'ChatPendingPairing',
    'ChatChallengeAttempt',
    'ChatNotificationOutbox',
    'ChatChannelPermission',
  ];

  it.each(
    expectedModelNames,
  )('registers the %s model as a side effect of importing the entry point', (modelName) => {
    expect(mongoose.models[modelName]).toBeDefined();
  });

  it('registers exactly 11 models', () => {
    const registered = expectedModelNames.filter(
      (name) => mongoose.models[name] != null,
    );
    expect(registered).toHaveLength(11);
  });
});

describe('createChatIntegrationRouter', () => {
  it('returns an Express Router that can be mounted without throwing', () => {
    expect(() => {
      const app = express();
      app.use(
        '/chat-integration',
        createChatIntegrationRouter(buildMockCrowi()),
      );
    }).not.toThrow();
  });

  it('responds to a request under its mount path (no route yet, but does not crash the app)', async () => {
    const app = express();
    app.use('/chat-integration', createChatIntegrationRouter(buildMockCrowi()));

    // No route is registered yet (added by later tasks), so Express's
    // default "no route matched" behavior (404) is the expected response.
    // A 5xx here would mean the router crashed the request pipeline.
    const response = await request(app).get('/chat-integration/anything');
    expect(response.status).toBe(404);
  });
});
