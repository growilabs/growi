import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import CustomizeCssSetting from './CustomizeCssSetting';
import CustomizeFunctionSetting from './CustomizeFunctionSetting';
import CustomizeLayoutSetting from './CustomizeLayoutSetting';
import CustomizeLogoSetting from './CustomizeLogoSetting';
import CustomizeNoscriptSetting from './CustomizeNoscriptSetting';
import CustomizePresentationSetting from './CustomizePresentationSetting';
import CustomizeScriptSetting from './CustomizeScriptSetting';
import CustomizeSidebarSetting from './CustomizeSidebarSetting';
import CustomizeThemeSetting from './CustomizeThemeSetting';
import { CustomizeTitle } from './CustomizeTitle';

const logger = loggerFactory('growi:services:AdminCustomizePage');

function Customize(props) {
  const { adminCustomizeContainer } = props;

  const fetchCustomizeSettingsData = useCallback(async () => {
    try {
      await adminCustomizeContainer.retrieveCustomizeData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
      logger.error(errs);
    }
  }, [adminCustomizeContainer]);

  useEffect(() => {
    fetchCustomizeSettingsData();
  }, [fetchCustomizeSettingsData]);

  return (
    <div data-testid="admin-customize">
      <div className="mb-5">
        <CustomizeThemeSetting />
      </div>
      <div className="mb-5">
        <CustomizeLogoSetting />
      </div>
      <div className="mb-5">
        <CustomizeLayoutSetting />
      </div>
      <div className="mb-5">
        <CustomizeSidebarSetting />
      </div>
      <div className="mb-5">
        <CustomizeFunctionSetting />
      </div>
      <div className="mb-5">
        <CustomizePresentationSetting />
      </div>
      <div className="mb-5">
        <CustomizeTitle />
      </div>
      <div className="mb-5">
        <CustomizeScriptSetting />
      </div>
      <div className="mb-5">
        <CustomizeCssSetting />
      </div>
      <div className="mb-5">
        <CustomizeNoscriptSetting />
      </div>
    </div>
  );
}

const CustomizePageWithUnstatedContainer = withUnstatedContainers(Customize, [
  AdminCustomizeContainer,
]);

Customize.propTypes = {
  adminCustomizeContainer: PropTypes.instanceOf(AdminCustomizeContainer)
    .isRequired,
};

export default CustomizePageWithUnstatedContainer;
