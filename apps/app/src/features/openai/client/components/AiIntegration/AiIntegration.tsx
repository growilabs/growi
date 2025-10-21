import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export const AiIntegration = (): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <div data-testid="admin-ai-integration">
      <h2 className="admin-setting-header">
        {t('ai_integration.ai_search_management')}
      </h2>

      <div className="row"></div>
    </div>
  );
};
