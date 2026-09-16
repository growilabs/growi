// Shared by AnonymousSyncCounter and EsSyncDecision so their TTLs cannot drift apart —
// a decision must not outlive (or expire much before) the counter it was decided against.
export const WINDOW_TTL_SECONDS = 120;
