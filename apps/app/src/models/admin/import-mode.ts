export const ImportMode = {
  insert: 'insert',
  upsert: 'upsert',
  flushAndInsert: 'flushAndInsert',
} as const;
export type ImportMode = (typeof ImportMode)[keyof typeof ImportMode];
