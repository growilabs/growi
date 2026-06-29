import React, { type JSX, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '~/client/components/ItemsTree/ItemsTreeContentSkeleton';
import { useIsGuestUser } from '~/states/context';

const AiSidebarContent = dynamic(
  () => import('./AiSidebarContent').then((mod) => mod.AiSidebarContent),
  { ssr: false },
);

export const AiSidebar = (): JSX.Element => {
  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();

  return (
    <div className="px-3">
      <div className="grw-sidebar-content-header py-4 d-flex">
        <h3 className="fs-6 fw-bold mb-0">{t('GROWI AI')}</h3>
      </div>

      {isGuestUser ? (
        <h4 className="fs-6">{t('Not available for guest')}</h4>
      ) : (
        <Suspense fallback={<ItemsTreeContentSkeleton />}>
          <AiSidebarContent />
        </Suspense>
      )}
    </div>
  );
};
