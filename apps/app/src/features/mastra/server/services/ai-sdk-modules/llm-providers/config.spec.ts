import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// Mock the config + logger boundaries so we can drive the allow-list and observe
// the out-of-allowlist warning (an observable contract from the design: warn with
// the model id only, no secrets).
const { getConfig, loggerWarn } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getAllowedModels,
  getDefaultModel,
  resolveEffectiveModel,
} from './config';

const setAllowedModels = (models: AllowedModel[] | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'ai:allowedModels' ? models : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAllowedModels', () => {
  it('returns the configured allow-list as-is', () => {
    const models: AllowedModel[] = [
      { model: 'gpt-4o' },
      { model: 'gpt-4o-mini', isDefault: true },
    ];
    setAllowedModels(models);

    expect(getAllowedModels()).toEqual(models);
  });

  it('returns [] when the allow-list is unset (no synthesis / no migration)', () => {
    setAllowedModels(undefined);

    expect(getAllowedModels()).toEqual([]);
  });
});

describe('getDefaultModel', () => {
  it('returns the model marked isDefault', () => {
    setAllowedModels([
      { model: 'gpt-4o' },
      { model: 'gpt-4o-mini', isDefault: true },
    ]);

    expect(getDefaultModel()).toBe('gpt-4o-mini');
  });

  it('falls back to the first entry when no entry is marked isDefault', () => {
    setAllowedModels([{ model: 'gpt-4o' }, { model: 'gpt-4o-mini' }]);

    expect(getDefaultModel()).toBe('gpt-4o');
  });

  it('returns undefined when the allow-list is empty', () => {
    setAllowedModels([]);

    expect(getDefaultModel()).toBeUndefined();
  });
});

describe('resolveEffectiveModel', () => {
  it('returns the requested modelId when it is in the allow-list (4.1)', () => {
    setAllowedModels([
      { model: 'gpt-4o', isDefault: true },
      { model: 'gpt-4o-mini' },
    ]);

    expect(resolveEffectiveModel('gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('falls back to the default model for an out-of-allowlist modelId and warns (4.2)', () => {
    setAllowedModels([
      { model: 'gpt-4o', isDefault: true },
      { model: 'gpt-4o-mini' },
    ]);

    expect(resolveEffectiveModel('not-allowed')).toBe('gpt-4o');
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    // The warning must name the rejected model id (no secrets).
    expect(loggerWarn.mock.calls[0].join(' ')).toContain('not-allowed');
  });

  it('returns the default model when no modelId is given, without warning (4.3)', () => {
    setAllowedModels([
      { model: 'gpt-4o', isDefault: true },
      { model: 'gpt-4o-mini' },
    ]);

    expect(resolveEffectiveModel()).toBe('gpt-4o');
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('throws when the allow-list is empty', () => {
    setAllowedModels([]);

    expect(() => resolveEffectiveModel('gpt-4o')).toThrow();
    expect(() => resolveEffectiveModel()).toThrow();
  });
});
