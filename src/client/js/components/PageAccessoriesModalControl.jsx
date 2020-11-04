import React from 'react';
import PropTypes from 'prop-types';

import { withTranslation } from 'react-i18next';

import { UncontrolledTooltip } from 'reactstrap';
import PageAccessoriesContainer from '../services/PageAccessoriesContainer';

import PageListIcon from './Icons/PageListIcon';
import TimeLineIcon from './Icons/TimeLineIcon';
import HistoryIcon from './Icons/HistoryIcon';
import AttachmentIcon from './Icons/AttachmentIcon';
import ShareLinkIcon from './Icons/ShareLinkIcon';

import { withUnstatedContainers } from './UnstatedUtils';

const PageAccessoriesModalControl = (props) => {
  const { t, pageAccessoriesContainer, isGuestUserMode } = props;

  return (
    <div className="top-of-table-contents d-flex align-items-end pb-1">
      <button
        type="button"
        className="btn btn-link grw-btn-top-of-table"
        onClick={() => pageAccessoriesContainer.openPageAccessoriesModal('pagelist')}
      >
        <PageListIcon />
      </button>

      <button
        type="button"
        className="btn btn-link grw-btn-top-of-table"
        onClick={() => pageAccessoriesContainer.openPageAccessoriesModal('timeline')}
      >
        <TimeLineIcon />
      </button>

      <button
        type="button"
        className="btn btn-link grw-btn-top-of-table"
        onClick={() => pageAccessoriesContainer.openPageAccessoriesModal('pageHistory')}
      >
        <HistoryIcon />
      </button>

      <button
        type="button"
        className="btn btn-link grw-btn-top-of-table"
        onClick={() => pageAccessoriesContainer.openPageAccessoriesModal('attachment')}
      >
        <AttachmentIcon />
      </button>

      <div id="shareLink-btn-wrapper-for-tooltip">
        <button
          type="button"
          className={`btn btn-link grw-btn-top-of-table ${isGuestUserMode && 'disabled'}`}
          onClick={() => pageAccessoriesContainer.openPageAccessoriesModal('shareLink')}
        >
          <ShareLinkIcon />
        </button>
      </div>
      {isGuestUserMode && (
        <UncontrolledTooltip placement="top" target="shareLink-btn-wrapper-for-tooltip" fade={false}>
          {t('Not available for guest')}
        </UncontrolledTooltip>
      )}
      <div
        id="seen-user-list"
        data-user-ids-str="{{ page.seenUsers|slice(-15)|default([])|reverse|join(',') }}"
        data-sum-of-seen-users="{{ page.seenUsers.length|default(0) }}"
        className="grw-seen-user-list ml-1 pl-1"
      >
      </div>
    </div>
  );
};
/**
 * Wrapper component for using unstated
 */
const PageAccessoriesModalControlWrapper = withUnstatedContainers(PageAccessoriesModalControl, [PageAccessoriesContainer]);

PageAccessoriesModalControl.propTypes = {
  t: PropTypes.func.isRequired, //  i18next

  pageAccessoriesContainer: PropTypes.instanceOf(PageAccessoriesContainer).isRequired,

  isGuestUserMode: PropTypes.bool.isRequired,
};

export default withTranslation()(PageAccessoriesModalControlWrapper);
