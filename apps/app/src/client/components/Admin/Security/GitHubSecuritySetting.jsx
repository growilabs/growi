import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import { toArrayIfNot } from '~/utils/array-utils';

import AdminGitHubSecurityContainer from '../../../services/AdminGitHubSecurityContainer';
import { toastError } from '../../../util/toastr';
import { withUnstatedContainers } from '../../UnstatedUtils';
import GitHubSecuritySettingContents from './GitHubSecuritySettingContents';

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
