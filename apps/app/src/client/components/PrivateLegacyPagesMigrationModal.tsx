import React, { useState, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import { usePrivateLegacyPagesMigrationModalActions, usePrivateLegacyPagesMigrationModalStatus } from '~/states/ui/modal/private-legacy-pages-migration';

import ApiErrorMessageList from './PageManagement/ApiErrorMessageList';


export const PrivateLegacyPagesMigrationModal = (): JSX.Element => {
  const { t } = useTranslation();

  const status = usePrivateLegacyPagesMigrationModalStatus();
  const { close } = usePrivateLegacyPagesMigrationModalActions();

  const isOpened = status?.isOpened ?? false;

  const [isRecursively, setIsRecursively] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [errs, setErrs] = useState<Error[] | null>(null);

  async function submit() {
    if (status == null || status.pages == null || status.pages.length === 0) {
      return;
    }

    const { pages, onSubmit } = status;
    const pageIds = pages.map(page => page.pageId);
    try {
      await apiv3Post<void>('/pages/legacy-pages-migration', {
        pageIds,
        isRecursively: isRecursively ? true : undefined,
      });

      if (onSubmit != null) {
        onSubmit(pages, isRecursively);
      }
    }
    catch (err) {
      setErrs([err]);
    }
  }

  function renderForm() {
    return (
      <div className="form-check form-check-warning">
        <input
          className="form-check-input"
          id="convertRecursively"
          type="checkbox"
          checked={isRecursively}
          onChange={(e) => {
            setIsRecursively(e.target.checked);
          }}
        />
        <label className="form-label form-check-label" htmlFor="convertRecursively">
          { t('private_legacy_pages.modal.convert_recursively_label') }
          <p className="form-text text-muted mt-0"> { t('private_legacy_pages.modal.convert_recursively_desc') }</p>
        </label>
      </div>
    );
  }

  const renderPageIds = () => {
    if (status != null && status.pages != null) {
      return status.pages.map(page => <div key={page.pageId}><code>{ page.path }</code></div>);
    }
    return <></>;
  };

  return (
    <Modal size="lg" isOpen={isOpened} toggle={close}>
      <ModalHeader tag="h4" toggle={close}>
        { t('private_legacy_pages.modal.title') }
      </ModalHeader>
      <ModalBody>
        <div className="grw-scrollable-modal-body pb-1">
          <label>{ t('private_legacy_pages.modal.converting_pages') }:</label><br />
          {/* Todo: change the way to show path on modal when too many pages are selected */}
          {/* https://redmine.weseek.co.jp/issues/82787 */}
          {renderPageIds()}
        </div>
        {renderForm()}
      </ModalBody>
      <ModalFooter>
        <ApiErrorMessageList errs={errs} />
        <button type="button" className="btn btn-primary" onClick={submit}>
          <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
          { t('private_legacy_pages.modal.button_label') }
        </button>
      </ModalFooter>
    </Modal>

  );
};
