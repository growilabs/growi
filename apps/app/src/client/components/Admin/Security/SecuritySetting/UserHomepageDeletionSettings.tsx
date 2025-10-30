/* eslint-disable react/no-danger */
import React from 'react';

import type AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  t: (key: string) => string;
};

export const UserHomepageDeletionSettings: React.FC<Props> = ({ adminGeneralSecurityContainer, t }) => {
  return (
    <>
      <h4 className="mb-3">{t('security_settings.user_homepage_deletion.user_homepage_deletion')}</h4>
      <div className="row mb-4">
        <div className="col-md-10 offset-md-2">
          <div className="form-check form-switch form-check-success">
            <input
              type="checkbox"
              className="form-check-input"
              id="is-user-page-deletion-enabled"
              checked={adminGeneralSecurityContainer.state.isUsersHomepageDeletionEnabled}
              onChange={() => { adminGeneralSecurityContainer.switchIsUsersHomepageDeletionEnabled() }}
            />
            <label className="form-label form-check-label" htmlFor="is-user-page-deletion-enabled">
              {t('security_settings.user_homepage_deletion.enable_user_homepage_deletion')}
            </label>
          </div>
          <div className="custom-control custom-switch custom-checkbox-success mt-2">
            <input
              type="checkbox"
              className="form-check-input"
              id="is-force-delete-user-homepage-on-user-deletion"
              checked={adminGeneralSecurityContainer.state.isForceDeleteUserHomepageOnUserDeletion}
              onChange={() => { adminGeneralSecurityContainer.switchIsForceDeleteUserHomepageOnUserDeletion() }}
              disabled={!adminGeneralSecurityContainer.state.isUsersHomepageDeletionEnabled}
            />
            <label className="form-check-label" htmlFor="is-force-delete-user-homepage-on-user-deletion">
              {t('security_settings.user_homepage_deletion.enable_force_delete_user_homepage_on_user_deletion')}
            </label>
          </div>
          <p
            className="form-text text-muted small mt-2"
            dangerouslySetInnerHTML={{ __html: t('security_settings.user_homepage_deletion.desc') }}
          />
        </div>
      </div>
    </>
  );
};
