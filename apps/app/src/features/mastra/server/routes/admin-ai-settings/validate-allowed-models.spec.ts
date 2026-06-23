import type { AllowedModel } from '../../../interfaces/allowed-model';
import {
  isValidAllowedModelsRequest,
  isValidNonEmptyAllowedModels,
} from './validate-allowed-models';

// These pure predicates are the single source of truth for the PUT allowedModels
// validation (Req 1.3/1.4/1.5/2.3/2.4). We assert their accept/reject contract
// directly so the array invariants (no dup ids, exactly one isDefault) are covered
// without driving the express-validator middleware.

describe('isValidNonEmptyAllowedModels (Req 1.3, 1.4, 1.5, 2.3, 2.4)', () => {
  it('accepts a single-entry list with exactly one default (Req 1.3)', () => {
    expect(
      isValidNonEmptyAllowedModels([{ modelId: 'gpt-4o', isDefault: true }]),
    ).toBe(true);
  });

  it('accepts a multi-entry list with exactly one default and valid options', () => {
    const models: AllowedModel[] = [
      {
        modelId: 'gpt-4o',
        isDefault: true,
        providerOptions: { openai: { temperature: 0.2 } },
      },
      { modelId: 'gpt-4o-mini' },
    ];
    expect(isValidNonEmptyAllowedModels(models)).toBe(true);
  });

  it('accepts an entry without providerOptions ("no options", Req 2.3)', () => {
    expect(
      isValidNonEmptyAllowedModels([{ modelId: 'gpt-4o', isDefault: true }]),
    ).toBe(true);
  });

  describe('duplicate / empty model ids (Req 1.4)', () => {
    it('rejects duplicate model ids', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { modelId: 'gpt-4o', isDefault: true },
          { modelId: 'gpt-4o' },
        ]),
      ).toBe(false);
    });

    it('rejects an empty-string model id', () => {
      expect(
        isValidNonEmptyAllowedModels([{ modelId: '', isDefault: true }]),
      ).toBe(false);
    });

    it('rejects a whitespace-only model id', () => {
      expect(
        isValidNonEmptyAllowedModels([{ modelId: '   ', isDefault: true }]),
      ).toBe(false);
    });
  });

  describe('default-count uniqueness (Req 1.5)', () => {
    it('rejects a list with zero defaults', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { modelId: 'gpt-4o' },
          { modelId: 'gpt-4o-mini' },
        ]),
      ).toBe(false);
    });

    it('rejects a list with two defaults', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { modelId: 'gpt-4o', isDefault: true },
          { modelId: 'gpt-4o-mini', isDefault: true },
        ]),
      ).toBe(false);
    });
  });

  describe('providerOptions shape (Req 2.4)', () => {
    it('rejects a non-namespaced providerOptions object', () => {
      expect(
        isValidNonEmptyAllowedModels([
          {
            modelId: 'gpt-4o',
            isDefault: true,
            // not provider-namespaced: a bare option object
            providerOptions: { temperature: 0.2 } as never,
          },
        ]),
      ).toBe(false);
    });

    it('accepts an empty providerOptions object ({} is valid, Req 2.3/2.4)', () => {
      expect(
        isValidNonEmptyAllowedModels([
          { modelId: 'gpt-4o', isDefault: true, providerOptions: {} },
        ]),
      ).toBe(true);
    });
  });
});

describe('isValidAllowedModelsRequest', () => {
  it('accepts an empty array (the clear path — NOT a validation error, Req 1.1)', () => {
    expect(isValidAllowedModelsRequest([])).toBe(true);
  });

  it('rejects a non-array value', () => {
    expect(isValidAllowedModelsRequest({})).toBe(false);
    expect(isValidAllowedModelsRequest('gpt-4o')).toBe(false);
    expect(isValidAllowedModelsRequest(null)).toBe(false);
  });

  it('delegates a non-empty array to the per-entry rules', () => {
    expect(
      isValidAllowedModelsRequest([{ modelId: 'gpt-4o', isDefault: true }]),
    ).toBe(true);
    // Non-empty but zero defaults -> rejected (the uniqueness rule applies).
    expect(isValidAllowedModelsRequest([{ modelId: 'gpt-4o' }])).toBe(false);
  });
});
