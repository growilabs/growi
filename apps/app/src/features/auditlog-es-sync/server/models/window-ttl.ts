// Shared by AnonymousSyncCounter and EsSyncDecision. Both anchors are refreshed on
// every read or write (see decide-es-sync-for-event.ts), so this bounds the idle gap
// between two touches, not the total lifetime: a counter lives while its window keeps
// receiving events, and a decision while its batch keeps being retried. Must exceed
// the longest gap between two attempts at the same batch (max restart backoff of 30s
// + one ES bulk timeout + one batch of per-event decisions).
export const WINDOW_TTL_SECONDS = 120;
