import type { EnvVarType } from '@growi/core/dist/interfaces';

export type ParseEnvValueResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

// Plain decimal notation only: rejects hex (0x1F), exponents (1e3), signs,
// surrounding whitespace and trailing garbage (12abc) that Number()/parseInt accept.
const NUMBER_PATTERN = /^\d+(\.\d+)?$/;
const TRUE_PATTERN = /^(true|1)$/i;
const FALSE_PATTERN = /^(false|0)$/i;

const parseNumber = (value: string): ParseEnvValueResult =>
  NUMBER_PATTERN.test(value)
    ? { ok: true, value: Number(value) }
    : { ok: false, reason: 'expected a decimal number such as 4 or 0.5' };

const parseBoolean = (value: string): ParseEnvValueResult => {
  if (TRUE_PATTERN.test(value)) return { ok: true, value: true };
  if (FALSE_PATTERN.test(value)) return { ok: true, value: false };
  return { ok: false, reason: 'expected one of true, false, 1, 0' };
};

const parseObject = (value: string): ParseEnvValueResult => {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, reason: 'expected valid JSON' };
  }
};

export const parseEnvValue = (
  value: string,
  type: EnvVarType,
): ParseEnvValueResult => {
  switch (type) {
    case 'number':
      return parseNumber(value);
    case 'boolean':
      return parseBoolean(value);
    case 'object':
      return parseObject(value);
    case 'string':
      return { ok: true, value };
  }
};
