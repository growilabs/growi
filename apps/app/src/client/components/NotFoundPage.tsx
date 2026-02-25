import React, { type JSX, useMemo } from 'react';
import { useTranslation } from 'next-i18next';

import CustomNavAndContents from './CustomNavigation/CustomNavAndContents';
import { DescendantsPageList } from './DescendantsPageList';
import { PageTimeline } from './PageTimeline';

type NotFoundPageProps = {
  path: string;
};

const PageListIcon = () => (
  <span className="material-symbols-outlined">subject</span>
);
const TimelineIcon = () => (
  <span className="material-symbols-outlined">timeline</span>
);

const NotFoundPage = (props: NotFoundPageProps): JSX.Element => {
  const { t } = useTranslation();

  const { path } = props;

  const PageListContent = useMemo(() => {
    return () => <DescendantsPageList path={path} />;
  }, [path]);

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: PageListIcon,
        Content: PageListContent,
        i18n: t('page_list'),
      },
      timeLine: {
        Icon: TimelineIcon,
        Content: PageTimeline,
        i18n: t('Timeline View'),
      },
    };
  }, [PageListContent, t]);

  return (
    <div className="d-edit-none">
      <CustomNavAndContents
        navTabMapping={navTabMapping}
        tabContentClasses={['py-4']}
      />
    </div>
  );
};

export default NotFoundPage;
