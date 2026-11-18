import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';

import { SidebarContentsType } from '~/interfaces/ui';
import type { IUserUISettings } from '~/interfaces/user-ui-settings';

import {
  aiChatSidebarWidthAtom,
  CHAT_SIDEBAR_WIDTH_DEFAULT,
  CHAT_SIDEBAR_WIDTH_MIN,
} from './chat-sidebar-width';
import { useHydrateChatSidebarAtoms } from './hydrate';

const renderHydrated = (userUISettings?: IUserUISettings) => {
  return renderHook(
    () => {
      useHydrateChatSidebarAtoms(userUISettings);
      return useAtomValue(aiChatSidebarWidthAtom);
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider>{children}</Provider>
      ),
    },
  );
};

const settingsWith = (aiChatSidebarWidth?: number): IUserUISettings => ({
  currentSidebarContents: SidebarContentsType.TREE,
  currentProductNavWidth: 320,
  preferCollapsedModeByUser: false,
  aiChatSidebarWidth,
});

describe('useHydrateChatSidebarAtoms', () => {
  it('uses the saved width', () => {
    const { result } = renderHydrated(settingsWith(640));
    expect(result.current).toBe(640);
  });

  it('uses the default width when there are no settings', () => {
    const { result } = renderHydrated(undefined);
    expect(result.current).toBe(CHAT_SIDEBAR_WIDTH_DEFAULT);
  });

  it('uses the default width when the settings carry no width', () => {
    const { result } = renderHydrated(settingsWith(undefined));
    expect(result.current).toBe(CHAT_SIDEBAR_WIDTH_DEFAULT);
  });

  it('rounds an out-of-range saved width into the fixed range', () => {
    const { result } = renderHydrated(settingsWith(1));
    expect(result.current).toBe(CHAT_SIDEBAR_WIDTH_MIN);
  });
});
