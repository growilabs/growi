// Endpoints named in the OpenAPI document or answered by the service. The
// list grows here only, so the token check and the response counters agree.
const ENDPOINTS = [
  '/extract',
  '/healthz',
  '/readyz',
  '/openapi.json',
  '/metrics',
] as const;

export type Endpoint = (typeof ENDPOINTS)[number] | 'other';

// The only endpoints answered without a token; every other path, an unknown
// one included, needs it.
const OPEN_ENDPOINTS: ReadonlySet<Endpoint> = new Set<Endpoint>([
  '/healthz',
  '/readyz',
  '/openapi.json',
  '/metrics',
]);

// Matched on the request target as sent, not on the path routing sees: the
// URL parser resolves "/./healthz" or "/%68ealthz" to an open path, which must
// still need the token. A target that matches exactly holds no "." segment or
// escape, so it routes to that very path.
export const endpointOf = (target = ''): Endpoint => {
  const query = target.indexOf('?');
  const path = query === -1 ? target : target.slice(0, query);
  return ENDPOINTS.find((endpoint) => endpoint === path) ?? 'other';
};

export const isOpenEndpoint = (target?: string): boolean =>
  OPEN_ENDPOINTS.has(endpointOf(target));
