// Client-safe public entry point for @growi/chat.
//
// This module must never statically reach `node:crypto` (or any other
// server-only dependency) -- the admin screen (Requirements 1.3 / 11 / 12.5)
// imports from here, so anything exported here is pulled into the client
// bundle. RFC 9421 signature generation/verification lives in `./server.ts`
// instead; see `src/public-surface.spec.ts` for the drift test that enforces
// this split.
//
// Contract types, the command-name vocabulary, and the channel-permission
// judgement are added here incrementally by later tasks in
// .kiro/specs/chat-integration-protocol/tasks.md (task 1.2 only establishes
// the two-entry-point split itself).

export {};
