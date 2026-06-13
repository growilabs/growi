import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { Alert } from 'reactstrap';

export interface EnvOnlyModeNoticeProps {
  /** Whether the env-only mode (`env:useOnlyEnvVars:ai`) is active. */
  readonly useOnlyEnvVars: boolean;
}

/**
 * Notice shown when AI settings are fixed by environment variables (4.2).
 *
 * When the env-only mode is active every field is rendered read-only/disabled;
 * this alert makes the reason explicit. Renders nothing when the mode is off.
 */
export const EnvOnlyModeNotice = (
  props: EnvOnlyModeNoticeProps,
): JSX.Element | null => {
  const { useOnlyEnvVars } = props;
  const { t } = useTranslation('admin');

  if (!useOnlyEnvVars) {
    return null;
  }

  return (
    <Alert color="info" className="mb-3">
      {t('ai_settings.env_only_mode_notice')}
    </Alert>
  );
};
