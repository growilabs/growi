import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';

type PerPageNotificationsLabelProps = {
  readonly view: Pick<ChangeProposalView, 'requesterState'>;
};

export const PerPageNotificationsLabel = ({
  view,
}: PerPageNotificationsLabelProps): JSX.Element | null => {
  const { t } = useTranslation();
  const setting = view.requesterState?.perPageNotifications;
  if (setting == null || !setting.isEnabledBySettings) {
    return null;
  }

  return (
    <span className="small text-muted">
      {setting.value
        ? t('change_proposal_viewer.per_page_notifications.enabled')
        : t('change_proposal_viewer.per_page_notifications.disabled')}
    </span>
  );
};
