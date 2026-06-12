import React, { useCallback, useEffect } from 'react';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer.js';
import { toastError } from '~/client/util/toastr.js';
import { toArrayIfNot } from '~/utils/array-utils.js';

import { withUnstatedContainers } from '../../UnstatedUtils.js';
import SecurityManagementContents from './SecurityManagementContents.js';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
};

const SecurityManagement = (props: Props) => {
  const { adminGeneralSecurityContainer } = props;

  const fetchGeneralSecuritySettingsData = useCallback(async () => {
    try {
      await adminGeneralSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminGeneralSecurityContainer]);

  useEffect(() => {
    fetchGeneralSecuritySettingsData();
  }, [fetchGeneralSecuritySettingsData]);

  return <SecurityManagementContents />;
};

const SecurityManagementWithUnstatedContainer = withUnstatedContainers(
  SecurityManagement,
  [AdminGeneralSecurityContainer],
);

export default SecurityManagementWithUnstatedContainer;
