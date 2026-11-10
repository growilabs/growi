// What the RFC 9421 signature covers.
//
// **The destination URL and the path are deliberately absent** (requirement
// 10.1). Only a value that both sides hold *as data* can be signed: anything
// read back out of the HTTP layer may be rewritten in transit -- a reverse
// proxy that terminates TLS changes `@target-uri` / `@authority`, and a
// path-rewriting `proxy_pass` changes `@path` -- so covering them would make
// every request from a legitimate peer fail verification because of the
// routing topology rather than because anything was tampered with.
//
// Which endpoint was addressed travels instead in the request body's `op`
// field. The body is covered indirectly, because its hash is the value of the
// `content-digest` header field, which *is* a covered component.

/** What the signature covers. THE single declaration site (requirement 10.1). Does NOT vary by whether a body is present. */
export const COVERED_COMPONENTS = [
  '@method',
  'content-type',
  'content-digest',
] as const;

export type CoveredComponent = (typeof COVERED_COMPONENTS)[number];
