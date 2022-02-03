import React, { FC } from 'react';

import { IPageWithMeta } from '~/interfaces/page';
import { IPageSearchMeta } from '~/interfaces/search';

import RevisionLoader from '../Page/RevisionLoader';
import AppContainer from '../../client/services/AppContainer';
import SearchResultContentSubNavigation from './SearchResultContentSubNavigation';

type Props ={
  appContainer: AppContainer,
  searchingKeyword:string,
  focusedSearchResultData : IPageWithMeta<IPageSearchMeta>,
}


const SearchResultContent: FC<Props> = (props: Props) => {
  const page = props.focusedSearchResultData?.pageData;
  // return if page is null
  if (page == null) return <></>;
  const growiRenderer = props.appContainer.getRenderer('searchresult');
  return (
    <div key={page._id} className="search-result-page grw-page-path-text-muted-container d-flex flex-column">
      <SearchResultContentSubNavigation
        pageId={page._id}
        revisionId={page.revision}
        path={page.path}
      >
      </SearchResultContentSubNavigation>
      <div className="search-result-page-content">
        <RevisionLoader
          growiRenderer={growiRenderer}
          pageId={page._id}
          pagePath={page.path}
          revisionId={page.revision}
          highlightKeywords={props.searchingKeyword}
        />
      </div>
    </div>
  );
};


export default SearchResultContent;
