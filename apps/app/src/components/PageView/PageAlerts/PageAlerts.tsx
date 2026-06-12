import type { JSX } from 'react';

import { FixPageGrantAlertLazyLoaded } from './FixPageGrantAlert/index.js';
import { FullTextSearchNotCoverAlertLazyLoaded } from './FullTextSearchNotCoverAlert/index.js';
import { OldRevisionAlert } from './OldRevisionAlert.js';
import { PageGrantAlert } from './PageGrantAlert.js';
import { PageRedirectedAlertLazyLoaded } from './PageRedirectedAlert/index.js';
import { PageStaleAlert } from './PageStaleAlert.js';
import { TrashPageAlertLazyLoaded } from './TrashPageAlert/index.js';
import { WipPageAlert } from './WipPageAlert.js';

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
