import catalog from '^/resource/model-catalog-data.json' with { type: 'json' };

import { getSelectableModels } from './model-catalog';

describe('getSelectableModels', () => {
  describe('catalog-backed providers', () => {
    // The expected value is derived from the same committed catalog so these tests
    // survive `vendor:models` regeneration (which the release workflow runs without a
    // test gate); asserting the whole slice with toEqual still catches a provider
    // mix-up (returning another provider's list) — the reason not to just check
    // non-emptiness (1.1/3.1).
    it('returns openai model ids from the committed catalog', () => {
      const result = getSelectableModels('openai');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toEqual(catalog.models.openai);
    });

    it('returns anthropic model ids from the committed catalog', () => {
      const result = getSelectableModels('anthropic');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toEqual(catalog.models.anthropic);
    });

    it('returns google model ids from the committed catalog', () => {
      const result = getSelectableModels('google');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toEqual(catalog.models.google);
    });
  });

  describe('catalog-less providers', () => {
    it('returns an empty array for azure-openai (fail-soft, Req 3.1)', () => {
      // azure-openai is not in the static catalog: enumeration is impossible,
      // so the read path returns [] rather than throwing (Error Handling).
      expect(getSelectableModels('azure-openai')).toEqual([]);
    });
  });

  describe('offline guarantee (Req 2.1/2.2/2.3)', () => {
    it('performs no network I/O when producing the list', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      getSelectableModels('openai');

      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('is synchronous (returns a plain array, not a Promise)', () => {
      // A synchronous return proves there is no awaited I/O in the read path.
      const result = getSelectableModels('openai');

      expect(result).not.toBeInstanceOf(Promise);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('immutability', () => {
    it('returns a fresh copy so callers cannot corrupt the shared catalog', () => {
      const first = getSelectableModels('openai');
      const originalLength = first.length;

      first.push({ id: '__mutated__', name: '__mutated__' });

      const second = getSelectableModels('openai');
      expect(second.map((m) => m.id)).not.toContain('__mutated__');
      expect(second.length).toBe(originalLength);
    });
  });

  describe('artifact conformance (ModelCatalogFile shape)', () => {
    it('the committed catalog conforms to the ModelCatalogFile contract', () => {
      expect(typeof catalog._source).toBe('string');
      expect(typeof catalog._generatedAt).toBe('string');

      for (const provider of ['openai', 'anthropic', 'google'] as const) {
        const models = catalog.models[provider];
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBeGreaterThan(0);
        expect(
          models.every(
            (m) => typeof m.id === 'string' && typeof m.name === 'string',
          ),
        ).toBe(true);
      }
    });
  });
});
