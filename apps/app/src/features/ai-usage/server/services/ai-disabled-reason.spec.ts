import { ConfigSource } from '@growi/core/dist/interfaces';

import { AI_DISABLED_REASON_CATALOG_STALE } from '../../interfaces/ai-disabled-reason';

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

import { readAiDisabledReason } from './ai-disabled-reason';

const configureLayers = (opts: { db?: unknown; env?: unknown }): void => {
  getConfig.mockImplementation((key: string, source?: string) => {
    if (key !== 'ai:disabledReason') return undefined;
    if (source === ConfigSource.env) return opts.env;
    if (source === ConfigSource.db) return opts.db;
    return opts.db ?? opts.env;
  });
};

describe('AI_DISABLED_REASON_CATALOG_STALE', () => {
  it('is the code catalog_stale', () => {
    expect(AI_DISABLED_REASON_CATALOG_STALE).toBe('catalog_stale');
  });
});

describe('readAiDisabledReason', () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it('returns the env value as-is', () => {
    configureLayers({ env: 'catalog_stale' });
    expect(readAiDisabledReason()).toBe('catalog_stale');
  });

  it('passes through a reason code this feature does not know', () => {
    configureLayers({ env: 'something_else' });
    expect(readAiDisabledReason()).toBe('something_else');
  });

  it('ignores a db value', () => {
    configureLayers({ db: 'catalog_stale', env: undefined });
    expect(readAiDisabledReason()).toBeUndefined();
  });

  it.each([
    ['unset', undefined],
    ['null', null],
    ['empty string', ''],
    ['non-string value', 1],
  ])('returns undefined when %s', (_label, value) => {
    configureLayers({ env: value });
    expect(readAiDisabledReason()).toBeUndefined();
  });
});
