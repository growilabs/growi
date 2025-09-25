import { memo } from 'react';

import dynamic from 'next/dynamic';

import { SidebarContentsType } from '~/interfaces/ui';
import { useIsAiEnabled, useIsGuestUser } from '~/stores-universal/context';
import { useSidebarMode } from '~/stores/ui';

import { PrimaryItem } from './PrimaryItem';

import styles from './PrimaryItems.module.scss';

// Do not SSR Socket.io to make it work
const PrimaryItemForNotification = dynamic(
  () => import('../InAppNotification/PrimaryItemForNotification').then(mod => mod.PrimaryItemForNotification), { ssr: false },
);

type Props = {
  onItemHover?: (contents: SidebarContentsType) => void,
}

export const PrimaryItems = memo((props: Props) => {
  const { onItemHover } = props;

  const { data: sidebarMode } = useSidebarMode();
  const { data: isAiEnabled } = useIsAiEnabled();
  const { data: isGuestUser } = useIsGuestUser();

  if (sidebarMode == null) {
    return <></>;
  }

  return (
    <div className={styles['grw-primary-items']}>
      <PrimaryItem sidebarMode={sidebarMode} contents={SidebarContentsType.TREE} label="Page Tree" iconName="list" onHover={onItemHover} />
      <PrimaryItem sidebarMode={sidebarMode} contents={SidebarContentsType.CUSTOM} label="Custom Sidebar" iconName="code" onHover={onItemHover} />
      <PrimaryItem sidebarMode={sidebarMode} contents={SidebarContentsType.RECENT} label="Recent Changes" iconName="update" onHover={onItemHover} />
      <PrimaryItem sidebarMode={sidebarMode} contents={SidebarContentsType.BOOKMARKS} label="Bookmarks" iconName="bookmarks" onHover={onItemHover} />
      <PrimaryItem sidebarMode={sidebarMode} contents={SidebarContentsType.TAG} label="Tags" iconName="local_offer" onHover={onItemHover} />
      {isGuestUser === false && <PrimaryItemForNotification sidebarMode={sidebarMode} onHover={onItemHover} />}
      {isAiEnabled && (
        <PrimaryItem
          sidebarMode={sidebarMode}
          contents={SidebarContentsType.AI_ASSISTANT}
          label="AI Assistant"
          iconName="growi_ai"
          isCustomIcon
          onHover={onItemHover}
        />
      )}
    </div>
  );
});
