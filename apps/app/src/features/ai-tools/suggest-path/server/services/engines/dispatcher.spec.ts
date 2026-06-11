import type { IUserHasId } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  PathSuggestion,
  SearchService,
} from '../../../interfaces/suggest-path-types';
import type { SuggestPathEngineInput } from './engine-types';

const mocks = vi.hoisted(() => {
  return {
    oneshotEngineMock: vi.fn(),
    agenticEngineMock: vi.fn(),
  };
});

vi.mock('./oneshot-engine', () => ({
  oneshotEngine: mocks.oneshotEngineMock,
}));

vi.mock('./agentic-engine', () => ({
  agenticEngine: mocks.agenticEngineMock,
}));

const mockInput: SuggestPathEngineInput = {
  user: mock<IUserHasId>({ username: 'alice' }),
  body: 'Some page content',
  userGroups: ['group1', 'group2'] as ObjectIdLike[],
  searchService: mock<SearchService>(),
};

const oneshotSuggestions: PathSuggestion[] = [
  {
    type: 'search',
    path: '/tech/React/',
    label: 'Save near related pages',
    description: 'This area contains React documentation.',
    grant: 1,
    informationType: 'stock',
  },
];

const agenticSuggestions: PathSuggestion[] = [
  {
    type: 'category',
    path: '/tech/',
    label: 'Save under category',
    description: 'Top-level category: tech',
    grant: 1,
  },
];

describe('runEngine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const callRunEngine = async (engineId: 'oneshot' | 'agentic') => {
    const { runEngine } = await import('./index');
    return runEngine(engineId, mockInput);
  };

  describe("when engine id is 'oneshot'", () => {
    it('should invoke the oneshot engine with the given input and return its result unaltered', async () => {
      mocks.oneshotEngineMock.mockResolvedValue(oneshotSuggestions);

      const result = await callRunEngine('oneshot');

      expect(mocks.oneshotEngineMock).toHaveBeenCalledTimes(1);
      expect(mocks.oneshotEngineMock).toHaveBeenCalledWith(mockInput);
      expect(result).toBe(oneshotSuggestions);
      expect(mocks.agenticEngineMock).not.toHaveBeenCalled();
    });
  });

  describe("when engine id is 'agentic'", () => {
    it('should invoke the agentic engine with the given input and return its result unaltered', async () => {
      mocks.agenticEngineMock.mockResolvedValue(agenticSuggestions);

      const result = await callRunEngine('agentic');

      expect(mocks.agenticEngineMock).toHaveBeenCalledTimes(1);
      expect(mocks.agenticEngineMock).toHaveBeenCalledWith(mockInput);
      expect(result).toBe(agenticSuggestions);
      expect(mocks.oneshotEngineMock).not.toHaveBeenCalled();
    });
  });

  describe('when the resolved engine rejects', () => {
    it('should propagate the rejection unaltered (fallback is the orchestrator responsibility)', async () => {
      const engineError = new Error('agent execution failed');
      mocks.agenticEngineMock.mockRejectedValue(engineError);

      await expect(callRunEngine('agentic')).rejects.toBe(engineError);
    });
  });
});

describe('engines barrel (index.ts)', () => {
  it('should expose runEngine as its only runtime export', async () => {
    const barrel = await import('./index');

    expect(Object.keys(barrel)).toEqual(['runEngine']);
    expect(typeof barrel.runEngine).toBe('function');
  });
});
