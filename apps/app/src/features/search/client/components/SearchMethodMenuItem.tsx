import React, { type JSX } from 'react';
import { DevidedPagePath } from '@growi/core/dist/models';
import { useTranslation } from 'next-i18next';

import { useCurrentPagePath } from '~/stores/page';

import type { GetItemProps } from '../interfaces/downshift';
import { SearchMenuItem } from './SearchMenuItem';

type Props = {
  activeIndex: number | null;
  searchKeyword: string;
  getItemProps: GetItemProps;
};

export const SearchMethodMenuItem = (props: Props): JSX.Element => {
  const { activeIndex, searchKeyword, getItemProps } = props;

  const { t } = useTranslation('commons');

  const { data: currentPagePath } = useCurrentPagePath();

  const dPagePath = new DevidedPagePath(currentPagePath ?? '', true, true);
  const currentPageName = `
  ${!(dPagePath.isRoot || dPagePath.isFormerRoot) ? '...' : ''}/${dPagePath.isRoot ? '' : `${dPagePath.latter}/`}
  `;

  const shouldShowMenuItem = searchKeyword.trim().length > 0;

  return (
    <div>
      {shouldShowMenuItem && (
        <div data-testid="search-all-menu-item">
          <SearchMenuItem
            index={0}
            isActive={activeIndex === 0}
            getItemProps={getItemProps}
            url={`/_search?q=${searchKeyword}`}
          >
            <span className="material-symbols-outlined fs-4 me-3 p-0">
              search
            </span>
            <div className="w-100 d-flex align-items-md-center flex-md-row align-items-start flex-column">
              <span className="text-break me-auto">{searchKeyword}</span>
              <span className="small text-body-tertiary">
                {t('search_method_menu_item.search_in_all')}
              </span>
            </div>
          </SearchMenuItem>
        </div>
      )}
      <div data-testid="search-prefix-menu-item">
        <SearchMenuItem
          index={shouldShowMenuItem ? 1 : 0}
          isActive={activeIndex === (shouldShowMenuItem ? 1 : 0)}
          getItemProps={getItemProps}
          url={`/_search?q=prefix:${currentPagePath} ${searchKeyword}`}
        >
          <span className="material-symbols-outlined fs-4 me-3 p-0">
            search
          </span>
          <div className="w-100 d-flex align-items-md-center flex-md-row align-items-start flex-column">
            <code className="text-break">{currentPageName}</code>
            <span className="ms-md-2 text-break me-auto">{searchKeyword}</span>
            <span className="small text-body-tertiary">
              {t('search_method_menu_item.only_children_of_this_tree')}
            </span>
          </div>
        </SearchMenuItem>
      </div>

      {shouldShowMenuItem && (
        <SearchMenuItem
          index={2}
          isActive={activeIndex === 2}
          getItemProps={getItemProps}
          url={`/_search?q="${searchKeyword}"`}
        >
          <span className="material-symbols-outlined fs-4 me-3 p-0">
            search
          </span>
          <div className="w-100 d-flex align-items-md-center flex-md-row align-items-start flex-column">
            <span className="text-break me-auto">{`"${searchKeyword}"`}</span>
            <span className="small text-body-tertiary">
              {t('search_method_menu_item.exact_mutch')}
            </span>
          </div>
        </SearchMenuItem>
      )}
    </div>
  );
};
