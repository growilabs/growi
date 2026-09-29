import { body, type ValidationChain } from 'express-validator';

import { MAX_MODEL_KEY_LENGTH } from '~/features/mastra/interfaces/model-key';

// Defensive cap; page paths have no schema-level length limit.
export const MAX_PAGE_PATH_LENGTH = 4096;

// An empty string carries no page reference, so it must count as absent too.
const isAbsent = (value: unknown): boolean => value == null || value === '';

export const buildSummarizeMessageValidator = (): ValidationChain[] => [
  // Kept as its own chain, without `.optional()`: in express-validator v6,
  // `.optional()` anywhere in a chain skips every validator in that chain --
  // including ones declared earlier -- once the field is undefined, which
  // would silently disable this check whenever pageId itself is absent.
  body('pageId').custom((value, { req }) => {
    const { pagePath } = req.body as { pagePath?: unknown };
    if (isAbsent(value) && isAbsent(pagePath)) {
      throw new Error('Either pageId or pagePath is required');
    }
    return true;
  }),

  // `.if(...)` rather than `.optional()`, which only skips undefined: an empty
  // pageId must defer to pagePath exactly as the handler does.
  body('pageId')
    .if((value: unknown) => !isAbsent(value))
    .isString()
    .withMessage('pageId must be a string')
    .isMongoId()
    .withMessage('pageId must be a valid MongoDB ObjectId'),

  body('pagePath')
    .optional()
    .isString()
    .withMessage('pagePath must be a string')
    .isLength({ max: MAX_PAGE_PATH_LENGTH })
    .withMessage(`pagePath must be at most ${MAX_PAGE_PATH_LENGTH} characters`),

  body('modelKey')
    .optional()
    .isString()
    .withMessage('modelKey must be a string')
    .isLength({ max: MAX_MODEL_KEY_LENGTH })
    .withMessage(`modelKey must be at most ${MAX_MODEL_KEY_LENGTH} characters`),
];
