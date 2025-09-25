import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
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

  const onClickSubmit = useCallback(async() => {
    try {
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

          <div>
            <textarea
              className="form-control"
              name="customizeCss"
              rows={8}
              value={adminCustomizeContainer.state.currentCustomizeCss || ''}
              onChange={(e) => { adminCustomizeContainer.changeCustomizeCss(e.target.value) }}
            />
          </div>

          <AdminUpdateButtonRow onClick={onClickSubmit} disabled={adminCustomizeContainer.state.retrieveError != null} />
        </div>
      </div>
    </React.Fragment>
  );

};

const CustomizeCssSettingWrapper = withUnstatedContainers(CustomizeCssSetting, [AdminCustomizeContainer]);

export default CustomizeCssSettingWrapper;
