export const InlineMimeModes = {
  STRICT: 'strict',
  LAX: 'lax',
} as const;

export type InlineMimeMode = typeof InlineMimeModes[keyof typeof InlineMimeModes];
