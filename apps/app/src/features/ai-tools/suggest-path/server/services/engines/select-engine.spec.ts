const mocks = vi.hoisted(() => {
  return {
    agenticEngineMock: vi.fn(),
    isAiConfiguredMock: vi.fn(),
  };
});

vi.mock('./agentic-engine', () => ({
  agenticEngine: mocks.agenticEngineMock,
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured: mocks.isAiConfiguredMock,
}));

describe('selectEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when the Mastra AI stack is configured', () => {
    it('should select the agentic engine with degrade-to-memo semantics', async () => {
      mocks.isAiConfiguredMock.mockReturnValue(true);
      const { selectEngine } = await import('./index');

      const record = selectEngine();

      expect(record?.id).toBe('agentic');
      expect(record?.run).toBe(mocks.agenticEngineMock);
      expect(record?.degradeToMemoOnFailure).toBe(true);
    });
  });

  describe('when the Mastra AI stack is not configured', () => {
    it('should select no engine so the orchestrator degrades to memo only', async () => {
      mocks.isAiConfiguredMock.mockReturnValue(false);
      const { selectEngine } = await import('./index');

      expect(selectEngine()).toBeUndefined();
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
