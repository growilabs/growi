import type { JSX } from 'react';
import dynamic from 'next/dynamic';

import { useIsNotFound } from '~/stores/page';

import { OldRevisionAlert } from './OldRevisionAlert';
import { PageGrantAlert } from './PageGrantAlert';
import { PageStaleAlert } from './PageStaleAlert';
import { WipPageAlert } from './WipPageAlert';

const FullTextSearchNotCoverAlert = dynamic(
  () =>
    import('./FullTextSearchNotCoverAlert').then(
      (mod) => mod.FullTextSearchNotCoverAlert,
    ),
  { ssr: false },
);
const PageRedirectedAlert = dynamic(
  () => import('./PageRedirectedAlert').then((mod) => mod.PageRedirectedAlert),
  { ssr: false },
);
const FixPageGrantAlert = dynamic(
  () => import('./FixPageGrantAlert').then((mod) => mod.FixPageGrantAlert),
  { ssr: false },
);
const TrashPageAlert = dynamic(
  () => import('./TrashPageAlert').then((mod) => mod.TrashPageAlert),
  { ssr: false },
);

export const PageAlerts = (): JSX.Element => {
  const { data: isNotFound } = useIsNotFound();

  return (
    <div className="row d-edit-none">
      <div className="col-sm-12">
        {/* alerts */}
        {!isNotFound && <FixPageGrantAlert />}
        <FullTextSearchNotCoverAlert />
        <WipPageAlert />
        <PageGrantAlert />
        <TrashPageAlert />
        <PageStaleAlert />
        <OldRevisionAlert />
        <PageRedirectedAlert />
      </div>
    </div>
  );
};
