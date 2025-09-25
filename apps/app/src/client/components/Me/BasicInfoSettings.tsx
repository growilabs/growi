import React, { type JSX } from 'react';

import { useTranslation, i18n } from 'next-i18next';

import { i18n as i18nConfig } from '^/config/next-i18next.config';

import { toastSuccess, toastError } from '~/client/util/toastr';
import { useRegistrationWhitelist } from '~/stores-universal/context';
import { usePersonalSettings } from '~/stores/personal-settings';

export const BasicInfoSettings = (): JSX.Element => {
  const { t } = useTranslation();
  const { data: registrationWhitelist } = useRegistrationWhitelist();

  const {
    data: personalSettingsInfo, mutate: mutatePersonalSettings, sync, updateBasicInfo, error,
  } = usePersonalSettings();


  const submitHandler = async() => {

    try {
      await updateBasicInfo();
      sync();
      toastSuccess(t('toaster.update_successed', { target: t('Basic Info'), ns: 'commons' }));
    }
    catch (errs) {
      const err = errs[0];
      const message = err.message;
      const code = err.code;

      if (code === 'email-is-already-in-use') {
        toastError(t('alert.email_is_already_in_use', { ns: 'commons' }));
      }
      else {
        toastError(message);
      }
    }
  };

  const changePersonalSettingsHandler = (updateData) => {
    if (personalSettingsInfo == null) {
      return;
    }
    mutatePersonalSettings({ ...personalSettingsInfo, ...updateData });
  };


  return (
    <>

      <div className="row mt-3 mt-md-4">
        <label htmlFor="userForm[name]" className="text-start text-md-end col-md-3 col-form-label">{t('Name')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            name="userForm[name]"
            defaultValue={personalSettingsInfo?.name || ''}
            onChange={e => changePersonalSettingsHandler({ name: e.target.value })}
          />
        </div>
      </div>

      <div className="row mt-3">
        <label htmlFor="userForm[email]" className="text-start text-md-end col-md-3 col-form-label">{t('Email')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            name="userForm[email]"
            defaultValue={personalSettingsInfo?.email || ''}
            onChange={e => changePersonalSettingsHandler({ email: e.target.value })}
          />
          {registrationWhitelist != null && registrationWhitelist.length !== 0 && (
            <div className="form-text text-muted">
              {t('page_register.form_help.email')}
              <ul>
                {registrationWhitelist.map(data => <li key={data}><code>{data}</code></li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="row mt-3">
        <label className="text-start text-md-end col-md-3 col-form-label">{t('Disclose E-mail')}</label>
        <div className="col-md-6 my-auto">
          <div className="form-check form-check-inline me-4">
            <input
              type="radio"
              id="radioEmailShow"
              className="form-check-input"
              name="userForm[isEmailPublished]"
              checked={personalSettingsInfo?.isEmailPublished === true}
              onChange={() => changePersonalSettingsHandler({ isEmailPublished: true })}
            />
            <label className="form-label form-check-label mb-0" htmlFor="radioEmailShow">{t('Show')}</label>
          </div>
          <div className="form-check form-check-inline">
            <input
              type="radio"
              id="radioEmailHide"
              className="form-check-input"
              name="userForm[isEmailPublished]"
              checked={personalSettingsInfo?.isEmailPublished === false}
              onChange={() => changePersonalSettingsHandler({ isEmailPublished: false })}
            />
            <label className="form-label form-check-label mb-0" htmlFor="radioEmailHide">{t('Hide')}</label>
          </div>
        </div>
      </div>

      <div className="row mt-3">
        <label className="text-start text-md-end col-md-3 col-form-label">{t('Language')}</label>
        <div className="col-md-6 my-auto">
          {
            i18nConfig.locales.map((locale) => {
              if (i18n == null) { return }
              const fixedT = i18n.getFixedT(locale);

              return (
                <div key={locale} className="form-check form-check-inline me-4">
                  <input
                    type="radio"
                    id={`radioLang${locale}`}
                    className="form-check-input"
                    name="userForm[lang]"
                    checked={personalSettingsInfo?.lang === locale}
                    onChange={() => changePersonalSettingsHandler({ lang: locale })}
                  />
                  <label className="form-label form-check-label mb-0" htmlFor={`radioLang${locale}`}>{fixedT('meta.display_name') as string}</label>
                </div>
              );
            })
          }
        </div>
      </div>
      <div className="row mt-3">
        <label htmlFor="userForm[slackMemberId]" className="text-start text-md-end col-md-3 col-form-label">{t('Slack Member ID')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            key="slackMemberId"
            name="userForm[slackMemberId]"
            defaultValue={personalSettingsInfo?.slackMemberId || ''}
            onChange={e => changePersonalSettingsHandler({ slackMemberId: e.target.value })}
          />
        </div>
      </div>

      <div className="row mt-4">
        <div className="offset-4 col-5">
          <button
            data-testid="grw-besic-info-settings-update-button"
            type="button"
            className="btn btn-primary"
            onClick={submitHandler}
            disabled={error != null}
          >
            {t('Update')}
          </button>
        </div>
      </div>

    </>
  );
};
