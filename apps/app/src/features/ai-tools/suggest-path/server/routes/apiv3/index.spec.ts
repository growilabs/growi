import type { Request, RequestHandler } from 'express';
import { type ValidationChain, validationResult } from 'express-validator';
import type { Mock } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const mocks = vi.hoisted(() => {
  return {
    generateSuggestionsMock: vi.fn(),
    loginRequiredFactoryMock: vi.fn(),
    isAiEnabledMock: vi.fn(),
    findAllUserGroupIdsMock: vi.fn(),
    findAllExternalUserGroupIdsMock: vi.fn(),
  };
});

vi.mock('../../services/generate-suggestions', () => ({
  generateSuggestions: mocks.generateSuggestionsMock,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: mocks.loginRequiredFactoryMock,
}));

vi.mock('~/features/openai/server/services', () => ({
  isAiEnabled: mocks.isAiEnabledMock,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({ error: vi.fn() }),
}));

// The pass-through mocks call next() so the full-chain tests can drive a
// request through the real middleware order.
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock('~/server/middlewares/apiv3-form-validator', () => ({
  apiV3FormValidator: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    findAllUserGroupIdsRelatedToUser: mocks.findAllUserGroupIdsMock,
  },
}));

vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      findAllUserGroupIdsRelatedToUser: mocks.findAllExternalUserGroupIdsMock,
    },
  }),
);

