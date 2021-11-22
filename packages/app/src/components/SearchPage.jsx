// This is the root component for #search-page

import React from 'react';
import PropTypes from 'prop-types';
import { withTranslation } from 'react-i18next';
import toastr from 'toastr';

import { withUnstatedContainers } from './UnstatedUtils';
import AppContainer from '~/client/services/AppContainer';

import { toastError } from '~/client/util/apiNotification';
import SearchPageLayout from './SearchPage/SearchPageLayout';
import SearchResultContent from './SearchPage/SearchResultContent';
import SearchResultList from './SearchPage/SearchResultList';
import SearchControl from './SearchPage/SearchControl';
import DeletePageListModal from './SearchPage/DeletePageListModal';

import { CheckboxType } from '../interfaces/search';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:searchPage');

const toastrOption = {
  closeButton: true,
  progressBar: true,
  newestOnTop: false,
  showDuration: '100',
  hideDuration: '100',
  timeOut: '3000',
};

export const specificPathNames = {
  user: '/user',
  trash: '/trash',
};

class SearchPage extends React.Component {

  constructor(props) {
    super(props);
    // NOTE : selectedPages is deletion related state, will be used later in story 77535, 77565.
    // deletionModal, deletion related functions are all removed, add them back when necessary.
    // i.e ) in story 77525 or any tasks implementing deletion functionalities
    this.state = {
      searchingKeyword: decodeURI(this.props.query.q) || '',
      searchedKeyword: '',
      searchedPages: [],
      searchResultMeta: {},
      focusedPage: {},
      selectedPages: new Set(),
      searchResultCount: 0,
      activePage: 1,
      pagingLimit: 10, // change to an appropriate limit number
      excludeUsersHome: true,
      excludeTrash: true,
      checkboxState: CheckboxType.NONE_CHECKED,
      isDeleteConfirmModalShown: false,
      errorMessageForDeleting: '',
      isDeleteCompletely: false,
    };

    this.changeURL = this.changeURL.bind(this);
    this.search = this.search.bind(this);
    this.searchHandler = this.searchHandler.bind(this);
    this.selectPage = this.selectPage.bind(this);
    this.toggleCheckBox = this.toggleCheckBox.bind(this);
    this.onExcludeUsersHome = this.onExcludeUsersHome.bind(this);
    this.onExcludeTrash = this.onExcludeTrash.bind(this);
    this.onPagingNumberChanged = this.onPagingNumberChanged.bind(this);
    this.deleteSelectedPages = this.deleteSelectedPages.bind(this);
    this.showDeleteConfirmModal = this.showDeleteConfirmModal.bind(this);
    this.closeDeleteConfirmModal = this.closeDeleteConfirmModal.bind(this);
    this.toggleDeleteCompletely = this.toggleDeleteCompletely.bind(this);
  }

  componentDidMount() {
    const keyword = this.state.searchingKeyword;
    if (keyword !== '') {
      this.search({ keyword });
    }
  }

  static getQueryByLocation(location) {
    const search = location.search || '';
    const query = {};

    search.replace(/^\?/, '').split('&').forEach((element) => {
      const queryParts = element.split('=');
      query[queryParts[0]] = decodeURIComponent(queryParts[1]).replace(/\+/g, ' ');
    });

    return query;
  }

  onExcludeUsersHome() {
    this.setState({ excludeUsersHome: !this.state.excludeUsersHome });
  }

  onExcludeTrash() {
    this.setState({ excludeTrash: !this.state.excludeTrash });
  }

  changeURL(keyword, refreshHash) {
    let hash = window.location.hash || '';
    // TODO 整理する
    if (refreshHash || this.state.searchedKeyword !== '') {
      hash = '';
    }
    if (window.history && window.history.pushState) {
      window.history.pushState('', `Search - ${keyword}`, `/_search?q=${keyword}${hash}`);
    }
  }

  createSearchQuery(keyword) {
    let query = keyword;

    // pages included in specific path are not retrived when prefix is added
    if (this.state.excludeTrash) {
      query = `${query} -prefix:${specificPathNames.trash}`;
    }
    if (this.state.excludeUsersHome) {
      query = `${query} -prefix:${specificPathNames.user}`;
    }

    return query;
  }

  /**
   * this method is called when user changes paging number
   */
  async onPagingNumberChanged(activePage) {
    // this.setState does not change the state immediately and following calls of this.search outside of this.setState will have old activePage state.
    // To prevent above, pass this.search as a callback function to make sure this.search will have the latest activePage state.
    this.setState({ activePage }, () => this.search({ keyword: this.state.searchedKeyword }));
  }

  /**
   * this method is called when user searches by pressing Enter or using searchbox
   */
  async searchHandler(data) {
    // this.setState does not change the state immediately and following calls of this.search outside of this.setState will have old activePage state.
    // To prevent above, pass this.search as a callback function to make sure this.search will have the latest activePage state.
    this.setState({ activePage: 1 }, () => this.search(data));
  }

  async search(data) {
    const keyword = data.keyword;
    if (keyword === '') {
      this.setState({
        searchingKeyword: '',
        searchedKeyword: '',
        searchedPages: [],
        searchResultMeta: {},
        searchResultCount: 0,
        activePage: 1,
      });

      return true;
    }

    this.setState({
      searchingKeyword: keyword,
    });
    const pagingLimit = this.state.pagingLimit;
    const offset = (this.state.activePage * pagingLimit) - pagingLimit;
    try {
      const res = await this.props.appContainer.apiGet('/search', {
        q: this.createSearchQuery(keyword),
        limit: pagingLimit,
        offset,
      });
      this.changeURL(keyword);
      if (res.data.length > 0) {
        this.setState({
          searchedKeyword: keyword,
          searchedPages: res.data,
          searchResultMeta: res.meta,
          searchResultCount: res.meta.total,
          focusedPage: res.data[0],
          // reset active page if keyword changes, otherwise set the current state
          activePage: this.state.searchedKeyword === keyword ? this.state.activePage : 1,
        });
      }
      else {
        this.setState({
          searchedKeyword: keyword,
          searchedPages: [],
          searchResultMeta: {},
          searchResultCount: 0,
          focusedPage: {},
          activePage: 1,
        });
      }
    }
    catch (err) {
      toastError(err);
    }
  }

