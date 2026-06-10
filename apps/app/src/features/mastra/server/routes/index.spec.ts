import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { LlmVendor } from '~/features/mastra/interfaces/llm-vendor';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { MastraModelResolution } from '../services/ai-sdk-modules/resolve-mastra-model';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock() hoisting applies.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  isAiEnabled: vi.fn<() => boolean>(),
  resolveMastraModel: vi.fn<() => MastraModelResolution>(),
  loggerError: vi.fn(),
}));

vi.mock('~/features/openai/server/services', () => ({
  isAiEnabled: mocks.isAiEnabled,
}));

vi.mock('../services/ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: mocks.resolveMastraModel,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
    debug: vi.fn(),
  }),
}));

// Stub the real-route modules so route registration is side-effect-free and
// each registers a distinguishable handler. These factories normally require a
// Crowi instance + MongoDB; the gate must shadow them when disabled, and when
// `ok` the POST /message handler below must be reachable.
vi.mock('./post-message', () => ({
  postMessageHandlersFactory: () => [
    (_req: express.Request, res: express.Response) =>
      res.status(200).json({ route: 'post-message' }),
  ],
}));
vi.mock('./get-threads', () => ({
  getThreadsFactory: () => (_req: express.Request, res: express.Response) =>
    res.status(200).json({ route: 'get-threads' }),
}));
vi.mock('./delete-thread', () => ({
  deleteThreadHandlersFactory:
    () => (_req: express.Request, res: express.Response) =>
      res.status(200).json({ route: 'delete-thread' }),
}));
vi.mock('./get-messages', () => ({
  getMessagesHandlersFactory:
    () => (_req: express.Request, res: express.Response) =>
      res.status(200).json({ route: 'get-messages' }),
}));

// Imported after mocks so the factory picks up the mocked dependencies.
import { factory } from './index';

const PLANTED_API_KEY = 'sk-super-secret-planted-key-do-not-leak';

// Attach `res.apiv3Err(err, status)` mirroring the production helper
// (server/routes/apiv3/response.js) so the catch-all handlers in the factory
// serialize errors and set the status the same way the real server would.
const installApiv3Err = (app: express.Express): void => {
  app.use((_req, res: ApiV3Response, next) => {
    res.apiv3Err = (err: { message?: string }, status = 400) => {
      res.status(status).json({ errors: [{ message: err?.message }] });
      return res;
    };
    next();
  });
};

const buildApp = (): express.Express => {
  const crowi = mock<Crowi>();
  const app = express();
  installApiv3Err(app);
  app.use('/_api/v3/mastra', factory(crowi));
  return app;
};

// Wait for the async `import().then()` route registrations to flush so the
// registered routes are visible to assertions.
const flushRouteRegistration = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mastra routes factory — availability gate', () => {
  it('does not throw and returns a router for any config (app boots)', () => {
    mocks.isAiEnabled.mockReturnValue(false);
    mocks.resolveMastraModel.mockReturnValue({
      status: 'disabled',
      reason: { type: 'vendor-unset' },
    });

    let router: express.Router | undefined;
    expect(() => {
      router = factory(mock<Crowi>());
    }).not.toThrow();
    expect(router).toBeDefined();
  });

  describe('when AI is disabled', () => {
    it('returns 501 for a mastra route (existing behavior preserved)', async () => {
      mocks.isAiEnabled.mockReturnValue(false);
      // resolver must not be consulted when AI is disabled, but provide a value.
      mocks.resolveMastraModel.mockReturnValue({
        status: 'ok',
        vendor: 'openai',
        model: mock(),
      });

      const app = buildApp();
      await flushRouteRegistration();

      const res = await request(app).post('/_api/v3/mastra/message').send({});
      expect(res.status).toBe(501);
      expect(JSON.stringify(res.body)).toContain('GROWI AI is not enabled');
    });
  });

  describe('when AI is enabled but the resolver is disabled', () => {
    it('returns 503 with a generic client message and shadows the real routes', async () => {
      mocks.isAiEnabled.mockReturnValue(true);
      mocks.resolveMastraModel.mockReturnValue({
        status: 'disabled',
        reason: { type: 'vendor-unset' },
      });

      const app = buildApp();
      await flushRouteRegistration();

      const res = await request(app).post('/_api/v3/mastra/message').send({});
      expect(res.status).toBe(503);

      const serialized = JSON.stringify(res.body);
      // Generic, non-leaking message reaches the client...
      expect(serialized).toContain('AI assistant is not available');
      // ...and the specific reason is NOT leaked to the client.
      expect(serialized).not.toContain('vendor-unset');
      // The 503 catch-all shadows the real route.
      expect(serialized).not.toContain('post-message');
    });

    it('logs the reason type via logger.error (Req 4.2)', async () => {
      mocks.isAiEnabled.mockReturnValue(true);
      mocks.resolveMastraModel.mockReturnValue({
        status: 'disabled',
        reason: { type: 'vendor-unset' },
      });

      buildApp();
      await flushRouteRegistration();

      expect(mocks.loggerError).toHaveBeenCalledTimes(1);
      const loggedPayload = mocks.loggerError.mock.calls[0]?.[0];
      expect(loggedPayload).toMatchObject({ reason: 'vendor-unset' });
    });

    it('logs vendor for api-key-missing but never the apiKey value (Req 2.5)', async () => {
      const vendor: LlmVendor = 'openai';
      mocks.isAiEnabled.mockReturnValue(true);
      // The disabled reason for api-key-missing carries the vendor only — the
      // resolver never surfaces the apiKey. We still assert the logged content
      // excludes a planted secret to guard against accidental key leakage.
      mocks.resolveMastraModel.mockReturnValue({
        status: 'disabled',
        reason: { type: 'api-key-missing', vendor },
      });

      buildApp();
      await flushRouteRegistration();

      expect(mocks.loggerError).toHaveBeenCalledTimes(1);
      const [payload, message] = mocks.loggerError.mock.calls[0] ?? [];
      expect(payload).toMatchObject({ reason: 'api-key-missing', vendor });

      const logged = JSON.stringify({ payload, message });
      expect(logged).not.toContain(PLANTED_API_KEY);
      expect(logged).not.toContain('apiKey');
    });
  });

  describe('when AI is enabled and the resolver is ok', () => {
    it('registers no catch-all so a real route is reachable (Req 4.3)', async () => {
      mocks.isAiEnabled.mockReturnValue(true);
      mocks.resolveMastraModel.mockReturnValue({
        status: 'ok',
        vendor: 'openai',
        model: mock(),
      });

      const app = buildApp();
      await flushRouteRegistration();

      const res = await request(app).post('/_api/v3/mastra/message').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route: 'post-message' });

      expect(mocks.loggerError).not.toHaveBeenCalled();
    });
  });
});
