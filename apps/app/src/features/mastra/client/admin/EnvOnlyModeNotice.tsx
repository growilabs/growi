import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { Alert } from 'reactstrap';

import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';

export interface EnvOnlyModeNoticeProps {
  /** Whether the env-only mode (`env:useOnlyEnvVars:ai`) is active. */
  readonly useOnlyEnvVars: boolean;
}

/**
 * Notice shown when AI settings are fixed by environment variables (4.2).
 *
 * When the env-only mode is active every field is rendered read-only/disabled;
 * this alert makes the reason explicit. Renders nothing when the mode is off.
 *
 * On GROWI.cloud the env vars are not editable here either, so the notice adds a
 * link to the GROWI.cloud console where they are actually managed.
 */
export const EnvOnlyModeNotice = (
  props: EnvOnlyModeNoticeProps,
): JSX.Element | null => {
  const { useOnlyEnvVars } = props;
  const { t } = useTranslation('admin');
  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();
  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

  if (!useOnlyEnvVars) {
    return null;
  }

  return (
    <Alert color="warning" className="mb-3">
      <p className={isCloud ? 'mb-2' : 'mb-0'}>
        {t('ai_settings.env_only_mode_notice')}
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
