// Server-only public entry point for @growi/chat.
//
// This module may use `node:crypto` (RFC 9421 signature generation and
// verification) -- callers that import from here (the GROWI server, the
// proxy server) are never bundled for a browser. Client-safe exports
// (contract types, command names, permission judgement) live in
// `./index.ts` instead; see `src/public-surface.spec.ts` for the drift test
// that keeps `./index.ts` from reaching this module's dependencies.
//
// The signature module itself does not exist yet -- it is added by task
// 5.x in .kiro/specs/chat-integration-protocol/tasks.md. This file only
// establishes the entry point.
export {};
