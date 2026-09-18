import { type JSX, useCallback } from 'react';
import { UserPicture } from '@growi/ui/dist/components';
import { useDebounce } from 'usehooks-ts';

import { useSWRxSearch } from '~/stores/search';

import type { GetItemProps } from '../interfaces/downshift';
import { SearchMenuItem } from './SearchMenuItem';
import { SearchResultPagePath } from './SearchResultPagePath';

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

          {/* Let the path take the remaining width and shrink below its content
              size; min-width:0 is what actually enables the 1-line ellipsis
              inside SearchResultPagePath (no Bootstrap min-width-0 utility). */}
          <span className="ms-3 flex-grow-1" style={{ minWidth: 0 }}>
            <SearchResultPagePath path={item.data.path} />
          </span>

          <span className="text-body-tertiary ms-2 d-flex justify-content-center align-items-center flex-shrink-0">
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
