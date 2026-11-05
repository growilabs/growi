import type { JSX } from 'react';
import Link from 'next/link';
import { PagePathLabel } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import type { LinkTargetState } from '../../interfaces/backlink';

type BacklinkListItemProps = {
  pageId: string | null;
  path: string;
  targetState?: LinkTargetState;
};

const TARGET_STATE_BADGES: Partial<
  Record<LinkTargetState, { labelKey: string; className: string }>
> = {
  trashed: {
    labelKey: 'backlinks.target_state.trashed',
    className: 'text-bg-warning',
  },
  broken: {
    labelKey: 'backlinks.target_state.broken',
    className: 'text-bg-danger',
  },
};

export const BacklinkListItem = ({
  pageId,
  path,
  targetState,
}: BacklinkListItemProps): JSX.Element => {
  const { t } = useTranslation();
  const badge =
    targetState != null ? TARGET_STATE_BADGES[targetState] : undefined;

  // PagePathLabel renders the former path plus the bolded page title (latter segment)
  const label = <PagePathLabel path={path} />;

  return (
    <li className="list-group-item">
      {pageId != null ? (
        <Link href={`/${pageId}`} className="text-break" prefetch={false}>
          {label}
        </Link>
      ) : (
        <span className="text-break">{label}</span>
      )}
      {badge != null && (
        <span className={`badge ms-2 ${badge.className}`}>
          {t(badge.labelKey)}
        </span>
      )}
    </li>
  );
};
