import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminGitHubSecurityContainer from '~/client/services/AdminGitHubSecurityContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';

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
  }, [adminGitHubSecurityContainer, fetchGitHubSecuritySettingsData]);

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
