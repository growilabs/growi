import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer.js';
import { toastError } from '~/client/util/toastr.js';
import { toArrayIfNot } from '~/utils/array-utils.js';
import loggerFactory from '~/utils/logger/index.js';

import { withUnstatedContainers } from '../../UnstatedUtils.js';
import CustomizeCssSetting from './CustomizeCssSetting.js';
import CustomizeFunctionSetting from './CustomizeFunctionSetting.js';
import CustomizeLayoutSetting from './CustomizeLayoutSetting.js';
import CustomizeLogoSetting from './CustomizeLogoSetting.js';
import CustomizeNoscriptSetting from './CustomizeNoscriptSetting.js';
import CustomizePresentationSetting from './CustomizePresentationSetting.js';
import CustomizeScriptSetting from './CustomizeScriptSetting.js';
import CustomizeSidebarSetting from './CustomizeSidebarSetting.js';
import CustomizeThemeSetting from './CustomizeThemeSetting.js';
import { CustomizeTitle } from './CustomizeTitle.js';

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
