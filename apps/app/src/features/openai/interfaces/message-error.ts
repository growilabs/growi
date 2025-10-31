export const MessageErrorCode = {
  THREAD_ID_IS_NOT_SET: 'thread-id-is-not-set',
} as const;

export const StreamErrorCode = {
  BUDGET_EXCEEDED: 'budget-exceeded',
} as const;

export type StreamErrorCode =
  (typeof StreamErrorCode)[keyof typeof StreamErrorCode];
