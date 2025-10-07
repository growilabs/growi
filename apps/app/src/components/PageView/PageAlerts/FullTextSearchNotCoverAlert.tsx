import type { JSX } from 'react';

import { useTranslation } from 'react-i18next';
import { useSWRxCurrentPage } from '~/stores/page';
import { useElasticsearchMaxBodyLengthToIndex } from '~/stores-universal/context';

export const FullTextSearchNotCoverAlert = (): JSX.Element => {
  const { t } = useTranslation();

  const { data: elasticsearchMaxBodyLengthToIndex } =
    useElasticsearchMaxBodyLengthToIndex();
  const { data } = useSWRxCurrentPage();

  const markdownLength = data?.revision?.body?.length;

  if (
    markdownLength == null ||
    elasticsearchMaxBodyLengthToIndex == null ||
    markdownLength <= elasticsearchMaxBodyLengthToIndex
  ) {
    return <></>;
  }

  return (
    <div className="alert alert-warning">
      <strong>
        {t('Warning')}: {t('page_page.notice.not_indexed1')}
      </strong>
      <br />
      <small
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: t('page_page.notice.not_indexed2', {
            threshold: `<code>ELASTICSEARCH_MAX_BODY_LENGTH_TO_INDEX=${elasticsearchMaxBodyLengthToIndex}</code>`,
          }),
        }}
      />
    </div>
  );
};
