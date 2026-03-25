import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { useGrowiDocumentationUrl } from '~/states/context';
import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';

export const AiIntegrationDisableMode: FC = () => {
  const { t } = useTranslation('admin');
  const documentationUrl = useGrowiDocumentationUrl();

  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();

  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

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
                {t('ai_integration.ai_integration')}
              </h1>
              <h3
                // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
                dangerouslySetInnerHTML={{
                  __html: t(
                    isCloud
                      ? 'ai_integration.disable_mode_explanation_cloud'
                      : 'ai_integration.disable_mode_explanation',
                    { documentationUrl },
                  ),
                }}
              />
              {isCloud && (
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
