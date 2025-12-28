import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminLdapSecurityContainer from '~/client/services/AdminLdapSecurityContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';

import { withUnstatedContainers } from '../../UnstatedUtils';
import LdapSecuritySettingContents from './LdapSecuritySettingContents';

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
  }, [adminLdapSecurityContainer, fetchLdapSecuritySettingsData]);

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
