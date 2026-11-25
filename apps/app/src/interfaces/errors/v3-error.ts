import type { ErrorV3 } from '@growi/core/dist/models';

export type IErrorV3 = ErrorV3;

export const apiV3ErrorCode = {
  VALIDATION_FAILED: 'validation_failed',
} as const;
