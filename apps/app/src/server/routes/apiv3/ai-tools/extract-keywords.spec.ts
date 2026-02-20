import { extractKeywords } from './extract-keywords';

const mocks = vi.hoisted(() => {
  return {
    chatCompletionMock: vi.fn(),
    getClientMock: vi.fn(),
    configManagerMock: {
      getConfig: vi.fn(),
    },
  };
});

vi.mock('~/features/openai/server/services/client-delegator', () => ({
  getClient: mocks.getClientMock,
  isStreamResponse: (result: unknown) => {
    return (
      result != null &&
      typeof result === 'object' &&
      Symbol.asyncIterator in (result as Record<symbol, unknown>)
    );
  },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: mocks.configManagerMock,
}));

describe('extractKeywords', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.configManagerMock.getConfig.mockImplementation((key: string) => {
      if (key === 'openai:serviceType') return 'openai';
      return undefined;
    });
    mocks.getClientMock.mockReturnValue({
      chatCompletion: mocks.chatCompletionMock,
    });
  });

  describe('successful extraction', () => {
    it('should return an array of keywords from AI response', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: '["React", "hooks", "useState"]' } }],
      });

      const result = await extractKeywords(
        'A guide to React hooks and useState',
      );

      expect(result).toEqual(['React', 'hooks', 'useState']);
    });

    it('should return 3-5 keywords', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '["TypeScript", "generics", "type inference", "mapped types", "conditional types"]',
            },
          },
        ],
      });

      const result = await extractKeywords(
        'TypeScript generics and advanced types',
      );

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should pass content body to chatCompletion as user message', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: '["MongoDB"]' } }],
      });

      await extractKeywords('MongoDB aggregation pipeline');

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'MongoDB aggregation pipeline',
            }),
          ]),
        }),
      );
    });

    it('should use a system prompt instructing keyword extraction', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: '["Next.js"]' } }],
      });

      await extractKeywords('Next.js routing');

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
            }),
          ]),
        }),
      );
    });

    it('should not use streaming mode', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: '["keyword"]' } }],
      });

      await extractKeywords('test content');

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stream: true,
        }),
      );
    });
  });

  describe('empty results', () => {
    it('should return empty array when AI returns empty JSON array', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: '[]' } }],
      });

      const result = await extractKeywords('...');

      expect(result).toEqual([]);
    });

    it('should return empty array when AI returns null content', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const result = await extractKeywords('...');

      expect(result).toEqual([]);
    });
  });

  describe('failure scenarios', () => {
    it('should throw when chatCompletion rejects', async () => {
      mocks.chatCompletionMock.mockRejectedValue(new Error('API error'));

      await expect(extractKeywords('test')).rejects.toThrow('API error');
    });

    it('should throw when AI returns invalid JSON', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: 'not valid json' } }],
      });

      await expect(extractKeywords('test')).rejects.toThrow();
    });

    it('should throw when AI returns non-array JSON', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: '{"key": "value"}' } }],
      });

      await expect(extractKeywords('test')).rejects.toThrow();
    });

    it('should throw when choices array is empty', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [],
      });

      await expect(extractKeywords('test')).rejects.toThrow();
    });
  });
});
