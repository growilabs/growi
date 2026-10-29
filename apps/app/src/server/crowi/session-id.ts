import uidSafe from 'uid-safe';

const SESSION_ID_BYTES = 24;

/**
 * Paths that share one pre-generated session ID each, so that cookie-less
 * requests to them (probes, polling clients) keep a single session record
 * instead of writing a new one per request. Compared against `req.path`
 * exactly.
 */
export const FIXED_SESSION_ID_PATHS: readonly string[] = [
  '/_api/v3/healthcheck',
  '/_api/v3/ai-usage',
];

export type SessionIdGenerator = (req: { path: string }) => string;

export const createSessionIdGenerator = (
  fixedIdPaths: readonly string[],
): SessionIdGenerator => {
  const fixedIds = new Map(
    fixedIdPaths.map((path) => [path, uidSafe.sync(SESSION_ID_BYTES)]),
  );
  return (req) => fixedIds.get(req.path) ?? uidSafe.sync(SESSION_ID_BYTES);
};
