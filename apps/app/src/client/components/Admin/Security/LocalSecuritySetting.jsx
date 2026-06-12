import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminLocalSecurityContainer from '~/client/services/AdminLocalSecurityContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';

import { withUnstatedContainers } from '../../UnstatedUtils';
import LocalSecuritySettingContents from './LocalSecuritySettingContents';

const LocalSecuritySetting = (props) => {
  const { adminLocalSecurityContainer } = props;

  const fetchLocalSecuritySettingsData = useCallback(async () => {
    try {
      await adminLocalSecurityContainer.retrieveSecurityData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
    }
  }, [adminLocalSecurityContainer]);

  useEffect(() => {
    fetchLocalSecuritySettingsData();
  }, [fetchLocalSecuritySettingsData]);

  return <LocalSecuritySettingContents />;
};

LocalSecuritySetting.propTypes = {
  adminLocalSecurityContainer: PropTypes.instanceOf(AdminLocalSecurityContainer)
    .isRequired,
};

const LocalSecuritySettingWithUnstatedContainer = withUnstatedContainers(
  LocalSecuritySetting,
  [AdminLocalSecurityContainer],
);

export default LocalSecuritySettingWithUnstatedContainer;
