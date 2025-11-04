import React, { useCallback } from 'react';

import { Collapse } from 'reactstrap';

import type AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import {
  PageDeleteConfigValue,
  type IPageDeleteConfigValue,
  type IPageDeleteConfigValueToProcessValidation,
} from '~/interfaces/page-delete-config';
import { validateDeleteConfigs, prepareDeleteConfigValuesForCalc } from '~/utils/page-delete-config';

import {
  DeletionType,
  type DeletionTypeValue,
  getDeletionTypeForT,
  getDeleteConfigValueForT,
  isRecursiveDeletion,
  isTypeDeletion,
} from './types';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  t: (key: string) => string;
};

export const PageDeleteRightsSettings: React.FC<Props> = ({ adminGeneralSecurityContainer, t }) => {
  const {
    currentPageDeletionAuthority,
    currentPageCompleteDeletionAuthority,
    currentPageRecursiveDeletionAuthority,
    currentPageRecursiveCompleteDeletionAuthority,
  } = adminGeneralSecurityContainer.state;

  const getRecursiveDeletionConfigState = useCallback((deletionType: DeletionTypeValue) => {
    if (isTypeDeletion(deletionType)) {
      return [
        adminGeneralSecurityContainer.state.currentPageRecursiveDeletionAuthority,
        adminGeneralSecurityContainer.changePageRecursiveDeletionAuthority,
      ] as const;
    }

    return [
      adminGeneralSecurityContainer.state.currentPageRecursiveCompleteDeletionAuthority,
      adminGeneralSecurityContainer.changePageRecursiveCompleteDeletionAuthority,
    ] as const;
  }, [adminGeneralSecurityContainer]);

  const previousPageRecursiveAuthorityState = useCallback((deletionType: DeletionTypeValue) => {
    return isTypeDeletion(deletionType)
      ? adminGeneralSecurityContainer.state.previousPageRecursiveDeletionAuthority
      : adminGeneralSecurityContainer.state.previousPageRecursiveCompleteDeletionAuthority;
  }, [adminGeneralSecurityContainer]);

  const setPagePreviousRecursiveAuthorityState = useCallback((deletionType: DeletionTypeValue, previousState: IPageDeleteConfigValue | null) => {
    if (isTypeDeletion(deletionType)) {
      adminGeneralSecurityContainer.changePreviousPageRecursiveDeletionAuthority(previousState);
      return;
    }

    adminGeneralSecurityContainer.changePreviousPageRecursiveCompleteDeletionAuthority(previousState);
  }, [adminGeneralSecurityContainer]);

  const expandDeleteOptionsState = useCallback((deletionType: DeletionTypeValue) => {
    return isTypeDeletion(deletionType)
      ? adminGeneralSecurityContainer.state.expandOtherOptionsForDeletion
      : adminGeneralSecurityContainer.state.expandOtherOptionsForCompleteDeletion;
  }, [adminGeneralSecurityContainer]);

  const setExpandOtherDeleteOptionsState = useCallback((deletionType: DeletionTypeValue, bool: boolean) => {
    if (isTypeDeletion(deletionType)) {
      adminGeneralSecurityContainer.switchExpandOtherOptionsForDeletion(bool);
      return;
    }
    adminGeneralSecurityContainer.switchExpandOtherOptionsForCompleteDeletion(bool);
  }, [adminGeneralSecurityContainer]);

  const setDeletionConfigState = useCallback((
      newState: IPageDeleteConfigValue,
      setState: (value: IPageDeleteConfigValue) => void,
      deletionType: DeletionTypeValue,
  ) => {
    setState(newState);

    if (previousPageRecursiveAuthorityState(deletionType) !== null) {
      setPagePreviousRecursiveAuthorityState(deletionType, null);
    }

    if (isRecursiveDeletion(deletionType)) {
      return;
    }

    const [recursiveState, setRecursiveState] = getRecursiveDeletionConfigState(deletionType);

    const calculableValue = prepareDeleteConfigValuesForCalc(
      newState as IPageDeleteConfigValueToProcessValidation,
      recursiveState as IPageDeleteConfigValueToProcessValidation,
    );
    const shouldForceUpdate = !validateDeleteConfigs(calculableValue[0], calculableValue[1]);
    if (shouldForceUpdate) {
      setRecursiveState(newState);
      setPagePreviousRecursiveAuthorityState(deletionType, recursiveState);
      setExpandOtherDeleteOptionsState(deletionType, true);
    }
  }, [
    getRecursiveDeletionConfigState,
    previousPageRecursiveAuthorityState,
    setPagePreviousRecursiveAuthorityState,
    setExpandOtherDeleteOptionsState,
  ]);

  const renderPageDeletePermissionDropdown = useCallback((
      currentState: IPageDeleteConfigValue,
      setState: (value: IPageDeleteConfigValue) => void,
      deletionType: DeletionTypeValue,
      isButtonDisabled: boolean,
  ) => {
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
          <span className="float-start">{t(getDeleteConfigValueForT(currentState))}</span>
        </button>
        <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
          {isRecursiveDeletion(deletionType)
            ? (
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { setDeletionConfigState(PageDeleteConfigValue.Inherit, setState, deletionType) }}
              >
                {t('security_settings.inherit')}
              </button>
            )
            : (
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { setDeletionConfigState(PageDeleteConfigValue.Anyone, setState, deletionType) }}
              >
                {t('security_settings.anyone')}
              </button>
            )}
          <button
            className={`dropdown-item ${isButtonDisabled ? 'disabled' : ''}`}
            type="button"
            onClick={() => { setDeletionConfigState(PageDeleteConfigValue.AdminAndAuthor, setState, deletionType) }}
          >
            {t('security_settings.admin_and_author')}
          </button>
          <button
            className="dropdown-item"
            type="button"
            onClick={() => { setDeletionConfigState(PageDeleteConfigValue.AdminOnly, setState, deletionType) }}
          >
            {t('security_settings.admin_only')}
          </button>
        </div>
        <p className="form-text text-muted small">{t(`security_settings.${getDeletionTypeForT(deletionType)}_explanation`)}</p>
      </div>
    );
  }, [t, setDeletionConfigState]);

  const renderPageDeletePermission = useCallback((
      currentState: IPageDeleteConfigValue,
      setState: (value: IPageDeleteConfigValue) => void,
      deletionType: DeletionTypeValue,
      isButtonDisabled: boolean,
  ) => {
    const expandDeleteOptions = expandDeleteOptionsState(deletionType);

    return (
      <div key={`page-delete-permission-dropdown-${deletionType}`} className="row">
        <div className="col-md-4 text-md-end">
          {!isRecursiveDeletion(deletionType) && isTypeDeletion(deletionType) && <strong>{t('security_settings.page_delete')}</strong>}
          {!isRecursiveDeletion(deletionType) && !isTypeDeletion(deletionType) && <strong>{t('security_settings.page_delete_completely')}</strong>}
        </div>

        <div className="col-md-8">
          {!isRecursiveDeletion(deletionType)
            ? (
              <>
                {renderPageDeletePermissionDropdown(currentState, setState, deletionType, isButtonDisabled)}
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
                    <p className="form-text text-muted small mt-2">
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
                  onClick={() => setExpandOtherDeleteOptionsState(deletionType, !expandDeleteOptions)}
                >
                  <span className={`material-symbols-outlined me-1 ${expandDeleteOptions ? 'rotate-90' : ''}`}>navigate_next</span>
                  {t('security_settings.other_options')}
                </button>
                <Collapse isOpen={expandDeleteOptions}>
                  <div className="pb-4">
                    <p className="card custom-card bg-warning-sublte">
                      <span className="text-warning">
                        <span className="material-symbols-outlined">info</span>
                        {/* eslint-disable-next-line react/no-danger */}
                        <span dangerouslySetInnerHTML={{ __html: t('security_settings.page_delete_rights_caution') }} />
                      </span>
                    </p>
                    {previousPageRecursiveAuthorityState(deletionType) !== null && (
                      <div className="mb-3">
                        <strong>{t('security_settings.forced_update_desc')}</strong>
                        <code>{t(getDeleteConfigValueForT(previousPageRecursiveAuthorityState(deletionType)))}</code>
                      </div>
                    )}
                    {renderPageDeletePermissionDropdown(currentState, setState, deletionType, isButtonDisabled)}
                  </div>
                </Collapse>
              </>
            )}
        </div>
      </div>
    );
  }, [
    adminGeneralSecurityContainer,
    expandDeleteOptionsState,
    previousPageRecursiveAuthorityState,
    renderPageDeletePermissionDropdown,
    setExpandOtherDeleteOptionsState,
    t,
  ]);

  const isButtonDisabledForDeletion = !validateDeleteConfigs(currentPageDeletionAuthority, PageDeleteConfigValue.AdminAndAuthor);

  const isButtonDisabledForCompleteDeletion = !validateDeleteConfigs(currentPageCompleteDeletionAuthority, PageDeleteConfigValue.AdminAndAuthor);

  return (
    <>
      <h4 className="mb-3">{t('security_settings.page_delete_rights')}</h4>
      {[
        [currentPageDeletionAuthority, adminGeneralSecurityContainer.changePageDeletionAuthority, DeletionType.Deletion, false],
        [
          currentPageRecursiveDeletionAuthority,
          adminGeneralSecurityContainer.changePageRecursiveDeletionAuthority,
          DeletionType.RecursiveDeletion,
          isButtonDisabledForDeletion,
        ],
      ].map(arr => renderPageDeletePermission(
        arr[0] as IPageDeleteConfigValue,
        arr[1] as (value: IPageDeleteConfigValue) => void,
        arr[2] as DeletionTypeValue,
        arr[3] as boolean,
      ))}
      {[
        [currentPageCompleteDeletionAuthority, adminGeneralSecurityContainer.changePageCompleteDeletionAuthority, DeletionType.CompleteDeletion, false],
        [
          currentPageRecursiveCompleteDeletionAuthority,
          adminGeneralSecurityContainer.changePageRecursiveCompleteDeletionAuthority,
          DeletionType.RecursiveCompleteDeletion,
          isButtonDisabledForCompleteDeletion,
        ],
      ].map(arr => renderPageDeletePermission(
        arr[0] as IPageDeleteConfigValue,
        arr[1] as (value: IPageDeleteConfigValue) => void,
        arr[2] as DeletionTypeValue,
        arr[3] as boolean,
      ))}
    </>
  );
};
