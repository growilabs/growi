import React, { type JSX, useCallback } from 'react';
import { PagePathLabel, UserPicture } from '@growi/ui/dist/components';
import { useDebounce } from 'usehooks-ts';

import { useSWRxSearch } from '~/stores/search';

import type { GetItemProps } from '../interfaces/downshift';
import { SearchMenuItem } from './SearchMenuItem';

type Props = {
  activeIndex: number | null;
  searchKeyword: string;
  getItemProps: GetItemProps;
};
export const SearchResultMenuItem = (props: Props): JSX.Element => {
  const { activeIndex, searchKeyword, getItemProps } = props;

  const debouncedKeyword = useDebounce(searchKeyword, 500);

  const isEmptyKeyword = searchKeyword.trim().length === 0;

  const { data: searchResult, isLoading } = useSWRxSearch(
    isEmptyKeyword ? null : debouncedKeyword,
    null,
    { limit: 10 },
  );

  /**
   *  SearchMenu is a combination of a list of SearchMethodMenuItem and SearchResultMenuItem (this component).
   *  If no keywords are entered into SearchForm, SearchMethodMenuItem returns a single item. Conversely, when keywords are entered, three items are returned.
   *  For these reasons, the starting index of SearchResultMemuItem changes depending on the presence or absence of the searchKeyword.
   */
  const getFiexdIndex = useCallback(
    (index: number) => {
      return (isEmptyKeyword ? 1 : 3) + index;
    },
    [isEmptyKeyword],
  );

  if (isLoading) {
    return (
      <>
        <div className="border-top mt-2 mb-2" />
        Searching...
      </>
    );
  }

  if (
    isEmptyKeyword ||
    searchResult == null ||
    searchResult.data.length === 0
  ) {
    return <></>;
  }

  return (
    <div>
      <div className="border-top mt-2 mb-2" />
      {searchResult?.data.map((item, index) => (
        <SearchMenuItem
          key={item.data._id}
          index={getFiexdIndex(index)}
          isActive={getFiexdIndex(index) === activeIndex}
          getItemProps={getItemProps}
          url={item.data._id}
        >
          <UserPicture user={item.data.creator} />

          <span className="ms-3 text-break text-wrap">
            <PagePathLabel path={item.data.path} />
          </span>

          <span className="text-body-tertiary ms-2 d-flex justify-content-center align-items-center">
            <span className="material-symbols-outlined fs-6 p-0">
              footprint
            </span>
            <span className="fs-6">{item.data.seenUsers.length}</span>
          </span>
        </SearchMenuItem>
      ))}
    </div>
  );
};
