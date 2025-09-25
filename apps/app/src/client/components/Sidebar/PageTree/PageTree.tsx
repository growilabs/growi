import { Suspense, useState, type JSX } from 'react';

import dynamic from 'next/dynamic';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '../../ItemsTree/ItemsTreeContentSkeleton';

import { PageTreeHeader } from './PageTreeSubstance';

const PageTreeContent = dynamic(
  () => import('./PageTreeSubstance').then(mod => mod.PageTreeContent),
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
            onWipPageShownChange={() => { setIsWipPageShown(!isWipPageShown) }}
          />
        </Suspense>
      </div>

      <Suspense fallback={<ItemsTreeContentSkeleton />}>
        <DndProvider backend={HTML5Backend}>
          <PageTreeContent isWipPageShown={isWipPageShown} />
        </DndProvider>
      </Suspense>
    </div>
  );
};
