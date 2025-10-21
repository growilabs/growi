import React from 'react';

import type AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  t: (key: string) => string;
};

export const CommentManageRightsSettings: React.FC<Props> = ({ adminGeneralSecurityContainer, t }) => {
  const { isRomUserAllowedToComment } = adminGeneralSecurityContainer.state;

  return (
    <>
      <h4 className="mb-3">{t('security_settings.comment_manage_rights')}</h4>
      <div className="row mb-4">
        <div className="col-md-4 text-md-end py-2">
          <strong>{t('security_settings.readonly_users_access')}</strong>
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
                {isRomUserAllowedToComment === true && t('security_settings.read_only_users_comment.accept')}
                {isRomUserAllowedToComment === false && t('security_settings.read_only_users_comment.deny')}
              </span>
            </button>
            <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { adminGeneralSecurityContainer.switchIsRomUserAllowedToComment(false) }}
              >
                {t('security_settings.read_only_users_comment.deny')}
              </button>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { adminGeneralSecurityContainer.switchIsRomUserAllowedToComment(true) }}
              >
                {t('security_settings.read_only_users_comment.accept')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
