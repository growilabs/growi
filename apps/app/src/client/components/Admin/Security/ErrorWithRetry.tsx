import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

type ErrorWithRetryProps = {
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
};

export const ErrorWithRetry = ({
  message,
  isRetrying,
  onRetry,
}: ErrorWithRetryProps): JSX.Element => {
  const { t } = useTranslation('admin');
  return (
    <div className="d-flex align-items-center gap-2 mt-2">
      <span className="text-danger">{message}</span>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        disabled={isRetrying}
        onClick={onRetry}
      >
        {t('security_settings.legacy_password_cleanup.retry')}
      </button>
    </div>
  );
};
