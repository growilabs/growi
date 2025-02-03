import type { FC } from 'react';
import React from 'react';

import { useTranslation } from 'react-i18next';

import { useGrowiDocumentationUrl } from '~/stores-universal/context';

export const AiIntegrationDisableMode: FC = () => {
  const { t } = useTranslation('admin');
  const { data: documentationUrl } = useGrowiDocumentationUrl();

  return (
    <div className="ccontainer-lg">
      <div className="container">
        <div className="row justify-content-md-center">
          <div className="col-md-6 mt-5">
            <div className="text-center">
              {/* error icon large */}
              <h1><span className="material-symbols-outlined">error</span></h1>
              <h1 className="text-center">{t('ai_integration.ai_integration')}</h1>
              <h3
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: t('ai_integration.disable_mode_explanation', { documentationUrl }) }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
