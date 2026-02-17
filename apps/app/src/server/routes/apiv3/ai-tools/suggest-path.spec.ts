import type { Request, RequestHandler } from 'express';
import type { Mock } from 'vitest';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const mocks = vi.hoisted(() => {
  return {
    generateMemoSuggestionMock: vi.fn(),
    loginRequiredFactoryMock: vi.fn(),
    certifyAiServiceMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: mocks.loginRequiredFactoryMock,
}));

vi.mock(
  '~/features/openai/server/routes/middlewares/certify-ai-service',
  () => ({
    certifyAiService: mocks.certifyAiServiceMock,
  }),
);

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: vi.fn(() => vi.fn()),
}));

vi.mock('~/server/middlewares/apiv3-form-validator', () => ({
  apiV3FormValidator: vi.fn(),
}));

describe('suggestPathHandlersFactory', () => {
  const mockCrowi = {} as unknown as Crowi;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loginRequiredFactoryMock.mockReturnValue(vi.fn());
  });

  describe('middleware chain', () => {
    it('should return an array of request handlers', async () => {
      const { suggestPathHandlersFactory } = await import('./suggest-path');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      expect(Array.isArray(handlers)).toBe(true);
      expect(handlers.length).toBeGreaterThanOrEqual(5);
    });

    it('should include certifyAiService in the middleware chain', async () => {
      const { suggestPathHandlersFactory } = await import('./suggest-path');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      expect(handlers).toContain(mocks.certifyAiServiceMock);
    });
  });

  describe('handler', () => {
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

    it('should call generateMemoSuggestion with the authenticated user', async () => {
      const memoSuggestion = {
        type: 'memo',
        path: '/user/alice/memo/',
        label: 'Save as memo',
        description: 'Save to your personal memo area',
        grant: 4,
      };
      mocks.generateMemoSuggestionMock.mockReturnValue(memoSuggestion);

      const { suggestPathHandlersFactory } = await import('./suggest-path');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(mocks.generateMemoSuggestionMock).toHaveBeenCalledWith(req.user);
    });

    it('should return suggestions array via res.apiv3', async () => {
      const memoSuggestion = {
        type: 'memo',
        path: '/user/alice/memo/',
        label: 'Save as memo',
        description: 'Save to your personal memo area',
        grant: 4,
      };
      mocks.generateMemoSuggestionMock.mockReturnValue(memoSuggestion);

      const { suggestPathHandlersFactory } = await import('./suggest-path');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(res.apiv3).toHaveBeenCalledWith({
        suggestions: [memoSuggestion],
      });
    });

    it('should return error when generateMemoSuggestion throws', async () => {
      mocks.generateMemoSuggestionMock.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const { suggestPathHandlersFactory } = await import('./suggest-path');
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
  });
});
