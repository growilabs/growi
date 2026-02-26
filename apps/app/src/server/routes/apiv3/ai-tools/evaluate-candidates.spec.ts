import { evaluateCandidates } from './evaluate-candidates';
import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  SearchCandidate,
} from './suggest-path-types';

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

const stockAnalysis: ContentAnalysis = {
  keywords: ['React', 'hooks', 'useState'],
  informationType: 'stock',
};

const flowAnalysis: ContentAnalysis = {
  keywords: ['sprint', 'retrospective'],
  informationType: 'flow',
};

const sampleCandidates: SearchCandidate[] = [
  {
    pagePath: '/tech/React/hooks',
    snippet: 'React hooks guide for state management',
    score: 15,
  },
  {
    pagePath: '/tech/React/state',
    snippet: 'Managing state in React applications',
    score: 12,
  },
];

function mockAiResponse(suggestions: EvaluatedSuggestion[]) {
  mocks.chatCompletionMock.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify(suggestions),
        },
      },
    ],
  });
}

describe('evaluateCandidates', () => {
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

  describe('path pattern selection across all three patterns', () => {
    it('should return parent directory pattern suggestion', async () => {
      const parentSuggestion: EvaluatedSuggestion = {
        path: '/tech/React/',
        label: 'Save near related pages',
        description:
          'This directory contains React documentation including hooks and state management.',
      };
      mockAiResponse([parentSuggestion]);

      const result = await evaluateCandidates(
        'A guide to React hooks',
        stockAnalysis,
        sampleCandidates,
      );

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/tech/React/');
      expect(result[0].path).toMatch(/\/$/);
    });

    it('should return subdirectory pattern suggestion', async () => {
      const subdirSuggestion: EvaluatedSuggestion = {
        path: '/tech/React/hooks/advanced/',
        label: 'Save near related pages',
        description:
          'Advanced hooks content fits under the existing hooks documentation.',
      };
      mockAiResponse([subdirSuggestion]);

      const result = await evaluateCandidates(
        'Advanced React hooks patterns',
        stockAnalysis,
        sampleCandidates,
      );

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/tech/React/hooks/advanced/');
      expect(result[0].path).toMatch(/\/$/);
    });

    it('should return sibling directory pattern suggestion', async () => {
      const siblingSuggestion: EvaluatedSuggestion = {
        path: '/tech/React/performance/',
        label: 'New section for performance topics',
        description:
          'A new section alongside existing React documentation for performance content.',
      };
      mockAiResponse([siblingSuggestion]);

      const result = await evaluateCandidates(
        'React performance optimization',
        stockAnalysis,
        sampleCandidates,
      );

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/tech/React/performance/');
      expect(result[0].path).toMatch(/\/$/);
    });
  });

  describe('sibling path generation at correct hierarchy level', () => {
    it('should generate sibling paths at the same level as the candidate page', async () => {
      const candidates: SearchCandidate[] = [
        {
          pagePath: '/docs/frontend/React/basics',
          snippet: 'React basics introduction',
          score: 10,
        },
      ];
      const siblingSuggestion: EvaluatedSuggestion = {
        path: '/docs/frontend/React/advanced/',
        label: 'New section for advanced topics',
        description: 'Sibling section at the same level as the basics page.',
      };
      mockAiResponse([siblingSuggestion]);

      const result = await evaluateCandidates(
        'Advanced React patterns',
        stockAnalysis,
        candidates,
      );

      // Sibling path should be at the same depth as the candidate
      const candidateDepth = '/docs/frontend/React/basics'
        .split('/')
        .filter(Boolean).length;
      const resultDepth = result[0].path
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean).length;
      expect(resultDepth).toBe(candidateDepth);
    });
  });

  describe('AI-generated description quality', () => {
    it('should include non-empty descriptions for each suggestion', async () => {
      const suggestions: EvaluatedSuggestion[] = [
        {
          path: '/tech/React/',
          label: 'Save near related pages',
          description:
            'Contains documentation about React hooks and state management patterns.',
        },
        {
          path: '/tech/React/hooks/custom/',
          label: 'Save under hooks section',
          description:
            'Custom hooks content fits naturally under the existing hooks documentation.',
        },
      ];
      mockAiResponse(suggestions);

      const result = await evaluateCandidates(
        'Custom React hooks',
        stockAnalysis,
        sampleCandidates,
      );

      expect(result).toHaveLength(2);
      for (const suggestion of result) {
        expect(suggestion.description).toBeTruthy();
        expect(suggestion.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ranking order', () => {
    it('should preserve AI-determined ranking order in results', async () => {
      const rankedSuggestions: EvaluatedSuggestion[] = [
        {
          path: '/tech/React/hooks/',
          label: 'Best match',
          description: 'Closest content-destination fit.',
        },
        {
          path: '/tech/React/',
          label: 'Good match',
          description: 'Broader category match.',
        },
      ];
      mockAiResponse(rankedSuggestions);

      const result = await evaluateCandidates(
        'React hooks guide',
        stockAnalysis,
        sampleCandidates,
      );

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('/tech/React/hooks/');
      expect(result[1].path).toBe('/tech/React/');
    });
  });

  describe('flow/stock alignment consideration', () => {
    it('should pass informationType to AI for ranking consideration', async () => {
      const suggestion: EvaluatedSuggestion = {
        path: '/meetings/2025/',
        label: 'Save near meeting notes',
        description: 'Flow content fits well in the meetings area.',
      };
      mockAiResponse([suggestion]);

      await evaluateCandidates(
        'Sprint retrospective notes from today',
        flowAnalysis,
        [
          {
            pagePath: '/meetings/2025/01',
            snippet: 'January meeting',
            score: 10,
          },
        ],
      );

      // Verify the AI receives informationType in the prompt
      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('flow'),
            }),
          ]),
        }),
      );
    });

    it('should pass stock informationType to AI for ranking consideration', async () => {
      const suggestion: EvaluatedSuggestion = {
        path: '/tech/React/',
        label: 'Save near documentation',
        description: 'Stock content aligns with reference documentation.',
      };
      mockAiResponse([suggestion]);

      await evaluateCandidates(
        'React hooks documentation',
        stockAnalysis,
        sampleCandidates,
      );

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('stock'),
            }),
          ]),
        }),
      );
    });
  });

  describe('AI invocation details', () => {
    it('should pass content body to AI', async () => {
      mockAiResponse([]);

      await evaluateCandidates(
        'My custom React hooks article',
        stockAnalysis,
        sampleCandidates,
      );

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('My custom React hooks article'),
            }),
          ]),
        }),
      );
    });

    it('should pass candidate paths and snippets to AI, not full page bodies', async () => {
      mockAiResponse([]);

      await evaluateCandidates(
        'React hooks guide',
        stockAnalysis,
        sampleCandidates,
      );

      const call = mocks.chatCompletionMock.mock.calls[0][0];
      const userMessage = call.messages.find(
        (m: { role: string }) => m.role === 'user',
      );
      expect(userMessage.content).toContain('/tech/React/hooks');
      expect(userMessage.content).toContain(
        'React hooks guide for state management',
      );
    });

    it('should include a system prompt with evaluation instructions', async () => {
      mockAiResponse([]);

      await evaluateCandidates('test content', stockAnalysis, sampleCandidates);

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
      mockAiResponse([]);

      await evaluateCandidates('test content', stockAnalysis, sampleCandidates);

      expect(mocks.chatCompletionMock).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stream: true,
        }),
      );
    });
  });

  describe('empty and edge cases', () => {
    it('should return empty array when AI evaluates no candidates as suitable', async () => {
      mockAiResponse([]);

      const result = await evaluateCandidates(
        'Unrelated content',
        stockAnalysis,
        sampleCandidates,
      );

      expect(result).toEqual([]);
    });

    it('should handle single candidate input', async () => {
      const suggestion: EvaluatedSuggestion = {
        path: '/tech/React/',
        label: 'Save near related pages',
        description: 'Single candidate evaluation.',
      };
      mockAiResponse([suggestion]);

      const result = await evaluateCandidates('React content', stockAnalysis, [
        sampleCandidates[0],
      ]);

      expect(result).toHaveLength(1);
    });
  });

  describe('failure propagation', () => {
    it('should throw when chatCompletion rejects', async () => {
      mocks.chatCompletionMock.mockRejectedValue(new Error('API error'));

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow('API error');
    });

    it('should throw with descriptive message when AI returns invalid JSON', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: 'not valid json' } }],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow(/Failed to parse LLM response as JSON/);
    });

    it('should include truncated response in error message when AI returns invalid JSON', async () => {
      const longInvalidJson = 'x'.repeat(300);
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: longInvalidJson } }],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow(/Failed to parse LLM response as JSON/);
    });

    it('should throw when AI returns non-array JSON', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                path: '/test/',
                label: 'test',
                description: 'test',
              }),
            },
          },
        ],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow();
    });

    it('should throw when choices array is empty', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow();
    });

    it('should throw when message content is null', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow();
    });

    it('should throw on streaming response', async () => {
      const streamMock = {
        [Symbol.asyncIterator]: () => ({}),
      };
      mocks.chatCompletionMock.mockResolvedValue(streamMock);

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow();
    });

    it('should throw when suggestion item is missing required fields', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify([{ path: '/tech/' }]),
            },
          },
        ],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow();
    });

    it('should throw when suggestion path does not end with trailing slash', async () => {
      mocks.chatCompletionMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { path: '/tech/React', label: 'test', description: 'test' },
              ]),
            },
          },
        ],
      });

      await expect(
        evaluateCandidates('test', stockAnalysis, sampleCandidates),
      ).rejects.toThrow();
    });
  });
});
