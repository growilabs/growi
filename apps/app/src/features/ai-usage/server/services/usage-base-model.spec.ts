import { ConfigSource } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type {
  EffectiveCatalog,
  findCatalogEntry as findCatalogEntryFn,
} from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';

const { getConfig, resolveEffectiveCatalog, findCatalogEntry, loggerWarn } =
  vi.hoisted(() => ({
    getConfig: vi.fn(),
    resolveEffectiveCatalog: vi.fn<() => Promise<EffectiveCatalog>>(),
    findCatalogEntry: vi.fn<typeof findCatalogEntryFn>(),
    loggerWarn: vi.fn(),
  }));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog',
  () => ({ resolveEffectiveCatalog, findCatalogEntry }),
);

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  readUsageBaseModel,
  warnIfUsageBaseModelInvalid,
} from './usage-base-model';

// Model a ConfigManager whose db layer and env layer disagree: only a read that
// passes ConfigSource.env sees the env value.
const configureLayers = (opts: { db?: unknown; env?: unknown }): void => {
  getConfig.mockImplementation((key: string, source?: string) => {
    if (key !== 'ai:usageBaseModel') return undefined;
    if (source === ConfigSource.env) return opts.env;
    if (source === ConfigSource.db) return opts.db;
    return opts.db ?? opts.env;
  });
};

describe('readUsageBaseModel', () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it('parses a provider/modelId key from env', () => {
    configureLayers({ env: 'openai/gpt-4o-mini' });
    expect(readUsageBaseModel()).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
    });
  });

  it('keeps a slash inside the model id', () => {
    configureLayers({ env: 'anthropic/claude/sonnet' });
    expect(readUsageBaseModel()).toEqual({
      provider: 'anthropic',
      modelId: 'claude/sonnet',
    });
  });

  it('ignores a db value and uses the env value only', () => {
    configureLayers({ db: 'anthropic/db-model', env: 'openai/env-model' });
    expect(readUsageBaseModel()).toEqual({
      provider: 'openai',
      modelId: 'env-model',
    });
  });

  it('returns null when only the db has a value', () => {
    configureLayers({ db: 'openai/db-model', env: undefined });
    expect(readUsageBaseModel()).toBeNull();
  });

  it.each([
    ['unset', undefined],
    ['null', null],
    ['empty string', ''],
    ['no separator', 'gpt-4o-mini'],
    ['unknown provider', 'nope/gpt-4o-mini'],
    ['empty model id', 'openai/'],
    ['non-string value', 42],
  ])('returns null for a malformed value (%s)', (_label, value) => {
    configureLayers({ env: value });
    expect(readUsageBaseModel()).toBeNull();
  });
});

describe('warnIfUsageBaseModelInvalid', () => {
  const catalog = mock<EffectiveCatalog>();
  const entry = mock<NonNullable<ReturnType<typeof findCatalogEntryFn>>>();

  beforeEach(() => {
    getConfig.mockReset();
    loggerWarn.mockReset();
    resolveEffectiveCatalog.mockReset();
    findCatalogEntry.mockReset();
    resolveEffectiveCatalog.mockResolvedValue(catalog);
    findCatalogEntry.mockReturnValue(entry);
  });

  const warnedText = (): string => JSON.stringify(loggerWarn.mock.calls);

  it('does not warn for a valid setting present in the catalog', async () => {
    configureLayers({ env: 'openai/gpt-4o-mini' });
    await warnIfUsageBaseModelInvalid();
    expect(findCatalogEntry).toHaveBeenCalledWith(
      catalog,
      'openai',
      'gpt-4o-mini',
    );
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
  ])('does not warn when the setting is unset (%s)', async (_label, value) => {
    configureLayers({ env: value });
    await warnIfUsageBaseModelInvalid();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it.each([
    ['no separator', 'gpt-4o-mini'],
    ['unknown provider', 'nope/gpt-4o-mini'],
    ['empty model id', 'openai/'],
  ])('warns once with the key and value for a malformed key (%s)', async (_label, value) => {
    configureLayers({ env: value });
    await warnIfUsageBaseModelInvalid();
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain('ai:usageBaseModel');
    expect(warnedText()).toContain(value);
  });

  it('warns once when a valid key names a model absent from the catalog', async () => {
    configureLayers({ env: 'openai/unknown-model' });
    findCatalogEntry.mockReturnValue(undefined);
    await warnIfUsageBaseModelInvalid();
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain('openai/unknown-model');
  });

  it('does not throw or warn when the catalog read fails', async () => {
    configureLayers({ env: 'openai/gpt-4o-mini' });
    resolveEffectiveCatalog.mockRejectedValue(new Error('db down'));
    await expect(warnIfUsageBaseModelInvalid()).resolves.toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('does not throw or warn when the catalog lookup throws on a corrupt entry', async () => {
    configureLayers({ env: 'openai/gpt-4o-mini' });
    findCatalogEntry.mockImplementation(() => {
      throw new Error('corrupt');
    });
    await expect(warnIfUsageBaseModelInvalid()).resolves.toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});
