/* eslint-disable react/no-danger */
import React from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { Collapse } from 'reactstrap';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { PageDeleteConfigValue } from '~/interfaces/page-delete-config';
import { validateDeleteConfigs, prepareDeleteConfigValuesForCalc } from '~/utils/page-delete-config';

import { withUnstatedContainers } from '../../UnstatedUtils';

// used as the prefix of translation
const DeletionTypeForT = Object.freeze({
  Deletion: 'deletion',
  CompleteDeletion: 'complete_deletion',
  RecursiveDeletion: 'recursive_deletion',
  RecursiveCompleteDeletion: 'recursive_complete_deletion',
});

const DeletionType = Object.freeze({
  Deletion: 'deletion',
  CompleteDeletion: 'completeDeletion',
  RecursiveDeletion: 'recursiveDeletion',
  RecursiveCompleteDeletion: 'recursiveCompleteDeletion',
});

const getDeletionTypeForT = (deletionType) => {
  switch (deletionType) {
    case DeletionType.Deletion:
      return DeletionTypeForT.Deletion;
    case DeletionType.RecursiveDeletion:
      return DeletionTypeForT.RecursiveDeletion;
    case DeletionType.CompleteDeletion:
      return DeletionTypeForT.CompleteDeletion;
    case DeletionType.RecursiveCompleteDeletion:
      return DeletionTypeForT.RecursiveCompleteDeletion;
  }
};

const getDeleteConfigValueForT = (DeleteConfigValue) => {
  switch (DeleteConfigValue) {
    case PageDeleteConfigValue.Anyone:
    case null:
      return 'security_settings.anyone';
    case PageDeleteConfigValue.Inherit:
      return 'security_settings.inherit';
    case PageDeleteConfigValue.AdminOnly:
      return 'security_settings.admin_only';
    case PageDeleteConfigValue.AdminAndAuthor:
      return 'security_settings.admin_and_author';
  }
};

/**
 * Return true if "deletionType" is DeletionType.RecursiveDeletion or DeletionType.RecursiveCompleteDeletion.
 * @param deletionType Deletion type
 * @returns boolean
 */
const isRecursiveDeletion = (deletionType) => {
  return deletionType === DeletionType.RecursiveDeletion || deletionType === DeletionType.RecursiveCompleteDeletion;
};

/**
 * Return true if "deletionType" is DeletionType.Deletion or DeletionType.RecursiveDeletion.
 * @param deletionType Deletion type
 * @returns boolean
 */
const isTypeDeletion = (deletionType) => {
  return deletionType === DeletionType.Deletion || deletionType === DeletionType.RecursiveDeletion;
};

class SecuritySetting extends React.Component {

  constructor(props) {
    super(props);

    // functions
    this.putSecuritySetting = this.putSecuritySetting.bind(this);
    this.getRecursiveDeletionConfigState = this.getRecursiveDeletionConfigState.bind(this);
    this.previousPageRecursiveAuthorityState = this.previousPageRecursiveAuthorityState.bind(this);
    this.setPagePreviousRecursiveAuthorityState = this.setPagePreviousRecursiveAuthorityState.bind(this);
    this.expantDeleteOptionsState = this.expantDeleteOptionsState.bind(this);
    this.setExpantOtherDeleteOptionsState = this.setExpantOtherDeleteOptionsState.bind(this);
    this.setDeletionConfigState = this.setDeletionConfigState.bind(this);

    // render
    this.renderPageDeletePermission = this.renderPageDeletePermission.bind(this);
    this.renderPageDeletePermissionDropdown = this.renderPageDeletePermissionDropdown.bind(this);
  }

  async putSecuritySetting() {
    const { t, adminGeneralSecurityContainer } = this.props;
    try {
      await adminGeneralSecurityContainer.updateGeneralSecuritySetting();
      toastSuccess(t('security_settings.updated_general_security_setting'));
    }
    catch (err) {
      toastError(err);
    }
  }

