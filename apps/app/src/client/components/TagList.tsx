import type { FC } from 'react';
import React, { useCallback } from 'react';

import { useTranslation } from 'next-i18next';

import type { IDataTagCount } from '~/interfaces/tag';
import { useSetSearchKeyword } from '~/states/search';

import PaginationWrapper from './PaginationWrapper';

import styles from './TagList.module.scss';

const moduleClass = styles['grw-tag-list'];


type TagListProps = {
  tagData: IDataTagCount[],
  totalTags: number,
  activePage: number,
  onChangePage?: (selectedPageNumber: number) => void,
  pagingLimit: number,
  isPaginationShown?: boolean,
}

const defaultProps = {
  isPaginationShown: true,
};

const TagList: FC<TagListProps> = (props:(TagListProps & typeof defaultProps)) => {
  const {
    tagData, totalTags, activePage, onChangePage, pagingLimit, isPaginationShown,
  } = props;
  const isTagExist: boolean = tagData.length > 0;
  const { t } = useTranslation('');

  const setSearchKeyword = useSetSearchKeyword();

  const generateTagList = useCallback((tagData) => {
    return tagData.map((tag:IDataTagCount) => {
      return (
        <button
          key={tag._id}
          type="button"
          className="list-group-item list-group-item-action d-flex justify-content-between rounded-1"
          onClick={() => setSearchKeyword(`tag:${tag.name}`)}
        >
          <div className="text-truncate grw-tag badge">{tag.name}</div>
          <div className="grw-tag-count badge">{tag.count}</div>
        </button>
      );
    });
  }, [setSearchKeyword]);

  if (!isTagExist) {
    return <h6>{ t('You have no tag, You can set tags on pages') }</h6>;
  }

  return (
    <div className={moduleClass}>
      <div className="list-group list-group-flush mb-5">
        {generateTagList(tagData)}
      </div>
      {isPaginationShown
      && (
        <PaginationWrapper
          activePage={activePage}
          changePage={onChangePage}
          totalItemsCount={totalTags}
          pagingLimit={pagingLimit}
          align="center"
          size="md"
        />
      )
      }
    </div>
  );

};

TagList.defaultProps = defaultProps;

export default TagList;
