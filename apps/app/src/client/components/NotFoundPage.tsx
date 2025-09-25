import React, { useMemo, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import CustomNavAndContents from './CustomNavigation/CustomNavAndContents';
import { DescendantsPageList } from './DescendantsPageList';
import { PageTimeline } from './PageTimeline';

type NotFoundPageProps = {
  path: string,
}

const NotFoundPage = (props: NotFoundPageProps): JSX.Element => {
  const { t } = useTranslation();

  const { path } = props;

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: () => <span className="material-symbols-outlined">subject</span>,
        Content: () => <DescendantsPageList path={path} />,
        i18n: t('page_list'),
      },
      timeLine: {
        Icon: () => <span className="material-symbols-outlined">timeline</span>,
        Content: PageTimeline,
        i18n: t('Timeline View'),
      },
    };
  }, [path, t]);

  return (
    <div className="d-edit-none">
      <CustomNavAndContents navTabMapping={navTabMapping} tabContentClasses={['py-4']} />
    </div>
  );
};

export default NotFoundPage;
