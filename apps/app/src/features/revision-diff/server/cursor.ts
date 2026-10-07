export interface CursorKey {
  readonly createdAt: Date;
  readonly id: string;
}

export const encodeCursor = (key: CursorKey): string => {
  const payload = JSON.stringify({
    createdAt: key.createdAt.toISOString(),
    id: key.id,
  });
  return Buffer.from(payload).toString('base64');
};

export const decodeCursor = (token: string): CursorKey => {
  let payload: unknown;
  try {
    const json = Buffer.from(token, 'base64').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    throw new Error('Invalid cursor token');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).createdAt !== 'string' ||
    typeof (payload as Record<string, unknown>).id !== 'string'
  ) {
    throw new Error('Invalid cursor token structure');
  }

  const p = payload as { createdAt: string; id: string };
  const createdAt = new Date(p.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('Invalid cursor token: invalid date');
  }

  return { createdAt, id: p.id };
};