describe('suggestPathHandlersFactory', () => {
  const mockCrowi = mock<Crowi>({
    searchService: { searchKeyword: vi.fn() },
  });
  const mockSearchService = mockCrowi.searchService;

  const createMockReqRes = () => {
    const req = {
      user: { _id: 'user123', username: 'alice' },
      body: { body: 'Some page content' },
    } as unknown as Request;

    const res = {
      apiv3: vi.fn(),
      apiv3Err: vi.fn(),
    } as unknown as ApiV3Response;

    return { req, res };
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loginRequiredFactoryMock.mockReturnValue(
      (_req: unknown, _res: unknown, next: () => void) => next(),
    );
    mocks.isAiEnabledMock.mockReturnValue(true);
    mocks.findAllUserGroupIdsMock.mockResolvedValue(['group1']);
    mocks.findAllExternalUserGroupIdsMock.mockResolvedValue(['extGroup1']);
  });

  // Drives a request through the handlers in their real order, honoring a
  // middleware that ends the response without calling next() (the guard
  // contract). Validation chains are executed via their run() API — they
  // only record errors; apiV3FormValidator is the component that would map
  // them to a 400.
  const runChain = async (req: Request, res: ApiV3Response) => {
    const { suggestPathHandlersFactory } = await import('.');
    const handlers = suggestPathHandlersFactory(mockCrowi);
    for (const handler of handlers) {
      if ('run' in handler) {
        await (handler as ValidationChain).run(req);
        continue;
      }
      let nextCalled = false;
      await (handler as RequestHandler)(req, res, () => {
        nextCalled = true;
      });
      if (!nextCalled) return;
    }
  };

  describe('middleware chain', () => {
    // Exact count: accessTokenParser + loginRequired + aiEnabledGuard
    // + 1 validator chain (body) + apiV3FormValidator + the main handler.
    // A dropped security middleware must fail this, not slip under a loose
    // >= bound.
    it('should return exactly the 6 expected handlers', async () => {
      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      expect(handlers).toHaveLength(6);
    });

    it('should include the login-required middleware in the chain', async () => {
      const loginRequiredMiddleware = vi.fn();
      mocks.loginRequiredFactoryMock.mockReturnValue(loginRequiredMiddleware);

      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);

      expect(handlers).toContain(loginRequiredMiddleware);
    });
  });

  describe('AI enabled gate', () => {
    it('should respond 501 and stop before the main handler when AI is disabled', async () => {
      mocks.isAiEnabledMock.mockReturnValue(false);
      mocks.generateSuggestionsMock.mockResolvedValue([]);

      const { req, res } = createMockReqRes();
      await runChain(req, res);

      expect(res.apiv3Err).toHaveBeenCalledWith(expect.anything(), 501);
      expect(mocks.generateSuggestionsMock).not.toHaveBeenCalled();
    });

    it('should pass the request through to the main handler when AI is enabled', async () => {
      mocks.isAiEnabledMock.mockReturnValue(true);
      mocks.generateSuggestionsMock.mockResolvedValue([]);

      const { req, res } = createMockReqRes();
      await runChain(req, res);

      expect(mocks.generateSuggestionsMock).toHaveBeenCalled();
      expect(res.apiv3).toHaveBeenCalled();
    });
  });

  describe('body validation', () => {
    // Runs the real express-validator chains contained in the middleware
    // chain against a bare request body and returns the validation result
    // (which apiV3FormValidator maps to a 400 response in the real pipeline)
    const runValidation = async (reqBody: Record<string, unknown>) => {
      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const chains = handlers.filter(
        (handler): handler is ValidationChain => 'run' in handler,
      );
      const req = { body: reqBody };
      await Promise.all(chains.map((chain) => chain.run(req)));
      return validationResult(req);
    };

    it('should accept a valid body', async () => {
      const result = await runValidation({ body: 'Some page content' });

      expect(result.isEmpty()).toBe(true);
    });

    it('should produce a validation error for an empty body', async () => {
      const result = await runValidation({ body: '' });

      expect(result.isEmpty()).toBe(false);
    });

    it('should ignore the removed engine field (backward compatibility)', async () => {
      // Clients built against the two-engine era may still send `engine`;
      // it must be ignored, not rejected.
      const result = await runValidation({
        body: 'Some page content',
        engine: 'agentic',
      });

      expect(result.isEmpty()).toBe(true);
    });
  });

  describe('handler', () => {
    it('should call generateSuggestions with user, body, userGroups, and searchService', async () => {
      const suggestions = [
        {
          type: 'memo',
          path: '/user/alice/memo/',
          label: 'Save as memo',
          description: 'Save to your personal memo area',
          grant: 4,
        },
      ];
      mocks.generateSuggestionsMock.mockResolvedValue(suggestions);

      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(mocks.generateSuggestionsMock).toHaveBeenCalledWith(
        { _id: 'user123', username: 'alice' },
        'Some page content',
        ['group1', 'extGroup1'],
        mockSearchService,
      );
    });

    it('should return suggestions array via res.apiv3', async () => {
      const suggestions = [
        {
          type: 'memo',
          path: '/user/alice/memo/',
          label: 'Save as memo',
          description: 'Save to your personal memo area',
          grant: 4,
        },
      ];
      mocks.generateSuggestionsMock.mockResolvedValue(suggestions);

      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(res.apiv3).toHaveBeenCalledWith({ suggestions });
    });

    it('should return error when generateSuggestions throws', async () => {
      mocks.generateSuggestionsMock.mockRejectedValue(
        new Error('Unexpected error'),
      );

      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(res.apiv3Err).toHaveBeenCalled();
      // Should not expose internal error details (Req 9.2)
      const apiv3ErrMock = res.apiv3Err as Mock;
      const errorCall = apiv3ErrMock.mock.calls[0];
      expect(errorCall[0].message).not.toContain('Unexpected error');
    });

    it('should combine internal and external user groups', async () => {
      mocks.findAllUserGroupIdsMock.mockResolvedValue(['g1', 'g2']);
      mocks.findAllExternalUserGroupIdsMock.mockResolvedValue(['eg1']);
      mocks.generateSuggestionsMock.mockResolvedValue([]);

      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      const call = mocks.generateSuggestionsMock.mock.calls[0];
      expect(call[2]).toEqual(['g1', 'g2', 'eg1']);
    });

    it('should ignore a legacy engine field in the request body', async () => {
      mocks.generateSuggestionsMock.mockResolvedValue([]);

      const { suggestPathHandlersFactory } = await import('.');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      (req.body as Record<string, unknown>).engine = 'agentic';
      await handler(req, res, vi.fn());

      // Exactly the 4 positional arguments — no engine option is derived
      // from the request body.
      expect(mocks.generateSuggestionsMock).toHaveBeenCalledWith(
        { _id: 'user123', username: 'alice' },
        'Some page content',
        ['group1', 'extGroup1'],
        mockSearchService,
      );
    });
  });
});
