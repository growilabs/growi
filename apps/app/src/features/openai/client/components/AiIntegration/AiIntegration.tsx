import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export const AiIntegration = (): JSX.Element => {
  const { t } = useTranslation('admin');

  // Connection/credential settings (OpenAI/Azure serviceType, API key, AI_ENABLED)
  // are configured via environment variables, not this admin screen.
  // The former assistant / vectorStore / AI search-management settings have been removed.
  return (
    <div data-testid="admin-ai-integration">
      <h2 className="admin-setting-header">
        {t('ai_integration.ai_integration')}
      </h2>
    </div>
  );
};
