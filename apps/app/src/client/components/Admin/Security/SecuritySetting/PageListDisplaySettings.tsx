import React from 'react';

import type AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  t: (key: string) => string;
};

export const PageListDisplaySettings: React.FC<Props> = ({ adminGeneralSecurityContainer, t }) => {
  return (
    <>
      <h4 className="alert-anchor">
        {t('security_settings.page_list_and_search_results')}
      </h4>
      <div className="row mb-4">
        <div className="col-md-10">
          <div className="row">
            {/* Left Column: Labels */}
            <div className="col-5 d-flex flex-column align-items-end p-4">
              <div className="fw-bold mb-4">{t('public')}</div>
              <div className="fw-bold mb-4">{t('anyone_with_the_link')}</div>
              <div className="fw-bold mb-4">{t('only_me')}</div>
              <div className="fw-bold">{t('only_inside_the_group')}</div>
            </div>

            {/* Right Column: Content */}
            <div className="col-7 d-flex flex-column align-items-start pt-4 pb-4">
              <div className="mb-4 d-flex align-items-center">
                <span className="material-symbols-outlined text-success me-1"></span>
                {t('security_settings.always_displayed')}
              </div>
              <div className="mb-3 d-flex align-items-center">
                <span className="material-symbols-outlined text-danger me-1"></span>
                {t('security_settings.always_hidden')}
              </div>

              {/* Owner Restriction Dropdown */}
              <div className="mb-3">
                <div className="dropdown">
                  <button
                    className="btn btn-outline-secondary dropdown-toggle text-end col-12 col-md-auto"
                    type="button"
                    id="isShowRestrictedByOwner"
                    data-bs-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="true"
                  >
                    <span className="float-start">
                      {adminGeneralSecurityContainer.state.currentOwnerRestrictionDisplayMode === 'Displayed'
                        && t('security_settings.always_displayed')}
                      {adminGeneralSecurityContainer.state.currentOwnerRestrictionDisplayMode === 'Hidden'
                        && t('security_settings.always_hidden')}
                    </span>
                  </button>
                  <div className="dropdown-menu" aria-labelledby="isShowRestrictedByOwner">
                    <button
                      className="dropdown-item"
                      type="button"
                      onClick={() => { adminGeneralSecurityContainer.changeOwnerRestrictionDisplayMode('Displayed') }}
                    >
                      {t('security_settings.always_displayed')}
                    </button>
                    <button
                      className="dropdown-item"
                      type="button"
                      onClick={() => { adminGeneralSecurityContainer.changeOwnerRestrictionDisplayMode('Hidden') }}
                    >
                      {t('security_settings.always_hidden')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Group Restriction Dropdown */}
              <div className="">
                <div className="dropdown">
                  <button
                    className="btn btn-outline-secondary dropdown-toggle text-end col-12 col-md-auto"
                    type="button"
                    id="isShowRestrictedByGroup"
                    data-bs-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="true"
                  >
                    <span className="float-start">
                      {adminGeneralSecurityContainer.state.currentGroupRestrictionDisplayMode === 'Displayed'
                        && t('security_settings.always_displayed')}
                      {adminGeneralSecurityContainer.state.currentGroupRestrictionDisplayMode === 'Hidden'
                        && t('security_settings.always_hidden')}
                    </span>
                  </button>
                  <div className="dropdown-menu" aria-labelledby="isShowRestrictedByGroup">
                    <button
                      className="dropdown-item"
                      type="button"
                      onClick={() => { adminGeneralSecurityContainer.changeGroupRestrictionDisplayMode('Displayed') }}
                    >
                      {t('security_settings.always_displayed')}
                    </button>
                    <button
                      className="dropdown-item"
                      type="button"
                      onClick={() => { adminGeneralSecurityContainer.changeGroupRestrictionDisplayMode('Hidden') }}
                    >
                      {t('security_settings.always_hidden')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
