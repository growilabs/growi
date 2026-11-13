// An explicit object, never derived from process.env: the service token,
// NODE_OPTIONS and anything else the HTTP process holds must not reach the
// child (Req 3.8). PATH is not needed: prlimit and node start by absolute path.
// MALLOC_ARENA_MAX: research.md 19.1.
const CHILD_ENV: Readonly<Record<string, string>> = Object.freeze({
  RAYON_NUM_THREADS: '1',
  MALLOC_ARENA_MAX: '2',
});

export const buildChildEnv = (): Readonly<Record<string, string>> => CHILD_ENV;
