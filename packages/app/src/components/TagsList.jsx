import React from 'react';
import PropTypes from 'prop-types';

import { withTranslation } from 'react-i18next';

import PaginationWrapper from './PaginationWrapper';
import TagCloudBox from './TagCloudBox';
import { apiGet } from '../client/util/apiv1-client';
import { toastError } from '../client/util/apiNotification';

class TagsList extends React.Component {

  constructor(props) {
    super(props);

    this.state = {
      tagData: [],
      activePage: 1,
      totalTags: 0,
      pagingLimit: 10,
    };

    this.handlePage = this.handlePage.bind(this);
    this.getTagList = this.getTagList.bind(this);
  }

  async componentWillMount() {
    await this.getTagList(1);
  }

  async componentDidUpdate() {
    if (this.props.isOnReload) {
      await this.getTagList(this.state.activePage);
    }
  }

  async handlePage(selectedPage) {
    await this.getTagList(selectedPage);
  }

  async getTagList(selectPageNumber) {
    const limit = this.state.pagingLimit;
    const offset = (selectPageNumber - 1) * limit;
    let res;

    try {
      res = await apiGet('/tags.list', { limit, offset });
    }
    catch (error) {
      toastError(error);
    }

    const totalTags = res.totalCount;
    const tagData = res.data;
    const activePage = selectPageNumber;

    this.setState({
      tagData,
      activePage,
      totalTags,
    });
  }

  /**
   * generate Elements of Tag
   *
   * @param {any} pages Array of pages Model Obj
   *
   */
  generateTagList(tagData) {
    return tagData.map((data) => {
      return (
        <a key={data.name} href={`/_search?q=tag:${data.name}`} className="list-group-item">
          <i className="icon-tag mr-2"></i>{data.name}
          <span className="ml-4 list-tag-count badge badge-secondary text-muted">{data.count}</span>
        </a>
      );
    });
  }

  render() {
    const { t } = this.props;
    const messageForNoTag = this.state.tagData.length ? null : <h3>{ t('You have no tag, You can set tags on pages') }</h3>;

    return (
      <>
        <header className="py-0">
          <h1 className="title text-center mt-5 mb-3 font-weight-bold">{`${t('Tags')}(${this.state.totalTags})`}</h1>
        </header>
        <div className="row text-center">
          <div className="col-12 mb-5 px-5">
            <TagCloudBox tags={this.state.tagData} minSize={20} />
          </div>
          <div className="col-12 tag-list mb-4">
            <ul className="list-group text-left">
              {this.generateTagList(this.state.tagData)}
            </ul>
            {messageForNoTag}
          </div>
          <div className="col-12 tag-list-pagination">
            <PaginationWrapper
              activePage={this.state.activePage}
              changePage={this.handlePage}
              totalItemsCount={this.state.totalTags}
              pagingLimit={this.state.pagingLimit}
              align="center"
              size="md"
            />
          </div>
        </div>
      </>
    );
  }

}

TagsList.propTypes = {
  isOnReload: PropTypes.bool,
  t: PropTypes.func.isRequired, // i18next
};

TagsList.defaultProps = {
  isOnReload: false,
};

export default withTranslation()(TagsList);
