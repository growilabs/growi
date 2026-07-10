// --- Mock boundary ---------------------------------------------------------
//
// buildModelDisplayNameResolver joins the operator allow-list (ids only) with the
// EFFECTIVE catalog (id + name) to produce display names. Its one collaborator is
// getEffectiveModelPicker(): it resolves the effective catalog ONCE and returns a
// synchronous (provider) → entries accessor. We mock it so the test drives the
// resolver's join/fallback/dedup contract without touching MongoDB or the bundled
// asset. The effective catalog's own resolution (newer-wins, fail-soft) is
// covered by effective-model-catalog.spec.
const { getEffectiveModelPicker } = vi.hoisted(() => ({
  getEffectiveModelPicker: vi.fn(),
}));
vi.mock('./effective-model-catalog', () => ({ getEffectiveModelPicker }));

import type { AiProvider } from '../../../interfaces/ai-provider';
import { buildModelDisplayNameResolver } from './resolve-model-display-name';

const catalogs: Partial<Record<AiProvider, { id: string; name: string }[]>> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-2024-08-06', name: 'GPT-4o (2024-08-06)' },
  ],
  anthropic: [{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (latest)' }],
  // azure-openai deliberately absent → the effective read yields [] for it.
};

// The picker the mocked getEffectiveModelPicker resolves to: a synchronous
// per-provider lookup over `catalogs`. Re-created per test so its call count is
// clean.
const buildPick = () =>
  vi.fn((provider: AiProvider) => catalogs[provider] ?? []);

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveModelPicker.mockResolvedValue(buildPick());
});

describe('buildModelDisplayNameResolver', () => {
  it('resolves the official name for a (provider, id) present in the catalog', async () => {
    const resolve = await buildModelDisplayNameResolver(['openai']);

    expect(resolve('openai', 'gpt-4o')).toBe('GPT-4o');
    expect(resolve('openai', 'gpt-4o-2024-08-06')).toBe('GPT-4o (2024-08-06)');
  });

  it('falls back to the modelId when the id is absent from the catalog (removed / free-text)', async () => {
    const resolve = await buildModelDisplayNameResolver(['openai']);

    expect(resolve('openai', 'gpt-3.5-turbo-legacy')).toBe(
      'gpt-3.5-turbo-legacy',
    );
  });

  it('falls back to the modelId for a catalog-less provider (azure-openai → deployment name)', async () => {
    const resolve = await buildModelDisplayNameResolver(['azure-openai']);

    // Azure deployment names are operator-defined and not enumerable, so the
    // resolver echoes the id as its own display name.
    expect(resolve('azure-openai', 'my-gpt4o-deployment')).toBe(
      'my-gpt4o-deployment',
    );
  });

  it('reads the effective catalog ONCE and resolves each distinct provider once, regardless of duplicate/interleaved input', async () => {
    const pick = buildPick();
    getEffectiveModelPicker.mockResolvedValue(pick);

    const resolve = await buildModelDisplayNameResolver([
      'openai',
      'anthropic',
      'openai',
      'anthropic',
    ]);

    // The persisted singleton is read a SINGLE time (one picker acquisition)
    // for the whole allow-list — not once per provider.
    expect(getEffectiveModelPicker).toHaveBeenCalledTimes(1);
    // The synchronous accessor is then invoked once per DISTINCT provider.
    expect(pick).toHaveBeenCalledTimes(2);
    // Both providers still resolve correctly after the dedup.
    expect(resolve('openai', 'gpt-4o')).toBe('GPT-4o');
    expect(resolve('anthropic', 'claude-opus-4-5')).toBe(
      'Claude Opus 4.5 (latest)',
    );
  });

  it('resolves against only the providers it was given (an unfetched provider falls back to the id)', async () => {
    const resolve = await buildModelDisplayNameResolver(['openai']);

    // anthropic was never fetched, so even a real anthropic id has no name map.
    expect(resolve('anthropic', 'claude-opus-4-5')).toBe('claude-opus-4-5');
  });
});
