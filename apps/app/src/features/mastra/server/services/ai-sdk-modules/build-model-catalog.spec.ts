import {
  buildModelCatalog,
  deriveProviderCounts,
  formatProviderCounts,
  persistedModelCatalogSchema,
  pickSelectableModelIds,
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
  it('keeps only selectable (tool_call && text-output) ids, sorted, per provider', () => {
    const catalog = buildModelCatalog(happyFixture());

    // openai: only the two selectable ids survive, sorted; non-selectable absent
    expect(catalog.openai).toEqual(['gpt-4.1', 'gpt-4o']);
    expect(catalog.openai).not.toContain('text-only-no-tools'); // tool_call:false excluded (6.1)
    expect(catalog.openai).not.toContain('dall-e-3'); // non-text output excluded (6.1)
    expect(catalog.openai).not.toContain('text-embedding-3-large'); // embedding excluded (6.1)

    expect(catalog.anthropic).toEqual([
      'claude-3-5-haiku',
      'claude-3-7-sonnet',
    ]);
    expect(catalog.google).toEqual(['gemini-2.5-pro']);
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

    const rebuilt = buildModelCatalog(scrambled as unknown);
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
    expect(() => buildModelCatalog(malformed as unknown)).toThrow();
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
    expect(() => buildModelCatalog(malformed as unknown)).toThrow();
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
    expect(() => buildModelCatalog(emptyGoogle as unknown)).toThrow(/google/);
  });

  it('throws when a target provider is missing entirely', () => {
    const missingGoogle = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
    };
    expect(() => buildModelCatalog(missingGoogle as unknown)).toThrow();
  });
});

describe('persistedModelCatalogSchema (read-side validation)', () => {
  const validCatalog = {
    openai: ['gpt-4o'],
    anthropic: ['claude-sonnet-4'],
    google: ['gemini-2.5-pro'],
  };

  it('accepts what buildModelCatalog writes (every provider → string array)', () => {
    const parsed = persistedModelCatalogSchema.safeParse(validCatalog);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(validCatalog);
  });

  // Each rejection below represents a document a DIFFERENT code version (or an
  // operator) wrote: the reader must treat it as absent (bundled fallback),
  // never crash on it. Note a string value would not even throw at the read
  // site (`[...'text']` spreads into characters), so the schema is the only
  // guard against silently serving garbage.
  it.each([
    ['a non-array provider value', { ...validCatalog, openai: 'gpt-4o' }],
    ['a non-iterable provider value', { ...validCatalog, openai: 42 }],
    [
      'an unknown provider key (newer version wrote it)',
      { ...validCatalog, mistral: ['m'] },
    ],
    [
      'a missing provider key (older version wrote it)',
      { openai: ['gpt-4o'], anthropic: ['claude'] },
    ],
    ['a null document field', null],
    ['a non-object value', 'catalog'],
  ])('rejects %s', (_label, value) => {
    expect(persistedModelCatalogSchema.safeParse(value).success).toBe(false);
  });
});

describe('catalog accessors', () => {
  const catalog = {
    openai: ['gpt-4.1', 'gpt-4o'],
    anthropic: ['claude-3-7-sonnet'],
    google: ['gemini-2.5-pro'],
  };

  describe('pickSelectableModelIds', () => {
    it('returns the ids for a catalog-backed provider', () => {
      expect(pickSelectableModelIds(catalog, 'openai')).toEqual([
        'gpt-4.1',
        'gpt-4o',
      ]);
    });

    it('fails soft to [] for a catalog-less provider (Req 3.1)', () => {
      expect(pickSelectableModelIds(catalog, 'azure-openai')).toEqual([]);
    });

    it('returns a fresh copy so callers cannot mutate the catalog', () => {
      const first = pickSelectableModelIds(catalog, 'openai');
      first.push('__mutated__');

      expect(pickSelectableModelIds(catalog, 'openai')).toEqual([
        'gpt-4.1',
        'gpt-4o',
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
