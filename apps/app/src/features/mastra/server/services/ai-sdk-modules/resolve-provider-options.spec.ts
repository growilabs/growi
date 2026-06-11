const { getConfig, warn } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({ warn, error: vi.fn(), debug: vi.fn(), info: vi.fn() }),
}));

import { resolveProviderOptions } from './resolve-provider-options';

const setRaw = (value: string | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'mastra:llmProviderOptions' ? value : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveProviderOptions', () => {
  it('parses a provider-namespaced JSON object and returns it as-is (Req 6.1, 6.2)', () => {
    setRaw('{"openai":{"reasoningEffort":"low","reasoningSummary":"auto"}}');

    expect(resolveProviderOptions()).toEqual({
      openai: { reasoningEffort: 'low', reasoningSummary: 'auto' },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('passes through a non-OpenAI vendor namespace without interpretation (Req 6.2)', () => {
    setRaw('{"anthropic":{"thinking":{"type":"enabled","budgetTokens":1024}}}');

    expect(resolveProviderOptions()).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } },
    });
  });

  it('resolves the default OpenAI reasoning options when the env carries the default (Req 6.3)', () => {
    // The config defaultValue is this JSON string; the resolver simply parses it.
    setRaw('{"openai":{"reasoningEffort":"low","reasoningSummary":"auto"}}');

    expect(resolveProviderOptions()).toEqual({
      openai: { reasoningEffort: 'low', reasoningSummary: 'auto' },
    });
  });

  it('returns an empty object when unset/empty (no options applied)', () => {
    setRaw(undefined);
    expect(resolveProviderOptions()).toEqual({});

    setRaw('');
    expect(resolveProviderOptions()).toEqual({});
  });

  describe('fail-soft on invalid input (Req 6.4)', () => {
    it('returns {} and warns on malformed JSON (does not throw)', () => {
      setRaw('{"openai": {');

      expect(() => resolveProviderOptions()).not.toThrow();
      expect(resolveProviderOptions()).toEqual({});
      expect(warn).toHaveBeenCalled();
    });

    it('returns {} and warns when the JSON is not an object (array)', () => {
      setRaw('["openai"]');
      expect(resolveProviderOptions()).toEqual({});
      expect(warn).toHaveBeenCalled();
    });

    it('returns {} and warns when the JSON is a primitive', () => {
      setRaw('"openai"');
      expect(resolveProviderOptions()).toEqual({});
      expect(warn).toHaveBeenCalled();
    });

    it('returns {} and warns when a provider entry is not an option object', () => {
      // Top-level is an object but the namespace value is a primitive/array.
      setRaw('{"openai":"reasoningEffort"}');
      expect(resolveProviderOptions()).toEqual({});
      expect(warn).toHaveBeenCalled();
    });
  });
});
