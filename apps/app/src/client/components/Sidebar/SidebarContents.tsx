import React, { memo, useMemo } from 'react';

import { KnowledgeAssistant } from '~/features/openai/client/components/KnowledgeAssistant/Sidebar/KnowledgeAssistant';
import { SidebarContentsType } from '~/interfaces/ui';
import { useCollapsedContentsOpened, useCurrentSidebarContents, useSidebarMode } from '~/stores/ui';


import { Bookmarks } from './Bookmarks';
import { CustomSidebar } from './Custom';
import { InAppNotification } from './InAppNotification';
import { PageTree } from './PageTree';
import { RecentChanges } from './RecentChanges';
import Tag from './Tag';

import styles from './SidebarContents.module.scss';


export const SidebarContents = memo(() => {
  const { isCollapsedMode } = useSidebarMode();
  const { data: isCollapsedContentsOpened } = useCollapsedContentsOpened();

  const { data: currentSidebarContents } = useCurrentSidebarContents();

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
        return InAppNotification;
      case SidebarContentsType.KNOWNLEDGE_ASSISTANT:
        return KnowledgeAssistant;
      default:
        return PageTree;
    }
  }, [currentSidebarContents]);

  const isHidden = isCollapsedMode() && !isCollapsedContentsOpened;
  const classToHide = isHidden ? 'd-none' : '';

  return (
    <div className={`grw-sidebar-contents ${styles['grw-sidebar-contents']} ${classToHide}`} data-testid="grw-sidebar-contents">
      <Contents />
    </div>
  );
});
SidebarContents.displayName = 'SidebarContents';
