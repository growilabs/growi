import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminSamlSecurityContainer from '~/client/services/AdminSamlSecurityContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';

import { withUnstatedContainers } from '../../UnstatedUtils';
import SamlSecuritySettingContents from './SamlSecuritySettingContents';

const SamlSecurityManagement = (props) => {
  const { adminSamlSecurityContainer } = props;

  const fetchSamlSecuritySettingsData = useCallback(async () => {
    try {
      await adminSamlSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminSamlSecurityContainer]);

  useEffect(() => {
    fetchSamlSecuritySettingsData();
  }, [adminSamlSecurityContainer, fetchSamlSecuritySettingsData]);

  return <SamlSecuritySettingContents />;
};

SamlSecurityManagement.propTypes = {
  adminSamlSecurityContainer: PropTypes.instanceOf(AdminSamlSecurityContainer)
    .isRequired,
};

const SamlSecurityManagementWithUnstatedContainer = withUnstatedContainers(
  SamlSecurityManagement,
  [AdminSamlSecurityContainer],
);

export default SamlSecurityManagementWithUnstatedContainer;
