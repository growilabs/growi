import type { IUserHasId } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  PathSuggestion,
  SearchService,
} from '../../interfaces/suggest-path-types';
import type { GenerateSuggestionsOptions } from './generate-suggestions';

const mocks = vi.hoisted(() => {
  return {
    generateMemoSuggestionMock: vi.fn(),
    runEngineMock: vi.fn(),
    getConfigMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
}));

// The engines barrel is the orchestrator's single dispatch seam. Mocking it
// keeps this spec focused on the orchestration contract (engine selection
// precedence, memo composition, asymmetric fallback) independent of engine
// internals, which are covered by their own specs.
vi.mock('./engines', () => ({
  runEngine: mocks.runEngineMock,
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: mocks.getConfigMock },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: mocks.loggerErrorMock,
  }),
}));

const mockUser = mock<IUserHasId>({ username: 'alice' });

const mockUserGroups: ObjectIdLike[] = ['group1', 'group2'];

const mockSearchService = mock<SearchService>();

const memoSuggestion: PathSuggestion = {
  type: 'memo',
  path: '/user/alice/memo/',
  label: 'Save as memo',
  description: 'Save to your personal memo area',
  grant: 4,
};

const engineSuggestions: PathSuggestion[] = [
  {
    type: 'search',
    path: '/tech/React/',
    label: 'Save near related pages',
    description: 'This area contains React documentation.',
    grant: 1,
    informationType: 'stock',
  },
  {
    type: 'category',
    path: '/tech/',
    label: 'Save under category',
    description: 'Top-level category: tech',
    grant: 1,
  },
];

describe('generateSuggestions (orchestration)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.generateMemoSuggestionMock.mockResolvedValue(memoSuggestion);
    mocks.getConfigMock.mockReturnValue('oneshot');
  });

  const callGenerateSuggestions = async (
    options?: GenerateSuggestionsOptions,
  ) => {
    const { generateSuggestions } = await import('./generate-suggestions');
    return generateSuggestions(
      mockUser,
      'Some page content',
      mockUserGroups,
      mockSearchService,
      options,
    );
  };

  describe('engine selection precedence', () => {
    it('should dispatch to the request-specified engine over the configured default', async () => {
      mocks.getConfigMock.mockReturnValue('oneshot');
      mocks.runEngineMock.mockResolvedValue([]);

      await callGenerateSuggestions({ engine: 'agentic' });

      expect(mocks.runEngineMock).toHaveBeenCalledTimes(1);
      expect(mocks.runEngineMock).toHaveBeenCalledWith('agentic', {
        user: mockUser,
        body: 'Some page content',
        userGroups: mockUserGroups,
        searchService: mockSearchService,
      });
    });

    it('should dispatch to the configured default engine when no engine is specified', async () => {
      mocks.getConfigMock.mockReturnValue('agentic');
      mocks.runEngineMock.mockResolvedValue([]);

      await callGenerateSuggestions();

      expect(mocks.getConfigMock).toHaveBeenCalledWith(
        'aiTools:suggestPathEngine',
      );
      expect(mocks.runEngineMock).toHaveBeenCalledWith(
        'agentic',
        expect.objectContaining({ body: 'Some page content' }),
      );
    });

    it('should dispatch to the oneshot engine when config default is oneshot and no engine is specified', async () => {
      mocks.getConfigMock.mockReturnValue('oneshot');
      mocks.runEngineMock.mockResolvedValue([]);

      await callGenerateSuggestions();

      expect(mocks.runEngineMock).toHaveBeenCalledWith('oneshot', {
        user: mockUser,
        body: 'Some page content',
        userGroups: mockUserGroups,
        searchService: mockSearchService,
      });
    });
  });

  describe('memo composition', () => {
    it('should place the memo suggestion first, followed by engine suggestions', async () => {
      mocks.runEngineMock.mockResolvedValue(engineSuggestions);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, ...engineSuggestions]);
      expect(result[0]).toEqual(memoSuggestion);
    });

    it('should place the memo suggestion first on the agentic path as well', async () => {
      mocks.runEngineMock.mockResolvedValue(engineSuggestions);

      const result = await callGenerateSuggestions({ engine: 'agentic' });

      expect(result).toEqual([memoSuggestion, ...engineSuggestions]);
    });

    it('should return only the memo suggestion when the engine yields no suggestions', async () => {
      mocks.runEngineMock.mockResolvedValue([]);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });
  });

  describe('asymmetric fallback policy', () => {
    it('should return memo-only when the request-specified agentic engine rejects', async () => {
      mocks.runEngineMock.mockRejectedValue(new Error('agent timed out'));

      const result = await callGenerateSuggestions({ engine: 'agentic' });

      expect(result).toEqual([memoSuggestion]);
    });

    it('should return memo-only when the config-resolved agentic engine rejects', async () => {
      mocks.getConfigMock.mockReturnValue('agentic');
      mocks.runEngineMock.mockRejectedValue(new Error('agent failed'));

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should log the agentic engine failure', async () => {
      mocks.runEngineMock.mockRejectedValue(new Error('agent failed'));

      await callGenerateSuggestions({ engine: 'agentic' });

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should propagate oneshot engine exceptions unchanged', async () => {
      const engineError = new Error('unexpected oneshot failure');
      mocks.runEngineMock.mockRejectedValue(engineError);

      await expect(callGenerateSuggestions({ engine: 'oneshot' })).rejects.toBe(
        engineError,
      );
    });
  });

  describe('memo generation failure', () => {
    it('should propagate memo generation failure on the oneshot path', async () => {
      const memoError = new Error('memo generation failed');
      mocks.generateMemoSuggestionMock.mockRejectedValue(memoError);
      mocks.runEngineMock.mockResolvedValue([]);

      await expect(callGenerateSuggestions({ engine: 'oneshot' })).rejects.toBe(
        memoError,
      );
    });

    it('should propagate memo generation failure on the agentic path (not swallowed by fallback)', async () => {
      const memoError = new Error('memo generation failed');
      mocks.generateMemoSuggestionMock.mockRejectedValue(memoError);
      mocks.runEngineMock.mockResolvedValue([]);

      await expect(callGenerateSuggestions({ engine: 'agentic' })).rejects.toBe(
        memoError,
      );
    });
  });
});
