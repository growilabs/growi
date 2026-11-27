// A target made only of these characters, starting with exactly one "/", is
// left unchanged by the WHATWG URL parser unless it has a dot segment or an
// empty query
const PLAIN_TARGET = /^\/(?!\/)[\w\-.~!$&()*+,;=:@/%?[\]]*$/;
const DOT_SEGMENT_IN_PATH = /^[^?]*\/(?:\.|%2e)/i;

const isPlainTarget = (raw: string): boolean =>
  PLAIN_TARGET.test(raw) &&
  !DOT_SEGMENT_IN_PATH.test(raw) &&
  !raw.endsWith('?');

/**
 * The path and query that the HTTP instrumentation records for a request URL
 * when no attribute overrides it (it parses `request.url` with the WHATWG URL
 * parser against the Host header)
 * @returns `pathname + search` of the parsed URL
 * @throws TypeError when the URL cannot be parsed
 */
export const toRecordedTarget = (raw: string): string => {
  // Skips building a URL object for the common case
  if (isPlainTarget(raw)) {
    return raw;
  }
  const { pathname, search } = new URL(raw, 'http://localhost');
  return `${pathname}${search}`;
};
