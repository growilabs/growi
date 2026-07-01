import { getSelectableModelIds } from './model-catalog';
import catalog from './model-catalog-data.json' with { type: 'json' };

describe('getSelectableModelIds', () => {
  describe('catalog-backed providers', () => {
    it('returns a non-empty list of model ids for openai', () => {
      // Contract: a provider present in the committed catalog yields its ids (1.1/3.1).
      const result = getSelectableModelIds('openai');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((id) => typeof id === 'string')).toBe(true);
      // Sanity: openai ids, not another provider's list.
      expect(result).toContain('gpt-4o');
    });

    it('returns a non-empty list of model ids for anthropic', () => {
      const result = getSelectableModelIds('anthropic');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('claude-opus-4-8');
    });

    it('returns a non-empty list of model ids for google', () => {
      const result = getSelectableModelIds('google');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('gemini-2.5-pro');
    });
  });

  describe('catalog-less providers', () => {
    it('returns an empty array for azure-openai (fail-soft, Req 3.1)', () => {
      // azure-openai is not in the static catalog: enumeration is impossible,
      // so the read path returns [] rather than throwing (Error Handling).
      expect(getSelectableModelIds('azure-openai')).toEqual([]);
    });
  });

  describe('offline guarantee (Req 2.1/2.2/2.3)', () => {
    it('performs no network I/O when producing the list', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      getSelectableModelIds('openai');

      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('is synchronous (returns a plain array, not a Promise)', () => {
      // A synchronous return proves there is no awaited I/O in the read path.
      const result = getSelectableModelIds('openai');

      expect(result).not.toBeInstanceOf(Promise);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('immutability', () => {
    it('returns a fresh copy so callers cannot corrupt the shared catalog', () => {
      const first = getSelectableModelIds('openai');
      const originalLength = first.length;

      first.push('__mutated__');

      const second = getSelectableModelIds('openai');
      expect(second).not.toContain('__mutated__');
      expect(second.length).toBe(originalLength);
    });
  });

  describe('artifact conformance (ModelCatalogFile shape)', () => {
    it('the committed catalog conforms to the ModelCatalogFile contract', () => {
      expect(typeof catalog._source).toBe('string');
      expect(typeof catalog._generatedAt).toBe('string');

      for (const provider of ['openai', 'anthropic', 'google'] as const) {
        const ids = catalog.models[provider];
        expect(Array.isArray(ids)).toBe(true);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every((id) => typeof id === 'string')).toBe(true);
      }
    });
  });
});
