import type { JSX } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { useCurrentPageData } from '~/states/page';
import { elasticsearchMaxBodyLengthToIndexAtom } from '~/states/server-configurations';

export const FullTextSearchNotCoverAlert = (): JSX.Element => {
  const { t } = useTranslation();

  const elasticsearchMaxBodyLengthToIndex = useAtomValue(
    elasticsearchMaxBodyLengthToIndexAtom,
  );
  const data = useCurrentPageData();

  const markdownLength = data?.revision?.body?.length;

  if (
    markdownLength == null ||
    elasticsearchMaxBodyLengthToIndex == null ||
    markdownLength <= elasticsearchMaxBodyLengthToIndex
  ) {
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
