import { type JSX, Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '../../ItemsTree/ItemsTreeContentSkeleton';
import { PageTreeHeader } from './PageTreeSubstance';

// PageTreeWithDnD uses HTML5Backend which accesses browser APIs on mount;
// ssr: false prevents it from rendering on the server.
const PageTreeWithDnD = dynamic(
  () => import('./PageTreeSubstance').then((mod) => mod.PageTreeWithDnD),
  { ssr: false, loading: ItemsTreeContentSkeleton },
);

export const PageTree = (): JSX.Element => {
  const { t } = useTranslation();

  const [isWipPageShown, setIsWipPageShown] = useState(true);

  return (
    <div className="pt-4 pb-3 px-3">
      <div className="grw-sidebar-content-header d-flex">
        <h3 className="fs-6 fw-bold mb-0">{t('Page Tree')}</h3>
        <Suspense>
          <PageTreeHeader
            isWipPageShown={isWipPageShown}
            onWipPageShownChange={() => {
              setIsWipPageShown(!isWipPageShown);
            }}
          />
        </Suspense>
      </div>

      <Suspense fallback={<ItemsTreeContentSkeleton />}>
        <PageTreeWithDnD isWipPageShown={isWipPageShown} />
      </Suspense>
    </div>
  );
};
