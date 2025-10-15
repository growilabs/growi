import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import AdminAppContainer from '~/client/services/AdminAppContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

const logger = loggerFactory('growi:appSettings');


type Props = {
  adminAppContainer: AdminAppContainer,
}

const SiteUrlSetting = (props: Props) => {
  const { t } = useTranslation('admin', { keyPrefix: 'app_setting' });
  const { t: tCommon } = useTranslation('commons');
  const { adminAppContainer } = props;

  const {
    register,
    handleSubmit,
    reset,
  } = useForm();

  // Reset form when adminAppContainer state changes
  useEffect(() => {
    reset({
      siteUrl: adminAppContainer.state.siteUrl || '',
    });
  }, [adminAppContainer.state.siteUrl, reset]);

  const onSubmit = useCallback(async(data) => {
    try {
      // Await setState completion before API call
      await adminAppContainer.changeSiteUrl(data.siteUrl);
      await adminAppContainer.updateSiteUrlSettingHandler();
      toastSuccess(tCommon('toaster.update_successed', { target: t('site_url.title') }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [adminAppContainer, t, tCommon]);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <p className="card custom-card bg-body-tertiary">{t('site_url.desc')}</p>
      {!adminAppContainer.state.isSetSiteUrl
          && (<p className="alert alert-danger"><span className="material-symbols-outlined">error</span> {t('site_url.warn')}</p>)}

      { adminAppContainer.state.siteUrlUseOnlyEnvVars && (
        <div className="row">
          <p
            className="alert alert-info"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: t('site_url.note_for_the_only_env_option', { env: 'APP_SITE_URL_USES_ONLY_ENV_VARS' }),
            }}
          />
        </div>
      ) }

      <div className="row">
        <table className="table settings-table">
          <colgroup>
            <col className="from-db" />
            <col className="from-env-vars" />
          </colgroup>
          <thead>
            <tr>
              <th>Database</th>
              <th>Environment variables</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input
                  className="form-control"
                  type="text"
                  readOnly={adminAppContainer.state.siteUrlUseOnlyEnvVars ?? true}
                  placeholder="e.g. https://my.growi.org"
                  {...register('siteUrl')}
                />
                <p className="form-text text-muted">
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('site_url.help') }} />
                </p>
              </td>
              <td>
                <input className="form-control" type="text" value={adminAppContainer.state.envSiteUrl || ''} readOnly />
                <p className="form-text text-muted">
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('use_env_var_if_empty', { variable: 'APP_SITE_URL' }) }} />
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AdminUpdateButtonRow type="submit" disabled={adminAppContainer.state.retrieveError != null} />
    </form>
  );
};

/**
 * Wrapper component for using unstated
 */
const SiteUrlSettingWrapper = withUnstatedContainers(SiteUrlSetting, [AdminAppContainer]);

export default SiteUrlSettingWrapper;
