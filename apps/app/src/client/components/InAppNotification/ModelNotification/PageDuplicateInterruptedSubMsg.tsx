import type { FC, JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';

type Props = {
  snapshot: string;
};

export const PageDuplicateInterruptedSubMsg: FC<Props> = ({
  snapshot,
}: Props): JSX.Element | null => {
  const { t } = useTranslation('commons');

  const parsed = pageDuplicateInterruptedSnapshot.parse(snapshot);
  if (parsed == null) {
    return null;
  }

  return (
    <div className="text-danger">
      <small>
        {t('in_app_notification.page_duplicate_interrupted.summary', {
          toPath: parsed.toPath,
          fromPath: parsed.fromPath,
          copiedPageCount: parsed.copiedPageCount,
          sourcePageCount: parsed.sourcePageCount,
        })}
      </small>
      <br />
      <small>
        {t('in_app_notification.page_duplicate_interrupted.advice')}
      </small>
    </div>
  );
};
