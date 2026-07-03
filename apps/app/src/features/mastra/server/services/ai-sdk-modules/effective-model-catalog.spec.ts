// --- Mock boundary ---------------------------------------------------------
//
// getEffectiveSelectableModelIds resolves the NEWER of the refreshed
// (persisted) and bundled catalogs, comparing bundled _generatedAt values on
// both sides (Req 9.5). The persistence singleton
// (prisma.mastrarefreshedmodelcatalogs) is mocked to drive the branches; the
// bundled fallback is the REAL committed asset so the fallback branch proves
// the actual offline behavior (Req 2).
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
  describe('when the snapshot was refreshed against the CURRENT bundled generation (same image)', () => {
    beforeEach(() => {
      getSingleton.mockResolvedValue({
        models: { openai: ['refreshed-model'] },
        fetchedAt: new Date(),
        // Refresh ran while THIS bundled asset was deployed — the normal case,
        // and a timestamp tie: bundled wins only when STRICTLY newer.
        supersededBundledGeneratedAt: new Date(
          BUNDLED_CATALOG_GENERATED_AT.getTime(),
        ),
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

    it('is NOT shadowed by a lagging server clock (fetchedAt older than the bundled _generatedAt)', async () => {
      // Regression: the resolution must compare bundled generations only.
      // fetchedAt comes from the SERVER clock — if it were compared against
      // the CI-clock _generatedAt, a lagging server clock would silently
      // shadow a just-persisted refresh while the admin sees a success toast.
      getSingleton.mockResolvedValue({
        models: { openai: ['refreshed-model'] },
        fetchedAt: new Date(0), // server clock hopelessly behind the CI clock
        supersededBundledGeneratedAt: new Date(
          BUNDLED_CATALOG_GENERATED_AT.getTime(),
        ),
        source: 'https://models.dev/api.json (MIT)',
      });

      await expect(getEffectiveSelectableModelIds('openai')).resolves.toEqual([
        'refreshed-model',
      ]);
    });
  });

  describe('when the image now bundles a NEWER catalog generation (image updated after the refresh)', () => {
    beforeEach(() => {
      getSingleton.mockResolvedValue({
        models: { openai: ['stale-refreshed-model'] },
        fetchedAt: new Date(),
        // Refresh ran against an OLDER bundled generation than the current one.
        supersededBundledGeneratedAt: new Date(0),
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

  describe('when the image was ROLLED BACK to an older bundled generation after the refresh', () => {
    it('keeps serving the refreshed snapshot (it holds live-fetched data)', async () => {
      getSingleton.mockResolvedValue({
        models: { openai: ['refreshed-model'] },
        fetchedAt: new Date(),
        // The refresh ran on a NEWER image than the one now deployed.
        supersededBundledGeneratedAt: new Date(
          BUNDLED_CATALOG_GENERATED_AT.getTime() + 86_400_000,
        ),
        source: 'https://models.dev/api.json (MIT)',
      });

      await expect(getEffectiveSelectableModelIds('openai')).resolves.toEqual([
        'refreshed-model',
      ]);
    });
  });

  describe('when the persisted snapshot cannot be read (version skew, DB failure)', () => {
    it('falls back to the bundled catalog when getSingleton rejects (e.g. a document Prisma cannot map)', async () => {
      // A document written by a different code version (missing/mistyped
      // required fields) makes the Prisma read itself throw. The endpoint must
      // degrade to the bundled catalog, not answer 500 on every request.
      getSingleton.mockRejectedValue(
        new Error('P2032: missing required field'),
      );

      const ids = await getEffectiveSelectableModelIds('openai');
      expect(ids.length).toBeGreaterThan(0); // the real bundled openai list
    });

    it('falls back to the bundled catalog when the snapshot data throws at use (defense in depth)', async () => {
      // getSingleton validates on read, but if a corrupt value ever slips
      // through, spreading a non-iterable must be caught, not become a 500.
      getSingleton.mockResolvedValue({
        models: { openai: 42 },
        fetchedAt: new Date(),
        supersededBundledGeneratedAt: new Date(
          BUNDLED_CATALOG_GENERATED_AT.getTime(),
        ),
        source: 'https://models.dev/api.json (MIT)',
      });

      const ids = await getEffectiveSelectableModelIds('openai');
      expect(ids.length).toBeGreaterThan(0); // the real bundled openai list
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
