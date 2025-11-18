import type { z } from 'zod';

export const handleIfSuccessfullyParsed = <T>(
  data: T,
  zSchema: z.ZodSchema<T>,
  callback: (data: T) => void,
): void => {
  const parsed = zSchema.safeParse(data);
  if (parsed.success) {
    callback(data);
  }
};
