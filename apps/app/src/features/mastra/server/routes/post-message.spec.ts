import type { Request } from 'express';
import { validationResult } from 'express-validator';

import { buildPostMessageValidator } from './post-message-validator';

// Assert the validator's OBSERVABLE contract — which request bodies it accepts and
// rejects — by driving the real express-validator engine over a fake request and
// inspecting validationResult, NOT by introspecting the chain's internal structure
// (which methods it called). Mirrors admin-ai-settings/put-ai-settings.spec.

// Build a minimal Express-like request the express-validator engine accepts. Only
// `body` carries real data; the other locations are present so the engine can
// traverse them without throwing.
const buildRequest = (body: Record<string, unknown>): Request =>
  ({
    body,
    cookies: {},
    headers: {},
    params: {},
    query: {},
  }) as unknown as Request;

// validateUIMessages is injected into the validator; default to a resolving stub
// (any messages accepted), and pass a rejecting stub to simulate a malformed
// messages payload. Returns whether the engine accumulated errors and which fields
// failed.
const runValidators = async (
  body: Record<string, unknown>,
  validateUIMessages: (input: { messages: unknown }) => Promise<unknown> = vi
    .fn()
    .mockResolvedValue(undefined),
): Promise<{ hasErrors: boolean; failedFields: string[] }> => {
  const req = buildRequest(body);
  const validators = buildPostMessageValidator(validateUIMessages);
  await Promise.all(validators.map((chain) => chain.run(req)));
  const result = validationResult(req);
  return {
    hasErrors: !result.isEmpty(),
    failedFields: result.array().map((e) => e.param),
  };
};

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_MESSAGES = [{ id: '1', role: 'user', parts: [] }];

describe('buildPostMessageValidator', () => {
  describe('threadId', () => {
    it('accepts a valid UUID', async () => {
      const { hasErrors } = await runValidators({
        threadId: VALID_UUID,
        messages: VALID_MESSAGES,
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts an omitted threadId (optional)', async () => {
      const { hasErrors } = await runValidators({ messages: VALID_MESSAGES });
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-UUID threadId', async () => {
      const { hasErrors, failedFields } = await runValidators({
        threadId: 'not-a-uuid',
        messages: VALID_MESSAGES,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('threadId');
    });
  });

  describe('modelId (Req 3.3, 4.x)', () => {
    it('accepts a string modelId', async () => {
      const { hasErrors } = await runValidators({
        modelId: 'gpt-4o',
        messages: VALID_MESSAGES,
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts an omitted modelId (optional — the server rounds to the default)', async () => {
      const { hasErrors } = await runValidators({ messages: VALID_MESSAGES });
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-string modelId', async () => {
      const { hasErrors, failedFields } = await runValidators({
        modelId: 123,
        messages: VALID_MESSAGES,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('modelId');
    });
  });

  describe('messages', () => {
    it('delegates messages validation to the injected validateUIMessages', async () => {
      const validateUIMessages = vi.fn().mockResolvedValue(undefined);
      await runValidators({ messages: VALID_MESSAGES }, validateUIMessages);

      expect(validateUIMessages).toHaveBeenCalledWith({
        messages: VALID_MESSAGES,
      });
    });

    it('rejects when validateUIMessages reports the messages are invalid', async () => {
      const validateUIMessages = vi
        .fn()
        .mockRejectedValue(new Error('invalid messages'));
      const { hasErrors, failedFields } = await runValidators(
        { messages: 'not-a-message-array' },
        validateUIMessages,
      );

      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('messages');
    });
  });

  describe('assistant-independent contract', () => {
    it('ignores a legacy aiAssistantId in the body (neither required nor validated)', async () => {
      // No field is declared for aiAssistantId, so its presence must not fail the
      // request and it is never required — the endpoint is assistant-independent.
      const { hasErrors } = await runValidators({
        messages: VALID_MESSAGES,
        aiAssistantId: 'legacy-assistant-id',
      });
      expect(hasErrors).toBe(false);
    });
  });
});
