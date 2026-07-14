// --- Mock boundary ---------------------------------------------------------
//
// The contract under test is the LAZY LOADING of the mastra route handlers:
// the handler modules (and the heavy @mastra / ai-sdk graph behind them) must
// not be loaded when the router is mounted at boot, and must be loaded exactly
// once — by the first request that passes aiReadyGuard. AI-disabled instances
// therefore never pay the AI stack's memory cost.
//
// Each handler module is mocked with a factory that flips a `loaded` flag.
// vi.mock factories run lazily, on the first import of the mocked module, so
// the flags observe when `./index` first imports each sibling. Note they run
// AT MOST ONCE per test file (vi.resetModules does not re-arm them), so the
// load-timing contract is asserted as a single lifecycle narrative in one test
// — later tests only assert dispatch behavior, not load timing.
//
// aiReadyGuard's collaborators are mocked (not the guard itself): the guard's
// per-request re-evaluation is part of the mounted behavior asserted here.
const loaded = vi.hoisted(() => ({
  postMessage: false,
  getThreads: false,
  deleteThread: false,
  getMessages: false,
  getModels: false,
}));

const aiState = vi.hoisted(() => ({ enabled: false, configured: false }));

const handlerFactorySpies = vi.hoisted(() => ({
  postMessage: vi.fn(),
}));

vi.mock('~/features/openai/server/services', () => ({
  isAiEnabled: () => aiState.enabled,
}));
vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured: () => aiState.configured,
}));

vi.mock('./post-message', () => {
  loaded.postMessage = true;
  return {
    postMessageHandlersFactory: (...args: unknown[]) => {
      handlerFactorySpies.postMessage(...args);
      return (_req: Request, res: Response) =>
        res.status(200).json({ route: 'post-message' });
    },
  };
});
vi.mock('./get-threads', () => {
  loaded.getThreads = true;
  return {
    getThreadsFactory: () => (_req: Request, res: Response) =>
      res.status(200).json({ route: 'get-threads' }),
  };
});
vi.mock('./delete-thread', () => {
  loaded.deleteThread = true;
  return {
    deleteThreadHandlersFactory: () => (_req: Request, res: Response) =>
      res.status(200).json({ route: 'delete-thread' }),
  };
});
vi.mock('./get-messages', () => {
  loaded.getMessages = true;
  return {
    getMessagesHandlersFactory: () => (_req: Request, res: Response) =>
      res.status(200).json({ route: 'get-messages' }),
  };
});
vi.mock('./get-models', () => {
  loaded.getModels = true;
  return {
    getModelsFactory: () => (_req: Request, res: Response) =>
      res.status(200).json({ route: 'get-models' }),
  };
});

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { factory } from './index';

const allLoaded = () => Object.values(loaded);
const NONE_LOADED = [false, false, false, false, false];
const ALL_LOADED = [true, true, true, true, true];

// Let the microtask queue drain so that any eagerly-started dynamic import
// would have completed before we assert "not loaded". Without this, a
// regression to boot-time loading could slip through on timing alone.
const settleImports = () => new Promise((resolve) => setImmediate(resolve));

const buildApp = () => {
  const app = express();
  app.use(express.json());
  // aiReadyGuard responds via res.apiv3Err, which a bare express `res` lacks.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // biome-ignore lint/suspicious/noExplicitAny: test seam to add apiv3 helpers to res
    (res as any).apiv3Err = (_err: unknown, code = 400) =>
      res.status(code).json({ err: true });
    next();
  });
  app.use('/_api/v3/mastra', factory(mock<Crowi>()));
  return app;
};

describe('mastra routes factory (lazy handler loading)', () => {
  // Load timing is a per-process lifecycle: once the handler modules load they
  // stay loaded, so the whole "not loaded until the first authorized request"
  // contract is asserted as one ordered narrative. This test MUST run before
  // any other test triggers an authorized request.
  it('loads the handler modules only at the first request that passes the guard', async () => {
    aiState.enabled = false;
    aiState.configured = false;
    const app = buildApp();
    await settleImports();

    // 1) Mounting alone (= server boot) must not pull the AI stack.
    expect(allLoaded()).toEqual(NONE_LOADED);

    // 2) A request while AI is disabled is rejected by the guard (501)
    //    and still must not load anything.
    const whileDisabled = await request(app).get('/_api/v3/mastra/threads');
    expect(whileDisabled.status).toBe(501);
    expect(allLoaded()).toEqual(NONE_LOADED);

    // 3) Enabled but not configured: same — the guard rejects, nothing loads.
    aiState.enabled = true;
    const whileUnconfigured = await request(app).get('/_api/v3/mastra/threads');
    expect(whileUnconfigured.status).toBe(501);
    expect(allLoaded()).toEqual(NONE_LOADED);

    // 4) The first authorized request loads the handlers and is dispatched by
    //    them (toggle reflected without restart — Req 7.5).
    aiState.configured = true;
    const authorized = await request(app).get('/_api/v3/mastra/threads');
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ route: 'get-threads' });
    expect(allLoaded()).toEqual(ALL_LOADED);
  });

  it('dispatches every route to its own handler after the lazy load', async () => {
    aiState.enabled = true;
    aiState.configured = true;
    const app = buildApp();

    const cases: [string, () => request.Test][] = [
      ['post-message', () => request(app).post('/_api/v3/mastra/message')],
      ['get-threads', () => request(app).get('/_api/v3/mastra/threads')],
      ['delete-thread', () => request(app).delete('/_api/v3/mastra/thread/t1')],
      ['get-messages', () => request(app).get('/_api/v3/mastra/messages/t1')],
      ['get-models', () => request(app).get('/_api/v3/mastra/models')],
    ];
    for (const [route, send] of cases) {
      const res = await send();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route });
    }
  });

  it('keeps rejecting with 501 when AI is toggled back off (guard re-evaluated per request)', async () => {
    aiState.enabled = true;
    aiState.configured = true;
    const app = buildApp();
    const before = await request(app).get('/_api/v3/mastra/threads');
    expect(before.status).toBe(200);

    aiState.enabled = false;
    const after = await request(app).get('/_api/v3/mastra/threads');
    expect(after.status).toBe(501);
  });

  it('builds the handler chain once and reuses it across requests', async () => {
    aiState.enabled = true;
    aiState.configured = true;
    handlerFactorySpies.postMessage.mockClear();
    const app = buildApp();

    await request(app).post('/_api/v3/mastra/message');
    await request(app).post('/_api/v3/mastra/message');

    expect(handlerFactorySpies.postMessage).toHaveBeenCalledTimes(1);
  });

  it('falls through to 404 for an unknown path once AI is ready (no route swallows it)', async () => {
    aiState.enabled = true;
    aiState.configured = true;
    const app = buildApp();

    const res = await request(app).get('/_api/v3/mastra/no-such-route');

    expect(res.status).toBe(404);
  });
});
