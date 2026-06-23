// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise the PUT /user-ui-settings ROUTE HANDLER's observable
// contract (Req 3.6 / 3.2 / 3.7): which fields it forwards into the persisted
// UserUISettings update. The handler is the final layer of the Express Router
// built by setup(); the preceding validator + apiV3FormValidator middlewares are
// not part of the contract under test, so we read the handler off the route
// stack and invoke it directly (mirroring get-models.spec / post-message-handler.spec).
//
// We mock the single module boundary the handler reaches:
//   - the UserUISettings model (default export): we stub findOneAndUpdate so no DB
//     is touched and we can assert exactly what reaches the $set.
import type { IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import { mock } from 'vitest-mock-extended';

import type { ApiV3Response } from './interfaces/apiv3-response';

// UserUISettings is a default export; the handler persists via
// UserUISettings.findOneAndUpdate(...).
const { findOneAndUpdate } = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
}));
vi.mock('../../models/user-ui-settings', () => ({
  default: { findOneAndUpdate },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { setup } from './user-ui-settings';

// Read the route handler (last layer of the single PUT route) off the router the
// factory builds. The validator + apiV3FormValidator layers precede it but are not
// part of the persistence contract under test.
const getHandler = (): RequestHandler => {
  const router = setup();
  // biome-ignore lint/suspicious/noExplicitAny: Express Layer internals are untyped
  const route = (router.stack[0] as any).route;
  const stack = route.stack;
  return stack[stack.length - 1].handle;
};

const buildReqRes = (settings: Record<string, unknown>) => {
  const user = mock<IUserHasId>();
  // _id is read for the findOneAndUpdate filter; a concrete value keeps the query
  // shape introspectable.
  user._id = mock<IUserHasId['_id']>();
  // req.body is a plain object so that an *omitted* settings key reads as `undefined`
  // (real Express req.body semantics) — a vitest-mock-extended proxy would instead
  // auto-stub missing keys with spy functions, defeating the null-stripping assertion.
  const req = { user, body: { settings } };
  const res = mock<ApiV3Response>();
  return { req, res, user };
};

beforeEach(() => {
  vi.clearAllMocks();
  findOneAndUpdate.mockResolvedValue({});
});

describe('PUT /user-ui-settings handler', () => {
  it('persists aiChatSelectedModelId into the $set (Req 3.6 / 3.2)', async () => {
    const { req, res } = buildReqRes({ aiChatSelectedModelId: 'gpt-4o' });

    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    const update = findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toEqual(
      expect.objectContaining({ aiChatSelectedModelId: 'gpt-4o' }),
    );
  });

  it('does NOT write aiChatSelectedModelId when it is omitted (no accidental clear)', async () => {
    const { req, res } = buildReqRes({ currentSidebarContents: 'recent' });

    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    const update = findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).not.toHaveProperty('aiChatSelectedModelId');
  });

  it('still forwards the original three fields unchanged', async () => {
    const { req, res } = buildReqRes({
      currentSidebarContents: 'recent',
      currentProductNavWidth: 320,
      preferCollapsedModeByUser: true,
    });

    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    const update = findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toEqual(
      expect.objectContaining({
        currentSidebarContents: 'recent',
        currentProductNavWidth: 320,
        preferCollapsedModeByUser: true,
      }),
    );
  });

  it('persists aiChatSelectedModelId for logged-out users into the session', async () => {
    const { req, res } = buildReqRes({ aiChatSelectedModelId: 'o3' });
    // logged-out: no user; the handler writes into req.session.uiSettings instead
    // of the DB.
    // biome-ignore lint/suspicious/noExplicitAny: overriding the mocked req for the logged-out branch
    const loggedOutReq = { body: req.body, session: {} } as any;

    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(loggedOutReq, res as any, vi.fn());

    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(loggedOutReq.session.uiSettings.aiChatSelectedModelId).toBe('o3');
  });
});
