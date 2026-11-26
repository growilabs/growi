import type { JSX } from 'react';
import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import type { IBacklinksIndexState } from '../../interfaces/backlink';
import { toBacklinksIndexNotice } from '../utils/backlinks-index-notice';

type Props = {
  readonly indexState: IBacklinksIndexState | null;
};

/** Flags that backlinks from older pages can be missing (4.4). */
export const BacklinksIndexNotice = ({
  indexState,
}: Props): JSX.Element | null => {
  const { t } = useTranslation();
  const notice = toBacklinksIndexNotice(indexState);
  if (notice == null) return null;

  return (
    <div
      className="alert alert-info small py-2"
      data-testid="backlinks-index-notice"
    >
      {notice.kind === 'partial'
        ? t('backlinks.index_partial', {
            coveredSince: format(new Date(notice.coveredSince), 'yyyy-MM-dd'),
          })
        : t('backlinks.index_building')}
    </div>
  );
};
