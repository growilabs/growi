import {
  buildModelCatalog,
  deriveProviderCounts,
  formatProviderCounts,
  persistedModelCatalogSchema,
  pickSelectableModels,
} from './build-model-catalog';

/**
 * A minimal models.dev api.json shaped fixture. Only the fields the transform
 * reads (`tool_call`, `modalities.output`) are meaningful; everything else is
 * padding to mirror the real, wider entries and to prove passthrough tolerance.
 */
const selectable = (id: string) => ({
  id,
  name: id,
  // extra fields the real api.json carries — must be ignored/passthrough
  family: 'x',
  attachment: false,
  reasoning: false,
  structured_output: true,
  tool_call: true,
  modalities: { input: ['text', 'image'], output: ['text'] },
});

const notToolCall = (id: string) => ({
  id,
  name: id,
  tool_call: false,
  modalities: { input: ['text'], output: ['text'] },
});

const nonTextOutput = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text'], output: ['image'] },
});

const embeddingOutput = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text'], output: ['embedding'] },
});

// An entry with the two filter fields ABSENT. models.dev never ships this shape
// (even non-chat models carry the fields with non-selectable values), so their
// absence means the upstream shape has drifted — the transform must fail loudly,
// not silently drop entries from a selection-only catalog (Issue 2).
const missingFilterFields = (id: string) => ({
  id,
  name: id,
  // no tool_call, no modalities — a drifted/incomplete entry shape
  cost: { input: 0.1, output: 0.2 },
});

// Accept any entry shape carrying an id: the fixtures deliberately vary in
// width (selectable is wide, the non-selectable builders are narrow) to prove
// the transform's passthrough tolerance.
const provider = <T extends { id: string }>(
  id: string,
  models: readonly T[],
): unknown => ({
  id,
  name: id,
  env: [],
  npm: `@ai-sdk/${id}`,
  doc: `https://example.test/${id}`,
  models: Object.fromEntries(models.map((m) => [m.id, m])),
});

const happyFixture = (): unknown => ({
  // an untargeted extra provider (must be ignored entirely)
  azure: provider('azure', [selectable('deployment-x')]),
  openai: provider('openai', [
    selectable('gpt-4o'),
    selectable('gpt-4.1'),
    notToolCall('text-only-no-tools'),
    nonTextOutput('dall-e-3'),
    embeddingOutput('text-embedding-3-large'),
  ]),
  anthropic: provider('anthropic', [
    selectable('claude-3-7-sonnet'),
    selectable('claude-3-5-haiku'),
  ]),
  google: provider('google', [
    selectable('gemini-2.5-pro'),
    embeddingOutput('text-embedding-004'),
  ]),
});

describe('buildModelCatalog', () => {
  it('keeps only selectable (tool_call && text-output) models with id + name, sorted, per provider', () => {
    const catalog = buildModelCatalog(happyFixture());

    // openai: only the two selectable models survive, sorted by id; each entry
    // carries its display name (the fixtures name each model after its id).
    expect(catalog.openai).toEqual([
      { id: 'gpt-4.1', name: 'gpt-4.1' },
      { id: 'gpt-4o', name: 'gpt-4o' },
    ]);
    const openaiIds = catalog.openai.map((m) => m.id);
    expect(openaiIds).not.toContain('text-only-no-tools'); // tool_call:false excluded (6.1)
    expect(openaiIds).not.toContain('dall-e-3'); // non-text output excluded (6.1)
    expect(openaiIds).not.toContain('text-embedding-3-large'); // embedding excluded (6.1)

    expect(catalog.anthropic).toEqual([
      { id: 'claude-3-5-haiku', name: 'claude-3-5-haiku' },
      { id: 'claude-3-7-sonnet', name: 'claude-3-7-sonnet' },
    ]);
    expect(catalog.google).toEqual([
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
    ]);
  });

  it('falls back to the id as the display name when models.dev omits name', () => {
    // A selectable entry with no `name` — the transform must store the id as the
    // name so the display always has a value (name is not part of the drift
    // contract, unlike tool_call/modalities).
    const noName = {
      id: 'gpt-4o',
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
    };
    const fixture = {
      openai: provider('openai', [noName]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: provider('google', [selectable('gemini-2.5-pro')]),
    };

    const catalog = buildModelCatalog(fixture);

    expect(catalog.openai).toEqual([{ id: 'gpt-4o', name: 'gpt-4o' }]);
  });

  it('does not include untargeted providers (e.g. azure)', () => {
    const catalog = buildModelCatalog(happyFixture()) as Record<
      string,
      unknown
    >;
    expect(catalog.azure).toBeUndefined();
    expect(Object.keys(catalog)).toEqual(['openai', 'anthropic', 'google']);
  });

  it('is deterministic: scrambled input order yields identical sorted output', () => {
    const base = buildModelCatalog(happyFixture());

    // scramble the model insertion order within openai
    const scrambled = happyFixture() as {
      openai: { models: Record<string, unknown> };
    };
    const entries = Object.entries(scrambled.openai.models).reverse();
    scrambled.openai.models = Object.fromEntries(entries);

    const rebuilt = buildModelCatalog(scrambled);
    expect(rebuilt).toEqual(base);
  });

  it('throws when a model entry has the wrong shape (schema drift)', () => {
    const malformed = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: {
        id: 'google',
        name: 'google',
        // models is not an object map — drift
        models: [{ id: 'gemini', tool_call: true }],
      },
    };
    expect(() => buildModelCatalog(malformed)).toThrow();
  });

  it('throws when a target-provider entry omits tool_call/modalities (schema drift)', () => {
    // models.dev populates both fields on every entry, so their absence signals
    // an upstream shape change — not a non-chat entry. It must fail loudly
    // (last-good preserved) rather than silently drop entries from a
    // selection-only catalog, even though the provider keeps a selectable id.
    const withMissingFields = {
      openai: provider('openai', [
        selectable('gpt-4o'),
        missingFilterFields('text-embedding-3-small'),
      ]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: provider('google', [selectable('gemini-2.5-pro')]),
    };

    expect(() => buildModelCatalog(withMissingFields)).toThrow();
  });

  it('throws when tool_call has the wrong type (schema drift)', () => {
    const malformed = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: {
        id: 'google',
        name: 'google',
        models: {
          gemini: {
            id: 'gemini',
            tool_call: 'yes', // wrong type
            modalities: { output: ['text'] },
          },
        },
      },
    };
    expect(() => buildModelCatalog(malformed)).toThrow();
  });

  it('throws naming the empty provider when a target provider has zero selectable models', () => {
    const emptyGoogle = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      // google present but every entry is non-selectable → empty after filter
      google: provider('google', [
        embeddingOutput('text-embedding-004'),
        notToolCall('gemini-embed'),
      ]),
    };
    expect(() => buildModelCatalog(emptyGoogle)).toThrow(/google/);
  });

  it('throws when a target provider is missing entirely', () => {
    const missingGoogle = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
    };
    expect(() => buildModelCatalog(missingGoogle)).toThrow();
  });
});

