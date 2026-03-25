import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';

export const AiIntegration = (): JSX.Element => {
  const { t } = useTranslation('admin');

  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();

  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

  return (
    <div data-testid="admin-ai-integration">
      {isCloud && (
        <a
          href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}
          className="btn btn-outline-secondary mb-4"
        >
          <span className="material-symbols-outlined me-1">share</span>
          {t('cloud_setting_management.to_cloud_settings')}
        </a>
      )}

      <h2 className="admin-setting-header">
        {t('ai_integration.ai_search_management')}
      </h2>

      <div className="row"></div>
    </div>
  );
};
