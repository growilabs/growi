import type { IncomingHttpHeaders } from 'node:http';

export const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const ABSENT = '-';
const INVALID = '(invalid)';

// The value after "app=" on the request line. Why a bad value is never echoed
// and why a repeated header reads as invalid: research.md §9.2.1, §9.2.3.
export const appLabelOf = (headers: IncomingHttpHeaders): string => {
  const value: unknown = headers['x-growi-app-id'];
  if (value === undefined) return ABSENT;
  return typeof value === 'string' && APP_ID_PATTERN.test(value)
    ? value
    : INVALID;
};
