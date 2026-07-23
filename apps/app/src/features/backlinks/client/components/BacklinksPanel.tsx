import type { JSX } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { useCurrentPageId } from '~/states/page';

import { useSWRxBacklinks } from '../stores/use-swrx-backlinks';
import { BacklinkListItem } from './BacklinkListItem';

export const BacklinksPanel = (): JSX.Element => {
  const { t } = useTranslation();
  const pageId = useCurrentPageId();

  const { data: backlinks, isLoading } = useSWRxBacklinks(pageId ?? null);

  if (isLoading || backlinks == null) {
    return (
      <div className="text-muted text-center" data-testid="backlinks-loading">
        <LoadingSpinner className="me-1 fs-3" />
      </div>
    );
  }

  if (backlinks.length === 0) {
    return (
      <div className="text-muted" data-testid="backlinks-empty">
        {t('backlinks.no_backlinks')}
      </div>
    );
  }

  return (
    <ul className="list-group" data-testid="backlinks-list">
      {backlinks.map((backlink) => (
        <BacklinkListItem key={backlink.pageId} backlink={backlink} />
      ))}
    </ul>
  );
};
