import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { ILinkTarget } from '../../interfaces/backlink';
import { BacklinkListItem } from './BacklinkListItem';

type LinkTargetsSectionProps = {
  linkTargets: ILinkTarget[];
};

export const LinkTargetsSection = ({
  linkTargets,
}: LinkTargetsSectionProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <section className="mt-4" data-testid="backlinks-link-targets">
      <h6>{t('backlinks.outgoing_needing_attention')}</h6>
      <ul className="list-group">
        {linkTargets.map((linkTarget) => (
          // A broken row has no pageId; its toPath is unique per source page
          <BacklinkListItem
            key={linkTarget.pageId ?? linkTarget.path}
            {...linkTarget}
          />
        ))}
      </ul>
    </section>
  );
};
