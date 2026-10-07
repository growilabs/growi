import type { IUserHasId } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  PathSuggestion,
  SearchService,
} from '../../interfaces/suggest-path-types';

const mocks = vi.hoisted(() => {
  return {
    generateMemoSuggestionMock: vi.fn(),
    selectEngineMock: vi.fn(),
    runEngineMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    loggerInfoMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
}));

// The engines barrel is the orchestrator's single selection seam. Mocking it
// keeps this spec focused on the orchestration contract (memo composition,
// record-declared fallback policy, no-engine degradation) independent of the
// availability rules themselves, which are covered by select-engine.spec.
vi.mock('./engines', () => ({
  selectEngine: mocks.selectEngineMock,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: mocks.loggerErrorMock,
    info: mocks.loggerInfoMock,
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
  });

  const callGenerateSuggestions = async () => {
    const { generateSuggestions } = await import('./generate-suggestions');
    return generateSuggestions(
      mockUser,
      'Some page content',
      mockUserGroups,
      mockSearchService,
    );
  };

  const expectedEngineInput = {
    user: mockUser,
    body: 'Some page content',
    userGroups: mockUserGroups,
    searchService: mockSearchService,
  };

  // Stub of the selection contract: the selected record carries the engine's
  // declared fallback policy. The availability rules themselves are covered
  // by select-engine.spec.
  const stubSelectedEngine = (degradeToMemoOnFailure: boolean) => {
    mocks.selectEngineMock.mockReturnValue({
      id: degradeToMemoOnFailure ? 'agentic' : 'non-degrading',
      run: mocks.runEngineMock,
      degradeToMemoOnFailure,
    });
  };

  describe('engine dispatch', () => {
    it('should run the engine selected from runtime availability with the request input', async () => {
      stubSelectedEngine(true);
      mocks.runEngineMock.mockResolvedValue([]);

      await callGenerateSuggestions();

      expect(mocks.selectEngineMock).toHaveBeenCalledWith();
      expect(mocks.runEngineMock).toHaveBeenCalledTimes(1);
      expect(mocks.runEngineMock).toHaveBeenCalledWith(expectedEngineInput);
    });
  });

  describe('memo composition', () => {
    it('should place the memo suggestion first, followed by engine suggestions', async () => {
      stubSelectedEngine(false);
      mocks.runEngineMock.mockResolvedValue(engineSuggestions);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, ...engineSuggestions]);
      expect(result[0]).toEqual(memoSuggestion);
    });

    it('should place the memo suggestion first on the degrading-engine path as well', async () => {
      stubSelectedEngine(true);
      mocks.runEngineMock.mockResolvedValue(engineSuggestions);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, ...engineSuggestions]);
    });

    it('should return only the memo suggestion when the engine yields no suggestions', async () => {
      stubSelectedEngine(false);
      mocks.runEngineMock.mockResolvedValue([]);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });
  });

  describe('record-declared fallback policy', () => {
    it('should return memo-only when a degrading engine rejects', async () => {
      stubSelectedEngine(true);
      mocks.runEngineMock.mockRejectedValue(new Error('agent timed out'));

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should log the degrading engine failure', async () => {
      stubSelectedEngine(true);
      mocks.runEngineMock.mockRejectedValue(new Error('agent failed'));

      await callGenerateSuggestions();

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should propagate non-degrading engine exceptions unchanged', async () => {
      const engineError = new Error('unexpected engine failure');
      stubSelectedEngine(false);
      mocks.runEngineMock.mockRejectedValue(engineError);

      await expect(callGenerateSuggestions()).rejects.toBe(engineError);
    });
  });

  describe('no engine available', () => {
    it('should return memo-only (not throw) when no engine is available', async () => {
      // Mastra AI unconfigured: the selection resolves to undefined and the
      // orchestrator degrades to the guaranteed memo-only response.
      mocks.selectEngineMock.mockReturnValue(undefined);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.runEngineMock).not.toHaveBeenCalled();
    });
  });

  describe('memo generation failure', () => {
    it('should propagate memo generation failure on the non-degrading path', async () => {
      const memoError = new Error('memo generation failed');
      mocks.generateMemoSuggestionMock.mockRejectedValue(memoError);
      stubSelectedEngine(false);
      mocks.runEngineMock.mockResolvedValue([]);

      await expect(callGenerateSuggestions()).rejects.toBe(memoError);
    });

    it('should propagate memo generation failure on the degrading path (not swallowed by fallback)', async () => {
      const memoError = new Error('memo generation failed');
      mocks.generateMemoSuggestionMock.mockRejectedValue(memoError);
      stubSelectedEngine(true);
      mocks.runEngineMock.mockResolvedValue([]);

      await expect(callGenerateSuggestions()).rejects.toBe(memoError);
    });
  });
});
