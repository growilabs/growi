// --- Mock boundary ---------------------------------------------------------
//
// getEffectiveSelectableModelIds resolves "refreshed (persisted) ?? bundled"
// (Req 9.5). The persistence singleton (prisma.mastrarefreshedmodelcatalogs)
// is mocked to drive both branches; the bundled fallback is the REAL committed
// asset so the fallback branch proves the actual offline behavior (Req 2).
const { getSingleton } = vi.hoisted(() => ({
  getSingleton: vi.fn(),
}));

vi.mock('~/utils/prisma', () => ({
  prisma: { mastrarefreshedmodelcatalogs: { getSingleton } },
}));

import { getEffectiveSelectableModelIds } from './effective-model-catalog';
import { BUNDLED_CATALOG_GENERATED_AT } from './model-catalog';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEffectiveSelectableModelIds (Req 9.5)', () => {
  describe('when a refreshed catalog is persisted (newer than the bundled asset)', () => {
    beforeEach(() => {
      getSingleton.mockResolvedValue({
        models: { openai: ['refreshed-model'] },
        // Fetched "now" — strictly newer than the committed asset's header.
        fetchedAt: new Date(),
        source: 'https://models.dev/api.json (MIT)',
      });
    });

    it('serves the refreshed catalog instead of the bundled one', async () => {
      await expect(getEffectiveSelectableModelIds('openai')).resolves.toEqual([
        'refreshed-model',
      ]);
    });

    it('fails soft to [] for a provider absent from the refreshed catalog (Req 3.1)', async () => {
      await expect(
        getEffectiveSelectableModelIds('azure-openai'),
      ).resolves.toEqual([]);
    });

    it('returns a fresh copy so callers cannot mutate the stored catalog', async () => {
      const first = await getEffectiveSelectableModelIds('openai');
      first.push('__mutated__');

      const second = await getEffectiveSelectableModelIds('openai');
      expect(second).toEqual(['refreshed-model']);
    });
  });

  describe('when the bundled asset is NEWER than the persisted snapshot (e.g. after an image update)', () => {
    beforeEach(() => {
      getSingleton.mockResolvedValue({
        models: { openai: ['stale-refreshed-model'] },
        // Strictly older than the committed asset's _generatedAt header.
        fetchedAt: new Date(0),
        source: 'https://models.dev/api.json (MIT)',
      });
    });

    it('serves the bundled catalog instead of the stale snapshot (Req 9.5)', async () => {
      const ids = await getEffectiveSelectableModelIds('openai');

      expect(ids).not.toContain('stale-refreshed-model');
      expect(ids.length).toBeGreaterThan(0); // the real bundled openai list
    });

    it('keeps the bundled behavior for catalog-less providers (azure → [])', async () => {
      await expect(
        getEffectiveSelectableModelIds('azure-openai'),
      ).resolves.toEqual([]);
    });
  });

  describe('when the snapshot and the bundled asset have the SAME timestamp', () => {
    it('resolves the tie to the refreshed snapshot (bundled wins only when STRICTLY newer)', async () => {
      getSingleton.mockResolvedValue({
        models: { openai: ['refreshed-model'] },
        fetchedAt: new Date(BUNDLED_CATALOG_GENERATED_AT.getTime()),
        source: 'https://models.dev/api.json (MIT)',
      });

      await expect(getEffectiveSelectableModelIds('openai')).resolves.toEqual([
        'refreshed-model',
      ]);
    });
  });

  describe('when no refreshed catalog exists (never refreshed)', () => {
    beforeEach(() => {
      getSingleton.mockResolvedValue(null);
    });

    it('falls back to the bundled committed catalog (openai non-empty)', async () => {
      const ids = await getEffectiveSelectableModelIds('openai');
      expect(ids.length).toBeGreaterThan(0);
    });

    it('keeps the bundled behavior for catalog-less providers (azure → [])', async () => {
      await expect(
        getEffectiveSelectableModelIds('azure-openai'),
      ).resolves.toEqual([]);
    });

    it('performs no external communication (Req 2.1)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await getEffectiveSelectableModelIds('openai');

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
