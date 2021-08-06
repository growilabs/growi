import React from 'react';
import PropTypes from 'prop-types';

import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastError } from '~/client/util/apiNotification';
import { toArrayIfNot } from '~/utils/array-utils';
import { withLoadingSppiner } from '../../SuspenseUtils';

import MarkDownSettingContents from './MarkDownSettingContents';
import AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';

const logger = loggerFactory('growi:MarkDown');

let retrieveErrors = null;
function MarkdownSetting(props) {
  const { adminMarkDownContainer } = props;

  if (adminMarkDownContainer.state.isEnabledLinebreaks === adminMarkDownContainer.dummyIsEnabledLinebreaks) {
    throw (async() => {
      try {
        await adminMarkDownContainer.retrieveMarkdownData();
      }
      catch (err) {
        const errs = toArrayIfNot(err);
        toastError(errs);
        logger.error(errs);
        retrieveErrors = errs;
        adminMarkDownContainer.setState({ isEnabledLinebreaks: adminMarkDownContainer.dummyIsEnabledLinebreaksForError });
      }
    })();
  }

  if (adminMarkDownContainer.state.isEnabledLinebreaks === adminMarkDownContainer.dummyIsEnabledLinebreaksForError) {
    throw new Error(`${retrieveErrors.length} errors occured`);
  }

  return <MarkDownSettingContents />;
}

const MarkdownSettingWithUnstatedContainer = withUnstatedContainers(withLoadingSppiner(MarkdownSetting), [AdminMarkDownContainer]);

MarkdownSetting.propTypes = {
  adminMarkDownContainer: PropTypes.instanceOf(AdminMarkDownContainer).isRequired,
};

export default MarkdownSettingWithUnstatedContainer;
