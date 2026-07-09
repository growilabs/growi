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

describe('getEngineRecord', () => {
  describe("when engine id is 'oneshot'", () => {
    it('should resolve the oneshot engine with propagate-on-failure semantics', async () => {
      const { getEngineRecord } = await import('./index');

      const record = getEngineRecord('oneshot');

      expect(record?.run).toBe(mocks.oneshotEngineMock);
      expect(record?.degradeToMemoOnFailure).toBe(false);
    });
  });

  describe("when engine id is 'agentic'", () => {
    it('should resolve the agentic engine with degrade-to-memo semantics', async () => {
      const { getEngineRecord } = await import('./index');

      const record = getEngineRecord('agentic');

      expect(record?.run).toBe(mocks.agenticEngineMock);
      expect(record?.degradeToMemoOnFailure).toBe(true);
    });
  });

  describe('when engine id is unknown (invalid config value)', () => {
    it.each([
      'onshot', // operator typo
      '',
      'AGENTIC', // case must match exactly
    ])('should return undefined for %j', async (engineId) => {
      const { getEngineRecord } = await import('./index');

      expect(getEngineRecord(engineId)).toBeUndefined();
    });

    it('should not resolve via Object.prototype members', async () => {
      const { getEngineRecord } = await import('./index');

      expect(getEngineRecord('constructor')).toBeUndefined();
      expect(getEngineRecord('toString')).toBeUndefined();
    });
  });
});

describe('engines barrel (index.ts)', () => {
  it('should expose getEngineRecord as its only runtime export', async () => {
    const barrel = await import('./index');

    expect(Object.keys(barrel)).toEqual(['getEngineRecord']);
    expect(typeof barrel.getEngineRecord).toBe('function');
  });
});
