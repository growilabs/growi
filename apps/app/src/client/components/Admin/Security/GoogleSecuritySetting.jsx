import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminGoogleSecurityContainer from '~/client/services/AdminGoogleSecurityContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';

import { withUnstatedContainers } from '../../UnstatedUtils';
import GoogleSecurityManagementContents from './GoogleSecuritySettingContents';

const GoogleSecurityManagement = (props) => {
  const { adminGoogleSecurityContainer } = props;

  const fetchGoogleSecuritySettingsData = useCallback(async () => {
    try {
      await adminGoogleSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminGoogleSecurityContainer]);

  useEffect(() => {
    fetchGoogleSecuritySettingsData();
  }, [adminGoogleSecurityContainer, fetchGoogleSecuritySettingsData]);

  return <GoogleSecurityManagementContents />;
};

GoogleSecurityManagement.propTypes = {
  adminGoogleSecurityContainer: PropTypes.instanceOf(
    AdminGoogleSecurityContainer,
  ).isRequired,
};

const GoogleSecurityManagementWithUnstatedContainer = withUnstatedContainers(
  GoogleSecurityManagement,
  [AdminGoogleSecurityContainer],
);

export default GoogleSecurityManagementWithUnstatedContainer;
