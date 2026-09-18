// Public barrel for `url-guard/` -- the pure judgement over a declared URL
// (design.md "UriGuard"). Client-safe: re-exported from the top-level
// `src/index.ts`.

export type { UriVerdict } from './growi-uri-guard.js';
export { judgeGrowiUri } from './growi-uri-guard.js';
