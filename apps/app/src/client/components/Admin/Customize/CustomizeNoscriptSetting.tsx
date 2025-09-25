import React, { useCallback, type JSX } from 'react';

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

const CustomizeNoscriptSetting = (props: Props): JSX.Element => {

  const { adminCustomizeContainer } = props;
  const { t } = useTranslation();

  const onClickSubmit = useCallback(async() => {
    try {
      await adminCustomizeContainer.updateCustomizeNoscript();
      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.custom_noscript'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminCustomizeContainer]);

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <h2 className="admin-setting-header">{t('admin:customize_settings.custom_noscript')}</h2>

          <Card className="card custom-card bg-body-tertiary my-3">
            <CardBody className="px-0 py-2">
              <span
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: t('admin:customize_settings.custom_noscript_detail') }}
              />
            </CardBody>
          </Card>

          <div>
            <textarea
              className="form-control mb-2"
              name="customizeNoscript"
              rows={8}
              value={adminCustomizeContainer.state.currentCustomizeNoscript || ''}
              onChange={(e) => { adminCustomizeContainer.changeCustomizeNoscript(e.target.value) }}
            />
          </div>

          <a
            className="text-muted"
            data-bs-toggle="collapse"
            href="#collapseExampleHtml"
            role="button"
            aria-expanded="false"
            aria-controls="collapseExampleHtml"
          >
            <span className="material-symbols-outlined me-1" aria-hidden="true">navigate_next</span>
            Example for Google Tag Manager
          </a>
          <div className="collapse" id="collapseExampleHtml">
            <PrismAsyncLight
              style={oneDark}
              language="javascript"
            >
              {`<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
  height="0"
  width="0"
  style="display:none;visibility:hidden"></iframe>`}
            </PrismAsyncLight>
          </div>

          <AdminUpdateButtonRow onClick={onClickSubmit} disabled={adminCustomizeContainer.state.retrieveError != null} />
        </div>
      </div>
    </React.Fragment>
  );

};

const CustomizeNoscriptSettingWrapper = withUnstatedContainers(CustomizeNoscriptSetting, [AdminCustomizeContainer]);

export default CustomizeNoscriptSettingWrapper;
