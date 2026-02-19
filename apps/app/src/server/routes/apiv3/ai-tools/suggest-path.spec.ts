import type { Request, RequestHandler } from 'express';
import type { Mock } from 'vitest';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const mocks = vi.hoisted(() => {
  return {
    generateSuggestionsMock: vi.fn(),
    extractKeywordsMock: vi.fn(),
    loginRequiredFactoryMock: vi.fn(),
    certifyAiServiceMock: vi.fn(),
    findAllUserGroupIdsMock: vi.fn(),
    findAllExternalUserGroupIdsMock: vi.fn(),
  };
});

vi.mock('./generate-suggestions', () => ({
  generateSuggestions: mocks.generateSuggestionsMock,
}));

vi.mock('./extract-keywords', () => ({
  extractKeywords: mocks.extractKeywordsMock,
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
  const mockSearchService = { searchKeyword: vi.fn() };
  const mockCrowi = {
    searchService: mockSearchService,
  } as unknown as Crowi;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loginRequiredFactoryMock.mockReturnValue(vi.fn());
    mocks.findAllUserGroupIdsMock.mockResolvedValue(['group1']);
    mocks.findAllExternalUserGroupIdsMock.mockResolvedValue(['extGroup1']);
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

    it('should call generateSuggestions with user, body, userGroups, and deps', async () => {
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

      const { suggestPathHandlersFactory } = await import('./suggest-path');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(mocks.generateSuggestionsMock).toHaveBeenCalledWith(
        { _id: 'user123', username: 'alice' },
        'Some page content',
        ['group1', 'extGroup1'],
        {
          searchService: mockSearchService,
          extractKeywords: mocks.extractKeywordsMock,
        },
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

      const { suggestPathHandlersFactory } = await import('./suggest-path');
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

    it('should combine internal and external user groups', async () => {
      mocks.findAllUserGroupIdsMock.mockResolvedValue(['g1', 'g2']);
      mocks.findAllExternalUserGroupIdsMock.mockResolvedValue(['eg1']);
      mocks.generateSuggestionsMock.mockResolvedValue([]);

      const { suggestPathHandlersFactory } = await import('./suggest-path');
      const handlers = suggestPathHandlersFactory(mockCrowi);
      const handler = handlers[handlers.length - 1] as RequestHandler;

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      const call = mocks.generateSuggestionsMock.mock.calls[0];
      expect(call[2]).toEqual(['g1', 'g2', 'eg1']);
    });
  });
});
