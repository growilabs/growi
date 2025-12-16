import React, { useCallback, useEffect } from 'react';

import { useTranslation, i18n } from 'next-i18next';
import PropTypes from 'prop-types';
import { useForm } from 'react-hook-form';

import { i18n as i18nConfig } from '^/config/next-i18next.config';

import AdminAppContainer from '~/client/services/AdminAppContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';


import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

const logger = loggerFactory('growi:appSettings');


const AppSetting = (props) => {
  const { adminAppContainer } = props;
  const { t } = useTranslation(['admin', 'commons']);

  const {
    register,
    handleSubmit,
    reset,
  } = useForm();

  // Reset form when adminAppContainer state changes (e.g., after reload)
  useEffect(() => {
    reset({
      title: adminAppContainer.state.title || '',
      confidential: adminAppContainer.state.confidential || '',
      globalLang: adminAppContainer.state.globalLang || 'en-US',
      // Convert boolean to string for radio button value
      isEmailPublishedForNewUser: String(adminAppContainer.state.isEmailPublishedForNewUser ?? true),
      isReadOnlyForNewUser: adminAppContainer.state.isReadOnlyForNewUser ?? false,
      fileUpload: adminAppContainer.state.fileUpload ?? false,
    });
  }, [
    adminAppContainer.state.title,
    adminAppContainer.state.confidential,
    adminAppContainer.state.globalLang,
    adminAppContainer.state.isEmailPublishedForNewUser,
    adminAppContainer.state.isReadOnlyForNewUser,
    adminAppContainer.state.fileUpload,
    reset,
  ]);

  const onSubmit = useCallback(async(data) => {
    try {
      // Await all setState completions before API call
      await Promise.all([
        adminAppContainer.changeTitle(data.title),
        adminAppContainer.changeConfidential(data.confidential),
        adminAppContainer.changeGlobalLang(data.globalLang),
      ]);
      // Convert string 'true'/'false' to boolean
      const isEmailPublished = data.isEmailPublishedForNewUser === 'true' || data.isEmailPublishedForNewUser === true;
      await adminAppContainer.changeIsEmailPublishedForNewUserShow(isEmailPublished);
      await adminAppContainer.changeIsReadOnlyForNewUserShow(data.isReadOnlyForNewUser);
      await adminAppContainer.changeFileUpload(data.fileUpload);

      await adminAppContainer.updateAppSettingHandler();
      toastSuccess(t('commons:toaster.update_successed', { target: t('commons:headers.app_settings') }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [adminAppContainer, t]);


  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">{t('admin:app_setting.site_name')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder="GROWI"
            {...register('title')}
          />
          <p className="form-text text-muted">{t('admin:app_setting.sitename_change')}</p>
        </div>
      </div>

      <div className="row mb-5">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
        >
          {t('admin:app_setting.confidential_name')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={t('admin:app_setting.confidential_example')}
            {...register('confidential')}
          />
          <p className="form-text text-muted">{t('admin:app_setting.header_content')}</p>
        </div>
      </div>

      <div className="row mb-5">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
        >
          {t('admin:app_setting.default_language')}
        </label>
        <div className="col-md-6 py-2">
          {
            i18nConfig.locales.map((locale) => {
              if (i18n == null) { return }
              const fixedT = i18n.getFixedT(locale, 'admin');

              return (
                <div key={locale} className="form-check form-check-inline">
                  <input
                    type="radio"
                    id={`radioLang${locale}`}
                    className="form-check-input"
                    value={locale}
                    {...register('globalLang')}
                  />
                  <label className="form-label form-check-label" htmlFor={`radioLang${locale}`}>{fixedT('meta.display_name')}</label>
                </div>
              );
            })
          }
        </div>
      </div>

      <div className="row mb-5">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
        >
          {t('admin:app_setting.default_mail_visibility')}
        </label>
        <div className="col-md-6 py-2">

          <div className="form-check form-check-inline">
            <input
              type="radio"
              id="radio-email-show"
              className="form-check-input"
              value="true"
              {...register('isEmailPublishedForNewUser')}
            />
            <label className="form-label form-check-label" htmlFor="radio-email-show">{t('commons:Show')}</label>
          </div>

          <div className="form-check form-check-inline">
            <input
              type="radio"
              id="radio-email-hide"
              className="form-check-input"
              value="false"
              {...register('isEmailPublishedForNewUser')}
            />
            <label className="form-label form-check-label" htmlFor="radio-email-hide">{t('commons:Hide')}</label>
          </div>

        </div>
      </div>

      <div className="row mb-5">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
        >
          {t('admin:app_setting.default_read_only_for_new_user')}
        </label>
        <div className="col-md-6 py-2">

          <div className="form-check form-check-inline">
            <input
              type="checkbox"
              id="checkbox-read-only-for-new-user"
              className="form-check-input"
              {...register('isReadOnlyForNewUser')}
            />
            <label className="form-label form-check-label" htmlFor="checkbox-read-only-for-new-user">{t('admin:app_setting.set_read_only_for_new_user')}</label>
          </div>
        </div>
      </div>

      <div className="row mb-2">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
        >
          {/* {t('admin:app_setting.file_uploading')} */}
        </label>
        <div className="col-md-6">
          <div className="form-check form-check-info">
            <input
              type="checkbox"
              id="cbFileUpload"
              className="form-check-input"
              {...register('fileUpload')}
            />
            <label
              className="form-label form-check-label"
              htmlFor="cbFileUpload"
            >
              {t('admin:app_setting.enable_files_except_image')}
            </label>
          </div>

          <p className="form-text text-muted">
            {t('admin:app_setting.attach_enable')}
          </p>
        </div>
      </div>

      <AdminUpdateButtonRow type="submit" disabled={adminAppContainer.state.retrieveError != null} />
    </form>
  );

};


/**
 * Wrapper component for using unstated
 */
const AppSettingWrapper = withUnstatedContainers(AppSetting, [AdminAppContainer]);

AppSetting.propTypes = {
  adminAppContainer: PropTypes.instanceOf(AdminAppContainer).isRequired,
};


export default AppSettingWrapper;
