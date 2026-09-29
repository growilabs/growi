// Shared by AnonymousSyncCounter and EsSyncDecision. The anchors differ, though: a
// decision's TTL runs from its own last write, while the counter's is refreshed by
// every event in the window, so a window's early decisions can expire up to one
// window length before its counter does.
export const WINDOW_TTL_SECONDS = 120;
