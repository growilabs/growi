import React, { type JSX, useCallback, useEffect, useState } from 'react';
import { GroupType, PageGrant } from '@growi/core';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import {
  type IPageGrantData,
  UserGroupPageGrantStatus,
} from '~/interfaces/page';
import type {
  IRecordApplicableGrant,
  IResGrantData,
  PopulatedGrantedGroup,
} from '~/interfaces/page-grant';
import {
  useSWRxApplicableGrant,
  useSWRxCurrentGrantData,
  useSWRxCurrentPage,
} from '~/stores/page';
import { useCurrentUser } from '~/stores-universal/context';

type ModalProps = {
  isOpen: boolean;
  pageId: string;
  dataApplicableGrant: IRecordApplicableGrant;
  currentAndParentPageGrantData: IResGrantData;
  close(): void;
};

const FixPageGrantModal = (props: ModalProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    isOpen,
    pageId,
    dataApplicableGrant,
    currentAndParentPageGrantData,
    close,
  } = props;

  const [selectedGrant, setSelectedGrant] = useState<PageGrant>(
    PageGrant.GRANT_RESTRICTED,
  );

  const [isGroupSelectModalShown, setIsGroupSelectModalShown] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<PopulatedGrantedGroup[]>(
    [],
  );

  // Alert message state
  const [shouldShowModalAlert, setShowModalAlert] = useState<boolean>(false);

  const applicableGroups =
    dataApplicableGrant[PageGrant.GRANT_USER_GROUP]?.applicableGroups;

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedGrant(PageGrant.GRANT_RESTRICTED);
      setSelectedGroups([]);
      setShowModalAlert(false);
    }
  }, [isOpen]);

  const groupListItemClickHandler = (group: PopulatedGrantedGroup) => {
    if (selectedGroups.find((g) => g.item._id === group.item._id) != null) {
      setSelectedGroups(
        selectedGroups.filter((g) => g.item._id !== group.item._id),
      );
    } else {
      setSelectedGroups([...selectedGroups, group]);
    }
  };

  const submit = async () => {
    // Validate input values
    if (
      selectedGrant === PageGrant.GRANT_USER_GROUP &&
      selectedGroups.length === 0
    ) {
      setShowModalAlert(true);
      return;
    }

    close();

    try {
      const apiv3Put = (await import('~/client/util/apiv3-client')).apiv3Put;
      await apiv3Put(`/page/${pageId}/grant`, {
        grant: selectedGrant,
        userRelatedGrantedGroups:
          selectedGroups.length !== 0
            ? selectedGroups.map((g) => {
                return { item: g.item._id, type: g.type };
              })
            : null,
      });

      const toastSuccess = (await import('~/client/util/toastr')).toastSuccess;
      toastSuccess(t('Successfully updated'));
    } catch (err) {
      const toastError = (await import('~/client/util/toastr')).toastError;
      toastError(t('Failed to update'));
    }
  };

  const getGrantLabel = useCallback(
    (isForbidden: boolean, grantData?: IPageGrantData): string => {
      if (isForbidden) {
        return t('fix_page_grant.modal.grant_label.isForbidden');
      }

      if (grantData == null) {
        return t('fix_page_grant.modal.grant_label.isForbidden');
      }

      if (grantData.grant === 1) {
        return t('fix_page_grant.modal.grant_label.public');
      }

      if (grantData.grant === 4) {
        return t('fix_page_grant.modal.radio_btn.only_me');
      }

      if (grantData.grant === 5) {
        const groupGrantData = grantData.groupGrantData;
        if (groupGrantData != null) {
          const userRelatedGrantedGroups =
            groupGrantData.userRelatedGroups.filter(
              (group) => group.status === UserGroupPageGrantStatus.isGranted,
            );
          if (userRelatedGrantedGroups.length > 0) {
            const grantedGroupNames = [
              ...userRelatedGrantedGroups.map((group) => group.name),
              ...groupGrantData.nonUserRelatedGrantedGroups.map(
                (group) => group.name,
              ),
            ];
            return `${t('fix_page_grant.modal.radio_btn.grant_group')} (${grantedGroupNames.join(', ')})`;
          }
        }

        return t('fix_page_grant.modal.grant_label.isForbidden');
      }

      throw Error('cannot get grant label'); // this error can't be throwed
    },
    [t],
  );

  const renderGrantDataLabel = useCallback(() => {
    const { isForbidden, currentPageGrant, parentPageGrant } =
      currentAndParentPageGrantData;

    const currentGrantLabel = getGrantLabel(false, currentPageGrant);
    const parentGrantLabel = getGrantLabel(isForbidden, parentPageGrant);

    return (
      <>
        <p className="mt-3">
          {t('fix_page_grant.modal.grant_label.parentPageGrantLabel') +
            parentGrantLabel}
        </p>
        <p>
          {t('fix_page_grant.modal.grant_label.currentPageGrantLabel') +
            currentGrantLabel}
        </p>
        <p
          // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
          dangerouslySetInnerHTML={{
            __html: t('fix_page_grant.modal.grant_label.docLink'),
          }}
        />
      </>
    );
  }, [t, currentAndParentPageGrantData, getGrantLabel]);

  const renderModalBodyAndFooter = () => {
    const isGrantAvailable = Object.keys(dataApplicableGrant || {}).length > 0;

    if (!isGrantAvailable) {
      return (
        <p className="m-5">{t('fix_page_grant.modal.no_grant_available')}</p>
      );
    }

    return (
      <>
        <ModalBody>
          <div>
            <p
              className="mb-2"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
              dangerouslySetInnerHTML={{
                __html: t('fix_page_grant.modal.need_to_fix_grant'),
              }}
            />

            {/* grant data label */}
            {renderGrantDataLabel()}

            <div className="ms-2">
              <div className="form-check mb-3">
                <input
                  className="form-check-input"
                  name="grantRestricted"
                  id="grantRestricted"
                  type="radio"
                  disabled={
                    !(PageGrant.GRANT_RESTRICTED in dataApplicableGrant)
                  }
                  checked={selectedGrant === PageGrant.GRANT_RESTRICTED}
                  onChange={() => setSelectedGrant(PageGrant.GRANT_RESTRICTED)}
                />
                <label
                  className="form-label form-check-label"
                  htmlFor="grantRestricted"
                >
                  {t('fix_page_grant.modal.radio_btn.restrected')}
                </label>
              </div>
              <div className="form-check mb-3">
                <input
                  className="form-check-input"
                  name="grantUser"
                  id="grantUser"
                  type="radio"
                  disabled={!(PageGrant.GRANT_OWNER in dataApplicableGrant)}
                  checked={selectedGrant === PageGrant.GRANT_OWNER}
                  onChange={() => setSelectedGrant(PageGrant.GRANT_OWNER)}
                />
                <label
                  className="form-label form-check-label"
                  htmlFor="grantUser"
                >
                  {t('fix_page_grant.modal.radio_btn.only_me')}
                </label>
              </div>
              <div className="form-check d-flex mb-3">
                <input
                  className="form-check-input"
                  name="grantUserGroup"
                  id="grantUserGroup"
                  type="radio"
                  disabled={
                    !(PageGrant.GRANT_USER_GROUP in dataApplicableGrant)
                  }
                  checked={selectedGrant === PageGrant.GRANT_USER_GROUP}
                  onChange={() => setSelectedGrant(PageGrant.GRANT_USER_GROUP)}
                />
                <label
                  className="form-label form-check-label"
                  htmlFor="grantUserGroup"
                >
                  {t('fix_page_grant.modal.radio_btn.grant_group')}
                </label>
                <div className="dropdown ms-2">
                  <button
                    type="button"
                    className="btn btn-secondary dropdown-toggle text-right w-100 border-0 shadow-none"
                    disabled={selectedGrant !== PageGrant.GRANT_USER_GROUP} // disable when its radio input is not selected
                    onClick={() => setIsGroupSelectModalShown(true)}
                  >
                    <span className="float-start ms-2">
                      {selectedGroups.length === 0
                        ? t('fix_page_grant.modal.select_group_default_text')
                        : selectedGroups.map((g) => g.item.name).join(', ')}
                    </span>
                  </button>
                </div>
              </div>
              {shouldShowModalAlert && (
                <p className="alert alert-warning">
                  {t('fix_page_grant.modal.alert_message')}
                </p>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {t('fix_page_grant.modal.btn_label')}
          </button>
        </ModalFooter>
      </>
    );
  };

  return (
    <>
      <Modal size="lg" isOpen={isOpen} toggle={close}>
        <ModalHeader tag="h4" toggle={close}>
          {t('fix_page_grant.modal.title')}
        </ModalHeader>
        {renderModalBodyAndFooter()}
      </Modal>
      {applicableGroups != null && (
        <Modal
          isOpen={isGroupSelectModalShown}
          toggle={() => setIsGroupSelectModalShown(false)}
        >
          <ModalHeader
            tag="h4"
            toggle={() => setIsGroupSelectModalShown(false)}
          >
            {t('user_group.select_group')}
          </ModalHeader>
          <ModalBody>
            <>
              {applicableGroups.map((group) => {
                const groupIsGranted =
                  selectedGroups?.find((g) => g.item._id === group.item._id) !=
                  null;
                const activeClass = groupIsGranted ? 'active' : '';

                return (
                  <button
                    className={`btn btn-outline-primary w-100 d-flex justify-content-start mb-3 align-items-center p-3 ${activeClass}`}
                    type="button"
                    key={group.item._id}
                    onClick={() => groupListItemClickHandler(group)}
                  >
                    <span className="align-middle">
                      <input type="checkbox" checked={groupIsGranted} />
                    </span>
                    <h5 className="d-inline-block ml-3">{group.item.name}</h5>
                    {group.type === GroupType.externalUserGroup && (
                      <span className="ml-2 badge badge-pill badge-info">
                        {group.item.provider}
                      </span>
                    )}
                    {/* TODO: Replace <div className="small">(TBD) List group members</div> */}
                  </button>
                );
              })}
              <button
                type="button"
                className="btn btn-primary mt-2 float-right"
                onClick={() => setIsGroupSelectModalShown(false)}
              >
                {t('Done')}
              </button>
            </>
          </ModalBody>
        </Modal>
      )}
    </>
  );
};

export const FixPageGrantAlert = (): JSX.Element => {
  const { t } = useTranslation();

  const { data: currentUser } = useCurrentUser();
  const { data: pageData } = useSWRxCurrentPage();
  const hasParent = pageData != null ? pageData.parent != null : false;
  const pageId = pageData?._id;

  const [isOpen, setOpen] = useState<boolean>(false);

  const { data: dataIsGrantNormalized } = useSWRxCurrentGrantData(
    currentUser != null ? pageId : null,
  );
  const { data: dataApplicableGrant } = useSWRxApplicableGrant(
    currentUser != null ? pageId : null,
  );

  // Dependencies
  if (pageData == null) {
    return <></>;
  }

  if (!hasParent) {
    return <></>;
  }
  if (
    dataIsGrantNormalized?.isGrantNormalized == null ||
    dataIsGrantNormalized.isGrantNormalized
  ) {
    return <></>;
  }

  return (
    <>
      <div className="alert alert-warning py-3 ps-4 d-flex flex-column flex-lg-row">
        <div className="flex-grow-1 d-flex align-items-center">
          <span className="material-symbols-outlined mx-1" aria-hidden="true">
            error
          </span>
          {t('fix_page_grant.alert.description')}
        </div>
        <div className="d-flex align-items-end align-items-lg-center">
          <button
            type="button"
            className="btn btn-info btn-sm rounded-pill px-3"
            onClick={() => setOpen(true)}
          >
            {t('fix_page_grant.alert.btn_label')}
          </button>
        </div>
      </div>

      {pageId != null && dataApplicableGrant != null && (
        <FixPageGrantModal
          isOpen={isOpen}
          pageId={pageId}
          dataApplicableGrant={dataApplicableGrant}
          currentAndParentPageGrantData={dataIsGrantNormalized.grantData}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
};
