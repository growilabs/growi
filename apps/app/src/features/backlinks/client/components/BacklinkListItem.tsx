import type { JSX } from 'react';
import Link from 'next/link';
import { PagePathLabel } from '@growi/ui/dist/components';

import type { IBacklink } from '../../interfaces/backlink';

type BacklinkListItemProps = {
  backlink: IBacklink;
};

export const BacklinkListItem = ({
  backlink,
}: BacklinkListItemProps): JSX.Element => {
  const { pageId, path } = backlink;

  // PagePathLabel renders the former path plus the bolded page title (latter segment)
  return (
    <li className="list-group-item">
      <Link href={`/${pageId}`} className="text-break" prefetch={false}>
        <PagePathLabel path={path} />
      </Link>
    </li>
  );
};
