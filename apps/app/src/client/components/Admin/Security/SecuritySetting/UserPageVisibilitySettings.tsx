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
        {t('security_settings.disable_user_pages.disable_user_pages')}
      </h4>
      <div className="row mb-4">
        <div className="col-md-10 offset-md-2">
          <div className="form-check form-switch form-check-success">
            <input
              type="checkbox"
              className="form-check-input"
              id="is-user-pages-visible"
              checked={adminGeneralSecurityContainer.state.disableUserPages}
              onChange={() => {
                adminGeneralSecurityContainer.changeUserPageVisibility();
              }}
            />
            <label
              className="form-label form-check-label"
              htmlFor="is-user-pages-visible"
            >
              {t(
                'security_settings.disable_user_pages.disable_user_pages_label',
              )}
            </label>
          </div>
          <p
            className="form-text text-muted small mt-2"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: includes <br> and <code> from i18n strings
            dangerouslySetInnerHTML={{
              __html: t('security_settings.disable_user_pages.desc'),
            }}
          />
        </div>
      </div>
    </>
  );
};
