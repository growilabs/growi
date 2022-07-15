import React, { FC } from 'react';

import { SidebarContentsType } from '~/interfaces/ui';
import { useCurrentSidebarContents } from '~/stores/ui';

import Bookmarks from './Bookmarks';
import CustomSidebar from './CustomSidebar';
import PageTree from './PageTree';
import RecentChanges from './RecentChanges';
import Tag from './Tag';

type Props = {
};

const SidebarContents: FC<Props> = (props: Props) => {
  const { data: currentSidebarContents } = useCurrentSidebarContents();

  let Contents;
  switch (currentSidebarContents) {
    case SidebarContentsType.RECENT:
      Contents = RecentChanges;
      break;
    case SidebarContentsType.CUSTOM:
      Contents = CustomSidebar;
      break;
    case SidebarContentsType.TAG:
      Contents = Tag;
      break;
    case SidebarContentsType.BOOKMARKS:
      Contents = Bookmarks;
      break;
    default:
      Contents = PageTree;
  }

  return (
    <Contents />
  );

};

export default SidebarContents;
