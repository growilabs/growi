import { atom, useAtom } from 'jotai';

import { scheduleToPut } from '~/client/services/user-ui-settings';

export const CHAT_SIDEBAR_WIDTH_DEFAULT = 500;
export const CHAT_SIDEBAR_WIDTH_MIN = 360;
export const CHAT_SIDEBAR_WIDTH_MAX = 960;
// Page width that must stay visible beside the open sidebar
const CHAT_SIDEBAR_VIEWPORT_RESERVE = 320;

const clampToFixedRange = (width: number): number =>
  Math.min(CHAT_SIDEBAR_WIDTH_MAX, Math.max(CHAT_SIDEBAR_WIDTH_MIN, width));

export const getChatSidebarMaxWidth = (viewportWidth: number): number =>
  clampToFixedRange(viewportWidth - CHAT_SIDEBAR_VIEWPORT_RESERVE);

/**
 * Viewport-independent clamp for a persisted width: hydration also runs during
 * SSR, where the viewport is unknown. The viewport-dependent upper bound is
 * applied at render and drag time via getChatSidebarMaxWidth.
 */
export const clampChatSidebarWidth = (width: number | undefined): number => {
  if (width == null || !Number.isFinite(width)) {
    return CHAT_SIDEBAR_WIDTH_DEFAULT;
  }
  return clampToFixedRange(width);
};

// Base atom, exported for SSR hydration
export const aiChatSidebarWidthAtom = atom<number>(CHAT_SIDEBAR_WIDTH_DEFAULT);

const aiChatSidebarWidthAtomExt = atom(
  (get) => get(aiChatSidebarWidthAtom),
  (_get, set, update: number) => {
    // The API accepts integer widths only
    const width = Math.round(update);
    set(aiChatSidebarWidthAtom, width);
    scheduleToPut({ aiChatSidebarWidth: width });
  },
);

export const useChatSidebarWidth = (): [number, (width: number) => void] =>
  useAtom(aiChatSidebarWidthAtomExt);
