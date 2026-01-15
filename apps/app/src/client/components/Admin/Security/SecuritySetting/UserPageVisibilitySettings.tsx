/* eslint-disable react/no-danger */
import type React from 'react';

import type AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  t: (key: string) => string;
};

export const UserPageVisibilitySettings: React.FC<Props> = ({
  adminGeneralSecurityContainer,
  t,
}) => {
  return (
    <>
      <h4 className="mb-3">
        {t('security_settings.user_page_visibility.user_page_visibility')}
      </h4>
      <div className="row mb-4">
        <div className="col-md-10 offset-md-2">
          <div className="form-check form-switch form-check-success">
            <input
              type="checkbox"
              className="form-check-input"
              id="is-user-pages-visible"
              checked={adminGeneralSecurityContainer.state.isHidingUserPages}
              onChange={() => {
                adminGeneralSecurityContainer.changeUserPageVisibility();
              }}
            />
            <label
              className="form-label form-check-label"
              htmlFor="is-user-pages-visible"
            >
              {t('security_settings.user_page_visibility.hide_user_pages')}
            </label>
          </div>
          <p className="form-text text-muted small mt-2">
            {t('security_settings.user_page_visibility.desc')}
          </p>
        </div>
      </div>
    </>
  );
};
