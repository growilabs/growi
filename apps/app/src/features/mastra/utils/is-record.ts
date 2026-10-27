/**
 * True when `value` is a plain record: a non-null object that is NOT an array.
 * The single shape guard shared across the mastra feature's config accessors, the
 * admin PUT validators, and the client-safe providerOptions validator, so
 * "what counts as an object" cannot drift between those sites (arrays are always
 * excluded). Pure and dependency-free — safe to import from both server and client.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