  selectPage= (pageId) => {
    const index = this.state.searchedPages.findIndex((page) => {
      return page._id === pageId;
    });
    this.setState({
      focusedPage: this.state.searchedPages[index],
    });
  }

  getCheckboxType = (selectedPagesCount) => {
    switch (selectedPagesCount) {
      case 0:
        return CheckboxType.NONE_CHECKED;
      case this.state.searchedPages.length:
        return CheckboxType.ALL_CHECKED;
      default:
        return CheckboxType.INDETERMINATE;
    }
  }

  updateCheckboxState = () => {
    const currentCheckboxState = this.getCheckboxType(this.state.selectedPages.size);
    this.setState({ checkboxState: currentCheckboxState });
  }

  toggleCheckBox = (page) => {
    if (this.state.selectedPages.has(page)) {
      this.state.selectedPages.delete(page);
    }
    else {
      this.state.selectedPages.add(page);
    }
    this.updateCheckboxState();
  }

  toggleAllCheckBox = () => {
    if (this.state.selectedPages.size === this.state.searchedPages.length) {
      this.state.selectedPages.clear();
      // Force a render to tell React that the State has been changed by the Set class method
      this.forceUpdate();
      return;
    }
    this.state.searchedPages.forEach((page) => {
      this.state.selectedPages.add(page);
    });
    // Force a render to tell React that the State has been changed by the Set class method
    this.forceUpdate();
    this.updateCheckboxState();
  };

  showDeleteConfirmModal() {
    this.setState({ isDeleteConfirmModalShown: true });
  }

  closeDeleteConfirmModal() {
    this.setState({ isDeleteConfirmModalShown: false });
  }

  toggleDeleteCompletely() {
    this.setState({ isDeleteCompletely: !this.state.isDeleteCompletely });
  }

  async deleteSelectedPages() {
    const deleteCompletely = this.state.isDeleteCompletely || null;
    try {
      await Promise.all(Array.from(this.state.selectedPages).map(async(page) => {
        const removePageParams = { page_id: page._id, revision_id: page.revision, completely: deleteCompletely };
        // Todo: add recursively option to the body for deleting child pages
        try {
          const res = await this.props.appContainer.apiPost('/pages.remove', removePageParams);
          if (res.ok) { this.state.selectedPages.delete(page) }
        }
        catch (err) {
          logger.error(err.message);
          this.setState({ errorMessageForDeleting: err.message });
          throw new Error(err.message);
        }
      }));
      window.location.reload();
    }
    catch (err) {
      toastr.error(err, 'Error occured', { toastrOption });
    }

  }

  renderSearchResultContent = () => {
    return (
      <SearchResultContent
        appContainer={this.props.appContainer}
        searchingKeyword={this.state.searchingKeyword}
        focusedPage={this.state.focusedPage}
      >
      </SearchResultContent>
    );
  }

  renderSearchResultList = () => {
    return (
      <SearchResultList
        pages={this.state.searchedPages || []}
        focusedPage={this.state.focusedPage}
        selectedPages={this.state.selectedPages || []}
        searchResultCount={this.state.searchResultCount}
        activePage={this.state.activePage}
        pagingLimit={this.state.pagingLimit}
        onClickInvoked={this.selectPage}
        onChangedInvoked={this.toggleCheckBox}
        onPagingNumberChanged={this.onPagingNumberChanged}
      />
    );
  }

  renderSearchControl = () => {
    return (
      <SearchControl
        searchingKeyword={this.state.searchingKeyword}
        appContainer={this.props.appContainer}
        onSearchInvoked={this.searchHandler}
        onExcludeUsersHome={this.onExcludeUsersHome}
        onExcludeTrash={this.onExcludeTrash}
        onClickInvoked={this.toggleAllCheckBox}
        checkboxState={this.state.checkboxState}
        onClickDeleteButton={this.showDeleteConfirmModal}
      >
      </SearchControl>
    );
  }

  render() {
    return (
      <div>
        <SearchPageLayout
          SearchControl={this.renderSearchControl}
          SearchResultList={this.renderSearchResultList}
          SearchResultContent={this.renderSearchResultContent}
          searchResultMeta={this.state.searchResultMeta}
          searchingKeyword={this.state.searchedKeyword}
        >
        </SearchPageLayout>
        <DeletePageListModal
          isShown={this.state.isDeleteConfirmModalShown}
          pages={Array.from(this.state.selectedPages)}
          errorMessage={this.state.errorMessageForDeleting}
          cancel={this.closeDeleteConfirmModal}
          confirmedToDelete={this.deleteSelectedPages}
          isDeleteCompletely={this.state.isDeleteCompletely}
          toggleDeleteCompletely={this.toggleDeleteCompletely}
        />
      </div>
    );
  }

}

/**
 * Wrapper component for using unstated
 */
const SearchPageWrapper = withUnstatedContainers(SearchPage, [AppContainer]);

SearchPage.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,

  query: PropTypes.object,
};
SearchPage.defaultProps = {
  // pollInterval: 1000,
  query: SearchPage.getQueryByLocation(window.location || {}),
};

export default withTranslation()(SearchPageWrapper);
