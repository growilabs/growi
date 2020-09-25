import React from 'react';
import PropTypes from 'prop-types';

import { withUnstatedContainers } from '../UnstatedUtils';
import AppContainer from '../../services/AppContainer';

import PaginationWrapper from '../PaginationWrapper';

import Page from '../PageList/Page';

class RecentCreated extends React.Component {

  constructor(props) {
    super(props);

    this.state = {
      pages: [],
      activePage: 1,
      totalPages: 0,
      pagingLimit: Infinity,
    };

    this.handlePage = this.handlePage.bind(this);
  }


  componentWillMount() {
    this.getRecentCreatedList(1);
  }

  async handlePage(selectedPage) {
    await this.getRecentCreatedList(selectedPage);
  }

  async getRecentCreatedList(selectPageNumber) {
    const { appContainer, userId } = this.props;

    // const userId = appContainer.currentUserId;
    const limit = appContainer.getConfig().pageListLimitForUserPage;
    const offset = (selectPageNumber - 1) * limit;

    // pagesList get and pagination calculate
    const res = await appContainer.apiv3Get(`/users/${userId}/recent`, { offset, limit });
    const { totalCount, pages } = res.data;

    this.setState({
      pages,
      activePage: selectPageNumber,
      totalPages: totalCount,
      pagingLimit: limit,
    });

  }

  /**
   * generate Elements of Page
   *
   * @param {any} pages Array of pages Model Obj
   *
   */
  generatePageList(pages) {
    return pages.map(page => (
      <li key={`recent-created:list-view:${page._id}`}>
        <Page page={page} />
      </li>
    ));
  }

  render() {
    const pageList = this.generatePageList(this.state.pages);

    return (
      <div className="page-list-container-create">
        <ul className="page-list-ul page-list-ul-flat mb-3">
          {pageList}
        </ul>
        <PaginationWrapper
          activePage={this.state.activePage}
          changePage={this.handlePage}
          totalItemsCount={this.state.totalPages}
          pagingLimit={this.state.pagingLimit}
        />
      </div>
    );
  }

}

/**
 * Wrapper component for using unstated
 */
const RecentCreatedWrapper = withUnstatedContainers(RecentCreated, [AppContainer]);

RecentCreated.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,

  userId: PropTypes.string.isRequired,
};

export default RecentCreatedWrapper;