  getRecursiveDeletionConfigState(deletionType) {
    const { adminGeneralSecurityContainer } = this.props;

    if (isTypeDeletion(deletionType)) {
      return [
        adminGeneralSecurityContainer.state.currentPageRecursiveDeletionAuthority,
        adminGeneralSecurityContainer.changePageRecursiveDeletionAuthority,
      ];
    }

    return [
      adminGeneralSecurityContainer.state.currentPageRecursiveCompleteDeletionAuthority,
      adminGeneralSecurityContainer.changePageRecursiveCompleteDeletionAuthority,
    ];
  }

  previousPageRecursiveAuthorityState(deletionType) {
    const { adminGeneralSecurityContainer } = this.props;

    return isTypeDeletion(deletionType)
      ? adminGeneralSecurityContainer.state.previousPageRecursiveDeletionAuthority
      : adminGeneralSecurityContainer.state.previousPageRecursiveCompleteDeletionAuthority;
  }

  setPagePreviousRecursiveAuthorityState(deletionType, previousState) {
    const { adminGeneralSecurityContainer } = this.props;

    if (isTypeDeletion(deletionType)) {
      adminGeneralSecurityContainer.changePreviousPageRecursiveDeletionAuthority(previousState);
      return;
    }

    adminGeneralSecurityContainer.changePreviousPageRecursiveCompleteDeletionAuthority(previousState);
  }

  expantDeleteOptionsState(deletionType) {
    const { adminGeneralSecurityContainer } = this.props;

    return isTypeDeletion(deletionType)
      ? adminGeneralSecurityContainer.state.expandOtherOptionsForDeletion
      : adminGeneralSecurityContainer.state.expandOtherOptionsForCompleteDeletion;
  }

  setExpantOtherDeleteOptionsState(deletionType, bool) {
    const { adminGeneralSecurityContainer } = this.props;

    if (isTypeDeletion(deletionType)) {
      adminGeneralSecurityContainer.switchExpandOtherOptionsForDeletion(bool);
      return;
    }
    adminGeneralSecurityContainer.switchExpandOtherOptionsForCompleteDeletion(bool);
    return;
  }

  /**
   * Force update deletion config for recursive operation when the deletion config for general operation is updated.
   * @param deletionType Deletion type
   */
  setDeletionConfigState(newState, setState, deletionType) {
    setState(newState);

    if (this.previousPageRecursiveAuthorityState(deletionType) !== null) {
      this.setPagePreviousRecursiveAuthorityState(deletionType, null);
    }

    if (isRecursiveDeletion(deletionType)) {
      return;
    }

    const [recursiveState, setRecursiveState] = this.getRecursiveDeletionConfigState(deletionType);

    const calculableValue = prepareDeleteConfigValuesForCalc(newState, recursiveState);
    const shouldForceUpdate = !validateDeleteConfigs(calculableValue[0], calculableValue[1]);
    if (shouldForceUpdate) {
      setRecursiveState(newState);
      this.setPagePreviousRecursiveAuthorityState(deletionType, recursiveState);
      this.setExpantOtherDeleteOptionsState(deletionType, true);
    }

    return;
  }

