import React, { useCallback, useEffect } from 'react';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';

import { withUnstatedContainers } from '../../UnstatedUtils';
import SecurityManagementContents from './SecurityManagementContents';

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
