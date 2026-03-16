import { type JSX, Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '../../ItemsTree/ItemsTreeContentSkeleton';
import { PageTreeHeader } from './PageTreeSubstance';

// react-dnd and react-dnd-html5-backend are browser-only; wrapping them with
// ssr: false keeps both packages out of .next/node_modules/ so they can stay
// in devDependencies.
const PageTreeWithDnD = dynamic(
  () => import('./PageTreeWithDnD').then((mod) => mod.PageTreeWithDnD),
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
