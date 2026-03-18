import type { FC } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';

export const AuditLogDisableMode: FC = () => {
  const { t } = useTranslation('admin');

  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();

  return (
    <div className="ccontainer-lg">
      <div className="container">
        <div className="row justify-content-md-center">
          <div className="col-md-6 mt-5">
            <div className="text-center">
              {/* error icon large */}
              <h1>
                <span className="material-symbols-outlined">error</span>
              </h1>
              <h1 className="text-center">
                {t('audit_log_management.audit_log')}
              </h1>
              <h3
                // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted translation markup
                dangerouslySetInnerHTML={{
                  __html: t('audit_log_management.disable_mode_explanation'),
                }}
              />
              {growiCloudUri != null && growiAppIdForGrowiCloud != null && (
                <a
                  href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}
                  className="btn btn-outline-secondary mt-3"
                >
                  <span className="material-symbols-outlined me-1">share</span>
                  {t('cloud_setting_management.to_cloud_settings')}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
