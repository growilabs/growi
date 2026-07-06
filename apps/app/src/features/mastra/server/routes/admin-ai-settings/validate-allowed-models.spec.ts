import type { AllowedModel } from '../../../interfaces/allowed-model';
import {
  isValidAllowedModelsRequest,
  isValidNonEmptyAllowedModels,
} from './validate-allowed-models';

// These pure predicates are the single source of truth for the PUT allowedModels
// validation (Req 2.3/2.4/2.5/3.2/3.3). We assert their accept/reject contract
// directly so the array invariants ((provider, modelId) uniqueness, exactly one
// isDefault, provider validity) are covered without driving the express-validator
// middleware.

describe('isValidNonEmptyAllowedModels (Req 2.3, 2.4, 3.2)', () => {
  it('accepts a single-entry list with exactly one default', () => {
    expect(
      isValidNonEmptyAllowedModels([
        { provider: 'openai', modelId: 'gpt-5', isDefault: true },
      ]),
    ).toBe(true);
  });

  it('accepts a multi-entry list with exactly one default and valid options', () => {
    const models: AllowedModel[] = [
      {
        provider: 'openai',
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { temperature: 0.2 } },
      },
      { provider: 'openai', modelId: 'gpt-5-mini' },
    ];
    expect(isValidNonEmptyAllowedModels(models)).toBe(true);
  });

  describe('(provider, modelId) uniqueness (Req 2.3, 2.4)', () => {
    it('accepts the same modelId under DIFFERENT providers (Req 2.3)', () => {
      const models: AllowedModel[] = [
        { provider: 'openai', modelId: 'gpt-5', isDefault: true },
        { provider: 'azure-openai', modelId: 'gpt-5' },
      ];
      expect(isValidNonEmptyAllowedModels(models)).toBe(true);
    });

    it('rejects the same modelId under the SAME provider (Req 2.4)', () => {
      const models: AllowedModel[] = [
        { provider: 'openai', modelId: 'gpt-5', isDefault: true },
        { provider: 'openai', modelId: 'gpt-5' },
      ];
      expect(isValidNonEmptyAllowedModels(models)).toBe(false);
    });
  });

  describe('modelId shape', () => {
    it('rejects an empty-string modelId', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { provider: 'openai', modelId: '', isDefault: true },
        ]),
      ).toBe(false);
    });

    it('rejects a whitespace-only modelId', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { provider: 'openai', modelId: '   ', isDefault: true },
        ]),
      ).toBe(false);
    });
  });

  describe('default-count uniqueness on the non-empty list (Req 3.2)', () => {
    it('rejects a list with zero defaults', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { provider: 'openai', modelId: 'gpt-5' },
          { provider: 'anthropic', modelId: 'claude-4' },
        ]),
      ).toBe(false);
    });

    it('rejects a list with two defaults', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { provider: 'openai', modelId: 'gpt-5', isDefault: true },
          { provider: 'anthropic', modelId: 'claude-4', isDefault: true },
        ]),
      ).toBe(false);
    });
  });

  describe('providerOptions shape (Req 2.8)', () => {
    it('accepts an entry without providerOptions ("no options")', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { provider: 'openai', modelId: 'gpt-5', isDefault: true },
        ]),
      ).toBe(true);
    });

    it('accepts an empty providerOptions object ({} is valid)', () => {
      expect(
        isValidNonEmptyAllowedModels([
          {
            provider: 'openai',
            modelId: 'gpt-5',
            isDefault: true,
            providerOptions: {},
          },
        ]),
      ).toBe(true);
    });
  });
});

describe('isValidAllowedModelsRequest (Req 2.5, 2.8, 3.3)', () => {
  it('accepts an empty array (the clear path — a legitimate "no models" state, Req 3.3)', () => {
    expect(isValidAllowedModelsRequest([])).toBe(true);
  });

  it('rejects a non-array value', () => {
    expect(isValidAllowedModelsRequest({})).toBe(false);
    expect(isValidAllowedModelsRequest('gpt-5')).toBe(false);
    expect(isValidAllowedModelsRequest(null)).toBe(false);
  });

  // The runtime value is client-supplied JSON, so these payloads intentionally
  // violate the AllowedModel type. isValidAllowedModelsRequest takes `unknown`,
  // which is the exact contract the express-validator `.custom()` sees.
  it('rejects an entry whose provider is not a supported provider (Req 2.5)', () => {
    expect(
      isValidAllowedModelsRequest([
        { provider: 'bogus', modelId: 'gpt-5', isDefault: true },
      ]),
    ).toBe(false);
  });

  it('rejects an entry with a non-namespaced providerOptions object (Req 2.8)', () => {
    expect(
      isValidAllowedModelsRequest([
        {
          provider: 'openai',
          modelId: 'gpt-5',
          isDefault: true,
          // not provider-namespaced: a bare option object
          providerOptions: { temperature: 0.2 },
        },
      ]),
    ).toBe(false);
  });

  it('rejects an entry with a non-string modelId', () => {
    expect(
      isValidAllowedModelsRequest([
        { provider: 'openai', modelId: 42, isDefault: true },
      ]),
    ).toBe(false);
  });

  it('rejects an entry carrying an unknown extra property (no verbatim persistence of arbitrary keys)', () => {
    expect(
      isValidAllowedModelsRequest([
        {
          provider: 'openai',
          modelId: 'gpt-5',
          isDefault: true,
          injected: 'attacker-chosen-blob',
        },
      ]),
    ).toBe(false);
  });

  it('rejects a null / non-object entry without throwing', () => {
    expect(isValidAllowedModelsRequest([null])).toBe(false);
    expect(isValidAllowedModelsRequest(['gpt-5'])).toBe(false);
  });

  it('rejects a modelId longer than the defensive length bound', () => {
    expect(
      isValidAllowedModelsRequest([
        { provider: 'openai', modelId: 'a'.repeat(257), isDefault: true },
      ]),
    ).toBe(false);
  });

  it('delegates a valid non-empty array to the per-entry rules', () => {
    expect(
      isValidAllowedModelsRequest([
        { provider: 'openai', modelId: 'gpt-5', isDefault: true },
      ]),
    ).toBe(true);
    // Non-empty but zero defaults -> rejected (the uniqueness rule applies).
    expect(
      isValidAllowedModelsRequest([{ provider: 'openai', modelId: 'gpt-5' }]),
    ).toBe(false);
  });
});
