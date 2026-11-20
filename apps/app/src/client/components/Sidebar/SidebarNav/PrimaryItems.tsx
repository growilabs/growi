import { memo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { NotAvailable } from '~/client/components/NotAvailable';
import { SidebarContentsType } from '~/interfaces/ui';
import { useIsAdmin, useIsGuestUser } from '~/states/context';
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
  const isAdminUser = useIsAdmin();

  if (sidebarMode == null) {
    return <></>;
  }

  // When AI is not ready, the AI Chat icon is always shown but disabled. The
  // tooltip prompts configuration on the admin screen: admins get a link to
  // /admin/ai, while non-admins (who would 403 there) are asked to contact one.
  const aiUnavailableTitle = isAdminUser ? (
    <>
      <p className="mb-2">
        {t('ai_unavailable.open_admin_settings_to_enable')}
      </p>
      <Link href="/admin/ai">
        <span
          className="material-symbols-outlined me-1"
          style={{ fontSize: '1rem', verticalAlign: 'middle' }}
        >
          settings
        </span>
        {t('ai_unavailable.to_admin_ai_settings')}
      </Link>
    </>
  ) : (
    t('ai_unavailable.contact_admin_to_enable')
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
      <NotAvailable
        isDisabled={!isAiEnabled}
        title={aiUnavailableTitle}
        placement="right"
      >
        <PrimaryItem
          sidebarMode={sidebarMode}
          contents={SidebarContentsType.AI}
          label="GROWI AI Agent"
          iconName="growi_ai"
          isCustomIcon
          onHover={onItemHover}
        />
      </NotAvailable>
    </div>
  );
});
