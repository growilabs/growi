/* eslint-disable react/no-danger */
import React from 'react';

import type AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export const PageAccessRightsSettings: React.FC<Props> = ({ adminGeneralSecurityContainer, t }) => {
  const { currentRestrictGuestMode } = adminGeneralSecurityContainer.state;

  return (
    <>
      <h4 className="mb-3">{t('security_settings.page_access_rights')}</h4>
      <div className="row mb-4">
        <div className="col-md-4 text-md-end py-2">
          <strong>{t('security_settings.Guest Users Access')}</strong>
        </div>
        <div className="col-md-8">
          <div className="dropdown">
            <button
              className={`btn btn-outline-secondary dropdown-toggle text-end col-12 col-md-auto ${
                adminGeneralSecurityContainer.isWikiModeForced && 'disabled'
              }`}
              type="button"
              id="dropdownMenuButton"
              data-bs-toggle="dropdown"
              aria-haspopup="true"
              aria-expanded="true"
            >
              <span className="float-start">
                {currentRestrictGuestMode === 'Deny' && t('security_settings.guest_mode.deny')}
                {currentRestrictGuestMode === 'Readonly' && t('security_settings.guest_mode.readonly')}
              </span>
            </button>
            <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { adminGeneralSecurityContainer.changeRestrictGuestMode('Deny') }}
              >
                {t('security_settings.guest_mode.deny')}
              </button>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { adminGeneralSecurityContainer.changeRestrictGuestMode('Readonly') }}
              >
                {t('security_settings.guest_mode.readonly')}
              </button>
            </div>
          </div>
          {adminGeneralSecurityContainer.isWikiModeForced && (
            <p className="alert alert-warning mt-2 col-6">
              <span className="material-symbols-outlined me-1">error</span>
              <b>FIXED</b>
              <br />
              {/* eslint-disable-next-line react/no-danger */}
              <b
                dangerouslySetInnerHTML={{
                  __html: t('security_settings.Fixed by env var', {
                    key: 'FORCE_WIKI_MODE',
                    value: adminGeneralSecurityContainer.state.wikiMode,
                  }),
                }}
              />
            </p>
          )}
        </div>
      </div>
    </>
  );
};
