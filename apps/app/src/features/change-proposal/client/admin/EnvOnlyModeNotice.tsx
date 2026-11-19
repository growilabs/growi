import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { Alert } from 'reactstrap';

import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';

export const EnvOnlyModeNotice = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();
  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

  return (
    <Alert color="warning" className="mb-3">
      <p className={isCloud ? 'mb-2' : 'mb-0'}>
        {t('change_proposal_settings.env_only_mode_notice')}
      </p>
      {isCloud && (
        <>
          <p className="mb-2">
            {t('cloud_setting_management.change_from_cloud')}
          </p>
          <a
            href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}
            className="btn btn-outline-secondary"
          >
            <span className="material-symbols-outlined me-1">share</span>
            {t('cloud_setting_management.to_cloud_settings')}
          </a>
        </>
      )}
    </Alert>
  );
};
