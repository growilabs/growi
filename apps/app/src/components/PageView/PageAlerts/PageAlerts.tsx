import type { JSX } from 'react';

import { FixPageGrantAlertLazyLoaded } from './FixPageGrantAlert';
import { FullTextSearchNotCoverAlertLazyLoaded } from './FullTextSearchNotCoverAlert';
import { OldRevisionAlert } from './OldRevisionAlert';
import { PageGrantAlert } from './PageGrantAlert';
import { PageRedirectedAlertLazyLoaded } from './PageRedirectedAlert';
import { PageStaleAlert } from './PageStaleAlert';
import { TrashPageAlertLazyLoaded } from './TrashPageAlert';
import { WipPageAlert } from './WipPageAlert';

export const PageAlerts = (): JSX.Element => {
  return (
    <div className="row d-edit-none">
      <div className="col-sm-12">
        <WipPageAlert />
        <PageGrantAlert />
        <PageStaleAlert />
        <OldRevisionAlert />
        <FixPageGrantAlertLazyLoaded />
        <FullTextSearchNotCoverAlertLazyLoaded />
        <TrashPageAlertLazyLoaded />
        <PageRedirectedAlertLazyLoaded />
      </div>
    </div>
  );
};
