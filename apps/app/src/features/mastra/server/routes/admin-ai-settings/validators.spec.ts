import type { Request } from 'express';
import { validationResult } from 'express-validator';

import { isParsableJsonString, updateAiSettingsValidators } from './validators';

// Build a minimal Express-like request the express-validator engine accepts.
// Only the locations the chain reads (`body`) need real data; the rest are
// present so `validationResult` can traverse them without throwing.
const buildRequest = (body: Record<string, unknown>): Request => {
  return {
    body,
    cookies: {},
    headers: {},
    params: {},
    query: {},
  } as unknown as Request;
};

// Run the full validator chain against a request body and report whether the
// engine accumulated any errors. This asserts the observable contract (accept /
// reject) rather than the chain's internal shape.
const runValidators = async (
  body: Record<string, unknown>,
): Promise<{ hasErrors: boolean; failedFields: string[] }> => {
  const req = buildRequest(body);
  await Promise.all(updateAiSettingsValidators.map((chain) => chain.run(req)));
  const result = validationResult(req);
  return {
    hasErrors: !result.isEmpty(),
    failedFields: result.array().map((e) => e.param),
  };
};

describe('isParsableJsonString', () => {
  it('returns true for a parsable JSON object string', () => {
    expect(isParsableJsonString('{"temperature":0.5}')).toBe(true);
  });

  it('returns true for a parsable JSON array string', () => {
    expect(isParsableJsonString('[1,2,3]')).toBe(true);
  });

  it('returns false for a non-JSON string', () => {
    expect(isParsableJsonString('{not valid json')).toBe(false);
  });

  it('returns false for an empty string (nothing to parse)', () => {
    expect(isParsableJsonString('')).toBe(false);
  });
});

describe('updateAiSettingsValidators', () => {
  describe('provider', () => {
    it.each([
      'openai',
      'anthropic',
      'google',
      'azure-openai',
    ])('accepts the supported provider "%s"', async (provider) => {
      const { hasErrors } = await runValidators({ provider });
      expect(hasErrors).toBe(false);
    });

    it('rejects an unsupported provider value', async () => {
      const { hasErrors, failedFields } = await runValidators({
        provider: 'bedrock',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('provider');
    });

    it('accepts a request that omits provider (optional / partial update)', async () => {
      const { hasErrors } = await runValidators({});
      expect(hasErrors).toBe(false);
    });
  });

  describe('providerOptions', () => {
    it('accepts a parsable JSON string', async () => {
      const { hasErrors } = await runValidators({
        providerOptions: '{"temperature":0.7}',
      });
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-empty value that is not parsable JSON', async () => {
      const { hasErrors, failedFields } = await runValidators({
        providerOptions: 'not-json',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providerOptions');
    });

    it('accepts an empty string (cleared option, normalized server-side)', async () => {
      const { hasErrors } = await runValidators({ providerOptions: '' });
      expect(hasErrors).toBe(false);
    });

    it('accepts a request that omits providerOptions', async () => {
      const { hasErrors } = await runValidators({});
      expect(hasErrors).toBe(false);
    });
  });

  describe('boolean fields', () => {
    it.each([
      'aiEnabled',
      'azureOpenaiUseEntraId',
    ])('accepts a boolean value for "%s"', async (field) => {
      const accepted = await runValidators({ [field]: true });
      expect(accepted.hasErrors).toBe(false);

      const acceptedFalse = await runValidators({ [field]: false });
      expect(acceptedFalse.hasErrors).toBe(false);
    });

    it.each([
      'aiEnabled',
      'azureOpenaiUseEntraId',
    ])('rejects a non-boolean value for "%s"', async (field) => {
      const { hasErrors, failedFields } = await runValidators({
        [field]: 'yes',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain(field);
    });
  });

  it('accepts a fully populated valid request', async () => {
    const { hasErrors } = await runValidators({
      aiEnabled: true,
      provider: 'azure-openai',
      apiKey: 'secret-key',
      model: 'gpt-4o',
      providerOptions: '{"temperature":0.2}',
      azureOpenaiResourceName: 'my-resource',
      azureOpenaiBaseUrl: 'https://example.openai.azure.com',
      azureOpenaiApiVersion: '2024-02-01',
      azureOpenaiUseEntraId: false,
    });
    expect(hasErrors).toBe(false);
  });
});
