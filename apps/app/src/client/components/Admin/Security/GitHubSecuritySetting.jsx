import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminGitHubSecurityContainer from '~/client/services/AdminGitHubSecurityContainer.js';
import { toastError } from '~/client/util/toastr.js';
import { toArrayIfNot } from '~/utils/array-utils.js';

import { withUnstatedContainers } from '../../UnstatedUtils.js';
import GitHubSecuritySettingContents from './GitHubSecuritySettingContents.js';

const GitHubSecurityManagement = (props) => {
  const { adminGitHubSecurityContainer } = props;

  const fetchGitHubSecuritySettingsData = useCallback(async () => {
    try {
      await adminGitHubSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminGitHubSecurityContainer]);

  useEffect(() => {
    fetchGitHubSecuritySettingsData();
  }, [fetchGitHubSecuritySettingsData]);

  return <GitHubSecuritySettingContents />;
};

GitHubSecurityManagement.propTypes = {
  adminGitHubSecurityContainer: PropTypes.instanceOf(
    AdminGitHubSecurityContainer,
  ).isRequired,
};

const GitHubSecurityManagementWithUnstatedContainer = withUnstatedContainers(
  GitHubSecurityManagement,
  [AdminGitHubSecurityContainer],
);

export default GitHubSecurityManagementWithUnstatedContainer;
