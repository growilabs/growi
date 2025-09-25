import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { Skeleton } from '~/client/components/Skeleton';

import styles from '../Tag.module.scss';

export const TagListSkeleton = (): JSX.Element => {
  return (
    <Skeleton additionalClass={`${styles['grw-tag-list-skeleton']} w-100 rounded overflow-hidden`} />
  );
};

const TagContentSkeleton = (): JSX.Element => {
  const { t } = useTranslation('');

  return (
    <>
      <h3 className="my-3">{t('tag_list')}</h3>
      <TagListSkeleton />
    </>
  );
};

export default TagContentSkeleton;
