import { memo } from 'react';
import dynamic from 'next/dynamic';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { NotAvailable } from '~/client/components/NotAvailable';
import { SidebarContentsType } from '~/interfaces/ui';
import { useIsGuestUser } from '~/states/context';
import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';
import { aiEnabledAtom } from '~/states/server-configurations';
import { useSidebarMode } from '~/states/ui/sidebar';

import { PrimaryItem } from './PrimaryItem';

import styles from './PrimaryItems.module.scss';

// Do not SSR Socket.io to make it work
const PrimaryItemForNotification = dynamic(
  () =>
    import('../InAppNotification/PrimaryItemForNotification').then(
      (mod) => mod.PrimaryItemForNotification,
    ),
  { ssr: false },
);

type Props = {
  onItemHover?: (contents: SidebarContentsType) => void;
};

export const PrimaryItems = memo((props: Props) => {
  const { onItemHover } = props;

  const { t } = useTranslation();
  const { sidebarMode } = useSidebarMode();
  const isAiEnabled = useAtomValue(aiEnabledAtom);
  const isGuestUser = useIsGuestUser();
  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();
  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

  if (sidebarMode == null) {
    return <></>;
  }

  const aiAssistantNotAvailableTitle = (
    <>
      <p className="mb-2">
        {t('default_ai_assistant.open_cloud_settings_to_enable')}
      </p>
      <a href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}>
        <span
          className="material-symbols-outlined me-1"
          style={{ fontSize: '1rem', verticalAlign: 'middle' }}
        >
          share
        </span>
        {t('default_ai_assistant.to_cloud_settings')}
      </a>
    </>
  );

  return (
    <div className={`${styles['grw-primary-items']} mt-1`}>
      <PrimaryItem
        sidebarMode={sidebarMode}
        contents={SidebarContentsType.TREE}
        label="Page Tree"
        iconName="list"
        onHover={onItemHover}
      />
      <PrimaryItem
        sidebarMode={sidebarMode}
        contents={SidebarContentsType.CUSTOM}
        label="Custom Sidebar"
        iconName="code"
        onHover={onItemHover}
      />
      <PrimaryItem
        sidebarMode={sidebarMode}
        contents={SidebarContentsType.RECENT}
        label="Recent Changes"
        iconName="update"
        onHover={onItemHover}
      />
      <PrimaryItem
        sidebarMode={sidebarMode}
        contents={SidebarContentsType.BOOKMARKS}
        label="Bookmarks"
        iconName="bookmarks"
        onHover={onItemHover}
      />
      <PrimaryItem
        sidebarMode={sidebarMode}
        contents={SidebarContentsType.TAG}
        label="Tags"
        iconName="local_offer"
        onHover={onItemHover}
      />
      {isGuestUser === false && (
        <PrimaryItemForNotification
          sidebarMode={sidebarMode}
          onHover={onItemHover}
        />
      )}
      {isAiEnabled ? (
        <PrimaryItem
          sidebarMode={sidebarMode}
          contents={SidebarContentsType.AI_ASSISTANT}
          label="AI Assistant"
          iconName="growi_ai"
          isCustomIcon
          onHover={onItemHover}
        />
      ) : (
        isCloud && (
          <NotAvailable
            isDisabled
            title={aiAssistantNotAvailableTitle}
            placement="right"
          >
            <PrimaryItem
              sidebarMode={sidebarMode}
              contents={SidebarContentsType.AI_ASSISTANT}
              label="AI Assistant"
              iconName="growi_ai"
              isCustomIcon
            />
          </NotAvailable>
        )
      )}
    </div>
  );
});
