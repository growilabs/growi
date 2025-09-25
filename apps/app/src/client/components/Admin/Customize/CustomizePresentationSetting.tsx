import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import CustomizePresentationOption from './CustomizeFunctionOption';

type Props = {
  adminCustomizeContainer: AdminCustomizeContainer
}

const CustomizePresentationSetting = (props: Props): JSX.Element => {
  const { adminCustomizeContainer } = props;
  const { t } = useTranslation();

  const onClickSubmit = useCallback(async() => {
    try {
      await adminCustomizeContainer.updateCustomizePresentation();
      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.presentation'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminCustomizeContainer, t]);

  return (
    <React.Fragment>
      <h2 className="admin-setting-header">{t('admin:customize_settings.custom_presentation')}</h2>
      <div className="form-group row">
        <div className="offset-md-3 col-md-6 text-left">
          <CustomizePresentationOption
            optionId="isEnabledMarp"
            label={t('admin:customize_settings.presentation_options.enable_marp')}
            isChecked={adminCustomizeContainer?.state.isEnabledMarp || false}
            onChecked={() => { adminCustomizeContainer.switchIsEnabledMarp() }}
          >
            <p className="form-text text-muted">
              {t('admin:customize_settings.presentation_options.enable_marp_desc')}
              <br></br>
              <a
                href={`${t('admin:customize_settings.presentation_options.marp_official_site_link')}`}
                target="_blank"
                rel="noopener noreferrer"
              >{`${t('admin:customize_settings.presentation_options.marp_official_site')}`}
              </a>
              <br></br>
              <a
                href={`${t('admin:customize_settings.presentation_options.marp_in_gorwi_link')}`}
                target="_blank"
                rel="noopener noreferrer"
              >{`${t('admin:customize_settings.presentation_options.marp_in_growi')}`}
              </a>
            </p>
          </CustomizePresentationOption>
        </div>
      </div>

      <AdminUpdateButtonRow onClick={onClickSubmit} disabled={adminCustomizeContainer.state.retrieveError != null} />
    </React.Fragment>
  );
};
const CustomizePresentationSettingWrapper = withUnstatedContainers(CustomizePresentationSetting, [AdminCustomizeContainer]);

export default CustomizePresentationSettingWrapper;
