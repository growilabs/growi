import React, { memo, useMemo } from 'react';

import { useAtomValue } from 'jotai';

import { AiAssistant } from '~/features/openai/client/components/AiAssistant/Sidebar/AiAssistant';
import { SidebarContentsType } from '~/interfaces/ui';
import { useIsGuestUser } from '~/states/context';
import { aiEnabledAtom } from '~/states/server-configurations';
import { useSidebarMode, useCollapsedContentsOpened, useCurrentSidebarContents } from '~/states/ui/sidebar';

import { Bookmarks } from './Bookmarks';
import { CustomSidebar } from './Custom';
import { InAppNotification } from './InAppNotification';
import { PageTree } from './PageTree';
import { RecentChanges } from './RecentChanges';
import Tag from './Tag';

import styles from './SidebarContents.module.scss';


export const SidebarContents = memo(() => {
  const { isCollapsedMode } = useSidebarMode();
  const isGuestUser = useIsGuestUser();
  const isAiEnabled = useAtomValue(aiEnabledAtom);

  const [isCollapsedContentsOpened] = useCollapsedContentsOpened();
  const [currentSidebarContents] = useCurrentSidebarContents();

  const Contents = useMemo(() => {
    switch (currentSidebarContents) {
      case SidebarContentsType.RECENT:
        return RecentChanges;
      case SidebarContentsType.CUSTOM:
        return CustomSidebar;
      case SidebarContentsType.TAG:
        return Tag;
      case SidebarContentsType.BOOKMARKS:
        return Bookmarks;
      case SidebarContentsType.NOTIFICATION:
        if (isGuestUser == null) return () => <></>; // wait for isGuestUser to be determined
        if (!isGuestUser) {
          return InAppNotification;
        }
        return PageTree;
      case SidebarContentsType.AI_ASSISTANT:
        if (isAiEnabled == null) return () => <></>; // wait for isAiEnabled to be determined
        if (isAiEnabled) {
          return AiAssistant;
        }
        return PageTree;
      default:
        return PageTree;
    }
  }, [currentSidebarContents, isAiEnabled, isGuestUser]);

  const isHidden = isCollapsedMode() && !isCollapsedContentsOpened;
  const classToHide = isHidden ? 'd-none' : '';

  return (
    <div className={`grw-sidebar-contents ${styles['grw-sidebar-contents']} ${classToHide}`} data-testid="grw-sidebar-contents">
      <Contents />
    </div>
  );
});
SidebarContents.displayName = 'SidebarContents';
