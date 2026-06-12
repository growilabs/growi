import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminOidcSecurityContainer from '~/client/services/AdminOidcSecurityContainer.js';
import { toastError } from '~/client/util/toastr.js';
import { toArrayIfNot } from '~/utils/array-utils.js';

import { withUnstatedContainers } from '../../UnstatedUtils.js';
import OidcSecurityManagementContents from './OidcSecuritySettingContents.js';

const OidcSecurityManagement = (props) => {
  const { adminOidcSecurityContainer } = props;

  const fetchOidcSecuritySettingsData = useCallback(async () => {
    try {
      await adminOidcSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminOidcSecurityContainer]);

  useEffect(() => {
    fetchOidcSecuritySettingsData();
  }, [fetchOidcSecuritySettingsData]);

  return <OidcSecurityManagementContents />;
};

OidcSecurityManagement.propTypes = {
  adminOidcSecurityContainer: PropTypes.instanceOf(AdminOidcSecurityContainer)
    .isRequired,
};

const OidcSecurityManagementWithUnstatedContainer = withUnstatedContainers(
  OidcSecurityManagement,
  [AdminOidcSecurityContainer],
);

export default OidcSecurityManagementWithUnstatedContainer;
