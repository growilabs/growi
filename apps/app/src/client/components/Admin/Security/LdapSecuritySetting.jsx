import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminLdapSecurityContainer from '~/client/services/AdminLdapSecurityContainer.js';
import { toastError } from '~/client/util/toastr.js';
import { toArrayIfNot } from '~/utils/array-utils.js';

import { withUnstatedContainers } from '../../UnstatedUtils.js';
import LdapSecuritySettingContents from './LdapSecuritySettingContents.js';

const LdapSecuritySetting = (props) => {
  const { adminLdapSecurityContainer } = props;

  const fetchLdapSecuritySettingsData = useCallback(async () => {
    try {
      await adminLdapSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminLdapSecurityContainer]);

  useEffect(() => {
    fetchLdapSecuritySettingsData();
  }, [fetchLdapSecuritySettingsData]);

  return <LdapSecuritySettingContents />;
};

LdapSecuritySetting.propTypes = {
  adminLdapSecurityContainer: PropTypes.instanceOf(AdminLdapSecurityContainer)
    .isRequired,
};

const LdapSecuritySettingWithUnstatedContainer = withUnstatedContainers(
  LdapSecuritySetting,
  [AdminLdapSecurityContainer],
);

export default LdapSecuritySettingWithUnstatedContainer;
