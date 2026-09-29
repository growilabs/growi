// A document can go WINDOW_TTL_SECONDS - ANCHOR_REFRESH_INTERVAL_SECONDS (120s)
// untouched before expiring; that must exceed the longest gap between two attempts at
// the same batch (30s max restart backoff + one ES bulk + one batch of decisions).
export const WINDOW_TTL_SECONDS = 150;

// Throttles anchor refreshes on read paths: a few writes per minute per document
// instead of one per event per GROWI process.
export const ANCHOR_REFRESH_INTERVAL_SECONDS = 30;