  renderPageDeletePermissionDropdown(currentState, setState, deletionType, isButtonDisabled) {
    const { t } = this.props;
    return (
      <div className="dropdown">
        <button
          className="btn btn-outline-secondary dropdown-toggle text-end"
          type="button"
          id="dropdownMenuButton"
          data-bs-toggle="dropdown"
          aria-haspopup="true"
          aria-expanded="true"
        >
          <span className="float-start">
            {t(getDeleteConfigValueForT(currentState))}
          </span>
        </button>
        <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
          {
            isRecursiveDeletion(deletionType)
              ? (
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => { this.setDeletionConfigState(PageDeleteConfigValue.Inherit, setState, deletionType) }}
                >
                  {t('security_settings.inherit')}
                </button>
              )
              : (
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => { this.setDeletionConfigState(PageDeleteConfigValue.Anyone, setState, deletionType) }}
                >
                  {t('security_settings.anyone')}
                </button>
              )
          }
          <button
            className={`dropdown-item ${isButtonDisabled ? 'disabled' : ''}`}
            type="button"
            onClick={() => { this.setDeletionConfigState(PageDeleteConfigValue.AdminAndAuthor, setState, deletionType) }}
          >
            {t('security_settings.admin_and_author')}
          </button>
          <button
            className="dropdown-item"
            type="button"
            onClick={() => { this.setDeletionConfigState(PageDeleteConfigValue.AdminOnly, setState, deletionType) }}
          >
            {t('security_settings.admin_only')}
          </button>
        </div>
        <p className="form-text text-muted small">
          {t(`security_settings.${getDeletionTypeForT(deletionType)}_explanation`)}
        </p>
      </div>
    );
  }

  renderPageDeletePermission(currentState, setState, deletionType, isButtonDisabled) {
    const { t, adminGeneralSecurityContainer } = this.props;

    const expantDeleteOptionsState = this.expantDeleteOptionsState(deletionType);

    return (
      <div key={`page-delete-permission-dropdown-${deletionType}`} className="row">

        <div className="col-md-4 text-md-end">
          {!isRecursiveDeletion(deletionType) && isTypeDeletion(deletionType) && (
            <strong>{t('security_settings.page_delete')}</strong>
          )}
          {!isRecursiveDeletion(deletionType) && !isTypeDeletion(deletionType) && (
            <strong>{t('security_settings.page_delete_completely')}</strong>
          )}
        </div>

        <div className="col-md-8">
          {
            !isRecursiveDeletion(deletionType)
              ? (
                <>
                  {this.renderPageDeletePermissionDropdown(currentState, setState, deletionType, isButtonDisabled)}
                  {currentState === PageDeleteConfigValue.Anyone && deletionType === DeletionType.CompleteDeletion && (
                    <>
                      <input
                        id="isAllGroupMembershipRequiredForPageCompleteDeletionCheckbox"
                        className="form-check-input"
                        type="checkbox"
                        checked={adminGeneralSecurityContainer.state.isAllGroupMembershipRequiredForPageCompleteDeletion}
                        onChange={() => { adminGeneralSecurityContainer.switchIsAllGroupMembershipRequiredForPageCompleteDeletion() }}
                      />
                      <label className="form-check-label" htmlFor="isAllGroupMembershipRequiredForPageCompleteDeletionCheckbox">
                        {t('security_settings.is_all_group_membership_required_for_page_complete_deletion')}
                      </label>
                      <p
                        className="form-text text-muted small mt-2"
                      >
                        {t('security_settings.is_all_group_membership_required_for_page_complete_deletion_explanation')}
                      </p>
                    </>
                  )}
                </>
              )
              : (
                <>
                  <button
                    type="button"
                    className="btn btn-link p-0 mb-4"
                    aria-expanded="false"
                    onClick={() => this.setExpantOtherDeleteOptionsState(deletionType, !expantDeleteOptionsState)}
                  >
                    <span className={`material-symbols-outlined me-1 ${expantDeleteOptionsState ? 'rotate-90' : ''}`}>navigate_next</span>
                    {t('security_settings.other_options')}
                  </button>
                  <Collapse isOpen={expantDeleteOptionsState}>
                    <div className="pb-4">
                      <p className="card custom-card bg-warning-sublte">
                        <span className="text-warning">
                          <span className="material-symbols-outlined">info</span>
                          {/* eslint-disable-next-line react/no-danger */}
                          <span dangerouslySetInnerHTML={{ __html: t('security_settings.page_delete_rights_caution') }} />
                        </span>
                      </p>
                      {this.previousPageRecursiveAuthorityState(deletionType) !== null && (
                        <div className="mb-3">
                          <strong>
                            {t('security_settings.forced_update_desc')}
                          </strong>
                          <code>
                            {t(getDeleteConfigValueForT(this.previousPageRecursiveAuthorityState(deletionType)))}
                          </code>
                        </div>
                      )}
                      {this.renderPageDeletePermissionDropdown(currentState, setState, deletionType, isButtonDisabled)}
                    </div>
                  </Collapse>
                </>
              )
          }
        </div>
      </div>
    );
  }

  render() {
    const { t, adminGeneralSecurityContainer } = this.props;
    const {
      currentRestrictGuestMode, currentPageDeletionAuthority, currentPageCompleteDeletionAuthority,
      currentPageRecursiveDeletionAuthority, currentPageRecursiveCompleteDeletionAuthority, isRomUserAllowedToComment,
    } = adminGeneralSecurityContainer.state;

    const isButtonDisabledForDeletion = !validateDeleteConfigs(
      adminGeneralSecurityContainer.state.currentPageDeletionAuthority, PageDeleteConfigValue.AdminAndAuthor,
    );

    const isButtonDisabledForCompleteDeletion = !validateDeleteConfigs(
      adminGeneralSecurityContainer.state.currentPageCompleteDeletionAuthority, PageDeleteConfigValue.AdminAndAuthor,
    );

    return (
      <React.Fragment>
        <h2 className="alert-anchor border-bottom">
          {t('security_settings.security_settings')}
        </h2>

        {adminGeneralSecurityContainer.retrieveError != null && (
          <div className="alert alert-danger">
            <p>{t('Error occurred')} : {adminGeneralSecurityContainer.retrieveError}</p>
          </div>
        )}

        <h4 className="alert-anchor border-bottom mt-4">{t('security_settings.page_list_and_search_results')}</h4>
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
                        {adminGeneralSecurityContainer.state.currentOwnerRestrictionDisplayMode === 'Displayed' && t('security_settings.always_displayed')}
                        {adminGeneralSecurityContainer.state.currentOwnerRestrictionDisplayMode === 'Hidden' && t('security_settings.always_hidden')}
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
                        {adminGeneralSecurityContainer.state.currentGroupRestrictionDisplayMode === 'Displayed' && t('security_settings.always_displayed')}
                        {adminGeneralSecurityContainer.state.currentGroupRestrictionDisplayMode === 'Hidden' && t('security_settings.always_hidden')}
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

        <h4 className="mb-3">{t('security_settings.page_access_rights')}</h4>
        <div className="row mb-4">
          <div className="col-md-4 text-md-end py-2">
            <strong>{t('security_settings.Guest Users Access')}</strong>
          </div>
          <div className="col-md-8">
            <div className="dropdown">
              <button
                className={`btn btn-outline-secondary dropdown-toggle text-end col-12
                            col-md-auto ${adminGeneralSecurityContainer.isWikiModeForced && 'disabled'}`}
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
                <button className="dropdown-item" type="button" onClick={() => { adminGeneralSecurityContainer.changeRestrictGuestMode('Deny') }}>
                  {t('security_settings.guest_mode.deny')}
                </button>
                <button className="dropdown-item" type="button" onClick={() => { adminGeneralSecurityContainer.changeRestrictGuestMode('Readonly') }}>
                  {t('security_settings.guest_mode.readonly')}
                </button>
              </div>
            </div>
            {adminGeneralSecurityContainer.isWikiModeForced && (
              <p className="alert alert-warning mt-2 col-6">
                <span className="material-symbols-outlined me-1">error</span>
                <b>FIXED</b><br />
                <b
                  dangerouslySetInnerHTML={{
                    __html: t('security_settings.Fixed by env var',
                      { key: 'FORCE_WIKI_MODE', value: adminGeneralSecurityContainer.state.wikiMode }),
                  }}
                />
              </p>
            )}
          </div>
        </div>

        <h4 className="mb-3">{t('security_settings.page_delete_rights')}</h4>
        {/* Render PageDeletePermission */}
        {
          [
            [currentPageDeletionAuthority, adminGeneralSecurityContainer.changePageDeletionAuthority, DeletionType.Deletion, false],
            // eslint-disable-next-line max-len
            [currentPageRecursiveDeletionAuthority, adminGeneralSecurityContainer.changePageRecursiveDeletionAuthority, DeletionType.RecursiveDeletion, isButtonDisabledForDeletion],
          ].map(arr => this.renderPageDeletePermission(arr[0], arr[1], arr[2], arr[3]))
        }
        {
          [
            [currentPageCompleteDeletionAuthority, adminGeneralSecurityContainer.changePageCompleteDeletionAuthority, DeletionType.CompleteDeletion, false],
            // eslint-disable-next-line max-len
            [currentPageRecursiveCompleteDeletionAuthority, adminGeneralSecurityContainer.changePageRecursiveCompleteDeletionAuthority, DeletionType.RecursiveCompleteDeletion, isButtonDisabledForCompleteDeletion],
          ].map(arr => this.renderPageDeletePermission(arr[0], arr[1], arr[2], arr[3]))
        }

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

        <h4 className="mb-3">{t('security_settings.comment_manage_rights')}</h4>
        <div className="row mb-4">
          <div className="col-md-4 text-md-end py-2">
            <strong>{t('security_settings.readonly_users_access')}</strong>
          </div>
          <div className="col-md-8">
            <div className="dropdown">
              <button
                className={`btn btn-outline-secondary dropdown-toggle text-end col-12
                            col-md-auto ${adminGeneralSecurityContainer.isWikiModeForced && 'disabled'}`}
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
                <button className="dropdown-item" type="button" onClick={() => { adminGeneralSecurityContainer.switchIsRomUserAllowedToComment(false) }}>
                  {t('security_settings.read_only_users_comment.deny')}
                </button>
                <button className="dropdown-item" type="button" onClick={() => { adminGeneralSecurityContainer.switchIsRomUserAllowedToComment(true) }}>
                  {t('security_settings.read_only_users_comment.accept')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <h4>{t('security_settings.session')}</h4>
        <div className="row">
          <label className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.max_age')}</label>
          <div className="col-md-8">
            <input
              className="form-control col-md-4"
              type="text"
              value={adminGeneralSecurityContainer.state.sessionMaxAge || ''}
              onChange={(e) => {
                adminGeneralSecurityContainer.setSessionMaxAge(e.target.value);
              }}
              placeholder="2592000000"
            />
            {/* eslint-disable-next-line react/no-danger */}
            <p className="form-text text-muted" dangerouslySetInnerHTML={{ __html: t('security_settings.max_age_desc') }} />
            <p className="card custom-card bg-warning-subtle">
              <span className="text-warning">
                <span className="material-symbols-outlined">info</span> {t('security_settings.max_age_caution')}
              </span>
            </p>
          </div>
        </div>

        <div className="row my-3">
          <div className="text-center text-md-start offset-md-3 col-md-5">
            <button type="button" className="btn btn-primary" disabled={adminGeneralSecurityContainer.retrieveError != null} onClick={this.putSecuritySetting}>
              {t('Update')}
            </button>
          </div>
        </div>
      </React.Fragment>
    );
  }

}

SecuritySetting.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminGeneralSecurityContainer: PropTypes.instanceOf(AdminGeneralSecurityContainer).isRequired,
};

const SecuritySettingWrapperFC = (props) => {
  const { t } = useTranslation('admin');
  return <SecuritySetting t={t} {...props} />;
};

const SecuritySettingWrapper = withUnstatedContainers(SecuritySettingWrapperFC, [AdminGeneralSecurityContainer]);

export default SecuritySettingWrapper;