describe('persistedModelCatalogSchema (read-side validation)', () => {
  const validCatalog = {
    openai: [{ id: 'gpt-4o', name: 'GPT-4o' }],
    anthropic: [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }],
    google: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
  };

  it('accepts what buildModelCatalog writes (every provider → {id,name} array)', () => {
    const parsed = persistedModelCatalogSchema.safeParse(validCatalog);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(validCatalog);
  });

  // Each rejection below represents a document a DIFFERENT code version (or an
  // operator) wrote: the reader must treat it as absent (bundled fallback),
  // never crash on it. This includes the PRE-name shape (bare id strings) a
  // rolling-upgrade predecessor may have written — it must degrade, not crash.
  it.each([
    ['a non-array provider value', { ...validCatalog, openai: 'gpt-4o' }],
    ['a non-iterable provider value', { ...validCatalog, openai: 42 }],
    [
      'the pre-name shape (bare id strings)',
      { ...validCatalog, openai: ['gpt-4o'] },
    ],
    [
      'an entry missing its name',
      { ...validCatalog, openai: [{ id: 'gpt-4o' }] },
    ],
    [
      'an unknown provider key (newer version wrote it)',
      { ...validCatalog, mistral: [{ id: 'm', name: 'M' }] },
    ],
    [
      'a missing provider key (older version wrote it)',
      {
        openai: [{ id: 'gpt-4o', name: 'GPT-4o' }],
        anthropic: [{ id: 'claude', name: 'Claude' }],
      },
    ],
    ['a null document field', null],
    ['a non-object value', 'catalog'],
  ])('rejects %s', (_label, value) => {
    expect(persistedModelCatalogSchema.safeParse(value).success).toBe(false);
  });
});

describe('catalog accessors', () => {
  const catalog = {
    openai: [
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4o', name: 'GPT-4o' },
    ],
    anthropic: [{ id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet' }],
    google: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
  };

  describe('pickSelectableModels', () => {
    it('returns the models for a catalog-backed provider', () => {
      expect(pickSelectableModels(catalog, 'openai')).toEqual([
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'gpt-4o', name: 'GPT-4o' },
      ]);
    });

    it('fails soft to [] for a catalog-less provider (Req 3.1)', () => {
      expect(pickSelectableModels(catalog, 'azure-openai')).toEqual([]);
    });

    it('returns a fresh copy so callers cannot mutate the catalog', () => {
      const first = pickSelectableModels(catalog, 'openai');
      first.push({ id: '__mutated__', name: '__mutated__' });

      expect(pickSelectableModels(catalog, 'openai')).toEqual([
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'gpt-4o', name: 'GPT-4o' },
      ]);
    });
  });

  describe('deriveProviderCounts / formatProviderCounts', () => {
    it('derives per-provider counts and formats them as a log summary', () => {
      const counts = deriveProviderCounts(catalog);

      expect(counts).toEqual({ openai: 2, anthropic: 1, google: 1 });
      expect(formatProviderCounts(counts)).toBe(
        'openai=2, anthropic=1, google=1',
      );
    });
  });
});
