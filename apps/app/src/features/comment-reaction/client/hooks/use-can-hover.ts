import { useSyncExternalStore } from 'react';

// The same condition the comment header uses to hide its add-reaction button until hover.
const HOVER_QUERY = '(hover: hover)';

const subscribe = (onChange: () => void): (() => void) => {
  const query = window.matchMedia(HOVER_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const getSnapshot = (): boolean => window.matchMedia(HOVER_QUERY).matches;

const getServerSnapshot = (): boolean => false;

/** Whether the device's primary pointer can hover, e.g. a mouse rather than a touch screen. */
export const useCanHover = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
