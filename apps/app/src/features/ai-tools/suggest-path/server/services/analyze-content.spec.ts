import { Lang } from '@growi/core/dist/interfaces';

import type { ContentAnalysis } from '../../interfaces/suggest-path-types';
import { analyzeContent } from './analyze-content';

const getSystemPromptOfLastCall = (): string => {
  const lastCall = mocks.chatCompletionMock.mock.calls.at(-1)?.[0] as {
    messages: { role: string; content: string }[];
  };
  const systemMessage = lastCall.messages.find((m) => m.role === 'system');
  return systemMessage?.content ?? '';
};

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

describe('analyzeContent', () => {
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

  describe('successful keyword extraction with quality verification', () => {
    it('should return keywords and informationType from AI response', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['React', 'hooks', 'useState'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      const result = await analyzeContent(
        'A guide to React hooks and useState',
      );

      expect(result).toEqual({
        keywords: ['React', 'hooks', 'useState'],
        informationType: 'stock',
      } satisfies ContentAnalysis);
    });

    it('should extract 1-5 keywords prioritizing the subject and purpose of the content', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: [
                  'TypeScript',
                  'generics',
                  'mapped types',
                  'conditional types',
                ],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      const result = await analyzeContent(
        'TypeScript generics and advanced type system features',
      );

      expect(result.keywords.length).toBeGreaterThanOrEqual(1);
      expect(result.keywords.length).toBeLessThanOrEqual(5);
    });

    it('should pass content body to chatCompletion as user message', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['MongoDB'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      await analyzeContent('MongoDB aggregation pipeline');

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

    it('should use a system prompt instructing both keyword extraction and flow/stock classification', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['Next.js'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      await analyzeContent('Next.js routing');

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
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['keyword'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      await analyzeContent('test content');

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stream: true,
        }),
      );
    });
  });

  describe('correct flow/stock classification for representative content samples', () => {
    it('should classify meeting notes as flow', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['sprint', 'retrospective', 'action items'],
                informationType: 'flow',
              }),
            },
          },
        ],
      });

      const result = await analyzeContent(
        '2025/05/01 Sprint retrospective meeting notes. Action items discussed.',
      );

      expect(result.informationType).toBe('flow');
    });

    it('should classify documentation as stock', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['API', 'authentication', 'JWT'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      const result = await analyzeContent(
        'API Authentication Guide: How to use JWT tokens for secure access.',
      );

      expect(result.informationType).toBe('stock');
    });
  });

  describe('keyword language alignment (#184974)', () => {
    const okResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              keywords: ['keyword'],
              informationType: 'stock',
            }),
          },
        },
      ],
    };

    it("should instruct the LLM to emit keywords in the user's language when it is non-English", async () => {
      mocks.chatCompletionMock.mockResolvedValue(okResponse);

      await analyzeContent('プレゼンテーション機能の設計', Lang.ja_JP);

      const systemPrompt = getSystemPromptOfLastCall();
      expect(systemPrompt).toContain('Japanese');
      // both-languages steering, so English-titled pages are still retrievable
      expect(systemPrompt).toContain('English');
    });

    it('should not add a language instruction when language is unset (backward compatible)', async () => {
      mocks.chatCompletionMock.mockResolvedValue(okResponse);

      await analyzeContent('presentation feature design');

      const systemPrompt = getSystemPromptOfLastCall();
      expect(systemPrompt).not.toContain('The wiki this content will be saved');
    });

    it('should not add a language instruction when the user language is English', async () => {
      mocks.chatCompletionMock.mockResolvedValue(okResponse);

      await analyzeContent('presentation feature design', Lang.en_US);

      const systemPrompt = getSystemPromptOfLastCall();
      expect(systemPrompt).not.toContain('The wiki this content will be saved');
    });

    it('should reference the matching language name for a non-Japanese, non-English language', async () => {
      mocks.chatCompletionMock.mockResolvedValue(okResponse);

      await analyzeContent('présentation', Lang.fr_FR);

      const systemPrompt = getSystemPromptOfLastCall();
      expect(systemPrompt).toContain('French');
    });
  });

  describe('edge cases', () => {
    it('should handle very short content', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['hello'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      const result = await analyzeContent('hello');

      expect(result.keywords).toEqual(['hello']);
      expect(result.informationType).toBe('stock');
    });

    it('should handle content with ambiguous information type', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['Docker', 'deployment'],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      const result = await analyzeContent('Docker deployment notes');

      expect(result.keywords.length).toBeGreaterThanOrEqual(1);
      expect(['flow', 'stock']).toContain(result.informationType);
    });
  });

  describe('failure propagation', () => {
    it('should throw when chatCompletion rejects', async () => {
      mocks.chatCompletionMock.mockRejectedValue(new Error('API error'));

      await expect(analyzeContent('test')).rejects.toThrow('API error');
    });

    it('should throw with descriptive message when AI returns invalid JSON', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: 'not valid json' } }],
      });

      await expect(analyzeContent('test')).rejects.toThrow(
        /Failed to parse LLM response as JSON/,
      );
    });

    it('should include truncated response in error message when AI returns invalid JSON', async () => {
      const longInvalidJson = 'x'.repeat(300);
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: longInvalidJson } }],
      });

      await expect(analyzeContent('test')).rejects.toThrow(
        /Failed to parse LLM response as JSON/,
      );
    });

    it('should throw when AI returns JSON without keywords field', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ informationType: 'stock' }),
            },
          },
        ],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw when AI returns JSON without informationType field', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ keywords: ['test'] }),
            },
          },
        ],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw when AI returns invalid informationType value', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: ['test'],
                informationType: 'invalid',
              }),
            },
          },
        ],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw when keywords is not an array', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: 'not-an-array',
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw when keywords array is empty', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: [],
                informationType: 'stock',
              }),
            },
          },
        ],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw when choices array is empty', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw when message content is null', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await expect(analyzeContent('test')).rejects.toThrow();
    });

    it('should throw on streaming response', async () => {
      const streamMock = {
        [Symbol.asyncIterator]: () => ({}),
      };
      mocks.chatCompletionMock.mockResolvedValue(streamMock);

      await expect(analyzeContent('test')).rejects.toThrow();
    });
  });
});
