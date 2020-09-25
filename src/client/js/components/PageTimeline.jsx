import React from 'react';
import PropTypes from 'prop-types';

import { withTranslation } from 'react-i18next';

import AppContainer from '../services/AppContainer';
import PageContainer from '../services/PageContainer';
import PaginationWrapper from './PaginationWrapper';
import { withUnstatedContainers } from './UnstatedUtils';

import RevisionLoader from './Page/RevisionLoader';


class PageTimeline extends React.Component {

  constructor(props) {
    super(props);

    const { appContainer } = this.props;
    // TODO add paging size (limit) for modal
    this.state = {
      activePage: 1,
      totalPageItems: 0,
      limit: appContainer.getConfig().recentCreatedLimit,

      // TODO: remove after when timeline is implemented with React and inject data with props
      pages: this.props.pages,
    };

    this.handlePage = this.handlePage.bind(this);
  }


  async handlePage(selectedPage) {
    const { appContainer, pageContainer } = this.props;
    const { path } = pageContainer.state;
    const { limit } = this.state;
    const offset = (selectedPage - 1) * limit;
    const activePage = selectedPage;

    const res = await appContainer.apiv3Get('/pages/list', { path, limit, offset });
    const totalPageItems = res.data.totalCount;
    const pages = res.data.pages;
    this.setState({
      activePage,
      totalPageItems,
      pages,
    });
  }

  componentWillMount() {
    const { appContainer } = this.props;
    // initialize GrowiRenderer
    this.growiRenderer = appContainer.getRenderer('timeline');
  }

  async componentDidMount() {
    await this.handlePage(1);
    this.setState({
      activePage: 1,
    });
  }

  render() {
    const { pages } = this.state;
    if (pages == null) {
      return <React.Fragment></React.Fragment>;
    }

    return (
      <div>
        { pages.map((page) => {
          return (
            <div className="timeline-body" key={`key-${page.id}`}>
              <div className="card card-timeline">
                <div className="card-header"><a href={page.path}>{page.path}</a></div>
                <div className="card-body">
                  <RevisionLoader
                    lazy
                    growiRenderer={this.growiRenderer}
                    pageId={page.id}
                    revisionId={page.revision}
                  />
                </div>
              </div>
            </div>
          );
        }) }
        <PaginationWrapper
          activePage={this.state.activePage}
          changePage={this.handlePage}
          totalItemsCount={this.state.totalPageItems}
          pagingLimit={this.state.limit}
          align="center"
        />
      </div>
    );

  }

}

/**
 * Wrapper component for using unstated
 */
const PageTimelineWrapper = withUnstatedContainers(PageTimeline, [AppContainer, PageContainer]);

PageTimeline.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  pageContainer: PropTypes.instanceOf(PageContainer).isRequired,
  pages: PropTypes.arrayOf(PropTypes.object),
};

export default withTranslation()(PageTimelineWrapper);
