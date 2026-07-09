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
    getEngineRecordMock: vi.fn(),
    runOneshotMock: vi.fn(),
    runAgenticMock: vi.fn(),
    getConfigMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
}));

// The engines barrel is the orchestrator's single dispatch seam. Mocking it
// keeps this spec focused on the orchestration contract (engine selection
// precedence, memo composition, record-declared fallback policy) independent
// of engine internals; the id -> record mapping itself is covered by
// dispatcher.spec.
vi.mock('./engines', () => ({
  getEngineRecord: mocks.getEngineRecordMock,
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
    // Stub of the dispatcher contract: known ids resolve to a record carrying
    // the engine's declared fallback policy, unknown ids resolve to undefined.
    mocks.getEngineRecordMock.mockImplementation((engineId: string) => {
      switch (engineId) {
        case 'oneshot':
          return { run: mocks.runOneshotMock, degradeToMemoOnFailure: false };
        case 'agentic':
          return { run: mocks.runAgenticMock, degradeToMemoOnFailure: true };
        default:
          return undefined;
      }
    });
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

  const expectedEngineInput = {
    user: mockUser,
    body: 'Some page content',
    userGroups: mockUserGroups,
    searchService: mockSearchService,
  };

  describe('engine selection precedence', () => {
    it('should dispatch to the request-specified engine over the configured default', async () => {
      mocks.getConfigMock.mockReturnValue('oneshot');
      mocks.runAgenticMock.mockResolvedValue([]);

      await callGenerateSuggestions({ engine: 'agentic' });

      expect(mocks.runAgenticMock).toHaveBeenCalledTimes(1);
      expect(mocks.runAgenticMock).toHaveBeenCalledWith(expectedEngineInput);
      expect(mocks.runOneshotMock).not.toHaveBeenCalled();
    });

    it('should dispatch to the configured default engine when no engine is specified', async () => {
      mocks.getConfigMock.mockReturnValue('agentic');
      mocks.runAgenticMock.mockResolvedValue([]);

      await callGenerateSuggestions();

      expect(mocks.getConfigMock).toHaveBeenCalledWith(
        'aiTools:suggestPathEngine',
      );
      expect(mocks.runAgenticMock).toHaveBeenCalledWith(expectedEngineInput);
    });

    it('should dispatch to the oneshot engine when config default is oneshot and no engine is specified', async () => {
      mocks.getConfigMock.mockReturnValue('oneshot');
      mocks.runOneshotMock.mockResolvedValue([]);

      await callGenerateSuggestions();

      expect(mocks.runOneshotMock).toHaveBeenCalledWith(expectedEngineInput);
      expect(mocks.runAgenticMock).not.toHaveBeenCalled();
    });
  });

  describe('memo composition', () => {
    it('should place the memo suggestion first, followed by engine suggestions', async () => {
      mocks.runOneshotMock.mockResolvedValue(engineSuggestions);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, ...engineSuggestions]);
      expect(result[0]).toEqual(memoSuggestion);
    });

    it('should place the memo suggestion first on the agentic path as well', async () => {
      mocks.runAgenticMock.mockResolvedValue(engineSuggestions);

      const result = await callGenerateSuggestions({ engine: 'agentic' });

      expect(result).toEqual([memoSuggestion, ...engineSuggestions]);
    });

    it('should return only the memo suggestion when the engine yields no suggestions', async () => {
      mocks.runOneshotMock.mockResolvedValue([]);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });
  });

  describe('record-declared fallback policy', () => {
    it('should return memo-only when the request-specified degrading engine rejects', async () => {
      mocks.runAgenticMock.mockRejectedValue(new Error('agent timed out'));

      const result = await callGenerateSuggestions({ engine: 'agentic' });

      expect(result).toEqual([memoSuggestion]);
    });

    it('should return memo-only when the config-resolved degrading engine rejects', async () => {
      mocks.getConfigMock.mockReturnValue('agentic');
      mocks.runAgenticMock.mockRejectedValue(new Error('agent failed'));

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should log the degrading engine failure', async () => {
      mocks.runAgenticMock.mockRejectedValue(new Error('agent failed'));

      await callGenerateSuggestions({ engine: 'agentic' });

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should propagate non-degrading (oneshot) engine exceptions unchanged', async () => {
      const engineError = new Error('unexpected oneshot failure');
      mocks.runOneshotMock.mockRejectedValue(engineError);

      await expect(callGenerateSuggestions({ engine: 'oneshot' })).rejects.toBe(
        engineError,
      );
    });
  });

  describe('invalid engine configuration', () => {
    it('should return memo-only (not throw) when the configured engine id resolves to no record', async () => {
      // Operator typo in AI_TOOLS_SUGGEST_PATH_ENGINE: the config layer does
      // not runtime-validate env values, so the id reaches the dispatcher
      // verbatim and resolves to undefined.
      mocks.getConfigMock.mockReturnValue('onshot');

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.runOneshotMock).not.toHaveBeenCalled();
      expect(mocks.runAgenticMock).not.toHaveBeenCalled();
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });
  });

  describe('memo generation failure', () => {
    it('should propagate memo generation failure on the oneshot path', async () => {
      const memoError = new Error('memo generation failed');
      mocks.generateMemoSuggestionMock.mockRejectedValue(memoError);
      mocks.runOneshotMock.mockResolvedValue([]);

      await expect(callGenerateSuggestions({ engine: 'oneshot' })).rejects.toBe(
        memoError,
      );
    });

    it('should propagate memo generation failure on the agentic path (not swallowed by fallback)', async () => {
      const memoError = new Error('memo generation failed');
      mocks.generateMemoSuggestionMock.mockRejectedValue(memoError);
      mocks.runAgenticMock.mockResolvedValue([]);

      await expect(callGenerateSuggestions({ engine: 'agentic' })).rejects.toBe(
        memoError,
      );
    });
  });
});
