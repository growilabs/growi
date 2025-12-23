import type { JSX } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { elasticsearchMaxBodyLengthToIndexAtom } from '~/states/server-configurations';

export type FullTextSearchNotCoverAlertProps = {
  isActive: boolean;
};

export const FullTextSearchNotCoverAlert = ({
  isActive,
}: FullTextSearchNotCoverAlertProps): JSX.Element => {
  const { t } = useTranslation();
  const elasticsearchMaxBodyLengthToIndex = useAtomValue(
    elasticsearchMaxBodyLengthToIndexAtom,
  );

  // Display condition is controlled by the isActive prop from dynamic.tsx
  if (!isActive) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <div className="alert alert-warning">
      <strong>
        {t('Warning')}: {t('page_page.notice.not_indexed1')}
      </strong>
      <br />
      <small
        // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
        dangerouslySetInnerHTML={{
          __html: t('page_page.notice.not_indexed2', {
            threshold: `<code>ELASTICSEARCH_MAX_BODY_LENGTH_TO_INDEX=${elasticsearchMaxBodyLengthToIndex}</code>`,
          }),
        }}
      />
    </div>
  );
};
