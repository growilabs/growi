import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminSamlSecurityContainer from '~/client/services/AdminSamlSecurityContainer.js';
import { toastError } from '~/client/util/toastr.js';
import { toArrayIfNot } from '~/utils/array-utils.js';

import { withUnstatedContainers } from '../../UnstatedUtils.js';
import SamlSecuritySettingContents from './SamlSecuritySettingContents.js';

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
  }, [fetchSamlSecuritySettingsData]);

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
