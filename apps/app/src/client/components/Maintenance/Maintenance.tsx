import type { JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';


export const Maintenance = (): JSX.Element => {
  const { t } = useTranslation();

  const currentUser = useCurrentUser();

  const logoutHandler = async() => {
    try {
      await apiv3Post('/logout');
      window.location.reload();
    }
    catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="text-center">
      <h1><span className="material-symbols-outlined large">error</span></h1>
      <h1 className="text-center">{ t('maintenance_mode.maintenance_mode') }</h1>
      <h3>{ t('maintenance_mode.growi_is_under_maintenance') }</h3>
      <hr />
      <div className="text-start">
        {currentUser?.admin
              && (
                <p>
                  <span className="material-symbols-outlined">arrow_circle_right</span>
                  <a className="btn btn-link" href="/admin">{ t('maintenance_mode.admin_page') }</a>
                </p>
              )}
        {currentUser != null
          ? (
            <p>
              <span className="material-symbols-outlined">arrow_circle_right</span>
              <a className="btn btn-link" onClick={logoutHandler} id="maintanounse-mode-logout">{ t('maintenance_mode.logout') }</a>
            </p>
          )
          : (
            <p>
              <span className="material-symbols-outlined">arrow_circle_right</span>
              <a className="btn btn-link" href="/login">{ t('maintenance_mode.login') }</a>
            </p>
          )
        }
      </div>
    </div>
  );
};
