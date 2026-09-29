import type { Request } from 'express';
import { validationResult } from 'express-validator';

import { MAX_MODEL_KEY_LENGTH } from '~/features/mastra/interfaces/model-key';

import {
  buildSummarizeMessageValidator,
  MAX_PAGE_PATH_LENGTH,
} from './summarize-message-validator';

// Assert the validator's OBSERVABLE contract -- which request bodies it accepts and
// rejects -- by driving the real express-validator engine over a fake request and
// inspecting validationResult, NOT by introspecting the chain's internal structure.
// Mirrors post-message.spec.ts / admin-ai-settings/put-ai-settings.spec.ts.

const buildRequest = (body: Record<string, unknown>): Request =>
  ({
    body,
    cookies: {},
    headers: {},
    params: {},
    query: {},
  }) as unknown as Request;

const runValidators = async (
  body: Record<string, unknown>,
): Promise<{ hasErrors: boolean; failedFields: string[] }> => {
  const req = buildRequest(body);
  const validators = buildSummarizeMessageValidator();
  await Promise.all(validators.map((chain) => chain.run(req)));
  const result = validationResult(req);
  return {
    hasErrors: !result.isEmpty(),
    failedFields: result.array().map((e) => e.param),
  };
};

const VALID_PAGE_ID = '507f1f77bcf86cd799439011';
const VALID_PAGE_PATH = '/foo/bar';

describe('buildSummarizeMessageValidator', () => {
  describe('pageId / pagePath (Req 1.3)', () => {
    it('rejects a body with neither pageId nor pagePath', async () => {
      const { hasErrors } = await runValidators({});
      expect(hasErrors).toBe(true);
    });

    it('rejects an empty-string pagePath (carries no page reference)', async () => {
      const { hasErrors } = await runValidators({ pagePath: '' });
      expect(hasErrors).toBe(true);
    });

    it('rejects an empty-string pageId (carries no page reference)', async () => {
      const { hasErrors } = await runValidators({ pageId: '' });
      expect(hasErrors).toBe(true);
    });

    it('rejects a pageId given as an array (bypasses isMongoId per-element)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        pageId: [VALID_PAGE_ID],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('pageId');
    });

    it('accepts pageId only', async () => {
      const { hasErrors } = await runValidators({ pageId: VALID_PAGE_ID });
      expect(hasErrors).toBe(false);
    });

    it('accepts pagePath only', async () => {
      const { hasErrors } = await runValidators({
        pagePath: VALID_PAGE_PATH,
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts an empty-string pageId alongside a valid pagePath', async () => {
      const { hasErrors } = await runValidators({
        pageId: '',
        pagePath: VALID_PAGE_PATH,
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts both pageId and pagePath specified', async () => {
      const { hasErrors } = await runValidators({
        pageId: VALID_PAGE_ID,
        pagePath: VALID_PAGE_PATH,
      });
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-MongoId pageId', async () => {
      const { hasErrors, failedFields } = await runValidators({
        pageId: 'not-a-mongo-id',
        pagePath: VALID_PAGE_PATH,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('pageId');
    });

    it('rejects a non-string pagePath', async () => {
      const { hasErrors, failedFields } = await runValidators({
        pageId: VALID_PAGE_ID,
        pagePath: 123,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('pagePath');
    });

    it('rejects an over-length pagePath', async () => {
      const { hasErrors, failedFields } = await runValidators({
        pagePath: '/'.repeat(MAX_PAGE_PATH_LENGTH + 1),
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('pagePath');
    });

    it('accepts a pagePath at the maximum length', async () => {
      const { hasErrors } = await runValidators({
        pagePath: `/${'a'.repeat(MAX_PAGE_PATH_LENGTH - 1)}`,
      });
      expect(hasErrors).toBe(false);
    });
  });

  describe('modelKey (mirrors post-message-validator.ts)', () => {
    it('accepts a string modelKey', async () => {
      const { hasErrors } = await runValidators({
        pageId: VALID_PAGE_ID,
        modelKey: 'openai/gpt-4o',
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts an omitted modelKey (optional)', async () => {
      const { hasErrors } = await runValidators({ pageId: VALID_PAGE_ID });
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-string modelKey', async () => {
      const { hasErrors, failedFields } = await runValidators({
        pageId: VALID_PAGE_ID,
        modelKey: 123,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('modelKey');
    });

    it('accepts a modelKey at the maximum length', async () => {
      const { hasErrors } = await runValidators({
        pageId: VALID_PAGE_ID,
        modelKey: 'a'.repeat(MAX_MODEL_KEY_LENGTH),
      });
      expect(hasErrors).toBe(false);
    });

    it('rejects an over-length modelKey (defensive cap, same as post-message-validator.ts)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        pageId: VALID_PAGE_ID,
        modelKey: 'a'.repeat(MAX_MODEL_KEY_LENGTH + 1),
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('modelKey');
    });
  });
});
