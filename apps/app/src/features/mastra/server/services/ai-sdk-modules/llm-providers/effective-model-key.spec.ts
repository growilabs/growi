import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// effective-model-key resolves against the AVAILABLE set (task 3.2), so the only
// dependency worth driving is getAvailableModels — mocked here so each case sets
// the available set deterministically. model-key (parse/build) and allowed-model
// (isModelInAllowList) are the REAL pure functions: we exercise the actual
// parsing / membership contract rather than re-mocking it. The logger boundary is
// mocked so the per-request audit warn is observable (Req 4.6 — key value only).
const { getAvailableModels, loggerWarn } = vi.hoisted(() => ({
  getAvailableModels: vi.fn<() => AllowedModel[]>(),
  loggerWarn: vi.fn(),
}));

vi.mock('./provider-availability', () => ({
  getAvailableModels,
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getEffectiveDefaultModelKey,
  resolveEffectiveModelKey,
} from './effective-model-key';

beforeEach(() => {
  vi.clearAllMocks();
  getAvailableModels.mockReturnValue([]);
});

describe('getEffectiveDefaultModelKey (Req 6.4)', () => {
  it('returns the isDefault entry key when its provider is available', () => {
    getAvailableModels.mockReturnValue([
      { provider: 'openai', modelId: 'gpt-5' },
      { provider: 'anthropic', modelId: 'claude-sonnet-5', isDefault: true },
    ]);

    expect(getEffectiveDefaultModelKey()).toBe('anthropic/claude-sonnet-5');
  });

  it('ignores a non-boolean isDefault (truthy string) and picks the real boolean default (env-bypass hardening)', () => {
    // An env-provided allow-list bypasses the PUT validator, so a non-boolean
    // isDefault (here the truthy string "false") can reach the runtime pick. It
    // must NOT win over the entry whose isDefault is a real `true`, matching the
    // admin UI's strict `=== true`. The cast injects the type-violating runtime
    // shape the guard exists to defend against.
    getAvailableModels.mockReturnValue([
      { provider: 'openai', modelId: 'gpt-5', isDefault: 'false' },
      { provider: 'anthropic', modelId: 'claude-4', isDefault: true },
    ] as unknown as AllowedModel[]);

    expect(getEffectiveDefaultModelKey()).toBe('anthropic/claude-4');
  });

  it('falls back to the first available entry when the default entry is absent from the available set (deterministic — 6.4)', () => {
    // The saved default belongs to a now-unavailable provider, so provider-
    // availability already filtered it out: none of the available entries carry
    // isDefault. The fallback must be the first available entry, deterministically.
    getAvailableModels.mockReturnValue([
      { provider: 'google', modelId: 'gemini-2' },
      { provider: 'openai', modelId: 'gpt-5' },
    ]);

    expect(getEffectiveDefaultModelKey()).toBe('google/gemini-2');
  });

  it('throws when the available set is empty (no model to default to)', () => {
    getAvailableModels.mockReturnValue([]);

    expect(() => getEffectiveDefaultModelKey()).toThrow();
  });
});

describe('resolveEffectiveModelKey (Req 4.6)', () => {
  const availableSet: AllowedModel[] = [
    { provider: 'openai', modelId: 'gpt-5', isDefault: true },
    { provider: 'anthropic', modelId: 'claude-sonnet-5' },
  ];

  it('returns an in-set key unchanged, with no warn', () => {
    getAvailableModels.mockReturnValue(availableSet);

    expect(resolveEffectiveModelKey('anthropic/claude-sonnet-5')).toBe(
      'anthropic/claude-sonnet-5',
    );
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('rounds an out-of-set key to the effective default and warns exactly once with the rejected key (no secrets/config values)', () => {
    // A providerOptions value on an available entry stands in for a config value
    // that a naive impl might dump into the log. The audit warn must carry the
    // rejected KEY VALUE ONLY.
    getAvailableModels.mockReturnValue([
      {
        provider: 'openai',
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: {
          openai: { reasoningEffort: 'super-secret-config-value' },
        },
      },
    ]);

    // google is a valid provider (parses), but not in the available set.
    expect(resolveEffectiveModelKey('google/gemini-2')).toBe('openai/gpt-5');

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const warned = loggerWarn.mock.calls[0].join(' ');
    expect(warned).toContain('google/gemini-2');
    expect(warned).not.toContain('super-secret-config-value');
  });

  it('rounds an omitted key to the effective default with NO warn', () => {
    getAvailableModels.mockReturnValue(availableSet);

    expect(resolveEffectiveModelKey(undefined)).toBe('openai/gpt-5');
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('computes the available set only ONCE on the default-fallback path (no double sweep)', () => {
    getAvailableModels.mockReturnValue(availableSet);

    // The omitted-key path falls back to the effective default; availability must
    // be computed once and reused, not swept a second time to pick the default.
    resolveEffectiveModelKey(undefined);
    expect(getAvailableModels).toHaveBeenCalledTimes(1);
  });

  it('rounds an unparseable key to the effective default and warns', () => {
    getAvailableModels.mockReturnValue(availableSet);

    // No separator -> parseModelKey returns null -> rounded to default.
    expect(resolveEffectiveModelKey('no-separator')).toBe('openai/gpt-5');
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn.mock.calls[0].join(' ')).toContain('no-separator');
  });

  it('rounds a key whose prefix is not a supported provider to the default', () => {
    getAvailableModels.mockReturnValue(availableSet);

    // Prefix "unknown" is not an AiProvider -> parseModelKey returns null.
    expect(resolveEffectiveModelKey('unknown/some-model')).toBe('openai/gpt-5');
    expect(loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('escapes control characters in the logged rejected key (no log / terminal injection)', () => {
    getAvailableModels.mockReturnValue(availableSet);

    // A client could submit (within the length cap) a key carrying a newline + ANSI
    // escape to forge log lines / inject terminal control sequences. It parses
    // (openai prefix, non-empty modelId) but is not in the available set -> warned.
    // Build the control chars via char codes so no raw control byte lives in source.
    const newline = String.fromCharCode(10);
    const esc = String.fromCharCode(27);
    const malicious = `openai/x${newline}${esc}[31mFORGED-LOG-LINE`;
    expect(resolveEffectiveModelKey(malicious)).toBe('openai/gpt-5');

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const warned = loggerWarn.mock.calls[0].join(' ');
    // The raw newline / ESC never reach the log line...
    expect(warned).not.toContain(newline);
    expect(warned).not.toContain(esc);
    // ...they appear only JSON-escaped (backslash sequences).
    expect(warned).toContain('\\n');
    expect(warned).toContain('\\u001b');
  });

  it('throws when there are 0 available models (the 501 guard normally preempts this)', () => {
    getAvailableModels.mockReturnValue([]);

    expect(() => resolveEffectiveModelKey('openai/gpt-5')).toThrow();
  });
});
