import type { JSX } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { useCurrentPageId } from '~/states/page';

import { useSWRxBacklinks } from '../stores/backlinks';
import { BacklinkListItem } from './BacklinkListItem';
import { LinkTargetsSection } from './LinkTargetsSection';

export const BacklinksPanel = (): JSX.Element => {
  const { t } = useTranslation();
  const pageId = useCurrentPageId();

  const { data, error, isLoading } = useSWRxBacklinks(pageId ?? null);
  const backlinks = data?.backlinks;
  const linkTargets = data?.linkTargets;

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

  const hasBacklinks = backlinks != null && backlinks.length > 0;
  const hasLinkTargets = linkTargets != null && linkTargets.length > 0;

  // The empty state is not an early return: a page nothing links to can still
  // link out to a trashed or broken target
  return (
    <>
      {hasBacklinks ? (
        <ul className="list-group" data-testid="backlinks-list">
          {backlinks.map((backlink) => (
            <BacklinkListItem key={backlink.pageId} {...backlink} />
          ))}
        </ul>
      ) : (
        <div className="text-muted" data-testid="backlinks-empty">
          {t('backlinks.no_backlinks')}
        </div>
      )}

      {hasLinkTargets && <LinkTargetsSection linkTargets={linkTargets} />}
    </>
  );
};
