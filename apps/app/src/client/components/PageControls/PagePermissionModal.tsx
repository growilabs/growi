import { useCallback, useEffect, useState } from 'react';
import { type IGrantedGroup, PageGrant, PageWriteGrant } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useSWRxCurrentGrantData } from '~/stores/page';

type Props = {
  isOpen: boolean;
  pageId: string;
  onClose: () => void;
};

type ReadGrantOption = {
  value: PageGrant;
  labelKey: string;
  icon: string;
};

type WriteGrantOption = {
  value: PageWriteGrant;
  labelKey: string;
  icon: string;
};

const READ_GRANT_OPTIONS: ReadGrantOption[] = [
  {
    value: PageGrant.GRANT_PUBLIC,
    labelKey: 'page_permission.read_grant.public',
    icon: 'group',
  },
  {
    value: PageGrant.GRANT_RESTRICTED,
    labelKey: 'page_permission.read_grant.restricted',
    icon: 'link',
  },
  {
    value: PageGrant.GRANT_OWNER,
    labelKey: 'page_permission.read_grant.owner',
    icon: 'lock',
  },
  {
    value: PageGrant.GRANT_USER_GROUP,
    labelKey: 'page_permission.read_grant.user_group',
    icon: 'more_horiz',
  },
];

const WRITE_GRANT_OPTIONS: WriteGrantOption[] = [
  {
    value: PageWriteGrant.WRITE_GRANT_PUBLIC,
    labelKey: 'page_permission.write_grant.public',
    icon: 'edit_note',
  },
  {
    value: PageWriteGrant.WRITE_GRANT_OWNER,
    labelKey: 'page_permission.write_grant.owner',
    icon: 'lock',
  },
  {
    value: PageWriteGrant.WRITE_GRANT_USER_GROUP,
    labelKey: 'page_permission.write_grant.user_group',
    icon: 'more_horiz',
  },
];

export const PagePermissionModal = ({
  isOpen,
  pageId,
  onClose,
}: Props): JSX.Element => {
  const { t } = useTranslation();

  const [readGrant, setReadGrant] = useState<PageGrant>(PageGrant.GRANT_PUBLIC);
  const [writeGrant, setWriteGrant] = useState<PageWriteGrant>(
    PageWriteGrant.WRITE_GRANT_PUBLIC,
  );
  const [readGrantedGroups, setReadGrantedGroups] = useState<IGrantedGroup[]>(
    [],
  );
  const [writeGrantedGroups, setWriteGrantedGroups] = useState<IGrantedGroup[]>(
    [],
  );

  const { data: currentGrantData } = useSWRxCurrentGrantData(
    isOpen ? pageId : null,
  );

  useEffect(() => {
    if (currentGrantData == null) return;
    const { currentPageGrant, currentPageWriteGrant } =
      currentGrantData.grantData;
    setReadGrant(currentPageGrant.grant);
    setReadGrantedGroups(
      currentPageGrant.groupGrantData?.userRelatedGroups
        .filter((g) => g.status === 'isGranted')
        .map((g) => ({ item: g.id, type: g.type }) as IGrantedGroup) ?? [],
    );
    setWriteGrant(currentPageWriteGrant.writeGrant);
    setWriteGrantedGroups(
      currentPageWriteGrant.groupGrantData?.userRelatedGroups
        .filter((g) => g.status === 'isGranted')
        .map((g) => ({ item: g.id, type: g.type }) as IGrantedGroup) ?? [],
    );
  }, [currentGrantData]);

  const handleSave = useCallback(async () => {
    try {
      await apiv3Put(`/page/${pageId}/grant`, {
        grant: readGrant,
        userRelatedGrantedGroups:
          readGrantedGroups.length > 0 ? readGrantedGroups : null,
      });
      await apiv3Put(`/page/${pageId}/write-grant`, {
        writeGrant,
        writeGrantUserGroupIds:
          writeGrantedGroups.length > 0 ? writeGrantedGroups : null,
      });
      toastSuccess(t('Successfully updated'));
      onClose();
    } catch (err) {
      toastError(t('Failed to update'));
    }
  }, [
    pageId,
    readGrant,
    readGrantedGroups,
    writeGrant,
    writeGrantedGroups,
    onClose,
    t,
  ]);

  return (
    <Modal size="lg" isOpen={isOpen} toggle={onClose}>
      <ModalHeader tag="h4" toggle={onClose}>
        {t('page_permission.title')}
      </ModalHeader>
      <ModalBody>
        <h6 className="text-muted mb-3">
          {t('page_permission.read_permission_section')}
        </h6>
        <div className="mb-4">
          {READ_GRANT_OPTIONS.map((option) => (
            <div className="form-check mb-2" key={option.value}>
              <input
                className="form-check-input"
                type="radio"
                name="readGrant"
                id={`readGrant-${option.value}`}
                checked={readGrant === option.value}
                onChange={() => setReadGrant(option.value)}
              />
              <label
                className="form-check-label"
                htmlFor={`readGrant-${option.value}`}
              >
                <span className="material-symbols-outlined me-1 align-middle">
                  {option.icon}
                </span>
                {t(option.labelKey)}
              </label>
            </div>
          ))}
        </div>

        <hr />

        <h6 className="text-muted mb-3">
          {t('page_permission.write_permission_section')}
        </h6>
        <div className="mb-3">
          {WRITE_GRANT_OPTIONS.map((option) => (
            <div className="form-check mb-2" key={option.value}>
              <input
                className="form-check-input"
                type="radio"
                name="writeGrant"
                id={`writeGrant-${option.value}`}
                checked={writeGrant === option.value}
                onChange={() => setWriteGrant(option.value)}
              />
              <label
                className="form-check-label"
                htmlFor={`writeGrant-${option.value}`}
              >
                <span className="material-symbols-outlined me-1 align-middle">
                  {option.icon}
                </span>
                {t(option.labelKey)}
              </label>
            </div>
          ))}
        </div>

        <div className="mt-3 p-3 border rounded">
          <small>
            {t('page_permission.current_summary', {
              readGrant: t(
                READ_GRANT_OPTIONS.find((o) => o.value === readGrant)
                  ?.labelKey ?? '',
              ),
              writeGrant: t(
                WRITE_GRANT_OPTIONS.find((o) => o.value === writeGrant)
                  ?.labelKey ?? '',
              ),
            })}
          </small>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onClose}
        >
          {t('Cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          {t('Save')}
        </button>
      </ModalFooter>
    </Modal>
  );
};
