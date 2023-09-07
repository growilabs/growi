import React, { useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import { PrismAsyncLight } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Card, CardBody } from 'reactstrap';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

type Props = {
  adminCustomizeContainer: AdminCustomizeContainer
}

const CustomizeScriptSetting = (props: Props): JSX.Element => {

  const { adminCustomizeContainer } = props;
  const { t } = useTranslation();

  const onClickSubmit = useCallback(async() => {
    try {
      await adminCustomizeContainer.updateCustomizeScript();
      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.custom_script'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminCustomizeContainer]);

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <h2 className="admin-setting-header">{t('admin:customize_settings.custom_script')}</h2>
          <Card className="card custom-card">
            <CardBody className="px-0 py-2">
              {t('admin:customize_settings.write_java')}<br />
              {t('admin:customize_settings.reflect_change')}
            </CardBody>
          </Card>

          <div>
            <textarea
              className="form-control"
              name="customizeScript"
              rows={8}
              defaultValue={adminCustomizeContainer.state.currentCustomizeScript || ''}
              onChange={(e) => { adminCustomizeContainer.changeCustomizeScript(e.target.value) }}
            />
            {/* disabled in v6.0.0 temporarily -- 2022.12.19 Yuki Takei
            <span className="form-text text-muted text-end">
              <i className="fa fa-fw fa-keyboard-o" aria-hidden="true" />
              {t('admin:customize_settings.ctrl_space')}
            </span>
            */}
          </div>

          <a
            className="text-muted"
            data-bs-toggle="collapse"
            href="#collapseExampleScript"
            role="button"
            aria-expanded="false"
            aria-controls="collapseExampleScript"
          >
            <i className="fa fa-fw fa-chevron-right" aria-hidden="true"></i>
            Example for Google Tag Manager
          </a>
          <div className="collapse" id="collapseExampleScript">
            <PrismAsyncLight
              style={oneDark}
              language="javascript"
            >
              {`(function(w,d,s,l,i){
w[l]=w[l]||[];
w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),
  dl=l!='dataLayer'?'&l='+l:'';
j.async=true;
j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXX');`}
            </PrismAsyncLight>
          </div>

          <AdminUpdateButtonRow onClick={onClickSubmit} disabled={adminCustomizeContainer.state.retrieveError != null} />
        </div>
      </div>
    </React.Fragment>
  );

};

const CustomizeScriptSettingWrapper = withUnstatedContainers(CustomizeScriptSetting, [AdminCustomizeContainer]);

export default CustomizeScriptSettingWrapper;
