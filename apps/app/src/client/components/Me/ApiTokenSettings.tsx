import React, { useCallback } from 'react';

import { useTranslation } from 'next-i18next';

import {
  apiv3Put,
} from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { usePersonalSettings, useSWRxPersonalSettings } from '~/stores/personal-settings';


export const ApiTokenSettings = React.memo((): JSX.Element => {

  const { t } = useTranslation();
  const { mutate: mutateDatabaseData } = useSWRxPersonalSettings();
  const { data: personalSettingsData } = usePersonalSettings();

  const submitHandler = useCallback(async() => {

    try {
      await apiv3Put('/personal-setting/api-token');
      mutateDatabaseData();

      toastSuccess(t('toaster.update_successed', { target: t('page_me_apitoken.api_token'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }

  }, [mutateDatabaseData, t]);

  return (
    <>
      <div className="row mb-3">
        <label htmlFor="apiToken" className="col-md-3 text-md-end col-form-label">{t('Current API Token')}</label>
        <div className="col-md-6">
          {personalSettingsData?.apiToken != null
            ? (
              <input
                data-testid="grw-api-settings-input"
                data-vrt-blackout
                className="form-control"
                type="text"
                name="apiToken"
                value={personalSettingsData.apiToken}
                readOnly
              />
            )
            : (
              <p>
                { t('page_me_apitoken.notice.apitoken_issued') }
              </p>
            )}
        </div>
      </div>


      <div className="row">
        <div className="offset-lg-2 col-lg-7">

          <p className="alert alert-warning">
            { t('page_me_apitoken.notice.update_token1') }<br />
            { t('page_me_apitoken.notice.update_token2') }
          </p>

        </div>
      </div>

      <div className="row my-3">
        <div className="offset-4 col-5">
          <button
            data-testid="grw-api-settings-update-button"
            type="button"
            className="btn btn-primary text-nowrap"
            onClick={submitHandler}
          >
            {t('Update API Token')}
          </button>
        </div>
      </div>

    </>

  );
});
