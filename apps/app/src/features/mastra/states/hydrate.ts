import { useHydrateAtoms } from 'jotai/utils';

import type { IUserUISettings } from '~/interfaces/user-ui-settings';

import {
  aiChatSidebarWidthAtom,
  clampChatSidebarWidth,
} from './chat-sidebar-width';

/**
 * Hydrate the chat sidebar atoms from the server-side user UI settings.
 * Call it where the other sidebar atoms are hydrated (basic layout pages).
 */
export const useHydrateChatSidebarAtoms = (
  userUISettings?: IUserUISettings,
): void => {
  useHydrateAtoms([
    [
      aiChatSidebarWidthAtom,
      clampChatSidebarWidth(userUISettings?.aiChatSidebarWidth),
    ],
  ]);
};
