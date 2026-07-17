import { mock } from 'vitest-mock-extended';

import type { SearchService } from '../../../interfaces/suggest-path-types';

const mocks = vi.hoisted(() => {
  return {
    oneshotEngineMock: vi.fn(),
    agenticEngineMock: vi.fn(),
    isAiConfiguredMock: vi.fn(),
  };
});

vi.mock('./oneshot-engine', () => ({
  oneshotEngine: mocks.oneshotEngineMock,
}));

vi.mock('./agentic-engine', () => ({
  agenticEngine: mocks.agenticEngineMock,
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured: mocks.isAiConfiguredMock,
}));

const reachableSearchService = mock<SearchService>({ isReachable: true });
const unreachableSearchService = mock<SearchService>({ isReachable: false });

describe('selectEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when the Mastra AI stack is configured', () => {
    beforeEach(() => {
      mocks.isAiConfiguredMock.mockReturnValue(true);
    });

    it('should select the agentic engine with degrade-to-memo semantics', async () => {
      const { selectEngine } = await import('./index');

      const record = selectEngine(reachableSearchService);

      expect(record?.id).toBe('agentic');
      expect(record?.run).toBe(mocks.agenticEngineMock);
      expect(record?.degradeToMemoOnFailure).toBe(true);
    });

    it('should select the agentic engine even when full-text search is not reachable', async () => {
      const { selectEngine } = await import('./index');

      const record = selectEngine(unreachableSearchService);

      expect(record?.id).toBe('agentic');
    });
  });

  describe('when the Mastra AI stack is not configured', () => {
    beforeEach(() => {
      mocks.isAiConfiguredMock.mockReturnValue(false);
    });

    it('should fall back to the oneshot engine with propagate-on-failure semantics while full-text search is reachable', async () => {
      const { selectEngine } = await import('./index');

      const record = selectEngine(reachableSearchService);

      expect(record?.id).toBe('oneshot');
      expect(record?.run).toBe(mocks.oneshotEngineMock);
      expect(record?.degradeToMemoOnFailure).toBe(false);
    });

    it('should select no engine when full-text search is not reachable either', async () => {
      const { selectEngine } = await import('./index');

      expect(selectEngine(unreachableSearchService)).toBeUndefined();
    });
  });
});

describe('engines barrel (index.ts)', () => {
  it('should expose selectEngine as its only runtime export', async () => {
    const barrel = await import('./index');

    expect(Object.keys(barrel)).toEqual(['selectEngine']);
    expect(typeof barrel.selectEngine).toBe('function');
  });
});
