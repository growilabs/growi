// Excludes the vertical scrollbar, which is where a right-anchored fixed
// element actually ends. Browser-only: call it from event handlers or from
// components that never render on the server.
export const getViewportWidth = (): number =>
  document.documentElement.clientWidth;
