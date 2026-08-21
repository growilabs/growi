import type { JSX } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { useCurrentPageId } from '~/states/page';

import { useSWRxBacklinks } from '../stores/backlinks';
import { BacklinkListItem } from './BacklinkListItem';

export const BacklinksPanel = (): JSX.Element => {
  const { t } = useTranslation();
  const pageId = useCurrentPageId();

  const {
    data: backlinks,
    error,
    isLoading,
  } = useSWRxBacklinks(pageId ?? null);

  if (error != null) {
    return (
      <div className="text-danger" data-testid="backlinks-error">
        {t('backlinks.failed_to_fetch')}
      </div>
    );
  }

  // A null pageId (empty / not-found page) gives the hook a null key, so nothing
  // is ever fetched -- skip the spinner and fall through to the empty state,
  // otherwise it would spin forever.
  if (pageId != null && (isLoading || backlinks == null)) {
    return (
      <div className="text-muted text-center" data-testid="backlinks-loading">
        <LoadingSpinner className="me-1 fs-3" />
      </div>
    );
  }

  if (backlinks == null || backlinks.length === 0) {
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
