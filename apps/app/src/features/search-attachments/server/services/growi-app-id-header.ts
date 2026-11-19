// Printable ASCII only (0x21-0x7E), so the value can never make Node reject the
// request and fail the extraction (research.md §2.4).
const HEADER_SAFE_VALUE = /^[\x21-\x7e]+$/;

/**
 * Returns the string to send as `X-Growi-App-Id`, or undefined when the
 * header must be left out. The setting is typed `number | undefined` but holds
 * the raw environment variable string at runtime (research.md §2.3).
 */
export const toGrowiAppIdHeaderValue = (value: unknown): string | undefined => {
  if (value == null) {
    return undefined;
  }
  const text = String(value);
  return HEADER_SAFE_VALUE.test(text) ? text : undefined;
};
