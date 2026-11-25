export const rateLimitErrorCode = {
  TOO_MANY_REQUESTS: 'too-many-requests',
} as const;

export type RateLimitErrorCode =
  (typeof rateLimitErrorCode)[keyof typeof rateLimitErrorCode];
