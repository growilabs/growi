import React, { type JSX, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '~/client/components/ItemsTree/ItemsTreeContentSkeleton';
import { useIsGuestUser } from '~/states/context';

const AiAssistantContent = dynamic(
  () => import('./AiAssistantSubstance').then((mod) => mod.AiAssistantContent),
  { ssr: false },
);

export const AiAssistant = (): JSX.Element => {
  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();

  return (
    <div className="px-3">
      <div className="grw-sidebar-content-header py-4 d-flex">
        <h3 className="fs-6 fw-bold mb-0">{t('Knowledge Assistant')}</h3>
      </div>

      {isGuestUser ? (
        <h4 className="fs-6">{t('Not available for guest')}</h4>
      ) : (
        <Suspense fallback={<ItemsTreeContentSkeleton />}>
          <AiAssistantContent />
        </Suspense>
      )}
    </div>
  );
};
