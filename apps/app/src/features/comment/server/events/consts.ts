export const CommentEvent = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type CommentEvent = (typeof CommentEvent)[keyof typeof CommentEvent];
