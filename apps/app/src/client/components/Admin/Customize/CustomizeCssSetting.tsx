import React, { useCallback, useEffect, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import { Card, CardBody } from 'reactstrap';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

type Props = {
  adminCustomizeContainer: AdminCustomizeContainer
}

const CustomizeCssSetting = (props: Props): JSX.Element => {

  const { adminCustomizeContainer } = props;
  const { t } = useTranslation();

  const {
    register,
    handleSubmit,
    reset,
  } = useForm();

  // Sync form with container state
  useEffect(() => {
    reset({
      customizeCss: adminCustomizeContainer.state.currentCustomizeCss || '',
    });
  }, [adminCustomizeContainer.state.currentCustomizeCss, reset]);

  const onSubmit = useCallback(async(data) => {
    try {
      // Update container state before API call
      await adminCustomizeContainer.changeCustomizeCss(data.customizeCss);
      await adminCustomizeContainer.updateCustomizeCss();
      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.custom_css'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminCustomizeContainer]);

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <h2 className="admin-setting-header">{t('admin:customize_settings.custom_css')}</h2>

          <Card className="card custom-card bg-body-tertiary my-3">
            <CardBody className="px-0 py-2">
              { t('admin:customize_settings.write_css') }<br />
              { t('admin:customize_settings.reflect_change') }
            </CardBody>
          </Card>

          <form onSubmit={handleSubmit(onSubmit)}>
            <div>
              <textarea
                className="form-control"
                rows={8}
                {...register('customizeCss')}
              />
            </div>

            <AdminUpdateButtonRow type="submit" disabled={adminCustomizeContainer.state.retrieveError != null} />
          </form>
        </div>
      </div>
    </React.Fragment>
  );

};

const CustomizeCssSettingWrapper = withUnstatedContainers(CustomizeCssSetting, [AdminCustomizeContainer]);

export default CustomizeCssSettingWrapper;
