import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import { toArrayIfNot } from '~/utils/array-utils';

import AdminLocalSecurityContainer from '../../../services/AdminLocalSecurityContainer';
import { toastError } from '../../../util/toastr';
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
